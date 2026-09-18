// GENERATED from server/prescriptions.js by scripts/sync-gs.mjs. Do not edit here: edit server/prescriptions.js and run npm run sync-gs.
// Pure validation for prescription writes: no DOM, no Node APIs, no Sheet access.
// Synced to Apps Script by scripts/sync-gs.mjs, so keep names unique across all synced files.

const CHANGE_TYPES = ["Started", "Dose changed", "Schedule changed", "Stopped", "Restarted", "Corrected"];
const MAX_REASON_LENGTH = 500;
const MEAL_TIMING_VALUES = ["Before meal", "After meal", "With meal", "Any time"];

const txt = v => String(v == null ? "" : v).trim();

function validateDoses(doses, frequency) {
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

function validateScheduleFields(fields) {
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
