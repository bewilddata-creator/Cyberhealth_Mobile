// In-memory stand-in for the Google Sheet. Same interface as SheetDb in apps-script/Data.gs --
// and, deliberately, the same OBSERVABLE BEHAVIOUR, method by method. Two production-only bugs
// have already shipped because this fake was more forgiving than the real Sheet, so every rule
// below is copied from SheetDb on purpose; tests/memory-db.test.js pins each one.
//
// Where the two genuinely cannot match, it is called out in a comment:
//   * The real sheet_() can fail with a Google API error (quota, permission, a deleted tab
//     mid-request); there is no such failure mode here.
//   * A pre-formatted template tab can report getLastRow() far past the real data, so the real
//     append() writes below that padding. An array has no padding, so append() here always
//     lands immediately after the last row. rows() filters blank rows and recomputes _row on
//     both sides, so nothing an action can observe depends on the difference.
//   * The real sheet has one fixed header row; this fake takes it from tables.__columns (what
//     every fixture declares) and only falls back to the first row's keys when it is absent.
import { AppError } from "../server/actions.js";

// Timestamp columns, exactly as DATETIME_COLS_ in apps-script/Data.gs.
const DATETIME_COLUMNS = { changed_at: 1, taken_at: 1, created_at: 1, updated_at: 1 };
const BANGKOK_OFFSET_MS = 7 * 3600 * 1000; // Asia/Bangkok is a fixed UTC+7 with no DST

// Mirrors cellToString_ in apps-script/Data.gs: everything a read returns is a trimmed String.
// A Sheet cell can only hold text, a number, a boolean or a Date -- never null/undefined, so a
// key a fixture row simply omits stands for an empty cell and reads back as "".
function cellToString(col, value) {
  if (value instanceof Date) {
    const shifted = new Date(value.getTime() + BANGKOK_OFFSET_MS).toISOString();
    return DATETIME_COLUMNS[col] ? `${shifted.slice(0, 10)} ${shifted.slice(11, 16)}` : shifted.slice(0, 10);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value == null ? "" : value).trim();
}

export function memoryDb(tables) {
  const t = tables;
  // Same wording as sheet_() in apps-script/Data.gs, and the same AppError code, so a missing
  // tab reaches the phone as the same message here as it does from the real Sheet.
  const need = tab => { if (!t[tab]) throw new AppError("SERVER", `The Sheet is missing the "${tab}" tab.`); return t[tab]; };
  // The real headers_() reads row 1 and ignores blank header cells; the fixtures' __columns is
  // that header row. Only when a tab declares none do we guess from the first row's keys.
  const columnsOf = tab => {
    const arr = need(tab);
    const declared = t.__columns && t.__columns[tab];
    return (declared || (arr.length ? Object.keys(arr[0]) : [])).filter(Boolean);
  };
  // Same message and code as SheetDb.append/update, which both refuse a field with no column
  // rather than silently dropping the data.
  const checkColumns = (tab, fields, cols) => {
    Object.keys(fields).forEach(k => {
      if (cols.indexOf(k) < 0) throw new AppError("SERVER", `The ${tab} tab is missing the "${k}" column.`);
    });
  };
  // blankValuesRow_ in apps-script/Data.gs: a row whose every CELL (raw, before formatting) is
  // blank once trimmed is a spacer an admin left behind, not a record. Only header columns
  // count -- a key that is not a column is not a cell on the real Sheet at all.
  const isBlankRow = (row, cols) => cols.every(c => String(row[c] == null ? "" : row[c]).trim() === "");

  const db = {
    tables: t,
    // Every known column is present on every row, trimmed and stringified, and blank spacer
    // rows are dropped -- exactly what SheetDb.rows() returns for a real tab.
    rows(tab) {
      const cols = columnsOf(tab);
      const out = [];
      need(tab).forEach((r, i) => {
        if (isBlankRow(r, cols)) return; // _row comes from i, before this filter, so real rows keep their true number
        const o = { _row: i + 2 };
        cols.forEach(c => { o[c] = cellToString(c, r[c]); });
        out.push(o);
      });
      return out;
    },
    // SheetDb.append writes one cell per header column -- `obj[k] == null ? "" : String(obj[k])`
    // -- so a partial append still fills the rest of the row with blanks, and every stored cell
    // is text. It returns the caller's object untouched (plus _row), NOT the stored row.
    append(tab, obj) {
      const arr = need(tab);
      const cols = columnsOf(tab);
      checkColumns(tab, obj, cols);
      const row = {};
      cols.forEach(c => { row[c] = obj[c] == null ? "" : String(obj[c]); });
      arr.push(row);
      return Object.assign({ _row: arr.length + 1 }, obj);
    },
    // Like SheetDb.update: every key is validated before anything is written (so one bad key
    // leaves the row untouched), the row is found through rows() -- so the key is compared
    // against the trimmed string the Sheet would return, and a blank spacer row can never
    // match -- and each patched cell is written as String(patch[k]). That last one is not a
    // typo: unlike append, update has no null guard, so an undefined value really does land in
    // the Sheet as the text "undefined". Callers must not rely on the fake being kinder.
    update(tab, keyCol, keyVal, patch) {
      const arr = need(tab);
      const cols = columnsOf(tab);
      checkColumns(tab, patch, cols);
      const found = db.rows(tab).find(x => x[keyCol] === keyVal);
      if (!found) return false;
      const stored = arr[found._row - 2];
      Object.keys(patch).forEach(k => { stored[k] = String(patch[k]); });
      return true;
    },
    // Like SheetDb.remove: the predicate sees rows() rows -- backfilled, stringified, with no
    // blank spacer rows -- so a spacer is never deleted and a predicate can rely on every
    // column being present. Returns how many rows were deleted.
    remove(tab, pred) {
      const arr = need(tab);
      const doomed = new Set(db.rows(tab).filter(pred).map(r => r._row));
      t[tab] = arr.filter((r, i) => !doomed.has(i + 2));
      return doomed.size;
    },
  };
  return db;
}
