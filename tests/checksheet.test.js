// Drives checkSheet() from the real generated apps-script/*.gs files, loaded into one
// node:vm context, against a fake SpreadsheetApp built from the shared v2 fixture (see
// tests/fixtures.js and scripts/make_template_v2.py). The clean fixture must report nothing;
// each deliberately broken variant must be named by its tab and row id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { fixtureTables } from "./fixtures.js";
import { fakeSpreadsheetApp } from "./gs-sheet-fake.js";

function loadGs() {
  const context = vm.createContext({ console });
  for (const file of readdirSync("apps-script").filter(f => f.endsWith(".gs")).sort()) {
    vm.runInContext(readFileSync(join("apps-script", file), "utf8"), context, { filename: file });
  }
  return context;
}

function runCheckSheet(tables, columnsByTab) {
  const context = loadGs();
  context.SpreadsheetApp = fakeSpreadsheetApp(tables, columnsByTab || tables.__columns);
  // checkSheet() builds its array inside the vm realm, whose Array is a different
  // constructor than this file's -- deepEqual against a host-realm [] would otherwise fail
  // on prototype identity alone. Round-tripping through JSON gives back a plain host array.
  return JSON.parse(JSON.stringify(vm.runInContext("checkSheet()", context)));
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

test("checkSheet reports an empty photo_folder_id as needed from release 2", () => {
  const tables = clone(fixtureTables());
  tables.Settings = tables.Settings.map(r => (r.key === "photo_folder_id" ? { ...r, value: "" } : r));
  const problems = runCheckSheet(tables);
  assert.ok(problems.some(p => p.includes("photo_folder_id") && p.includes("release 2")), problems.join("\n"));
});
