import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/actions.js";
import { fakeCtx, loginAs } from "./fixtures.js";

// ---- Carried forward from Task 3 Step 6: applyPrescriptionChange, exercised through the first
// action that calls it. Pim (U02) edits Dad's (U01) RX01 -- the fixture's SH01 grants the whole
// family Edit on U01's Medicines. RX01 is Amlodipine, Daily, Morning 2 tablet.

test("a dose change appends exactly one history row, with before and after in words", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const before = ctx.db.rows("PrescriptionChanges").length;
  const r = handle({
    action: "changePrescriptionDose",
    token,
    prescriptionId: "RX01",
    doses: [{ timeOfDay: "Morning", amount: 0.5, unit: "tablet" }],
    reason: "Doctor halved it",
  }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const rows = ctx.db.rows("PrescriptionChanges");
  assert.equal(rows.length, before + 1);
  const change = rows[rows.length - 1];
  assert.equal(change.prescription_id, "RX01");
  assert.equal(change.change_type, "Dose changed");
  assert.equal(change.changed_by, "U02", "the acting user, not the owner");
  assert.equal(change.reason, "Doctor halved it");
  assert.match(change.before, /Morning 2 tablets/);
  assert.match(change.after, /Morning 0.5 tablet/);
  assert.match(change.changed_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.ok(change.change_id, "every change row gets an id");
});

test("a prescription write stamps updated_at and updated_by on the Prescriptions row", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }] }, ctx);
  const rx = ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01");
  assert.equal(rx.updated_by, "U02");
  assert.match(rx.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("a reason longer than 500 characters is cut to 500, not refused", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }], reason: "x".repeat(700) }, ctx);
  const rows = ctx.db.rows("PrescriptionChanges");
  assert.equal(rows[rows.length - 1].reason.length, 500);
});

// Amendment A: this fourth test was wrongly omitted from Task 3's carry-forward instructions but
// is required by the plan ledger's ruling R5. It defends a regression that passes every other
// Node test and only breaks in production: the in-memory test database mutates rows in place,
// while the real Apps Script one does not, so returning a not-re-read row looks fine locally and
// hands the phone a row with no timestamps live.
test("the row handed back to the phone carries the stamps that were just written", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }] }, ctx);
  assert.equal(r.data.prescription.updated_by, "U02");
  assert.match(r.data.prescription.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

// ---- Task 4's own tests ----

// Refusals are tested against U02 as the owner. U01's Sharing row (SH01) already grants the
// WHOLE family Edit on his medicines, so no active user can be refused on him.
test("a viewer with only View access cannot change a dose", () => {
  const ctx = fakeCtx();
  const token = handle({ action: "setPassword", name: "Top", code: "123456", newPassword: "shared-code-pw" }, ctx).data.token;
  const r = handle({ action: "changePrescriptionDose", token, prescriptionId: "RX05", doses: [{ timeOfDay: "Bedtime", amount: 1, unit: "tablet" }] }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "FORBIDDEN");
  assert.match(r.error.message, /Pim/, "the message names who to ask");
});

test("someone with no sharing row at all cannot change another person's dose", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123"); // U01 has no grant on U02's medicines
  const r = handle({ action: "changePrescriptionDose", token, prescriptionId: "RX05", doses: [{ timeOfDay: "Bedtime", amount: 1, unit: "tablet" }] }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "FORBIDDEN");
});

// The brief's version of this test creates its fresh medicine through the "addMedicine" action,
// which is Task 5's, not Task 4's, to add -- it does not exist yet in server/actions.js. Using it
// here would leave this test permanently failing (Unknown action) until Task 5 lands, breaking
// this task's "all tests pass before every commit" requirement. The medicine row is inserted
// directly into the fixture instead; everything this test actually exercises (addPrescription's
// writes) is unchanged.
test("addPrescription writes the prescription, its dose rows and a Started history row", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  ctx.db.append("Medicines", { medicine_id: "MED-NEW", generic_name: "Losartan", strength: "50 mg" });
  const r = handle({
    action: "addPrescription", token, userId: "U01", medicineId: "MED-NEW",
    frequency: "Daily", mealTiming: "After meal",
    doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }],
  }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = r.data.prescription.prescription_id;
  assert.ok(id.startsWith("RX-"));
  assert.equal(r.data.doses.length, 1);
  assert.equal(ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === id).length, 1);
  const change = ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === id);
  assert.equal(change.length, 1);
  assert.equal(change[0].change_type, "Started");
  assert.equal(change[0].before, "", "a Started row has nothing before it");
  assert.match(change[0].after, /Every day, after meal: Morning 1 tablet/);
});

