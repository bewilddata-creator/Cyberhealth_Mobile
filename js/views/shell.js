import { I } from "../icons.js";

export function renderShell({ body, tab }) {
  const item = (key, label) => key === "sos"
    ? `<button class="sos" data-tab="sos" aria-label="Emergency card" ${tab === "sos" ? 'aria-current="page"' : ""}>${I.sos}</button>`
    : `<button data-tab="${key}" ${tab === key ? 'aria-current="page"' : ""}>${I[key]}<span>${label}</span></button>`;
  return `<main class="scroll">${body}</main>
    <nav class="nav" aria-label="Main">${item("today", "Today")}${item("meds", "Meds")}${item("sos")}${item("team", "Doctors")}${item("more", "More")}</nav>`;
}

export function renderLoading(text = "Loading…") {
  return `<div class="loading" role="status"><span class="spinner"></span>${text}</div>`;
}
