// Fake Google services, just enough of each to drive the real apps-script/*.gs files inside a
// node:vm context: a SpreadsheetApp backed by plain-object tables (the same shape
// tests/fixtures.js builds), plus Drive, Properties, Cache, Lock, Utilities and Content.
// Cells round-trip as whatever value you put in (string, number, boolean or a real Date), same
// as GAS: getValues() returns it as-is, getDisplayValues() stringifies it -- callers that need
// to see a Date formatted should also pass a display grid.
import { createHash, randomUUID } from "node:crypto";

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

// ---- the other Google services apps-script/*.gs reaches for ----

export function fakePropertiesService() {
  const store = new Map();
  const service = {
    getProperty: k => (store.has(k) ? store.get(k) : null),
    setProperty: (k, v) => { store.set(k, v); },
    deleteProperty: k => { store.delete(k); },
    getProperties: () => Object.fromEntries(store),
  };
  return { getScriptProperties: () => service };
}

export function fakeCacheService() {
  const store = new Map();
  const cache = {
    get: k => (store.has(k) ? store.get(k) : null),
    put: (k, v) => { store.set(k, v); },
    remove: k => { store.delete(k); },
  };
  return { getScriptCache: () => cache };
}

export const fakeLockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };

// Mimics Utilities.computeDigest's Java-signed byte arrays (-128..127): sha256Live_ in
// Adapters.gs converts to that range before calling it, and back to unsigned (0..255) after.
// base64Decode returns the same signed Byte[] GAS returns, and newBlob just remembers what it
// was handed, which is all DriveStore.putImage (apps-script/Drive.gs) does with it.
export const fakeUtilities = {
  DigestAlgorithm: { SHA_256: "SHA_256" },
  computeDigest: (algorithm, bytes) => {
    const unsigned = Buffer.from(bytes.map(b => b & 255));
    const digest = createHash("sha256").update(unsigned).digest();
    return Array.from(digest, b => (b > 127 ? b - 256 : b));
  },
  getUuid: () => randomUUID(),
  base64Encode: input => Buffer.from(String(input), "utf8").toString("base64"),
  base64Decode: text => Array.from(Buffer.from(String(text), "base64"), b => (b > 127 ? b - 256 : b)),
  newBlob: (bytes, contentType, name) => ({
    getBytes: () => bytes,
    getContentType: () => contentType,
    getName: () => name,
  }),
  formatDate: (date, timeZone, format) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(date);
    const get = t => parts.find(p => p.type === t).value;
    const ymd = `${get("year")}-${get("month")}-${get("day")}`;
    return format === "yyyy-MM-dd" ? ymd : `${ymd} ${get("hour")}:${get("minute")}`;
  },
};

export const fakeContentService = {
  MimeType: { JSON: "JSON" },
  createTextOutput: text => {
    const out = { getContent: () => text, setMimeType: () => out };
    return out;
  },
};

// A fake DriveApp with one root folder, whose id is the value the Settings tab's
// photo_folder_id holds ("SAMPLE_FOLDER_ID" in tests/fixtures.js). Folders and files are kept
// on the returned object (.folders, .files) so a test can see exactly what was created,
// shared and trashed. Only the calls apps-script/Drive.gs makes are implemented.
export function fakeDriveApp(rootId = "SAMPLE_FOLDER_ID") {
  const folders = new Map();
  const files = new Map();
  let seq = 0;
  // A real Drive id is a long opaque string, and DriveStore.trashByUrl (apps-script/Drive.gs)
  // only recognises one of 10 characters or more inside a URL -- a short fake id would make
  // every "trash the old photo" path quietly report a warning instead of trashing anything.
  const driveId = (kind, n) => `${kind}${n}_0Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr`;

  function makeFolder(id, name, parentId) {
    const folder = {
      id, name, parentId,
      getId: () => id,
      getName: () => name,
      getFoldersByName(childName) {
        const hits = [...folders.values()].filter(f => f.parentId === id && f.name === childName);
        let i = 0;
        return { hasNext: () => i < hits.length, next: () => hits[i++] };
      },
      createFolder(childName) {
        const child = makeFolder(driveId("FOLDER", ++seq), childName, id);
        folders.set(child.id, child);
        return child;
      },
      createFile(blob) {
        const fileId = driveId("FILE", ++seq);
        const file = {
          id: fileId, folderId: id, blob, trashed: false, sharing: null,
          getId: () => fileId,
          getName: () => blob.getName(),
          setSharing: (access, permission) => { file.sharing = [access, permission]; return file; },
          setTrashed: value => { file.trashed = value; return file; },
        };
        files.set(fileId, file);
        return file;
      },
    };
    return folder;
  }

  folders.set(rootId, makeFolder(rootId, "CyberHealth photos", null));
  return {
    folders,
    files,
    Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK" },
    Permission: { VIEW: "VIEW" },
    getFolderById(id) {
      const folder = folders.get(id);
      if (!folder) throw new Error(`fake Drive: no folder with id ${id}`); // same shape as DriveApp: it throws, it does not return null
      return folder;
    },
    getFileById(id) {
      const file = files.get(id);
      if (!file) throw new Error(`fake Drive: no file with id ${id}`);
      return file;
    },
  };
}
