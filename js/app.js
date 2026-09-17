import { call, getToken, setToken, getApiUrl, setApiUrl } from "./api.js";
import { bangkokToday, bangkokTimeOfDay, bangkokHour, bangkokStamp, addDays, rolloverDate } from "./schedule.js";
import { indexBoot, todayModel, weekModel, warningsForOwner, defaultOwnerId } from "./viewmodel.js";
import { esc } from "./html.js";
import { fmtFullDay } from "./format.js";
import { renderShell, renderLoading } from "./views/shell.js";
import { renderLogin } from "./views/login.js";
import { renderConnect } from "./views/connect.js";
import { renderToday } from "./views/today.js";

const root = document.getElementById("app");
const REFRESH_AFTER_MS = 5 * 60 * 1000;

export const S = {
  screen: "loading", boot: null, idx: null, owner: null, date: null,
  users: [], pick: null, reset: false, error: "", busy: false, toast: "", loadedAt: 0,
  detail: null, photo: 0, sosFor: null, pub: false, cards: null, editError: "", editBusy: false,
};
let toastTimer = null;
let rolloverPending = false;

export const now = () => Date.now();
export const ctx = () => ({ me: S.boot.me, people: S.boot.people, owner: S.owner });

// Screen registry: name -> () => ({ body, tab }). Task 8 registers the other screens.
export const SCREENS = {
  today: () => {
    const t = bangkokToday(now()), nowTimeOfDay = bangkokTimeOfDay(now());
    // Midnight rollover (I3): if the phone is still showing the day it loaded data for, but the
    // real Bangkok day has since moved on, follow it forward and reload -- a day left open
    // overnight must not go on quietly showing yesterday.
    const rolled = S.boot && rolloverDate({ viewedDate: S.date, loadedToday: S.boot.today, actualToday: t });
    if (rolled) {
      S.date = rolled;
      if (!rolloverPending) {
        rolloverPending = true;
        setTimeout(() => { rolloverPending = false; loadBoot(); }, 0);
      }
    }
    const model = todayModel(S.idx, { ownerId: S.owner, viewerId: S.boot.me.user_id, date: S.date, today: t, nowTimeOfDay });
    const warnings = warningsForOwner(S.boot.warnings, S.owner);
    return { tab: "today", body: renderToday({ model, week: weekModel(S.idx, S.owner, S.date, t, nowTimeOfDay), ctx: ctx(), today: t, hour: bangkokHour(now()), warnings }) };
  },
};

function view() {
  if (S.screen === "loading") return renderLoading();
  if (S.screen === "connect") return renderConnect({ error: S.error, busy: S.busy });
  if (S.screen === "login") return renderLogin({ users: S.users, pick: S.pick, reset: S.reset, error: S.error, busy: S.busy });
  // Public mode has its own no-login screen with no bottom navigation, reached from the login
  // screen's "Emergency card" button -- it never wraps its body in renderShell.
  if (S.pub) return `<main class="scroll public">${SCREENS.sos ? SCREENS.sos().body : ""}</main>`;
  if (!S.boot) return renderLoading();
  const { body, tab } = (SCREENS[S.screen] || SCREENS.today)();
  return renderShell({ body, tab });
}

export function render() {
  const key = `${S.screen}:${S.pub}:${S.reset}`;
  const same = root.dataset.view === key;
  const scroller = root.querySelector(".scroll, .login");
  const y = same && scroller ? scroller.scrollTop : 0;
  const values = {};
  if (same) root.querySelectorAll("input[id], textarea[id]").forEach(el => { values[el.id] = el.value; });
  // A live-filtering field would re-render on every keystroke; without this it would lose focus
  // -- and so the phone's keyboard -- after each character.
  const active = same && document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : "";
  root.dataset.view = key;
  root.innerHTML = view() + (S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : "");
  Object.entries(values).forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.value = v; });
  if (active) {
    const el = document.getElementById(active);
    if (el) { el.focus({ preventScroll: true }); if (el.setSelectionRange && el.value) { try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) { /* not a text-selectable input */ } } }
  }
  const next = root.querySelector(".scroll, .login");
  if (next) next.scrollTop = y;
}

export function toast(message) {
  S.toast = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = ""; render(); }, 4000);
}

export function go(screen) {
  S.screen = screen;
  render();
}

async function showLogin(message = "") {
  if (!getApiUrl()) return showConnect();
  // A toast from whatever was happening before (a refresh, a save, an error) must never survive
  // onto the login screen -- it isn't about whoever logs in next.
  clearTimeout(toastTimer);
  Object.assign(S, { screen: "login", pub: false, cards: null, toast: "", error: message, busy: false });
  render();
  try {
    S.users = await call("listUsers");
    if (!S.users.some(u => u.user_id === S.pick)) S.pick = S.users[0] ? S.users[0].user_id : null;
  } catch (e) {
    S.error = e.message;
  }
  render();
}

