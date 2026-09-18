import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/actions.js";
import { fakeCtx, loginAs } from "./fixtures.js";
import { indexBoot, todayModel, weekModel, warningsForOwner, defaultOwnerId } from "../js/viewmodel.js";

function bootAs(ctx, name, password) {
  const token = loginAs(ctx, name, password);
  const r = handle({ action: "bootstrap", token }, ctx);
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  return { token, boot: r.data };
}

test("Dad's Today: Morning has RX01 (2 tablet) and RX02 (1 tablet), Evening has RX02 (2 tablet)", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const idx = indexBoot(boot);
  const model = todayModel(idx, { ownerId: "U01", viewerId: "U01", date: "2026-09-15", today: "2026-09-15", nowTimeOfDay: "Morning" });

  const morning = model.slots.find(s => s.timeOfDay === "Morning");
  const rx01 = morning.items.find(i => i.prescription.id === "RX01");
  const rx02 = morning.items.find(i => i.prescription.id === "RX02");
  assert.ok(rx01, "RX01 should be due Morning");
  assert.equal(rx01.dose.amount, 2);
  assert.equal(rx01.dose.unit, "tablet");
  assert.ok(rx02, "RX02 should be due Morning");
  assert.equal(rx02.dose.amount, 1);
  assert.equal(rx02.dose.unit, "tablet");

  const evening = model.slots.find(s => s.timeOfDay === "Evening");
  const rx02Evening = evening.items.find(i => i.prescription.id === "RX02");
  assert.ok(rx02Evening, "RX02 should be due Evening");
  assert.equal(rx02Evening.dose.amount, 2);

  // RX03 (Weekdays: Wed) is absent on Tuesday 15 Sep 2026.
  assert.ok(!model.slots.some(s => s.items.some(i => i.prescription.id === "RX03")));
  // RX06 is Stopped: never due, absent from every slot.
  assert.ok(!model.slots.some(s => s.items.some(i => i.prescription.id === "RX06")));
  // RX04 (As needed) is listed separately, not in any timed slot.
  assert.ok(!model.slots.some(s => s.items.some(i => i.prescription.id === "RX04")));
  assert.deepEqual(model.asNeeded.map(x => x.prescription.id), ["RX04"]);
});

test("Pim viewing Dad's Today: canTick is false", () => {
  const ctx = fakeCtx();
  const { boot: pimBoot } = bootAs(ctx, "Pim", "pim123");
  const idx = indexBoot(pimBoot);
  const model = todayModel(idx, { ownerId: "U01", viewerId: "U02", date: "2026-09-15", today: "2026-09-15", nowTimeOfDay: "Morning" });
  assert.equal(model.viewerIsOwner, false);
  assert.equal(model.canTick, false);
});

test("a ticked item shows the amount logged at the time, even after the dose row later changes", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const tickResult = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(tickResult.ok, true);

  // The dose changes after the tick was recorded.
  const doseRow = ctx.db.rows("PrescriptionDoses").find(d => d.prescription_id === "RX01" && d.time_of_day === "Morning");
  ctx.db.update("PrescriptionDoses", "dose_id", doseRow.dose_id, { amount: "5" });

  const r = handle({ action: "bootstrap", token }, ctx);
  const idx = indexBoot(r.data);
  const model = todayModel(idx, { ownerId: "U01", viewerId: "U01", date: "2026-09-15", today: "2026-09-15", nowTimeOfDay: "Morning" });
  const item = model.slots.find(s => s.timeOfDay === "Morning").items.find(i => i.prescription.id === "RX01");
  assert.equal(item.dose.amount, 5, "the current dose reflects the change");
  assert.equal(item.tick.amount, "2", "the tick still shows what was actually logged");
});

