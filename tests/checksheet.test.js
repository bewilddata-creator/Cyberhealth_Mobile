// Drives checkSheet() from the real generated apps-script/*.gs files, loaded into one
// node:vm context, against a fake SpreadsheetApp built from the shared v2 fixture (see
// tests/fixtures.js and scripts/make_template_v2.py). The clean fixture must report nothing;
// each deliberately broken variant must be named by its tab and row id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { fixtureTables, fakeCtx, loginAs } from "./fixtures.js";
import { fakeSpreadsheetApp, fakeDrive } from "./gs-sheet-fake.js";
import { handle } from "../server/actions.js";

function loadGs() {
  const context = vm.createContext({ console });
  for (const file of readdirSync("apps-script").filter(f => f.endsWith(".gs")).sort()) {
    vm.runInContext(readFileSync(join("apps-script", file), "utf8"), context, { filename: file });
  }
  return context;
}

// drive is the fake advanced Drive service checkSheet should see. The default one owns
// SAMPLE_FOLDER_ID, the
// folder id the fixture's Settings tab holds -- i.e. a Sheet whose photo folder the app made
// itself and can still open. Pass fakeDrive(null) for a Drive where it cannot.
function runCheckSheet(tables, columnsByTab, drive) {
  const context = loadGs();
  context.SpreadsheetApp = fakeSpreadsheetApp(tables, columnsByTab || tables.__columns);
  context.Drive = drive || fakeDrive();
  // checkSheet() builds its array inside the vm realm, whose Array is a different
  // constructor than this file's -- deepEqual against a host-realm [] would otherwise fail
  // on prototype identity alone. Round-tripping through JSON gives back a plain host array.
  return JSON.parse(JSON.stringify(vm.runInContext("checkSheet()", context)));
}

// A Drive that refuses with 403 rather than 404: the app was never granted the permission,
// which is a different thing from "that folder is not one of ours".
function deniedDrive() {
  const drive = fakeDrive(null);
  drive.Files.get = () => {
    const err = new Error("Insufficient permissions for this file");
    err.details = { code: 403, message: "Insufficient permissions for this file" };
    throw err;
  };
  return drive;
}

// A deep-enough clone to mutate one tab's rows without touching the shared fixture.
function clone(tables) {
  const out = { __columns: tables.__columns };
  Object.keys(tables).forEach(tab => { if (tab !== "__columns") out[tab] = tables[tab].map(r => ({ ...r })); });
  return out;
}

test("checkSheet reports nothing for the clean v2 fixture", () => {
  assert.deepEqual(runCheckSheet(fixtureTables()), []);
});

test("checkSheet never writes to the Sheet", () => {
  const tables = fixtureTables();
  const context = loadGs();
  const spreadsheetApp = fakeSpreadsheetApp(tables);
  context.SpreadsheetApp = spreadsheetApp;
  const before = JSON.stringify([...spreadsheetApp.getActive().getSheetByName("Users").grid]);
  vm.runInContext("checkSheet()", context);
  const after = JSON.stringify(spreadsheetApp.getActive().getSheetByName("Users").grid);
  assert.equal(after, before);
});

test("checkSheet names a tab and column when a header is dropped", () => {
  const tables = fixtureTables();
  const columns = { ...tables.__columns, Prescriptions: tables.__columns.Prescriptions.filter(c => c !== "doctor_id") };
  const problems = runCheckSheet(tables, columns);
  assert.ok(problems.some(p => p.includes("Prescriptions") && p.includes("doctor_id")), problems.join("\n"));
});

