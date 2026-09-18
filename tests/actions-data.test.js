import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/actions.js";
import { fakeCtx, loginAs } from "./fixtures.js";

const code = r => (r.ok ? "OK" : r.error.code);
const noSecrets = data => {
  const json = JSON.stringify(data);
  assert.ok(!json.includes("password_hash"), "response leaked password_hash key");
  assert.ok(!json.includes("reset_code"), "response leaked reset_code key");
  assert.ok(!json.includes("123456"), "response leaked Top's reset code");
};

// ---- publicEmergency ----

test("publicEmergency: every active user's card, no login, no hospital_numbers key anywhere", () => {
  const ctx = fakeCtx();
  const r = handle({ action: "publicEmergency" }, ctx);
  assert.equal(code(r), "OK");
  assert.equal(r.data.length, 3); // U01 Dad, U02 Pim, U03 Top -- U04 Old is inactive
  r.data.forEach(c => assert.ok(!("hospital_numbers" in c)));
  const json = JSON.stringify(r.data);
  assert.ok(!json.includes("0045821"), "leaked an HN value with no login");
  assert.ok(!json.includes("26-11873"), "leaked an HN value with no login");
  noSecrets(r.data);

  const dad = r.data.find(c => c.user_id === "U01");
  assert.equal(dad.full_name, "Somsak");
  assert.equal(dad.blood_type, "B+");
  assert.deepEqual(dad.current_medicines, ["Amlodipine 5 mg", "Metformin 500 mg", "Epoetin alfa 4,000 IU"]);

  const top = r.data.find(c => c.user_id === "U03");
  assert.equal(top.full_name, ""); // Top has no EmergencyCards row at all
  assert.deepEqual(top.current_medicines, []);
});

test("publicEmergency: a duplicate Active prescription for the same medicine is collapsed in current_medicines, same as Today/Meds", () => {
  const ctx = fakeCtx();
  ctx.db.tables.Prescriptions.push({
    prescription_id: "RX98", user_id: "U01", medicine_id: "MED01", frequency: "Daily", every_n_days: "",
    weekdays: "", count_from: "", meal_timing: "Any time", doctor_id: "", status: "Active",
    started_on: "2026-01-01", notes: "", created_at: "", created_by: "", updated_at: "", updated_by: "",
  });
  const r = handle({ action: "publicEmergency" }, ctx);
  const dad = r.data.find(c => c.user_id === "U01");
  // RX98 duplicates RX01 (both Active, U01, MED01) -- Amlodipine must still appear once, first by
  // prescription order, not twice.
  assert.deepEqual(dad.current_medicines, ["Amlodipine 5 mg", "Metformin 500 mg", "Epoetin alfa 4,000 IU"]);
});

// ---- bootstrap ----

test("Dad's bootstrap: grants, visible prescriptions/doses/HN/care-team, complete libraries, cards, no secrets", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const r = handle({ action: "bootstrap", token }, ctx);
  assert.equal(code(r), "OK");
  const d = r.data;

  assert.equal(d.today, "2026-09-15");
  assert.equal(d.nowTimeOfDay, "Morning");
  assert.deepEqual(d.me, { user_id: "U01", display_name: "Dad", role: "Primary" });

  assert.deepEqual(d.people, [
    { user_id: "U01", display_name: "Dad", role: "Primary", medicines: "Edit", care_team: "Edit" },
    { user_id: "U02", display_name: "Pim", role: "Family", medicines: "", care_team: "" },
    { user_id: "U03", display_name: "Top", role: "Family", medicines: "", care_team: "" },
  ]);

  assert.deepEqual(d.prescriptions.map(p => p.id).sort(), ["RX01", "RX02", "RX03", "RX04", "RX06"]);
  assert.deepEqual(d.doses.map(x => x.id).sort(), ["DS01", "DS02", "DS03", "DS04", "DS06"]);
  assert.deepEqual(d.changes.map(c => c.change_id).sort(), ["CH01", "CH02", "CH03", "CH04"]);
  assert.deepEqual(d.dose_log, []);
  assert.deepEqual(d.hospital_numbers.map(h => h.hn_id).sort(), ["HN01", "HN02"]);
  assert.deepEqual(d.care_team.map(c => c.care_id).sort(), ["CT01", "CT02"]);

  assert.equal(d.medicines.length, 5);
  assert.equal(d.hospitals.length, 2);
  assert.equal(d.doctors.length, 2);
  assert.equal(d.doctor_hospitals.length, 3);
  d.medicines.forEach(m => assert.ok(!("_row" in m)));

  assert.equal(d.emergency.length, 3);
  const dadCard = d.emergency.find(c => c.user_id === "U01");
  assert.deepEqual(dadCard.hospital_numbers, [
    { hospital_name: "Riverside General Hospital", hn: "0045821", phone: "02-555-0110" },
    { hospital_name: "Northgate Kidney Center", hn: "26-11873", phone: "02-555-0167" },
  ]);
  const pimCard = d.emergency.find(c => c.user_id === "U02");
  assert.ok(!("hospital_numbers" in pimCard), "Dad can't read Pim's Care team, so no HN on her card");
  const topCard = d.emergency.find(c => c.user_id === "U03");
  assert.ok(!("hospital_numbers" in topCard));
  assert.deepEqual(topCard.current_medicines, []);

  assert.deepEqual(d.warnings, []);
  noSecrets(d);
});