export async function loadBoot() {
  if (S.boot) toast("Refreshing…");
  try {
    const boot = await call("bootstrap");
    const wasToday = S.boot && S.date === S.boot.today;
    S.boot = boot;
    S.idx = indexBoot(boot);
    S.loadedAt = now();
    // The owner switcher only ever offers people whose Medicines this viewer can read; if the
    // previously-viewed owner lost that grant (or none was chosen yet), fall back to viewing
    // the phone's own owner.
    const canView = id => boot.people.some(p => p.user_id === id && p.medicines);
    if (!canView(S.owner)) S.owner = defaultOwnerId(boot.people, boot.me.user_id);
    if (!S.date || wasToday) S.date = boot.today;
    // Every active user's emergency card is visible to any logged-in family member (only the HN
    // band is gated), so the switcher just needs to still be a known person.
    if (!boot.people.some(p => p.user_id === S.sosFor)) S.sosFor = boot.me.user_id;
    if (S.screen === "loading" || S.screen === "login") S.screen = "today";
    if (boot.warnings.length) console.warn("Sheet problems:", boot.warnings);
    if (S.toast === "Refreshing…") S.toast = "";
    render();
  } catch (e) {
    if (e.code === "AUTH_REQUIRED" || (e.code === "CONFIG" && !S.boot)) {
      S.boot = null;
      return showLogin(e.code === "CONFIG" ? e.message : "Please log in again.");
    }
    if (!S.boot) return showLogin(e.message);
    toast(e.message);
  }
}

async function authWith(action, payload) {
  S.busy = true; S.error = ""; render();
  try {
    const { token } = await call(action, payload);
    setToken(token);
    Object.assign(S, { reset: false, busy: false, screen: "loading" });
    render();
    await loadBoot();
  } catch (e) {
    S.busy = false; S.error = e.message; render();
  }
}

const pickedName = () => (S.users.find(u => u.user_id === S.pick) || {}).display_name || "";

async function logout() {
  try { await call("logout"); } catch (e) { /* the session may already be gone */ }
  setToken(null);
  clearTimeout(toastTimer);
  Object.assign(S, { boot: null, idx: null, owner: null, date: null, sosFor: null, pub: false, cards: null, toast: "" });
  showLogin();
}

async function openPublic() {
  // The public card is reached straight from the login screen (never mid-session), so any
  // leftover toast from a previous logged-in session must not show through onto it.
  clearTimeout(toastTimer);
  Object.assign(S, { pub: true, screen: "sos", cards: null, sosFor: null, toast: "" });
  render();
  try {
    S.cards = await call("publicEmergency");
    S.sosFor = S.cards[0] ? S.cards[0].user_id : null;
    render();
  } catch (e) {
    toast(e.message);
  }
}

async function saveEmergencyCard(fields) {
  S.editBusy = true; S.editError = ""; render();
  try {
    const card = await call("saveEmergencyCard", { fields });
    S.boot.emergency = S.boot.emergency.map(c => (c.user_id === card.user_id ? card : c));
    Object.assign(S, { editBusy: false, screen: "sos" });
    toast("Emergency card saved.");
  } catch (e) {
    S.editBusy = false; S.editError = e.message; render();
  }
}

function currentDoseFor(prescriptionId, timeOfDay) {
  const doses = S.idx.dosesByPrescription.get(prescriptionId) || [];
  return doses.find(d => d.timeOfDay === timeOfDay) || null;
}
function prescriptionName(prescriptionId) {
  const p = S.idx.prescriptions.get(prescriptionId);
  const m = p && S.idx.medicines.get(p.medicineId);
  return m ? m.generic_name : "this medicine";
}

async function tick(key) {
  const [date, timeOfDay, prescriptionId] = key.split("|");
  const existing = S.idx.ticks.get(key);
  if (existing) {
    if (!confirm(`Untick ${prescriptionName(prescriptionId)}?`)) return;
    S.idx.ticks.delete(key);
    render();
    try { await call("untick", { prescriptionId, date, timeOfDay }); }
    catch (e) { S.idx.ticks.set(key, existing); toast(e.message); }
    return;
  }
  // Ticking a day other than today is easy to do by accident while browsing the week strip --
  // ask first (I3).
  if (date !== bangkokToday(now())) {
    if (!confirm(`Tick for ${fmtFullDay(date)}? That isn't today.`)) return;
  }
  const dose = currentDoseFor(prescriptionId, timeOfDay);
  S.idx.ticks.set(key, {
    prescription_id: prescriptionId, date, time_of_day: timeOfDay,
    amount_taken: dose ? String(dose.amount) : "", unit: dose ? dose.unit : "",
    status: "Taken", taken_at: bangkokStamp(now()), taken_by: S.boot.me.user_id,
  });
  render();
  try {
    // The phone always sends the doseId and amount it showed (I1) so the server can catch a
    // Sheet edit made since this phone last loaded, instead of logging an amount nobody saw.
    const row = await call("tick", { prescriptionId, date, timeOfDay, doseId: dose ? dose.id : "", amount: dose ? dose.amount : 0 });
    S.idx.ticks.set(key, row);
    render();
  } catch (e) {
    S.idx.ticks.delete(key);
    toast(e.message);
    // NOT_DUE or CONFLICT both mean the phone's own picture of this prescription/dose is stale
    // (someone changed, stopped, or retimed it since this load) -- reload so Today stops offering
    // a tick that will only fail the same way again.
    if (e.code === "NOT_DUE" || e.code === "CONFLICT") await loadBoot();
    else render();
  }
}