test("addPrescription refuses a second active prescription for the same person and medicine", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // RX01 already has U01 on MED01, Active.
  const r = handle({
    action: "addPrescription", token, userId: "U01", medicineId: "MED01",
    frequency: "Daily", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }],
  }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CONFLICT");
});

test("addPrescription allows a medicine whose only other prescription is Stopped", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // RX06 is U01 on MED05, Stopped -- so a fresh active one is fine.
  const r = handle({
    action: "addPrescription", token, userId: "U01", medicineId: "MED05",
    frequency: "Daily", doses: [{ timeOfDay: "Noon", amount: 1, unit: "tablet" }],
  }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("addPrescription refuses a start date in the future", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const r = handle({
    action: "addPrescription", token, userId: "U01", medicineId: "MED05",
    frequency: "Daily", startedOn: "2099-01-01",
    doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }],
  }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
});

test("a viewer with no edit access cannot add a prescription for another person", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123"); // U01 has no grant on U02's medicines
  const before = ctx.db.rows("Prescriptions").length;
  const r = handle({ action: "addPrescription", token, userId: "U02", medicineId: "MED05", frequency: "Daily", doses: [{ timeOfDay: "Noon", amount: 1, unit: "tablet" }] }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "FORBIDDEN");
  assert.equal(ctx.db.rows("Prescriptions").length, before, "no prescription is created when the caller can't edit this person's medicines");
});

test("a viewer with no edit access cannot delete another person's prescription, and it survives", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123"); // U01 has no grant on U02's medicines
  const r = handle({ action: "deletePrescription", token, prescriptionId: "RX05" }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "FORBIDDEN");
  assert.ok(ctx.db.rows("Prescriptions").some(x => x.prescription_id === "RX05"), "the prescription must survive a refused delete");
  assert.equal(ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === "RX05").length, 1, "its dose rows must survive too");
});

test("changePrescriptionSchedule replaces the schedule and records Schedule changed", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // RX05 is U02's Every-2-days prescription; U01 cannot touch it, so use U01's own RX03 (Weekdays Wed).
  const r = handle({ action: "changePrescriptionSchedule", token, prescriptionId: "RX03", frequency: "Weekdays", weekdays: ["Mon", "Thu"] }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const rx = ctx.db.rows("Prescriptions").find(x => x.prescription_id === "RX03");
  assert.equal(rx.frequency, "Weekdays");
  assert.equal(rx.weekdays, "Mon, Thu");
  assert.equal(rx.every_n_days, "", "the every-N fields are cleared, not left stale");
  const rows = ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === "RX03");
  assert.equal(rows[rows.length - 1].change_type, "Schedule changed");
});

test("changePrescriptionSchedule leaves meal_timing untouched when the caller doesn't send one", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // RX01 is "After meal" in the fixture. A frequency-only change must not erase that.
  const r = handle({ action: "changePrescriptionSchedule", token, prescriptionId: "RX01", frequency: "Weekdays", weekdays: ["Mon", "Thu"] }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const rx = ctx.db.rows("Prescriptions").find(x => x.prescription_id === "RX01");
  assert.equal(rx.meal_timing, "After meal", "a schedule-only edit must not silently erase the meal timing");
});

test("changePrescriptionSchedule leaves meal_timing untouched when mealTiming is blank", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // An unselected <select> on the phone submits "" -- a form's first version could easily send
  // this instead of omitting the key entirely. RX01 is "After meal" in the fixture.
  const r = handle({ action: "changePrescriptionSchedule", token, prescriptionId: "RX01", frequency: "Weekdays", weekdays: ["Mon", "Thu"], mealTiming: "" }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const rx = ctx.db.rows("Prescriptions").find(x => x.prescription_id === "RX01");
  assert.equal(rx.meal_timing, "After meal", "a blank mealTiming must not wipe the existing value either");
});

