(function(PLUGIN_ID) {
  'use strict';

  // --- 言語リソース (i18n) ---
  const resources = {
    ja: {
      settings_title: 'サブテーブル転記設定',
      settings_desc: '各サブテーブルの最下行を特定のフィールドに同期する設定を行います。※コピー元とコピー先は、互換性のあるフィールドカテゴリーのみ選択可能です。',
      btn_add_table: '＋ テーブル設定を追加',
      label_bulk_button: '一覧画面に「一括更新ボタン」を表示する',
      btn_save: '設定を保存する',
      btn_cancel: 'キャンセル',
      manual_title: 'プラグインの仕様・使いかたを確認する',
      manual_content_html: `
        <h3>1. 基本的な使いかた</h3>
        <ul><li><strong>設定:</strong> 対象の「サブテーブル」を選び、最下行の値を同期するフィールドペアを設定します。</li><li><strong>反映時期:</strong> サブテーブル入力時（リアルタイム）およびレコード保存時に転記されます。</li></ul>
        <h3>2. 重要な仕様</h3>
        <ul><li><strong>フィールドロック:</strong> データ整合性を保つため、コピー先に指定したフィールドは画面上で編集不可になります。</li><li><strong>型の互換性:</strong> コピー先が「文字列（1行）」であれば、どの型のフィールドからでも転記できます。</li></ul>
        <h3>3. 非対応フィールド</h3>
        <ul><li>添付ファイル、計算、ルックアップフィールドはコピー先に指定できません。</li></ul>`,
      
      // Dynamic JS texts
      alert_field_fetch_error: 'フィールド情報の取得に失敗しました。',
      placeholder_select: '-- 選択してください --',
      placeholder_src: '-- コピー元 --',
      placeholder_dest: '-- コピー先 --',
      label_target_table: '対象テーブル:',
      btn_remove_setting: '設定を削除',
      btn_add_pair: '＋ フィールドペアを追加',
      alert_select_table_first: '先にテーブルを選択してください',
      alert_min_one_pair: '設定したテーブルには最低1つのフィールドペアが必要です。',
      alert_save_success: '設定を保存しました。'
    },
    en: {
      settings_title: 'Subtable Last Row Sync Settings',
      settings_desc: 'Configure settings to sync the last row of a subtable to specific fields. *Only compatible field categories can be selected.',
      btn_add_table: '＋ Add Table Setting',
      label_bulk_button: 'Show "Bulk Update" button on Index View',
      btn_save: 'Save Settings',
      btn_cancel: 'Cancel',
      manual_title: 'Check Usage & Specifications',
      manual_content_html: `
        <h3>1. Basic Usage</h3>
        <ul><li><strong>Setup:</strong> Select a subtable and map the fields you want to sync from the last row.</li><li><strong>Timing:</strong> Syncs occur in real-time during input and upon record save.</li></ul>
        <h3>2. Key Specifications</h3>
        <ul><li><strong>Field Lock:</strong> Destination fields are automatically disabled to ensure data integrity.</li><li><strong>Compatibility:</strong> "Text (single-line)" fields can accept data from any source type.</li></ul>
        <h3>3. Unsupported Fields</h3>
        <ul><li>Attachment, Calculated, and Lookup fields cannot be used as destinations.</li></ul>`,

      // Dynamic JS texts
      alert_field_fetch_error: 'Failed to fetch field information.',
      placeholder_select: '-- Select --',
      placeholder_src: '-- Source --',
      placeholder_dest: '-- Destination --',
      label_target_table: 'Target Table:',
      btn_remove_setting: 'Remove',
      btn_add_pair: '＋ Add Field Pair',
      alert_select_table_first: 'Please select a table first.',
      alert_min_one_pair: 'At least one field pair is required per table.',
      alert_save_success: 'Settings saved successfully.'
    }
  };

  // ユーザー言語の判定
  const lang = kintone.getLoginUser().language === 'ja' ? 'ja' : 'en';
  const i18n = resources[lang];

  // 要素の取得
  const container = document.getElementById('table-settings-container');
  const addTableBtn = document.getElementById('add-table-btn');
  const saveBtn = document.getElementById('save-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const bulkCheck = document.getElementById('show-bulk-button');

  // --- 初期化: 静的テキストの流し込み ---
  const applyTranslation = () => {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (i18n[key]) {
        if (key.endsWith('_html')) el.innerHTML = i18n[key];
        else el.textContent = i18n[key];
      }
    });
  };
  applyTranslation();

  let subTableFields = [];
  let allFields = [];
  
  // ドラッグ中の要素を保持
  let dragSrcEl = null;

  const fetchFields = async () => {
    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: kintone.app.getId() });
      allFields = resp.properties;
      subTableFields = Object.values(resp.properties).filter(f => f.type === 'SUBTABLE');
    } catch (err) {
      alert(i18n.alert_field_fetch_error);
      console.error(err);
    }
  };

  const createOption = (value, text) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    return opt;
  };

  const updateDestDropdowns = () => {
    const selects = document.querySelectorAll('.js-dest-field');
    const allSelectedValues = Array.from(selects).map(s => s.value).filter(v => v);

    selects.forEach(select => {
      const currentVal = select.value;
      while (select.firstChild) select.removeChild(select.firstChild);
      select.appendChild(createOption('', i18n.placeholder_dest));

      Object.values(allFields).forEach(f => {
        if (!['SUBTABLE', 'GROUP', 'CALC', 'REFERENCE_TABLE'].includes(f.type)) {
          if (f.code === currentVal || !allSelectedValues.includes(f.code)) {
            select.appendChild(createOption(f.code, `${f.label} (${f.code})`));
          }
        }
      });
      select.value = currentVal;
    });
  };

  const updateTableDropdowns = () => {
    const selects = document.querySelectorAll('.js-table-code');
    const selectedValues = Array.from(selects).map(s => s.value).filter(v => v);

    selects.forEach(select => {
      const currentVal = select.value;
      while (select.firstChild) select.removeChild(select.firstChild);
      select.appendChild(createOption('', i18n.placeholder_select));

      subTableFields.forEach(f => {
        if (f.code === currentVal || !selectedValues.includes(f.code)) {
          select.appendChild(createOption(f.code, `${f.label} (${f.code})`));
        }
      });
      select.value = currentVal;
    });
  };

  const createMappingRow = (parentContainer, tableCode, data) => {
    const tableField = subTableFields.find(f => f.code === tableCode);
    if (!tableField) return;

    const row = document.createElement('div');
    row.className = 'child-row';
    // 行自体をドラッグ可能にする
    row.draggable = true;

    // --- ドラッグイベントの実装 ---
    row.addEventListener('dragstart', function(e) {
      dragSrcEl = this;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/html', this.innerHTML);
      this.classList.add('dragging');
    });

    row.addEventListener('dragover', function(e) {
      if (e.preventDefault) e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // 同じコンテナ内のみ移動可能
      if (dragSrcEl !== this && dragSrcEl.parentNode === this.parentNode) {
        // マウス位置が要素の半分より後ろなら、その後に挿入
        const rect = this.getBoundingClientRect();
        const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
        this.parentNode.insertBefore(dragSrcEl, next ? this.nextSibling : this);
      }
      return false;
    });

    row.addEventListener('dragend', function() {
      this.classList.remove('dragging');
      dragSrcEl = null;
      // 並び替え後にドロップダウンの整合性をチェック（念のため）
      updateDestDropdowns();
    });
    // --------------------------------

    // ドラッグハンドル（つまみ）
    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.title = 'Drag to reorder';

    const srcSelect = document.createElement('select');
    srcSelect.className = 'kintoneplugin-select js-src-field';
    srcSelect.appendChild(createOption('', i18n.placeholder_src));
    Object.values(tableField.fields).forEach(f => {
      if (!['SUBTABLE', 'GROUP', 'REFERENCE_TABLE'].includes(f.type)) {
        srcSelect.appendChild(createOption(f.code, `${f.label} (${f.code})`));
      }
    });

    const arrow = document.createElement('span');
    arrow.textContent = '→';

    const destSelect = document.createElement('select');
    destSelect.className = 'kintoneplugin-select js-dest-field';
    destSelect.appendChild(createOption('', i18n.placeholder_dest));
    destSelect.onchange = () => updateDestDropdowns();

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => {
      parentContainer.removeChild(row);
      updateDestDropdowns();
    };

    // 要素を追加（ハンドルを先頭に）
    row.append(dragHandle, srcSelect, arrow, destSelect, removeBtn);
    parentContainer.appendChild(row);
    updateDestDropdowns();

    if (data) {
      srcSelect.value = data.src;
      destSelect.value = data.dest;
      updateDestDropdowns();
    }
  };

  const createTableSettingRow = (data) => {
    const card = document.createElement('div');
    card.className = 'parent-row';

    const header = document.createElement('div');
    header.className = 'parent-header';
    
    const label = document.createElement('span');
    label.textContent = i18n.label_target_table;
    header.appendChild(label);

    const tableSelect = document.createElement('select');
    tableSelect.className = 'kintoneplugin-select js-table-code';
    header.appendChild(tableSelect);

    const removeTableBtn = document.createElement('button');
    removeTableBtn.type = 'button';
    removeTableBtn.className = 'modern-btn btn-remove-table';
    removeTableBtn.textContent = i18n.btn_remove_setting;
    removeTableBtn.onclick = () => {
      container.removeChild(card);
      updateTableDropdowns();
      updateDestDropdowns();
    };
    header.appendChild(removeTableBtn);

    const mappingContainer = document.createElement('div');
    mappingContainer.className = 'child-container';

    const addMappingBtn = document.createElement('button');
    addMappingBtn.type = 'button';
    addMappingBtn.className = 'add-mapping-btn';
    addMappingBtn.textContent = i18n.btn_add_pair;
    addMappingBtn.onclick = () => {
      if (!tableSelect.value) return alert(i18n.alert_select_table_first);
      createMappingRow(mappingContainer, tableSelect.value);
    };

    tableSelect.onchange = () => {
      while (mappingContainer.firstChild) mappingContainer.removeChild(mappingContainer.firstChild);
      updateTableDropdowns();
      updateDestDropdowns();
    };

    card.append(header, mappingContainer, addMappingBtn);
    container.appendChild(card);

    if (data) {
      updateTableDropdowns();
      tableSelect.value = data.tableCode;
      if (data.mappings) data.mappings.forEach(m => createMappingRow(mappingContainer, data.tableCode, m));
    } else {
      updateTableDropdowns();
    }
  };

  fetchFields().then(() => {
    const config = kintone.plugin.app.getConfig(PLUGIN_ID);
    if (config.settings) {
      JSON.parse(config.settings).forEach(s => createTableSettingRow(s));
      
      // 全行読み込み完了後に選択肢を再計算（初期表示バグ修正）
      updateTableDropdowns();
      updateDestDropdowns();
    }
    if (config.showBulk === 'true' && bulkCheck) bulkCheck.checked = true;
    if(addTableBtn) addTableBtn.onclick = () => createTableSettingRow();
  });

  if(saveBtn) {
    saveBtn.onclick = () => {
      const settings = [];
      const rows = container.querySelectorAll('.parent-row');
      let isValid = true;

      rows.forEach(row => {
        const tableCode = row.querySelector('.js-table-code').value;
        if (!tableCode) return;
        const mappings = [];
        // DOMの並び順通りに取得されるので、ドラッグ＆ドロップの結果が反映される
        row.querySelectorAll('.child-row').forEach(mr => {
          const src = mr.querySelector('.js-src-field').value;
          const dest = mr.querySelector('.js-dest-field').value;
          if (src && dest) mappings.push({ src, dest });
        });

        if (mappings.length === 0) {
          alert(i18n.alert_min_one_pair);
          isValid = false;
          return;
        }
        settings.push({ tableCode, mappings });
      });

      if (!isValid) return;

      kintone.plugin.app.setConfig({
        settings: JSON.stringify(settings),
        showBulk: (bulkCheck && bulkCheck.checked) ? 'true' : 'false'
      }, () => {
        alert(i18n.alert_save_success);
        window.location.href = '/k/admin/app/' + kintone.app.getId() + '/plugin/#/';
      });
    };
  }

  if(cancelBtn) {
    cancelBtn.onclick = () => {
      window.location.href = '/k/admin/app/' + kintone.app.getId() + '/plugin/#/';
    };
  }

})(kintone.$PLUGIN_ID);