test("Pim's bootstrap: Dad's Medicines Edit / Care team View grants let her see everything but Top", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "bootstrap", token }, ctx);
  assert.equal(code(r), "OK");
  const d = r.data;

  assert.deepEqual(d.people, [
    { user_id: "U01", display_name: "Dad", role: "Primary", medicines: "Edit", care_team: "View" },
    { user_id: "U02", display_name: "Pim", role: "Family", medicines: "Edit", care_team: "Edit" },
    { user_id: "U03", display_name: "Top", role: "Family", medicines: "", care_team: "" },
  ]);

  assert.deepEqual(d.prescriptions.map(p => p.id).sort(), ["RX01", "RX02", "RX03", "RX04", "RX05", "RX06"]);
  assert.deepEqual(d.hospital_numbers.map(h => h.hn_id).sort(), ["HN01", "HN02", "HN03"]);
  assert.deepEqual(d.care_team.map(c => c.care_id).sort(), ["CT01", "CT02", "CT03"]);

  const dadCard = d.emergency.find(c => c.user_id === "U01");
  assert.ok("hospital_numbers" in dadCard, "Pim has View on Dad's Care team");
  assert.equal(dadCard.hospital_numbers.length, 2);
  noSecrets(d);
});

test("Top's bootstrap: Medicines View on Pim (SH03) plus Medicines Edit / Care team View on Dad (SH01/SH02)", () => {
  const ctx = fakeCtx();
  const spResult = handle({ action: "setPassword", name: "Top", code: "123456", newPassword: "top1234" }, ctx);
  const token = spResult.data.token;
  const r = handle({ action: "bootstrap", token }, ctx);
  assert.equal(code(r), "OK");
  const d = r.data;

  assert.deepEqual(d.people, [
    { user_id: "U01", display_name: "Dad", role: "Primary", medicines: "Edit", care_team: "View" },
    { user_id: "U02", display_name: "Pim", role: "Family", medicines: "View", care_team: "" },
    { user_id: "U03", display_name: "Top", role: "Family", medicines: "Edit", care_team: "Edit" },
  ]);

  assert.deepEqual(d.prescriptions.map(p => p.id).sort(), ["RX01", "RX02", "RX03", "RX04", "RX05", "RX06"]);
  assert.deepEqual(d.hospital_numbers.map(h => h.hn_id).sort(), ["HN01", "HN02"]);
  assert.deepEqual(d.care_team.map(c => c.care_id).sort(), ["CT01", "CT02"]);

  const pimCard = d.emergency.find(c => c.user_id === "U02");
  assert.ok(!("hospital_numbers" in pimCard), "Top has no Care team grant on Pim");
  noSecrets(d);
});

