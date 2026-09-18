import { esc } from "../html.js";
import { I } from "../icons.js";

const COMING_SOON = ["Hospital numbers", "Care team", "Sharing", "Change password", "Adding family members"];

// The three lists the whole family shares. They are not per-person, which is why they live here
// and not on somebody's Medicines tab. Each line says what is inside, because "Medicines" on its
// own reads like the tab at the bottom of the screen.
const LIBRARIES = [
  ["medicines", "Medicines", "Every medicine the family keeps, with its photos"],
  ["doctors", "Doctors", "Their names, phone numbers and where they see patients"],
  ["hospitals", "Hospitals & clinics", "Phone numbers, addresses and how to get there"],
];

export function renderMore({ me, warnings }) {
  return `<div><span class="title-sm">Settings</span><h1 class="big">More</h1></div>
    <div class="card"><div class="contact"><div><strong>Logged in as</strong></div><span class="sub">${esc(me.display_name)}</span></div></div>
    <button class="primary light" data-refresh>Refresh from the Sheet</button>
    ${warnings.length ? `<div class="card warn"><span class="dash">Sheet problems (${warnings.length})</span><ul class="plain">${warnings.map(w => `<li>${esc(w.message)}</li>`).join("")}</ul></div>` : ""}
    <div class="card"><span class="dash">The family's lists</span>${LIBRARIES.map(([key, title, blurb]) =>
      `<button type="button" class="listbtn" data-library="${esc(key)}"><div><strong>${esc(title)}</strong><small>${esc(blurb)}</small></div><span class="go">${I.arrow}</span></button>`).join("")}</div>
    <div class="card later"><span class="dash">Coming soon</span>${COMING_SOON.map(name => `<div class="contact"><div><strong>${esc(name)}</strong></div><span class="dash">Soon</span></div>`).join("")}</div>
    <button class="primary" data-logout>Log out</button>`;
}
