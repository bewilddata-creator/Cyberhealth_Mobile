// GENERATED from js/schedule.js by scripts/sync-gs.mjs. Do not edit here: edit js/schedule.js and run npm run sync-gs.
// Pure schedule rules shared by the app, the dev mock and Apps Script.
// No DOM, no network, no clock: callers pass dates and times in.
//
// v2 model: a Prescriptions row holds what a person takes NOW (one row per
// person per medicine); child PrescriptionDoses rows hold the amount for
// each time of day; PrescriptionChanges is an append-only history log.
// There is no date-range "schedule row" here any more.

const TIMES_OF_DAY = ["Morning", "Noon", "Evening", "Bedtime"];
const FREQ = { DAILY: "Daily", EVERY_N: "Every N days", WEEKDAYS: "Weekdays", AS_NEEDED: "As needed" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// How many days of DoseLog history bootstrap sends (today and the 59 days before it). Shared so
// the client can tell a day outside that window from a day that was simply never taken.
const DOSE_LOG_WINDOW_DAYS = 60;

const WEEKDAY_BY_JS_INDEX = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BKK_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 86400000;

// ---- date helpers ----

function parseDate(value) {
  const s = String(value == null ? "" : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}
function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(from, to) {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY_MS);
}
function weekdayOf(date) { return WEEKDAY_BY_JS_INDEX[new Date(date + "T00:00:00Z").getUTCDay()]; }
function bangkokToday(nowMs) { return new Date(nowMs + BKK_OFFSET_MS).toISOString().slice(0, 10); }
function bangkokStamp(nowMs) { return new Date(nowMs + BKK_OFFSET_MS).toISOString().slice(0, 16).replace("T", " "); }
function bangkokHour(nowMs) { return new Date(nowMs + BKK_OFFSET_MS).getUTCHours(); }
function timeOfDayAtHour(hour) {
  if (hour < 11) return "Morning";
  if (hour < 16) return "Noon";
  if (hour < 20) return "Evening";
  return "Bedtime";
}
function bangkokTimeOfDay(nowMs) { return timeOfDayAtHour(bangkokHour(nowMs)); }

const MEAL_TIMINGS = ["Before meal", "After meal", "With meal", "Any time"];

const WEEKDAY_FULL_NAMES = { Mon: "monday", Tue: "tuesday", Wed: "wednesday", Thu: "thursday", Fri: "friday", Sat: "saturday", Sun: "sunday" };

// A token counts as a day name only if it is at least three letters AND is itself a prefix of a
// real day name ("Mon", "mond", "Monday", "THU" all match) -- NOT just "first three letters match
// a day", which used to accept "Mon-Fri" as one token and silently read it as "Mon" alone (a
// medicine meant to run Monday-Friday would then only ever be due on Mondays, with nothing in the
// Sheet to say so). Returns the canonical 3-letter code, or null.
function weekdayForToken(token) {
  const t = String(token).trim().toLowerCase();
  if (t.length < 3) return null;
  for (const code of WEEKDAYS) {
    if (WEEKDAY_FULL_NAMES[code].startsWith(t)) return code;
  }
  return null;
}
function splitWeekdayTokens(value) {
  return String(value == null ? "" : value).split(/[\s,]+/).filter(Boolean);
}

// ---- normalizers ----

function normalizePrescription(row) {
  const id = String(row.prescription_id || "").trim();
  const fail = reason => ({ ok: false, id, reason });
  if (!id) return fail("missing prescription_id");
  const userId = String(row.user_id || "").trim();
  if (!userId) return fail("missing user_id");
  const medicineId = String(row.medicine_id || "").trim();
  if (!medicineId) return fail("missing medicine_id");
  const freq = String(row.frequency || "").trim();
  if (!Object.values(FREQ).includes(freq)) return fail(`unknown frequency "${freq}"`);
  const startedOn = parseDate(row.started_on);
  if (!startedOn) return fail("started_on must be YYYY-MM-DD");
  const status = String(row.status || "").trim();
  if (status !== "Active" && status !== "Stopped") return fail("status must be Active or Stopped");
  const mealRaw = String(row.meal_timing || "").trim();
  if (mealRaw && !MEAL_TIMINGS.includes(mealRaw)) return fail(`unknown meal_timing "${mealRaw}"`);

  let n = 0;
  let countFrom = "";
  if (freq === FREQ.EVERY_N) {
    n = Number(row.every_n_days);
    if (!Number.isInteger(n) || n < 1) return fail("every_n_days must be a whole number of 1 or more");
    countFrom = parseDate(row.count_from);
    if (!countFrom) return fail("count_from must be YYYY-MM-DD");
  }

  let days = [];
  if (freq === FREQ.WEEKDAYS) {
    const tokens = splitWeekdayTokens(row.weekdays);
    if (tokens.length === 0) return fail("weekdays needs day names like Mon,Wed,Fri");
    // A hand-typed weekday list is rejected outright on the first bad token (naming it) rather
    // than silently dropping it -- a typo like "Wendesday" used to mean "never due on Wednesday"
    // with no warning at all, and "Mon-Fri" (or "Mon;Thu", "Mon/Wed/Fri") used to be misread as
    // the single day "Mon" -- silently due only on Mondays.
    for (const t of tokens) {
      const code = weekdayForToken(t);
      if (!code) return fail(`weekdays has an unknown day "${t}" — separate days with commas, like "Mon, Wed, Fri"`);
      if (!days.includes(code)) days.push(code);
    }
  }

  return {
    ok: true,
    prescription: {
      id, userId, medicineId, freq, n, days, countFrom,
      meal: mealRaw || "Any time",
      doctorId: String(row.doctor_id || "").trim(),
      status, startedOn,
      notes: String(row.notes || "").trim(),
    },
  };
}

function normalizeDose(row) {
  const id = String(row.dose_id || "").trim();
  const fail = reason => ({ ok: false, id, reason });
  if (!id) return fail("missing dose_id");
  const prescriptionId = String(row.prescription_id || "").trim();
  if (!prescriptionId) return fail("missing prescription_id");
  const timeOfDay = String(row.time_of_day || "").trim();
  if (!TIMES_OF_DAY.includes(timeOfDay)) return fail(`unknown time_of_day "${timeOfDay}"`);
  const amount = Number(row.amount);
  if (!(amount > 0)) return fail("amount must be a number above 0");
  const unit = String(row.unit || "").trim();
  if (!unit) return fail("missing unit");
  return { ok: true, dose: { id, prescriptionId, timeOfDay, amount, unit } };
}

// ---- due / today's list ----

function isDue(prescription, date) {
  if (prescription.status !== "Active") return false;
  if (date < prescription.startedOn) return false;
  if (prescription.freq === FREQ.DAILY) return true;
  if (prescription.freq === FREQ.EVERY_N) {
    return date >= prescription.countFrom && daysBetween(prescription.countFrom, date) % prescription.n === 0;
  }
  if (prescription.freq === FREQ.WEEKDAYS) return prescription.days.includes(weekdayOf(date));
  return false;
}

function doseKey(date, timeOfDay, prescriptionId) { return `${date}|${timeOfDay}|${prescriptionId}`; }

// A hand-edited Sheet can end up with two Active Prescriptions rows for the same person and
// medicine (a typo'd second entry rather than editing the first). Rather than showing the pill
// twice, keep only the first by input order and let the caller warn about the rest; Stopped rows
// are left alone since a person can genuinely have stopped the same medicine more than once.
function dedupeActivePrescriptions(prescriptions) {
  const seen = new Set();
  return prescriptions.filter(p => {
    if (p.status !== "Active") return true;
    const combo = `${p.userId}|${p.medicineId}`;
    if (seen.has(combo)) return false;
    seen.add(combo);
    return true;
  });
}

// Whether Today, having been loaded for loadedToday, should jump to actualToday: only when the
// viewer was looking at "today" as of that load (never yanks someone off a day they deliberately
// went back to) and the real Bangkok day has since moved on. Returns the new day, or null.
function rolloverDate({ viewedDate, loadedToday, actualToday }) {
  return viewedDate === loadedToday && loadedToday !== actualToday ? actualToday : null;
}

function doseItemsOn(prescriptions, doses, date) {
  const byId = new Map(prescriptions.map(p => [p.id, p]));
  const due = new Set(prescriptions.filter(p => isDue(p, date)).map(p => p.id));
  const seenKeys = new Set();
  const seenDoseIds = new Set();
  const out = [];
  TIMES_OF_DAY.forEach(timeOfDay => {
    doses.forEach(d => {
      if (d.timeOfDay !== timeOfDay) return;
      if (seenDoseIds.has(d.id)) return; // the same dose row appearing twice in the input
      const prescription = byId.get(d.prescriptionId);
      if (!prescription || !due.has(prescription.id)) return;
      const key = doseKey(date, timeOfDay, prescription.id);
      if (seenKeys.has(key)) return; // two dose rows for the same prescription + time of day: keep the first
      seenKeys.add(key);
      seenDoseIds.add(d.id);
      out.push({ key, date, timeOfDay, prescription, dose: d });
    });
  });
  return out;
}

function slotStatus({ due, taken, date, today, timeOfDay, nowTimeOfDay }) {
  if (due === 0) return "none";
  if (taken >= due) return "done";
  if (date < today) return "missed";
  if (date > today) return "upcoming";
  const i = TIMES_OF_DAY.indexOf(timeOfDay), now = TIMES_OF_DAY.indexOf(nowTimeOfDay);
  return i < now ? "missed" : i === now ? "now" : "upcoming";
}

// ---- history ----

function lastChangeDate(changes, prescriptionId) {
  let latest = "";
  changes.forEach(c => {
    if (String(c.prescription_id || "").trim() !== prescriptionId) return;
    const stamp = String(c.changed_at || "");
    if (stamp > latest) latest = stamp;
  });
  return latest.slice(0, 10);
}

function countsOnDay(prescription, changes, date) {
  const last = lastChangeDate(changes, prescription.id);
  return last === "" || last <= date;
}

// ---- descriptions ----

function describeFrequency(prescription) {
  if (prescription.freq === FREQ.DAILY) return "Every day";
  if (prescription.freq === FREQ.EVERY_N) {
    const n = prescription.n;
    if (n === 1) return "Every day";
    if (n === 2) return "Every other day";
    if (n % 7 === 0) return n === 7 ? "Every week" : `Every ${n / 7} weeks`;
    return `Every ${n} days`;
  }
  if (prescription.freq === FREQ.WEEKDAYS) {
    return prescription.days.length === 1 ? `Every ${prescription.days[0]}` : prescription.days.join(" + ");
  }
  return "When needed";
}

// ---- the medicine itself ----
//
// What a dose of a medicine is counted in, worked out from the medicine's own form (the Sheet's
// Lists tab defines both vocabularies). Nobody types the unit four times over: a Tablet is
// counted in tablets and always was, and the only thing typing it again can add is a typo.
//
// Cream, Other and a blank or unrecognised form deliberately return "" -- there is no honest
// unit to invent for a cream, and "Other" is the escape hatch for anything counted in its own
// words (insulin's international units): set the form to Other and the dose form asks for one.
// The Sheet's Lists tab "Form" column, in its order. Every value here is one the Sheet's own
// dropdown offers, so a medicine typed in the app and one typed in the Sheet say the same thing.
const MEDICINE_FORMS = ["Tablet", "Capsule", "Liquid", "Injection", "Inhaler", "Cream", "Drops", "Patch", "Other"];
const UNIT_BY_MEDICINE_FORM = {
  tablet: "tablet",
  capsule: "capsule",
  liquid: "ml",
  injection: "injection",
  inhaler: "puff",
  drops: "drop",
  patch: "patch",
};
function unitForMedicineForm(form) {
  const key = String(form == null ? "" : form).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UNIT_BY_MEDICINE_FORM, key) ? UNIT_BY_MEDICINE_FORM[key] : "";
}

