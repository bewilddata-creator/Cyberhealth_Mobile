// Pure screen models built from bootstrap data. No DOM.
import { TIMES_OF_DAY, FREQ, WEEKDAYS, DOSE_LOG_WINDOW_DAYS, weekdayOf, addDays, doseItemsOn, doseKey, slotStatus, countsOnDay, describeFrequency, describeDoses, dedupeActivePrescriptions, medicineNameParts, unitForMedicineForm } from "./schedule.js";
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
  // Only a status=Taken row is a tick -- a Skipped row (release 1 doesn't offer skipping from the
  // app, but a hand-typed Sheet row can still say it) must never render as if the dose was taken.
  boot.dose_log.forEach(r => { if (r.status === "Taken") ticks.set(`${r.date}|${r.time_of_day}|${r.prescription_id}`, r); });
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
  // A hand-edited Sheet can end up with two Active rows for the same person+medicine (see
  // bootstrap's warnings) -- collapse to the first so the pill never shows twice.
  return dedupeActivePrescriptions([...idx.prescriptions.values()].filter(p => p.userId === ownerId));
}
function dosesFor(idx, prescriptions) {
  return prescriptions.flatMap(p => idx.dosesByPrescription.get(p.id) || []);
}

// The oldest day bootstrap's dose_log actually covers (today - (window-1)); anything older is a
// day the phone has no Taken/Skipped rows for at all, taken or not -- never mistake that silence
// for a missed dose.
function loadedFloor(today) {
  return addDays(today, -(DOSE_LOG_WINDOW_DAYS - 1));
}

// What a DoseLog row says went in his mouth: the amount and unit recorded at tick time, never
// whatever the prescription says now.
function tickFrom(row) {
  return row ? { at: String(row.taken_at).slice(11, 16), amount: row.amount_taken, unit: row.unit } : null;
}

// A dose he ticked that no current PrescriptionDoses row backs any more: the dose was moved to
// another time of day, removed, or the whole prescription was stopped or narrowed off this day.
// doseItemsOn can only build items from a CURRENT dose row, so before this these ticks rendered
// nowhere at all -- Today under-reported what he had taken, and (worse) offered the same tablet
// again at its new time with nothing on screen to say it had already been swallowed.
//
// Reads boot.dose_log only. DoseLog is written by tick/tickAll/untick and by nothing else.
function receiptItems(idx, prescriptions, date, coveredKeys) {
  const owned = new Set(prescriptions.map(p => p.id));
  const out = [];
  (idx.boot.dose_log || []).forEach(r => {
    if (String(r.status) !== "Taken" || String(r.date) !== date) return;
    const timeOfDay = String(r.time_of_day);
    if (!TIMES_OF_DAY.includes(timeOfDay)) return;
    const prescriptionId = String(r.prescription_id);
    if (!owned.has(prescriptionId)) return;
    const key = doseKey(date, timeOfDay, prescriptionId);
    // Already drawn as an ordinary ticked row, or a duplicate Taken row a hand-edited Sheet left.
    if (coveredKeys.has(key) || out.some(x => x.key === key)) return;
    const prescription = idx.prescriptions.get(prescriptionId);
    if (!prescription) return;
    out.push({
      key, timeOfDay, prescription,
      // No current dose row is the whole point: `dose: null` is what marks this a receipt, and
      // what js/views/today.js draws without a tick control.
      dose: null,
      medicine: idx.medicines.get(prescription.medicineId) || null,
      tick: tickFrom(r),
      receipt: true,
    });
  });
  return out;
}