async function tickAll(timeOfDay) {
  const t = bangkokToday(now()), nowTimeOfDay = bangkokTimeOfDay(now());
  const model = todayModel(S.idx, { ownerId: S.owner, viewerId: S.boot.me.user_id, date: S.date, today: t, nowTimeOfDay });
  const date = S.date;
  if (date !== t) {
    if (!confirm(`Tick for ${fmtFullDay(date)}? That isn't today.`)) return;
  }
  const items = model.slots.find(s => s.timeOfDay === timeOfDay).items.filter(i => !i.tick);
  const keys = items.map(i => i.key);
  // Send exactly the prescription, dose id and amount this phone showed as due and un-ticked --
  // the server only ticks those (and only if the Sheet still agrees), so a prescription that
  // became due, or whose dose changed, between this render and the tap never gets ticked without
  // ever being shown (I1).
  const items_ = items.map(i => ({ prescriptionId: i.prescription.id, doseId: i.dose.id, amount: i.dose.amount }));
  items.forEach(i => S.idx.ticks.set(i.key, {
    prescription_id: i.prescription.id, date, time_of_day: timeOfDay,
    amount_taken: String(i.dose.amount), unit: i.dose.unit,
    status: "Taken", taken_at: bangkokStamp(now()), taken_by: S.boot.me.user_id,
  }));
  render();
  try {
    const { ticked, skipped } = await call("tickAll", { date, timeOfDay, items: items_ });
    skipped.forEach(id => S.idx.ticks.delete(`${date}|${timeOfDay}|${id}`));
    ticked.forEach(row => S.idx.ticks.set(`${row.date}|${row.time_of_day}|${row.prescription_id}`, row));
    toast(`Ticked ${ticked.length} ${ticked.length === 1 ? "dose" : "doses"}.`);
    // A skip means the phone's picture of this section was stale -- reload so it stops offering
    // a tick-all that will only skip the same ids again.
    if (skipped.length) await loadBoot();
    else render();
  } catch (e) {
    keys.forEach(k => S.idx.ticks.delete(k));
    toast(e.message);
  }
}

root.addEventListener("click", e => {
  const el = e.target.closest("[data-tab],[data-date],[data-shift],[data-pick],[data-reset],[data-tick],[data-tickall],[data-logout],[data-refresh],[data-open],[data-back],[data-photo],[data-public],[data-sosfor],[data-edit-sos]");
  if (!el || !root.contains(el)) return;
  const d = el.dataset;
  if (d.tab) return d.tab === "login" ? showLogin() : go(d.tab);
  if (d.date) { S.date = d.date; return render(); }
  if (d.shift) { S.date = addDays(S.date, Number(d.shift)); return render(); }
  if (d.pick) { Object.assign(S, { pick: d.pick, error: "" }); return render(); }
  if ("reset" in d) { Object.assign(S, { reset: !S.reset, error: "" }); return render(); }
  if (d.tick) return tick(d.tick);
  if (d.tickall) return tickAll(d.tickall);
  if ("logout" in d) return logout();
  if ("refresh" in d) return loadBoot();
  if (d.open) { Object.assign(S, { detail: d.open, photo: 0 }); return go("detail"); }
  if ("back" in d) return go("meds");
  if (d.photo) { S.photo = Number(d.photo); return render(); }
  if ("public" in d) return openPublic();
  if (d.sosfor) { S.sosFor = d.sosfor; return render(); }
  if ("editSos" in d) { S.editError = ""; return go("emergencyEdit"); }
});

root.addEventListener("change", e => {
  const el = e.target;
  if (el.matches("[data-owner]")) { S.owner = el.value; return render(); }
});

root.addEventListener("submit", e => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  if (form.dataset.form === "connect") return connect(f.apiUrl);
  if (form.dataset.form === "login") return authWith("login", { name: pickedName(), password: f.password });
  if (form.dataset.form === "setPassword") return authWith("setPassword", { name: pickedName(), code: f.code, newPassword: f.newPassword });
  if (form.dataset.form === "saveEmergency") return saveEmergencyCard(f);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !S.boot) return;
  if (now() - S.loadedAt > REFRESH_AFTER_MS) loadBoot();
  else render();
});
setInterval(() => { if (S.screen === "today" && S.boot && document.visibilityState === "visible") render(); }, 60000);

function showConnect(message = "") {
  Object.assign(S, { screen: "connect", error: message, busy: false });
  render();
}

function connect(url) {
  if (!setApiUrl(url)) {
    S.error = "That doesn't look like an Apps Script address. It should end in /exec.";
    return render();
  }
  S.error = "";
  showLogin();
}

export async function start() {
  if (!getApiUrl()) return showConnect();
  if (getToken()) {
    await loadBoot();
    if (S.boot) return;
  }
  if (S.screen !== "login") showLogin();
}
