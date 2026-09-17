import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/actions.js";
import { fakeCtx, loginAs } from "./fixtures.js";
import { indexBoot, todayModel, weekModel } from "../js/viewmodel.js";

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
  const tickResult = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning" }, ctx);
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

  handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning" }, ctx);
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
  handle({ action: "tick", token, prescriptionId: "RX02", date: "2026-09-13", timeOfDay: "Morning" }, ctx);
  handle({ action: "tick", token, prescriptionId: "RX02", date: "2026-09-13", timeOfDay: "Evening" }, ctx);
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
