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

// A fake of the ADVANCED Drive service (Drive API v3), which is what apps-script/Drive.gs
// calls -- Drive.Files.create/get/list/update and Drive.Permissions.create. Not DriveApp: Apps
// Script gates its built-in services on the declared scopes before Drive sees the request, and
// DriveApp is not documented for .../auth/drive.file, which is the whole reason this project
// uses the advanced service.
//
// Everything lives in one `items` map, the way one Drive does, with `folders` and `files` views
// over it so a test can see exactly what was created, shared and trashed. Records are plain v3
// File resources: { id, name, mimeType, parents, trashed, sharing, blob }.
//
// FAITHFULNESS MATTERS HERE. This repo has been bitten more than once by a double that was
// kinder than the real service, so this one copies the behaviour that actually catches bugs:
//   * A file this app may not touch answers 404, never 403 and never null -- Drive returns
//     "not found" for a file that exists but is not yours, so that an app cannot probe someone
//     else's Drive. apps-script/Drive.gs leans on exactly that distinction.
//   * Errors carry .details.code, like GoogleJsonResponseException, because driveNotFound_
//     reads that and nothing else.
//   * Files.list really parses the query it is handed, and THROWS on a clause it does not
//     understand rather than quietly matching everything -- a fake that ignores `q` would pass
//     a Drive.gs that searched for the wrong thing.
//
// Pass null for rootId to get a Drive that does not hold that folder, which is what drive.file
// looks like from inside the script for any folder it did not make itself. That is both the
// "nothing is set up yet" case and the "the id in Settings was pasted in by hand" case.
export const FOLDER_MIME = "application/vnd.google-apps.folder";

function driveError(code, message) {
  const err = new Error(message);
  err.details = { code, message };
  return err;
}

// The clauses apps-script/Drive.gs actually builds, and only those. Anything else is a bug in
// the caller or a gap in this fake, and either way must be loud.
function parseQuery(q) {
  const clauses = String(q == null ? "" : q).split(" and ");
  const want = { parent: null, name: null, mimeType: null, trashed: null };
  const literal = /^'((?:[^'\\]|\\.)*)'$/;
  const unescape = raw => raw.replace(/\\(.)/g, "$1");
  for (const clause of clauses) {
    let m;
    if ((m = /^(.+) in parents$/.exec(clause)) && literal.test(m[1])) {
      want.parent = unescape(literal.exec(m[1])[1]);
    } else if ((m = /^name = (.+)$/.exec(clause)) && literal.test(m[1])) {
      want.name = unescape(literal.exec(m[1])[1]);
    } else if ((m = /^mimeType = (.+)$/.exec(clause)) && literal.test(m[1])) {
      want.mimeType = unescape(literal.exec(m[1])[1]);
    } else if (/^trashed = (true|false)$/.test(clause)) {
      want.trashed = /true/.test(clause);
    } else {
      throw driveError(400, `fake Drive: unsupported query clause ${JSON.stringify(clause)}`);
    }
  }
  return want;
}

export function fakeDrive(rootId = "SAMPLE_FOLDER_ID") {
  const items = new Map();
  let seq = 0;
  // A real Drive id is a long opaque string, and DriveStore.trashByUrl (apps-script/Drive.gs)
  // only recognises one of 10 characters or more inside a URL -- a short fake id would make
  // every "trash the old photo" path quietly report a warning instead of trashing anything.
  const driveId = (kind, n) => `${kind}${n}_0Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr`;

  const view = pred => {
    const map = new Map();
    for (const item of items.values()) if (pred(item)) map.set(item.id, item);
    return map;
  };
  const mustGet = id => {
    const item = items.get(id);
    // 404, not 403: see the note above.
    if (!item) throw driveError(404, `File not found: ${id}.`);
    return item;
  };

  if (rootId) items.set(rootId, { id: rootId, name: "CyberHealth photos", mimeType: FOLDER_MIME, parents: [], trashed: false, sharing: null, blob: null });

  return {
    items,
    get folders() { return view(i => i.mimeType === FOLDER_MIME); },
    get files() { return view(i => i.mimeType !== FOLDER_MIME); },
    Files: {
      // v3 create(resource) for metadata, create(resource, mediaData) with content.
      create(resource, blob) {
        const parents = (resource && resource.parents) || [];
        parents.forEach(mustGet); // a parent this app cannot see is a 404, same as Drive
        const mimeType = (resource && resource.mimeType) || (blob && blob.getContentType && blob.getContentType()) || "application/octet-stream";
        const id = driveId(mimeType === FOLDER_MIME ? "FOLDER" : "FILE", ++seq);
        // Array.from, not .slice(): the caller is code running in a node:vm realm, whose Array
        // is a different constructor, and a test's deepEqual against a plain [] would fail on
        // prototype identity alone.
        const item = { id, name: (resource && resource.name) || "", mimeType, parents: Array.from(parents), trashed: false, sharing: null, blob: blob || null };
        items.set(id, item);
        // v3 answers with the created resource. Only the fields Drive.gs reads are promised.
        return { id: item.id, name: item.name, mimeType: item.mimeType };
      },
      get(fileId) {
        const item = mustGet(fileId);
        return { id: item.id, name: item.name, mimeType: item.mimeType, trashed: item.trashed };
      },
      list(options) {
        const want = parseQuery(options && options.q);
        const hits = [...items.values()].filter(item => {
          if (want.parent !== null && item.parents.indexOf(want.parent) < 0) return false;
          if (want.name !== null && item.name !== want.name) return false;
          if (want.mimeType !== null && item.mimeType !== want.mimeType) return false;
          if (want.trashed !== null && item.trashed !== want.trashed) return false;
          return true;
        });
        return { files: hits.map(item => ({ id: item.id, name: item.name })) };
      },
      update(resource, fileId) {
        const item = mustGet(fileId);
        if (resource && Object.prototype.hasOwnProperty.call(resource, "trashed")) item.trashed = !!resource.trashed;
        if (resource && resource.name != null) item.name = resource.name;
        return { id: item.id, name: item.name, trashed: item.trashed };
      },
    },
    Permissions: {
      create(resource, fileId) {
        const item = mustGet(fileId);
        item.sharing = [resource.type, resource.role];
        return { id: "perm" + (++seq), type: resource.type, role: resource.role };
      },
    },
  };
}