test("checkSheet names an orphan dose's row id and the missing prescription", () => {
  const tables = clone(fixtureTables());
  tables.PrescriptionDoses = tables.PrescriptionDoses.map(r => (r.dose_id === "DS01" ? { ...r, prescription_id: "RX-GONE" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("PrescriptionDoses") && p.includes("DS01") && p.includes("RX-GONE")), problems.join("\n"));
});

test("checkSheet names a duplicate key", () => {
  const tables = clone(fixtureTables());
  tables.Users = tables.Users.map(r => (r.user_id === "U02" ? { ...r, user_id: "U01" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("Users") && p.includes("U01")), problems.join("\n"));
});

test("checkSheet names duplicate active prescriptions for the same person and medicine", () => {
  const tables = clone(fixtureTables());
  tables.Prescriptions = tables.Prescriptions.map(r => (r.prescription_id === "RX02" ? { ...r, medicine_id: "MED01" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("Prescriptions") && p.includes("RX02")), problems.join("\n"));
});

test("checkSheet names duplicate dose rows for the same prescription and time of day", () => {
  const tables = clone(fixtureTables());
  tables.PrescriptionDoses = tables.PrescriptionDoses.map(r => (r.dose_id === "DS03" ? { ...r, time_of_day: "Morning" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("PrescriptionDoses") && p.includes("DS03")), problems.join("\n"));
});

test("checkSheet names a broken CareTeam reference", () => {
  const tables = clone(fixtureTables());
  tables.CareTeam = tables.CareTeam.map(r => (r.care_id === "CT01" ? { ...r, doctor_id: "DOC-GONE" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("CareTeam") && p.includes("CT01") && p.includes("DOC-GONE")), problems.join("\n"));
});

test("checkSheet names a broken HospitalNumbers reference", () => {
  const tables = clone(fixtureTables());
  tables.HospitalNumbers = tables.HospitalNumbers.map(r => (r.hn_id === "HN01" ? { ...r, hospital_id: "HOS-GONE" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("HospitalNumbers") && p.includes("HN01") && p.includes("HOS-GONE")), problems.join("\n"));
});

test("checkSheet names a broken DoctorHospitals reference", () => {
  const tables = clone(fixtureTables());
  tables.DoctorHospitals = tables.DoctorHospitals.map(r => (r.doctor_hospital_id === "DH01" ? { ...r, hospital_id: "HOS-GONE" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("DoctorHospitals") && p.includes("DH01") && p.includes("HOS-GONE")), problems.join("\n"));
});

// F2: a hand-edited Sheet can lose the doctor a recorded change names -- and nothing shows it,
// because the phone drops a doctor id it cannot find and the history line simply stops saying who
// prescribed it. The checker has to be the thing that notices.
test("checkSheet names a change row pointing at a doctor or a prescription that is not there", () => {
  const tables = clone(fixtureTables());
  tables.PrescriptionChanges = tables.PrescriptionChanges.map(r => {
    if (r.change_id === "CH01") return { ...r, doctor_id: "DOC-GONE" };
    if (r.change_id === "CH03") return { ...r, prescription_id: "RX-GONE" };
    return r;
  });
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("PrescriptionChanges") && p.includes("CH01") && p.includes("DOC-GONE")), problems.join("\n"));
  assert.ok(problems.some(p => p.includes("PrescriptionChanges") && p.includes("CH03") && p.includes("RX-GONE")), problems.join("\n"));
  // CH04's doctor_id is blank on purpose (a course stopped with no doctor named) -- a blank is
  // not a broken reference, and flagging it would train the admin to ignore this report.
  assert.ok(!problems.some(p => p.includes("CH04")), problems.join("\n"));
});

test("checkSheet warns about an invalid Prescriptions row", () => {
  const tables = clone(fixtureTables());
  tables.Prescriptions = tables.Prescriptions.map(r => (r.prescription_id === "RX01" ? { ...r, frequency: "Bogus" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("Prescriptions") && p.includes("RX01")), problems.join("\n"));
});

test("checkSheet warns about an invalid PrescriptionDoses row", () => {
  const tables = clone(fixtureTables());
  tables.PrescriptionDoses = tables.PrescriptionDoses.map(r => (r.dose_id === "DS01" ? { ...r, amount: "0" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("PrescriptionDoses") && p.includes("DS01")), problems.join("\n"));
});

test("checkSheet flags no active Primary user", () => {
  const tables = clone(fixtureTables());
  tables.Users = tables.Users.map(r => (r.user_id === "U01" ? { ...r, role: "Family" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.toLowerCase().includes("primary")), problems.join("\n"));
});

test("checkSheet flags duplicate display names", () => {
  const tables = clone(fixtureTables());
  tables.Users = tables.Users.map(r => (r.user_id === "U02" ? { ...r, display_name: "Dad" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("U01") && p.includes("U02")), problems.join("\n"));
});

test("checkSheet flags a Sharing row with an unknown section or access", () => {
  const tables = clone(fixtureTables());
  tables.Sharing = tables.Sharing.map(r => (r.sharing_id === "SH01" ? { ...r, section: "Bogus", access: "Delete" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("Sharing") && p.includes("SH01") && p.includes("Bogus")), problems.join("\n"));
  assert.ok(problems.some(p => p.includes("Sharing") && p.includes("SH01") && p.includes("Delete")), problems.join("\n"));
});

test("checkSheet names an Active, non-As-needed prescription that has no dose rows at all", () => {
  const tables = clone(fixtureTables());
  tables.PrescriptionDoses = tables.PrescriptionDoses.filter(r => r.prescription_id !== "RX01");
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("Prescriptions") && p.includes("RX01") && p.toLowerCase().includes("no dose rows")), problems.join("\n"));
  // RX04 is Active but "As needed" (no dose rows by design) -- must never be flagged.
  assert.ok(!problems.some(p => p.includes("RX04")), problems.join("\n"));
});

test("checkSheet flags a Users row with a blank active cell", () => {
  const tables = clone(fixtureTables());
  tables.Users = tables.Users.map(r => (r.user_id === "U03" ? { ...r, active: "" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("Users") && p.includes("U03") && p.toLowerCase().includes("active")), problems.join("\n"));
});

test("checkSheet names a date_of_birth the app cannot read, and says how to write it", () => {
  const tables = clone(fixtureTables());
  tables.EmergencyCards = tables.EmergencyCards.map(r => (r.user_id === "U01" ? { ...r, date_of_birth: "14/07/1962" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(
    problems.some(p => p.includes("EmergencyCards") && p.includes("U01") && p.includes("14/07/1962") && p.includes("YYYY-MM-DD")),
    problems.join("\n"),
  );
});

test("checkSheet accepts a blank date_of_birth", () => {
  const tables = clone(fixtureTables());
  tables.EmergencyCards = tables.EmergencyCards.map(r => ({ ...r, date_of_birth: "" }));
  assert.deepEqual(runCheckSheet(tables).filter(p => p.includes("date_of_birth")), []);
});

test("checkSheet names an emergency card whose user_id is not in Users", () => {
  const tables = clone(fixtureTables());
  tables.EmergencyCards = tables.EmergencyCards.map(r => (r.user_id === "U02" ? { ...r, user_id: "U99" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("EmergencyCards") && p.includes("U99") && p.includes("Users")), problems.join("\n"));
});

test("checkSheet says nothing about an empty photo_folder_id: setUpPhotoFolder fills it in", () => {
  const tables = clone(fixtureTables());
  tables.Settings = tables.Settings.map(r => (r.key === "photo_folder_id" ? { ...r, value: "" } : r));
  // Deliberately no Drive in the context at all: a blank id must never be looked up, so
  // checkSheet must get through this without touching Drive even once.
  const context = loadGs();
  context.SpreadsheetApp = fakeSpreadsheetApp(tables);
  const problems = JSON.parse(JSON.stringify(vm.runInContext("checkSheet()", context)));
  assert.deepEqual(problems, []);
});

test("checkSheet reports a photo_folder_id the app cannot open, and says how to fix it", () => {
  const tables = clone(fixtureTables());
  tables.Settings = tables.Settings.map(r => (r.key === "photo_folder_id" ? { ...r, value: "MADE_BY_HAND" } : r));
  const problems = runCheckSheet(tables);
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /photo_folder_id/);
  assert.match(problems[0], /MADE_BY_HAND/);
  assert.match(problems[0], /setUpPhotoFolder/);
});

test("checkSheet reports a Drive permission problem as itself, not as the hand-made-folder advice", () => {
  // The distinction that matters: a 404 means "not a folder this app made", and clearing the
  // Settings cell fixes it. A 403 means the app was never granted the permission, and clearing
  // the cell would not help at all -- it would just hide the real error until it reached a
  // phone. checkSheet must not flatten the second into the first.
  const tables = clone(fixtureTables());
  const problems = runCheckSheet(tables, null, deniedDrive());
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /photo_folder_id/);
  assert.match(problems[0], /Insufficient permissions/);
  assert.doesNotMatch(problems[0], /setUpPhotoFolder/, "clearing the cell is not the fix here, so do not tell them it is");
});

test("checkSheet still never writes to the Sheet while checking the photo folder", () => {
  const tables = clone(fixtureTables());
  const context = loadGs();
  const spreadsheetApp = fakeSpreadsheetApp(tables);
  context.SpreadsheetApp = spreadsheetApp;
  context.Drive = fakeDrive(null); // the folder is unreachable, the worst case
  const settings = spreadsheetApp.getActive().getSheetByName("Settings");
  const before = JSON.stringify(settings.grid);
  const problems = JSON.parse(JSON.stringify(vm.runInContext("checkSheet()", context)));
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.equal(JSON.stringify(settings.grid), before, "reporting the problem must not fix it behind the admin's back");
});

test("checkSheet accepts a Sheet after the app has added a prescription and a medicine through it", () => {
  const tables = clone(fixtureTables());
  const ctx = fakeCtx(tables);
  const token = loginAs(ctx, "Dad", "dad123");
  const med = handle({ action: "addMedicine", token, fields: { generic_name: "Losartan", strength: "50 mg" } }, ctx);
  assert.equal(med.ok, true, JSON.stringify(med));
  const rx = handle({
    action: "addPrescription", token, userId: "U01", medicineId: med.data.medicine_id,
    frequency: "Daily", doses: [{ timeOfDay: "Noon", amount: 1, unit: "tablet" }],
  }, ctx);
  assert.equal(rx.ok, true, JSON.stringify(rx));
  assert.deepEqual(runCheckSheet(tables), [], "the app must never write a row its own checker rejects");
});
