// The three shared lists the family keeps: every medicine, every doctor, every hospital or
// clinic. One family, one list of each -- these are not per-person, which is why they hang off
// More rather than off somebody's Medicines tab.
//
// Same building blocks as the rest of the app: .medrow for a tappable row (js/views/meds.js),
// .field for the search box, .gallery and .photorow for the photos (js/views/detail.js). Every
// value here was typed by hand into a spreadsheet, so esc() goes on all of them.
//
// Wiring is Task 6's: every control carries a stable data-* attribute and nothing else.
import { esc } from "../html.js";
import { I } from "../icons.js";
import { pluralUnit } from "../schedule.js";
import { doctorThumb } from "./common.js";

function matches(text, query) {
  const q = String(query == null ? "" : query).trim().toLowerCase();
  if (!q) return true;
  return String(text == null ? "" : text).toLowerCase().includes(q);
}

// "Dad", "Dad and Pim", "Dad, Pim and Top" -- read aloud, not comma-separated to the end.
function nameList(names) {
  const clean = (names || []).filter(Boolean).map(String);
  if (clean.length <= 1) return esc(clean[0] || "");
  return esc(`${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`);
}

// The line under the heading: how many the list holds, as a sentence. "No medicines the family
// keeps track of" is not English, so an empty list gets its own words.
function countLine(n, one, many, tail) {
  if (n === 0) return "Nothing in this list yet";
  return `${n === 1 ? `1 ${one}` : `${n} ${many}`} ${tail}`;
}

function topBar(title) {
  return `<div class="top"><button type="button" class="circle-btn" data-back-more aria-label="Back to More">${I.back}</button>
    <span class="title-sm">${esc(title)}</span><span class="spacer"></span></div>`;
}

// One search box on all three screens, filtering on the name the row shows -- he types what he
// can read on the row, not a code. The label stays on screen; a placeholder would vanish at the
// moment he still needs to know what the box is for.
function searchBox(query, hint) {
  return `<div class="field"><label for="f-library-search">Find one by name</label>
    <input id="f-library-search" name="librarySearch" type="search" data-library-search
      value="${esc(query == null ? "" : query)}" autocomplete="off" placeholder="${esc(hint)}"></div>`;
}

function emptyList(total, query, addLabel) {
  return total === 0
    ? `<p class="none">Tap “${esc(addLabel)}” to put the first one in.</p>`
    : `<p class="none">Nothing here matches “${esc(String(query || "").trim())}”.</p>`;
}

// Where removing something lives, said once at the foot of the list. Deliberately NOT a Delete
// button on the row: this is a list he scrolls with a thumb, sometimes without his glasses, and
// a destructive control beside a moving row is a mis-tap waiting to happen. The app already
// settled this -- the Meds list has no Delete either, the prescription detail does. So you open
// the thing first, and remove it from there.
const KEEP_NOTE = `<p class="note">Tap anything here to see it or change it. Removing it happens there too — and only when nothing else still uses it, so the family's records keep reading.</p>`;

// A row is one tap target that opens the thing. Nothing else: no second control to catch a
// thumb on the way past.
function libraryRow(openAttr, id, inner) {
  return `<button type="button" class="medrow" ${openAttr}="${esc(id)}">${inner}
    <span class="go">${I.arrow}</span></button>`;
}

function medicineThumb(url) {
  return url
    ? `<span class="thumb"><img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`
    : `<span class="thumb" aria-hidden="true">${I.meds}</span>`;
}

function medicineName(name, strength) {
  const shown = name ? esc(name) : "Unknown medicine";
  return strength ? `${shown} <em>${esc(strength)}</em>` : shown;
}

// A medicine nobody takes now can still be un-deletable, because a course somebody has stopped
// still names it. Without this line the row shows no taker, offers no Delete and gives no reason
// -- which reads as a broken screen rather than an explained one.
//
// Returns HTML: nameList has already escaped the names, so the caller must not escape it again.
function whoTakesIt(takenBy, takenBefore) {
  if (takenBy && takenBy.length) return `Taken by ${nameList(takenBy)}`;
  if (takenBefore) return "Taken before — kept so the older records still read right";
  return "Nobody is taking this at the moment";
}