test("bootstrap warns on an unknown frequency and a zero amount, drops those rows, ignores a blank spacer row", () => {
  const ctx = fakeCtx();
  ctx.db.tables.Prescriptions.push({
    prescription_id: "RX99", user_id: "U01", medicine_id: "MED01", frequency: "Bogus", every_n_days: "",
    weekdays: "", count_from: "", meal_timing: "Any time", doctor_id: "", status: "Active",
    started_on: "2026-01-01", notes: "", created_at: "", created_by: "", updated_at: "", updated_by: "",
  });
  ctx.db.tables.Prescriptions.push({
    prescription_id: "", user_id: "", medicine_id: "", frequency: "", every_n_days: "",
    weekdays: "", count_from: "", meal_timing: "", doctor_id: "", status: "",
    started_on: "", notes: "", created_at: "", created_by: "", updated_at: "", updated_by: "",
  });
  ctx.db.tables.PrescriptionDoses.push({ dose_id: "DS99", prescription_id: "RX01", time_of_day: "Morning", amount: "0", unit: "tablet" });

  const token = loginAs(ctx, "Dad", "dad123");
  const r = handle({ action: "bootstrap", token }, ctx);
  assert.equal(code(r), "OK");
  // Warnings are objects naming the owner (user_id), not bare strings, so the client can show a
  // per-person banner on Today (see C2's ruling) as well as the full list on More.
  assert.deepEqual(r.data.warnings, [
    { user_id: "U01", message: 'Prescriptions row RX99: unknown frequency "Bogus"' },
    { user_id: "U01", message: "PrescriptionDoses row DS99: amount must be a number above 0" },
  ]);
  assert.ok(!r.data.prescriptions.some(p => p.id === "RX99"));
  assert.ok(!r.data.doses.some(dd => dd.id === "DS99"));
});

test("bootstrap requires login", () => {
  const ctx = fakeCtx();
  assert.equal(code(handle({ action: "bootstrap" }, ctx)), "AUTH_REQUIRED");
});

test("bootstrap warns (naming both ids and the person) when two Active prescriptions cover the same person and medicine, and Today shows only the first", () => {
  const ctx = fakeCtx();
  ctx.db.tables.Prescriptions.push({
    prescription_id: "RX99", user_id: "U01", medicine_id: "MED01", frequency: "Daily", every_n_days: "",
    weekdays: "", count_from: "", meal_timing: "Any time", doctor_id: "", status: "Active",
    started_on: "2026-01-01", notes: "", created_at: "", created_by: "", updated_at: "", updated_by: "",
  });
  const token = loginAs(ctx, "Dad", "dad123");
  const r = handle({ action: "bootstrap", token }, ctx);
  assert.equal(code(r), "OK");
  const w = r.data.warnings.find(x => x.message.includes("RX01") && x.message.includes("RX99"));
  assert.ok(w, JSON.stringify(r.data.warnings));
  assert.equal(w.user_id, "U01");
  assert.match(w.message, /Dad/);
  // Both rows still come back from bootstrap (so the Meds screen can list them for fixing) --
  // it's the pure schedule.js/viewmodel.js layer that collapses which one Today shows.
  assert.ok(r.data.prescriptions.some(p => p.id === "RX01"));
  assert.ok(r.data.prescriptions.some(p => p.id === "RX99"));
});

test("bootstrap warns (naming both ids and the person) when two PrescriptionDoses rows cover the same prescription and time of day", () => {
  const ctx = fakeCtx();
  ctx.db.tables.PrescriptionDoses.push({ dose_id: "DS99", prescription_id: "RX01", time_of_day: "Morning", amount: "9", unit: "tablet" });
  const token = loginAs(ctx, "Dad", "dad123");
  const r = handle({ action: "bootstrap", token }, ctx);
  assert.equal(code(r), "OK");
  const w = r.data.warnings.find(x => x.message.includes("DS01") && x.message.includes("DS99"));
  assert.ok(w, JSON.stringify(r.data.warnings));
  assert.equal(w.user_id, "U01");
  assert.match(w.message, /Dad/);
});

