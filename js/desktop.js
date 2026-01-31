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
    } catch (err) { console.error(err); }
  };

  const getFormattedValue = (field) => {
    if (!field || field.value === undefined || field.value === null) return '';
    const val = field.value;
    if (Array.isArray(val)) {
      return val.map(item => (typeof item === 'object') ? (item.name || item.code || JSON.stringify(item)) : item).join(', ');
    }
    return val;
  };

  const getValidChoiceValue = (srcField, destCode, currentDestVal) => {
    const destDef = fieldDefs[destCode];
    if (!destDef || !destDef.options) return srcField.value;
    const validOptions = Object.keys(destDef.options);
    const srcVal = srcField.value;

    if (['DROP_DOWN', 'RADIO_BUTTON'].includes(destDef.type)) {
      return validOptions.includes(srcVal) ? srcVal : currentDestVal;
    }
    if (['CHECK_BOX', 'MULTI_SELECT'].includes(destDef.type)) {
      if (!Array.isArray(srcVal)) return currentDestVal;
      const filtered = srcVal.filter(v => validOptions.includes(v));
      return (destDef.required && filtered.length === 0) ? currentDestVal : filtered;
    }
    return srcVal;
  };

  const syncLastRow = (record) => {
    const now = Date.now();
    if (now - lastExecTime < 50) return;
    lastExecTime = now;

    if (Object.keys(fieldDefs).length === 0) return;

    settings.forEach(s => {
      const tableField = record[s.tableCode];
      const mappings = s.mappings;

      if (!tableField || !tableField.value || tableField.value.length === 0) {
        mappings.forEach(m => {
          if (record[m.dest]) {
            const dType = fieldDefs[m.dest] ? fieldDefs[m.dest].type : '';
            record[m.dest].value = (dType.includes('CHECK_BOX') || dType.includes('MULTI_SELECT')) ? [] : '';
          }
        });
        return;
      }
      
      const lastRow = tableField.value[tableField.value.length - 1].value;
      mappings.forEach(m => {
        const srcField = lastRow[m.src];
        const destField = record[m.dest];
        const destDef = fieldDefs[m.dest];
        if (srcField && destField && destDef) {
          destField.value = (destDef.type === 'SINGLE_LINE_TEXT') ? getFormattedValue(srcField) : getValidChoiceValue(srcField, m.dest, destField.value);
        }
      });
    });
  };

  const lockDestFields = (record) => {
    settings.forEach(s => {
      s.mappings.forEach(m => {
        if (record[m.dest]) record[m.dest].disabled = true;
      });
    });
  };

  fetchFieldDefinitions();

  kintone.events.on(['app.record.create.show', 'app.record.edit.show', 'app.record.index.edit.show'], async (event) => {
    if (Object.keys(fieldDefs).length === 0) await fetchFieldDefinitions();
    lockDestFields(event.record);
    return event;
  });

  let changeEvents = [];
  settings.forEach(s => {
    changeEvents.push(`app.record.create.change.${s.tableCode}`, `app.record.edit.change.${s.tableCode}`);
    s.mappings.forEach(m => {
      changeEvents.push(`app.record.create.change.${m.src}`, `app.record.edit.change.${m.src}`);
    });
  });

  kintone.events.on(changeEvents, (event) => {
    syncLastRow(event.record);
    return event;
  });

  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit', 'app.record.index.edit.submit'], (event) => {
    syncLastRow(event.record);
    return event;
  });

  kintone.events.on('app.record.index.show', (event) => {
    if (conf.showBulk !== 'true' || document.getElementById('bulk-sync-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'bulk-sync-btn';
    btn.innerText = 'サブテーブル最下行を一括反映';
    btn.className = 'kintoneplugin-button-dialog-ok';
    btn.style.marginLeft = '15px';
    btn.style.borderRadius = '6px';
    btn.onclick = async () => {
      if (!confirm('表示中の全レコードを一括更新しますか？')) return;
      await fetchFieldDefinitions();
      const appId = kintone.app.getId();
      const condition = kintone.app.getQueryCondition() || '';
      const baseQuery = condition ? `(${condition})` : '';
      let updateRecords = [];
      let lastId = 0;

      try {
        while (true) {
          const query = `${baseQuery}${baseQuery ? ' and ' : ''}$id > ${lastId} order by $id asc limit 500`;
          const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: appId, query: query });
          if (resp.records.length === 0) break;

          resp.records.forEach(rec => {
            const updateData = { id: rec.$id.value, record: {} };
            settings.forEach(s => {
              const tableField = rec[s.tableCode];
              if (tableField && tableField.value && tableField.value.length > 0) {
                const lastRow = tableField.value[tableField.value.length - 1].value;
                s.mappings.forEach(m => {
                  const destDef = fieldDefs[m.dest];
                  if (!destDef) return;
                  updateData.record[m.dest] = { value: (destDef.type === 'SINGLE_LINE_TEXT') ? getFormattedValue(lastRow[m.src]) : getValidChoiceValue(lastRow[m.src], m.dest, rec[m.dest].value) };
                });
              } else {
                s.mappings.forEach(m => {
                  const dType = fieldDefs[m.dest] ? fieldDefs[m.dest].type : '';
                  updateData.record[m.dest] = { value: (dType.includes('CHECK_BOX') || dType.includes('MULTI_SELECT')) ? [] : '' };
                });
              }
            });
            if (Object.keys(updateData.record).length > 0) updateRecords.push(updateData);
          });
          lastId = resp.records[resp.records.length - 1].$id.value;
        }

        if (updateRecords.length === 0) return alert('更新対象なし');
        for (let i = 0; i < updateRecords.length; i += 100) {
          await kintone.api(kintone.api.url('/k/v1/records', true), 'PUT', { app: appId, records: updateRecords.slice(i, i + 100) });
        }
        alert('一括更新完了！');
        location.reload();
      } catch (err) { console.error(err); alert('エラーが発生しました。詳細はコンソールを確認してください。'); }
    };
    const space = kintone.app.getHeaderMenuSpaceElement();
    if (space) space.appendChild(btn);
  });
})(kintone.$PLUGIN_ID);