// Every dose the app should show for one day: the doses the prescription schedules that day,
// plus one receipt per already-taken dose the schedule can no longer place -- and one scheduled
// dose dropped per receipt, so the same tablet is never offered a second time.
function dayItems(idx, prescriptions, doses, date) {
  const scheduled = doseItemsOn(prescriptions, doses, date).map(it => ({
    key: it.key, timeOfDay: it.timeOfDay, prescription: it.prescription, dose: it.dose,
    medicine: idx.medicines.get(it.prescription.medicineId) || null,
    tick: tickFrom(idx.ticks.get(it.key)),
    receipt: false,
  }));
  const receipts = receiptItems(idx, prescriptions, date, new Set(scheduled.map(i => i.key)));
  if (!receipts.length) return scheduled;
  // He took N doses of this medicine today that the schedule can no longer place; N of the
  // doses it now places are therefore the same tablets under a new time of day. Drop that many
  // un-ticked ones, earliest time of day first (doseItemsOn is already in that order) -- showing
  // one of them as outstanding is exactly how the old version came to prompt a second
  // blood-pressure tablet. A prescription with no receipt is untouched.
  const owed = new Map();
  receipts.forEach(r => { owed.set(r.prescription.id, (owed.get(r.prescription.id) || 0) + 1); });
  const dropped = new Set();
  scheduled.forEach(i => {
    if (i.tick) return;
    const left = owed.get(i.prescription.id) || 0;
    if (!left) return;
    owed.set(i.prescription.id, left - 1);
    dropped.add(i.key);
  });
  return scheduled.filter(i => !dropped.has(i.key)).concat(receipts);
}

export function todayModel(idx, { ownerId, viewerId, date, today, nowTimeOfDay }) {
  const prescriptions = ownerPrescriptions(idx, ownerId);
  const doses = dosesFor(idx, prescriptions);
  const viewerIsOwner = !!viewerId && viewerId === ownerId;
  const canTick = viewerIsOwner && date <= today;
  const historyNotLoaded = date < loadedFloor(today);
  const items = dayItems(idx, prescriptions, doses, date);
  const slots = TIMES_OF_DAY.map(timeOfDay => {
    const slotItems = items.filter(i => i.timeOfDay === timeOfDay);
    const taken = slotItems.filter(i => i.tick).length;
    const due = slotItems.length;
    const rawStatus = slotStatus({ due, taken, date, today, timeOfDay, nowTimeOfDay });
    // No DoseLog rows were loaded for a day this old, so "0 taken" proves nothing -- showing it
    // as "missed" would be a flat-out lie the app can't back up.
    const status = historyNotLoaded && rawStatus === "missed" ? "unknown" : rawStatus;
    return {
      timeOfDay, items: slotItems, taken, due, status,
      canTickAll: canTick && due - taken > 1,
    };
  });
  const asNeeded = prescriptions
    .filter(p => p.freq === FREQ.AS_NEEDED && p.status === "Active" && date >= p.startedOn)
    .map(p => ({ prescription: p, medicine: idx.medicines.get(p.medicineId) || null }));
  return {
    date, isToday: date === today, canTick, viewerIsOwner, historyNotLoaded,
    taken: slots.reduce((a, s) => a + s.taken, 0),
    due: slots.reduce((a, s) => a + s.due, 0),
    slots, asNeeded,
  };
}

// The same list Today draws, so the week strip's dot counts an already-taken dose whose dose row
// has since moved or been stopped instead of quietly losing it -- the ring and the dot can never
// disagree about the same day.
function dayCounts(idx, ownerId, day, includeTimes, filterFn) {
  const prescriptions = ownerPrescriptions(idx, ownerId).filter(filterFn);
  const doses = dosesFor(idx, prescriptions);
  const items = dayItems(idx, prescriptions, doses, day).filter(i => includeTimes.includes(i.timeOfDay));
  const due = items.length;
  const taken = items.filter(i => i.tick).length;
  return { due, taken };
}