test("bootstrap warns (naming the person) when an Active, non-As-needed prescription has no dose rows", () => {
  const ctx = fakeCtx();
  ctx.db.tables.PrescriptionDoses = ctx.db.tables.PrescriptionDoses.filter(r => r.prescription_id !== "RX01");
  const token = loginAs(ctx, "Dad", "dad123");
  const r = handle({ action: "bootstrap", token }, ctx);
  assert.equal(code(r), "OK");
  const w = r.data.warnings.find(x => x.message.includes("RX01"));
  assert.ok(w, JSON.stringify(r.data.warnings));
  assert.equal(w.user_id, "U01");
  assert.match(w.message, /Dad/);
  assert.match(w.message, /no dose rows/);
  // RX04 (As needed, no doses by design) must never trigger this warning.
  assert.ok(!r.data.warnings.some(x => x.message.includes("RX04")));
});

// ---- tick ----
// RX01's Morning dose row is DS01, amount 2 tablet (see tests/fixtures.js) -- the client always
// sends the doseId and amount it showed, so the server can catch a Sheet edit made after the
// phone's last load (I1).

test("tick: Dad ticks RX01 Morning today, and repeating it is idempotent", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const r = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(code(r), "OK");
  assert.equal(r.data.log_id, "LOG-000001");
  assert.equal(r.data.amount_taken, "2");
  assert.equal(r.data.unit, "tablet");
  assert.equal(r.data.status, "Taken");
  assert.equal(r.data.taken_by, "U01");
  assert.equal(ctx.db.tables.DoseLog.length, 1);

  const again = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(code(again), "OK");
  assert.equal(again.data.log_id, "LOG-000001");
  assert.equal(ctx.db.tables.DoseLog.length, 1);
});

test("tick: only the owner can tick", () => {
  const ctx = fakeCtx();
  const pimToken = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "tick", token: pimToken, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(code(r), "FORBIDDEN");
  assert.equal(r.error.message, "Only Dad can tick these doses.");
  assert.equal(ctx.db.tables.DoseLog.length, 0);
});

test("tick: a future date is refused", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const r = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-16", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(code(r), "FUTURE_DATE");
  assert.equal(r.error.message, "You can't tick a future date.");
  assert.equal(ctx.db.tables.DoseLog.length, 0);
});

test("tick: NOT_DUE for a time of day with no dose row, a day the prescription isn't due, and a stopped prescription", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const evening = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Evening", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(code(evening), "NOT_DUE");

  const tuesday = handle({ action: "tick", token, prescriptionId: "RX03", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS04", amount: 1 }, ctx);
  assert.equal(code(tuesday), "NOT_DUE"); // RX03 is Weekdays: Wed only; 2026-09-15 is a Tuesday

  const stopped = handle({ action: "tick", token, prescriptionId: "RX06", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS06", amount: 1 }, ctx);
  assert.equal(code(stopped), "NOT_DUE"); // RX06 is Stopped

  assert.equal(ctx.db.tables.DoseLog.length, 0);
});

test("tick: a late tick for yesterday is allowed", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const r = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-14", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(code(r), "OK");
  assert.equal(ctx.db.tables.DoseLog.length, 1);
  assert.equal(ctx.db.tables.DoseLog[0].date, "2026-09-14");
});

test("tick: BAD_INPUT for a bad date or time of day", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  assert.equal(code(handle({ action: "tick", token, prescriptionId: "RX01", date: "not-a-date", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx)), "BAD_INPUT");
  assert.equal(code(handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Midnight", doseId: "DS01", amount: 2 }, ctx)), "BAD_INPUT");
  assert.equal(ctx.db.tables.DoseLog.length, 0);
});

test("tick: CONFLICT when the Sheet's amount no longer matches what the phone sent, and nothing is written (I1)", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // The Sheet is edited (DS01 1 -> 3) after the phone loaded, but the phone still sends what it
  // showed (2, the fixture's original amount).
  ctx.db.update("PrescriptionDoses", "dose_id", "DS01", { amount: "3" });
  const r = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(code(r), "CONFLICT");
  assert.equal(r.error.message, "This dose changed in the Sheet. The app has refreshed — check the amount and tick again.");
  assert.equal(ctx.db.tables.DoseLog.length, 0);
});

test("tick: CONFLICT when the dose row id itself no longer matches (a different dose row now covers that slot)", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const r = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS-STALE", amount: 2 }, ctx);
  assert.equal(code(r), "CONFLICT");
  assert.equal(ctx.db.tables.DoseLog.length, 0);
});

test("tick: an already-Taken row is still returned idempotently even if the Sheet's dose has since changed (I1's ruling)", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const first = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(code(first), "OK");
  ctx.db.update("PrescriptionDoses", "dose_id", "DS01", { amount: "3" });
  // A stale retry (still claiming the old amount) must not conflict: the dose was already logged.
  const again = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(code(again), "OK");
  assert.equal(again.data.log_id, first.data.log_id);
  assert.equal(ctx.db.tables.DoseLog.length, 1);
});

// ---- tickAll ----

test("tickAll: ticks only the caller's own, due, not-yet-ticked ids; a repeat skips everything", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const items = [
    { prescriptionId: "RX01", doseId: "DS01", amount: 2 },
    { prescriptionId: "RX02", doseId: "DS02", amount: 1 },
    { prescriptionId: "RX05", doseId: "DS05", amount: 0.5 },
    { prescriptionId: "RX99", doseId: "DS-NOPE", amount: 1 },
  ];
  const r = handle({ action: "tickAll", token, date: "2026-09-15", timeOfDay: "Morning", items }, ctx);
  assert.equal(code(r), "OK");
  assert.deepEqual(r.data.ticked.map(x => x.prescription_id).sort(), ["RX01", "RX02"]);
  assert.deepEqual(r.data.skipped.sort(), ["RX05", "RX99"]); // RX05 is Pim's; RX99 doesn't exist
  assert.equal(ctx.db.tables.DoseLog.length, 2);

  const again = handle({ action: "tickAll", token, date: "2026-09-15", timeOfDay: "Morning", items }, ctx);
  assert.equal(code(again), "OK");
  assert.deepEqual(again.data.ticked, []);
  assert.deepEqual(again.data.skipped.sort(), ["RX01", "RX02", "RX05", "RX99"]);
  assert.equal(ctx.db.tables.DoseLog.length, 2);
});