test("canTickAll is true only when more than one dose in the slot is untaken", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const r0 = handle({ action: "bootstrap", token }, ctx);
  const idx0 = indexBoot(r0.data);
  const before = todayModel(idx0, { ownerId: "U01", viewerId: "U01", date: "2026-09-15", today: "2026-09-15", nowTimeOfDay: "Morning" });
  const morningBefore = before.slots.find(s => s.timeOfDay === "Morning");
  assert.equal(morningBefore.due - morningBefore.taken, 2); // RX01 + RX02, both untaken
  assert.equal(morningBefore.canTickAll, true);

  handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  const r1 = handle({ action: "bootstrap", token }, ctx);
  const idx1 = indexBoot(r1.data);
  const after = todayModel(idx1, { ownerId: "U01", viewerId: "U01", date: "2026-09-15", today: "2026-09-15", nowTimeOfDay: "Morning" });
  const morningAfter = after.slots.find(s => s.timeOfDay === "Morning");
  assert.equal(morningAfter.due - morningAfter.taken, 1); // only RX02 left
  assert.equal(morningAfter.canTickAll, false);
});

test("weekModel counts a past day for a prescription only up to its last change", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // RX01 and RX02 are both due 09-13 (Sun) and 09-14 (Mon). Tick RX02's Morning and Evening
  // doses on 09-13, but not RX01's -- if RX01 still counted on 09-13, that day would read
  // "miss" (an untaken due dose); it should read "ok" once RX01 is excluded by the later change.
  handle({ action: "tick", token, prescriptionId: "RX02", date: "2026-09-13", timeOfDay: "Morning", doseId: "DS02", amount: 1 }, ctx);
  handle({ action: "tick", token, prescriptionId: "RX02", date: "2026-09-13", timeOfDay: "Evening", doseId: "DS03", amount: 2 }, ctx);
  ctx.db.append("PrescriptionChanges", {
    change_id: "CH99", prescription_id: "RX01", changed_at: "2026-09-14 10:00", changed_by: "U01",
    change_type: "Dose changed", doctor_id: "DOC01", reason: "test", before: "Morning 2 tablet", after: "Morning 2 tablet",
  });
  const r = handle({ action: "bootstrap", token }, ctx);
  const idx = indexBoot(r.data);

  // 09-13 (Sun) and 09-14 (Mon) fall in different Monday-first weeks, so look each up by
  // anchoring weekModel's "date" on a day in that same week; "today" stays the real today.
  const weekWith13 = weekModel(idx, "U01", "2026-09-13", "2026-09-15", "Morning");
  const weekWith14 = weekModel(idx, "U01", "2026-09-15", "2026-09-15", "Morning");
  const sep13 = weekWith13.find(d => d.date === "2026-09-13");
  const sep14 = weekWith14.find(d => d.date === "2026-09-14");
  assert.ok(sep13, "2026-09-13 is in the Monday-first week anchored on itself");
  assert.ok(sep14, "2026-09-14 is in the Monday-first week containing 2026-09-15");
  // On 09-13 (before the 09-14 change), RX01 is excluded by countsOnDay -- only RX02 counts,
  // and both its doses were ticked, so the day reads "ok".
  assert.equal(sep13.result, "ok");
  // On 09-14 itself the change already applies (countsOnDay: last <= date), so RX01 counts
  // again -- and it was never ticked that day, so the day reads "miss".
  assert.equal(sep14.result, "miss");
});

test("weekModel is Monday-first", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const idx = indexBoot(boot);
  const week = weekModel(idx, "U01", "2026-09-15", "2026-09-15", "Morning");
  assert.equal(week.length, 7);
  assert.equal(week[0].weekday, "Mon");
  assert.equal(week[6].weekday, "Sun");
  assert.ok(week.some(d => d.date === "2026-09-15"));
});

// ---- I2: a Skipped DoseLog row must never render as taken ----

