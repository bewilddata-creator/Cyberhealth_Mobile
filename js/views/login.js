import { esc } from "../html.js";
import { I, starPath } from "../icons.js";
import { AVATAR_COLORS } from "./common.js";

export function renderLogin({ users, pick, reset, error, busy }) {
  const chosen = users.find(u => u.user_id === pick);
  const people = users.length
    ? users.map((u, i) => `<button type="button" class="person" data-pick="${esc(u.user_id)}" aria-pressed="${u.user_id === pick}"><span class="av" style="background:${AVATAR_COLORS[i % AVATAR_COLORS.length]}">${esc(u.display_name.slice(0, 1))}</span>${esc(u.display_name)}</button>`).join("")
    : `<p class="sub">Loading names…</p>`;
  const fields = reset
    ? `<div class="field"><label for="code">6-digit code from the family admin</label><input id="code" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></div>
       <div class="field"><label for="newPassword">New password (at least 6 characters)</label><input id="newPassword" name="newPassword" type="password" minlength="6" autocomplete="new-password" required></div>`
    : `<div class="field"><label for="password">Password${chosen ? ` for ${esc(chosen.display_name)}` : ""}</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>`;
  return `<div class="login">
    <svg class="deco-star" viewBox="0 0 100 100" aria-hidden="true"><path d="${starPath(8, 50, 34)}"/></svg>
    <div class="logo">${I.logo}CyberHealth</div>
    <h1>${reset ? "Set a new password" : "Who's using the app?"}</h1>
    <div class="people">${people}</div>
    <form class="login-form" data-form="${reset ? "setPassword" : "login"}">
      ${fields}
      <p class="err" role="alert">${esc(error)}</p>
      <button class="primary" ${busy || !chosen ? "disabled" : ""}>${busy ? "Please wait…" : reset ? "Save password and log in" : "Log in"}</button>
    </form>
    <button type="button" class="link" data-reset>${reset ? "Back to log in" : "Set or forgot password"}</button>
    <button type="button" class="sosbtn" data-public>${I.sos}Emergency card · no login</button>
  </div>`;
}
