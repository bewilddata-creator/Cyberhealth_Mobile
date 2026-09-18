import { call, getToken, setToken, getApiUrl, setApiUrl } from "./api.js";
import { bangkokToday, bangkokTimeOfDay, bangkokHour, bangkokStamp, addDays, rolloverDate, TIMES_OF_DAY, FREQ, pluralUnit, medicineNameParts } from "./schedule.js";
import { indexBoot, todayModel, weekModel, warningsForOwner, defaultOwnerId, detailModel, doctorsModel } from "./viewmodel.js";
import { pickImage, shrinkToDataUrl } from "./photoinput.js";
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
  // The four editing forms (Task 9). `form` is the in-progress model the renderers read, so a
  // re-render never loses what was picked; `formStash` holds the half-filled prescription while
  // the family steps aside to add a medicine that wasn't in the list; `formFrom` is the screen
  // the back arrow returns to; `formDirty` is whether anything has been typed since it opened.
  form: null, formError: "", formBusy: false, formStash: null, formFrom: "meds", formDirty: false,
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

// Answers with "" when the phone's picture is now the Sheet's, or with the reason it isn't. A
// caller that has just written something needs to know: a save followed by a failed reload leaves
// a confident screen showing pre-save data, which must be said out loud rather than papered over
// with a success toast (see announce()).
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
    return "";
  } catch (e) {
    if (e.code === "AUTH_REQUIRED" || (e.code === "CONFIG" && !S.boot)) {
      S.boot = null;
      await showLogin(e.code === "CONFIG" ? e.message : "Please log in again.");
      return e.message;
    }
    if (!S.boot) {
      await showLogin(e.message);
      return e.message;
    }
    toast(e.message);
    return e.message;
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
// The medicine's name as plain text, for a confirm(), a toast or a form heading. Brand-led, the
// same as the lists show, so a question about "Norvasc" is a question about the box in his hand.
function prescriptionName(prescriptionId) {
  const p = S.idx.prescriptions.get(prescriptionId);
  const m = p && S.idx.medicines.get(p.medicineId);
  const name = m ? medicineNameParts(m).name : "";
  return name || "this medicine";
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

// ---- The four editing forms ----
//
// Nothing here patches S.idx after a save: every successful write is followed by loadBoot(), so
// the screen shows what the Sheet now says rather than what this phone hoped it would say.

const MEDICINE_FIELD_NAMES = ["generic_name", "brand_name", "strength", "form", "purpose", "notes"];

function ownerName() {
  const p = S.idx && S.idx.people.get(S.owner);
  return p ? p.display_name : "";
}
function medicineNameOf(medicineId) {
  const m = S.idx && S.idx.medicines.get(medicineId);
  const name = m ? medicineNameParts(m).name : "";
  return name || "this medicine";
}
// The medicine library, in the order the picker actually reads. Sorted by the name SHOWN -- which
// since this release leads with the brand -- not by generic_name, or the list would run Norvasc,
// Glucophage, Cozaar and look unsorted to the one person using it. Finding the box by its own name
// is the whole point; making her scan an unordered list for it gives half of that back.
//
// Locale-aware, because these names can be Thai: a raw < compares UTF-16 code units and puts every
// Thai name in code-point order rather than dictionary order. numeric:true is for the strength, so
// 5 mg sorts before 10 mg instead of after it.
function medicineLabelOrder(a, b) {
  const A = medicineNameParts(a);
  const B = medicineNameParts(b);
  const byName = A.name.localeCompare(B.name, undefined, { sensitivity: "base", numeric: true });
  return byName !== 0 ? byName : A.strength.localeCompare(B.strength, undefined, { sensitivity: "base", numeric: true });
}
function medicineOptions() {
  return [...S.idx.medicines.values()].sort(medicineLabelOrder);
}
// The owner's care team, plus whichever doctor this prescription already names even if they have
// since left it. A doctor missing from the list would come back from the <select> as "" and
// silently erase who prescribed it -- the change would save, and look fine, with the doctor gone.
// Deduped by doctor_id: doctorsModel returns one row per care-team row, so a doctor the owner sees
// at two hospitals would otherwise be listed twice in "Who prescribed it?" -- the same value both
// times, so nothing saves wrong, but it reads as a broken screen.
function doctorOptions(doctorId) {
  const list = [];
  doctorsModel(S.idx, S.owner).forEach(r => {
    const d = r.doctor;
    if (d && !list.some(x => x.doctor_id === d.doctor_id)) list.push(d);
  });
  if (doctorId && !list.some(d => d.doctor_id === doctorId)) {
    const d = S.idx.doctors.get(doctorId);
    // A doctor_id whose Doctors row has actually been deleted matches no <option> at all, so the
    // browser falls back to "Not recorded", harvestForm reads "", and the save writes that --
    // silently erasing who prescribed the medicine. Same silent loss as a doctor who merely left
    // the care team, with a narrower trigger, so it is closed the same way: an option carrying the
    // id the prescription actually holds, so saving keeps it instead of wiping it.
    list.push(d || { doctor_id: doctorId, name: "Not in the doctor list any more" });
  }
  return list;
}
function photoLabel(slot) {
  const model = S.detail ? detailModel(S.idx, S.owner, S.detail) : null;
  const p = model && model.photos.find(x => x.slot === slot);
  return p ? p.label.toLowerCase() : "";
}

// The model js/main.js hands the renderers. The lists (medicines, care-team doctors, the owner's
// name) are rebuilt from the current S.idx on every render instead of being frozen into S.form,
// so a medicine added mid-flow is in the picker the moment bootstrap comes back.
export function formModel() {
  const m = S.form || {};
  if (S.screen === "prescriptionForm") return { ...m, ownerName: ownerName(), medicines: medicineOptions(), doctors: doctorOptions(m.doctorId) };
  if (S.screen === "scheduleForm") return { ...m, doctors: doctorOptions(m.doctorId) };
  // What a dose of this medicine is counted in comes from the medicine's form, and is looked up
  // here rather than frozen into S.form, so editing the medicine mid-flow is reflected at once.
  if (S.screen === "doseForm") return { ...m, medicineForm: medicineFormOf(m.prescriptionId) };
  return m;
}

// The "Tablet"/"Liquid"/… of the medicine behind a prescription, which is what decides the unit.
function medicineFormOf(prescriptionId) {
  const p = prescriptionId && S.idx ? S.idx.prescriptions.get(prescriptionId) : null;
  const m = p && S.idx.medicines.get(p.medicineId);
  return m ? m.form : "";
}

// A row whose amount box is blank means "nothing at this time of day" and is left out of the
// list entirely (amendment H). Sending it as 0 would be rejected by the server with "The Morning
// amount must be more than 0."; sending it as 0 to a server that accepted it would be worse.
function dosesFromFields(f) {
  return TIMES_OF_DAY
    .map(t => ({ timeOfDay: t, amount: String(f[`amount${t}`] == null ? "" : f[`amount${t}`]).trim(), unit: String(f[`unit${t}`] == null ? "" : f[`unit${t}`]).trim() }))
    .filter(d => d.amount !== "")
    .map(d => ({ timeOfDay: d.timeOfDay, amount: Number(d.amount), unit: d.unit }));
}

// Reads the live form back into the model that draws it. render() carries the text and number
// boxes across a re-render by id, but nothing carries a <select> or a checkbox: without this,
// choosing the medicine and then changing the schedule would quietly un-choose the medicine, and
// the weekday ticks would vanish. Every change event harvests, so any later render -- a
// background refresh included -- redraws what the family actually picked.
function harvestForm(form, base) {
  const m = base || S.form || {};
  if (!form) return { ...m };
  const fd = new FormData(form);
  const f = Object.fromEntries(fd);
  const has = name => Object.prototype.hasOwnProperty.call(f, name);
  const keep = (name, fallback) => (has(name) ? f[name] : fallback);
  if (form.dataset.form === "medicine") {
    const med = { ...(m.medicine || {}) };
    MEDICINE_FIELD_NAMES.forEach(k => { if (has(k)) med[k] = f[k]; });
    return { ...m, medicine: med };
  }
  return {
    ...m,
    medicineId: keep("medicineId", m.medicineId),
    prescriptionId: keep("prescriptionId", m.prescriptionId),
    frequency: keep("frequency", m.frequency),
    everyNDays: keep("everyNDays", m.everyNDays),
    countFrom: keep("countFrom", m.countFrom),
    // The seven weekday boxes all share name="weekdays", which is correct HTML and which
    // Object.fromEntries reads as only the LAST one ticked: a Mon/Wed/Fri prescription would
    // save as Friday alone, and he would miss two doses a week with nothing on screen to say
    // why. getAll is the only safe read (amendment G). When the boxes are not on the page at
    // all (the frequency is not Weekdays) the days already picked are kept, so switching the
    // schedule away and back does not empty them.
    weekdays: form.querySelector('input[name="weekdays"]') ? fd.getAll("weekdays").map(String) : (m.weekdays || []),
    mealTiming: keep("mealTiming", m.mealTiming),
    doctorId: keep("doctorId", m.doctorId),
    notes: keep("notes", m.notes),
    reason: keep("reason", m.reason),
    doses: has("amountMorning") ? dosesFromFields(f) : (m.doses || []),
  };
}

// A toast about the last thing saved must not sit under a form that is now asking for something
// else -- "The new dose is saved." beside a live error line reads as if the error had been saved.
function openForm(screen, from, model) {
  clearTimeout(toastTimer);
  Object.assign(S, { form: model, formError: "", formBusy: false, formDirty: false, formStash: null, formFrom: from, screen, toast: "" });
  render();
}
// Whatever the last reload after a write said (F2). Set only by the handlers that write, and
// cleared by announce() as soon as it has been said, so it can never leak onto a later message.
let staleAfterSave = "";

// The only place a "that worked" message is said. When the write worked but the reload that
// follows it did not, the family is told both: the change IS saved (so it must not read as a
// failure), and the screen is now stale (so it must not read as fine). A bare success toast over
// pre-save data is a screen lying confidently, which is the one thing this release exists to stop.
function announce(message) {
  const err = staleAfterSave;
  staleAfterSave = "";
  // The reload that follows a write can end the session, in which case loadBoot has already put
  // the login screen up and cleared the toasts on purpose (whoever logs in next is not who this
  // message was for). There is no app screen left to say anything on.
  if (!S.boot) return;
  toast(err ? `${message} The screen couldn't refresh, so it may be out of date — tap Refresh on the More tab. (${err})` : message);
}

// The form is over: nothing is left half-filled behind a screen that no longer shows it.
function dropForm() {
  Object.assign(S, { form: null, formStash: null, formError: "", formBusy: false, formDirty: false });
}

function leaveForm(screen, message) {
  dropForm();
  go(screen);
  if (message) announce(message);
}

// After a write, whether there is still a logged-in app to go back to. A reload that fails with
// AUTH_REQUIRED nulls S.boot and shows the login screen; carrying on from there would set
// S.screen back to an app screen, and view() renders a bare spinner when S.boot is null -- so the
// phone would sit on a spinner that never resolves, with no way out but force-quitting a Home
// Screen app. The write itself already landed, so there is nothing more to do but let the login
// screen the reload chose be the one he sees.
function sessionEnded() {
  if (S.boot) return false;
  staleAfterSave = "";
  dropForm();
  return true;
}

function openPrescriptionForm() {
  openForm("prescriptionForm", "meds", {
    medicineId: "", frequency: FREQ.DAILY, weekdays: [], everyNDays: "", countFrom: "",
    mealTiming: "Any time", doctorId: "", notes: "", doses: [],
  });
}
function openDoseForm(prescriptionId) {
  S.detail = prescriptionId;
  openForm("doseForm", "detail", {
    prescriptionId,
    medicineName: prescriptionName(prescriptionId),
    doses: (S.idx.dosesByPrescription.get(prescriptionId) || []).map(d => ({ timeOfDay: d.timeOfDay, amount: d.amount, unit: d.unit })),
    reason: "",
  });
}
function openScheduleForm(prescriptionId) {
  const p = S.idx.prescriptions.get(prescriptionId);
  if (!p) return toast("That medicine isn't on the list any more. Tap Refresh on the More tab.");
  S.detail = prescriptionId;
  openForm("scheduleForm", "detail", {
    prescriptionId,
    medicineName: prescriptionName(prescriptionId),
    frequency: p.freq, weekdays: p.days.slice(), everyNDays: p.n ? String(p.n) : "",
    countFrom: p.countFrom, mealTiming: p.meal, doctorId: p.doctorId, reason: "",
  });
}
function openMedicineForm(medicineId) {
  const med = S.idx.medicines.get(medicineId);
  if (!med) return toast("That medicine isn't in the list any more. Tap Refresh on the More tab.");
  openForm("medicineForm", "detail", { medicine: { ...med } });
}
// "It's not in the list -- add it", from inside the half-filled prescription form. The partly
// filled prescription is stashed first and comes back with the new medicine already chosen: the
// family asked for exactly this, and re-typing a whole prescription is how a wrong one gets typed.
function openNewMedicine(form) {
  const stash = harvestForm(form);
  openForm("medicineForm", "prescriptionForm", { medicine: {} });
  S.formStash = stash;
}

// The shape every save shares (the same one saveEmergencyCard uses): the button goes dead, the
// action runs, the whole picture is reloaded from the Sheet, and only then does the screen move
// on. A failure leaves everything typed exactly where it was, with the server's own words above
// the button -- never a cleared form.
async function runSave(form, send, finish) {
  const model = harvestForm(form);
  S.form = model;
  S.formBusy = true; S.formError = ""; staleAfterSave = ""; render();
  try {
    const result = await send(model);
    staleAfterSave = await loadBoot();
    S.formBusy = false;
    if (sessionEnded()) return;
    finish(result, model);
  } catch (e) {
    S.formBusy = false; S.formError = e.message; render();
  }
}

function saveMedicine(form) {
  const editing = !!(S.form && S.form.medicine && S.form.medicine.medicine_id);
  return runSave(form, m => {
    const fields = {};
    MEDICINE_FIELD_NAMES.forEach(k => { fields[k] = String((m.medicine || {})[k] || ""); });
    return editing
      ? call("updateMedicine", { medicineId: m.medicine.medicine_id, fields })
      : call("addMedicine", { fields });
  }, saved => {
    if (S.formFrom === "prescriptionForm" && S.formStash) {
      const back = { ...S.formStash, medicineId: saved.medicine_id };
      Object.assign(S, { form: back, formStash: null, formError: "", formBusy: false, formDirty: true, formFrom: "meds", screen: "prescriptionForm" });
      render();
      // "chosen below" is only true if the reload that would put it in the picker worked. When it
      // did not, the medicine is saved but the picker still says "Choose one…", and claiming
      // otherwise would have him looking for something the screen contradicts -- announce() adds
      // the "tap Refresh" sentence in that case.
      return announce(staleAfterSave
        ? `${saved.generic_name} is saved.`
        : `${saved.generic_name} is in the list now, and chosen below.`);
    }
    leaveForm(S.formFrom === "detail" && S.detail ? "detail" : "meds", editing ? "Saved." : `${saved.generic_name} is in the medicine list.`);
  });
}

function savePrescription(form) {
  return runSave(form, m => call("addPrescription", {
    userId: S.owner,
    medicineId: m.medicineId || "",
    frequency: m.frequency || "",
    everyNDays: m.everyNDays || "",
    countFrom: m.countFrom || "",
    weekdays: m.weekdays || [],
    mealTiming: m.mealTiming || "",
    doctorId: m.doctorId || "",
    notes: m.notes || "",
    doses: m.doses || [],
  }), (saved, m) => {
    const who = ownerName();
    leaveForm("meds", `${medicineNameOf(m.medicineId)} is on ${who ? `${who}'s` : "the"} list now.`);
  });
}

// Which times of day today already have a tick for this prescription that the new dose list
// would take off Today: a time that is filled now and blank in what is about to be saved. A time
// with no current dose row is left out -- that tick is already shown on Today as a receipt, so
// saving changes nothing about it.
function ticksClearedBy(prescriptionId, doses) {
  const today = bangkokToday(now());
  const keeping = new Set((doses || []).map(d => d.timeOfDay));
  const current = S.idx.dosesByPrescription.get(prescriptionId) || [];
  return TIMES_OF_DAY
    .filter(t => !keeping.has(t) && current.some(d => d.timeOfDay === t))
    .map(t => S.idx.ticks.get(`${today}|${t}|${prescriptionId}`))
    .filter(Boolean);
}

// Moving or clearing a time of day he has ALREADY ticked today is a real thing to want to do --
// the doctor changed the dose this morning -- but the daughter should hear about it before it is
// written, not discover it afterwards. So this names the medicine and what he already took, and
// says what does and does not change. It is information, not a veto: saying yes still saves.
function confirmClearedTicks(model) {
  const cleared = ticksClearedBy(model.prescriptionId, model.doses);
  if (!cleared.length) return true;
  const name = prescriptionName(model.prescriptionId);
  const who = ownerName() || "He";
  const what = cleared.map(r => `${r.time_of_day} ${r.amount_taken} ${r.unit}`).join(", ");
  return confirm(`${who} has already ticked ${name} today: ${what}. Saving this takes that time of day off today's list. What was taken stays in the record and still shows on Today, so nothing is lost. Save the new dose?`);
}

// No doctorId key: the dose form has no doctor <select>, and changePrescriptionDose only touches
// doctor_id when the key is actually sent -- sending "" would erase who prescribed it.
function saveDose(form) {
  // Harvested here as well as inside runSave so the question can name what is actually about to
  // be sent. harvestForm only reads the form, so doing it twice changes nothing.
  const model = harvestForm(form);
  S.form = model;
  if (!confirmClearedTicks(model)) return;
  return runSave(form, m => call("changePrescriptionDose", {
    prescriptionId: m.prescriptionId || "",
    doses: m.doses || [],
    reason: m.reason || "",
  }), () => leaveForm("detail", "The new dose is saved."));
}

// No medicineId and no doses: changePrescriptionSchedule ignores both (amendment L), which is
// why the form does not show them either.
function saveSchedule(form) {
  return runSave(form, m => call("changePrescriptionSchedule", {
    prescriptionId: m.prescriptionId || "",
    frequency: m.frequency || "",
    everyNDays: m.everyNDays || "",
    countFrom: m.countFrom || "",
    weekdays: m.weekdays || [],
    mealTiming: m.mealTiming || "",
    doctorId: m.doctorId || "",
    reason: m.reason || "",
  }), () => leaveForm("detail", "The new schedule is saved."));
}

// Stop, restart and delete have no form to go busy, so this both guards against a second tap
// while the first is in flight and names the medicine in the toast -- a mis-tap says what it did.
let acting = false;
async function actOnPrescription(action, prescriptionId, message, after) {
  if (acting) return;
  acting = true;
  staleAfterSave = "";
  try {
    await call(action, { prescriptionId, reason: "" });
    staleAfterSave = await loadBoot();
    if (sessionEnded()) return;
    if (after) after();
    announce(message);
  } catch (e) {
    staleAfterSave = "";
    toast(e.message);
  } finally {
    acting = false;
  }
}

// Stop asks too, for the same reason Delete does: it sits directly above Delete in a stack of
// buttons on a phone, and a mis-tap takes a medicine off Today silently -- so he simply stops
// taking it, with nothing on screen saying anything is wrong. The toast and the row moving to the
// Stopped section are not enough: a toast fades, and that section may never be scrolled to. So the
// question names the medicine and says exactly what will and will not happen. Restart deliberately
// does NOT ask: it only puts a medicine back, and stopping again undoes it.
function stopPrescription(prescriptionId) {
  const name = prescriptionName(prescriptionId);
  const ask = `Stop taking ${name}? It won't show on Today any more. Everything already ticked for it is kept, and you can start it again later.`;
  if (!confirm(ask)) return;
  return actOnPrescription("stopPrescription", prescriptionId, `Stopped taking ${name}. It's in the Stopped list.`);
}

// The one thing in this release that cannot be undone, so the question names the medicine and
// says why nothing is lost by removing it: Delete is only offered while no dose has ever been
// ticked against it (detailModel's canDelete), and the server refuses again if one has.
function deletePrescription(prescriptionId) {
  const name = prescriptionName(prescriptionId);
  const who = ownerName();
  const ask = `Remove ${name} from ${who ? `${who}'s` : "this"} list? Nothing has been ticked for it yet, so nothing is lost. This can't be undone.`;
  if (!confirm(ask)) return;
  return actOnPrescription("deletePrescription", prescriptionId, `${name} is off the list.`, () => {
    S.detail = null;
    go("meds");
  });
}

// "<medicine id>|<slot>", split on the LAST bar: the five slot names contain none, but a
// hand-typed medicine_id in the Sheet can (amendment J).
export function splitPhotoTarget(value) {
  const s = String(value == null ? "" : value);
  const at = s.lastIndexOf("|");
  return at === -1 ? { medicineId: s, slot: "" } : { medicineId: s.slice(0, at), slot: s.slice(at + 1) };
}

// Its own flag, NOT S.formBusy: that one is the four forms' save button, and an upload still in
// flight when a form is opened would otherwise disable that form's button and, worse, land its own
// "Photo saved." on a screen that has nothing to do with photos. The guard comes before the photo
// picker and before the question, because a double tap is normal on a phone and two pickers (or
// the same question twice) is the app's fault, not the thumb's.
let photoBusy = false;

// A success message belongs to the screen that started the upload: shrinking and uploading takes
// seconds, and the family can be somewhere else by the time it lands. A failure is always said --
// silence after a photo that did not save would read as success.
function photoDone(startedOn, message) {
  if (sessionEnded()) return;
  if (S.screen === "detail" && S.detail === startedOn) return announce(message);
  staleAfterSave = "";
}

async function uploadPhoto(medicineId, slot) {
  if (photoBusy) return;
  photoBusy = true;
  staleAfterSave = "";
  try {
    const file = await pickImage();
    if (!file) return;
    const startedOn = S.screen === "detail" ? S.detail : null;
    // The detail screen draws no spinner, so the toast is what says something is happening.
    toast("Saving the photo…");
    const dataUrl = await shrinkToDataUrl(file);
    const { warnings } = await call("uploadMedicinePhoto", { medicineId, slot, dataUrl });
    staleAfterSave = await loadBoot();
    photoDone(startedOn, warnings && warnings.length ? warnings[0] : "Photo saved.");
  } catch (e) {
    staleAfterSave = "";
    toast(e.message);
  } finally {
    photoBusy = false;
  }
}

async function removePhoto(medicineId, slot) {
  if (photoBusy) return;
  const label = photoLabel(slot);
  if (!confirm(`Remove the ${label || "chosen"} photo of ${medicineNameOf(medicineId)}? The medicine itself stays on the list.`)) return;
  photoBusy = true;
  staleAfterSave = "";
  const startedOn = S.screen === "detail" ? S.detail : null;
  try {
    const { warnings } = await call("removeMedicinePhoto", { medicineId, slot });
    staleAfterSave = await loadBoot();
    photoDone(startedOn, warnings && warnings.length ? warnings[0] : "Photo removed.");
  } catch (e) {
    staleAfterSave = "";
    toast(e.message);
  } finally {
    photoBusy = false;
  }
}

// The back arrow on all four forms (amendment M). It is drawn as a back arrow and labelled "Go
// back without saving", so that is what it does -- but only after asking, once anything has been
// typed: it sits in the top-left corner where a thumb lands by accident, and an unasked-for
// discard of a half-filled prescription is exactly the silent loss this release exists to remove.
// An untouched form goes back with no question, because there is nothing to lose.
// Takes no form: the back arrow is drawn in the top bar, OUTSIDE the <form> (js/views/forms.js
// topBar), so there is no form element to read from it -- and nothing needs one. Whether there is
// anything to lose is S.formDirty, and what to go back to is S.formFrom.
function cancelForm() {
  if (S.formDirty && !confirm("Go back without saving? What you've typed here will be lost.")) return;
  // Backing out of the medicine form that was opened FROM the prescription form drops only the
  // medicine; the half-filled prescription behind it comes back untouched.
  if (S.formFrom === "prescriptionForm" && S.formStash) {
    Object.assign(S, { form: S.formStash, formStash: null, formError: "", formBusy: false, formDirty: true, formFrom: "meds", screen: "prescriptionForm" });
    return render();
  }
  leaveForm(S.formFrom === "detail" && S.detail ? "detail" : "meds", "");
}

root.addEventListener("click", e => {
  const el = e.target.closest("[data-tab],[data-date],[data-shift],[data-pick],[data-reset],[data-tick],[data-tickall],[data-logout],[data-refresh],[data-open],[data-back],[data-photo],[data-public],[data-sosfor],[data-edit-sos],[data-add-prescription],[data-change-dose],[data-change-schedule],[data-stop],[data-restart],[data-delete],[data-edit-medicine],[data-new-medicine],[data-upload-photo],[data-remove-photo],[data-cancel]");
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
  if ("addPrescription" in d) return openPrescriptionForm();
  if (d.changeDose) return openDoseForm(d.changeDose);
  if (d.changeSchedule) return openScheduleForm(d.changeSchedule);
  if (d.stop) return stopPrescription(d.stop);
  if (d.restart) return actOnPrescription("restartPrescription", d.restart, `Taking ${prescriptionName(d.restart)} again.`);
  if (d.delete) return deletePrescription(d.delete);
  if (d.editMedicine) return openMedicineForm(d.editMedicine);
  if ("newMedicine" in d) return openNewMedicine(el.closest("form[data-form]"));
  if (d.uploadPhoto) { const t = splitPhotoTarget(d.uploadPhoto); return uploadPhoto(t.medicineId, t.slot); }
  if (d.removePhoto) { const t = splitPhotoTarget(d.removePhoto); return removePhoto(t.medicineId, t.slot); }
  if ("cancel" in d) return cancelForm();
});

root.addEventListener("change", e => {
  const el = e.target;
  if (el.matches("[data-owner]")) { S.owner = el.value; return render(); }
  const form = el.closest("form[data-form]");
  if (!form || !S.form) return;
  // Harvest on every change, not only on the frequency: a <select> and a checkbox keep nothing
  // across a re-render, so the model has to be the record of what was picked.
  S.formDirty = true;
  S.form = harvestForm(form);
  // data-freq is the re-render hook (amendment I). The every-N-days, count-from and weekday rows
  // are only on the page for their own frequency, so without this they cannot be reached at all.
  // data-medpick is the same hook for the medicine: it decides what the doses are counted in, so
  // picking a different one has to redraw the word beside each amount box -- and put the unit box
  // back when the medicine is a cream or an "Other" with no unit of its own.
  if (el.matches("[data-freq], [data-medpick]")) render();
});

// Whether there is anything to lose if the back arrow is tapped. Never re-renders: a re-render
// per keystroke is how a phone loses its keyboard mid-word.
root.addEventListener("input", e => {
  const el = e.target;
  if (el.closest && el.closest("form[data-form]")) S.formDirty = true;
  // "1 tablet" / "2 tablets" beside the amount box, kept in step with what is being typed. The
  // one word is rewritten in place rather than the form re-rendered: a re-render per keystroke is
  // how a phone loses its keyboard mid-word, and a re-render on blur would fight him for the
  // focus as he moves from Morning to Noon.
  const unit = el.getAttribute && el.getAttribute("data-unit");
  if (!unit) return;
  const word = el.parentElement && el.parentElement.querySelector("[data-unit-word]");
  if (word) word.textContent = pluralUnit(unit, el.value);
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
  // The four editing forms are handed the form element itself, not `f`: weekdays has to be read
  // with FormData.getAll (amendment G), which Object.fromEntries has already thrown away.
  if (form.dataset.form === "medicine") return saveMedicine(form);
  if (form.dataset.form === "prescription") return savePrescription(form);
  if (form.dataset.form === "dose") return saveDose(form);
  if (form.dataset.form === "schedule") return saveSchedule(form);
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
