import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import vm from "node:vm";
import { sync, FILES } from "../scripts/sync-gs.mjs";
import { fixtureTables } from "./fixtures.js";
import { fakeSpreadsheetApp } from "./gs-sheet-fake.js";

test("generated .gs files have no import/export", () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-"));
  sync(dir);
  for (const [, out] of FILES) assert.doesNotMatch(readFileSync(join(dir, out), "utf8"), /^\s*(import|export)\s/m, out);
});

test("committed apps-script copies are up to date", () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-"));
  sync(dir);
  for (const [, out] of FILES) {
    assert.equal(readFileSync(join("apps-script", out), "utf8"), readFileSync(join(dir, out), "utf8"), `${out} is stale: run npm run sync-gs`);
  }
});

function loadGs() {
  const context = vm.createContext({ console });
  for (const file of readdirSync("apps-script").filter(f => f.endsWith(".gs")).sort()) {
    vm.runInContext(readFileSync(join("apps-script", file), "utf8"), context, { filename: file });
  }
  return context;
}

test("every apps-script/*.gs file loads into one global scope without name clashes", () => {
  const context = loadGs();
  for (const name of ["doPost", "doGet", "checkSheet", "handle", "isDue", "verifyPassword", "canTick"]) {
    assert.equal(vm.runInContext(`typeof ${name}`, context), "function", name);
  }
  assert.equal(vm.runInContext('handle({ action: "nope" }, {}).error.code', context), "BAD_INPUT");
  assert.equal(vm.runInContext("typeof SheetDb.rows", context), "function");
});

// ---- fake Google services, just enough of each to drive a real request end to end ----

function fakePropertiesService() {
  const store = new Map();
  const service = {
    getProperty: k => (store.has(k) ? store.get(k) : null),
    setProperty: (k, v) => { store.set(k, v); },
    deleteProperty: k => { store.delete(k); },
    getProperties: () => Object.fromEntries(store),
  };
  return { getScriptProperties: () => service };
}

function fakeCacheService() {
  const store = new Map();
  const cache = {
    get: k => (store.has(k) ? store.get(k) : null),
    put: (k, v) => { store.set(k, v); },
    remove: k => { store.delete(k); },
  };
  return { getScriptCache: () => cache };
}

const fakeLockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };

// Mimics Utilities.computeDigest's Java-signed byte arrays (-128..127): sha256Live_ in
// Adapters.gs converts to that range before calling it, and back to unsigned (0..255) after.
const fakeUtilities = {
  DigestAlgorithm: { SHA_256: "SHA_256" },
  computeDigest: (algorithm, bytes) => {
    const unsigned = Buffer.from(bytes.map(b => b & 255));
    const digest = createHash("sha256").update(unsigned).digest();
    return Array.from(digest, b => (b > 127 ? b - 256 : b));
  },
  getUuid: () => randomUUID(),
  base64Encode: input => Buffer.from(String(input), "utf8").toString("base64"),
  formatDate: (date, timeZone, format) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(date);
    const get = t => parts.find(p => p.type === t).value;
    const ymd = `${get("year")}-${get("month")}-${get("day")}`;
    return format === "yyyy-MM-dd" ? ymd : `${ymd} ${get("hour")}:${get("minute")}`;
  },
};

const fakeContentService = {
  MimeType: { JSON: "JSON" },
  createTextOutput: text => {
    const out = { getContent: () => text, setMimeType: () => out };
    return out;
  },
};

