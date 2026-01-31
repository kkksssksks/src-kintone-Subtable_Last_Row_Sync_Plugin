(function(PLUGIN_ID) {
  'use strict';

  const conf = kintone.plugin.app.getConfig(PLUGIN_ID);
  if (!conf.settings) return;
  const settings = JSON.parse(conf.settings);

  // --- 多言語対応 (i18n) ---
  const resources = {
    ja: {
      modal_title: '一括更新中 (Ver 1.2)',
      status_prepare: '準備中...',
      status_progress: '{current} / {total} 件 完了',
      status_error: 'エラースキップ: {count} 件',
      btn_bulk: 'サブテーブル最下行を一括反映',
      btn_close: '閉じる',
      confirm_run: '絞り込み中の全レコードを一括更新しますか？',
      alert_no_target: '更新対象のレコードがありません。',
      alert_complete: '一括更新が完了しました！',
      err_fetch: 'フィールド情報の取得に失敗しました',
      err_get_record: 'レコード取得失敗: '
    },
    en: {
      modal_title: 'Bulk Update (Ver 1.2)',
      status_prepare: 'Preparing...',
      status_progress: '{current} / {total} Completed',
      status_error: 'Skipped Errors: {count}',
      btn_bulk: 'Sync Last Row (Bulk)',
      btn_close: 'Close',
      confirm_run: 'Update all filtered records?',
      alert_no_target: 'No records to update.',
      alert_complete: 'Bulk update completed!',
      err_fetch: 'Failed to fetch field info.',
      err_get_record: 'Failed to get records: '
    }
  };
  const lang = kintone.getLoginUser().language === 'ja' ? 'ja' : 'en';
  const i18n = resources[lang];

  let fieldDefs = {};
  let lastExecTime = 0;

  // モバイル・デスクトップ共通でアプリIDを取得
  const getAppId = () => {
    return (kintone.mobile && kintone.mobile.app.getId()) || kintone.app.getId();
  };

  const fetchFieldDefinitions = async () => {
    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: getAppId() });
      fieldDefs = resp.properties;
    } catch (err) { console.error(i18n.err_fetch, err); }
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
    
    settings.forEach(s => {
      const tableField = record[s.tableCode];
      if (!tableField) return;
      const isTableEmpty = !tableField.value || tableField.value.length === 0;
      const lastRow = !isTableEmpty ? tableField.value[tableField.value.length - 1].value : null;

      s.mappings.forEach(m => {
        if (!record[m.dest]) return;
        const destDef = fieldDefs[m.dest];
        if (!destDef) return;

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

  // --- Progress Modal with Detailed Error Log ---
  const showProgressModal = () => {
    const overlay = document.createElement('div');
    overlay.id = 'plugin-progress-modal';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:10000; display:flex; justify-content:center; align-items:center;';

    const container = document.createElement('div');
    container.style.cssText = 'background:#fff; padding:30px; border-radius:8px; text-align:center; min-width:450px; max-width:90%; box-shadow:0 10px 25px rgba(0,0,0,0.2);';

    const title = document.createElement('h3');
    title.style.cssText = 'margin:0 0 10px; color:#2c3e50;';
    title.textContent = i18n.modal_title;
    
    const statusText = document.createElement('p');
    statusText.id = 'plugin-progress-text';
    statusText.style.cssText = 'color:#7f8c8d; font-size:14px; margin-bottom:5px;';
    statusText.textContent = i18n.status_prepare;

    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'width:100%; background:#ecf0f1; height:10px; border-radius:5px; overflow:hidden; margin-bottom:15px;';
    
    const bar = document.createElement('div');
    bar.id = 'plugin-progress-bar';
    bar.style.cssText = 'width:0%; height:100%; background:#3498db; transition:width 0.3s;';
    barWrap.appendChild(bar);

    // エラー詳細表示エリア
    const errorLogArea = document.createElement('div');
    errorLogArea.id = 'plugin-error-log';
    errorLogArea.style.cssText = 'display:none; text-align:left; background:#fdf0f0; border:1px solid #e74c3c; padding:10px; height:100px; overflow-y:auto; font-size:12px; color:#c0392b; margin-bottom:10px; border-radius:4px;';

    const errorCountText = document.createElement('p');
    errorCountText.id = 'plugin-error-count';
    errorCountText.style.cssText = 'color:#e74c3c; font-size:12px; margin-top:0; display:none; font-weight:bold;';
    errorCountText.textContent = i18n.status_error.replace('{count}', '0');

    // 閉じるボタン（完了時用）
    const closeBtn = document.createElement('button');
    closeBtn.id = 'plugin-modal-close';
    closeBtn.textContent = i18n.btn_close;
    closeBtn.style.cssText = 'display:none; margin:0 auto; padding:8px 20px; background:#95a5a6; color:white; border:none; border-radius:4px; cursor:pointer;';
    closeBtn.onclick = closeProgressModal;

    container.append(title, statusText, barWrap, errorCountText, errorLogArea, closeBtn);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
  };

  const addErrorLog = (recordId, message) => {
    const area = document.getElementById('plugin-error-log');
    if(area) {
      area.style.display = 'block';
      const line = document.createElement('div');
      line.textContent = `Record ID ${recordId}: ${message}`;
      line.style.borderBottom = '1px solid #ecc';
      line.style.padding = '2px 0';
      area.appendChild(line);
    }
  };

  const updateProgress = (current, total, errorCount) => {
    const text = document.getElementById('plugin-progress-text');
    const bar = document.getElementById('plugin-progress-bar');
    const errText = document.getElementById('plugin-error-count');
    
    if (text) text.textContent = i18n.status_progress.replace('{current}', current).replace('{total}', total);
    if (bar) bar.style.width = `${(current / total) * 100}%`;
    if (errorCount > 0 && errText) {
      errText.style.display = 'block';
      errText.textContent = i18n.status_error.replace('{count}', errorCount);
    }
  };

  const finishProgress = () => {
    const closeBtn = document.getElementById('plugin-modal-close');
    if(closeBtn) closeBtn.style.display = 'block';
    alert(i18n.alert_complete);
  };

  const closeProgressModal = () => {
    const el = document.getElementById('plugin-progress-modal');
    if (el) document.body.removeChild(el);
    location.reload();
  };

  fetchFieldDefinitions();

  // --- イベント登録 (デスクトップ & モバイル両対応) ---
  const eventsShow = [
    'app.record.create.show', 'app.record.edit.show', 'app.record.index.edit.show',
    'mobile.app.record.create.show', 'mobile.app.record.edit.show'
  ];
  
  kintone.events.on(eventsShow, (e) => {
    // 編集画面表示時は設定値ベースで即座にロック
    lockDestFields(e.record);
    return e;
  });

  let cEvents = [];
  settings.forEach(s => {
    // デスクトップ用
    cEvents.push(`app.record.create.change.${s.tableCode}`, `app.record.edit.change.${s.tableCode}`);
    s.mappings.forEach(m => cEvents.push(`app.record.create.change.${m.src}`, `app.record.edit.change.${m.src}`));
    // モバイル用
    cEvents.push(`mobile.app.record.create.change.${s.tableCode}`, `mobile.app.record.edit.change.${s.tableCode}`);
    s.mappings.forEach(m => cEvents.push(`mobile.app.record.create.change.${m.src}`, `mobile.app.record.edit.change.${m.src}`));
  });

  const eventsSubmit = [
    'app.record.create.submit', 'app.record.edit.submit', 'app.record.index.edit.submit',
    'mobile.app.record.create.submit', 'mobile.app.record.edit.submit'
  ];

  kintone.events.on([...cEvents, ...eventsSubmit], (e) => { syncLastRow(e.record); return e; });

  // --- 一括更新 (デスクトップ版のみ) ---
  kintone.events.on('app.record.index.show', (event) => {
    if (conf.showBulk !== 'true' || document.getElementById('bulk-sync-btn')) return;
    
    // ヘッダーメニューがない場合（モバイル等）はスキップ
    const space = kintone.app.getHeaderMenuSpaceElement();
    if (!space) return;

    const btn = document.createElement('button');
    btn.id = 'bulk-sync-btn';
    btn.textContent = i18n.btn_bulk;
    btn.className = 'kintoneplugin-button-dialog-ok';
    btn.style.cssText = 'margin-left:15px; border-radius:4px; height:48px; padding:0 32px; background-color:#3498db; color:#fff; font-weight:bold; border:none; cursor:pointer; font-size:14px; box-sizing:border-box;';
    btn.onmouseover = () => { btn.style.backgroundColor = '#2980b9'; };
    btn.onmouseout = () => { btn.style.backgroundColor = '#3498db'; };

    btn.onclick = async () => {
      if (!confirm(i18n.confirm_run)) return;
      showProgressModal();
      
      if (Object.keys(fieldDefs).length === 0) {
         try {
            const resp = await kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: getAppId() });
            fieldDefs = resp.properties;
         } catch(e) {
            closeProgressModal();
            alert(i18n.err_fetch);
            return;
         }
      }

      const appId = getAppId();
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
      } catch(e) { closeProgressModal(); return alert(i18n.err_get_record + e.message); }

      if (allRecords.length === 0) { closeProgressModal(); return alert(i18n.alert_no_target); }

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
          // エラー時: 1件ずつリトライしてエラー箇所を特定
          for (const singleRec of safeChunk) {
            try {
              await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { app: appId, ...singleRec });
              processedCount++;
            } catch (singleErr) { 
              errorCount++; 
              processedCount++; 
              // 画面にログ出力
              addErrorLog(singleRec.id, singleErr.message || JSON.stringify(singleErr));
            }
            updateProgress(processedCount, allRecords.length, errorCount);
          }
        }
        updateProgress(processedCount, allRecords.length, errorCount);
      }
      finishProgress();
    };
    space.appendChild(btn);
  });
})(kintone.$PLUGIN_ID);