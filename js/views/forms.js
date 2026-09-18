// The three screens the family types into: a medicine for the shared library, a medicine somebody
// starts taking, and a change of dose. Same shape as renderEmergencyEdit: a <form data-form="…">
// the submit handler dispatches on, a live error line above the button, a save button that goes
// dead while the save is in flight, and esc() on every value -- all of it typed by hand into a
// spreadsheet, so none of it is trusted.
//
// Every label is a sentence, not a column name: the people using this are a 64-year-old man and
// his daughter, reading a phone, sometimes without glasses.
import { esc } from "../html.js";
import { I } from "../icons.js";
import { TIMES_OF_DAY, FREQ, WEEKDAYS, MEDICINE_FORMS, unitForMedicineForm, pluralUnit, medicineNameParts } from "../schedule.js";
import { deleteBlock } from "./common.js";

// The exact strings the Sheet and server accept, paired with what the family reads.
const FREQ_LABELS = [
  [FREQ.DAILY, "Every day"],
  [FREQ.EVERY_N, "Every so many days"],
  [FREQ.WEEKDAYS, "Only on certain days of the week"],
  [FREQ.AS_NEEDED, "Only when needed"],
];
const MEAL_LABELS = [
  ["Any time", "Any time — meals don't matter"],
  ["Before meal", "Before a meal"],
  ["After meal", "After a meal"],
  ["With meal", "With a meal"],
];
const WEEKDAY_LABELS = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

const val = v => esc(v == null ? "" : v);

function topBar(title) {
  return `<div class="top"><button type="button" class="circle-btn" data-cancel aria-label="Go back without saving">${I.back}</button><span class="title-sm">${esc(title)}</span><span class="spacer"></span></div>`;
}
function errorLine(error) {
  return `<p class="err" role="alert">${val(error)}</p>`;
}
function saveButton(busy, label) {
  return `<button class="primary" ${busy ? "disabled" : ""}>${busy ? "Saving…" : esc(label)}</button>`;
}

// One amount per time of day, blank meaning "nothing at this time". The amount box stays a real
// number input (the phone shows a number pad) but is never pre-filled with 0 -- an empty box has
// to mean "not then". min is 0.01 rather than 0 so the phone catches a typed 0 itself, instead of
// letting it travel to the server only to come back as an error; half and quarter tablets still
// go through.
//
// What the amount is counted in is NOT asked for: the medicine's form already says it (a Tablet
// is counted in tablets), so it stands beside the box as fixed text -- "Morning [2] tablets".
// Typing "tablet" four times to record one prescription was four chances to type it differently.
// js/app.js keeps that word in step with what is typed; the server derives it again from the
// medicine and never trusts what the phone sends.
//
// A Cream, an Other or a medicine with no form has no unit to derive -- that is the escape hatch
// for anything counted in its own words, insulin above all -- so for those, and only those, the
// second box comes back and asks.
function doseRows(doses, medicineForm) {
  const unit = unitForMedicineForm(medicineForm);
  const byTime = new Map();
  (doses || []).forEach(d => { if (d && !byTime.has(d.timeOfDay)) byTime.set(d.timeOfDay, d); });
  // The columns carry a heading that stays on screen: a placeholder vanishes the moment he
  // starts typing, which is exactly when he still needs to know which box is which.
  const head = `<div class="form-row dose-row dose-head" aria-hidden="true"><span></span>
    <div class="dose-line${unit ? " fixed-unit" : ""}"><span>How much</span>${unit ? "" : `<span>Tablets, ml, drops…</span>`}</div></div>`;
  return head + TIMES_OF_DAY.map(t => {
    const d = byTime.get(t);
    const amount = d ? val(d.amount) : "";
    const second = unit
      ? `<span class="unit-word" data-unit-word aria-label="${esc(unit)}">${esc(pluralUnit(unit, d ? d.amount : ""))}</span>`
      : `<input id="f-unit-${t}" name="unit${t}" value="${d ? val(d.unit) : ""}" type="text" placeholder="tablet, ml" autocomplete="off" aria-label="What the ${t} amount is counted in, like tablet or ml">`;
    return `<div class="form-row dose-row"><label for="f-amount-${t}">${t}</label>
      <div class="dose-line${unit ? " fixed-unit" : ""}">
        <input id="f-amount-${t}" name="amount${t}" value="${amount}" type="number" inputmode="decimal" min="0.01" step="any" placeholder="How much"${unit ? ` data-unit="${esc(unit)}"` : ""}>
        ${second}
      </div></div>`;
  }).join("");
}

