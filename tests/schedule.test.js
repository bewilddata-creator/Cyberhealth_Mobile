import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIMES_OF_DAY, FREQ, WEEKDAYS, DOSE_LOG_WINDOW_DAYS,
  parseDate, addDays, daysBetween, weekdayOf, bangkokToday, bangkokStamp, bangkokHour,
  timeOfDayAtHour, bangkokTimeOfDay,
  normalizePrescription, normalizeDose,
  isDue, doseItemsOn, doseKey, slotStatus, dedupeActivePrescriptions, rolloverDate,
  lastChangeDate, countsOnDay,
  describeFrequency, describeDoses, describeSchedule,
  MEDICINE_FORMS, unitForMedicineForm, medicineNameParts, pluralUnit,
} from "../js/schedule.js";

// ---- helpers to build valid rows, overridable per test ----

const rxRow = (over = {}) => ({
  prescription_id: "RX1", user_id: "U01", medicine_id: "MED01",
  frequency: "Daily", every_n_days: "", weekdays: "", count_from: "",
  meal_timing: "After meal", doctor_id: "DOC01", status: "Active",
  started_on: "2026-09-01", notes: "",
  ...over,
});
const rx = over => { const r = normalizePrescription(rxRow(over)); assert.equal(r.ok, true, r.reason); return r.prescription; };

const doseRow = (over = {}) => ({
  dose_id: "DS1", prescription_id: "RX1", time_of_day: "Morning", amount: "1", unit: "tablet",
  ...over,
});
const dose = over => { const r = normalizeDose(doseRow(over)); assert.equal(r.ok, true, r.reason); return r.dose; };

// ---- date helpers (salvaged) ----

test("date helpers", () => {
  assert.equal(parseDate("2026-09-15"), "2026-09-15");
  assert.equal(parseDate(" 2026-09-15 "), "2026-09-15");
  assert.equal(parseDate("2026-02-30"), null);
  assert.equal(parseDate("15/09/2026"), null);
  assert.equal(parseDate(""), null);
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-09-01", "2026-09-22"), 21);
  assert.equal(weekdayOf("2026-09-15"), "Tue");
});

test("Bangkok clock helpers", () => {
  const ms = Date.parse("2026-09-14T18:30:00Z");
  assert.equal(bangkokToday(ms), "2026-09-15");
  assert.equal(bangkokStamp(ms), "2026-09-15 01:30");
  assert.equal(bangkokHour(ms), 1);
  assert.deepEqual([10, 11, 15, 16, 19, 20, 23].map(timeOfDayAtHour), ["Morning", "Noon", "Noon", "Evening", "Evening", "Bedtime", "Bedtime"]);
  assert.equal(bangkokTimeOfDay(ms), "Morning");
});

