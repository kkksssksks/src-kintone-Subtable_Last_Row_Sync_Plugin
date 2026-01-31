(function(PLUGIN_ID) {
  'use strict';

  const conf = kintone.plugin.app.getConfig(PLUGIN_ID);
  if (!conf.settings) return;
  const settings = JSON.parse(conf.settings);

  let fieldDefs = {};
  let lastExecTime = 0;

  // フィールド定義取得（非同期で行うが、イベント登録は待たない）
  const fetchFieldDefinitions = async () => {
    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: kintone.app.getId() });
      fieldDefs = resp.properties;
    } catch (err) { console.error('フィールド定義取得失敗:', err); }
  };

  const getSafeString = (val) => {
    if (val === undefined || val === null || val === "") return "";
    if (Array.isArray(val)) {
      if (val.length === 0) return "";
      return val.map(item => (typeof item === 'object') ? (item.name || item.code || JSON.stringify(item)) : item).join(', ');
    }
    return String(val);
  };

  const getSafeValueByType = (srcVal, destCode) => {
    const destDef = fieldDefs[destCode];
    if (!destDef) return undefined;
    const dType = destDef.type;
    const isArrayType = ['CHECK_BOX', 'MULTI_SELECT', 'CATEGORY', 'USER_SELECT', 'ORGANIZATION_SELECT', 'GROUP_SELECT'].includes(dType);
    const hasOptions = ['DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX', 'MULTI_SELECT'].includes(dType);

    const isEmpty = srcVal === null || srcVal === undefined || srcVal === "" || (Array.isArray(srcVal) && srcVal.length === 0);
    if (isEmpty) return isArrayType ? [] : null;

    let result = isArrayType ? [] : null;
    if (isArrayType) {
      const valArray = Array.isArray(srcVal) ? srcVal : [srcVal];
      if (hasOptions && destDef.options) {
        const options = Object.keys(destDef.options);
        result = valArray.filter(v => options.includes(v));
      } else { result = valArray; }
    } else {
      const valStr = String(srcVal);
      if (hasOptions && destDef.options) {
        result = Object.keys(destDef.options).includes(valStr) ? valStr : null;
      } else { result = valStr; }
    }
    return result;
  };

  const syncLastRow = (record) => {
    const now = Date.now();
    if (now - lastExecTime < 50) return;
    lastExecTime = now;
    // fieldDefsがまだ取得できていない場合でも、最低限の文字列転記は試みる（エラー回避）
    
    settings.forEach(s => {
      const tableField = record[s.tableCode];
      if (!tableField) return;
      const isTableEmpty = !tableField.value || tableField.value.length === 0;
      const lastRow = !isTableEmpty ? tableField.value[tableField.value.length - 1].value : null;

      s.mappings.forEach(m => {
        if (!record[m.dest]) return;
        
        const destDef = fieldDefs[m.dest];
        // 定義取得前か、定義がない場合は文字列として安全に処理
        if (!destDef) {
           // まだ定義がない場合は一旦スキップするか、単純コピーを試みる
           // ここでは定義ロード待ちによる不整合を防ぐため、定義がある場合のみ高度な型変換を行う
           return; 
        }

        let finalVal;
        if (isTableEmpty) {
          finalVal = (['CHECK_BOX','MULTI_SELECT','USER_SELECT','ORGANIZATION_SELECT','GROUP_SELECT'].includes(destDef.type)) ? [] : null;
        } else {
          const srcField = lastRow[m.src];
          if (!srcField) return;
          const srcVal = srcField.value;
          
          if (destDef.type === 'SINGLE_LINE_TEXT') {
            finalVal = getSafeString(srcVal);
          } else {
            finalVal = getSafeValueByType(srcVal, m.dest);
          }
        }
        record[m.dest].value = finalVal;
      });
    });
  };

  const lockDestFields = (record) => {
    settings.forEach(s => { s.mappings.forEach(m => { if (record[m.dest]) record[m.dest].disabled = true; }); });
  };

  // セキュアコーディング対応: innerHTMLを使わずDOM構築でモーダルを作成
  const showProgressModal = () => {
    const overlay = document.createElement('div');
    overlay.id = 'plugin-progress-modal';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:10000; display:flex; justify-content:center; align-items:center;';

    const container = document.createElement('div');
    container.style.cssText = 'background:#fff; padding:30px; border-radius:8px; text-align:center; min-width:400px; box-shadow:0 10px 25px rgba(0,0,0,0.2);';

    const title = document.createElement('h3');
    title.style.cssText = 'margin:0 0 10px; color:#2c3e50;';
    title.textContent = '一括更新中';
    
    const statusText = document.createElement('p');
    statusText.id = 'plugin-progress-text';
    statusText.style.cssText = 'color:#7f8c8d; font-size:14px; margin-bottom:5px;';
    statusText.textContent = '準備中...';

    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'width:100%; background:#ecf0f1; height:10px; border-radius:5px; overflow:hidden;';
    
    const bar = document.createElement('div');
    bar.id = 'plugin-progress-bar';
    bar.style.cssText = 'width:0%; height:100%; background:#3498db; transition:width 0.3s;';
    barWrap.appendChild(bar);

    const errorText = document.createElement('p');
    errorText.id = 'plugin-error-count';
    errorText.style.cssText = 'color:#e74c3c; font-size:12px; margin-top:10px; display:none;';
    errorText.textContent = 'エラースキップ: 0件';

    container.appendChild(title);
    container.appendChild(statusText);
    container.appendChild(barWrap);
    container.appendChild(errorText);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
  };

  const updateProgress = (current, total, errorCount) => {
    const text = document.getElementById('plugin-progress-text');
    const bar = document.getElementById('plugin-progress-bar');
    const errText = document.getElementById('plugin-error-count');
    if (text) text.textContent = `${total}件中 ${current}件 完了`;
    if (bar) bar.style.width = `${(current / total) * 100}%`;
    if (errorCount > 0 && errText) {
      errText.style.display = 'block';
      errText.textContent = `エラースキップ: ${errorCount}件`;
    }
  };

  const closeProgressModal = () => {
    const el = document.getElementById('plugin-progress-modal');
    if (el) document.body.removeChild(el);
  };

  // メイン処理
  fetchFieldDefinitions(); // 定義取得を開始（待機はしない）

  // イベント登録（即時実行）
  kintone.events.on(['app.record.create.show', 'app.record.edit.show', 'app.record.index.edit.show'], (e) => {
    // 編集画面表示時は、定義取得を待たずにとにかくロックをかける（設定値ベースで動作するため定義不要）
    lockDestFields(e.record);
    return e;
  });

  let cEvents = [];
  settings.forEach(s => {
    cEvents.push(`app.record.create.change.${s.tableCode}`, `app.record.edit.change.${s.tableCode}`);
    s.mappings.forEach(m => { cEvents.push(`app.record.create.change.${m.src}`, `app.record.edit.change.${m.src}`); });
  });

  // 変更時・保存時イベント
  kintone.events.on(cEvents, (e) => { syncLastRow(e.record); return e; });
  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit', 'app.record.index.edit.submit'], (e) => { syncLastRow(e.record); return e; });

  // 一括更新ボタン
  kintone.events.on('app.record.index.show', (event) => {
    if (conf.showBulk !== 'true' || document.getElementById('bulk-sync-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'bulk-sync-btn';
    btn.textContent = 'サブテーブル最下行を一括反映';
    btn.className = 'kintoneplugin-button-dialog-ok';
    btn.style.cssText = 'margin-left:15px; border-radius:4px; height:48px; padding:0 32px; background-color:#3498db; color:#fff; font-weight:bold; border:none; cursor:pointer; font-size:14px; box-sizing:border-box;';
    btn.onmouseover = () => { btn.style.backgroundColor = '#2980b9'; };
    btn.onmouseout = () => { btn.style.backgroundColor = '#3498db'; };

    btn.onclick = async () => {
      if (!confirm('絞り込み中の全レコードを一括更新しますか？')) return;
      showProgressModal();
      
      // 一括更新時は定義が必要なので、ここで確実に待つ
      if (Object.keys(fieldDefs).length === 0) {
         try {
            const resp = await kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: kintone.app.getId() });
            fieldDefs = resp.properties;
         } catch(e) {
            closeProgressModal();
            alert('フィールド情報の取得に失敗しました');
            return;
         }
      }

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

      if (allRecords.length === 0) { closeProgressModal(); return alert('更新対象なし'); }

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