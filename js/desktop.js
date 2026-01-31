(function(PLUGIN_ID) {
  'use strict';

  const conf = kintone.plugin.app.getConfig(PLUGIN_ID);
  if (!conf.settings) return;
  const settings = JSON.parse(conf.settings);

  let fieldDefs = {};
  let lastExecTime = 0;

  // フィールド定義取得
  const fetchFieldDefinitions = async () => {
    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: kintone.app.getId() });
      fieldDefs = resp.properties;
    } catch (err) { console.error('フィールド定義取得失敗:', err); }
  };

  // 安全な値への変換（文字列系）
  const getSafeString = (val) => {
    if (val === undefined || val === null) return '';
    if (Array.isArray(val)) {
      return val.map(item => (typeof item === 'object') ? (item.name || item.code || JSON.stringify(item)) : item).join(', ');
    }
    return String(val);
  };

  // 安全な値への変換（選択肢・ユーザー選択系）
  const getSafeValueByType = (srcVal, destCode, currentRecord) => {
    const destDef = fieldDefs[destCode];
    if (!destDef) return undefined;

    const dType = destDef.type;
    // 配列を要求するフィールドタイプ一覧
    const isArrayType = ['CHECK_BOX', 'MULTI_SELECT', 'CATEGORY', 'USER_SELECT', 'ORGANIZATION_SELECT', 'GROUP_SELECT'].includes(dType);
    // optionsプロパティを持つ（バリデーション可能な）フィールド
    const hasOptions = ['DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX', 'MULTI_SELECT'].includes(dType);

    const currentVal = (currentRecord && currentRecord[destCode]) ? currentRecord[destCode].value : null;
    let result = (currentVal !== null && currentVal !== undefined) ? currentVal : (isArrayType ? [] : '');

    // コピー元に値がある場合のみ処理
    if (srcVal !== undefined && srcVal !== null && srcVal !== "") {
      if (isArrayType) {
        // 配列型フィールドへの転記
        const valArray = Array.isArray(srcVal) ? srcVal : [srcVal];
        
        if (hasOptions && destDef.options) {
          // 選択肢マスタとの照合が必要な場合
          const validOptions = Object.keys(destDef.options);
          const filtered = valArray.filter(v => validOptions.includes(v));
          // 必須でなければフィルタ結果を、必須かつフィルタ結果ゼロなら既存値を維持
          if (!destDef.required || filtered.length > 0) result = filtered;
        } else {
          // ユーザー選択などマスタ照合ができない（API経由でoptionsが取れない）場合はそのまま通す
          result = valArray;
        }
      } else {
        // 単一値フィールドへの転記
        const valStr = String(srcVal);
        if (hasOptions && destDef.options) {
           if (Object.keys(destDef.options).includes(valStr)) result = valStr;
        } else {
           result = valStr;
        }
      }
    }

    // 最終型チェック（APIエラー回避の最後の砦）
    if (isArrayType && !Array.isArray(result)) return [];
    if (!isArrayType && typeof result === 'object') return '';
    
    return result;
  };

  // リアルタイム反映処理
  const syncLastRow = (record) => {
    const now = Date.now();
    if (now - lastExecTime < 50) return;
    lastExecTime = now;
    if (Object.keys(fieldDefs).length === 0) return;

    settings.forEach(s => {
      const tableField = record[s.tableCode];
      const isTableEmpty = !tableField || !tableField.value || tableField.value.length === 0;
      const lastRow = !isTableEmpty ? tableField.value[tableField.value.length - 1].value : null;

      s.mappings.forEach(m => {
        const destDef = fieldDefs[m.dest];
        if (!destDef || !record[m.dest]) return;

        let finalVal;
        if (isTableEmpty) {
          finalVal = (['CHECK_BOX','MULTI_SELECT','USER_SELECT','ORGANIZATION_SELECT','GROUP_SELECT'].includes(destDef.type)) ? [] : '';
        } else {
          const srcVal = lastRow[m.src] ? lastRow[m.src].value : null;
          finalVal = (destDef.type === 'SINGLE_LINE_TEXT') ? getSafeString(srcVal) : getSafeValueByType(srcVal, m.dest, record);
        }
        record[m.dest].value = finalVal;
      });
    });
  };

  const lockDestFields = (record) => {
    settings.forEach(s => {
      s.mappings.forEach(m => { if (record[m.dest]) record[m.dest].disabled = true; });
    });
  };

  // UIコンポーネント
  const showProgressModal = () => {
    const overlay = document.createElement('div');
    overlay.id = 'plugin-progress-modal';
    overlay.style.cssText = 'position:Fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:10000; display:flex; justify-content:center; align-items:center;';
    overlay.innerHTML = `
      <div style="background:#fff; padding:30px; border-radius:8px; text-align:center; min-width:400px; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
        <h3 style="margin:0 0 10px; color:#2c3e50;">一括更新中</h3>
        <p id="plugin-progress-text" style="color:#7f8c8d; font-size:14px; margin-bottom:5px;">準備中...</p>
        <div style="width:100%; background:#ecf0f1; height:10px; border-radius:5px; overflow:hidden;">
          <div id="plugin-progress-bar" style="width:0%; height:100%; background:#3498db; transition:width 0.3s;"></div>
        </div>
        <p id="plugin-error-count" style="color:#e74c3c; font-size:12px; margin-top:10px; display:none;">エラースキップ: 0件</p>
      </div>`;
    document.body.appendChild(overlay);
  };

  const updateProgress = (current, total, errorCount) => {
    const text = document.getElementById('plugin-progress-text');
    const bar = document.getElementById('plugin-progress-bar');
    const errText = document.getElementById('plugin-error-count');
    
    if (text) text.innerText = `${total}件中 ${current}件 完了`;
    if (bar) bar.style.width = `${(current / total) * 100}%`;
    if (errorCount > 0 && errText) {
      errText.style.display = 'block';
      errText.innerText = `エラースキップ: ${errorCount}件 (詳細はコンソール)`;
    }
  };

  const closeProgressModal = () => {
    const el = document.getElementById('plugin-progress-modal');
    if (el) document.body.removeChild(el);
  };

  // メイン処理開始
  fetchFieldDefinitions();

  kintone.events.on(['app.record.create.show', 'app.record.edit.show', 'app.record.index.edit.show'], async (e) => {
    if (Object.keys(fieldDefs).length === 0) await fetchFieldDefinitions();
    lockDestFields(e.record);
    return e;
  });

  let cEvents = [];
  settings.forEach(s => {
    cEvents.push(`app.record.create.change.${s.tableCode}`, `app.record.edit.change.${s.tableCode}`);
    s.mappings.forEach(m => { cEvents.push(`app.record.create.change.${m.src}`, `app.record.edit.change.${m.src}`); });
  });
  kintone.events.on(cEvents, (e) => { syncLastRow(e.record); return e; });
  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit', 'app.record.index.edit.submit'], (e) => { syncLastRow(e.record); return e; });

  // 一括更新ボタン
  kintone.events.on('app.record.index.show', (event) => {
    if (conf.showBulk !== 'true' || document.getElementById('bulk-sync-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'bulk-sync-btn';
    btn.innerText = 'サブテーブル最下行を一括反映';
    btn.className = 'kintoneplugin-button-dialog-ok';
    btn.style.cssText = 'margin-left:15px; border-radius:4px; height:48px; padding:0 32px; background-color:#3498db; color:#fff; font-weight:bold; border:none; cursor:pointer; font-size:14px; box-sizing:border-box;';
    btn.onmouseover = () => { btn.style.backgroundColor = '#2980b9'; };
    btn.onmouseout = () => { btn.style.backgroundColor = '#3498db'; };

    btn.onclick = async () => {
      if (!confirm('絞り込み中の全レコードを一括更新しますか？\n※エラーが発生したレコードは自動的にスキップされます。')) return;
      showProgressModal();
      await fetchFieldDefinitions();
      const appId = kintone.app.getId();
      const condition = kintone.app.getQueryCondition() || '';
      const baseQuery = condition ? `(${condition})` : '';
      
      let allRecords = [];
      let lastId = 0;
      let errorCount = 0;
      let processedCount = 0;

      // 1. 全対象レコードの取得（IDのみ取得してメモリ節約したいが、データ構築のため全件取得）
      try {
        while (true) {
          const query = `${baseQuery}${baseQuery ? ' and ' : ''}$id > ${lastId} order by $id asc limit 500`;
          const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: appId, query: query });
          if (resp.records.length === 0) break;
          allRecords = allRecords.concat(resp.records);
          lastId = resp.records[resp.records.length - 1].$id.value;
          document.getElementById('plugin-progress-text').innerText = `データ取得中... ${allRecords.length}件`;
        }
      } catch(e) {
        closeProgressModal();
        return alert('データ取得に失敗しました: ' + e.message);
      }

      if (allRecords.length === 0) { closeProgressModal(); return alert('更新対象なし'); }

      // 2. 更新用データの構築
      const updatePayloads = [];
      allRecords.forEach(rec => {
        const updateData = { id: rec.$id.value, record: {} };
        settings.forEach(s => {
          const tableField = rec[s.tableCode];
          const isTableEmpty = !tableField || !tableField.value || tableField.value.length === 0;
          const lastRow = !isTableEmpty ? tableField.value[tableField.value.length - 1].value : null;

          s.mappings.forEach(m => {
            const destDef = fieldDefs[m.dest];
            if (!destDef) return;
            
            let finalVal;
            if (isTableEmpty) {
               finalVal = (['CHECK_BOX','MULTI_SELECT','USER_SELECT','ORGANIZATION_SELECT','GROUP_SELECT'].includes(destDef.type)) ? [] : '';
            } else {
               const srcVal = lastRow[m.src] ? lastRow[m.src].value : null;
               finalVal = (destDef.type === 'SINGLE_LINE_TEXT') ? getSafeString(srcVal) : getSafeValueByType(srcVal, m.dest, rec);
            }
            if (finalVal !== undefined) {
               updateData.record[m.dest] = { value: finalVal };
            }
          });
        });
        if (Object.keys(updateData.record).length > 0) updatePayloads.push(updateData);
        else processedCount++; // 更新不要なものは処理済みにカウント
      });

      // 3. バッチ更新実行（フェイルセーフ機能付き）
      const total = updatePayloads.length;
      const chunkSize = 100;

      for (let i = 0; i < total; i += chunkSize) {
        const chunk = updatePayloads.slice(i, i + chunkSize);
        // クリーンアップ
        const safeChunk = JSON.parse(JSON.stringify(chunk, (k, v) => v === undefined ? null : v));

        try {
          // まず一括更新を試みる
          await kintone.api(kintone.api.url('/k/v1/records', true), 'PUT', { app: appId, records: safeChunk });
          processedCount += chunk.length;
        } catch (bulkErr) {
          console.warn('一括更新失敗。1件ずつリトライモードに移行します:', bulkErr);
          // 失敗したら1件ずつリトライ
          for (const singleRec of safeChunk) {
            try {
              await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { app: appId, ...singleRec });
              processedCount++;
            } catch (singleErr) {
              console.error(`レコードID ${singleRec.id} の更新に失敗:`, singleErr);
              errorCount++;
              processedCount++; // エラーでも処理済みとする
            }
            updateProgress(processedCount, allRecords.length, errorCount);
          }
        }
        updateProgress(processedCount, allRecords.length, errorCount);
      }

      closeProgressModal();
      let msg = '一括更新が完了しました！';
      if (errorCount > 0) msg += `\n\n【注意】${errorCount}件のエラーが発生し、スキップされました。\n詳細はブラウザのコンソール(F12)を確認してください。`;
      alert(msg);
      location.reload();
    };
    const space = kintone.app.getHeaderMenuSpaceElement();
    if (space) space.appendChild(btn);
  });
})(kintone.$PLUGIN_ID);