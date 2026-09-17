// Pure screen models built from bootstrap data. No DOM.
import { TIMES_OF_DAY, FREQ, WEEKDAYS, weekdayOf, addDays, doseItemsOn, slotStatus, countsOnDay, describeFrequency, describeDoses } from "./schedule.js";
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

// ---- Meds, medicine detail, Doctors, Emergency (Task 8) ----

const PHOTO_FIELDS = [
  ["photo_box", "Box"],
  ["photo_packet_front", "Packet front"],
  ["photo_packet_back", "Packet back"],
  ["photo_pill_front", "Pill front"],
  ["photo_pill_back", "Pill back"],
];

function isFlagActive(v) {
  return String(v == null ? "" : v).trim().toUpperCase() === "TRUE";
}

function prescriptionDoses(idx, prescriptionId) {
  const doses = idx.dosesByPrescription.get(prescriptionId) || [];
  return TIMES_OF_DAY.map(t => doses.find(d => d.timeOfDay === t)).filter(Boolean);
}

// The owner's CareTeam row for a doctor: prefers an active row, but falls back to any row so a
// prescription written against a since-deactivated care-team entry still shows a hospital.
function careTeamRowFor(idx, ownerId, doctorId) {
  const rows = (idx.boot.care_team || []).filter(c => c.user_id === ownerId && c.doctor_id === doctorId);
  return rows.find(c => isFlagActive(c.active)) || rows[0] || null;
}

function hnFor(idx, userId, hospitalId) {
  const row = (idx.boot.hospital_numbers || []).find(h => h.user_id === userId && h.hospital_id === hospitalId);
  return row ? row.hn : "";
}

function splitSemi(text) {
  return String(text == null ? "" : text).split(";").map(s => s.trim()).filter(Boolean);
}

export function parseAllergies(text) {
  return splitSemi(text).map(s => {
    const m = s.match(/^(.*?)\s*\((.*)\)\s*$/);
    return m ? { what: m[1], reaction: m[2] } : { what: s, reaction: "" };
  });
}

export function ageOn(dob, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dob == null ? "" : dob))) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today == null ? "" : today))) return null;
  let age = Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
  if (today.slice(5) < dob.slice(5)) age--;
  return age;
}

export function medsModel(idx, ownerId) {
  const prescriptions = ownerPrescriptions(idx, ownerId);
  const active = prescriptions.filter(p => p.status === "Active").map(p => {
    const medicine = idx.medicines.get(p.medicineId) || null;
    const doses = prescriptionDoses(idx, p.id);
    // An As-needed prescription has no dose rows, so describeDoses would only repeat
    // "When needed" a second time -- describeFrequency alone already says that.
    const summary = doses.length ? `${describeFrequency(p)} · ${describeDoses(doses)}` : describeFrequency(p);
    return { prescription: p, medicine, doses, summary };
  });
  const stopped = prescriptions.filter(p => p.status === "Stopped").map(p => {
    const medicine = idx.medicines.get(p.medicineId) || null;
    const stops = (idx.changesByPrescription.get(p.id) || []).filter(c => c.change_type === "Stopped");
    const latest = stops.reduce((a, c) => (c.changed_at > a ? c.changed_at : a), "");
    return { prescription: p, medicine, stoppedOn: latest.slice(0, 10) };
  });
  return { active, stopped };
}

// Read-only medicine detail, scoped to the owner: a prescription belonging to someone else (or
// unknown entirely) returns null rather than leaking another person's medicine or history.
export function detailModel(idx, ownerId, prescriptionId) {
  const p = idx.prescriptions.get(prescriptionId);
  if (!p || p.userId !== ownerId) return null;
  const medicine = idx.medicines.get(p.medicineId) || null;
  const doses = prescriptionDoses(idx, prescriptionId);
  const photos = PHOTO_FIELDS.map(([field, label]) => ({ label, url: medicine ? driveImageUrl(medicine[field]) : "" }));
  const doctor = p.doctorId ? idx.doctors.get(p.doctorId) || null : null;
  const ct = doctor ? careTeamRowFor(idx, ownerId, p.doctorId) : null;
  const hospital = ct ? idx.hospitals.get(ct.hospital_id) || null : null;
  const hn = ct ? hnFor(idx, ownerId, ct.hospital_id) : "";
  const history = (idx.changesByPrescription.get(prescriptionId) || [])
    .slice()
    .sort((a, b) => (a.changed_at < b.changed_at ? 1 : a.changed_at > b.changed_at ? -1 : 0))
    .map(c => ({
      changedAt: c.changed_at,
      changeType: c.change_type,
      changedByName: (idx.people.get(c.changed_by) || {}).display_name || "",
      doctorName: c.doctor_id ? (idx.doctors.get(c.doctor_id) || {}).name || "" : "",
      reason: c.reason,
      before: c.before,
      after: c.after,
    }));
  return { prescription: p, medicine, doses, photos, doctor, hospital, hn, history };
}

// The owner's active care team, sorted by doctor name. Scoped to the owner: only CareTeam rows
// for ownerId are ever considered.
export function doctorsModel(idx, ownerId) {
  const rows = (idx.boot.care_team || []).filter(c => c.user_id === ownerId && isFlagActive(c.active));
  return rows
    .map(careTeam => {
      const doctor = idx.doctors.get(careTeam.doctor_id) || null;
      const hospital = idx.hospitals.get(careTeam.hospital_id) || null;
      const hn = hnFor(idx, ownerId, careTeam.hospital_id);
      const photoUrl = doctor ? driveImageUrl(doctor.photo) : "";
      const otherHospitals = (idx.boot.doctor_hospitals || [])
        .filter(dh => dh.doctor_id === careTeam.doctor_id && dh.hospital_id !== careTeam.hospital_id)
        .map(dh => (idx.hospitals.get(dh.hospital_id) || {}).name)
        .filter(Boolean);
      return { careTeam, doctor, hospital, hn, photoUrl, otherHospitals };
    })
    .sort((a, b) => {
      const an = a.doctor ? a.doctor.name : "", bn = b.doctor ? b.doctor.name : "";
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
}

// boot is either a real bootstrap payload ({emergency, today, ...}) or, for the no-login public
// flow, the minimal {emergency: <publicEmergency cards>, today} shape -- both carry everything
// this needs. A card only ever carries hospital_numbers when the server decided this viewer may
// see it (see server/actions.js buildCards), so that alone gates the HN band.
export function emergencyModel(boot, userId) {
  const card = ((boot && boot.emergency) || []).find(c => c.user_id === userId);
  if (!card) return null;
  return {
    ...card,
    allergies: parseAllergies(card.allergies),
    conditions: splitSemi(card.conditions),
    age: ageOn(card.date_of_birth, boot.today),
  };
}