test("Data.gs formats Date cells: datetime columns to the minute, date-only columns to the day, both in Asia/Bangkok", () => {
  const context = loadGs();
  context.Utilities = fakeUtilities;
  // 2026-09-15T18:30:00Z is 2026-09-16 01:30 in Bangkok (UTC+7) -- a day boundary on purpose,
  // so a bug that formats in UTC or the host's local zone would show up as the wrong day.
  // The Date must be constructed inside the vm context: a host-realm Date fails its
  // `instanceof Date` check there, since each vm context has its own Date constructor.
  const stampExpr = `new Date(${Date.parse("2026-09-15T18:30:00Z")})`;
  assert.equal(vm.runInContext(`cellToString_('created_at', ${stampExpr}, '')`, context), "2026-09-16 01:30");
  assert.equal(vm.runInContext(`cellToString_('taken_at', ${stampExpr}, '')`, context), "2026-09-16 01:30");
  assert.equal(vm.runInContext(`cellToString_('changed_at', ${stampExpr}, '')`, context), "2026-09-16 01:30");
  assert.equal(vm.runInContext(`cellToString_('updated_at', ${stampExpr}, '')`, context), "2026-09-16 01:30");
  for (const col of ["date", "started_on", "count_from", "date_of_birth"]) {
    assert.equal(vm.runInContext(`cellToString_(${JSON.stringify(col)}, ${stampExpr}, '')`, context), "2026-09-16", col);
  }
});

test("Data.gs SheetDb.append and .update throw on a field whose column does not exist", () => {
  const context = loadGs();
  const tables = fixtureTables();
  context.SpreadsheetApp = fakeSpreadsheetApp(tables);
  assert.throws(
    () => vm.runInContext('SheetDb.append("Users", { user_id: "U99", not_a_real_column: "x" })', context),
    /not_a_real_column/,
  );
  assert.throws(
    () => vm.runInContext('SheetDb.update("Users", "user_id", "U01", { not_a_real_column: "x" })', context),
    /not_a_real_column/,
  );
});

test("full doPost round trip: listUsers, setPassword, login, bootstrap, tick", () => {
  const context = loadGs();
  context.PropertiesService = fakePropertiesService();
  context.CacheService = fakeCacheService();
  context.LockService = fakeLockService;
  context.Utilities = fakeUtilities;
  context.ContentService = fakeContentService;

  // The shared v2 fixture, plus one Active Daily prescription for Top so tick has something
  // due today regardless of when this test runs.
  const tables = fixtureTables();
  tables.Prescriptions = tables.Prescriptions.concat([{
    prescription_id: "RX07", user_id: "U03", medicine_id: "MED01", frequency: "Daily",
    every_n_days: "", weekdays: "", count_from: "", meal_timing: "Any time", doctor_id: "",
    status: "Active", started_on: "2026-01-01", notes: "", created_at: "", created_by: "", updated_at: "", updated_by: "",
  }]);
  tables.PrescriptionDoses = tables.PrescriptionDoses.concat([
    { dose_id: "DS07", prescription_id: "RX07", time_of_day: "Morning", amount: "1", unit: "tablet" },
  ]);
  context.SpreadsheetApp = fakeSpreadsheetApp(tables);

  const doPost = context.doPost;
  const call = body => JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } }).getContent());

  const listed = call({ action: "listUsers" });
  assert.equal(listed.ok, true);
  assert.ok(listed.data.some(u => u.display_name === "Top"), JSON.stringify(listed));

  // "123456" is exactly MIN_PASSWORD_LENGTH (6), so this must succeed.
  const setPw = call({ action: "setPassword", name: "Top", code: "123456", newPassword: "123456" });
  assert.equal(setPw.ok, true, JSON.stringify(setPw));
  assert.ok(setPw.data.token, JSON.stringify(setPw));

  const login = call({ action: "login", name: "Top", password: "123456" });
  assert.equal(login.ok, true, JSON.stringify(login));
  const token = login.data.token;
  assert.ok(token);

  const boot = call({ action: "bootstrap", token });
  assert.equal(boot.ok, true, JSON.stringify(boot));
  assert.equal(boot.data.me.display_name, "Top");
  assert.ok(boot.data.prescriptions.some(p => p.id === "RX07"), JSON.stringify(boot.data.prescriptions));

  const tick = call({ action: "tick", token, prescriptionId: "RX07", date: boot.data.today, timeOfDay: "Morning" });
  assert.equal(tick.ok, true, JSON.stringify(tick));
  assert.equal(tick.data.prescription_id, "RX07");
  assert.equal(tick.data.status, "Taken");

  console.log("doPost round trip:", JSON.stringify({ listed, setPw, login, boot: { ok: boot.ok, me: boot.data.me }, tick }, null, 2));
});
