import { esc } from "../html.js";
import { ownerSwitch, personName, callLink, doctorThumb } from "./common.js";

function doctorRow(d) {
  const doctor = d.doctor;
  const specialty = doctor && doctor.specialty ? `<span class="spec">${esc(doctor.specialty)}</span>` : "";
  const reason = d.careTeam.reason ? `<small>${esc(d.careTeam.reason)}</small>` : "";
  const others = d.otherHospitals.length ? `<small>Also sees at: ${esc(d.otherHospitals.join(", "))}</small>` : "";
  return `<div class="idcard">
    <div class="band"><span>${esc(d.hospital ? d.hospital.name : "Hospital not set")}</span>${d.hn ? `<b class="num">HN ${esc(d.hn)}</b>` : ""}</div>
    <div class="body">
      <div class="docline">${doctorThumb(doctor, d.photoUrl)}
        <div><strong>${esc(doctor ? doctor.name : "Unknown doctor")}</strong>${specialty}${reason}${others}</div>
        ${callLink(doctor ? doctor.phone : "", doctor ? doctor.name : "")}</div>
    </div></div>`;
}

export function renderDoctors({ rows, ctx }) {
  const owner = ctx.people.find(p => p.user_id === ctx.owner);
  // A viewer can have Medicines access to someone (so the owner switcher offers them) without
  // Care team access -- an empty list here used to always say "No doctors added", which reads as
  // "this person has none" when the real reason is "you can't see them" (M1).
  const noAccess = owner && !owner.care_team;
  const empty = noAccess
    ? `<p class="note">${esc(owner.display_name)} hasn't shared their care team with you.</p>`
    : `<p class="note">No doctors added for this person yet.</p>`;
  return `<div class="top"><div><span class="title-sm">${esc(personName(ctx, ctx.owner))}'s care team</span><h1 class="big">Doctors &amp; HN</h1></div>${ownerSwitch(ctx)}</div>
    ${rows.length ? rows.map(doctorRow).join("") : empty}`;
}
