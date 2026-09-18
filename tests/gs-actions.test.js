// Drives the new write actions through the REAL generated apps-script/*.gs files: every .gs
// loaded into one node:vm context, called through doPost only, against fake Google services.
// The rest of the suite runs the ES modules directly against dev/memory-db.js; this file is
// what proves the same code still works when it is SheetDb, the Drive API and a JSON request body.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { fixtureTables } from "./fixtures.js";
import { fakeSpreadsheetApp, fakePropertiesService, fakeCacheService, fakeLockService, fakeUtilities, fakeContentService, fakeDrive } from "./gs-sheet-fake.js";

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

function loadGs() {
  const context = vm.createContext({ console });
  for (const file of readdirSync("apps-script").filter(f => f.endsWith(".gs")).sort()) {
    vm.runInContext(readFileSync(join("apps-script", file), "utf8"), context, { filename: file });
  }
  return context;
}

// Every Google service liveCtx_() (apps-script/Code.gs) reaches for. The Sheet starts as the
// shared v2 fixture, whose Settings tab points photo_folder_id at SAMPLE_FOLDER_ID -- the same
// id fakeDrive() gives its root folder. The fake is of the ADVANCED Drive service (v3), which
// is what apps-script/Drive.gs calls -- see tests/gs-sheet-fake.js for why it is not DriveApp.
function installFakes(context, tables = fixtureTables(), drive = fakeDrive()) {
  context.SpreadsheetApp = fakeSpreadsheetApp(tables);
  context.PropertiesService = fakePropertiesService();
  context.CacheService = fakeCacheService();
  context.LockService = fakeLockService;
  context.Utilities = fakeUtilities;
  context.ContentService = fakeContentService;
  context.Drive = drive;
  return context;
}

// The fixture Settings tab with its photo_folder_id emptied -- a family that has never run
// setUpPhotoFolder, and a Drive with no CyberHealth folder in it yet.
function tablesWithNoPhotoFolder(value = "") {
  const tables = fixtureTables();
  tables.Settings = tables.Settings.map(r => (r.key === "photo_folder_id" ? { ...r, value } : r));
  return tables;
}

function post(context, body) {
  const e = { postData: { contents: JSON.stringify(body) } };
  const out = vm.runInContext("doPost", context)(e);
  return JSON.parse(out.getContent());
}

function sheetOf(context, tab) {
  return context.SpreadsheetApp.getActive().getSheetByName(tab);
}

// The tab as the Sheet itself holds it: straight off the grid, not through SheetDb, so a test
// sees what a family member would see if they opened the spreadsheet.
function gridRows(context, tab) {
  const [header, ...rest] = sheetOf(context, tab).grid;
  return rest
    .filter(r => r.some(cell => String(cell == null ? "" : cell).trim() !== ""))
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

// Top (U03) has no password in the fixture, only reset code 123456 -- setPassword both sets one
// and hands back a session token, so it is the shortest way in.
function loginAsTop(context) {
  const login = post(context, { action: "setPassword", name: "Top", code: "123456", newPassword: "lion-rock-7" });
  assert.equal(login.ok, true, JSON.stringify(login));
  return login.data.token;
}

function addForTop(context, token, extra) {
  return post(context, Object.assign({
    action: "addPrescription", token, userId: "U03", medicineId: "MED03",
    frequency: "Daily", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }],
    mealTiming: "After meal", reason: "Started by the doctor",
  }, extra || {}));
}