function dayResult(idx, ownerId, day, today, nowTimeOfDay) {
  if (day > today) return "";
  // Older than the loaded DoseLog window: no Taken/Skipped rows for this day exist to check
  // against, so show no dot rather than a false "missed" (M2).
  if (day < loadedFloor(today)) return "";
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

// Which of bootstrap's { user_id, message } warnings Today's banner should show for the person
// being viewed: that person's own, plus Sheet-wide ones (blank user_id) that could affect anyone.
export function warningsForOwner(warnings, ownerId) {
  return (warnings || []).filter(w => w.user_id === ownerId || w.user_id === "");
}

// Which person the app should open on: yourself. Everyone lands on their own medicines and taps
// the person switcher to look at someone else -- so nobody is ever unsure whose list they are
// reading, which matters most for the one person who is also the one ticking doses off.
// The Primary fallback is only for a viewer who somehow isn't in `people` at all.
export function defaultOwnerId(people, viewerId) {
  const list = people || [];
  if (list.some(p => p.user_id === viewerId && p.medicines)) return viewerId;
  const primary = list.find(p => p.role === "Primary" && p.medicines);
  return primary ? primary.user_id : viewerId;
}

export function weekModel(idx, ownerId, date, today, nowTimeOfDay) {
  const monday = addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    return { date: d, weekday: weekdayOf(d), day: Number(d.slice(8)), result: dayResult(idx, ownerId, d, today, nowTimeOfDay) };
  });
}

// ---- Meds, medicine detail, Doctors, Emergency (Task 8) ----

// [column, what the family sees, the slot name the server's photo actions take]
const PHOTO_FIELDS = [
  ["photo_box", "Box", "box"],
  ["photo_packet_front", "Packet front", "packet_front"],
  ["photo_packet_back", "Packet back", "packet_back"],
  ["photo_pill_front", "Pill front", "pill_front"],
  ["photo_pill_back", "Pill back", "pill_back"],
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
  const photos = PHOTO_FIELDS.map(([field, label, slot]) => ({ label, slot, url: medicine ? driveImageUrl(medicine[field]) : "" }));
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
  // Whether to offer Delete rather than only Stop. A prescription with any dose recorded against
  // it must keep its history, so Delete is only for the medicine added by mistake. This reads
  // boot.dose_log rather than idx.ticks on purpose: idx.ticks holds only status=Taken rows, but
  // deletePrescription refuses on ANY DoseLog row, a Skipped one included -- reading the ticks
  // would offer a Delete button that could only ever fail. Bootstrap still sends just the last
  // DOSE_LOG_WINDOW_DAYS, so an older row can leave this true; the server checks the whole sheet
  // again and says why it refused, which is why a wrong answer here is only a button.
  const canDelete = !(idx.boot.dose_log || []).some(r => r.prescription_id === prescriptionId);
  return { prescription: p, medicine, doses, photos, doctor, hospital, hn, history, canDelete };
}

