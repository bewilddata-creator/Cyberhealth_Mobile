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
import { TIMES_OF_DAY, FREQ, WEEKDAYS } from "../schedule.js";

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

// One amount + unit pair per time of day, blank meaning "nothing at this time". The amount box
// stays a real number input (the phone shows a number pad) but is never pre-filled with 0 -- an
// empty box has to mean "not then", and a 0 the server would reject.
function doseRows(doses) {
  const byTime = new Map();
  (doses || []).forEach(d => { if (d && !byTime.has(d.timeOfDay)) byTime.set(d.timeOfDay, d); });
  return TIMES_OF_DAY.map(t => {
    const d = byTime.get(t);
    return `<div class="form-row dose-row"><label for="f-amount-${t}">${t}</label>
      <div class="dose-line">
        <input id="f-amount-${t}" name="amount${t}" value="${d ? val(d.amount) : ""}" type="number" inputmode="decimal" min="0" step="any" placeholder="How much">
        <input id="f-unit-${t}" name="unit${t}" value="${d ? val(d.unit) : ""}" type="text" placeholder="tablet, ml" autocomplete="off" aria-label="What the ${t} amount is counted in, like tablet or ml">
      </div></div>`;
  }).join("");
}

const DOSE_HINT = `<p class="note">Type how much to take at each time of day. Leave a time empty if there's nothing to take then.</p>`;

// ---- the medicine itself (the family's shared library) ----

const MEDICINE_FIELDS = [
  ["generic_name", "Medicine name, like Amlodipine", "text", true],
  ["brand_name", "Brand name, if the box shows a different one (optional)", "text", false],
  ["strength", "Strength, like 5 mg (optional)", "text", false],
  ["form", "What kind it is — tablet, capsule, drops (optional)", "text", false],
  ["purpose", "What it's for, like blood pressure (optional)", "text", false],
  ["notes", "Anything else worth remembering (optional)", "textarea", false],
];

export function renderMedicineForm({ medicine, error, busy }) {
  const med = medicine || {};
  const editing = !!med.medicine_id;
  const fields = MEDICINE_FIELDS.map(([name, label, type, required]) => `<div class="field"><label for="f-${name}">${esc(label)}</label>${type === "textarea"
    ? `<textarea id="f-${name}" name="${name}" rows="3">${val(med[name])}</textarea>`
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

// ---- somebody starts taking a medicine ----

function medicinePicker(model) {
  const medicines = model.medicines || [];
  const options = medicines.map(m => {
    const label = [m.generic_name, m.strength].filter(Boolean).join(" ");
    return `<option value="${val(m.medicine_id)}" ${m.medicine_id === model.medicineId ? "selected" : ""}>${esc(label)}</option>`;
  }).join("");
  return `<div class="form-row"><label for="f-medicine">Which medicine?</label>
      <select id="f-medicine" name="medicineId" required>
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
  return `<div class="form-row"><label for="f-meal">When, around food?</label>
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

export function renderPrescriptionForm({ model, error, busy }) {
  const m = model || {};
  const who = m.ownerName ? `What ${esc(m.ownerName)} takes` : "A new medicine to take";
  return `${topBar("New medicine to take")}
    <h1 class="big">${who}</h1>
    <form class="edit-form" data-form="prescription">
      ${medicinePicker(m)}
      ${frequencyRows(m)}
      ${mealRow(m)}
      <div class="sec-head"><span class="dash">How much, and when</span></div>
      ${DOSE_HINT}
      ${doseRows(m.doses)}
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
      ${doseRows(m.doses)}
      <div class="form-row"><label for="f-reason">Why the change? (optional)</label>
        <textarea id="f-reason" name="reason" rows="2" placeholder="Like: the doctor halved it">${val(m.reason)}</textarea></div>
      <p class="note">The old amount stays in this medicine's history, so you can always see what changed and when.</p>
      ${errorLine(error)}
      ${saveButton(busy, "Save the new dose")}
    </form>`;
}
