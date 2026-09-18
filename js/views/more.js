import { esc } from "../html.js";

const COMING_SOON = ["Hospitals & doctors", "Hospital numbers", "Care team", "Sharing", "Change password", "Adding family members"];

export function renderMore({ me, warnings }) {
  return `<div><span class="title-sm">Settings</span><h1 class="big">More</h1></div>
    <div class="card"><div class="contact"><div><strong>Logged in as</strong></div><span class="sub">${esc(me.display_name)}</span></div></div>
    <button class="primary light" data-refresh>Refresh from the Sheet</button>
    ${warnings.length ? `<div class="card warn"><span class="dash">Sheet problems (${warnings.length})</span><ul class="plain">${warnings.map(w => `<li>${esc(w.message)}</li>`).join("")}</ul></div>` : ""}
    <div class="card later"><span class="dash">Coming soon</span>${COMING_SOON.map(name => `<div class="contact"><div><strong>${esc(name)}</strong></div><span class="dash">Soon</span></div>`).join("")}</div>
    <button class="primary" data-logout>Log out</button>`;
}