// Whether to draw an edit button. The grant came from the server inside bootstrap
// (people[].medicines), and the server checks it again on every write -- so a wrong answer here
// is a missing or extra button, never a way in.
export function canEditOwner(idx, ownerId) {
  const person = idx.people.get(ownerId);
  return !!person && person.medicines === "Edit";
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

// ---- Medicine, Doctor and Hospital libraries (Task 4) ----

// Every name in these libraries can carry Thai characters, and a strength like "10 mg" must sort
// after "5 mg" rather than before it -- hence locale-aware, numeric-aware comparison everywhere
// here, never a raw < or >.
function localeSort(strings) {
  return strings.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}
function byLocale(key) {
  return (a, b) => key(a).localeCompare(key(b), undefined, { sensitivity: "base", numeric: true });
}

// The thumbnail shown in a medicine's library row: the first photo slot that actually has one,
// in the same box/packet/pill priority order the detail screen uses to recognise the medicine.
function firstMedicinePhotoUrl(medicine) {
  for (const [field] of PHOTO_FIELDS) {
    const url = driveImageUrl(medicine[field]);
    if (url) return url;
  }
  return "";
}

// Who currently takes a medicine: only Active prescriptions count as "taking it" in the present
// tense -- a Stopped course still blocks deleting the medicine (it is history), but it does not
// belong in a "who takes this" list.
function activeTakerIds(idx, medicineId) {
  return [...new Set([...idx.prescriptions.values()].filter(p => p.medicineId === medicineId && p.status === "Active").map(p => p.userId))];
}
function displayNameOf(idx, userId) {
  return (idx.people.get(userId) || {}).display_name || "";
}

// canDelete below must mirror server/actions.js exactly (deleteMedicine/deleteDoctor/
// deleteHospital, via their shared referencesTo helper) -- a wrong answer here is a Delete
// button the server will refuse, which reads to the family as a broken app.
function medicineIsReferenced(idx, medicineId) {
  // deleteMedicine refuses on ANY Prescriptions row naming the medicine, Active or Stopped --
  // a stopped course is still history.
  return [...idx.prescriptions.values()].some(p => p.medicineId === medicineId);
}
function doctorIsReferenced(idx, doctorId) {
  // deleteDoctor refuses on any Prescriptions.doctor_id or CareTeam.doctor_id row.
  const inPrescriptions = [...idx.prescriptions.values()].some(p => p.doctorId === doctorId);
  const inCareTeam = (idx.boot.care_team || []).some(c => c.doctor_id === doctorId);
  return inPrescriptions || inCareTeam;
}
function hospitalIsReferenced(idx, hospitalId) {
  // deleteHospital refuses on any HospitalNumbers, CareTeam or DoctorHospitals row.
  const inHospitalNumbers = (idx.boot.hospital_numbers || []).some(h => h.hospital_id === hospitalId);
  const inCareTeam = (idx.boot.care_team || []).some(c => c.hospital_id === hospitalId);
  const inDoctorHospitals = (idx.boot.doctor_hospitals || []).some(dh => dh.hospital_id === hospitalId);
  return inHospitalNumbers || inCareTeam || inDoctorHospitals;
}

export function medicineLibraryModel(idx) {
  const rows = [...idx.medicines.values()].map(medicine => {
    const { name, strength } = medicineNameParts(medicine);
    const medicineId = medicine.medicine_id;
    const takenBy = localeSort(activeTakerIds(idx, medicineId).map(userId => displayNameOf(idx, userId)).filter(Boolean));
    return {
      medicine, name, strength,
      photoUrl: firstMedicinePhotoUrl(medicine),
      takenBy,
      canDelete: !medicineIsReferenced(idx, medicineId),
    };
  });
  rows.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    return byName || a.strength.localeCompare(b.strength, undefined, { sensitivity: "base", numeric: true });
  });
  return { rows };
}

export function medicineLibraryDetail(idx, medicineId) {
  const medicine = idx.medicines.get(medicineId);
  if (!medicine) return null;
  const { name, strength } = medicineNameParts(medicine);
  const photos = PHOTO_FIELDS.map(([field, label]) => ({ label, url: driveImageUrl(medicine[field]) }));
  const takenBy = activeTakerIds(idx, medicineId)
    .map(userId => ({ userId, displayName: displayNameOf(idx, userId) }))
    .sort(byLocale(t => t.displayName));
  return {
    medicine, name, strength,
    unit: unitForMedicineForm(medicine.form),
    photos, takenBy,
    canDelete: !medicineIsReferenced(idx, medicineId),
  };
}

export function doctorLibraryModel(idx) {
  const rows = [...idx.doctors.values()].map(doctor => {
    const doctorId = doctor.doctor_id;
    const hospitalNames = localeSort(
      (idx.boot.doctor_hospitals || [])
        .filter(dh => dh.doctor_id === doctorId)
        .map(dh => (idx.hospitals.get(dh.hospital_id) || {}).name)
        .filter(Boolean)
    );
    return {
      doctor, hospitalNames,
      photoUrl: driveImageUrl(doctor.photo),
      canDelete: !doctorIsReferenced(idx, doctorId),
    };
  });
  rows.sort(byLocale(r => r.doctor.name));
  return { rows };
}

export function hospitalLibraryModel(idx) {
  const rows = [...idx.hospitals.values()].map(hospital => {
    const hospitalId = hospital.hospital_id;
    const doctorNames = localeSort(
      (idx.boot.doctor_hospitals || [])
        .filter(dh => dh.hospital_id === hospitalId)
        .map(dh => (idx.doctors.get(dh.doctor_id) || {}).name)
        .filter(Boolean)
    );
    return {
      hospital, doctorNames,
      canDelete: !hospitalIsReferenced(idx, hospitalId),
    };
  });
  rows.sort(byLocale(r => r.hospital.name));
  return { rows };
}
