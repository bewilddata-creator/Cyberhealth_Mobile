// Screen models for Meds, medicine detail, Doctors and Emergency (Task 8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/actions.js";
import { fakeCtx, loginAs } from "./fixtures.js";
import { indexBoot, medsModel, detailModel, doctorsModel, emergencyModel, canEditOwner } from "../js/viewmodel.js";

function bootAs(ctx, name, password) {
  const token = loginAs(ctx, name, password);
  const r = handle({ action: "bootstrap", token }, ctx);
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  return { token, boot: r.data };
}

test("medsModel for Dad: 4 active including As needed, 1 stopped with its date", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const idx = indexBoot(boot);
  const model = medsModel(idx, "U01");

  assert.equal(model.active.length, 4);
  assert.ok(model.active.some(x => x.prescription.id === "RX04" && x.prescription.freq === "As needed"));
  assert.equal(model.stopped.length, 1);
  assert.equal(model.stopped[0].prescription.id, "RX06");
  assert.equal(model.stopped[0].stoppedOn, "2026-06-01");

  const rx01 = model.active.find(x => x.prescription.id === "RX01");
  assert.equal(rx01.medicine.generic_name, "Amlodipine");
  assert.equal(rx01.summary, "Every day · Morning 2 tablets");
});

test("medsModel: an As-needed prescription with no dose rows doesn't repeat itself in the summary", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const idx = indexBoot(boot);
  const model = medsModel(idx, "U01");
  const rx04 = model.active.find(x => x.prescription.id === "RX04");
  assert.ok(rx04);
  assert.equal(rx04.doses.length, 0);
  assert.equal(rx04.summary, "When needed");
});

test("detailModel for Dad's RX01: doses, doctor, hospital, HN, history newest first", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const idx = indexBoot(boot);
  const model = detailModel(idx, "U01", "RX01");

  assert.ok(model);
  assert.equal(model.medicine.generic_name, "Amlodipine");
  assert.equal(model.doses.length, 1);
  assert.equal(model.doses[0].amount, 2);
  assert.equal(model.doctor.doctor_id, "DOC01");
  assert.equal(model.hospital.hospital_id, "HOS01");
  assert.equal(model.hn, "0045821");
  assert.equal(model.photos.length, 5);

  assert.equal(model.history.length, 2);
  assert.equal(model.history[0].changedAt, "2026-03-12 10:00");
  assert.equal(model.history[0].changedByName, "Pim");
  assert.equal(model.history[1].changedAt, "2026-01-10 09:00");
});

test("detailModel returns null when the prescription belongs to someone else", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const idx = indexBoot(boot);
  // RX05 belongs to Pim (U02); asking for it under Dad (U01) must not leak it.
  assert.equal(detailModel(idx, "U01", "RX05"), null);
});

test("detailModel returns null for an unknown prescription id", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const idx = indexBoot(boot);
  assert.equal(detailModel(idx, "U01", "RX-NOPE"), null);
});

test("doctorsModel for Dad: 2 active care-team rows, Dr. Somchai's other hospital is Northgate", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const idx = indexBoot(boot);
  const rows = doctorsModel(idx, "U01");

  assert.equal(rows.length, 2);
  const somchai = rows.find(r => r.doctor.name === "Dr. Somchai K.");
  assert.ok(somchai);
  assert.equal(somchai.hospital.hospital_id, "HOS01");
  assert.equal(somchai.hn, "0045821");
  assert.deepEqual(somchai.otherHospitals, ["Northgate Kidney Center"]);
});

test("doctorsModel scoped to the owner: Pim's care team never includes Dad's rows", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Pim", "pim123");
  const idx = indexBoot(boot);
  const rows = doctorsModel(idx, "U02");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].doctor.doctor_id, "DOC01");
  assert.equal(rows[0].hospital.hospital_id, "HOS02");
  // Pim sees Dr. Somchai at Northgate (HOS02), but her HospitalNumbers row is at Riverside
  // (HOS01) -- this must read "", never her Riverside HN or Dad's Northgate HN (26-11873).
  assert.equal(rows[0].hn, "");
});

test("emergencyModel parses allergies, conditions and age", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const model = emergencyModel(boot, "U01");

  assert.ok(model);
  assert.deepEqual(model.allergies, [
    { what: "Penicillin", reaction: "rash" },
    { what: "Shellfish", reaction: "hives" },
  ]);
  assert.deepEqual(model.conditions, ["Hypertension", "Diabetes"]);
  assert.equal(model.age, 73); // born 1953-04-12, today (fixture) 2026-09-15
});

test("emergencyModel works from a minimal {emergency, today} shape (the public flow)", () => {
  const cards = [{ user_id: "U01", display_name: "Somsak", full_name: "Somsak", date_of_birth: "1953-04-12", blood_type: "B+", allergies: "", conditions: "", current_medicines: [] }];
  const model = emergencyModel({ emergency: cards, today: "2026-09-15" }, "U01");
  assert.ok(model);
  assert.equal(model.age, 73);
  assert.deepEqual(model.allergies, []);
  assert.equal(model.hospital_numbers, undefined, "the public card never carries hospital_numbers");
});

test("emergencyModel returns null for an unknown user", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  assert.equal(emergencyModel(boot, "U-NOPE"), null);
});

test("canEditOwner reads the grant bootstrap already sent for each person", () => {
  // indexBoot reads these eight arrays; bootFixture() does not exist, so build the object here.
  const idx = indexBoot({
    today: "2026-09-18", dose_log: [], medicines: [], hospitals: [], doctors: [],
    prescriptions: [], doses: [], changes: [],
    me: { user_id: "U02", display_name: "Pim", role: "Family" },
    people: [
      { user_id: "U01", display_name: "Dad", role: "Primary", medicines: "Edit", care_team: "View" },
      { user_id: "U02", display_name: "Pim", role: "Family", medicines: "Edit", care_team: "Edit" },
      { user_id: "U03", display_name: "Top", role: "Family", medicines: "View", care_team: "" },
      { user_id: "U05", display_name: "Nan", role: "Family", medicines: "", care_team: "" },
    ],
  });
  assert.equal(canEditOwner(idx, "U01"), true, "an Edit share");
  assert.equal(canEditOwner(idx, "U02"), true, "yourself — the server always grants Edit on your own");
  assert.equal(canEditOwner(idx, "U03"), false, "View only");
  assert.equal(canEditOwner(idx, "U05"), false, "no share at all");
  assert.equal(canEditOwner(idx, "U99"), false, "somebody the payload never mentioned");
});

test("detailModel offers Delete only while nothing has been ticked against the prescription", () => {
  // The shared fixture's DoseLog is empty, so this builds the two cases directly.
  const prescription = (id, medicineId) => ({ id, userId: "U01", medicineId, freq: "Daily", n: 0, days: [], countFrom: "", meal: "Any time", doctorId: "", status: "Active", startedOn: "2026-01-01", notes: "" });
  const idx = indexBoot({
    today: "2026-09-18", medicines: [], hospitals: [], doctors: [], people: [], doses: [], changes: [],
    prescriptions: [prescription("RX01", "MED01"), prescription("RX02", "MED02")],
    dose_log: [{ log_id: "L1", prescription_id: "RX01", date: "2026-09-17", time_of_day: "Morning", amount_taken: "1", unit: "tablet", status: "Taken", taken_at: "2026-09-17 08:00", taken_by: "U01" }],
  });
  assert.equal(detailModel(idx, "U01", "RX01").canDelete, false, "a ticked prescription can only be stopped");
  assert.equal(detailModel(idx, "U01", "RX02").canDelete, true, "nothing ticked, so it can still be deleted");
});