test("changePrescriptionSchedule does change meal_timing when the caller explicitly sends one, including clearing it to Any time", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // RX01 starts "After meal". Sending "Any time" explicitly is the only way to clear a meal
  // timing back to Any time -- this must still work, so the blank/absent guard above cannot be
  // written as "meal_timing defaults to Any time so skip it", only as "blank means absent".
  const r = handle({ action: "changePrescriptionSchedule", token, prescriptionId: "RX01", frequency: "Daily", mealTiming: "Any time" }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const rx = ctx.db.rows("Prescriptions").find(x => x.prescription_id === "RX01");
  assert.equal(rx.meal_timing, "Any time");
});

test("switching to Every N days and back to Daily clears count_from, leaving no stale field", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  handle({ action: "changePrescriptionSchedule", token, prescriptionId: "RX01", frequency: "Every N days", everyNDays: 3, countFrom: "2026-09-15" }, ctx);
  handle({ action: "changePrescriptionSchedule", token, prescriptionId: "RX01", frequency: "Daily" }, ctx);
  const rx = ctx.db.rows("Prescriptions").find(x => x.prescription_id === "RX01");
  assert.equal(rx.every_n_days, "");
  assert.equal(rx.count_from, "");
  assert.equal(rx.weekdays, "");
});

test("stop then restart flips status and records both, and keeps every dose row", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const dosesBefore = ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === "RX01").length;
  assert.equal(handle({ action: "stopPrescription", token, prescriptionId: "RX01", reason: "BP fine now" }, ctx).ok, true);
  assert.equal(ctx.db.rows("Prescriptions").find(x => x.prescription_id === "RX01").status, "Stopped");
  assert.equal(handle({ action: "restartPrescription", token, prescriptionId: "RX01" }, ctx).ok, true);
  assert.equal(ctx.db.rows("Prescriptions").find(x => x.prescription_id === "RX01").status, "Active");
  assert.equal(ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === "RX01").length, dosesBefore);
  const types = ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === "RX01").map(c => c.change_type);
  assert.deepEqual(types.slice(-2), ["Stopped", "Restarted"]);
});

test("restartPrescription refuses when another active prescription now covers the same medicine", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // RX06 is U01/MED05, already Stopped. Add an active MED05, then try to restart RX06.
  handle({ action: "addPrescription", token, userId: "U01", medicineId: "MED05", frequency: "Daily", doses: [{ timeOfDay: "Noon", amount: 1, unit: "tablet" }] }, ctx);
  const r = handle({ action: "restartPrescription", token, prescriptionId: "RX06" }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CONFLICT");
});

test("deletePrescription removes an untouched prescription with its doses and history", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const added = handle({ action: "addPrescription", token, userId: "U01", medicineId: "MED05", frequency: "Daily", doses: [{ timeOfDay: "Noon", amount: 1, unit: "tablet" }] }, ctx);
  const id = added.data.prescription.prescription_id;
  const r = handle({ action: "deletePrescription", token, prescriptionId: id }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ctx.db.rows("Prescriptions").filter(x => x.prescription_id === id).length, 0);
  assert.equal(ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === id).length, 0);
  assert.equal(ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === id).length, 0);
});

test("deletePrescription refuses one that has ever been ticked, and says it can be stopped instead", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // DoseLog starts empty, so tick RX01 first -- only Dad may tick his own.
  const tick = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(tick.ok, true, JSON.stringify(tick));
  const r = handle({ action: "deletePrescription", token, prescriptionId: "RX01" }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CONFLICT");
  assert.match(r.error.message, /stopped/i);
});

test("no prescription action ever touches DoseLog", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  const before = JSON.stringify(ctx.db.rows("DoseLog"));
  handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 0.5, unit: "tablet" }] }, ctx);
  handle({ action: "changePrescriptionSchedule", token, prescriptionId: "RX01", frequency: "Daily" }, ctx);
  handle({ action: "stopPrescription", token, prescriptionId: "RX01" }, ctx);
  handle({ action: "restartPrescription", token, prescriptionId: "RX01" }, ctx);
  assert.equal(JSON.stringify(ctx.db.rows("DoseLog")), before, "a dose already taken must never be rewritten");
});

