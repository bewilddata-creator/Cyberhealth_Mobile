// SheetDb: reads and writes tabs by header name. Same interface as dev/memory-db.js.
const TZ_ = "Asia/Bangkok";
// Timestamp columns the app stamps itself: Sheets stores these as Date cells once typed or
// written once, so they come back as "yyyy-MM-dd HH:mm" in Asia/Bangkok. Every other Date
// cell (date, started_on, count_from, date_of_birth -- the date-only columns) comes back as
// just "yyyy-MM-dd".
const DATETIME_COLS_ = { changed_at: 1, taken_at: 1, created_at: 1, updated_at: 1 };

function sheet_(tab) {
  const sh = SpreadsheetApp.getActive().getSheetByName(tab);
  if (!sh) throw new AppError("SERVER", `The Sheet is missing the "${tab}" tab.`);
  return sh;
}
function headers_(sh) {
  const width = sh.getLastColumn();
  return width ? sh.getRange(1, 1, 1, width).getValues()[0].map(h => String(h).trim()) : [];
}
function cellToString_(col, value, display) {
  if (value instanceof Date) {
    const format = DATETIME_COLS_[col] ? "yyyy-MM-dd HH:mm" : "yyyy-MM-dd";
    return Utilities.formatDate(value, TZ_, format);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(display).trim();
}

// True when every cell of a raw values row (as returned by getValues(), before any
// per-column formatting) is blank once trimmed. A pre-formatted template can report
// getLastRow() far past the family's real data, and a blank row left in the middle of a
// tab is a normal thing for an admin to do -- either way, an all-empty row is not a record.
function blankValuesRow_(r) {
  return r.every(v => String(v == null ? "" : v).trim() === "");
}

const SheetDb = {
  rows(tab) {
    const sh = sheet_(tab);
    const last = sh.getLastRow();
    const h = headers_(sh);
    if (last < 2 || !h.length) return [];
    const range = sh.getRange(2, 1, last - 1, h.length);
    const values = range.getValues(), display = range.getDisplayValues();
    const out = [];
    values.forEach((r, i) => {
      if (blankValuesRow_(r)) return; // _row is computed from i before this filter, so real rows keep their true number
      const o = { _row: i + 2 };
      h.forEach((k, j) => { if (k) o[k] = cellToString_(k, r[j], display[i][j]); });
      out.push(o);
    });
    return out;
  },
  append(tab, obj) {
    const sh = sheet_(tab);
    const h = headers_(sh);
    // Every field must land in a real column. Silently dropping an unknown field used to
    // write a row missing that data with no error at all -- the row just looked normal and
    // quietly had no value there.
    Object.keys(obj).forEach(k => { if (h.indexOf(k) < 0) throw new AppError("SERVER", `The ${tab} tab is missing the "${k}" column.`); });
    const row = h.map(k => (obj[k] == null ? "" : String(obj[k])));
    const r = sh.getLastRow() + 1;
    sh.getRange(r, 1, 1, h.length).setNumberFormat("@").setValues([row]);
    return Object.assign({ _row: r }, obj);
  },
  update(tab, keyCol, keyVal, patch) {
    const sh = sheet_(tab);
    const h = headers_(sh);
    // Validate every key before writing any of them, the same way append() does -- otherwise
    // a patch with one bad key part-way through would leave the row half updated.
    const columns = Object.keys(patch).map(k => {
      const j = h.indexOf(k);
      if (j < 0) throw new AppError("SERVER", `The ${tab} tab is missing the "${k}" column.`);
      return [k, j];
    });
    const found = SheetDb.rows(tab).find(x => x[keyCol] === keyVal);
    if (!found) return false;
    columns.forEach(([k, j]) => { sh.getRange(found._row, j + 1).setNumberFormat("@").setValue(String(patch[k])); });
    return true;
  },
  remove(tab, pred) {
    const sh = sheet_(tab);
    const doomed = SheetDb.rows(tab).filter(pred).sort((a, b) => b._row - a._row);
    doomed.forEach(r => sh.deleteRow(r._row));
    return doomed.length;
  },
};