// A medicine's name split into the part that names it and the part that says how strong it is,
// so the HTML view can style the strength and the plain-text emergency card can just join them.
//
// Brand first, because the brand is what is printed large on the box in his hand -- he reads
// "Norvasc" there and needs to find it on the screen. The generic follows in brackets for the
// doctor or pharmacist reading the emergency card, who needs the ingredient, not the trade name.
// When the two are the same word (a generic sold under its own name) it is said once.
function medicineNameParts(med) {
  const t = v => String(v == null ? "" : v).trim();
  const flat = v => t(v).replace(/\s+/g, " ").toLowerCase();
  const brand = t(med && med.brand_name);
  const generic = t(med && med.generic_name);
  const same = brand && generic && flat(brand) === flat(generic);
  const name = !brand ? generic : (!generic || same ? brand : `${brand} (${generic})`);
  return { name, strength: t(med && med.strength) };
}

function pluralUnit(unit, amount) {
  if (Number(amount) === 1) return unit;
  if (unit === "ml" || unit === "other") return unit;
  // A unit that already ends in "s" is a unit somebody typed in the plural -- insulin's "units"
  // above all, which is exactly what the Other escape hatch is for. Adding "es" to it gave
  // "18 unitses" on the medicine list, which reads as a broken screen.
  if (/s$/.test(unit)) return unit;
  if (/(x|z|ch|sh)$/.test(unit)) return `${unit}es`;
  return `${unit}s`;
}

