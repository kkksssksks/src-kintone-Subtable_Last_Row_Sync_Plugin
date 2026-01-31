(function(PLUGIN_ID) {
  'use strict';

  const conf = kintone.plugin.app.getConfig(PLUGIN_ID);
  if (!conf.settings) return;
  const settings = JSON.parse(conf.settings);

  let fieldDefs = {};
  let lastExecTime = 0;

  const fetchFieldDefinitions = async () => {
    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: kintone.app.getId() });
      fieldDefs = resp.properties;
    } catch (err) { console.error('フィールド定義取得失敗:', err); }
  };

  // 値を文字列として取得（空の場合は確実に "" を返す）
  const getSafeString = (val) => {
    if (val === undefined || val === null || val === "") return "";
    if (Array.isArray(val)) {
      if (val.length === 0) return "";
      return val.map(item => (typeof item === 'object') ? (item.name || item.code || JSON.stringify(item)) : item).join(', ');
    }
    return String(val);
  };

  /**
   * 型に合わせた安全な値の取得（未選択状態を最優先）
   */
  const getSafeValueByType = (srcVal, destCode) => {
    const destDef = fieldDefs[destCode];
    if (!destDef) return undefined;

    const dType = destDef.type;
    const isArrayType = ['CHECK_BOX', 'MULTI_SELECT', 'CATEGORY', 'USER_SELECT', 'ORGANIZATION_SELECT', 'GROUP_SELECT'].includes(dType);
    const hasOptions = ['DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX', 'MULTI_SELECT'].includes(dType);

    // ソースが null, undefined, "", [] のいずれかであれば「空」として扱う
    const isEmpty = srcVal === null || srcVal === undefined || srcVal === "" || (Array.isArray(srcVal) && srcVal.length === 0);

    if (isEmpty) {
      return isArrayType ? [] : null;
    }

    // 値が存在する場合の処理
    let result = isArrayType ? [] : null;
    if (isArrayType) {
      const valArray = Array.isArray(srcVal) ? srcVal : [srcVal];
      if (hasOptions && destDef.options) {
        const validOptions = Object.keys(destDef.options);
        result = valArray.filter(v => validOptions.includes(v));
      } else {
        result = valArray;
      }
    } else {
      const valStr = String(srcVal);
      if (hasOptions && destDef.options) {
        result = Object.keys(destDef.options).includes(valStr) ? valStr : null;
      } else {
        result = valStr;
      }
    }
    return result;
  };

  const syncLastRow = (record) => {
    const now = Date.now();
    if (now - lastExecTime < 50) return;
    lastExecTime = now;
    if (Object.keys(fieldDefs).length === 0) return;

    settings.forEach(s => {
      const tableField = record[s.tableCode];
      if (!tableField) return;

      const isTableEmpty = !tableField.value || tableField.value.length === 0;
      const lastRow = !isTableEmpty ? tableField.value[tableField.value.length - 1].value : null;

      s.mappings.forEach(m => {
        const destDef = fieldDefs[m.dest];
        if (!destDef || !record[m.dest]) return;

        let finalVal;
        if (isTableEmpty) {
          // テーブルが空の場合はクリア
          finalVal = (['CHECK_BOX','MULTI_SELECT','USER_SELECT','ORGANIZATION_SELECT','GROUP_SELECT'].includes(destDef.type)) ? [] : null;
        } else {
          const srcField = lastRow[m.src];
          if (!srcField) return; // フィールドコード自体がテーブル内に見当たらない場合は何もしない

          const srcVal = srcField.value;
          
          if (destDef.type === 'SINGLE_LINE_TEXT') {
            finalVal = getSafeString(srcVal);
          } else {
            finalVal = getSafeValueByType(srcVal, m.dest);
          }
        }
        
        // デバッグ用ログ（同期の瞬間にコンソールに出力されます）
        console.log(`[Plugin Sync] ${m.src} -> ${m.dest} | Value:`, finalVal);
        
        record[m.dest].value = finalVal;
      });
    });
  };

  const lockDestFields = (record) => {
    settings.forEach(s => {
      s.mappings.forEach(m => { if (record[m.dest]) record[m.dest].disabled = true; });
    });
  };

  // UI・進捗モーダル関連は変更なし
  const showProgressModal = () => {
    const overlay = document.createElement('div');
    overlay.id = 'plugin-progress-modal';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:10000; display:flex; justify-content:center; align-items:center;';
    overlay.innerHTML = `<div style="background:#fff; padding:30px; border-radius:8px; text-align:center; min-width:400px; box-shadow:0 10px 25px rgba(0,0,0,0.2);"><h3 style="margin:0 0 10px; color:#2c3e50;">一括更新中 (Ver 1.1.1)</h3><p id="plugin-progress-text" style="color:#7f8c8d; font-size:14px; margin-bottom:5px;">準備中...</p><div style="width:100%; background:#ecf0f1; height:10px; border-radius:5px; overflow:hidden;"><div id="plugin-progress-bar" style="width:0%; height:100%; background:#3498db; transition:width 0.3s;"></div></div><p id="plugin-error-count" style="color:#e74c3c; font-size:12px; margin-top:10px; display:none;">エラースキップ: 0件</p></div>`;
    document.body.appendChild(overlay);
  };

  const updateProgress = (current, total, errorCount) => {
    const text = document.getElementById('plugin-progress-text');
    const bar = document.getElementById('plugin-progress-bar');
    const errText = document.getElementById('plugin-error-count');
    if (text) text.innerText = `${total}件中 ${current}件 完了`;
    if (bar) bar.style.width = `${(current / total) * 100}%`;
    if (errorCount > 0 && errText) { errText.style.display = 'block'; errText.innerText = `エラースキップ: ${errorCount}件`; }
  };

  const closeProgressModal = () => {
    const el = document.getElementById('plugin-progress-modal');
    if (el) document.body.removeChild(el);
  };

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
      if (!confirm('絞り込み中の全レコードを一括更新しますか？')) return;
      showProgressModal();
      await fetchFieldDefinitions();
      const appId = kintone.app.getId();
      const condition = kintone.app.getQueryCondition() || '';
      const baseQuery = condition ? `(${condition})` : '';
      let allRecords = [];
      let lastId = 0;
      let errorCount = 0;
      let processedCount = 0;

      try {
        while (true) {
          const query = `${baseQuery}${baseQuery ? ' and ' : ''}$id > ${lastId} order by $id asc limit 500`;
          const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: appId, query: query });
          if (resp.records.length === 0) break;
          allRecords = allRecords.concat(resp.records);
          lastId = resp.records[resp.records.length - 1].$id.value;
        }
      } catch(e) { closeProgressModal(); return alert('取得失敗: ' + e.message); }

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
            let finalVal = isTableEmpty ? (['CHECK_BOX','MULTI_SELECT','USER_SELECT','ORGANIZATION_SELECT','GROUP_SELECT'].includes(destDef.type) ? [] : null) : (destDef.type === 'SINGLE_LINE_TEXT' ? getSafeString(lastRow[m.src] ? lastRow[m.src].value : null) : getSafeValueByType(lastRow[m.src] ? lastRow[m.src].value : null, m.dest));
            if (finalVal !== undefined) updateData.record[m.dest] = { value: finalVal };
          });
        });
        if (Object.keys(updateData.record).length > 0) updatePayloads.push(updateData);
        else processedCount++;
      });

      const total = updatePayloads.length;
      for (let i = 0; i < total; i += 100) {
        const chunk = updatePayloads.slice(i, i + 100);
        const safeChunk = JSON.parse(JSON.stringify(chunk, (k, v) => v === undefined ? null : v));
        try {
          await kintone.api(kintone.api.url('/k/v1/records', true), 'PUT', { app: appId, records: safeChunk });
          processedCount += chunk.length;
        } catch (bulkErr) {
          for (const singleRec of safeChunk) {
            try {
              await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { app: appId, ...singleRec });
              processedCount++;
            } catch (singleErr) { errorCount++; processedCount++; }
            updateProgress(processedCount, allRecords.length, errorCount);
          }
        }
        updateProgress(processedCount, allRecords.length, errorCount);
      }
      closeProgressModal();
      alert('一括更新完了！' + (errorCount > 0 ? ` (${errorCount}件スキップ)` : ''));
      location.reload();
    };
    const space = kintone.app.getHeaderMenuSpaceElement();
    if (space) space.appendChild(btn);
  });
})(kintone.$PLUGIN_ID);