// Amendment B: the caller's doctorId must never be trusted for the history row -- only what was
// actually committed to the Prescriptions row.
test("the history row's doctor is the one actually on the prescription, not one the caller merely passed", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }], doctorId: "DOC02" }, ctx);
  const rx = ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01");
  const changes = ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === "RX01");
  assert.equal(changes[changes.length - 1].doctor_id, rx.doctor_id, "history and the row it describes must agree");
});

// ---- Task 5's own tests ----

test("addMedicine trims the whitelisted fields and ignores anything else", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "addMedicine", token, fields: { generic_name: "  Losartan ", strength: "50 mg", photo_box: "https://evil/x.jpg", medicine_id: "HACK" } }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.generic_name, "Losartan");
  assert.equal(r.data.photo_box, "", "a photo URL can only be set by uploading");
  assert.ok(r.data.medicine_id.startsWith("MED-"), "the id is the server's, not the caller's");
});

test("addMedicine needs a generic name", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "addMedicine", token, fields: { strength: "50 mg" } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
});

test("updateMedicine changes the shared library row for everyone", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "updateMedicine", token, medicineId: "MED01", fields: { generic_name: "Amlodipine besylate" } }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").generic_name, "Amlodipine besylate");
});

// U03 ("Top") does have a Sharing row in the fixture -- SH03, View on U02's Medicines -- but it
// is beside the point: the library is shared by everyone, so editing it turns on no grant at all.
test("editing the shared library does not depend on any sharing grant", () => {
  const ctx = fakeCtx();
  // Top has no password in the fixture (only a reset code), so set one first -- same pattern as
  // the "viewer with only View access" test above.
  const token = handle({ action: "setPassword", name: "Top", code: "123456", newPassword: "shared-code-pw" }, ctx).data.token;
  assert.equal(handle({ action: "addMedicine", token, fields: { generic_name: "Aspirin" } }, ctx).ok, true);
});

test("a logged-out caller may not touch the library", () => {
  const ctx = fakeCtx();
  const r = handle({ action: "addMedicine", fields: { generic_name: "Aspirin" } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "AUTH_REQUIRED");
});

// ---- the unit is the server's to decide, not the phone's ----
//
// A dose row still carries a unit and DoseLog still snapshots one at tick time: nothing about the
// stored shape changes. What changes is where the value comes from -- the medicine's own form,
// read on the server, instead of four boxes he types the same word into.

const addFor = (ctx, token, over = {}) => handle({
  action: "addPrescription", token, userId: "U01", medicineId: "MED-NEW", frequency: "Daily",
  doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }], ...over,
}, ctx);
const dosesOf = (ctx, id) => ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === id).map(d => `${d.time_of_day} ${d.amount} ${d.unit}`);

