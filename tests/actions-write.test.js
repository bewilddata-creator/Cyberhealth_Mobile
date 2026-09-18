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
