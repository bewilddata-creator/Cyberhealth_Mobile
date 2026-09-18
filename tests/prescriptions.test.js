import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDoses, validateScheduleFields, CHANGE_TYPES, MAX_REASON_LENGTH } from "../server/prescriptions.js";
import { FREQ } from "../js/schedule.js";

test("validateDoses accepts one row per time of day and normalises the numbers", () => {
  const r = validateDoses([{ timeOfDay: "Morning", amount: "1", unit: "tablet" }], FREQ.DAILY);
  assert.deepEqual(r, { ok: true, doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }] });
});

test("validateDoses refuses two rows for the same time of day", () => {
  const r = validateDoses([
    { timeOfDay: "Morning", amount: 1, unit: "tablet" },
    { timeOfDay: "Morning", amount: 2, unit: "tablet" },
  ], FREQ.DAILY);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Morning/);
});

test("validateDoses refuses an amount of zero or less, naming the time of day", () => {
  const r = validateDoses([{ timeOfDay: "Evening", amount: 0, unit: "tablet" }], FREQ.DAILY);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Evening/);
});

test("validateDoses refuses an unknown time of day", () => {
  const r = validateDoses([{ timeOfDay: "Teatime", amount: 1, unit: "tablet" }], FREQ.DAILY);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Teatime/);
});

test("validateDoses refuses a missing unit", () => {
  const r = validateDoses([{ timeOfDay: "Morning", amount: 1, unit: "  " }], FREQ.DAILY);
  assert.equal(r.ok, false);
  assert.match(r.reason, /unit/i);
});

test("validateDoses needs at least one dose for a scheduled prescription", () => {
  const r = validateDoses([], FREQ.DAILY);
  assert.equal(r.ok, false);
  assert.match(r.reason, /at least one/i);
});

test("validateDoses accepts no doses at all when the frequency is As needed", () => {
  assert.deepEqual(validateDoses([], FREQ.AS_NEEDED), { ok: true, doses: [] });
});

test("validateScheduleFields returns Sheet-shaped columns for a daily schedule", () => {
  const r = validateScheduleFields({ frequency: FREQ.DAILY, mealTiming: "After meal" });
  assert.deepEqual(r, { ok: true, fields: { frequency: "Daily", every_n_days: "", weekdays: "", count_from: "", meal_timing: "After meal" } });
});

test("validateScheduleFields requires every_n_days and count_from for an every-N-days schedule", () => {
  assert.equal(validateScheduleFields({ frequency: FREQ.EVERY_N, everyNDays: 0, countFrom: "2026-09-18" }).ok, false);
  assert.equal(validateScheduleFields({ frequency: FREQ.EVERY_N, everyNDays: 3, countFrom: "" }).ok, false);
  const good = validateScheduleFields({ frequency: FREQ.EVERY_N, everyNDays: 3, countFrom: "2026-09-18" });
  assert.deepEqual(good.fields, { frequency: "Every N days", every_n_days: "3", weekdays: "", count_from: "2026-09-18", meal_timing: "Any time" });
});

test("validateScheduleFields joins weekdays with commas and refuses an unknown day", () => {
  const good = validateScheduleFields({ frequency: FREQ.WEEKDAYS, weekdays: ["Mon", "Thu"] });
  assert.equal(good.fields.weekdays, "Mon, Thu");
  const bad = validateScheduleFields({ frequency: FREQ.WEEKDAYS, weekdays: ["Mon", "Funday"] });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /Funday/);
});

test("validateScheduleFields refuses an unknown frequency and an unknown meal timing", () => {
  assert.equal(validateScheduleFields({ frequency: "Sometimes" }).ok, false);
  assert.equal(validateScheduleFields({ frequency: FREQ.DAILY, mealTiming: "Whenever" }).ok, false);
});

test("the change types match the Sheet's Lists tab exactly", () => {
  assert.deepEqual(CHANGE_TYPES, ["Started", "Dose changed", "Schedule changed", "Stopped", "Restarted", "Corrected"]);
  assert.equal(MAX_REASON_LENGTH, 500);
});
