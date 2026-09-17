// Pure schedule rules shared by the app, the dev mock and Apps Script.
// No DOM, no network, no clock: callers pass dates and times in.
//
// v2 model: a Prescriptions row holds what a person takes NOW (one row per
// person per medicine); child PrescriptionDoses rows hold the amount for
// each time of day; PrescriptionChanges is an append-only history log.
// There is no date-range "schedule row" here any more.

export const TIMES_OF_DAY = ["Morning", "Noon", "Evening", "Bedtime"];
export const FREQ = { DAILY: "Daily", EVERY_N: "Every N days", WEEKDAYS: "Weekdays", AS_NEEDED: "As needed" };
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const WEEKDAY_BY_JS_INDEX = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BKK_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 86400000;

// ---- date helpers ----

export function parseDate(value) {
  const s = String(value == null ? "" : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}
export function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(from, to) {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY_MS);
}
export function weekdayOf(date) { return WEEKDAY_BY_JS_INDEX[new Date(date + "T00:00:00Z").getUTCDay()]; }
export function bangkokToday(nowMs) { return new Date(nowMs + BKK_OFFSET_MS).toISOString().slice(0, 10); }
export function bangkokStamp(nowMs) { return new Date(nowMs + BKK_OFFSET_MS).toISOString().slice(0, 16).replace("T", " "); }
export function bangkokHour(nowMs) { return new Date(nowMs + BKK_OFFSET_MS).getUTCHours(); }
export function timeOfDayAtHour(hour) {
  if (hour < 11) return "Morning";
  if (hour < 16) return "Noon";
  if (hour < 20) return "Evening";
  return "Bedtime";
}
export function bangkokTimeOfDay(nowMs) { return timeOfDayAtHour(bangkokHour(nowMs)); }

function parseWeekdayList(value) {
  return String(value == null ? "" : value).split(/[\s,]+/).filter(Boolean)
    .map(w => w.slice(0, 1).toUpperCase() + w.slice(1, 3).toLowerCase())
    .filter(w => WEEKDAYS.includes(w));
}

// ---- normalizers ----

export function normalizePrescription(row) {
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
    days = parseWeekdayList(row.weekdays);
    if (days.length === 0) return fail("weekdays needs day names like Mon,Wed,Fri");
  }

  return {
    ok: true,
    prescription: {
      id, userId, medicineId, freq, n, days, countFrom,
      meal: String(row.meal_timing || "").trim() || "Any time",
      doctorId: String(row.doctor_id || "").trim(),
      status, startedOn,
      notes: String(row.notes || "").trim(),
    },
  };
}

export function normalizeDose(row) {
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

export function isDue(prescription, date) {
  if (prescription.status !== "Active") return false;
  if (date < prescription.startedOn) return false;
  if (prescription.freq === FREQ.DAILY) return true;
  if (prescription.freq === FREQ.EVERY_N) {
    return date >= prescription.countFrom && daysBetween(prescription.countFrom, date) % prescription.n === 0;
  }
  if (prescription.freq === FREQ.WEEKDAYS) return prescription.days.includes(weekdayOf(date));
  return false;
}

export function doseKey(date, timeOfDay, prescriptionId) { return `${date}|${timeOfDay}|${prescriptionId}`; }

export function doseItemsOn(prescriptions, doses, date) {
  const byId = new Map(prescriptions.map(p => [p.id, p]));
  const due = new Set(prescriptions.filter(p => isDue(p, date)).map(p => p.id));
  const out = [];
  TIMES_OF_DAY.forEach(timeOfDay => {
    doses.forEach(d => {
      if (d.timeOfDay !== timeOfDay) return;
      const prescription = byId.get(d.prescriptionId);
      if (!prescription || !due.has(prescription.id)) return;
      out.push({ key: doseKey(date, timeOfDay, prescription.id), date, timeOfDay, prescription, dose: d });
    });
  });
  return out;
}

export function slotStatus({ due, taken, date, today, timeOfDay, nowTimeOfDay }) {
  if (due === 0) return "none";
  if (taken >= due) return "done";
  if (date < today) return "missed";
  if (date > today) return "upcoming";
  const i = TIMES_OF_DAY.indexOf(timeOfDay), now = TIMES_OF_DAY.indexOf(nowTimeOfDay);
  return i < now ? "missed" : i === now ? "now" : "upcoming";
}

// ---- history ----

export function lastChangeDate(changes, prescriptionId) {
  let latest = "";
  changes.forEach(c => {
    if (String(c.prescription_id || "").trim() !== prescriptionId) return;
    const stamp = String(c.changed_at || "");
    if (stamp > latest) latest = stamp;
  });
  return latest.slice(0, 10);
}

export function countsOnDay(prescription, changes, date) {
  const last = lastChangeDate(changes, prescription.id);
  return last === "" || last <= date;
}

// ---- descriptions ----

export function describeFrequency(prescription) {
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

function pluralUnit(unit, amount) {
  if (Number(amount) === 1) return unit;
  if (unit === "ml") return unit;
  if (/(s|x|z|ch|sh)$/.test(unit)) return `${unit}es`;
  return `${unit}s`;
}

export function describeDoses(doses) {
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
