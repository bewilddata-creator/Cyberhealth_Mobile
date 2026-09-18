import { esc, telHref } from "../html.js";
import { I } from "../icons.js";
import { medicineNameParts } from "../schedule.js";
import { driveImageUrl } from "../viewmodel.js";

// Which group a name in "Who prescribed it?" belongs to. The list is built in js/app.js and drawn
// in js/views/forms.js, and both ends have to agree -- a bare string that drifted at one end would
// not throw, it would quietly drop a doctor out of both headings, which is the exact kind of
// silent wrong that this picker cannot afford.
//   CARE    -- on this person's own care team; the common case, listed first
//   LIBRARY -- everyone else in the family's shared doctor list
//   GONE    -- named on the prescription, but no longer in the Doctors list at all; in neither
//              group, and drawn on its own so the id the prescription holds still has an <option>
//              to come back as (without it a save silently erases who prescribed the medicine)
export const DOCTOR_GROUP = { CARE: "care", LIBRARY: "library", GONE: "gone" };

export const SLOT_COLORS ={ Morning: ["var(--yellow)", "var(--yellow-2)"], Noon: ["var(--olive)", "var(--olive-2)"], Evening: ["var(--pink)", "var(--pink-2)"], Bedtime: ["var(--blue)", "var(--blue-2)"] };
export const AVATAR_COLORS = ["var(--yellow)", "var(--pink)", "var(--blue)", "var(--olive)"];

export function avatarColor(people, userId) {
  const i = people.findIndex(p => p.user_id === userId);
  return AVATAR_COLORS[(i < 0 ? 0 : i) % AVATAR_COLORS.length];
}
export function personName(ctx, userId) {
  const p = ctx.people.find(x => x.user_id === userId);
  return p ? p.display_name : "";
}
export function thumb(med) {
  const url = med ? driveImageUrl(med.photo_pill_front) || driveImageUrl(med.photo_box) || driveImageUrl(med.photo_packet_front) : "";
  return url
    ? `<span class="thumb"><img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`
    : `<span class="thumb" aria-hidden="true">${I.meds}</span>`;
}
function doctorInitials(name) {
  const cleaned = String(name || "").replace(/^dr\.?\s*/i, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(w => w[0].toUpperCase()).join("");
}
// A doctor's photo, or their initials when there is none (a family sample Sheet has no photos,
// so this is what most doctors show in practice).
export function doctorThumb(doctor, url) {
  const src = url || (doctor ? driveImageUrl(doctor.photo) : "");
  if (src) return `<span class="thumb"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`;
  const initials = doctor ? doctorInitials(doctor.name) : "";
  return `<span class="thumb" aria-hidden="true">${initials ? esc(initials) : I.team}</span>`;
}
// The name on every list, in the detail header and in the forms: the brand first, because that
// is the word printed on the box he is holding, with the generic in brackets after it. HTML, not
// plain text -- the strength rides along in its own <em> so it reads lighter than the name.
export function medName(med) {
  const { name, strength } = medicineNameParts(med);
  if (!name) return "Unknown medicine";
  return strength ? `${esc(name)} <em>${esc(strength)}</em>` : esc(name);
}
// Only a person whose Medicines this viewer can at least read is worth switching to -- a family
// member with no grant on anyone but themself sees no switcher at all (options.length < 2).
export function ownerSwitch(ctx) {
  const options = ctx.people.filter(p => p.medicines);
  if (options.length < 2) return "";
  return `<select class="pill-select" data-owner aria-label="Whose records to show">${options.map(p =>
    `<option value="${esc(p.user_id)}" ${p.user_id === ctx.owner ? "selected" : ""}>${p.user_id === ctx.me.user_id ? "Me" : esc(p.display_name)}</option>`).join("")}</select>`;
}
// Removing something from one of the family's shared lists. It lives at the foot of the screen
// that opens the thing -- never on a scrolling list, where a thumb already moving past a row
// would find it -- under a rule and a heading of its own, so it is never taken for Save.
//
// Three states, because "we don't know" is not the same as "no":
//   canDelete === true   the server would allow it, so offer the button;
//   canDelete === false  it would refuse, so say what is holding the row instead of offering a
//                        button that always fails;
//   anything else        nobody has worked it out (a caller that forgot to pass it) -- say
//                        nothing at all rather than assert a reason that may not be true.
export function deleteBlock({ canDelete, attr, id, label, why }) {
  if (!id || canDelete == null) return "";
  return `<div class="dangerzone"><span class="dash">Removing this</span>
    ${canDelete
      ? `<button type="button" class="primary light danger" ${attr}="${esc(id)}">${esc(label)}</button>`
      : `<p class="sub">${esc(why)}</p>`}</div>`;
}

export function callLink(phone, name) {
  const href = telHref(phone);
  return href ? `<a class="callbtn" href="${esc(href)}" aria-label="Call ${esc(name)}">${I.phone}</a>` : "";
}
