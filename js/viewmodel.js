// Pure screen models built from bootstrap data. No DOM.
import { TIMES_OF_DAY, FREQ, WEEKDAYS, weekdayOf, addDays, doseItemsOn, slotStatus, countsOnDay } from "./schedule.js";
import { resolveMockPhoto } from "./mockphoto.js";

export function driveImageUrl(link) {
  const s = String(link || "").trim();
  if (!s) return "";
  const m = s.match(/\/d\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800`;
  if (/^https:\/\//.test(s)) return s;
  // The dev mock's fake Drive (release 2) returns "mock:photo:<id>" instead of a real URL.
  // resolveMockPhoto only ever answers once api.js has loaded that mock module, which only
  // happens when API_URL is "mock" -- so production, which never touches js/mockphoto.js's
  // setter, keeps accepting only real Drive https links.
  return s.startsWith("mock:photo:") ? resolveMockPhoto(s) : "";
}

function byId(rows, key) {
  return new Map(rows.map(r => [r[key], r]));
}
function groupBy(rows, key) {
  const m = new Map();
  rows.forEach(r => {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  });
  return m;
}

export function indexBoot(boot) {
  const ticks = new Map();
  boot.dose_log.forEach(r => ticks.set(`${r.date}|${r.time_of_day}|${r.prescription_id}`, r));
  return {
    boot,
    medicines: byId(boot.medicines, "medicine_id"),
    hospitals: byId(boot.hospitals, "hospital_id"),
    doctors: byId(boot.doctors, "doctor_id"),
    people: byId(boot.people, "user_id"),
    prescriptions: byId(boot.prescriptions, "id"),
    dosesByPrescription: groupBy(boot.doses, "prescriptionId"),
    changesByPrescription: groupBy(boot.changes, "prescription_id"),
    ticks,
  };
}

function ownerPrescriptions(idx, ownerId) {
  return [...idx.prescriptions.values()].filter(p => p.userId === ownerId);
}
function dosesFor(idx, prescriptions) {
  return prescriptions.flatMap(p => idx.dosesByPrescription.get(p.id) || []);
}

export function todayModel(idx, { ownerId, viewerId, date, today, nowTimeOfDay }) {
  const prescriptions = ownerPrescriptions(idx, ownerId);
  const doses = dosesFor(idx, prescriptions);
  const viewerIsOwner = !!viewerId && viewerId === ownerId;
  const canTick = viewerIsOwner && date <= today;
  const items = doseItemsOn(prescriptions, doses, date).map(it => {
    const row = idx.ticks.get(it.key);
    const medicine = idx.medicines.get(it.prescription.medicineId) || null;
    const tick = row ? { at: String(row.taken_at).slice(11, 16), amount: row.amount_taken, unit: row.unit } : null;
    return { key: it.key, timeOfDay: it.timeOfDay, prescription: it.prescription, dose: it.dose, medicine, tick };
  });
  const slots = TIMES_OF_DAY.map(timeOfDay => {
    const slotItems = items.filter(i => i.timeOfDay === timeOfDay);
    const taken = slotItems.filter(i => i.tick).length;
    const due = slotItems.length;
    return {
      timeOfDay, items: slotItems, taken, due,
      status: slotStatus({ due, taken, date, today, timeOfDay, nowTimeOfDay }),
      canTickAll: canTick && due - taken > 1,
    };
  });
  const asNeeded = prescriptions
    .filter(p => p.freq === FREQ.AS_NEEDED && p.status === "Active" && date >= p.startedOn)
    .map(p => ({ prescription: p, medicine: idx.medicines.get(p.medicineId) || null }));
  return {
    date, isToday: date === today, canTick, viewerIsOwner,
    taken: slots.reduce((a, s) => a + s.taken, 0),
    due: slots.reduce((a, s) => a + s.due, 0),
    slots, asNeeded,
  };
}

function dayCounts(idx, ownerId, day, includeTimes, filterFn) {
  const prescriptions = ownerPrescriptions(idx, ownerId).filter(filterFn);
  const doses = dosesFor(idx, prescriptions);
  const items = doseItemsOn(prescriptions, doses, day).filter(i => includeTimes.includes(i.timeOfDay));
  const due = items.length;
  const taken = items.filter(i => idx.ticks.has(i.key)).length;
  return { due, taken };
}

function dayResult(idx, ownerId, day, today, nowTimeOfDay) {
  if (day > today) return "";
  let includeTimes, filterFn;
  if (day < today) {
    includeTimes = TIMES_OF_DAY;
    filterFn = p => countsOnDay(p, idx.changesByPrescription.get(p.id) || [], day);
  } else {
    includeTimes = TIMES_OF_DAY.slice(0, TIMES_OF_DAY.indexOf(nowTimeOfDay));
    filterFn = () => true;
  }
  const { due, taken } = dayCounts(idx, ownerId, day, includeTimes, filterFn);
  if (!due) return "";
  return taken === due ? "ok" : "miss";
}

export function weekModel(idx, ownerId, date, today, nowTimeOfDay) {
  const monday = addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    return { date: d, weekday: weekdayOf(d), day: Number(d.slice(8)), result: dayResult(idx, ownerId, d, today, nowTimeOfDay) };
  });
}
