(function(PLUGIN_ID) {
  'use strict';

  const container = document.getElementById('table-settings-container');
  let appFields = {};

  const FIELD_CATEGORIES = {
    TEXT: ['SINGLE_LINE_TEXT', 'MULTI_LINE_TEXT', 'RICH_TEXT', 'LINK'],
    NUMBER: ['NUMBER', 'CALC'],
    DATE: ['DATE', 'DATETIME', 'TIME'],
    CHOICE: ['DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX', 'MULTI_SELECT'],
    ENTITY: ['USER_SELECT', 'ORGANIZATION_SELECT', 'GROUP_SELECT']
  };

  const getCategory = (type) => {
    for (const key in FIELD_CATEGORIES) {
      if (FIELD_CATEGORIES[key].includes(type)) return key;
    }
    return null;
  };

  async function fetchFields() {
    const appId = kintone.app.getId() || new URLSearchParams(window.location.search).get('app');
    const resp = await kintone.api(kintone.api.url('/k/v1/preview/app/form/fields', true), 'GET', { app: appId });
    appFields = resp.properties;
    return resp.properties;
  }

  function getUsedFieldsInTable(parentRow, currentSelect) {
    const used = { srcs: [], dests: [] };
    parentRow.querySelectorAll('.child-row').forEach(row => {
      const src = row.querySelector('.mapping-src');
      const dest = row.querySelector('.mapping-dest');
      if (src && src !== currentSelect && src.value) used.srcs.push(src.value);
      if (dest && dest !== currentSelect && dest.value) used.dests.push(dest.value);
    });
    return used;
  }

  function updateOptions(select, options, selectedValue, filterFn, excludeList = [], isDest = false) {
    const currentVal = selectedValue || select.value;
    select.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.text = '-- フィールドを選択 --';
    defaultOpt.value = '';
    select.appendChild(defaultOpt);

    if (!options) return; // 安全策

    Object.keys(options).forEach(code => {
      const field = options[code];
      if (['LABEL', 'SPACER', 'HR', 'FILE'].includes(field.type)) return;
      if (isDest && (field.type === 'CALC' || field.type === 'LOOKUP' || field.lookup)) return;
      if (excludeList.includes(code)) return;
      if (filterFn && !filterFn(field)) return;

      const opt = document.createElement('option');
      opt.value = code;
      opt.text = `${field.label} (${code})`;
      if (code === currentVal) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function refreshAllSelectsInTable(parentRow) {
    parentRow.querySelectorAll('.child-row').forEach(row => {
      const src = row.querySelector('.mapping-src');
      const dest = row.querySelector('.mapping-dest');
      if (src && src.onRefresh) src.onRefresh();
      if (dest && dest.onRefresh) dest.onRefresh();
    });
  }

  function createFieldMappingRow(parentRow, tableCode, mapping = {}) {
    const row = document.createElement('div');
    row.className = 'child-row';
    // 【堅牢化】サブテーブルが存在しない場合の考慮
    const tableDef = appFields[tableCode];
    const subFields = (tableDef && tableDef.fields) ? tableDef.fields : {};
    const outerFields = Object.fromEntries(Object.entries(appFields).filter(([_, f]) => f.type !== 'SUBTABLE'));

    const srcSelect = document.createElement('select');
    srcSelect.className = 'kintoneplugin-select mapping-src';
    const destSelect = document.createElement('select');
    destSelect.className = 'kintoneplugin-select mapping-dest';

    const refreshSrc = () => {
      const used = getUsedFieldsInTable(parentRow, srcSelect);
      const destVal = destSelect.value;
      const destType = (destVal && outerFields[destVal]) ? outerFields[destVal].type : null;
      updateOptions(srcSelect, subFields, mapping.src, (f) => {
        if (!destVal || destType === 'SINGLE_LINE_TEXT') return true;
        return getCategory(f.type) === getCategory(destType);
      }, used.srcs, false);
    };

    const refreshDest = () => {
      const used = getUsedFieldsInTable(parentRow, destSelect);
      const srcVal = srcSelect.value;
      const srcType = (srcVal && subFields[srcVal]) ? subFields[srcVal].type : null;
      updateOptions(destSelect, outerFields, mapping.dest, (f) => {
        if (!srcVal || f.type === 'SINGLE_LINE_TEXT') return true;
        return getCategory(f.type) === getCategory(srcType);
      }, used.dests, true);
    };

    srcSelect.onchange = () => { mapping.src = srcSelect.value; refreshAllSelectsInTable(parentRow); };
    destSelect.onchange = () => { mapping.dest = destSelect.value; refreshAllSelectsInTable(parentRow); };
    srcSelect.onRefresh = refreshSrc;
    destSelect.onRefresh = refreshDest;
    refreshSrc(); refreshDest();

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.innerHTML = '&times;';
    removeBtn.className = 'remove-btn';
    removeBtn.onclick = () => { row.remove(); refreshAllSelectsInTable(parentRow); };

    row.appendChild(document.createElement('span')).innerText = 'コピー元:';
    row.appendChild(srcSelect);
    row.appendChild(document.createElement('span')).innerText = 'コピー先(編集不可):';
    row.appendChild(destSelect);
    row.appendChild(removeBtn);
    return row;
  }

  function createTableSettingRow(config = {mappings: []}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'parent-row';
    const header = document.createElement('div');
    header.className = 'parent-header';
    const tables = Object.fromEntries(Object.entries(appFields).filter(([_, f]) => f.type === 'SUBTABLE'));
    
    // 【堅牢化】保存されているテーブルコードが既にアプリから消えている場合を考慮
    if (config.tableCode && !tables[config.tableCode]) {
      console.warn(`設定されていたテーブル ${config.tableCode} はアプリから削除されています。`);
      return; 
    }

    const tableSelect = document.createElement('select');
    tableSelect.className = 'kintoneplugin-select table-select';
    updateOptions(tableSelect, tables, config.tableCode);

    const removeTableBtn = document.createElement('button');
    removeTableBtn.type = 'button';
    removeTableBtn.innerText = 'テーブル設定を削除';
    removeTableBtn.className = 'modern-btn btn-remove-table';
    removeTableBtn.onclick = () => { if(confirm('転記設定をすべて削除しますか？')) wrapper.remove(); };

    header.appendChild(document.createTextNode('対象テーブル: '));
    header.appendChild(tableSelect);
    header.appendChild(removeTableBtn);

    const childContainer = document.createElement('div');
    childContainer.className = 'child-container';
    const addMappingBtn = document.createElement('button');
    addMappingBtn.type = 'button';
    addMappingBtn.innerText = '＋ フィールドペアを追加';
    addMappingBtn.className = 'add-mapping-btn';
    childContainer.appendChild(addMappingBtn);

    tableSelect.onchange = () => { childContainer.querySelectorAll('.child-row').forEach(r => r.remove()); };

    addMappingBtn.onclick = () => {
      if (!tableSelect.value) return alert('先にサブテーブルを選択してください');
      childContainer.insertBefore(createFieldMappingRow(wrapper, tableSelect.value), addMappingBtn);
    };

    if (config.mappings) {
      config.mappings.forEach(m => {
        // マッピング先のフィールドが削除されている場合はスキップ
        const outerFields = Object.fromEntries(Object.entries(appFields).filter(([_, f]) => f.type !== 'SUBTABLE'));
        if (m.dest && !outerFields[m.dest]) return;
        childContainer.insertBefore(createFieldMappingRow(wrapper, config.tableCode, m), addMappingBtn);
      });
    }

    wrapper.appendChild(header);
    wrapper.appendChild(childContainer);
    container.appendChild(wrapper);
  }

  fetchFields().then(() => {
    const savedConf = kintone.plugin.app.getConfig(PLUGIN_ID);
    if (savedConf.settings) {
      const settings = JSON.parse(savedConf.settings);
      settings.forEach(s => createTableSettingRow(s));
      const bulkCheck = document.getElementById('show-bulk-button');
      if(bulkCheck) bulkCheck.checked = savedConf.showBulk === 'true';
    }
  });

  document.getElementById('add-table-btn').onclick = () => createTableSettingRow();

  document.getElementById('save-btn').onclick = () => {
    const settings = [];
    let hasError = false;
    document.querySelectorAll('.parent-row').forEach(p => {
      const tableCode = p.querySelector('.table-select').value;
      if (!tableCode) return;
      const mappings = [];
      const usedDests = new Set();
      const usedSrcs = new Set();
      p.querySelectorAll('.child-row').forEach(c => {
        const src = c.querySelector('.mapping-src').value;
        const dest = c.querySelector('.mapping-dest').value;
        if (src && dest) {
          if (usedSrcs.has(src) || usedDests.has(dest)) {
            alert(`重複設定があります: ${tableCode}`);
            hasError = true;
          }
          usedSrcs.add(src); usedDests.add(dest);
          mappings.push({ src, dest });
        }
      });
      if (mappings.length > 0) settings.push({ tableCode, mappings });
    });
    if (hasError) return;
    kintone.plugin.app.setConfig({
      settings: JSON.stringify(settings),
      showBulk: String(document.getElementById('show-bulk-button').checked)
    });
  };
  document.getElementById('cancel-btn').onclick = () => history.back();
})(kintone.$PLUGIN_ID);