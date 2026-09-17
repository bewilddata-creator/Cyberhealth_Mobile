import { esc } from "../html.js";
import { I, starPath } from "../icons.js";

export function renderConnect({ error, busy }) {
  return `<div class="login">
    <svg class="deco-star" viewBox="0 0 100 100" aria-hidden="true"><path d="${starPath(8, 50, 34)}"/></svg>
    <div class="logo">${I.logo}CyberHealth</div>
    <h1>Connect this phone</h1>
    <p class="sub">Open the private link the family sent you, or paste the app address here. You only do this once on each phone.</p>
    <form class="login-form" data-form="connect">
      <div class="field">
        <label for="apiUrl">App address</label>
        <input id="apiUrl" name="apiUrl" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" required>
      </div>
      <p class="err" role="alert">${esc(error)}</p>
      <button class="primary" ${busy ? "disabled" : ""}>${busy ? "Connecting…" : "Connect"}</button>
    </form>
  </div>`;
}