test("indexBoot only turns a status=Taken DoseLog row into a tick; a Skipped row is ignored", () => {
  const boot = {
    dose_log: [
      { date: "2026-09-15", time_of_day: "Morning", prescription_id: "RX01", status: "Taken", amount_taken: "2", unit: "tablet", taken_at: "2026-09-15 08:00" },
      { date: "2026-09-15", time_of_day: "Evening", prescription_id: "RX02", status: "Skipped", amount_taken: "2", unit: "tablet", taken_at: "2026-09-15 20:00" },
    ],
    medicines: [], hospitals: [], doctors: [], people: [], prescriptions: [], doses: [], changes: [],
  };
  const idx = indexBoot(boot);
  assert.ok(idx.ticks.has("2026-09-15|Morning|RX01"), "a Taken row must still be a tick");
  assert.ok(!idx.ticks.has("2026-09-15|Evening|RX02"), "a Skipped row must never be shown as taken");
});

// ---- C2: a duplicate Active prescription for the same person+medicine must not show twice on Today ----

test("todayModel: a second Active prescription for the same person+medicine is collapsed to the first, not shown twice", () => {
  const ctx = fakeCtx();
  ctx.db.tables.Prescriptions.push({
    prescription_id: "RX98", user_id: "U01", medicine_id: "MED01", frequency: "Daily", every_n_days: "",
    weekdays: "", count_from: "", meal_timing: "Any time", doctor_id: "", status: "Active",
    started_on: "2026-01-01", notes: "", created_at: "", created_by: "", updated_at: "", updated_by: "",
  });
  ctx.db.tables.PrescriptionDoses.push({ dose_id: "DS98", prescription_id: "RX98", time_of_day: "Morning", amount: "9", unit: "tablet" });
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const idx = indexBoot(boot);
  const model = todayModel(idx, { ownerId: "U01", viewerId: "U01", date: "2026-09-15", today: "2026-09-15", nowTimeOfDay: "Morning" });
  const morning = model.slots.find(s => s.timeOfDay === "Morning");
  const forMed01 = morning.items.filter(i => i.prescription.medicineId === "MED01");
  assert.equal(forMed01.length, 1, "MED01 must appear once, not once per duplicate Prescriptions row");
  assert.equal(forMed01[0].prescription.id, "RX01", "the first row (by Sheet order) wins");
});

// ---- M2: a day older than the loaded 60-day DoseLog window must never read false "missed" ----

test("todayModel: a date older than the 60-day loaded window flags historyNotLoaded and never reports 'missed'", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const idx = indexBoot(boot);
  const today = "2026-09-15";
  const oldDate = "2026-06-01"; // >90 days before today, and RX01 (Daily, started 2026-01-10) is due
  const model = todayModel(idx, { ownerId: "U01", viewerId: "U01", date: oldDate, today, nowTimeOfDay: "Morning" });
  assert.equal(model.historyNotLoaded, true);
  const morning = model.slots.find(s => s.timeOfDay === "Morning");
  assert.ok(morning.due > 0, "RX01 should still be due that day");
  assert.notEqual(morning.status, "missed", "an untracked old day must never read as a false 'missed'");
});

test("todayModel: a date within the loaded window is unaffected by historyNotLoaded", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const idx = indexBoot(boot);
  const model = todayModel(idx, { ownerId: "U01", viewerId: "U01", date: "2026-08-01", today: "2026-09-15", nowTimeOfDay: "Morning" });
  assert.equal(model.historyNotLoaded, false);
});

test("weekModel: a day older than the loaded window shows no dot, not a false 'miss'", () => {
  const ctx = fakeCtx();
  const { boot } = bootAs(ctx, "Dad", "dad123");
  const idx = indexBoot(boot);
  const week = weekModel(idx, "U01", "2026-06-01", "2026-09-15", "Morning");
  const day = week.find(d => d.date === "2026-06-01");
  assert.ok(day);
  assert.equal(day.result, "", "older than the DoseLog window: no dot, never 'miss'");
});