function describeDoses(doses) {
  if (!doses || doses.length === 0) return "When needed";
  const byTime = new Map();
  doses.forEach(d => { if (!byTime.has(d.timeOfDay)) byTime.set(d.timeOfDay, d); });
  return TIMES_OF_DAY.filter(t => byTime.has(t))
    .map(t => {
      const d = byTime.get(t);
      return `${t} ${d.amount} ${pluralUnit(d.unit, d.amount)}`;
    })
    .join(" · ");
}

// The wording stored in PrescriptionChanges.before / .after. Words, not ids, so a change still
// reads correctly years later even if the medicine or doctor behind it is renamed.
function describeSchedule(prescription, doses) {
  const freq = describeFrequency(prescription);
  const meal = String(prescription.meal || "").trim();
  const head = meal && meal !== "Any time" ? `${freq}, ${meal.toLowerCase()}` : freq;
  if (!doses || doses.length === 0) return head;
  const byTime = new Map();
  doses.forEach(d => { if (!byTime.has(d.timeOfDay)) byTime.set(d.timeOfDay, d); });
  const parts = TIMES_OF_DAY.filter(t => byTime.has(t)).map(t => {
    const d = byTime.get(t);
    return `${t} ${d.amount} ${pluralUnit(d.unit, d.amount)}`;
  });
  return parts.length ? `${head}: ${parts.join(", ")}` : head;
}
