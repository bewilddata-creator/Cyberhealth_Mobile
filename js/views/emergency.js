import { esc } from "../html.js";
import { I, starPath } from "../icons.js";
import { fmtLong } from "../format.js";
import { callLink } from "./common.js";

export const CARD_FIELDS = [
  ["full_name", "Full name", "text"],
  ["date_of_birth", "Date of birth, like 1953-04-12", "text"],
  ["blood_type", "Blood type, like B+", "text"],
  ["allergies", "Allergies, separated by ; like: Penicillin (rash); Shellfish (hives)", "textarea"],
  ["conditions", "Conditions, separated by ;", "textarea"],
  ["contact1_name", "Contact 1 name", "text"],
  ["contact1_relation", "Contact 1 relation", "text"],
  ["contact1_phone", "Contact 1 phone", "tel"],
  ["contact2_name", "Contact 2 name", "text"],
  ["contact2_relation", "Contact 2 relation", "text"],
  ["contact2_phone", "Contact 2 phone", "tel"],
  ["notes", "Notes for doctors or nurses", "textarea"],
];

const publicBar = () => `<div class="public-bar"><button class="circle-btn" data-tab="login" aria-label="Back to log in">${I.back}</button><div><strong>Emergency card</strong><small>Opened without logging in</small></div></div>`;

export function renderEmergency({ cards, model, ctx, publicMode }) {
  const loading = `<div class="loading" role="status"><span class="spinner"></span>Loading emergency cards…</div>`;
  if (!cards) return (publicMode ? publicBar() : "") + loading;
  if (!model) return (publicMode ? publicBar() : "") + `<p class="note">No emergency cards yet.</p>`;
  const top = publicMode
    ? publicBar()
    : `<div class="top"><span class="dash pink">Emergency info</span>${model.user_id === ctx.me.user_id ? `<button class="tickall" data-edit-sos>Edit my card</button>` : ""}</div>`;
  const chips = cards.length > 1
    ? `<div class="chips" role="group" aria-label="Choose person">${cards.map(c => `<button type="button" data-sosfor="${esc(c.user_id)}" aria-pressed="${c.user_id === model.user_id}">${esc(c.display_name)}</button>`).join("")}</div>`
    : "";
  const contacts = [1, 2]
    .map(n => ({ name: model[`contact${n}_name`], rel: model[`contact${n}_relation`], phone: model[`contact${n}_phone`] }))
    .filter(c => c.name || c.phone);
  const hnBand = !publicMode && model.hospital_numbers && model.hospital_numbers.length
    ? `<div class="card"><span class="dash">Hospitals</span><dl class="kv">${model.hospital_numbers.map(h => `<dt>${esc(h.hospital_name)}</dt><dd class="num">HN ${esc(h.hn)}</dd>`).join("")}</dl></div>`
    : "";
  return `${top}${chips}
    <div class="sos-hero"><div class="blood"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="${starPath(12, 50, 40)}"/></svg><div><small>Blood</small><b>${esc(model.blood_type || "?")}</b></div></div>
      <div class="who"><strong>${esc(model.full_name || model.display_name)}</strong><small>${model.age != null ? `Age ${model.age} · born ${fmtLong(model.date_of_birth)}` : "Birth date not added"}</small></div></div>
    <div class="sec-head"><span class="dash">Allergies</span>${model.allergies.length ? `<span class="count miss">${model.allergies.length} ${model.allergies.length === 1 ? "alert" : "alerts"}</span>` : `<span class="count done">None known</span>`}</div>
    ${model.allergies.length ? `<div class="allergy-grid">${model.allergies.map(a => `<div class="allergy"><div class="h"><i aria-hidden="true">!</i>${esc(a.what)}</div>${a.reaction ? `<div class="sub">${esc(a.reaction)}</div>` : ""}<div class="attn">ATTENTION!</div></div>`).join("")}</div>` : ""}
    <div class="card"><span class="dash">Conditions</span>${model.conditions.length ? `<ul class="plain">${model.conditions.map(c => `<li>${esc(c)}</li>`).join("")}</ul>` : `<p class="sub">None listed</p>`}</div>
    <div class="card"><span class="dash">Call family</span><div>${contacts.map(c => `<div class="contact"><div><strong>${esc(c.name)}</strong><small class="num">${esc([c.rel, c.phone].filter(Boolean).join(" · "))}</small></div>${callLink(c.phone, c.name)}</div>`).join("") || `<p class="sub">No contacts listed</p>`}</div></div>
    ${hnBand}
    <div class="card"><span class="dash">Current medicines</span>${model.current_medicines.length ? `<ul class="plain">${model.current_medicines.map(m => `<li>${esc(m)}</li>`).join("")}</ul>` : `<p class="sub">None</p>`}</div>
    ${model.notes ? `<div class="card"><span class="dash">Notes</span><p>${esc(model.notes)}</p></div>` : ""}`;
}

export function renderEmergencyEdit({ card, error, busy }) {
  const fields = CARD_FIELDS.map(([name, label, type]) => `<div class="field"><label for="f-${name}">${esc(label)}</label>${type === "textarea"
    ? `<textarea id="f-${name}" name="${name}" rows="3">${esc(card[name])}</textarea>`
    : `<input id="f-${name}" name="${name}" type="${type}" value="${esc(card[name])}">`}</div>`).join("");
  return `<div class="top"><button class="circle-btn" data-tab="sos" aria-label="Cancel editing">${I.back}</button><span class="title-sm">Edit my emergency card</span><span class="spacer"></span></div>
    <form class="edit-form" data-form="saveEmergency">${fields}<p class="err" role="alert">${esc(error)}</p><button class="primary" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Save card"}</button></form>`;
}