// ---- A dose he has already ticked must never disappear off Today, and never be offered again ----
//
// The reproduction this release's last review found: Dad ticks RX01 Morning (Amlodipine, 2
// tablet), his daughter then uses "Change how much to take" to clear Morning and fill Noon. The
// ring went 1/3 -> 0/3, the ticked Morning row vanished, and an un-ticked Noon row appeared at 2
// tablet -- the tablet he had already swallowed, presented as outstanding and tickable. That is
// the old version's "prompted a second blood-pressure tablet" bug reached by a new route.

function bootFor(ctx, token) {
  const r = handle({ action: "bootstrap", token }, ctx);
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  return indexBoot(r.data);
}
const dadsDay = idx => todayModel(idx, { ownerId: "U01", viewerId: "U01", date: "2026-09-15", today: "2026-09-15", nowTimeOfDay: "Morning" });

function tickRx01Morning(ctx, token) {
  const r = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
}

// What every one of the three cases below must end up showing.
function assertMorningReceiptSurvives(model) {
  const morning = model.slots.find(s => s.timeOfDay === "Morning");
  const row = morning.items.find(i => i.prescription.id === "RX01");
  assert.ok(row, "the dose he actually took must still show, in the time of day he took it at");
  assert.equal(row.tick.amount, "2", "at the amount the DoseLog row recorded, not whatever the prescription says now");
  assert.equal(row.tick.unit, "tablet");
  assert.equal(row.dose, null, "no current dose row backs it: it is a receipt, not a tickable dose");
  // The ring counted 1 of 3 before the change, and must still count 1 of 3 after it.
  assert.equal(model.taken, 1, "the ring must not under-report what he took");
  assert.equal(model.due, 3);
  // And nothing anywhere offers that same tablet again.
  const offered = model.slots.flatMap(s => s.items).filter(i => i.prescription.id === "RX01" && !i.tick);
  assert.deepEqual(offered, [], "a tablet already swallowed must never be offered as outstanding");
}

test("moving a ticked dose to another time of day keeps it on Today as taken, and never offers that tablet again", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  tickRx01Morning(ctx, token);
  const moved = handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Noon", amount: 2, unit: "tablet" }] }, ctx);
  assert.equal(moved.ok, true, JSON.stringify(moved));

  // The record was never the problem: the DoseLog row survives and the history reads correctly.
  const log = ctx.db.rows("DoseLog").filter(r => r.prescription_id === "RX01");
  assert.equal(log.length, 1);
  assert.equal(log[0].time_of_day, "Morning");
  const changes = ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === "RX01");
  assert.match(changes[changes.length - 1].after, /Noon 2 tablets/);

  const model = dadsDay(bootFor(ctx, token));
  assertMorningReceiptSurvives(model);
  const noon = model.slots.find(s => s.timeOfDay === "Noon");
  assert.equal(noon.due, 0, "the moved dose must not reappear at Noon as something still to take");
  assert.equal(noon.canTickAll, false);
});

test("stopping a medicine does not erase what was already ticked for it today", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  tickRx01Morning(ctx, token);
  assert.equal(handle({ action: "stopPrescription", token, prescriptionId: "RX01" }, ctx).ok, true);
  const model = dadsDay(bootFor(ctx, token));
  assertMorningReceiptSurvives(model);
  assert.equal(model.slots.find(s => s.timeOfDay === "Morning").items.find(i => i.prescription.id === "RX01").prescription.status, "Stopped");
});

test("narrowing a schedule past the viewed day does not erase what was already ticked that day", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  tickRx01Morning(ctx, token);
  // 2026-09-15 is a Tuesday, so Wednesdays-only takes RX01 off that day entirely.
  const r = handle({ action: "changePrescriptionSchedule", token, prescriptionId: "RX01", frequency: "Weekdays", weekdays: ["Wed"] }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assertMorningReceiptSurvives(dadsDay(bootFor(ctx, token)));
});

