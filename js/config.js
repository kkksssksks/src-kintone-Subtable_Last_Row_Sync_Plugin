(function(PLUGIN_ID) {
  'use strict';

  // HTMLのIDと完全に一致させて取得
  const container = document.getElementById('table-settings-container');
  const addTableBtn = document.getElementById('add-table-btn');
  const saveBtn = document.getElementById('save-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const bulkCheck = document.getElementById('show-bulk-button');

  let subTableFields = [];
  let allFields = [];

  // アプリのフィールド情報を取得
  const fetchFields = async () => {
    try {
      const resp = await kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: kintone.app.getId() });
      allFields = resp.properties;
      subTableFields = Object.values(resp.properties).filter(f => f.type === 'SUBTABLE');
    } catch (err) {
      alert('フィールド情報の取得に失敗しました。');
      console.error(err);
    }
  };

  // ドロップダウンの選択肢を動的に更新（重複選択防止）
  const updateTableDropdowns = () => {
    const selects = document.querySelectorAll('.js-table-code');
    const selectedValues = Array.from(selects).map(s => s.value).filter(v => v);

    selects.forEach(select => {
      const currentVal = select.value;
      // 選択肢をリセット
      select.innerHTML = '<option value="">-- 選択してください --</option>';

      subTableFields.forEach(f => {
        // 自分が選択中の値、または他で選択されていない値のみ表示
        if (f.code === currentVal || !selectedValues.includes(f.code)) {
          const option = document.createElement('option');
          option.value = f.code;
          option.textContent = `${f.label} (${f.code})`;
          select.appendChild(option);
        }
      });
      // 値を復元
      select.value = currentVal;
    });
  };

  // マッピング行（コピー元→コピー先）の作成
  const createMappingRow = (parentContainer, tableCode, data) => {
    const tableField = subTableFields.find(f => f.code === tableCode);
    if (!tableField) return;

    const row = document.createElement('div');
    row.className = 'child-row';

    // コピー元セレクト
    const srcSelect = document.createElement('select');
    srcSelect.className = 'kintoneplugin-select js-src-field';
    srcSelect.innerHTML = '<option value="">-- コピー元 --</option>';
    Object.values(tableField.fields).forEach(f => {
      if (!['SUBTABLE', 'GROUP', 'REFERENCE_TABLE'].includes(f.type)) {
        const opt = document.createElement('option');
        opt.value = f.code;
        opt.textContent = `${f.label} (${f.code})`;
        srcSelect.appendChild(opt);
      }
    });

    // 矢印
    const arrow = document.createElement('span');
    arrow.textContent = '→';

    // コピー先セレクト
    const destSelect = document.createElement('select');
    destSelect.className = 'kintoneplugin-select js-dest-field';
    destSelect.innerHTML = '<option value="">-- コピー先 --</option>';
    Object.values(allFields).forEach(f => {
      if (!['SUBTABLE', 'GROUP', 'CALC', 'REFERENCE_TABLE'].includes(f.type)) {
        const opt = document.createElement('option');
        opt.value = f.code;
        opt.textContent = `${f.label} (${f.code})`;
        destSelect.appendChild(opt);
      }
    });

    // 削除ボタン
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => {
      parentContainer.removeChild(row);
    };

    if (data) {
      srcSelect.value = data.src;
      destSelect.value = data.dest;
    }

    row.appendChild(srcSelect);
    row.appendChild(arrow);
    row.appendChild(destSelect);
    row.appendChild(removeBtn);
    parentContainer.appendChild(row);
  };

  // テーブル設定カードの作成
  const createTableSettingRow = (data) => {
    const card = document.createElement('div');
    card.className = 'parent-row';

    // ヘッダー部分
    const header = document.createElement('div');
    header.className = 'parent-header';
    header.innerHTML = '<span>対象テーブル:</span>';

    const tableSelect = document.createElement('select');
    tableSelect.className = 'kintoneplugin-select js-table-code';
    header.appendChild(tableSelect);

    const removeTableBtn = document.createElement('button');
    removeTableBtn.type = 'button';
    removeTableBtn.className = 'modern-btn btn-remove-table';
    removeTableBtn.textContent = '設定を削除';
    removeTableBtn.onclick = () => {
      container.removeChild(card);
      updateTableDropdowns();
    };
    header.appendChild(removeTableBtn);

    // マッピングエリア
    const mappingContainer = document.createElement('div');
    mappingContainer.className = 'child-container';

    // マッピング追加ボタン
    const addMappingBtn = document.createElement('button');
    addMappingBtn.type = 'button';
    addMappingBtn.className = 'add-mapping-btn';
    addMappingBtn.textContent = '＋ フィールドペアを追加';
    addMappingBtn.onclick = () => {
      if (!tableSelect.value) return alert('先にテーブルを選択してください');
      createMappingRow(mappingContainer, tableSelect.value);
    };

    // イベントリスナー
    tableSelect.onchange = () => {
      mappingContainer.innerHTML = ''; // テーブル変更でマッピングリセット
      updateTableDropdowns();
    };

    card.appendChild(header);
    card.appendChild(mappingContainer);
    card.appendChild(addMappingBtn);
    container.appendChild(card);

    // 初期データ反映
    if (data) {
      // 選択肢更新後に値をセットするために、まずは全選択肢を入れる
      updateTableDropdowns();
      tableSelect.value = data.tableCode;
      
      // データがある場合のみマッピング生成
      if (data.mappings) {
        data.mappings.forEach(m => createMappingRow(mappingContainer, data.tableCode, m));
      }
    } else {
      updateTableDropdowns();
    }
  };

  // 初期化処理
  fetchFields().then(() => {
    const config = kintone.plugin.app.getConfig(PLUGIN_ID);
    if (config.settings) {
      const settings = JSON.parse(config.settings);
      settings.forEach(s => createTableSettingRow(s));
    }
    if (config.showBulk === 'true') {
      if(bulkCheck) bulkCheck.checked = true;
    }

    // ボタン有効化
    if(addTableBtn) addTableBtn.onclick = () => createTableSettingRow();
  });

  // 保存処理
  if(saveBtn) {
    saveBtn.onclick = () => {
      const settings = [];
      const rows = container.querySelectorAll('.parent-row');
      let isValid = true;

      rows.forEach(row => {
        const tableCode = row.querySelector('.js-table-code').value;
        if (!tableCode) return;

        const mappings = [];
        const mapRows = row.querySelectorAll('.child-row');
        mapRows.forEach(mr => {
          const src = mr.querySelector('.js-src-field').value;
          const dest = mr.querySelector('.js-dest-field').value;
          if (src && dest) mappings.push({ src, dest });
        });

        if (mappings.length === 0) {
          alert('設定したテーブルには最低1つのフィールドペアが必要です。');
          isValid = false;
          return;
        }
        settings.push({ tableCode, mappings });
      });

      if (!isValid) return;

      const configData = {
        settings: JSON.stringify(settings),
        showBulk: (bulkCheck && bulkCheck.checked) ? 'true' : 'false'
      };

      kintone.plugin.app.setConfig(configData, () => {
        alert('設定を保存しました。');
        window.location.href = '../../' + kintone.app.getId() + '/config/';
      });
    };
  }

  // キャンセル処理
  if(cancelBtn) {
    cancelBtn.onclick = () => {
      window.location.href = '../../' + kintone.app.getId() + '/config/';
    };
  }

})(kintone.$PLUGIN_ID);