export function renderMedicineLibrary({ model, query }) {
  const rows = (model && model.rows) || [];
  const shown = rows.filter(r => matches(r.name, query));
  const list = shown.map(r => libraryRow(
    "data-open-medicine", r.medicine ? r.medicine.medicine_id : "",
    `${medicineThumb(r.photoUrl)}
      <div><div class="name">${medicineName(r.name, r.strength)}</div>
        <div class="s">${whoTakesIt(r.takenBy, r.takenBefore)}</div></div>`
  )).join("");
  return `${topBar("The family's lists")}
    <div><h1 class="big">Medicines</h1><p class="sub">${esc(countLine(rows.length, "medicine", "medicines", "the family keeps track of"))}</p></div>
    <button type="button" class="primary light" data-add-medicine>Add a medicine to the list</button>
    ${searchBox(query, "Amlodipine, Norvasc…")}
    <div class="doses">${list || emptyList(rows.length, query, "Add a medicine to the list")}</div>
    ${KEEP_NOTE}`;
}

// ---- one medicine, in full ----

// The same five photo rows as the prescription detail, so a photo can be added or replaced
// without hunting for the right picture first. Same data-* names too, so the photo buttons that
// already work on the prescription screen work here unchanged.
function photoSlots(photos, medicineId) {
  const rows = photos.map(p => {
    // The slot comes from the model, which takes it from PHOTO_FIELDS beside the label. The view
    // never derives one from the label: a label is presentation, somebody will reword it, and a
    // slot derived from "Packet front" would stop matching the day they do.
    const slot = p.slot || "";
    const buttons = slot
      ? `<div class="btnrow">
          <button type="button" data-upload-photo="${esc(medicineId)}|${esc(slot)}">${p.url ? "Replace" : "Add photo"}</button>
          ${p.url ? `<button type="button" class="danger" data-remove-photo="${esc(medicineId)}|${esc(slot)}">Remove</button>` : ""}
        </div>`
      : "";
    return `<div class="photorow">
      <span class="pic">${p.url ? `<img src="${esc(p.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : I.meds}</span>
      <div><strong>${esc(p.label)}</strong>${buttons}</div></div>`;
  }).join("");
  return `<div class="card"><span class="dash">Photos of this medicine</span>${rows}
    <p class="sub">A photo of the box and of the pill itself makes this medicine easy to recognise.</p></div>`;
}

function factRow(label, value) {
  return value ? `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>` : "";
}

export function renderMedicineLibraryDetail({ model, photo }) {
  const back = `<button type="button" class="circle-btn" data-back-library="medicines" aria-label="Back to the medicines list">${I.back}</button>`;
  if (!model) {
    return `<div class="top">${back}<span class="title-sm">Medicine</span><span class="spacer"></span></div>
      <p class="note">This medicine isn't in the list any more. Tap Refresh on the More tab.</p>`;
  }
  const { medicine, name, strength, unit, photos, takenBy, takenBefore, canDelete } = model;
  const medicineId = medicine ? medicine.medicine_id : "";
  const shots = photos || [];
  const index = shots[photo] ? photo : 0;
  const shot = shots[index] || { label: "Box", url: "" };
  const image = shot.url
    ? `<img src="${esc(shot.url)}" alt="${esc(shot.label)} of ${esc(name)}" referrerpolicy="no-referrer">`
    : `<span class="nophoto">${I.meds}<small>No ${esc(String(shot.label).toLowerCase())} photo</small></span>`;
  const takerNames = (takenBy || []).map(t => t.displayName).filter(Boolean);
  const facts = [
    factRow("What it's for", medicine ? medicine.purpose : ""),
    factRow("What kind it is", medicine ? medicine.form : ""),
    factRow("Doses are counted in", unit ? pluralUnit(unit, 2) : ""),
    factRow("Anything else", medicine ? medicine.notes : ""),
  ].join("");
  return `<div class="top">${back}<span class="title-sm">Medicine</span><span class="spacer"></span></div>
    <div><h1 class="big">${medicineName(name, strength)}</h1></div>
    <div class="gallery"><div class="shot">${image}</div>
      <div class="picks" role="tablist" aria-label="Photos">${shots.map((p, i) =>
        `<button type="button" role="tab" data-photo="${i}" aria-selected="${i === index}">${esc(p.label)}</button>`).join("")}</div></div>
    <div class="card"><span class="dash">Who takes this</span>
      ${takerNames.length
        ? `<p>${nameList(takerNames)}</p>`
        : `<p class="sub">${takenBefore
            ? "Nobody takes this now. It was taken before, and it stays in the list so the older records still read right."
            : "Nobody is taking this at the moment."}</p>`}</div>
    ${facts ? `<div class="card"><span class="dash">Details</span><dl class="kv">${facts}</dl></div>` : ""}
    <div class="formbtns">
      <button type="button" class="primary light" data-edit-medicine="${esc(medicineId)}">Edit details</button>
      ${canDelete
        ? `<button type="button" class="primary light danger" data-delete-medicine="${esc(medicineId)}">Delete this medicine</button>`
        : `<p class="note">This one can't be deleted: it's named by a medicine someone takes, or used to take, and deleting it would leave a hole in the record.</p>`}
    </div>
    ${medicineId ? photoSlots(shots, medicineId) : ""}`;
}

// ---- doctors ----

export function renderDoctorLibrary({ model, query }) {
  const rows = (model && model.rows) || [];
  const shown = rows.filter(r => matches(r.doctor ? r.doctor.name : "", query));
  const list = shown.map(r => {
    const doctor = r.doctor || {};
    const where = (r.hospitalNames || []).length ? `Sees patients at ${(r.hospitalNames || []).join(", ")}` : "";
    return libraryRow(
      "data-open-doctor", doctor.doctor_id || "",
      `${doctorThumb(doctor, r.photoUrl)}
        <div><div class="name">${esc(doctor.name || "Unknown doctor")}</div>
          ${doctor.specialty ? `<span class="spec">${esc(doctor.specialty)}</span>` : ""}
          ${where ? `<div class="s">${esc(where)}</div>` : ""}</div>`
    );
  }).join("");
  return `${topBar("The family's lists")}
    <div><h1 class="big">Doctors</h1><p class="sub">${esc(countLine(rows.length, "doctor", "doctors", "the family sees"))}</p></div>
    <button type="button" class="primary light" data-add-doctor>Add a doctor to the list</button>
    ${searchBox(query, "Dr Somchai…")}
    <div class="doses">${list || emptyList(rows.length, query, "Add a doctor to the list")}</div>
    ${KEEP_NOTE}`;
}

// ---- hospitals and clinics ----

export function renderHospitalLibrary({ model, query }) {
  const rows = (model && model.rows) || [];
  const shown = rows.filter(r => matches(r.hospital ? r.hospital.name : "", query));
  const list = shown.map(r => {
    const hospital = r.hospital || {};
    const doctors = (r.doctorNames || []).length ? `Doctors here: ${(r.doctorNames || []).join(", ")}` : "";
    return libraryRow(
      "data-open-hospital", hospital.hospital_id || "",
      `<span class="thumb" aria-hidden="true">${I.team}</span>
        <div><div class="name">${esc(hospital.name || "Unknown hospital")}</div>
          <div class="s">${esc(hospital.phone || "No phone number saved yet")}</div>
          ${doctors ? `<div class="s">${esc(doctors)}</div>` : ""}</div>`
    );
  }).join("");
  return `${topBar("The family's lists")}
    <div><h1 class="big">Hospitals &amp; clinics</h1><p class="sub">${esc(countLine(rows.length, "place", "places", "the family goes to"))}</p></div>
    <button type="button" class="primary light" data-add-hospital>Add a hospital or clinic</button>
    ${searchBox(query, "Riverside Hospital…")}
    <div class="doses">${list || emptyList(rows.length, query, "Add a hospital or clinic")}</div>
    ${KEEP_NOTE}`;
}
