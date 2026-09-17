// In-memory stand-in for the Google Sheet. Same interface as SheetDb in apps-script/Data.gs.
export function memoryDb(tables) {
  const t = tables;
  const need = tab => { if (!t[tab]) throw new Error(`Missing tab "${tab}"`); return t[tab]; };
  // A tab's columns come from the keys of its first row; an empty tab has no rows to ask, so it
  // falls back to tables.__columns[tab] -- the fixtures set this for every tab, taken from the v2
  // template, so append/update can still catch a typo'd field even before the tab holds a row.
  const columnsOf = tab => {
    const arr = need(tab);
    if (arr.length) return Object.keys(arr[0]);
    return (t.__columns && t.__columns[tab]) || [];
  };
  const checkColumns = (tab, fields) => {
    const cols = columnsOf(tab);
    Object.keys(fields).forEach(k => {
      if (!cols.includes(k)) throw new Error(`The ${tab} tab has no "${k}" column.`);
    });
  };
  // A row whose fields are all blank once trimmed is a spacer, not a record -- same rule as
  // SheetDb.rows() in apps-script/Data.gs, so the Node tests and the real Sheet agree.
  const isBlankRow = r => Object.keys(r).every(k => k === "_row" || String(r[k] == null ? "" : r[k]).trim() === "");
  return {
    tables: t,
    rows(tab) {
      return need(tab)
        .map((r, i) => ({ ...r, _row: i + 2 })) // _row is computed before the blank filter, so real rows keep their true number
        .filter(r => !isBlankRow(r));
    },
    append(tab, obj) {
      checkColumns(tab, obj);
      need(tab).push({ ...obj });
      return { ...obj, _row: t[tab].length + 1 };
    },
    update(tab, keyCol, keyVal, patch) {
      checkColumns(tab, patch);
      const r = need(tab).find(x => x[keyCol] === keyVal);
      if (!r) return false;
      Object.assign(r, patch);
      return true;
    },
    remove(tab, pred) {
      const before = need(tab).length;
      t[tab] = t[tab].filter((r, i) => !pred({ ...r, _row: i + 2 }));
      return before - t[tab].length;
    },
  };
}