// The medicine whose form decides the unit: on the prescription form, whichever one is picked
// right now (the picker re-renders the page, so the word beside every box follows the pick).
function pickedMedicine(model) {
  const id = model.medicineId;
  return id ? (model.medicines || []).find(m => m && m.medicine_id === id) || null : null;
}

const DOSE_HINT = `<p class="note">Type how much to take at each time of day. Leave a time empty if there's nothing to take then.</p>`;

// ---- the medicine itself (the family's shared library) ----

const MEDICINE_FIELDS = [
  ["generic_name", "Medicine name, like Amlodipine", "text", true],
  ["brand_name", "Brand name, if the box shows a different one (optional)", "text", false],
  ["strength", "Strength, like 5 mg (optional)", "text", false],
  ["form", "What kind it is — this is what the doses get counted in", "form", false],
  ["purpose", "What it's for, like blood pressure (optional)", "text", false],
  ["notes", "Anything else worth remembering (optional)", "textarea", false],
];

// What kind of medicine it is, picked from the Sheet's own list rather than typed, because this
// is now the answer to "a dose of this is one what?" -- a typed "tablets" would match nothing and
// send him back to typing the unit by hand on every prescription. Each choice says what it means
// in his words. A value already in the Sheet that is not on the list keeps an option of its own,
// so opening this form and saving can never quietly erase it.
const FORM_LABELS = {
  Tablet: "Tablet — counted in tablets",
  Capsule: "Capsule — counted in capsules",
  Liquid: "Liquid — counted in ml",
  Injection: "Injection — counted in injections",
  Inhaler: "Inhaler — counted in puffs",
  Drops: "Drops — counted in drops",
  Patch: "Patch — counted in patches",
  Cream: "Cream or ointment",
  Other: "Something else — you'll type the unit yourself",
};
function formPicker(value) {
  const current = String(value == null ? "" : value).trim();
  const known = MEDICINE_FORMS.slice();
  if (current && !known.some(f => f.toLowerCase() === current.toLowerCase())) known.push(current);
  const options = known.map(f =>
    `<option value="${val(f)}" ${f.toLowerCase() === current.toLowerCase() ? "selected" : ""}>${esc(FORM_LABELS[f] || f)}</option>`).join("");
  return `<select id="f-form" name="form"><option value="" ${current ? "" : "selected"}>Not set — you'll type the unit yourself</option>${options}</select>`;
}

export function renderMedicineForm({ medicine, error, busy }) {
  const med = medicine || {};
  const editing = !!med.medicine_id;
  const fields = MEDICINE_FIELDS.map(([name, label, type, required]) => `<div class="field"><label for="f-${name}">${esc(label)}</label>${type === "textarea"
    ? `<textarea id="f-${name}" name="${name}" rows="3">${val(med[name])}</textarea>`
    : type === "form"
      ? formPicker(med[name])
      : `<input id="f-${name}" name="${name}" value="${val(med[name])}" type="${type}" autocomplete="off" ${required ? "required" : ""}>`}</div>`).join("");
  return `${topBar(editing ? "Edit this medicine" : "New medicine")}
    <h1 class="big">${editing ? "Edit this medicine" : "Add a medicine"}</h1>
    <p class="note">This is the medicine itself, as it's written on the box. How much to take, and when, is set separately for each person.</p>
    <form class="edit-form" data-form="medicine">
      ${editing ? `<input type="hidden" name="medicineId" value="${val(med.medicine_id)}">` : ""}
      ${fields}
      ${errorLine(error)}
      ${saveButton(busy, editing ? "Save changes" : "Add this medicine")}
    </form>`;
}

// ---- a doctor in the family's shared list ----
//
// Every input name is the server's own field name (DOCTOR_FIELDS in server/actions.js:
// name, specialty, phone, other_contact, notes), so the submit handler can hand the fields
// straight to saveDoctor with no translation table in between. The hospital boxes all share
// name="hospitalIds", which is the array setDoctorHospitals takes.