test("a receipt is not a licence to drop a dose still genuinely due at another time", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // RX02 is Morning 1 tablet AND Evening 2 tablets. Tick the Morning one, then move ONLY the
  // Morning row to Noon: the Evening dose is untouched and must still be offered.
  assert.equal(handle({ action: "tick", token, prescriptionId: "RX02", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS02", amount: 1 }, ctx).ok, true);
  assert.equal(handle({
    action: "changePrescriptionDose", token, prescriptionId: "RX02",
    doses: [{ timeOfDay: "Noon", amount: 1, unit: "tablet" }, { timeOfDay: "Evening", amount: 2, unit: "tablet" }],
  }, ctx).ok, true);
  const model = dadsDay(bootFor(ctx, token));
  const evening = model.slots.find(s => s.timeOfDay === "Evening");
  const stillDue = evening.items.find(i => i.prescription.id === "RX02");
  assert.ok(stillDue, "the Evening dose was never taken and never moved -- it must still be due");
  assert.equal(stillDue.tick, null);
  assert.equal(stillDue.dose.amount, 2);
  // Only the moved Morning dose is accounted for by the receipt.
  assert.equal(model.slots.find(s => s.timeOfDay === "Noon").items.filter(i => i.prescription.id === "RX02").length, 0);
});

test("the week strip counts a receipt too, so the dot and the ring can never disagree", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // Everything due on 2026-09-14 (Mon) ticked: RX01 Morning, RX02 Morning and Evening.
  for (const [rx, time, doseId, amount] of [["RX01", "Morning", "DS01", 2], ["RX02", "Morning", "DS02", 1], ["RX02", "Evening", "DS03", 2]]) {
    assert.equal(handle({ action: "tick", token, prescriptionId: rx, date: "2026-09-14", timeOfDay: time, doseId, amount }, ctx).ok, true);
  }
  // Then RX01's Morning dose is moved to Noon. countsOnDay already excludes RX01 from that past
  // day (its last change is later), so the day must stay "ok" -- and would even without the
  // receipt. What matters is that adding receipts did not turn a fully-ticked day into a miss.
  assert.equal(handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Noon", amount: 2, unit: "tablet" }] }, ctx).ok, true);
  const idx = bootFor(ctx, token);
  const day = weekModel(idx, "U01", "2026-09-15", "2026-09-15", "Morning").find(d => d.date === "2026-09-14");
  assert.equal(day.result, "ok", "a day on which he took everything must never read as a miss");
});

// ---- warningsForOwner (C2's Today banner) ----

test("warningsForOwner shows only warnings for that person, plus sheet-wide (blank user_id) ones", () => {
  const warnings = [
    { user_id: "U01", message: "Dad's thing" },
    { user_id: "U02", message: "Pim's thing" },
    { user_id: "", message: "Sheet-wide thing" },
  ];
  assert.deepEqual(warningsForOwner(warnings, "U01").map(w => w.message), ["Dad's thing", "Sheet-wide thing"]);
  assert.deepEqual(warningsForOwner(warnings, "U02").map(w => w.message), ["Pim's thing", "Sheet-wide thing"]);
  assert.deepEqual(warningsForOwner([], "U01"), []);
});

// ---- defaultOwnerId (M5) ----

test("defaultOwnerId opens on the Primary person when the viewer can read their Medicines", () => {
  const people = [
    { user_id: "U01", display_name: "Dad", role: "Primary", medicines: "View" },
    { user_id: "U02", display_name: "Pim", role: "Family", medicines: "Edit" },
  ];
  assert.equal(defaultOwnerId(people, "U02"), "U01");
});

test("defaultOwnerId falls back to the viewer when Primary's Medicines aren't readable", () => {
  const people = [
    { user_id: "U01", display_name: "Dad", role: "Primary", medicines: "" },
    { user_id: "U02", display_name: "Pim", role: "Family", medicines: "Edit" },
  ];
  assert.equal(defaultOwnerId(people, "U02"), "U02");
});

test("defaultOwnerId falls back to the viewer when no one is Primary", () => {
  const people = [{ user_id: "U02", display_name: "Pim", role: "Family", medicines: "Edit" }];
  assert.equal(defaultOwnerId(people, "U02"), "U02");
});
