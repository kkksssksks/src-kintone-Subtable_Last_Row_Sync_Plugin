(function(PLUGIN_ID) {
  'use strict';

  const conf = kintone.plugin.app.getConfig(PLUGIN_ID);
  if (!conf.settings) return;
  const settings = JSON.parse(conf.settings);

  // --- 多言語対応 (i18n) ---
  const resources = {
    ja: {
      modal_title: '一括更新中...',
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
      modal_title: 'Bulk Update...',
      status_prepare: 'Preparing...',
      status_progress: '{current} / {total} Completed',
      status_error: 'Skipped Errors: {count}',
      btn_bulk: 'Sync Last Row (Bulk)',
      btn_close: 'Close',
      confirm_run: 'Update all filtered records?',
      alert_no_target: 'No records to update.',
      alert_complete: 'Bulk update completed!\n\nPress OK to reload the page.',
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
    // v1.2.1: 計算フィールドのエラー値(#N/A!)を空文字として扱う
    if (val === undefined || val === null || val === "" || val === "#N/A!") return "";
    
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

    // v1.2.1: 計算フィールドのエラー値(#N/A!)を空として扱う
    const isEmpty = srcVal === null || srcVal === undefined || srcVal === "" || srcVal === "#N/A!" || (Array.isArray(srcVal) && srcVal.length === 0);
    
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

  // --- Progress Modal with Detailed Error Log (信頼性向上版) ---
  
  // モーダル要素への直接参照を保持（グローバルスコープ）
  let modalElements = {
    overlay: null,
    progressText: null,
    progressBar: null,
    errorLog: null,
    errorCount: null,
    closeBtn: null
  };

  /**
   * モーダルを表示し、要素への参照を保持
   * @returns {Promise<void>}
   */
  const showProgressModal = () => {
    console.log('[Plugin] showProgressModal called');
    return new Promise((resolve) => {
      // 既存のモーダルがあれば削除
      if (modalElements.overlay && modalElements.overlay.parentNode) {
        console.log('[Plugin] Removing existing modal');
        modalElements.overlay.parentNode.removeChild(modalElements.overlay);
      }

      const overlay = document.createElement('div');
      overlay.id = 'plugin-progress-modal';
      // z-indexを極端に大きくして確実に最前面に
      overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:2147483647; display:flex; justify-content:center; align-items:center;';

      const container = document.createElement('div');
      container.style.cssText = 'background:#fff; padding:30px; border-radius:8px; text-align:center; min-width:450px; max-width:90%; box-shadow:0 10px 25px rgba(0,0,0,0.2);';

      const title = document.createElement('h3');
      title.style.cssText = 'margin:0 0 10px; color:#2c3e50;';
      title.textContent = i18n.modal_title;
      
      const statusText = document.createElement('p');
      statusText.style.cssText = 'color:#7f8c8d; font-size:14px; margin-bottom:5px; min-height:20px;';
      statusText.textContent = i18n.status_prepare;

      const barWrap = document.createElement('div');
      barWrap.style.cssText = 'width:100%; background:#ecf0f1; height:10px; border-radius:5px; overflow:hidden; margin-bottom:15px;';
      
      const bar = document.createElement('div');
      // 初期状態で0%を明示的に設定
      bar.style.cssText = 'width:0%; height:100%; background:#3498db; transition:width 0.3s ease;';
      barWrap.appendChild(bar);

      // エラー詳細表示エリア
      const errorLogArea = document.createElement('div');
      errorLogArea.style.cssText = 'display:none; text-align:left; background:#fdf0f0; border:1px solid #e74c3c; padding:10px; height:100px; overflow-y:auto; font-size:12px; color:#c0392b; margin-bottom:10px; border-radius:4px;';

      const errorCountText = document.createElement('p');
      errorCountText.style.cssText = 'color:#e74c3c; font-size:12px; margin-top:0; display:none; font-weight:bold;';
      errorCountText.textContent = i18n.status_error.replace('{count}', '0');

      // 閉じるボタン（完了時用）
      const closeBtn = document.createElement('button');
      closeBtn.textContent = i18n.btn_close;
      closeBtn.style.cssText = 'display:none; margin:0 auto; padding:8px 20px; background:#95a5a6; color:white; border:none; border-radius:4px; cursor:pointer;';
      closeBtn.onclick = closeProgressModal;

      container.appendChild(title);
      container.appendChild(statusText);
      container.appendChild(barWrap);
      container.appendChild(errorCountText);
      container.appendChild(errorLogArea);
      container.appendChild(closeBtn);
      overlay.appendChild(container);
      document.body.appendChild(overlay);
      
      // グローバル変数に要素への参照を保存
      modalElements = {
        overlay: overlay,
        progressText: statusText,
        progressBar: bar,
        errorLog: errorLogArea,
        errorCount: errorCountText,
        closeBtn: closeBtn
      };
      
      console.log('[Plugin] Modal DOM appended to body, references saved');
      
      // 強制的に再描画を促す（ブラウザによっては必要）
      overlay.offsetHeight; // リフロー強制
      bar.offsetWidth; // リフロー強制

      // レンダリング完了まで待機時間を増やす（300ms）
      setTimeout(() => {
        console.log('[Plugin] Modal should be visible now');
        // 初期進捗を0%で明示的に表示
        if (modalElements.progressBar) {
          modalElements.progressBar.style.width = '0%';
        }
        resolve();
      }, 300);
    });
  };

  /**
   * エラーログをモーダルに追加
   */
  const addErrorLog = (recordId, message) => {
    if (!modalElements.errorLog) {
      console.error('[Plugin] Error log area reference not available');
      return;
    }
    
    modalElements.errorLog.style.display = 'block';
    const line = document.createElement('div');
    line.textContent = `Record ID ${recordId}: ${message}`;
    line.style.borderBottom = '1px solid #ecc';
    line.style.padding = '2px 0';
    modalElements.errorLog.appendChild(line);
  };

  /**
   * 進捗バーを更新（直接参照を使用）
   */
  const updateProgress = (current, total, errorCount) => {
    return new Promise((resolve) => {
      if (!modalElements.progressText || !modalElements.progressBar) {
        console.error('[Plugin] Progress elements reference not available');
        setTimeout(resolve, 10);
        return;
      }

      console.log(`[Plugin] Updating progress: ${current}/${total}, errors: ${errorCount}`);
      
      const percentage = Math.round((current / total) * 100);
      
      modalElements.progressText.textContent = i18n.status_progress.replace('{current}', current).replace('{total}', total);
      modalElements.progressBar.style.width = `${percentage}%`;
      
      // 強制的に再描画
      modalElements.progressBar.offsetWidth;
      
      if (errorCount > 0 && modalElements.errorCount) {
        modalElements.errorCount.style.display = 'block';
        modalElements.errorCount.textContent = i18n.status_error.replace('{count}', errorCount);
      }

      // setTimeoutでUIスレッドに処理を譲る（時間を増やす）
      setTimeout(resolve, 100);
    });
  };

  /**
   * 完了ボタンを表示し、アラートを出す（アラートOK後に自動リロード）
   */
  const finishProgress = () => {
    return new Promise((resolve) => {
      if (!modalElements.closeBtn) {
        console.error('[Plugin] Close button reference not available');
        alert(i18n.alert_complete);
        // アラートを閉じたらリロード
        location.reload();
        setTimeout(resolve, 10);
        return;
      }

      console.log('[Plugin] Showing close button');
      modalElements.closeBtn.style.display = 'block';
      
      // ボタン表示を確実にレンダリングしてからアラート
      setTimeout(() => {
        alert(i18n.alert_complete);
        // アラートのOKボタンを押したら自動的にリロード
        location.reload();
        resolve();
      }, 200);
    });
  };

  const closeProgressModal = () => {
    if (modalElements.overlay && modalElements.overlay.parentNode) {
      modalElements.overlay.parentNode.removeChild(modalElements.overlay);
    }
    modalElements = {
      overlay: null,
      progressText: null,
      progressBar: null,
      errorLog: null,
      errorCount: null,
      closeBtn: null
    };
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
      console.log('[Plugin] Bulk update button clicked');
      if (!confirm(i18n.confirm_run)) {
        console.log('[Plugin] User cancelled');
        return;
      }
      
      console.log('[Plugin] Starting bulk update process');
      
      // モーダル表示とDOM構築完了を待つ
      await showProgressModal();
      
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

      // 処理開始前に初期進捗0%を表示
      console.log('[Plugin] Displaying initial progress');
      await updateProgress(0, allRecords.length, 0);

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
      console.log(`[Plugin] Total records to update: ${total}`);
      
      for (let i = 0; i < total; i += 100) {
        const chunk = updatePayloads.slice(i, i + 100);
        const safeChunk = JSON.parse(JSON.stringify(chunk, (k, v) => v === undefined ? null : v));
        
        try {
          await kintone.api(kintone.api.url('/k/v1/records', true), 'PUT', { app: appId, records: safeChunk });
          processedCount += chunk.length;
          console.log(`[Plugin] Batch success: ${processedCount}/${allRecords.length}`);
        } catch (bulkErr) {
          console.log('[Plugin] Batch error, retrying individually');
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
              console.error(`[Plugin] Error at record ${singleRec.id}:`, singleErr);
            }
            
            // 10件ごとに進捗更新（UIを確実に更新するため）
            if (processedCount % 10 === 0) {
              await updateProgress(processedCount, allRecords.length, errorCount);
            }
          }
        }
        
        // チャンクごとに必ず進捗更新
        await updateProgress(processedCount, allRecords.length, errorCount);
      }
      
      // 最終的な進捗を確実に表示
      await updateProgress(processedCount, allRecords.length, errorCount);
      console.log('[Plugin] All updates complete');
      
      // 完了処理を確実に実行
      await finishProgress();
    };
    space.appendChild(btn);
  });
})(kintone.$PLUGIN_ID);