test("constants", () => {
  assert.deepEqual(TIMES_OF_DAY, ["Morning", "Noon", "Evening", "Bedtime"]);
  assert.deepEqual(FREQ, { DAILY: "Daily", EVERY_N: "Every N days", WEEKDAYS: "Weekdays", AS_NEEDED: "As needed" });
  assert.deepEqual(WEEKDAYS, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
});

// ---- normalizePrescription ----

test("normalizePrescription reads a valid row", () => {
  const p = rx();
  assert.deepEqual(p, {
    id: "RX1", userId: "U01", medicineId: "MED01",
    freq: "Daily", n: 0, days: [], countFrom: "",
    meal: "After meal", doctorId: "DOC01", status: "Active",
    startedOn: "2026-09-01", notes: "",
  });
});

test("normalizePrescription parses weekdays case-insensitively", () => {
  const p = rx({ frequency: "Weekdays", weekdays: "mon, THU" });
  assert.deepEqual(p.days, ["Mon", "Thu"]);
});

test("normalizePrescription defaults blank meal_timing to Any time", () => {
  assert.equal(rx({ meal_timing: "" }).meal, "Any time");
});

test("normalizePrescription reads Every N days fields", () => {
  const p = rx({ frequency: "Every N days", every_n_days: "21", count_from: "2026-09-01" });
  assert.equal(p.n, 21);
  assert.equal(p.countFrom, "2026-09-01");
});

test("normalizePrescription rejects missing ids", () => {
  assert.match(normalizePrescription(rxRow({ prescription_id: "" })).reason, /prescription_id/);
  assert.match(normalizePrescription(rxRow({ user_id: "" })).reason, /user_id/);
  assert.match(normalizePrescription(rxRow({ medicine_id: "" })).reason, /medicine_id/);
});

test("normalizePrescription rejects unknown frequency", () => {
  assert.match(normalizePrescription(rxRow({ frequency: "Sometimes" })).reason, /frequency/);
});

test("normalizePrescription rejects a bad started_on", () => {
  assert.match(normalizePrescription(rxRow({ started_on: "1/9/2026" })).reason, /started_on/);
  assert.match(normalizePrescription(rxRow({ started_on: "" })).reason, /started_on/);
});

test("normalizePrescription rejects Every N days without a valid every_n_days", () => {
  assert.match(normalizePrescription(rxRow({ frequency: "Every N days", every_n_days: "0", count_from: "2026-09-01" })).reason, /every_n_days/);
  assert.match(normalizePrescription(rxRow({ frequency: "Every N days", every_n_days: "1.5", count_from: "2026-09-01" })).reason, /every_n_days/);
  assert.match(normalizePrescription(rxRow({ frequency: "Every N days", every_n_days: "", count_from: "2026-09-01" })).reason, /every_n_days/);
});

test("normalizePrescription rejects Every N days without a valid count_from", () => {
  assert.match(normalizePrescription(rxRow({ frequency: "Every N days", every_n_days: "2", count_from: "" })).reason, /count_from/);
  assert.match(normalizePrescription(rxRow({ frequency: "Every N days", every_n_days: "2", count_from: "soon" })).reason, /count_from/);
});

test("normalizePrescription rejects Weekdays with no valid day", () => {
  assert.match(normalizePrescription(rxRow({ frequency: "Weekdays", weekdays: "" })).reason, /weekdays/);
  assert.match(normalizePrescription(rxRow({ frequency: "Weekdays", weekdays: "someday" })).reason, /weekdays/);
});

test("normalizePrescription REJECTS weekdays with any unknown token, naming the bad one, instead of silently dropping it", () => {
  const r = normalizePrescription(rxRow({ frequency: "Weekdays", weekdays: "Mon, Wendesday" }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /Wendesday/);
});

test("normalizePrescription accepts a day name typed longer or in a different case, as long as it's a real prefix", () => {
  assert.deepEqual(rx({ frequency: "Weekdays", weekdays: "Monday Thursday" }).days, ["Mon", "Thu"]);
  assert.deepEqual(rx({ frequency: "Weekdays", weekdays: "mond, THU" }).days, ["Mon", "Thu"]);
  assert.deepEqual(rx({ frequency: "Weekdays", weekdays: "Mon, Thu," }).days, ["Mon", "Thu"]);
});

test("normalizePrescription REJECTS a run of days joined by anything but a comma or space (Mon-Fri, Mon;Thu, Mon/Wed/Fri) -- these must never quietly become due only on Monday", () => {
  for (const bad of ["Mon-Fri", "Mon;Thu", "Mon/Wed/Fri"]) {
    const r = normalizePrescription(rxRow({ frequency: "Weekdays", weekdays: bad }));
    assert.equal(r.ok, false, `"${bad}" must be rejected, not silently read as "Mon"`);
    assert.match(r.reason, /unknown day/);
    assert.ok(r.reason.includes(bad), `reason should name the token "${bad}": ${r.reason}`);
    assert.match(r.reason, /separate days with commas/);
  }
});

test("normalizePrescription REJECTS a token under 3 letters or that isn't a real day prefix at all", () => {
  assert.match(normalizePrescription(rxRow({ frequency: "Weekdays", weekdays: "Tu" })).reason, /unknown day "Tu"/);
  assert.match(normalizePrescription(rxRow({ frequency: "Weekdays", weekdays: "boxed" })).reason, /unknown day "boxed"/);
});

test("normalizePrescription rejects a bad status", () => {
  assert.match(normalizePrescription(rxRow({ status: "Paused" })).reason, /status/);
  assert.match(normalizePrescription(rxRow({ status: "" })).reason, /status/);
});

test("normalizePrescription carries the id through on failure", () => {
  assert.equal(normalizePrescription(rxRow({ frequency: "Sometimes" })).id, "RX1");
});

test("normalizePrescription rejects a meal_timing outside the four allowed values", () => {
  assert.match(normalizePrescription(rxRow({ meal_timing: "Snack" })).reason, /meal_timing/);
  assert.equal(rx({ meal_timing: "Before meal" }).meal, "Before meal");
  assert.equal(rx({ meal_timing: "With meal" }).meal, "With meal");
  assert.equal(rx({ meal_timing: "" }).meal, "Any time");
});

// ---- normalizeDose ----

test("normalizeDose reads a valid row", () => {
  const d = dose();
  assert.deepEqual(d, { id: "DS1", prescriptionId: "RX1", timeOfDay: "Morning", amount: 1, unit: "tablet" });
});

test("normalizeDose rejects missing ids", () => {
  assert.match(normalizeDose(doseRow({ dose_id: "" })).reason, /dose_id/);
  assert.match(normalizeDose(doseRow({ prescription_id: "" })).reason, /prescription_id/);
});

test("normalizeDose rejects a time of day not one of the four", () => {
  assert.match(normalizeDose(doseRow({ time_of_day: "Afternoon" })).reason, /time_of_day/);
  assert.match(normalizeDose(doseRow({ time_of_day: "" })).reason, /time_of_day/);
});

test("normalizeDose rejects an amount not above 0", () => {
  assert.match(normalizeDose(doseRow({ amount: "0" })).reason, /amount/);
  assert.match(normalizeDose(doseRow({ amount: "-1" })).reason, /amount/);
  assert.match(normalizeDose(doseRow({ amount: "abc" })).reason, /amount/);
});

test("normalizeDose rejects a blank unit", () => {
  assert.match(normalizeDose(doseRow({ unit: "" })).reason, /unit/);
});

// ---- isDue ----

test("isDue: Stopped is never due", () => {
  assert.equal(isDue(rx({ status: "Stopped" }), "2026-09-15"), false);
});

test("isDue: before started_on is never due", () => {
  assert.equal(isDue(rx({ started_on: "2026-09-10" }), "2026-09-01"), false);
  assert.equal(isDue(rx({ started_on: "2026-09-10" }), "2026-09-10"), true);
});

test("isDue: Daily is always due once started", () => {
  const p = rx({ started_on: "2026-09-01" });
  assert.equal(isDue(p, "2026-09-01"), true);
  assert.equal(isDue(p, "2026-12-25"), true);
});

test("isDue: Every 2 days counts from count_from", () => {
  const p = rx({ frequency: "Every N days", every_n_days: "2", count_from: "2026-09-01", started_on: "2026-09-01" });
  assert.equal(isDue(p, "2026-09-01"), true);
  assert.equal(isDue(p, "2026-09-02"), false);
  assert.equal(isDue(p, "2026-09-03"), true);
  assert.equal(isDue(p, "2026-08-31"), false); // before count_from
});

test("isDue: Every 21 days", () => {
  const p = rx({ frequency: "Every N days", every_n_days: "21", count_from: "2026-09-01", started_on: "2026-09-01" });
  assert.equal(isDue(p, "2026-09-21"), false);
  assert.equal(isDue(p, "2026-09-22"), true);
  assert.equal(isDue(p, "2026-10-13"), true);
});

test("isDue: Weekdays across a week", () => {
  const p = rx({ frequency: "Weekdays", weekdays: "Mon,Thu", started_on: "2026-09-01" });
  // 2026-09-14 Mon, 15 Tue, 16 Wed, 17 Thu, 18 Fri, 19 Sat, 20 Sun
  const days = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"];
  assert.deepEqual(days.map(d => isDue(p, d)), [true, false, false, true, false, false, false]);
});

test("isDue: As needed is never due", () => {
  const p = rx({ frequency: "As needed" });
  assert.equal(isDue(p, "2026-09-15"), false);
});

// ---- doseItemsOn / doseKey ----

test("doseItemsOn orders items by time of day then input order", () => {
  const p1 = rx({ prescription_id: "RX1" });
  const p2 = rx({ prescription_id: "RX2" });
  const doses = [
    dose({ dose_id: "D1", prescription_id: "RX1", time_of_day: "Morning", amount: "1" }),
    dose({ dose_id: "D2", prescription_id: "RX1", time_of_day: "Evening", amount: "2" }),
    dose({ dose_id: "D3", prescription_id: "RX2", time_of_day: "Noon", amount: "1" }),
  ];
  const items = doseItemsOn([p1, p2], doses, "2026-09-15");
  assert.deepEqual(items.map(i => i.key), [
    "2026-09-15|Morning|RX1",
    "2026-09-15|Noon|RX2",
    "2026-09-15|Evening|RX1",
  ]);
  assert.deepEqual(items.map(i => i.dose.amount), [1, 1, 2]);
  assert.equal(doseKey("2026-09-15", "Noon", "RX2"), "2026-09-15|Noon|RX2");
});

test("doseItemsOn: a prescription not due that day contributes nothing", () => {
  const p = rx({ prescription_id: "RX1", frequency: "Weekdays", weekdays: "Mon" });
  const doses = [dose({ dose_id: "D1", prescription_id: "RX1", time_of_day: "Morning" })];
  // 2026-09-15 is a Tuesday
  assert.deepEqual(doseItemsOn([p], doses, "2026-09-15"), []);
});

test("doseItemsOn: dose rows of an unknown prescription are ignored", () => {
  const p = rx({ prescription_id: "RX1" });
  const doses = [dose({ dose_id: "D1", prescription_id: "RX-UNKNOWN", time_of_day: "Morning" })];
  assert.deepEqual(doseItemsOn([p], doses, "2026-09-15"), []);
});

test("doseItemsOn: the same dose row appearing twice in the input produces one item", () => {
  const p = rx({ prescription_id: "RX1" });
  const d = dose({ dose_id: "D1", prescription_id: "RX1", time_of_day: "Morning", amount: "1" });
  const items = doseItemsOn([p], [d, d], "2026-09-15");
  assert.equal(items.length, 1);
  assert.equal(items[0].key, "2026-09-15|Morning|RX1");
});

test("doseItemsOn: two different dose rows for the same prescription and time of day keep only the first", () => {
  const p = rx({ prescription_id: "RX1" });
  const first = dose({ dose_id: "D1", prescription_id: "RX1", time_of_day: "Morning", amount: "1" });
  const second = dose({ dose_id: "D2", prescription_id: "RX1", time_of_day: "Morning", amount: "2" });
  const items = doseItemsOn([p], [first, second], "2026-09-15");
  assert.equal(items.length, 1);
  assert.equal(items[0].dose.id, "D1");
  assert.equal(items[0].dose.amount, 1);
});

// ---- slotStatus ----

test("slotStatus", () => {
  const base = { due: 2, taken: 0, date: "2026-09-15", today: "2026-09-15", timeOfDay: "Noon", nowTimeOfDay: "Noon" };
  assert.equal(slotStatus({ ...base, due: 0 }), "none");
  assert.equal(slotStatus({ ...base, taken: 2 }), "done");
  assert.equal(slotStatus(base), "now");
  assert.equal(slotStatus({ ...base, timeOfDay: "Morning" }), "missed");
  assert.equal(slotStatus({ ...base, timeOfDay: "Evening" }), "upcoming");
  assert.equal(slotStatus({ ...base, date: "2026-09-14", timeOfDay: "Bedtime" }), "missed");
  assert.equal(slotStatus({ ...base, date: "2026-09-16", timeOfDay: "Morning" }), "upcoming");
});

// ---- lastChangeDate / countsOnDay ----

test("lastChangeDate picks the latest change for that prescription and ignores others", () => {
  const changes = [
    { prescription_id: "RX1", changed_at: "2026-09-01 09:00" },
    { prescription_id: "RX1", changed_at: "2026-09-10 14:00" },
    { prescription_id: "RX1", changed_at: "2026-09-05 08:00" },
    { prescription_id: "RX2", changed_at: "2026-09-20 08:00" },
  ];
  assert.equal(lastChangeDate(changes, "RX1"), "2026-09-10");
  assert.equal(lastChangeDate(changes, "RX2"), "2026-09-20");
  assert.equal(lastChangeDate(changes, "RX-NONE"), "");
});

test("countsOnDay is true when blank or on/before the last change, false after", () => {
  const changes = [{ prescription_id: "RX1", changed_at: "2026-09-10 14:00" }];
  const p = rx({ prescription_id: "RX1" });
  assert.equal(countsOnDay(p, [], "2026-09-01"), true);
  assert.equal(countsOnDay(p, changes, "2026-09-10"), true);
  assert.equal(countsOnDay(p, changes, "2026-09-09"), false);
  assert.equal(countsOnDay(p, changes, "2026-09-11"), true);
});

// ---- describeFrequency / describeDoses ----

test("describeFrequency", () => {
  assert.equal(describeFrequency(rx()), "Every day");
  const n = v => describeFrequency(rx({ frequency: "Every N days", every_n_days: String(v), count_from: "2026-09-01" }));
  assert.deepEqual([1, 2, 3, 7, 21].map(n), ["Every day", "Every other day", "Every 3 days", "Every week", "Every 3 weeks"]);
  assert.equal(describeFrequency(rx({ frequency: "Weekdays", weekdays: "Wed" })), "Every Wed");
  assert.equal(describeFrequency(rx({ frequency: "Weekdays", weekdays: "Mon,Thu" })), "Mon + Thu");
  assert.equal(describeFrequency(rx({ frequency: "As needed" })), "When needed");
});

test("describeDoses", () => {
  const doses = [
    dose({ dose_id: "D1", time_of_day: "Evening", amount: "2", unit: "tablet" }),
    dose({ dose_id: "D2", time_of_day: "Morning", amount: "1", unit: "tablet" }),
  ];
  assert.equal(describeDoses(doses), "Morning 1 tablet · Evening 2 tablets");
  assert.equal(describeDoses([]), "When needed");
});

// ---- dedupeActivePrescriptions ----

test("dedupeActivePrescriptions keeps the first Active row per person+medicine; Stopped rows are never touched", () => {
  const p1 = rx({ prescription_id: "RX1", medicine_id: "MED01" });
  const p2 = rx({ prescription_id: "RX2", medicine_id: "MED01" }); // duplicate Active for the same medicine
  const p3 = rx({ prescription_id: "RX3", medicine_id: "MED02" });
  const stoppedDup = rx({ prescription_id: "RX4", medicine_id: "MED01", status: "Stopped" });
  const out = dedupeActivePrescriptions([p1, p2, p3, stoppedDup]);
  assert.deepEqual(out.map(p => p.id), ["RX1", "RX3", "RX4"]);
});

test("dedupeActivePrescriptions is a no-op with no duplicates", () => {
  const p1 = rx({ prescription_id: "RX1", medicine_id: "MED01" });
  const p2 = rx({ prescription_id: "RX2", medicine_id: "MED02" });
  assert.deepEqual(dedupeActivePrescriptions([p1, p2]).map(p => p.id), ["RX1", "RX2"]);
});

// ---- rolloverDate ----

test("rolloverDate moves to the new day only when the viewed day was 'today' as loaded and the real day has since changed", () => {
  assert.equal(rolloverDate({ viewedDate: "2026-09-15", loadedToday: "2026-09-15", actualToday: "2026-09-16" }), "2026-09-16");
  assert.equal(rolloverDate({ viewedDate: "2026-09-15", loadedToday: "2026-09-15", actualToday: "2026-09-15" }), null);
  // Deliberately viewing yesterday must not get yanked forward to today.
  assert.equal(rolloverDate({ viewedDate: "2026-09-14", loadedToday: "2026-09-15", actualToday: "2026-09-16" }), null);
});

test("DOSE_LOG_WINDOW_DAYS is 60, matching the server's dose_log cutoff", () => {
  assert.equal(DOSE_LOG_WINDOW_DAYS, 60);
});

test("describeDoses pluralizes every Unit value from the Lists tab correctly", () => {
  const expected = {
    tablet: ["1 tablet", "2 tablets"],
    capsule: ["1 capsule", "2 capsules"],
    ml: ["1 ml", "2 ml"],
    unit: ["1 unit", "2 units"],
    injection: ["1 injection", "2 injections"],
    puff: ["1 puff", "2 puffs"],
    drop: ["1 drop", "2 drops"],
    patch: ["1 patch", "2 patches"],
    other: ["1 other", "2 other"],
  };
  Object.entries(expected).forEach(([unit, [one, two]]) => {
    const d1 = dose({ dose_id: "D1", time_of_day: "Morning", amount: "1", unit });
    const d2 = dose({ dose_id: "D2", time_of_day: "Morning", amount: "2", unit });
    assert.equal(describeDoses([d1]), `Morning ${one}`);
    assert.equal(describeDoses([d2]), `Morning ${two}`);
  });
});

test("describeSchedule joins frequency, meal timing and doses into one readable line", () => {
  const p = { freq: FREQ.DAILY, n: 0, days: [], meal: "After meal" };
  const doses = [
    { timeOfDay: "Morning", amount: 1, unit: "tablet" },
    { timeOfDay: "Evening", amount: 2, unit: "tablet" },
  ];
  assert.equal(describeSchedule(p, doses), "Every day, after meal: Morning 1 tablet, Evening 2 tablets");
});

test("describeSchedule leaves out the meal timing when it is Any time", () => {
  const p = { freq: FREQ.DAILY, n: 0, days: [], meal: "Any time" };
  const doses = [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }];
  assert.equal(describeSchedule(p, doses), "Every day: Morning 1 tablet");
});

test("describeSchedule orders doses Morning, Noon, Evening, Bedtime whatever order they arrive in", () => {
  const p = { freq: FREQ.DAILY, n: 0, days: [], meal: "Any time" };
  const doses = [
    { timeOfDay: "Bedtime", amount: 1, unit: "tablet" },
    { timeOfDay: "Morning", amount: 2, unit: "tablet" },
  ];
  assert.equal(describeSchedule(p, doses), "Every day: Morning 2 tablets, Bedtime 1 tablet");
});

test("describeSchedule says only 'When needed' for an As-needed prescription with no doses", () => {
  const p = { freq: FREQ.AS_NEEDED, n: 0, days: [], meal: "Any time" };
  assert.equal(describeSchedule(p, []), "When needed");
});

test("describeSchedule names an every-N-days schedule and its weekday list", () => {
  const every = { freq: FREQ.EVERY_N, n: 3, days: [], meal: "Any time" };
  assert.equal(describeSchedule(every, [{ timeOfDay: "Morning", amount: 1, unit: "shot" }]), "Every 3 days: Morning 1 shot");
  const week = { freq: FREQ.WEEKDAYS, n: 0, days: ["Mon", "Thu"], meal: "Before meal" };
  assert.equal(describeSchedule(week, [{ timeOfDay: "Noon", amount: 1, unit: "capsule" }]), "Mon + Thu, before meal: Noon 1 capsule");
});

// ---- what a dose is counted in ----

test("unitForMedicineForm gives each kind of medicine its unit", () => {
  assert.equal(unitForMedicineForm("Tablet"), "tablet");
  assert.equal(unitForMedicineForm("Capsule"), "capsule");
  assert.equal(unitForMedicineForm("Liquid"), "ml");
  assert.equal(unitForMedicineForm("Injection"), "injection");
  assert.equal(unitForMedicineForm("Inhaler"), "puff");
  assert.equal(unitForMedicineForm("Drops"), "drop");
  assert.equal(unitForMedicineForm("Patch"), "patch");
});

// A cream is not counted at all, and "Other" is the escape hatch for anything measured in its own
// words -- insulin's international units above all. Inventing a unit for either would put a word
// on the screen that nobody chose, so both leave the form asking.
test("unitForMedicineForm invents nothing for a cream, an Other, or a form nobody recognises", () => {
  assert.equal(unitForMedicineForm("Cream"), "");
  assert.equal(unitForMedicineForm("Other"), "");
  assert.equal(unitForMedicineForm(""), "");
  assert.equal(unitForMedicineForm(null), "");
  assert.equal(unitForMedicineForm(undefined), "");
  assert.equal(unitForMedicineForm("Suppository"), "");
});

// The form column is typed into a spreadsheet by hand as well as picked in the app.
test("unitForMedicineForm reads a hand-typed form whatever its case and spacing", () => {
  assert.equal(unitForMedicineForm("  tablet "), "tablet");
  assert.equal(unitForMedicineForm("CAPSULE"), "capsule");
  assert.equal(unitForMedicineForm("liQuid"), "ml");
});

test("every form on the Sheet's own list is one unitForMedicineForm knows what to do with", () => {
  const withoutUnit = MEDICINE_FORMS.filter(f => !unitForMedicineForm(f));
  assert.deepEqual(withoutUnit, ["Cream", "Other"], "only a cream and an Other have no unit of their own");
});

// ---- the name on the box ----

test("medicineNameParts leads with the brand and keeps the generic in brackets", () => {
  assert.deepEqual(medicineNameParts({ brand_name: "Norvasc", generic_name: "Amlodipine", strength: "5 mg" }),
    { name: "Norvasc (Amlodipine)", strength: "5 mg" });
});

test("medicineNameParts falls back to the generic alone when there is no brand", () => {
  assert.deepEqual(medicineNameParts({ generic_name: "Amlodipine", strength: "5 mg" }),
    { name: "Amlodipine", strength: "5 mg" });
  assert.deepEqual(medicineNameParts({ brand_name: "   ", generic_name: "Amlodipine", strength: "5 mg" }),
    { name: "Amlodipine", strength: "5 mg" });
});

// A generic sold under its own name: "Metformin (Metformin) 500 mg" reads like a bug.
test("medicineNameParts says one name once when the brand and the generic are the same word", () => {
  assert.equal(medicineNameParts({ brand_name: "Metformin", generic_name: "metformin" }).name, "Metformin");
  assert.equal(medicineNameParts({ brand_name: " Metformin ", generic_name: "Metformin" }).name, "Metformin");
  // Matched on the flattened spelling, but shown exactly as the brand is stored -- a value typed
  // into the Sheet is never quietly rewritten.
  assert.equal(medicineNameParts({ brand_name: "Co  trimoxazole", generic_name: "Co trimoxazole" }).name, "Co  trimoxazole");
});

test("medicineNameParts keeps the brand when that is the only name there is", () => {
  assert.equal(medicineNameParts({ brand_name: "Norvasc" }).name, "Norvasc");
});

test("medicineNameParts returns empty parts for a missing or nameless medicine", () => {
  assert.deepEqual(medicineNameParts(null), { name: "", strength: "" });
  assert.deepEqual(medicineNameParts(undefined), { name: "", strength: "" });
  assert.deepEqual(medicineNameParts({}), { name: "", strength: "" });
  assert.deepEqual(medicineNameParts({ strength: "5 mg" }), { name: "", strength: "5 mg" });
});

test("pluralUnit is exported for the forms to read '1 tablet' / '2 tablets'", () => {
  assert.equal(pluralUnit("tablet", 1), "tablet");
  assert.equal(pluralUnit("tablet", 2), "tablets");
  assert.equal(pluralUnit("tablet", ""), "tablets", "an empty amount box reads as the plural");
  assert.equal(pluralUnit("ml", 5), "ml");
  assert.equal(pluralUnit("patch", 2), "patches");
  assert.equal(pluralUnit("puff", 0.5), "puffs");
});

// "18 unitses" on the medicine list. A hand-typed unit is usually already plural, and the Other
// escape hatch -- insulin's "units" -- is where hand-typed units now live.
test("pluralUnit leaves a unit that is already plural alone", () => {
  assert.equal(pluralUnit("units", 18), "units");
  assert.equal(pluralUnit("drops", 2), "drops");
  assert.equal(pluralUnit("puffs", 2), "puffs");
  assert.equal(pluralUnit("units", 1), "units", "and one of them is still 'units'");
  assert.equal(pluralUnit("patch", 2), "patches", "a real singular still gets its -es");
  assert.equal(pluralUnit("box", 2), "boxes");
});
