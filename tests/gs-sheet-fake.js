// A fake SpreadsheetApp backed by plain-object tables (the same shape tests/fixtures.js
// builds), for driving apps-script/*.gs (Data.gs, CheckSheet.gs) inside a node:vm context
// without a real Google Sheet. Cells round-trip as whatever value you put in (string, number,
// boolean or a real Date), same as GAS: getValues() returns it as-is, getDisplayValues()
// stringifies it -- callers that need to see a Date formatted should also pass a display grid.

function buildGrid(columns, rows) {
  return [columns.slice()].concat(rows.map(r => columns.map(c => (r[c] == null ? "" : r[c]))));
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet; this.row = row; this.col = col; this.numRows = numRows; this.numCols = numCols;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = this.sheet.grid[this.row - 1 + r] || [];
      out.push(line.slice(this.col - 1, this.col - 1 + this.numCols));
    }
    return out;
  }
  getDisplayValues() {
    return this.getValues().map(line => line.map(v => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v))));
  }
  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      const rowIdx = this.row - 1 + r;
      while (this.sheet.grid.length <= rowIdx) this.sheet.grid.push(new Array(this.sheet.grid[0].length).fill(""));
      for (let c = 0; c < values[r].length; c++) this.sheet.grid[rowIdx][this.col - 1 + c] = values[r][c];
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat() { return this; }
}

class FakeSheet {
  // padToRow: total sheet rows (header included) to report via getLastRow(), when it's more
  // than the real data -- simulating a template pre-formatted hundreds of rows down, the way
  // scripts/make_template_v2.py leaves rows 2..1000 blank but "used".
  constructor(columns, rows, padToRow) {
    this.grid = buildGrid(columns, rows);
    while (padToRow && this.grid.length < padToRow) this.grid.push(new Array(columns.length).fill(""));
  }
  getLastColumn() { return this.grid[0].length; }
  getLastRow() { return this.grid.length; }
  getRange(row, col, numRows, numCols) {
    return new FakeRange(this, row, col, numRows == null ? 1 : numRows, numCols == null ? 1 : numCols);
  }
  deleteRow(r) { this.grid.splice(r - 1, 1); }
  insertColumnAfter() { throw new Error("fake sheet: insertColumnAfter is not supported"); }
}

// tables: plain-object rows keyed by tab name (fixtures.js's fixtureTables(), minus __columns).
// columnsByTab: header order for each tab -- normally tables.__columns, but a test can pass a
// variant (e.g. with one column removed) to simulate a broken Sheet.
// padRowsByTab: { [tab]: totalRowsIncludingHeader } -- makes that tab's getLastRow() report
// more than the real data, padded with blank rows, to simulate a pre-formatted template tab.
export function fakeSpreadsheetApp(tables, columnsByTab, padRowsByTab) {
  const cols = columnsByTab || tables.__columns || {};
  const pad = padRowsByTab || {};
  const sheets = new Map();
  Object.keys(cols).forEach(tab => sheets.set(tab, new FakeSheet(cols[tab], tables[tab] || [], pad[tab])));
  return {
    getActive: () => ({
      getSheetByName: name => sheets.get(name) || null,
    }),
  };
}
