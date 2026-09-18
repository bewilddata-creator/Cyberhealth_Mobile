import { esc } from "../html.js";
import { I } from "../icons.js";
import { describeFrequency, describeDoses } from "../schedule.js";
import { fmtLong } from "../format.js";
import { medName, callLink, doctorThumb } from "./common.js";

function historyRow(h) {
  const who = [h.changedByName, h.doctorName].filter(Boolean).join(" · ");
  const hasChange = h.before || h.after;
  return `<li><span class="dot"></span><div>
      <div class="when">${fmtLong(String(h.changedAt).slice(0, 10))}${who ? ` · ${esc(who)}` : ""}</div>
      <div class="what">${esc(h.changeType)}</div>
      ${h.reason ? `<div class="why">${esc(h.reason)}</div>` : ""}
      ${hasChange ? `<div class="why">${esc(h.before || "—")} → ${esc(h.after || "—")}</div>` : ""}
    </div></li>`;
}

// What an editor can do to this prescription. Every label says what happens, not what table it
// touches. Delete only shows when nothing has ever been ticked against it (model.canDelete): once
// a dose is recorded, the honest option is Stop, which keeps the record of what was taken.
function editButtons(model) {
  const id = model.prescription.id;
  const medicineId = model.medicine ? model.medicine.medicine_id : "";
  const stopped = model.prescription.status === "Stopped";
  return `<div class="formbtns">
    <button type="button" class="primary light" data-change-dose="${esc(id)}">Change how much to take</button>
    <button type="button" class="primary light" data-change-schedule="${esc(id)}">Change when to take it</button>
    ${stopped
      ? `<button type="button" class="primary light" data-restart="${esc(id)}">Start taking this again</button>`
      : `<button type="button" class="primary light" data-stop="${esc(id)}">Stop taking this</button>`}
    ${medicineId ? `<button type="button" class="primary light" data-edit-medicine="${esc(medicineId)}">Edit details</button>` : ""}
    ${model.canDelete ? `<button type="button" class="primary light danger" data-delete="${esc(id)}">Delete — this was added by mistake</button>` : ""}
  </div>`;
}

// One row per photo slot, so a photo can be added or replaced without hunting for the right
// picture first. The slot name is the one the server's photo actions take (box, pill_front, …).
function photoSlots(photos, medicineId) {
  const rows = photos.map(p => `<div class="photorow">
      <span class="pic">${p.url ? `<img src="${esc(p.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : I.meds}</span>
      <div><strong>${esc(p.label)}</strong>
        <div class="btnrow">
          <button type="button" data-upload-photo="${esc(medicineId)}|${esc(p.slot)}">${p.url ? "Replace" : "Add photo"}</button>
          ${p.url ? `<button type="button" class="danger" data-remove-photo="${esc(medicineId)}|${esc(p.slot)}">Remove</button>` : ""}
        </div></div></div>`).join("");
  return `<div class="card"><span class="dash">Photos of this medicine</span>${rows}
    <p class="sub">A photo of the box and of the pill itself makes this medicine easy to recognise.</p></div>`;
}

export function renderDetail({ model, photo, canEdit }) {
  const back = `<button class="circle-btn" data-back aria-label="Back to medicines">${I.back}</button>`;
  if (!model) return `<div class="top">${back}<span class="title-sm">Medicine</span><span class="spacer"></span></div><p class="note">This medicine isn't available. Tap Refresh on the More tab.</p>`;
  const { prescription, medicine, doses, photos, doctor, hospital, hn, history } = model;
  const shot = photos[photo] || photos[0];
  const image = shot.url
    ? `<img src="${esc(shot.url)}" alt="${esc(shot.label)} of ${esc(medicine ? medicine.generic_name : "")}" referrerpolicy="no-referrer">`
    : `<span class="nophoto">${I.meds}<small>No ${esc(shot.label.toLowerCase())} photo</small></span>`;
  const meal = prescription.meal && prescription.meal !== "Any time" ? `, ${prescription.meal.toLowerCase()}` : "";
  const how = doses.length
    ? `<div class="big">${esc(describeFrequency(prescription))}${esc(meal)}</div><p class="sub">${esc(describeDoses(doses))}</p>`
    : `<div class="big">When needed</div>${prescription.meal && prescription.meal !== "Any time" ? `<p class="sub">${esc(prescription.meal)}</p>` : ""}`;
  const doctorCard = doctor
    ? `<div class="idcard"><div class="band"><span>${esc(hospital ? hospital.name : "Hospital not set")}</span>${hn ? `<b class="num">HN ${esc(hn)}</b>` : ""}</div>
        <div class="body"><div class="docline">${doctorThumb(doctor)}
          <div><small class="sub">Prescribed by</small><strong>${esc(doctor.name)}</strong>${doctor.specialty ? `<span class="spec">${esc(doctor.specialty)}</span>` : ""}</div>
          ${callLink(doctor.phone, doctor.name)}</div></div></div>`
    : "";
  return `<div class="top">${back}<span class="title-sm">Medicine</span><span class="spacer"></span></div>
    <div><h1 class="big">${medName(medicine)}</h1>
      ${medicine && medicine.purpose ? `<p class="sub">${esc(medicine.purpose)}</p>` : ""}
      ${medicine && medicine.notes ? `<p class="sub">${esc(medicine.notes)}</p>` : ""}</div>
    <div class="gallery"><div class="shot">${image}</div>
      <div class="picks" role="tablist" aria-label="Photos">${photos.map((p, i) => `<button type="button" role="tab" data-photo="${i}" aria-selected="${i === photo}">${esc(p.label)}</button>`).join("")}</div></div>
    <div class="howcard"><span class="dash dark">How to take</span>${how}</div>
    ${canEdit ? editButtons(model) : ""}
    ${doctorCard}
    ${canEdit && medicine ? photoSlots(photos, medicine.medicine_id) : ""}
    <div class="card"><div class="sec-head"><span class="dash">History</span><span class="count">${history.length} ${history.length === 1 ? "entry" : "entries"}</span></div>
      ${history.length ? `<ul class="timeline">${history.map(historyRow).join("")}</ul>` : `<p class="none">No history yet.</p>`}</div>`;
}