test("addPrescription writes the unit the medicine's form implies, not the one it was sent", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  ctx.db.append("Medicines", { medicine_id: "MED-NEW", generic_name: "Lactulose", form: "Liquid" });
  // "tablet" is what an old phone, or anything hand-made, would still send for a syrup.
  const r = addFor(ctx, token, { doses: [{ timeOfDay: "Morning", amount: 15, unit: "tablet" }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(dosesOf(ctx, r.data.prescription.prescription_id), ["Morning 15 ml"]);
});

test("addPrescription needs no unit at all from the phone when the medicine has a form", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  ctx.db.append("Medicines", { medicine_id: "MED-NEW", generic_name: "Seretide", form: "Inhaler" });
  const r = addFor(ctx, token, { doses: [{ timeOfDay: "Morning", amount: 2 }, { timeOfDay: "Bedtime", amount: 1, unit: "" }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(dosesOf(ctx, r.data.prescription.prescription_id), ["Morning 2 puff", "Bedtime 1 puff"]);
  const changes = ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === r.data.prescription.prescription_id);
  assert.match(changes[0].after, /Morning 2 puffs, Bedtime 1 puff/, "the history reads in plain words");
});

// The escape hatch the owner asked for, in the one shape it matters: insulin, counted in
// international units, which no form implies and nobody should have invented one for.
test("a medicine set to Other still takes the unit that was typed — insulin's 'units'", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  ctx.db.append("Medicines", { medicine_id: "MED-NEW", generic_name: "Insulin glargine", form: "Other" });
  const r = addFor(ctx, token, { doses: [{ timeOfDay: "Bedtime", amount: 18, unit: "units" }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(dosesOf(ctx, r.data.prescription.prescription_id), ["Bedtime 18 units"]);
});

test("a cream, an Other or a medicine with no form is refused a blank unit, in plain words", () => {
  for (const form of ["Cream", "Other", ""]) {
    const ctx = fakeCtx();
    const token = loginAs(ctx, "Dad", "dad123");
    ctx.db.append("Medicines", { medicine_id: "MED-NEW", generic_name: "Hydrocortisone", form });
    const r = addFor(ctx, token, { doses: [{ timeOfDay: "Morning", amount: 1, unit: "" }] });
    assert.equal(r.ok, false, `${form || "(blank)"} should be refused`);
    assert.equal(r.error.code, "BAD_INPUT");
    assert.match(r.error.message, /needs a unit, like tablet or ml/);
  }
});

// Agreed with the owner: a prescription typed with the wrong word is quietly put right the next
// time its dose is edited, and the correction is in the history like any other change -- the
// before/after carry the unit, so "Morning 2 pills → Morning 1 tablet" says exactly what moved.
test("a dose edit corrects a stored unit that disagrees with the medicine, and the history says so", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  ctx.db.update("PrescriptionDoses", "dose_id", "DS01", { unit: "pill" });
  const r = handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 1 }] }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(dosesOf(ctx, "RX01"), ["Morning 1 tablet"], "MED01 is a Tablet, so the dose row is a tablet");
  const rows = ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === "RX01");
  const change = rows[rows.length - 1];
  assert.match(change.before, /Morning 2 pills/);
  assert.match(change.after, /Morning 1 tablet/);
});

test("a dose edit leaves history already written exactly as it reads today", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const before = ctx.db.rows("PrescriptionChanges").map(c => `${c.change_id}|${c.before}|${c.after}`);
  handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 1 }] }, ctx);
  const after = ctx.db.rows("PrescriptionChanges").map(c => `${c.change_id}|${c.before}|${c.after}`);
  assert.deepEqual(after.slice(0, before.length), before, "old history rows are never rewritten");
});

// The stored shape does not change: DoseLog still snapshots the unit at tick time, so a dose
// already taken keeps reading as what went in his mouth even after the prescription moves on.
test("a tick still snapshots the unit of the dose it was taken against", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const today = handle({ action: "bootstrap", token }, ctx).data.today;
  // DS01 is RX01's Morning dose in the fixture: 2 tablets of MED01, a Tablet.
  const r = handle({ action: "tick", token, prescriptionId: "RX01", date: today, timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const log = ctx.db.rows("DoseLog").find(l => l.prescription_id === "RX01");
  assert.equal(log.unit, "tablet");
  assert.equal(log.amount_taken, "2");
  // And a later dose change does not reach back and rewrite it.
  handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 1 }] }, ctx);
  assert.equal(ctx.db.rows("DoseLog").find(l => l.prescription_id === "RX01").amount_taken, "2");
});

// F1: the medicine deleted from the library since the prescription was written. Without a guard
// the derivation finds no form, the unit comes back blank, and the family is told "The Morning row
// needs a unit" -- for a tablet, a box the form does not show, about a problem it does not name.
test("a dose edit whose medicine has been deleted from the library says so, in the same words as adding one", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  ctx.db.remove("Medicines", m => String(m.medicine_id).trim() === "MED01"); // RX01's medicine
  const r = handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 1 }] }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
  assert.equal(r.error.message, "That medicine isn't in the list. Add it first.");
  assert.doesNotMatch(r.error.message, /needs a unit/, "never ask for a box the form doesn't show");
  // And nothing is written: not the doses, not a history row.
  assert.deepEqual(dosesOf(ctx, "RX01"), ["Morning 2 tablet"], "the dose rows are untouched");
  assert.equal(ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === "RX01").length, 2, "no history row for a refused edit");
});

test("the same missing medicine is named the same way when adding, so the two paths read alike", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const r = handle({ action: "addPrescription", token, userId: "U01", medicineId: "MED-GONE", frequency: "Daily", doses: [{ timeOfDay: "Morning", amount: 1 }] }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.message, "That medicine isn't in the list. Add it first.");
});