test("tickAll: BAD_INPUT when items is missing, not an array, or empty", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  for (const items of [undefined, "RX01", [], null]) {
    const r = handle({ action: "tickAll", token, date: "2026-09-15", timeOfDay: "Morning", items }, ctx);
    assert.equal(code(r), "BAD_INPUT");
  }
  assert.equal(ctx.db.tables.DoseLog.length, 0);
});

test("tickAll: one item with a stale amount is skipped as a conflict; the rest still tick (I1)", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const items = [
    { prescriptionId: "RX01", doseId: "DS01", amount: 2 },
    { prescriptionId: "RX02", doseId: "DS02", amount: 99 }, // stale: the Sheet's DS02 is 1, not 99
  ];
  const r = handle({ action: "tickAll", token, date: "2026-09-15", timeOfDay: "Morning", items }, ctx);
  assert.equal(code(r), "OK");
  assert.deepEqual(r.data.ticked.map(x => x.prescription_id), ["RX01"]);
  assert.deepEqual(r.data.skipped, ["RX02"]);
  assert.equal(ctx.db.tables.DoseLog.length, 1);
});

// ---- untick ----

test("untick removes the Taken row; owner only", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(ctx.db.tables.DoseLog.length, 1);

  const pimToken = loginAs(ctx, "Pim", "pim123");
  const forbidden = handle({ action: "untick", token: pimToken, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning" }, ctx);
  assert.equal(code(forbidden), "FORBIDDEN");
  assert.equal(forbidden.error.message, "Only Dad can untick these doses.");
  assert.equal(ctx.db.tables.DoseLog.length, 1);

  const r = handle({ action: "untick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning" }, ctx);
  assert.equal(code(r), "OK");
  assert.deepEqual(r.data, { removed: 1 });
  assert.equal(ctx.db.tables.DoseLog.length, 0);

  const again = handle({ action: "untick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning" }, ctx);
  assert.equal(code(again), "OK");
  assert.deepEqual(again.data, { removed: 0 });
});

// ---- saveEmergencyCard ----

test("saveEmergencyCard: owner updates her own card; bogus fields are ignored", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "saveEmergencyCard", token, fields: { blood_type: "AB+", password_hash: "hack", role: "Primary", user_id: "U01" } }, ctx);
  assert.equal(code(r), "OK");
  assert.equal(r.data.user_id, "U02");
  assert.equal(r.data.blood_type, "AB+");
  assert.equal(r.data.full_name, "Pim"); // untouched field keeps its old value

  const row = ctx.db.tables.EmergencyCards.find(c => c.user_id === "U02");
  assert.equal(row.blood_type, "AB+");
  assert.equal(row.updated_by, "U02");
  assert.equal(row.updated_at, "2026-09-15 08:00");
  assert.ok(!("password_hash" in row));
  assert.ok(!("role" in row));
  assert.equal(ctx.db.tables.EmergencyCards.length, 2); // no new row created
});

