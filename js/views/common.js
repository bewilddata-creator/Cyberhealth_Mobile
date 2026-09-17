import { esc, telHref } from "../html.js";
import { I } from "../icons.js";
import { driveImageUrl } from "../viewmodel.js";

export const SLOT_COLORS = { Morning: ["var(--yellow)", "var(--yellow-2)"], Noon: ["var(--olive)", "var(--olive-2)"], Evening: ["var(--pink)", "var(--pink-2)"], Bedtime: ["var(--blue)", "var(--blue-2)"] };
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
export function medName(med) {
  return med ? `${esc(med.generic_name)} <em>${esc(med.strength)}</em>` : "Unknown medicine";
}
// Only a person whose Medicines this viewer can at least read is worth switching to -- a family
// member with no grant on anyone but themself sees no switcher at all (options.length < 2).
export function ownerSwitch(ctx) {
  const options = ctx.people.filter(p => p.medicines);
  if (options.length < 2) return "";
  return `<select class="pill-select" data-owner aria-label="Whose records to show">${options.map(p =>
    `<option value="${esc(p.user_id)}" ${p.user_id === ctx.owner ? "selected" : ""}>${p.user_id === ctx.me.user_id ? "Me" : esc(p.display_name)}</option>`).join("")}</select>`;
}
export function callLink(phone, name) {
  const href = telHref(phone);
  return href ? `<a class="callbtn" href="${esc(href)}" aria-label="Call ${esc(name)}">${I.phone}</a>` : "";
}
