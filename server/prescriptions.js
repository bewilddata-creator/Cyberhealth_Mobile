// Pure validation for prescription writes: no DOM, no Node APIs, no Sheet access.
// Synced to Apps Script by scripts/sync-gs.mjs, so keep names unique across all synced files.
import { TIMES_OF_DAY, FREQ, WEEKDAYS, parseDate, unitForMedicineForm } from "../js/schedule.js";

// The change_type values PrescriptionChanges may hold. "Corrected" is RESERVED AND UNUSED in this
// release: no action writes it, so nothing to hunt for -- it is kept because release 2b needs it
// for correcting a mis-dated prescription, and because a value dropped from this list would make
// any history row already carrying it fail validation.
export const CHANGE_TYPES = ["Started", "Dose changed", "Schedule changed", "Stopped", "Restarted", "Corrected"];
export const MAX_REASON_LENGTH = 500;
const MEAL_TIMING_VALUES = ["Before meal", "After meal", "With meal", "Any time"];

const txt = v => String(v == null ? "" : v).trim();

// Stamps every dose row with the unit the medicine's own form implies, throwing away whatever
// unit the phone sent. The unit is a fact about the medicine, not a per-dose choice, so the
// server decides it from the Medicines row and never trusts the caller: a phone running an old
// build, or a hand-made request, cannot put "pill" on a Tablet.
//
// A form with no unit of its own (Cream, Other, blank) returns the rows untouched, so the unit
// the caller typed stands -- that is the deliberate escape hatch for anything counted in its own
// words. validateDoses still insists it is not blank.
//
// An existing prescription whose stored unit disagrees with its medicine's form is corrected the
// next time its dose is edited, and the correction shows in the history like any other change
// (the before/after wording carries the unit, so "Morning 1 pill → Morning 1 tablet" is legible).
export function dosesWithMedicineUnit(doses, medicineForm) {
  const list = Array.isArray(doses) ? doses : [];
  const derived = unitForMedicineForm(medicineForm);
  if (!derived) return list;
  return list.map(d => (d && typeof d === "object" ? { ...d, unit: derived } : d));
}

export function validateDoses(doses, frequency) {
  const list = Array.isArray(doses) ? doses : [];
  const fail = reason => ({ ok: false, reason });
  const out = [];
  const seen = {};
  for (const raw of list) {
    const timeOfDay = txt(raw && raw.timeOfDay);
    if (!TIMES_OF_DAY.includes(timeOfDay)) {
      return fail(timeOfDay
        ? `"${timeOfDay}" isn't a time of day. Use Morning, Noon, Evening or Bedtime.`
        : "Pick a time of day: Morning, Noon, Evening or Bedtime.");
    }
    if (seen[timeOfDay]) return fail(`There are two ${timeOfDay} rows. Put the whole ${timeOfDay} amount on one row.`);
    seen[timeOfDay] = true;
    const amount = Number(raw.amount);
    if (!(amount > 0)) return fail(`The ${timeOfDay} amount must be more than 0.`);
    const unit = txt(raw.unit);
    if (!unit) return fail(`The ${timeOfDay} row needs a unit, like tablet or ml.`);
    out.push({ timeOfDay, amount, unit });
  }
  if (out.length === 0 && txt(frequency) !== FREQ.AS_NEEDED) {
    return fail("Add at least one time of day, so it shows up on Today.");
  }
  return { ok: true, doses: out };
}

export function validateScheduleFields(fields) {
  const f = fields || {};
  const fail = reason => ({ ok: false, reason });
  const frequency = txt(f.frequency);
  if (!Object.values(FREQ).includes(frequency)) {
    return fail(frequency
      ? `"${frequency}" isn't a schedule the app knows. Pick every day, every so many days, certain weekdays, or when needed.`
      : "Pick a schedule: every day, every so many days, certain weekdays, or when needed.");
  }
  const mealRaw = txt(f.mealTiming) || "Any time";
  if (!MEAL_TIMING_VALUES.includes(mealRaw)) return fail(`"${mealRaw}" isn't a meal timing the app knows. Pick before meal, after meal, with meal, or any time.`);

  let everyNDays = "";
  let countFrom = "";
  if (frequency === FREQ.EVERY_N) {
    const n = Number(f.everyNDays);
    if (!Number.isInteger(n) || n < 1) return fail("How many days between doses? Type a whole number of 1 or more.");
    everyNDays = String(n);
    countFrom = parseDate(f.countFrom);
    if (!countFrom) return fail("Pick the day to count from, so the app knows which days are dose days.");
  }

  let weekdays = "";
  if (frequency === FREQ.WEEKDAYS) {
    const days = Array.isArray(f.weekdays) ? f.weekdays.map(txt).filter(Boolean) : [];
    if (days.length === 0) return fail("Pick at least one day of the week.");
    const picked = [];
    for (const d of days) {
      if (!WEEKDAYS.includes(d)) return fail(`"${d}" isn't a day of the week.`);
      if (!picked.includes(d)) picked.push(d);
    }
    weekdays = WEEKDAYS.filter(d => picked.includes(d)).join(", ");
  }

  return { ok: true, fields: { frequency, every_n_days: everyNDays, weekdays, count_from: countFrom, meal_timing: mealRaw } };
}
