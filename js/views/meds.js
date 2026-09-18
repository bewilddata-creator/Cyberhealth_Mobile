import { esc } from "../html.js";
import { I } from "../icons.js";
import { fmtLong } from "../format.js";
import { thumb, ownerSwitch, medName, personName } from "./common.js";

function row(prescriptionId, medicine, sub, stopped) {
  return `<button class="medrow ${stopped ? "stopped" : ""}" data-open="${esc(prescriptionId)}">${thumb(medicine)}
    <div><div class="name">${medName(medicine)}</div><div class="s">${esc(sub)}</div></div>
    <span class="go">${I.arrow}</span></button>`;
}

export function renderMeds({ model, ctx, canEdit }) {
  const active = model.active.map(x => row(x.prescription.id, x.medicine, x.summary, false)).join("");
  const stopped = model.stopped.map(x => row(x.prescription.id, x.medicine, x.stoppedOn ? `Stopped ${fmtLong(x.stoppedOn)}` : "Stopped", true)).join("");
  // Only for someone the owner shared editing with; everybody else sees the same read-only list
  // as before, with nothing to tap by mistake.
  const add = canEdit ? `<button type="button" class="primary light" data-add-prescription>Add a medicine to this list</button>` : "";
  return `<div class="top"><div><span class="title-sm">${esc(personName(ctx, ctx.owner))}'s medicines</span><h1 class="big">${model.active.length} current</h1></div>${ownerSwitch(ctx)}</div>
    ${add}
    <div class="doses">${active || `<p class="none">No current medicines.</p>`}</div>
    ${stopped ? `<div class="sec-head"><span class="dash">Stopped</span></div><div class="doses">${stopped}</div>` : ""}
    <p class="note">Tap a medicine to see how to take it and its history.</p>`;
}