// A doctor's photo lives on the doctor row, which has to exist before a photo can be attached to
// it -- so a brand-new doctor is saved first and gets the photo buttons on the next visit, and
// the form says so rather than showing buttons that would fail.
function doctorPhotoBlock(model) {
  const doctorId = model.doctorId || (model.doctor && model.doctor.doctor_id) || "";
  if (!doctorId) return `<p class="note">You can add a photo of the doctor once they're saved.</p>`;
  const url = model.photoUrl || "";
  return `<div class="photorow">
    <span class="pic">${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : I.team}</span>
    <div><strong>Photo of the doctor</strong>
      <div class="btnrow">
        <button type="button" data-upload-doctor-photo="${val(doctorId)}">${url ? "Replace" : "Add photo"}</button>
        ${url ? `<button type="button" class="danger" data-remove-doctor-photo="${val(doctorId)}">Remove</button>` : ""}
      </div></div></div>`;
}

function hospitalChecks(model) {
  const hospitals = model.hospitals || [];
  const picked = (model.hospitalIds || []).map(String);
  if (!hospitals.length) {
    return `<div class="form-row"><span class="rowlabel">Where do they see patients?</span>
      <p class="note">There are no hospitals or clinics in the list yet. Add one on the Hospitals list first, then come back.</p></div>`;
  }
  return `<div class="form-row"><span class="rowlabel">Where do they see patients? Tick every place.</span>
    <div class="checklist">${hospitals.map(h =>
      `<label class="checkrow"><input type="checkbox" name="hospitalIds" value="${val(h.hospital_id)}" ${picked.includes(String(h.hospital_id)) ? "checked" : ""}><span>${esc(h.name)}</span></label>`).join("")}</div></div>`;
}

const DOCTOR_FIELDS_FORM = [
  ["name", "Doctor's name, as you'd say it", "text", true],
  ["specialty", "What they treat, like heart or kidneys (optional)", "text", false],
  ["phone", "Phone number (optional)", "tel", false],
  ["other_contact", "Another way to reach them, like a LINE ID (optional)", "text", false],
  ["notes", "Anything else worth remembering (optional)", "textarea", false],
];

export function renderDoctorForm({ model, error, busy }) {
  const m = model || {};
  const doctor = m.doctor || {};
  const editing = !!(m.doctorId || doctor.doctor_id);
  const fields = DOCTOR_FIELDS_FORM.map(([name, label, type, required]) => `<div class="field"><label for="f-doc-${name}">${esc(label)}</label>${type === "textarea"
    ? `<textarea id="f-doc-${name}" name="${name}" rows="3">${val(doctor[name])}</textarea>`
    : `<input id="f-doc-${name}" name="${name}" value="${val(doctor[name])}" type="${type}" autocomplete="off" ${required ? "required" : ""}>`}</div>`).join("");
  return `${topBar(editing ? "Edit this doctor" : "New doctor")}
    <h1 class="big">${editing ? "Edit this doctor" : "Add a doctor"}</h1>
    <p class="note">This is the family's shared list of doctors. Who they look after, and the hospital number, are set separately for each person.</p>
    <form class="edit-form" data-form="doctor">
      ${editing ? `<input type="hidden" name="doctorId" value="${val(m.doctorId || doctor.doctor_id)}">` : ""}
      ${fields}
      ${doctorPhotoBlock(m)}
      ${hospitalChecks(m)}
      ${errorLine(error)}
      ${saveButton(busy, editing ? "Save changes" : "Add this doctor")}
    </form>
    ${deleteBlock({
      canDelete: m.canDelete,
      attr: "data-delete-doctor",
      id: m.doctorId || doctor.doctor_id || "",
      label: "Delete this doctor",
      why: "This doctor can't be removed while they're named on a medicine somebody takes, or they're on somebody's care team.",
    })}`;
}

// ---- a hospital or clinic in the family's shared list ----
//
// Same rule: every input name is one of HOSPITAL_FIELDS (name, phone, address, map_link, notes).

const HOSPITAL_FIELDS_FORM = [
  ["name", "Name of the hospital or clinic", "text", true],
  ["phone", "Phone number (optional)", "tel", false],
  ["address", "Address (optional)", "textarea", false],
  ["map_link", "Link to it on a map, if you have one (optional)", "text", false],
  ["notes", "Anything else worth remembering (optional)", "textarea", false],
];