test("saveEmergencyCard: creates a card when the caller has none, and caps fields to 500 characters", () => {
  const ctx = fakeCtx();
  const spResult = handle({ action: "setPassword", name: "Top", code: "123456", newPassword: "top1234" }, ctx);
  const token = spResult.data.token;
  const longNotes = "x".repeat(600);
  const r = handle({ action: "saveEmergencyCard", token, fields: { full_name: "Top Person", notes: longNotes } }, ctx);
  assert.equal(code(r), "OK");
  assert.equal(r.data.user_id, "U03");
  assert.equal(r.data.full_name, "Top Person");
  assert.equal(r.data.notes.length, 500);
  assert.equal(r.data.notes, "x".repeat(500));

  assert.equal(ctx.db.tables.EmergencyCards.length, 3);
  const row = ctx.db.tables.EmergencyCards.find(c => c.user_id === "U03");
  assert.equal(row.full_name, "Top Person");
  assert.equal(row.notes.length, 500);
});

test("saveEmergencyCard: a bad date_of_birth is BAD_INPUT and writes nothing", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "saveEmergencyCard", token, fields: { date_of_birth: "13/13/2026" } }, ctx);
  assert.equal(code(r), "BAD_INPUT");
  assert.equal(r.error.message, "Date of birth must be a valid date.");
  assert.equal(ctx.db.tables.EmergencyCards.find(c => c.user_id === "U02").date_of_birth, "");
});

test("saveEmergencyCard requires login", () => {
  const ctx = fakeCtx();
  assert.equal(code(handle({ action: "saveEmergencyCard", fields: { blood_type: "O+" } }, ctx)), "AUTH_REQUIRED");
});

// ---- the emergency card names the box, not just the ingredient ----
//
// The card is read by a paramedic or a pharmacist off a phone screen. The brand is what is
// written on the box at home; the generic is what they need to dispense. Both, in that order.

test("current_medicines leads with the brand and keeps the generic in brackets", () => {
  const ctx = fakeCtx();
  ctx.db.update("Medicines", "medicine_id", "MED01", { brand_name: "Norvasc" });
  ctx.db.update("Medicines", "medicine_id", "MED02", { brand_name: "Glucophage" });
  const dad = handle({ action: "publicEmergency" }, ctx).data.find(c => c.user_id === "U01");
  assert.deepEqual(dad.current_medicines, ["Norvasc (Amlodipine) 5 mg", "Glucophage (Metformin) 500 mg", "Epoetin alfa 4,000 IU"]);
});

test("current_medicines says a generic sold under its own name once, and stays plain text", () => {
  const ctx = fakeCtx();
  ctx.db.update("Medicines", "medicine_id", "MED02", { brand_name: "METFORMIN" });
  ctx.db.update("Medicines", "medicine_id", "MED03", { brand_name: "<b>Eprex</b>", strength: "" });
  const dad = handle({ action: "publicEmergency" }, ctx).data.find(c => c.user_id === "U01");
  assert.deepEqual(dad.current_medicines, ["Amlodipine 5 mg", "METFORMIN 500 mg", "<b>Eprex</b> (Epoetin alfa)"]);
  assert.ok(dad.current_medicines.every(m => !m.includes("(")|| !m.includes("()")), "never an empty bracket");
});
