import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { sync, FILES } from "../scripts/sync-gs.mjs";
import { fixtureTables } from "./fixtures.js";
import { fakeSpreadsheetApp, fakePropertiesService, fakeCacheService, fakeLockService, fakeUtilities, fakeContentService } from "./gs-sheet-fake.js";

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

// ---- what the family is actually consenting to ----
//
// The Drive calls in apps-script/Drive.gs need a Drive scope, and the automatic scope scan is not
// something a release should be gambling a first photo upload on. The manifest declares the exact
// set instead, which also switches the scan (and so the old /** @OnlyCurrentDoc */ annotation)
// off entirely -- so these two tests pin the declaration and its resolution together. A change
// here changes the Google consent screen the family sees: update README Part 2 with it.
test("appsscript.json declares exactly the OAuth scopes this project needs, and no more", () => {
  const manifest = JSON.parse(readFileSync("apps-script/appsscript.json", "utf8"));
  assert.deepEqual(manifest.oauthScopes, [
    // SpreadsheetApp.getActive(), and nothing but this one bound spreadsheet.
    "https://www.googleapis.com/auth/spreadsheets.currentonly",
    // DriveApp, and ONLY the files this script made itself: its own photo folder
    // (setUpPhotoFolder, or the first upload), a subfolder per medicine inside it, the photo
    // files, sharing those link-readable and trashing the ones it replaces. Never the wider
    // .../auth/drive -- "see, edit, create, and delete ALL of your Google Drive files" is not
    // something an ANYONE_ANONYMOUS web app should be carrying around.
    "https://www.googleapis.com/auth/drive.file",
  ]);
  // Nothing in the project makes an outbound HTTP request or sends mail, so neither scope belongs.
  assert.equal(manifest.oauthScopes.some(s => /external_request|mail|send/.test(s)), false);
  // Spelled out separately from the deepEqual above, because this is the one that would hurt:
  // the family revoked the wide grant, and a stray edit putting it back would re-prompt them.
  assert.equal(manifest.oauthScopes.includes("https://www.googleapis.com/auth/drive"), false);
  assert.equal(manifest.timeZone, "Asia/Bangkok");
});

test("no .gs file claims @OnlyCurrentDoc, which explicit oauthScopes make a false promise", () => {
  for (const file of readdirSync("apps-script").filter(f => f.endsWith(".gs"))) {
    assert.doesNotMatch(
      readFileSync(join("apps-script", file), "utf8"),
      /@OnlyCurrentDoc/,
      `${file}: an explicit oauthScopes list turns the scope scan off, so this annotation would promise a Drive narrowing the declared drive scope does not give`,
    );
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
  for (const name of ["doPost", "doGet", "checkSheet", "setUpPhotoFolder", "handle", "isDue", "verifyPassword", "canTick"]) {
    assert.equal(vm.runInContext(`typeof ${name}`, context), "function", name);
  }
  assert.equal(vm.runInContext('handle({ action: "nope" }, {}).error.code', context), "BAD_INPUT");
  assert.equal(vm.runInContext("typeof SheetDb.rows", context), "function");
});

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

test("SheetDb.rows() skips rows past the real data even when a tab's getLastRow() is padded, like a pre-formatted template", () => {
  const context = loadGs();
  const tables = fixtureTables();
  // scripts/make_template_v2.py pre-formats rows 2..1000 of every tab; simulate a Sheet whose
  // Medicines getLastRow() reports 1000 even though only 5 rows are real data.
  context.SpreadsheetApp = fakeSpreadsheetApp(tables, tables.__columns, { Medicines: 1000 });
  const rows = JSON.parse(JSON.stringify(vm.runInContext('SheetDb.rows("Medicines")', context)));
  assert.equal(rows.length, 5, "padding must not turn into ~995 blank medicines");
  assert.deepEqual(rows.map(r => r._row), [2, 3, 4, 5, 6]);
  assert.ok(rows.every(r => r.generic_name), "no blank medicine slipped through");
});

test("SheetDb.rows() skips a blank row in the middle of a tab, and later rows keep their true _row", () => {
  const context = loadGs();
  const tables = fixtureTables();
  const blank = Object.fromEntries(tables.__columns.Medicines.map(c => [c, ""]));
  tables.Medicines = [tables.Medicines[0], tables.Medicines[1], blank, tables.Medicines[2], tables.Medicines[3], tables.Medicines[4]];
  context.SpreadsheetApp = fakeSpreadsheetApp(tables);
  const rows = JSON.parse(JSON.stringify(vm.runInContext('SheetDb.rows("Medicines")', context)));
  assert.deepEqual(rows.map(r => r.medicine_id), ["MED01", "MED02", "MED03", "MED04", "MED05"]);
  assert.deepEqual(rows.map(r => r._row), [2, 3, 5, 6, 7], "the blank row at sheet row 4 is skipped, not renumbered away");
});

test("SheetDb.update() validates every key before writing any, so a patch with one unknown key changes nothing", () => {
  const context = loadGs();
  const tables = fixtureTables();
  context.SpreadsheetApp = fakeSpreadsheetApp(tables);
  assert.throws(
    () => vm.runInContext('SheetDb.update("Users", "user_id", "U01", { display_name: "Should not stick", not_a_real_column: "x" })', context),
    /not_a_real_column/,
  );
  const rows = JSON.parse(JSON.stringify(vm.runInContext('SheetDb.rows("Users")', context)));
  const dad = rows.find(r => r.user_id === "U01");
  assert.equal(dad.display_name, "Dad", "the valid key must not have been written before the unknown key was found");
});

test("doPost returns the SERVER busy error as JSON when the script lock is unavailable", () => {
  const context = loadGs();
  context.PropertiesService = fakePropertiesService();
  context.CacheService = fakeCacheService();
  context.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };
  context.Utilities = fakeUtilities;
  context.ContentService = fakeContentService;
  context.SpreadsheetApp = fakeSpreadsheetApp(fixtureTables());

  const doPost = context.doPost;
  const call = body => JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } }).getContent());

  // setPassword takes ctx.lock() around its write to Users.
  const result = call({ action: "setPassword", name: "Top", code: "123456", newPassword: "123456" });
  assert.deepEqual(result, { ok: false, error: { code: "SERVER", message: "The app is busy. Try again in a moment." } });
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

  const tick = call({ action: "tick", token, prescriptionId: "RX07", date: boot.data.today, timeOfDay: "Morning", doseId: "DS07", amount: 1 });
  assert.equal(tick.ok, true, JSON.stringify(tick));
  assert.equal(tick.data.prescription_id, "RX07");
  assert.equal(tick.data.status, "Taken");
});