export function renderHospitalForm({ model, error, busy }) {
  const m = model || {};
  const hospital = m.hospital || {};
  const editing = !!(m.hospitalId || hospital.hospital_id);
  const fields = HOSPITAL_FIELDS_FORM.map(([name, label, type, required]) => `<div class="field"><label for="f-hos-${name}">${esc(label)}</label>${type === "textarea"
    ? `<textarea id="f-hos-${name}" name="${name}" rows="2">${val(hospital[name])}</textarea>`
    : `<input id="f-hos-${name}" name="${name}" value="${val(hospital[name])}" type="${type}" autocomplete="off" ${required ? "required" : ""}>`}</div>`).join("");
  return `${topBar(editing ? "Edit this hospital" : "New hospital or clinic")}
    <h1 class="big">${editing ? "Edit this place" : "Add a hospital or clinic"}</h1>
    <p class="note">Anywhere the family goes for care — a big hospital or a small clinic, both belong here.</p>
    <form class="edit-form" data-form="hospital">
      ${editing ? `<input type="hidden" name="hospitalId" value="${val(m.hospitalId || hospital.hospital_id)}">` : ""}
      ${fields}
      ${errorLine(error)}
      ${saveButton(busy, editing ? "Save changes" : "Add this place")}
    </form>
    ${deleteBlock({
      canDelete: m.canDelete,
      attr: "data-delete-hospital",
      id: m.hospitalId || hospital.hospital_id || "",
      label: "Delete this place",
      why: "This place can't be removed while somebody's hospital number, somebody's care team, or a doctor who works there still points at it.",
    })}`;
}

// ---- somebody starts taking a medicine ----

function medicinePicker(model) {
  const medicines = model.medicines || [];
  const options = medicines.map(m => {
    // The same brand-first name the lists show, so the one he picks here is the one he read on
    // the box. Plain text: an <option> has no markup.
    const parts = medicineNameParts(m);
    const label = [parts.name, parts.strength].filter(Boolean).join(" ");
    return `<option value="${val(m.medicine_id)}" ${m.medicine_id === model.medicineId ? "selected" : ""}>${esc(label)}</option>`;
  }).join("");
  // data-medpick re-renders the form on a pick (the same hook data-freq uses): the medicine is
  // what decides the unit beside each amount box, so the word has to follow the choice.
  return `<div class="form-row"><label for="f-medicine">Which medicine?</label>
      <select id="f-medicine" name="medicineId" data-medpick required>
        <option value="">Choose one…</option>${options}
      </select></div>
    <button type="button" class="primary light" data-new-medicine>It's not in the list — add it</button>`;
}

function frequencyRows(model) {
  const frequency = model.frequency || FREQ.DAILY;
  const picked = model.weekdays || [];
  const options = FREQ_LABELS.map(([value, label]) =>
    `<option value="${value}" ${value === frequency ? "selected" : ""}>${esc(label)}</option>`).join("");
  // Only the rows that belong to the chosen schedule are on the page at all, so there is nothing
  // half-filled to puzzle over -- picking a different schedule re-renders the form.
  const extra = frequency === FREQ.EVERY_N
    ? `<div class="form-row"><label for="f-everyn">How many days between doses?</label>
        <input id="f-everyn" name="everyNDays" value="${val(model.everyNDays)}" type="number" inputmode="numeric" min="1" step="1" placeholder="2"></div>
      <div class="form-row"><label for="f-countfrom">Which day was a dose day? The app counts from there.</label>
        <input id="f-countfrom" name="countFrom" value="${val(model.countFrom)}" type="date"></div>`
    : frequency === FREQ.WEEKDAYS
      ? `<div class="form-row"><span class="rowlabel">Which days of the week?</span>
          <div class="daypicks">${WEEKDAYS.map(d =>
            `<label class="daypick"><input type="checkbox" name="weekdays" value="${d}" ${picked.includes(d) ? "checked" : ""}><span aria-hidden="true">${d}</span><span class="vh">${WEEKDAY_LABELS[d]}</span></label>`).join("")}</div></div>`
      : "";
  return `<div class="form-row"><label for="f-frequency">How often is it taken?</label>
      <select id="f-frequency" name="frequency" data-freq>${options}</select></div>
    ${extra}`;
}