test("the real .gs files add a prescription and record its history through doPost", () => {
  const context = loadGs();
  installFakes(context);
  const token = loginAsTop(context);
  const added = addForTop(context, token);
  assert.equal(added.ok, true, JSON.stringify(added));

  const prescriptionId = added.data.prescription.prescription_id;
  const saved = gridRows(context, "Prescriptions").find(r => r.prescription_id === prescriptionId);
  assert.ok(saved, "the prescription row reached the Sheet");
  assert.equal(saved.user_id, "U03");
  assert.equal(saved.medicine_id, "MED03");
  assert.equal(saved.status, "Active");
  assert.equal(saved.meal_timing, "After meal");

  // The Task 3 bug lived exactly here: SheetDb.update writes to the spreadsheet and leaves the
  // row object already read untouched, so a reply built from that stale object reached the
  // phone with no stamps at all. Node tests could not see it; this one can.
  assert.match(added.data.prescription.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, JSON.stringify(added.data.prescription));
  assert.equal(added.data.prescription.updated_by, "U03");
  assert.equal(added.data.prescription.created_by, "U03");

  // MED03 is an Injection, and addForTop sends unit "tablet" the way an old phone (or anything
  // hand-made) would. The unit written to the Sheet is the one the medicine's form implies, not
  // the one the request asked for -- the whole point of deriving it on the server.
  const doses = gridRows(context, "PrescriptionDoses").filter(d => d.prescription_id === prescriptionId);
  assert.deepEqual(doses.map(d => [d.time_of_day, d.amount, d.unit]), [["Morning", "1", "injection"]]);

  const changes = gridRows(context, "PrescriptionChanges").filter(c => c.prescription_id === prescriptionId);
  assert.equal(changes.length, 1, "a history row reached the Sheet");
  assert.equal(changes[0].change_type, "Started");
  assert.equal(changes[0].before, "");
  assert.match(changes[0].after, /Morning 1 injection/);
  assert.equal(changes[0].reason, "Started by the doctor");
  assert.match(changes[0].changed_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.ok(sheetOf(context, "PrescriptionChanges").grid.length > 1, "a history row reached the Sheet");
});

test("the real .gs files carry one prescription through change, stop, restart and delete", () => {
  const context = loadGs();
  installFakes(context);
  const token = loginAsTop(context);
  const prescriptionId = addForTop(context, token).data.prescription.prescription_id;

  const dosed = post(context, {
    action: "changePrescriptionDose", token, prescriptionId,
    doses: [{ timeOfDay: "Morning", amount: 2, unit: "tablet" }, { timeOfDay: "Bedtime", amount: 1, unit: "tablet" }],
  });
  assert.equal(dosed.ok, true, JSON.stringify(dosed));
  assert.deepEqual(
    gridRows(context, "PrescriptionDoses").filter(d => d.prescription_id === prescriptionId).map(d => `${d.time_of_day} ${d.amount}`),
    ["Morning 2", "Bedtime 1"],
    "the old dose rows are gone from the Sheet, not left behind next to the new ones",
  );

  const rescheduled = post(context, { action: "changePrescriptionSchedule", token, prescriptionId, frequency: "Weekdays", weekdays: ["Mon", "Wed"] });
  assert.equal(rescheduled.ok, true, JSON.stringify(rescheduled));
  const afterSchedule = gridRows(context, "Prescriptions").find(r => r.prescription_id === prescriptionId);
  assert.equal(afterSchedule.frequency, "Weekdays");
  assert.equal(afterSchedule.weekdays, "Mon, Wed");
  assert.equal(afterSchedule.meal_timing, "After meal", "a schedule-only edit must not erase the meal timing");

  assert.equal(post(context, { action: "stopPrescription", token, prescriptionId, reason: "Finished" }).ok, true);
  assert.equal(gridRows(context, "Prescriptions").find(r => r.prescription_id === prescriptionId).status, "Stopped");
  assert.equal(post(context, { action: "restartPrescription", token, prescriptionId }).ok, true);
  assert.equal(gridRows(context, "Prescriptions").find(r => r.prescription_id === prescriptionId).status, "Active");

  assert.deepEqual(
    gridRows(context, "PrescriptionChanges").filter(c => c.prescription_id === prescriptionId).map(c => c.change_type),
    ["Started", "Dose changed", "Schedule changed", "Stopped", "Restarted"],
  );

  const deleted = post(context, { action: "deletePrescription", token, prescriptionId });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.equal(gridRows(context, "Prescriptions").filter(r => r.prescription_id === prescriptionId).length, 0);
  assert.equal(gridRows(context, "PrescriptionDoses").filter(d => d.prescription_id === prescriptionId).length, 0);
  assert.equal(gridRows(context, "PrescriptionChanges").filter(c => c.prescription_id === prescriptionId).length, 0);
  // Deleting rows out of the middle of a tab must leave everybody else's rows alone.
  assert.deepEqual(gridRows(context, "Prescriptions").map(r => r.prescription_id), ["RX01", "RX02", "RX03", "RX04", "RX05", "RX06"]);
  assert.deepEqual(gridRows(context, "PrescriptionChanges").map(c => c.change_id), ["CH01", "CH02", "CH03", "CH04"]);
});

test("the real .gs files add and edit a library medicine through doPost", () => {
  const context = loadGs();
  installFakes(context);
  const token = loginAsTop(context);

  const added = post(context, { action: "addMedicine", token, fields: { generic_name: "Aspirin", strength: "81 mg", form: "Tablet" } });
  assert.equal(added.ok, true, JSON.stringify(added));
  const medicineId = added.data.medicine_id;
  const saved = gridRows(context, "Medicines").find(m => m.medicine_id === medicineId);
  assert.equal(saved.generic_name, "Aspirin");
  assert.equal(saved.strength, "81 mg");
  assert.equal(saved.photo_box, "", "every column of the new row is written, blank where nothing was sent");
  assert.match(saved.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

  const updated = post(context, { action: "updateMedicine", token, medicineId, fields: { strength: "100 mg" } });
  assert.equal(updated.ok, true, JSON.stringify(updated));
  assert.equal(updated.data.strength, "100 mg");
  assert.equal(updated.data.generic_name, "Aspirin", "the reply is re-read from the Sheet, not from the patch");
  assert.equal(gridRows(context, "Medicines").find(m => m.medicine_id === medicineId).strength, "100 mg");
});

test("the real .gs files upload a photo through doPost and store the Drive link", () => {
  const context = loadGs();
  installFakes(context);
  const token = loginAsTop(context);
  const r = post(context, { action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.data.url, /drive\.google\.com/);
  assert.deepEqual(r.data.warnings, []);

  const created = [...context.Drive.files.values()];
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "box.jpg");
  assert.deepEqual(created[0].sharing, ["anyone", "reader"], "the file is readable by anyone with the link, or the phone cannot show it");
  const folder = context.Drive.folders.get(created[0].parents[0]);
  assert.equal(folder.name, "MED01 Amlodipine 5 mg", "each medicine gets its own folder under the configured root");
  assert.deepEqual(folder.parents, ["SAMPLE_FOLDER_ID"]);
  assert.equal(gridRows(context, "Medicines").find(m => m.medicine_id === "MED01").photo_box, r.data.url);
});

test("the real .gs files replace and then remove a photo, trashing exactly the old file", () => {
  const context = loadGs();
  installFakes(context);
  const token = loginAsTop(context);
  const first = post(context, { action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG });
  const second = post(context, { action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(second.data.warnings, []);
  const files = [...context.Drive.files.values()];
  assert.equal(files.length, 2, "the new file is created before the old one is trashed");
  assert.deepEqual(files.map(f => f.trashed), [true, false], "only the file the column pointed at is trashed");
  assert.equal(gridRows(context, "Medicines").find(m => m.medicine_id === "MED01").photo_box, second.data.url);
  assert.notEqual(first.data.url, second.data.url);
  // The other medicine's photo, and MED01's other slots, are untouched throughout.
  assert.equal(gridRows(context, "Medicines").find(m => m.medicine_id === "MED01").photo_pill_front, "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view");

  const removed = post(context, { action: "removeMedicinePhoto", token, medicineId: "MED01", slot: "box" });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.deepEqual(removed.data.warnings, []);
  assert.equal(gridRows(context, "Medicines").find(m => m.medicine_id === "MED01").photo_box, "");
  assert.deepEqual([...context.Drive.files.values()].map(f => f.trashed), [true, true]);
});

test("a photo for a medicine that is not in the Sheet is refused before anything reaches Drive", () => {
  const context = loadGs();
  installFakes(context);
  const token = loginAsTop(context);
  const r = post(context, { action: "uploadMedicinePhoto", token, medicineId: "MED99", slot: "box", dataUrl: JPEG });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
  assert.equal(context.Drive.files.size, 0, "no orphan file is left in the family's Drive");
});

// ---- the photo folder the app makes for itself ----
//
// apps-script/appsscript.json asks for .../auth/drive.file, which reaches only the files and
// folders this script made itself. So the app makes its own photo folder instead of being given
// the id of one somebody made by hand, and these tests drive the real .gs through both the
// admin's entry point (setUpPhotoFolder) and the phone's (uploadMedicinePhoto).

// Runs a top-level function with console.log captured, and hands back everything it printed.
function runLogging(context, fnName) {
  const printed = [];
  const realConsole = context.console;
  context.console = { log: (...args) => printed.push(args.join(" ")), error: () => {} };
  try {
    vm.runInContext(fnName, context)();
  } finally {
    context.console = realConsole;
  }
  return printed.join("\n");
}

function settingValue(context, key) {
  const row = gridRows(context, "Settings").find(r => r.key === key);
  return row ? row.value : undefined;
}

test("setUpPhotoFolder makes the folder, writes its id into Settings, and says where it is", () => {
  const context = loadGs();
  installFakes(context, tablesWithNoPhotoFolder(), fakeDrive(null));
  const log = runLogging(context, "setUpPhotoFolder");

  const made = [...context.Drive.folders.values()];
  assert.equal(made.length, 1, "exactly one folder, at the top level of My Drive");
  assert.equal(made[0].name, "CyberHealth Photos");
  assert.deepEqual(made[0].parents, [], "at the top level of My Drive, where the admin can find it");
  assert.equal(settingValue(context, "photo_folder_id"), made[0].id, "the admin never has to copy the id");
  assert.match(log, /CyberHealth Photos/);
  assert.ok(log.includes(`https://drive.google.com/drive/folders/${made[0].id}`), log);
  assert.match(log, /move it|drag the folder/i, "the admin is told they may move it");
});

test("setUpPhotoFolder adds the photo_folder_id row when the Settings tab has none", () => {
  const tables = fixtureTables();
  tables.Settings = tables.Settings.filter(r => r.key !== "photo_folder_id");
  const context = loadGs();
  installFakes(context, tables, fakeDrive(null));
  runLogging(context, "setUpPhotoFolder");
  const made = [...context.Drive.folders.values()][0];
  assert.equal(settingValue(context, "photo_folder_id"), made.id);
});

test("setUpPhotoFolder run twice changes nothing the second time", () => {
  const context = loadGs();
  installFakes(context, tablesWithNoPhotoFolder(), fakeDrive(null));
  runLogging(context, "setUpPhotoFolder");
  const firstId = settingValue(context, "photo_folder_id");

  const log = runLogging(context, "setUpPhotoFolder");
  assert.equal(context.Drive.folders.size, 1, "no second folder");
  assert.equal(settingValue(context, "photo_folder_id"), firstId);
  assert.match(log, /nothing to do/i);
});

test("setUpPhotoFolder refuses to replace a folder id it cannot open, and says what to do", () => {
  const context = loadGs();
  // The live Sheet today: an id pasted in by hand, pointing at a folder drive.file cannot reach.
  installFakes(context, tablesWithNoPhotoFolder("MADE_BY_HAND"), fakeDrive(null));
  const log = runLogging(context, "setUpPhotoFolder");

  assert.equal(context.Drive.folders.size, 0, "no second folder is made behind the admin's back");
  assert.equal(settingValue(context, "photo_folder_id"), "MADE_BY_HAND", "and the cell is left for them to clear");
  assert.match(log, /Settings tab/);
  assert.match(log, /photo_folder_id/);
  assert.match(log, /setUpPhotoFolder again/);
});

test("a photo uploaded before anyone ran setUpPhotoFolder makes the folder on the way through", () => {
  const context = loadGs();
  installFakes(context, tablesWithNoPhotoFolder(), fakeDrive(null));
  const token = loginAsTop(context);
  const r = post(context, { action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG });
  assert.equal(r.ok, true, JSON.stringify(r));

  const rootId = settingValue(context, "photo_folder_id");
  assert.ok(rootId, "the new folder's id was written into Settings, so the next upload finds it");
  const root = context.Drive.folders.get(rootId);
  assert.equal(root.name, "CyberHealth Photos");
  const file = [...context.Drive.files.values()][0];
  const medFolder = context.Drive.folders.get(file.parents[0]);
  assert.equal(medFolder.name, "MED01 Amlodipine 5 mg");
  assert.deepEqual(medFolder.parents, [rootId], "the medicine's folder sits inside the one the app just made");
  assert.equal(gridRows(context, "Medicines").find(m => m.medicine_id === "MED01").photo_box, r.data.url);

  // The second upload must reuse the folder rather than make another one.
  assert.equal(post(context, { action: "uploadMedicinePhoto", token, medicineId: "MED02", slot: "box", dataUrl: JPEG }).ok, true);
  assert.equal([...context.Drive.folders.values()].filter(f => !f.parents.length).length, 1);
});

test("a photo upload against a folder id the app cannot open is refused in plain words", () => {
  const context = loadGs();
  installFakes(context, tablesWithNoPhotoFolder("MADE_BY_HAND"), fakeDrive(null));
  const token = loginAsTop(context);
  const r = post(context, { action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG });

  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.error.code, "BAD_INPUT");
  assert.match(r.error.message, /photo_folder_id/);
  assert.match(r.error.message, /setUpPhotoFolder/);
  assert.equal(context.Drive.folders.size, 0, "no second folder: nobody is left wondering where the photos went");
  assert.equal(context.Drive.files.size, 0);
  assert.equal(settingValue(context, "photo_folder_id"), "MADE_BY_HAND", "clearing the cell stays a deliberate act");
  assert.equal(gridRows(context, "Medicines").find(m => m.medicine_id === "MED01").photo_box, "");
});

test("removing a photo whose link was pasted in by hand warns instead of trashing somebody's file", () => {
  const context = loadGs();
  installFakes(context);
  const token = loginAsTop(context);
  // MED01's photo_pill_front in the fixture is a Drive link the app never uploaded. Under
  // drive.file it cannot touch that file at all -- which is the point: Sheet access alone must
  // not let anyone paste an arbitrary Drive link into a photo cell and bin the file behind it.
  const r = post(context, { action: "removeMedicinePhoto", token, medicineId: "MED01", slot: "pill_front" });

  assert.equal(r.ok, true, `a file it may not touch is a warning, not a crash: ${JSON.stringify(r)}`);
  assert.equal(r.data.warnings.length, 1, JSON.stringify(r.data.warnings));
  assert.match(r.data.warnings[0], /still in Drive/);
  assert.equal(gridRows(context, "Medicines").find(m => m.medicine_id === "MED01").photo_pill_front, "", "the app forgets it either way");
  assert.equal([...context.Drive.files.values()].filter(f => f.trashed).length, 0);
});

test("setUpPhotoFolder tells the truth about a permission problem instead of blaming the folder", () => {
  const context = loadGs();
  const drive = fakeDrive(null);
  drive.Files.get = () => {
    const err = new Error("Insufficient permissions for this file");
    err.details = { code: 403, message: "Insufficient permissions for this file" };
    throw err;
  };
  installFakes(context, tablesWithNoPhotoFolder("SOME_FOLDER"), drive);

  // A 404 is "not a folder this app made", and emptying the Settings box fixes it. A 403 is
  // "this app was never granted the permission", and emptying the box fixes nothing -- it would
  // just send the admin off to clear a cell while the real error waited for somebody's phone.
  let printed = "";
  const realConsole = context.console;
  context.console = { log: t => { printed += t; }, error: () => {} };
  try {
    assert.throws(() => vm.runInContext("setUpPhotoFolder", context)(), /Insufficient permissions/);
  } finally {
    context.console = realConsole;
  }
  assert.equal(printed, "", "no reassuring advice was printed over the top of a real failure");
  assert.equal(context.Drive.folders.size, 0);
  assert.equal(settingValue(context, "photo_folder_id"), "SOME_FOLDER");
});

test("the photo folder is found again when the medicine's name has an apostrophe in it", () => {
  const context = loadGs();
  installFakes(context);
  // Drive search queries are single-quoted strings, so an unescaped apostrophe would either
  // throw or -- worse -- match nothing, and every upload would make one more folder.
  const name = "MED09 Bob's 5 mg";
  const first = vm.runInContext(`DriveStore.folder("SAMPLE_FOLDER_ID", ${JSON.stringify(name)}).id`, context);
  const second = vm.runInContext(`DriveStore.folder("SAMPLE_FOLDER_ID", ${JSON.stringify(name)}).id`, context);
  assert.equal(second, first, "the second upload reuses the folder rather than making a twin");
  assert.equal([...context.Drive.folders.values()].filter(f => f.name === name).length, 1);
});

// Belt and braces, not a bug fixed: Data.gs's SheetDb.rows() already trims every string cell,
// so the key SheetSettings.set hands to update() is trimmed before it gets there either way.
// This pins the behaviour the family actually depends on -- one row updated, never a second
// one appended -- rather than the internals of how the key is matched.
test("SheetSettings.set finds the row even when the key cell has spaces around it", () => {
  const tables = fixtureTables();
  tables.Settings = tables.Settings.map(r => (r.key === "photo_folder_id" ? { ...r, key: "  photo_folder_id  " } : r));
  const context = loadGs();
  installFakes(context, tables);
  vm.runInContext('SheetSettings.set("photo_folder_id", "NEW_ID")', context);
  assert.equal(gridRows(context, "Settings").length, 1, "the row was updated, not a second one appended");
  assert.equal(vm.runInContext('SheetSettings.get("photo_folder_id")', context), "NEW_ID");
});

test("SheetSettings.set raises instead of reporting a write that did not happen", () => {
  const context = loadGs();
  installFakes(context);
  // The failure this guards: update() answering false, the id never reaching the Sheet, and
  // create() cheerfully reporting a folder that the next upload would then make again.
  vm.runInContext("SheetDb.update = () => false;", context);
  assert.throws(() => vm.runInContext('SheetSettings.set("photo_folder_id", "NEW_ID")', context), /photo_folder_id/);
});

test("a photo folder whose id the Sheet refused to take is binned, not left as a stray", () => {
  const context = loadGs();
  installFakes(context, tablesWithNoPhotoFolder(), fakeDrive(null));
  vm.runInContext('SheetDb.update = () => { throw new AppError("SERVER", "the Sheet said no"); };', context);

  assert.throws(() => vm.runInContext("setUpPhotoFolder", context)(), /the Sheet said no/);
  // Nothing knows the folder exists, so leaving it behind would mean a twin on every re-run.
  const live = [...context.Drive.folders.values()].filter(f => !f.trashed);
  assert.deepEqual(live, [], "the half-made folder was cleaned up");
  assert.equal(settingValue(context, "photo_folder_id"), "");
});

test("two first uploads at once share one folder: the id is re-read inside the lock", () => {
  const context = loadGs();
  installFakes(context, tablesWithNoPhotoFolder(), fakeDrive(null));
  // The other phone got there first: it made its folder and wrote the id down in the moment
  // between this request reading a blank cell and taking the lock. Re-reading inside the lock
  // is what stops this one making a second folder nobody asked for.
  let fired = false;
  context.LockService = {
    getScriptLock: () => ({
      tryLock: () => {
        if (!fired) {
          fired = true;
          const sheet = sheetOf(context, "Settings");
          const row = sheet.grid.find(r => String(r[0]).trim() === "photo_folder_id");
          row[1] = "FOLDER_FROM_THE_OTHER_PHONE";
        }
        return true;
      },
      releaseLock: () => {},
    }),
  };

  assert.equal(vm.runInContext("PhotoFolder.ensureId()", context), "FOLDER_FROM_THE_OTHER_PHONE");
  assert.equal(context.Drive.folders.size, 0, "the loser of the race uses the winner's folder");
});

// ---- the request cache must never answer a read taken inside the lock ----
// requestDb_ (apps-script/Adapters.gs) caches each tab for the whole request and clears a tab
// only when THIS request writes to it. Every action that reads a tab before taking its lock
// would otherwise have its in-lock re-read served from that stale copy, which is the one thing
// the lock exists to prevent. liveCtx_ now calls db.invalidate() once the lock is held.
// These two tests commit a change to the Sheet from inside tryLock -- exactly the window where
// another phone's request would land -- and fail if the cache is consulted afterwards.

// Runs `change` the first time a lock is acquired, then behaves like an ordinary free lock.
// Install it AFTER logging in, so the first lock it sees is the one under test.
function commitOnNextLock(context, change) {
  let fired = false;
  context.LockService = {
    getScriptLock: () => ({
      tryLock: () => { if (!fired) { fired = true; change(); } return true; },
      releaseLock: () => {},
    }),
  };
}

function appendGridRow(context, tab, obj) {
  const sheet = sheetOf(context, tab);
  sheet.grid.push(sheet.grid[0].map(h => (obj[h] == null ? "" : String(obj[h]))));
}

test("a medicine deleted after uploadMedicinePhoto's first read is still seen inside the lock", () => {
  const context = loadGs();
  installFakes(context);
  const token = loginAsTop(context);
  commitOnNextLock(context, () => {
    const sheet = sheetOf(context, "Medicines");
    sheet.grid = sheet.grid.filter(r => r[0] !== "MED01");
  });
  const r = post(context, { action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG });
  assert.equal(r.ok, false, `the in-lock re-check must read the Sheet, not the request cache: ${JSON.stringify(r)}`);
  assert.equal(r.error.code, "BAD_INPUT");
  assert.match(r.error.message, /isn't in the list any more/);
});

test("restartPrescription sees a prescription that went Active after its first read, and refuses", () => {
  const context = loadGs();
  installFakes(context);
  const token = loginAsTop(context);
  // RX06 is U01's Stopped prescription for MED05. Between the read that finds it and the lock,
  // someone else starts MED05 for U01 again -- restarting now would leave two Active
  // prescriptions for one medicine, which is the double dose this rebuild exists to stop.
  commitOnNextLock(context, () => appendGridRow(context, "Prescriptions", {
    prescription_id: "RX99", user_id: "U01", medicine_id: "MED05", frequency: "Daily",
    meal_timing: "Any time", status: "Active", started_on: "2026-09-01",
  }));
  const r = post(context, { action: "restartPrescription", token, prescriptionId: "RX06" });
  assert.equal(r.ok, false, `the duplicate guard must read the Sheet, not the request cache: ${JSON.stringify(r)}`);
  assert.equal(r.error.code, "CONFLICT");
  assert.equal(gridRows(context, "Prescriptions").find(p => p.prescription_id === "RX06").status, "Stopped");
});

test("a write action without a token is refused by the real .gs files, and the Sheet is untouched", () => {
  const context = loadGs();
  installFakes(context);
  const before = JSON.stringify(sheetOf(context, "Prescriptions").grid);
  const r = post(context, {
    action: "addPrescription", userId: "U03", medicineId: "MED03",
    frequency: "Daily", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }],
  });
  assert.deepEqual(r, { ok: false, error: { code: "AUTH_REQUIRED", message: "Please log in." } });
  assert.equal(JSON.stringify(sheetOf(context, "Prescriptions").grid), before);
});
