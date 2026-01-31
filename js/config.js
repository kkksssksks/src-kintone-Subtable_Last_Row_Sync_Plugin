(function(PLUGIN_ID) {
  'use strict';

  // 要素の取得
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

  // Helper: オプション要素作成
  const createOption = (value, text) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    return opt;
  };

  // コピー先フィールドのドロップダウンを動的に更新（重複選択防止）
  const updateDestDropdowns = () => {
    // 全てのコピー先セレクトボックスを取得
    const selects = document.querySelectorAll('.js-dest-field');
    // 現在選択されている値を収集（自分自身は除くため、ループ内で処理）
    const allSelectedValues = Array.from(selects).map(s => s.value).filter(v => v);

    selects.forEach(select => {
      const currentVal = select.value;
      
      // 子要素をクリアして再構築
      while (select.firstChild) select.removeChild(select.firstChild);
      select.appendChild(createOption('', '-- コピー先 --'));

      Object.values(allFields).forEach(f => {
        if (!['SUBTABLE', 'GROUP', 'CALC', 'REFERENCE_TABLE'].includes(f.type)) {
          // 「自分が選択中の値」または「他のどこでも選択されていない値」のみを表示
          // ※ currentVal === f.code を条件に加えることで、選択済みの値が消えるのを防ぐ
          if (f.code === currentVal || !allSelectedValues.includes(f.code)) {
            select.appendChild(createOption(f.code, `${f.label} (${f.code})`));
          }
        }
      });
      select.value = currentVal;
    });
  };

  // 対象テーブルのドロップダウンを動的に更新（重複選択防止）
  const updateTableDropdowns = () => {
    const selects = document.querySelectorAll('.js-table-code');
    const selectedValues = Array.from(selects).map(s => s.value).filter(v => v);

    selects.forEach(select => {
      const currentVal = select.value;
      while (select.firstChild) select.removeChild(select.firstChild);
      select.appendChild(createOption('', '-- 選択してください --'));

      subTableFields.forEach(f => {
        if (f.code === currentVal || !selectedValues.includes(f.code)) {
          select.appendChild(createOption(f.code, `${f.label} (${f.code})`));
        }
      });
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
    srcSelect.appendChild(createOption('', '-- コピー元 --'));
    Object.values(tableField.fields).forEach(f => {
      if (!['SUBTABLE', 'GROUP', 'REFERENCE_TABLE'].includes(f.type)) {
        srcSelect.appendChild(createOption(f.code, `${f.label} (${f.code})`));
      }
    });

    // 矢印
    const arrow = document.createElement('span');
    arrow.textContent = '→';

    // コピー先セレクト（選択肢はupdateDestDropdownsで後から注入・管理される）
    const destSelect = document.createElement('select');
    destSelect.className = 'kintoneplugin-select js-dest-field';
    // 初期表示用に空の選択肢だけ入れておく
    destSelect.appendChild(createOption('', '-- コピー先 --'));
    
    // 変更時に他のセレクトボックスの選択肢を更新
    destSelect.onchange = () => updateDestDropdowns();

    // 削除ボタン
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => {
      parentContainer.removeChild(row);
      updateDestDropdowns(); // 削除された選択肢を解放
    };

    row.appendChild(srcSelect);
    row.appendChild(arrow);
    row.appendChild(destSelect);
    row.appendChild(removeBtn);
    parentContainer.appendChild(row);

    // 行を追加した後、全ドロップダウンを更新して整合性をとる
    updateDestDropdowns();

    // データがある場合は値をセット（updateDestDropdownsの後で行う必要がある）
    if (data) {
      srcSelect.value = data.src;
      destSelect.value = data.dest;
      // 値をセットしたことによる他への影響を反映させるため再度更新
      updateDestDropdowns();
    }
  };

  // テーブル設定カードの作成
  const createTableSettingRow = (data) => {
    const card = document.createElement('div');
    card.className = 'parent-row';

    // ヘッダー部分
    const header = document.createElement('div');
    header.className = 'parent-header';
    
    const label = document.createElement('span');
    label.textContent = '対象テーブル:';
    header.appendChild(label);

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
      // テーブルごと消えるので、その中にあったフィールド設定も解放する必要がある
      updateDestDropdowns(); 
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

    // テーブル変更時のイベント
    tableSelect.onchange = () => {
      // テーブルが変わったらマッピングはリセット（矛盾するため）
      while (mappingContainer.firstChild) mappingContainer.removeChild(mappingContainer.firstChild);
      updateTableDropdowns();
      updateDestDropdowns(); // マッピングが消えたので選択肢解放
    };

    card.appendChild(header);
    card.appendChild(mappingContainer);
    card.appendChild(addMappingBtn);
    container.appendChild(card);

    // 初期データ反映
    if (data) {
      updateTableDropdowns();
      tableSelect.value = data.tableCode;
      
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
        // 修正: プラグイン一覧へ戻る
        window.location.href = '../../' + kintone.app.getId() + '/plugin/#/';
      });
    };
  }

  // キャンセル処理
  if(cancelBtn) {
    cancelBtn.onclick = () => {
      window.location.href = '../../' + kintone.app.getId() + '/plugin/#/';
    };
  }

})(kintone.$PLUGIN_ID);