function mealRow(model) {
  const chosen = model.mealTiming || "Any time";
  return `<div class="form-row"><label for="f-meal">Before or after food?</label>
    <select id="f-meal" name="mealTiming">${MEAL_LABELS.map(([value, label]) =>
      `<option value="${value}" ${value === chosen ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></div>`;
}

function doctorRow(model) {
  const doctors = model.doctors || [];
  return `<div class="form-row"><label for="f-doctor">Who prescribed it?</label>
    <select id="f-doctor" name="doctorId">
      <option value="">Not recorded</option>${doctors.map(d =>
        `<option value="${val(d.doctor_id)}" ${d.doctor_id === model.doctorId ? "selected" : ""}>${esc(d.name)}</option>`).join("")}
    </select></div>`;
}

// "Why the change? (optional)" -- the same box on both forms that record a change, because the
// wording of the history entry the family reads later comes straight out of it.
function reasonRow(model) {
  return `<div class="form-row"><label for="f-reason">Why the change? (optional)</label>
    <textarea id="f-reason" name="reason" rows="2" placeholder="${esc(model.reasonHint || "Like: the doctor changed it")}">${val(model.reason)}</textarea></div>`;
}

export function renderPrescriptionForm({ model, error, busy }) {
  const m = model || {};
  const who = m.ownerName ? `Add a medicine ${esc(m.ownerName)} takes` : "Add a medicine to take";
  return `${topBar("New medicine to take")}
    <h1 class="big">${who}</h1>
    <form class="edit-form" data-form="prescription">
      ${medicinePicker(m)}
      ${frequencyRows(m)}
      ${mealRow(m)}
      <div class="sec-head"><span class="dash">How much, and when</span></div>
      ${DOSE_HINT}
      ${doseRows(m.doses, (pickedMedicine(m) || {}).form)}
      ${doctorRow(m)}
      <div class="form-row"><label for="f-notes">Anything to remember about taking it (optional)</label>
        <textarea id="f-notes" name="notes" rows="2" placeholder="Like: don't take with milk">${val(m.notes)}</textarea></div>
      ${errorLine(error)}
      ${saveButton(busy, "Add to the list")}
    </form>`;
}

// ---- the dose changed ----

export function renderDoseForm({ model, error, busy }) {
  const m = model || {};
  return `${topBar("Change the dose")}
    <h1 class="big">How much ${m.medicineName ? esc(m.medicineName) : "of this medicine"}?</h1>
    <form class="edit-form" data-form="dose">
      ${m.prescriptionId ? `<input type="hidden" name="prescriptionId" value="${val(m.prescriptionId)}">` : ""}
      ${DOSE_HINT}
      ${doseRows(m.doses, m.medicineForm)}
      ${reasonRow({ ...m, reasonHint: "Like: the doctor halved it" })}
      <p class="note">The old amount stays in this medicine's history, so you can always see what changed and when.</p>
      ${errorLine(error)}
      ${saveButton(busy, "Save the new dose")}
    </form>`;
}

// ---- the days and times changed ----
//
// Deliberately NOT the add form in another costume. changePrescriptionSchedule reads only the
// schedule fields (frequency, every_n_days, weekdays, count_from, meal_timing, doctor_id): it
// ignores medicineId and doses outright. Showing a medicine picker or four amount boxes here
// would take an edit the daughter made and throw it away without a word -- the exact failure
// this release exists to remove. So neither is on this form, and the note says where they live.
export function renderScheduleForm({ model, error, busy }) {
  const m = model || {};
  const name = m.medicineName ? esc(m.medicineName) : "this medicine";
  return `${topBar("Change when it's taken")}
    <h1 class="big">When to take ${name}</h1>
    <form class="edit-form" data-form="schedule">
      ${m.prescriptionId ? `<input type="hidden" name="prescriptionId" value="${val(m.prescriptionId)}">` : ""}
      <p class="note">This changes the days and times only. How much to take stays as it is — use “Change how much to take” for that.</p>
      ${frequencyRows(m)}
      ${mealRow(m)}
      ${doctorRow(m)}
      ${reasonRow({ ...m, reasonHint: "Like: moved to bedtime" })}
      ${errorLine(error)}
      ${saveButton(busy, "Save the new schedule")}
    </form>`;
}
