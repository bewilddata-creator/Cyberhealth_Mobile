// What the phone actually sends when the family taps Save.
//
// There is no DOM harness in this suite and no room for a new dependency, so this file installs
// the smallest document js/app.js will start against, and -- this is the point -- a FormData that
// behaves the way the browser's does: built from the form's fields in order, checkboxes only when
// ticked, duplicates kept. That is what makes the weekday test real: Object.fromEntries on seven
// boxes sharing name="weekdays" keeps only the last one, so a Mon/Wed/Fri prescription would save
// as Friday alone and he would miss two doses a week with nothing on screen to explain it.
//
// The requests are not stubbed away: fetch is answered by the real server/actions.js running on
// the shared test fixture, so a payload the server would reject fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/actions.js";
import { bangkokToday } from "../js/schedule.js";
import { fakeCtx, loginAs } from "./fixtures.js";

// ---- the DOM, and the browser behaviours that matter ----

const listeners = new Map();
const root = {
  dataset: {},
  innerHTML: "",
  addEventListener: (type, fn) => listeners.set(type, fn),
  querySelector: () => null,
  querySelectorAll: () => [],
  contains: () => true,
};

class FakeFormData {
  constructor(form) {
    this.pairs = (form.__fields || [])
      .filter(f => (f.type === "checkbox" ? !!f.checked : true))
      .map(f => [f.name, String(f.value == null ? "" : f.value)]);
  }
  *[Symbol.iterator]() { yield* this.pairs; }
  entries() { return this.pairs[Symbol.iterator](); }
  get(name) { const p = this.pairs.find(([k]) => k === name); return p ? p[1] : null; }
  getAll(name) { return this.pairs.filter(([k]) => k === name).map(([, v]) => v); }
}

let pickerOpened = 0;
const store = new Map();
const confirms = [];
let confirmAnswer = true;
// What the next tap on "Add photo" picks. null is a cancelled picker (the only thing this harness
// could do before, which is why uploadPhoto's whole write path -- shrinkToDataUrl, the upload,
// the reload, sessionEnded, photoDone -- had no Node test at all). Set it to a file and the fake
// <input type=file> fires `change` instead of `cancel`.
let nextPickedFile = null;

globalThis.location = { protocol: "https:", hash: "", search: "" };
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
// A 1x1 JPEG's worth of base64 -- the bytes are never decoded here, they only have to satisfy
// server/photos.js's parseDataUrl, which is the real thing on the other side of the upload.
const CANVAS_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAE=";
let canvasesMade = 0;

globalThis.document = {
  body: { appendChild: () => {} },
  activeElement: null,
  getElementById: id => (id === "app" ? root : null),
  addEventListener: () => {},
  // js/photoinput.js makes two kinds of element: the hidden <input type=file> that pickImage
  // opens, and the <canvas> shrinkToDataUrl draws the picked photo onto.
  createElement: tag => {
    if (String(tag).toLowerCase() === "canvas") {
      canvasesMade++;
      return {
        width: 0, height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toDataURL: () => CANVAS_DATA_URL,
      };
    }
    const on = {};
    pickerOpened++;
    const input = {
      style: {}, files: null,
      addEventListener: (type, fn) => { on[type] = fn; },
      click: () => {
        if (!nextPickedFile) return on.cancel && on.cancel();
        input.files = [nextPickedFile];
        nextPickedFile = null; // one tap, one photo -- the same way a real picker behaves
        if (on.change) on.change();
      },
      remove: () => {},
    };
    return input;
  },
};
// The rest of what shrinkToDataUrl touches. The Image resolves as soon as its src is set, with a
// size big enough that the scale-down branch is the one that runs.
// Added to Node's own URL rather than replacing it, so nothing that needs `new URL(...)` breaks.
globalThis.URL.createObjectURL = () => "blob:fake";
globalThis.URL.revokeObjectURL = () => {};
globalThis.Image = class {
  constructor() { this.naturalWidth = 2400; this.naturalHeight = 1800; this.onload = null; this.onerror = null; }
  set src(_v) { if (this.onload) this.onload(); }
  get src() { return "blob:fake"; }
};
globalThis.confirm = message => { confirms.push(message); return confirmAnswer; };
globalThis.FormData = FakeFormData;
// Pending timers must not hold the test process open, and the once-a-minute clock re-render on
// Today has nothing to do here.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => { const t = realSetTimeout(fn, ms); if (t && t.unref) t.unref(); return t; };
globalThis.setInterval = () => 0;

const API = "https://script.google.com/macros/s/AKfycbTESTTESTTEST/exec";
store.set("cyberhealth.api", API);

let world = null;
globalThis.fetch = async (url, opts) => {
  const req = JSON.parse(opts.body);
  world.sent.push(req);
  // A write that lands followed by a reload that does not: the one case where the phone knows
  // something the screen does not.
  if (req.action === "bootstrap" && world.breakBootstrap) {
    return { json: async () => ({ ok: false, error: { code: "NETWORK", message: "No internet connection. Check Wi-Fi or mobile data and try again." } }) };
  }
  // The session ending on the reload that follows a write: the write landed, but there is no
  // logged-in app left to go back to.
  if (req.action === "bootstrap" && world.expireSession) {
    return { json: async () => ({ ok: false, error: { code: "AUTH_REQUIRED", message: "Please log in again." } }) };
  }
  const reply = handle(req, world.ctx);
  return { json: async () => JSON.parse(JSON.stringify(reply)) };
};

// js/main.js is imported for its own sake: it registers the four form screens, so every test
// below also renders them through the real renderers on the real models.
const { S, loadBoot, render, formModel, splitPhotoTarget } = await import("../js/app.js");
await import("../js/main.js");

function newWorld() {
  const ctx = fakeCtx();
  const created = [];
  const trashed = [];
  ctx.settings = key => (key === "photo_folder_id" ? "FOLDER123" : "");
  ctx.drive = {
    put: (folderName, fileName, base64, mimeType) => {
      created.push({ folderName, fileName, mimeType });
      return { id: `FILE${created.length}`, url: `https://drive.google.com/file/d/FILE${created.length}/view` };
    },
    trash: url => { trashed.push(url); return true; },
  };
  const token = loginAs(ctx, "Dad", "dad123");
  store.set("cyberhealth.token", token);
  world = { ctx, token, sent: [], created, trashed, breakBootstrap: false, expireSession: false };
}

// A logged-in phone showing Dad's medicines, with nothing recorded from a previous test.
async function fresh() {
  newWorld();
  Object.assign(S, { boot: null, idx: null, owner: null, date: null, screen: "loading", toast: "", form: null, formStash: null, formError: "", formBusy: false, formDirty: false, detail: null });
  await loadBoot();
  world.sent.length = 0;
  confirms.length = 0;
  confirmAnswer = true;
  pickerOpened = 0;
  canvasesMade = 0;
  nextPickedFile = null;
  return world;
}

// ---- fake elements ----

function makeForm(name, fields) {
  const form = {
    tagName: "FORM",
    dataset: { form: name },
    __fields: fields,
    closest: sel => (sel.includes("form[data-form]") ? form : null),
    querySelector: sel => {
      const m = /name="([^"]+)"/.exec(sel);
      return m && form.__fields.some(f => f.name === m[1]) ? { name: m[1] } : null;
    },
  };
  return form;
}
const field = (name, value) => ({ name, value });
const box = (name, value, checked) => ({ name, value, type: "checkbox", checked });

function attrKey(attr) {
  return attr.replace(/^\[data-/, "").replace(/\]$/, "").replace(/-([a-z])/g, (m, c) => c.toUpperCase());
}
// Answers closest() the way the page would: only for a selector that actually names one of this
// element's data attributes -- so a data-* name left out of the click listener's selector list
// fails the test instead of quietly doing nothing on the phone.
function clickable(dataset, form) {
  const el = {
    dataset,
    closest: sel => {
      if (sel.includes("form[data-form]")) return form || null;
      const keys = (sel.match(/\[data-[a-z-]+\]/g) || []).map(attrKey);
      return keys.some(k => k in dataset) ? el : null;
    },
  };
  return el;
}

const clickOn = (dataset, form) => listeners.get("click")({ target: clickable(dataset, form) });
const submitOf = form => listeners.get("submit")({ target: form, preventDefault: () => {} });
// A control's own value has already changed by the time `change` fires, so the form reads the new
// one -- the same reason the handler can trust FormData here.
const changeOn = (form, name, value, attrs = []) => {
  const f = (form.__fields || []).find(x => x.name === name && x.type !== "checkbox");
  if (f) f.value = value;
  return listeners.get("change")({
    target: {
      value, name,
      matches: sel => attrs.some(a => sel.includes(a)),
      closest: sel => (sel.includes("form[data-form]") ? form : null),
    },
  });
};
const typeIn = form => listeners.get("input")({ target: { closest: sel => (sel.includes("form[data-form]") ? form : null) } });

const lastSent = action => [...world.sent].reverse().find(r => r.action === action);

const DOSE_FIELDS = (amounts = {}) => [
  field("amountMorning", amounts.Morning === undefined ? "" : amounts.Morning), field("unitMorning", amounts.unitMorning === undefined ? "tablet" : amounts.unitMorning),
  field("amountNoon", amounts.Noon === undefined ? "" : amounts.Noon), field("unitNoon", "tablet"),
  field("amountEvening", amounts.Evening === undefined ? "" : amounts.Evening), field("unitEvening", "tablet"),
  field("amountBedtime", amounts.Bedtime === undefined ? "" : amounts.Bedtime), field("unitBedtime", ""),
];
const WEEKDAY_BOXES = picked => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => box("weekdays", d, picked.includes(d)));

// ---- the payloads ----

test("a dose form with Morning and Evening filled and Noon blank sends exactly those two rows", async () => {
  await fresh();
  await clickOn({ changeDose: "RX01" });
  assert.equal(S.screen, "doseForm");
  const form = makeForm("dose", [
    field("prescriptionId", "RX01"),
    ...DOSE_FIELDS({ Morning: "1", Evening: "0.5" }),
    field("reason", "The doctor halved the evening one"),
  ]);
  await submitOf(form);
  const req = lastSent("changePrescriptionDose");
  assert.deepEqual(req.doses, [
    { timeOfDay: "Morning", amount: 1, unit: "tablet" },
    { timeOfDay: "Evening", amount: 0.5, unit: "tablet" },
  ]);
  assert.equal(req.reason, "The doctor halved the evening one");
  // A blank box is "nothing at this time of day", never 0 -- and never a Noon row at all.
  assert.equal(req.doses.length, 2);
  // No doctorId key: changePrescriptionDose only writes doctor_id when one is sent, and the dose
  // form has no doctor picker, so sending "" would erase who prescribed it.
  assert.equal("doctorId" in req, false);
  assert.equal(S.screen, "detail");
  assert.match(S.toast, /new dose is saved/);
});

test("an amount box holding only spaces counts as blank, never as a zero", async () => {
  await fresh();
  await clickOn({ changeDose: "RX01" });
  const form = makeForm("dose", [
    field("prescriptionId", "RX01"),
    field("amountMorning", "1"), field("unitMorning", "tablet"),
    // type="number" keeps a browser from ever submitting this, so the rule is only enforceable
    // here -- and the rule matters: a 0 would come back as "The Noon amount must be more than 0."
    field("amountNoon", "   "), field("unitNoon", "tablet"),
    field("amountEvening", ""), field("unitEvening", ""),
    field("amountBedtime", "\t "), field("unitBedtime", "tablet"),
    field("reason", ""),
  ]);
  await submitOf(form);
  const req = lastSent("changePrescriptionDose");
  assert.deepEqual(req.doses, [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }]);
  assert.equal(S.screen, "detail");
});

test("the four weekday boxes that share a name are read with getAll, so Mon, Wed and Fri all arrive", async () => {
  await fresh();
  await clickOn({ changeSchedule: "RX01" });
  assert.equal(S.screen, "scheduleForm");
  const form = makeForm("schedule", [
    field("prescriptionId", "RX01"),
    field("frequency", "Weekdays"),
    ...WEEKDAY_BOXES(["Mon", "Wed", "Fri"]),
    field("mealTiming", "Before meal"),
    field("doctorId", "DOC01"),
    field("reason", "Only on dialysis days"),
  ]);
  // The trap this test exists for: the obvious read keeps only the last box ticked.
  assert.equal(Object.fromEntries(new FormData(form)).weekdays, "Fri");
  await submitOf(form);
  const req = lastSent("changePrescriptionSchedule");
  assert.deepEqual(req.weekdays, ["Mon", "Wed", "Fri"]);
  const saved = world.ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01");
  assert.equal(saved.weekdays, "Mon, Wed, Fri");
  assert.equal(saved.meal_timing, "Before meal");
});

test("the schedule form sends no medicineId and no doses, because the action ignores both", async () => {
  await fresh();
  await clickOn({ changeSchedule: "RX01" });
  const form = makeForm("schedule", [
    field("prescriptionId", "RX01"), field("frequency", "Daily"),
    field("mealTiming", "With meal"), field("doctorId", "DOC01"), field("reason", ""),
  ]);
  await submitOf(form);
  const req = lastSent("changePrescriptionSchedule");
  assert.equal("medicineId" in req, false);
  assert.equal("doses" in req, false);
  // The dose rows are untouched by a schedule change.
  const doses = world.ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === "RX01");
  assert.deepEqual(doses.map(d => `${d.time_of_day} ${d.amount} ${d.unit}`), ["Morning 2 tablet"]);
});

test("adding a prescription sends it for the owner on screen, with the weekdays and the doses", async () => {
  await fresh();
  await clickOn({ addPrescription: "" });
  assert.equal(S.screen, "prescriptionForm");
  const form = makeForm("prescription", [
    field("medicineId", "MED05"),
    field("frequency", "Weekdays"),
    ...WEEKDAY_BOXES(["Mon", "Thu"]),
    field("mealTiming", "Before meal"),
    ...DOSE_FIELDS({ Morning: "1" }),
    field("doctorId", "DOC01"),
    field("notes", "Don't take with milk"),
  ]);
  await submitOf(form);
  const req = lastSent("addPrescription");
  assert.equal(req.userId, "U01");
  assert.equal(req.medicineId, "MED05");
  assert.deepEqual(req.weekdays, ["Mon", "Thu"]);
  assert.deepEqual(req.doses, [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }]);
  assert.equal(S.screen, "meds");
  assert.match(S.toast, /Vitamin C/);
});

test("the medicine form adds when it has no id and updates when it has one", async () => {
  await fresh();
  const add = makeForm("medicine", [
    field("generic_name", "Simvastatin"), field("brand_name", ""), field("strength", "20 mg"),
    field("form", "Tablet"), field("purpose", "Cholesterol"), field("notes", ""),
  ]);
  S.form = { medicine: {} };
  S.screen = "medicineForm";
  S.formFrom = "meds";
  await submitOf(add);
  assert.deepEqual(lastSent("addMedicine").fields, {
    generic_name: "Simvastatin", brand_name: "", strength: "20 mg", form: "Tablet", purpose: "Cholesterol", notes: "",
  });

  await clickOn({ editMedicine: "MED01" });
  assert.equal(S.screen, "medicineForm");
  assert.equal(formModel().medicine.generic_name, "Amlodipine");
  const edit = makeForm("medicine", [
    field("medicineId", "MED01"),
    field("generic_name", "Amlodipine besylate"), field("brand_name", "Norvasc"), field("strength", "5 mg"),
    field("form", "Tablet"), field("purpose", "Blood pressure"), field("notes", ""),
  ]);
  await submitOf(edit);
  const req = lastSent("updateMedicine");
  assert.equal(req.medicineId, "MED01");
  assert.equal(req.fields.generic_name, "Amlodipine besylate");
  assert.equal(world.ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").brand_name, "Norvasc");
});

test("a save that fails keeps every box as it was typed and shows the server's own words", async () => {
  await fresh();
  await clickOn({ changeDose: "RX01" });
  // An amount with no unit: the server refuses, and the phone must not clear the form.
  const form = makeForm("dose", [
    field("prescriptionId", "RX01"),
    field("amountMorning", "2"), field("unitMorning", ""),
    field("amountNoon", ""), field("unitNoon", ""),
    field("amountEvening", ""), field("unitEvening", ""),
    field("amountBedtime", ""), field("unitBedtime", ""),
    field("reason", "typed but not saved"),
  ]);
  await submitOf(form);
  assert.equal(S.screen, "doseForm");
  assert.equal(S.formBusy, false);
  assert.match(S.formError, /needs a unit/);
  assert.deepEqual(S.form.doses, [{ timeOfDay: "Morning", amount: 2, unit: "" }]);
  assert.equal(S.form.reason, "typed but not saved");
  // And the error is on the screen the family is looking at.
  render();
  assert.match(root.innerHTML, /needs a unit/);
});

test("every save reloads the whole picture from the Sheet instead of patching what is on screen", async () => {
  await fresh();
  await clickOn({ changeDose: "RX01" });
  await submitOf(makeForm("dose", [field("prescriptionId", "RX01"), ...DOSE_FIELDS({ Morning: "3" })]));
  assert.deepEqual(world.sent.map(r => r.action), ["changePrescriptionDose", "bootstrap"]);
  assert.equal(S.idx.dosesByPrescription.get("RX01")[0].amount, 3);
});

test("a save that works, followed by a reload that fails, says both things", async () => {
  await fresh();
  await clickOn({ changeDose: "RX01" });
  world.breakBootstrap = true;
  await submitOf(makeForm("dose", [field("prescriptionId", "RX01"), ...DOSE_FIELDS({ Morning: "3" })]));
  // The write really happened, so the message must not read as a failure...
  assert.equal(world.ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === "RX01")[0].amount, "3");
  assert.match(S.toast, /The new dose is saved\./);
  // ...and the screen is now stale, so it must not read as fine either. Both, in one message,
  // with the reason the reload failed and what to do about it.
  assert.match(S.toast, /couldn't refresh/);
  assert.match(S.toast, /Refresh on the More tab/);
  assert.match(S.toast, /No internet connection/);
  assert.equal(S.formError, "");
  assert.equal(S.screen, "detail");
  // The stale note belongs to that one save and must not leak onto the next message.
  world.breakBootstrap = false;
  await clickOn({ changeDose: "RX01" });
  await submitOf(makeForm("dose", [field("prescriptionId", "RX01"), ...DOSE_FIELDS({ Morning: "4" })]));
  assert.equal(S.toast, "The new dose is saved.");
});

// If the reload after a write ends the session, loadBoot puts the login screen up and clears the
// toasts. Anything the handler does afterwards -- go("detail"), leaveForm("meds"), a success toast
// -- puts an app screen name back on S.screen with no boot behind it, and view() then draws a bare
// spinner: a phone stuck on a spinner that only force-quitting clears, for a save that worked.
function assertOnLoginScreen() {
  assert.equal(S.screen, "login", "should be on the login screen, not an app screen with no data");
  assert.equal(S.boot, null);
  assert.equal(S.toast, "", "the login screen must not carry a toast meant for the last session");
  assert.equal(S.form, null);
  assert.equal(S.formBusy, false);
  // What the user would actually be looking at.
  render();
  assert.match(root.innerHTML, /data-pick/, "the login screen should be on the page");
  assert.doesNotMatch(root.innerHTML, /class="loading"/, "must not be a spinner with no way out");
}

test("a form save whose reload ends the session leaves the user on the login screen, not a spinner", async () => {
  await fresh();
  await clickOn({ changeDose: "RX01" });
  world.expireSession = true;
  await submitOf(makeForm("dose", [field("prescriptionId", "RX01"), ...DOSE_FIELDS({ Morning: "3" })]));
  // The write itself landed...
  assert.equal(world.ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === "RX01")[0].amount, "3");
  // ...and the screen is the one the reload chose.
  assertOnLoginScreen();
});

test("a stop, a restart and a delete whose reload ends the session do the same", async () => {
  for (const dataset of [{ stop: "RX01" }, { restart: "RX06" }, { delete: "RX01" }]) {
    await fresh();
    world.expireSession = true;
    S.detail = "RX01";
    await clickOn(dataset);
    assertOnLoginScreen();
    // S.detail is left exactly as it was, because the handler stops before its after() step.
    // Harmless: detailModel re-checks the id against the next bootstrap and renders "This
    // medicine isn't available" rather than anything worse.
    assert.equal(S.detail, "RX01");
  }
});

test("a photo action whose reload ends the session does the same", async () => {
  await fresh();
  S.detail = "RX01";
  world.expireSession = true;
  await clickOn({ removePhoto: "MED01|pill_front" });
  assert.equal(world.ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").photo_pill_front, "");
  assertOnLoginScreen();
});

test("a mid-flow medicine whose reload fails does not claim it is chosen below", async () => {
  await fresh();
  await clickOn({ addPrescription: "" });
  const half = makeForm("prescription", [
    field("medicineId", ""), field("frequency", "Daily"), field("mealTiming", "Any time"),
    ...DOSE_FIELDS({ Morning: "1" }), field("doctorId", ""), field("notes", ""),
  ]);
  await clickOn({ newMedicine: "" }, half);
  world.breakBootstrap = true;
  await submitOf(makeForm("medicine", [
    field("generic_name", "Furosemide"), field("brand_name", ""), field("strength", "40 mg"),
    field("form", "Tablet"), field("purpose", "Fluid"), field("notes", ""),
  ]));
  assert.ok(world.ctx.db.rows("Medicines").some(m => m.generic_name === "Furosemide"));
  assert.equal(S.screen, "prescriptionForm");
  assert.match(S.toast, /Furosemide is saved\./);
  assert.match(S.toast, /couldn't refresh/);
  // The picker cannot be showing it, because the reload that would have put it there failed.
  assert.doesNotMatch(S.toast, /chosen below/);
  render();
  const picker = root.innerHTML.match(/<select id="f-medicine"[\s\S]*?<\/select>/)[0];
  assert.doesNotMatch(picker, /Furosemide/);
  assert.match(picker, /Choose one…/);
});

test("a stop whose reload fails says the medicine stopped and that the screen is stale", async () => {
  await fresh();
  world.breakBootstrap = true;
  await clickOn({ stop: "RX01" });
  assert.equal(world.ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01").status, "Stopped");
  assert.match(S.toast, /Stopped taking Amlodipine/);
  assert.match(S.toast, /couldn't refresh/);
});

// ---- the buttons that act straight away ----

test("stop asks first, naming the medicine and what it does, and saying no changes nothing", async () => {
  await fresh();
  confirmAnswer = false;
  await clickOn({ stop: "RX01" });
  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /Amlodipine/);
  assert.match(confirms[0], /won't show on Today/);
  assert.match(confirms[0], /already ticked for it is kept/);
  assert.match(confirms[0], /start it again later/);
  assert.equal(world.sent.length, 0);
  assert.equal(world.ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01").status, "Active");

  // Restart is the one that does not ask: it only puts a medicine back, and Stop undoes it.
  confirmAnswer = true;
  await clickOn({ stop: "RX01" });
  confirms.length = 0;
  await clickOn({ restart: "RX01" });
  assert.deepEqual(confirms, []);
  assert.equal(world.ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01").status, "Active");
});

test("stopping and restarting say which medicine they did it to", async () => {
  await fresh();
  await clickOn({ stop: "RX01" });
  assert.equal(lastSent("stopPrescription").prescriptionId, "RX01");
  assert.equal(S.toast, "Stopped taking Amlodipine. It's in the Stopped list.");
  assert.equal(world.ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01").status, "Stopped");
  await clickOn({ restart: "RX01" });
  assert.equal(S.toast, "Taking Amlodipine again.");
  assert.equal(world.ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01").status, "Active");
});

test("delete names the medicine and says why nothing is lost, and saying no sends nothing", async () => {
  await fresh();
  confirmAnswer = false;
  await clickOn({ delete: "RX01" });
  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /Amlodipine/);
  assert.match(confirms[0], /Dad's list/);
  assert.match(confirms[0], /nothing is lost/);
  assert.match(confirms[0], /can't be undone/);
  assert.equal(world.sent.length, 0);
  assert.ok(world.ctx.db.rows("Prescriptions").some(r => r.prescription_id === "RX01"));

  confirmAnswer = true;
  S.detail = "RX01";
  await clickOn({ delete: "RX01" });
  assert.equal(lastSent("deletePrescription").prescriptionId, "RX01");
  assert.equal(world.ctx.db.rows("Prescriptions").some(r => r.prescription_id === "RX01"), false);
  assert.equal(S.screen, "meds");
  assert.equal(S.detail, null);
});

// ---- who prescribed it must survive a doctor who is gone ----

test("a doctor who has left the care team is still offered, so saving keeps them", async () => {
  await fresh();
  // CT01 is Dad's care-team row for DOC01, who wrote RX01. Deactivate it: DOC01 is no longer on
  // the care team, but the prescription still names him.
  world.ctx.db.update("CareTeam", "care_id", "CT01", { active: "FALSE" });
  await loadBoot();
  await clickOn({ changeSchedule: "RX01" });
  assert.ok(formModel().doctors.some(d => d.doctor_id === "DOC01"), "the doctor the prescription names must still be in the picker");
  render();
  assert.match(root.innerHTML, /value="DOC01" selected/);
});

test("a doctor whose row was deleted outright is still offered, so the change cannot erase them", async () => {
  await fresh();
  // The narrower case: the Doctors row itself is gone from the Sheet. Nothing matched the
  // prescription's doctor_id, so the browser selected "Not recorded", harvestForm read "", and
  // changePrescriptionSchedule wrote it -- losing a medical fact with nothing on screen to say so.
  world.ctx.db.remove("Doctors", d => d.doctor_id === "DOC01");
  await loadBoot();
  await clickOn({ changeSchedule: "RX01" });
  const offered = formModel().doctors.find(d => d.doctor_id === "DOC01");
  assert.ok(offered, "the id the prescription holds must still have an <option> to come back as");
  assert.match(offered.name, /not in the doctor list/i, "and it says plainly why it has no name");
  render();
  assert.match(root.innerHTML, /value="DOC01" selected/);

  // The whole point: a save through that picker keeps the doctor instead of blanking them.
  await submitOf(makeForm("schedule", [
    field("prescriptionId", "RX01"), field("frequency", "Daily"),
    field("mealTiming", "After meal"), field("doctorId", "DOC01"), field("reason", ""),
  ]));
  assert.equal(lastSent("changePrescriptionSchedule").doctorId, "DOC01");
  assert.equal(world.ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01").doctor_id, "DOC01");
});

// ---- the photo buttons ----

test("the photo target splits on the last bar, so an id with a bar in it still works", () => {
  assert.deepEqual(splitPhotoTarget("MED01|box"), { medicineId: "MED01", slot: "box" });
  assert.deepEqual(splitPhotoTarget("MED|01|pill_front"), { medicineId: "MED|01", slot: "pill_front" });
  assert.deepEqual(splitPhotoTarget("MED01"), { medicineId: "MED01", slot: "" });
});

test("removing a photo asks with the slot and the medicine named, then sends that slot", async () => {
  await fresh();
  // The photo buttons only ever render on the detail screen, which is what the success message is
  // keyed to -- an upload that outlives that screen stays quiet rather than talking over another.
  S.screen = "detail";
  S.detail = "RX01";
  confirmAnswer = false;
  await clickOn({ removePhoto: "MED01|pill_front" });
  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /pill front photo of Amlodipine/);
  assert.equal(world.sent.length, 0);

  confirmAnswer = true;
  await clickOn({ removePhoto: "MED01|pill_front" });
  const req = lastSent("removeMedicinePhoto");
  assert.equal(req.medicineId, "MED01");
  assert.equal(req.slot, "pill_front");
  assert.equal(world.ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").photo_pill_front, "");
  assert.equal(S.toast, "Photo removed.");
});

test("tapping Add photo opens the phone's picker, and cancelling it sends nothing", async () => {
  await fresh();
  S.detail = "RX01";
  await clickOn({ uploadPhoto: "MED01|box" });
  assert.equal(pickerOpened, 1);
  assert.equal(world.sent.length, 0);
});

// The one write path on this branch with no end-to-end Node test, because the old fake picker
// could only ever cancel: uploadPhoto returned before shrinkToDataUrl, the upload, the reload and
// photoDone ever ran.
test("choosing a photo shrinks it, uploads it to the medicine's slot, and says so", async () => {
  await fresh();
  S.screen = "detail";
  S.detail = "RX01";
  nextPickedFile = { name: "box.jpg", type: "image/jpeg" };
  await clickOn({ uploadPhoto: "MED01|box" });

  assert.equal(pickerOpened, 1);
  assert.equal(canvasesMade, 1, "the photo is shrunk on the phone before it goes anywhere");
  const req = lastSent("uploadMedicinePhoto");
  assert.ok(req, "the upload must actually be sent");
  assert.equal(req.medicineId, "MED01");
  assert.equal(req.slot, "box");
  assert.match(req.dataUrl, /^data:image\/jpeg;base64,/);
  // The server accepted it, put it in Drive, and the Sheet now holds the link.
  assert.equal(world.created.length, 1);
  assert.match(world.created[0].folderName, /MED01/);
  assert.equal(world.created[0].fileName, "box.jpg");
  assert.match(world.ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").photo_box, /drive\.google\.com/);
  // And the whole picture was reloaded afterwards, not patched on screen.
  assert.deepEqual(world.sent.map(r => r.action), ["uploadMedicinePhoto", "bootstrap"]);
  assert.equal(S.toast, "Photo saved.");
});

test("replacing a photo the server could not bin says so instead of claiming a clean save", async () => {
  await fresh();
  S.screen = "detail";
  S.detail = "RX01";
  // MED01's pill_front already holds a Drive link in the fixture, and this fake Drive refuses to
  // trash it -- the server's own warning has to reach the family rather than a bare "Photo saved."
  world.trashed.length = 0;
  world.ctx.drive.trash = url => { world.trashed.push(url); return false; };
  nextPickedFile = { name: "pill.jpg", type: "image/jpeg" };
  await clickOn({ uploadPhoto: "MED01|pill_front" });
  assert.equal(world.trashed.length, 1, "the old file is binned by the URL the column held");
  assert.match(S.toast, /old one is still in Drive/);
});

test("a photo upload whose reload ends the session leaves the user on the login screen", async () => {
  await fresh();
  S.screen = "detail";
  S.detail = "RX01";
  world.expireSession = true;
  nextPickedFile = { name: "box.jpg", type: "image/jpeg" };
  await clickOn({ uploadPhoto: "MED01|box" });
  // The upload itself landed...
  assert.match(world.ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").photo_box, /drive\.google\.com/);
  // ...and there is no app screen left to congratulate anyone on.
  assertOnLoginScreen();
});

test("a photo that finishes after the family has left the medicine stays quiet", async () => {
  await fresh();
  S.screen = "detail";
  S.detail = "RX01";
  nextPickedFile = { name: "box.jpg", type: "image/jpeg" };
  const inFlight = clickOn({ uploadPhoto: "MED01|box" });
  S.screen = "meds"; // he wanders off while it uploads
  S.detail = null;
  await inFlight;
  assert.match(world.ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").photo_box, /drive\.google\.com/);
  assert.doesNotMatch(S.toast, /Photo saved/, "a success message belongs to the screen that started the upload, not whatever is on screen when it lands");
});

// ---- moving a dose he has already ticked today ----
//
// The daughter may well still want to save this -- the doctor changed the dose this morning, after
// he had taken it. But she must hear about it BEFORE it is written, naming the medicine and what
// he already took, rather than finding out from Today afterwards. Information, not a veto: saying
// yes still saves.

// The phone's own Bangkok today, which is what Today and the tick handler both use. The fixture
// clock is wound forward to match it so the server will accept a tick for that day.
async function tickedThisMorning() {
  await fresh();
  world.ctx.setNow(Date.now());
  await loadBoot();
  const today = bangkokToday(Date.now());
  const r = handle({ action: "tick", token: world.token, prescriptionId: "RX01", date: today, timeOfDay: "Morning", doseId: "DS01", amount: 2 }, world.ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  await loadBoot();
  assert.ok(S.idx.ticks.get(`${today}|Morning|RX01`), "the tick has to be in the picture the phone is holding");
  world.sent.length = 0;
  confirms.length = 0;
  return today;
}

test("saving a dose change that clears a time of day he has already ticked today asks first", async () => {
  await tickedThisMorning();
  await clickOn({ changeDose: "RX01" });
  confirmAnswer = false;
  await submitOf(makeForm("dose", [
    field("prescriptionId", "RX01"),
    ...DOSE_FIELDS({ Noon: "2" }),
    field("reason", "The doctor moved it to lunchtime"),
  ]));
  assert.equal(confirms.length, 1, "she must be told before it is written, not after");
  assert.match(confirms[0], /Amlodipine/, "the question names the medicine");
  assert.match(confirms[0], /Morning 2 tablet/, "and what he already took");
  assert.match(confirms[0], /stays in the record/, "and that nothing is lost");
  // Saying no writes nothing at all.
  assert.equal(world.sent.length, 0);
  assert.equal(S.screen, "doseForm");
  assert.deepEqual(
    world.ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === "RX01").map(d => d.time_of_day),
    ["Morning"],
  );
});

test("it is information, not a veto: saying yes still saves the move", async () => {
  await tickedThisMorning();
  await clickOn({ changeDose: "RX01" });
  confirmAnswer = true;
  await submitOf(makeForm("dose", [
    field("prescriptionId", "RX01"),
    ...DOSE_FIELDS({ Noon: "2" }),
    field("reason", "The doctor moved it to lunchtime"),
  ]));
  assert.equal(confirms.length, 1);
  assert.deepEqual(lastSent("changePrescriptionDose").doses, [{ timeOfDay: "Noon", amount: 2, unit: "tablet" }]);
  assert.deepEqual(
    world.ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === "RX01").map(d => d.time_of_day),
    ["Noon"],
  );
  assert.equal(S.screen, "detail");
  assert.match(S.toast, /new dose is saved/);
  // And the dose he took is still in the record, untouched: DoseLog is written by tick/tickAll/
  // untick and by nothing else.
  const log = world.ctx.db.rows("DoseLog").filter(r => r.prescription_id === "RX01");
  assert.equal(log.length, 1);
  assert.equal(log[0].time_of_day, "Morning");
  assert.equal(log[0].amount_taken, "2");
});

test("a dose change that keeps the ticked time of day asks nothing, even when the amount changes", async () => {
  await tickedThisMorning();
  await clickOn({ changeDose: "RX01" });
  await submitOf(makeForm("dose", [field("prescriptionId", "RX01"), ...DOSE_FIELDS({ Morning: "1" })]));
  assert.deepEqual(confirms, [], "Morning is still there: nothing is being taken off today's list");
  assert.equal(lastSent("changePrescriptionDose").doses[0].amount, 1);
});

test("a dose change asks nothing when nothing has been ticked today", async () => {
  await fresh();
  await clickOn({ changeDose: "RX01" });
  await submitOf(makeForm("dose", [field("prescriptionId", "RX01"), ...DOSE_FIELDS({ Noon: "2" })]));
  assert.deepEqual(confirms, []);
  assert.ok(lastSent("changePrescriptionDose"));
});

// ---- the form's own controls ----

test("changing the frequency re-renders and keeps the medicine, meal and days already picked", async () => {
  await fresh();
  await clickOn({ addPrescription: "" });
  const daily = makeForm("prescription", [
    field("medicineId", "MED05"), field("frequency", "Daily"), field("mealTiming", "Before meal"),
    ...DOSE_FIELDS({ Morning: "1" }), field("doctorId", "DOC01"), field("notes", ""),
  ]);
  await changeOn(daily, "frequency", "Weekdays", ["[data-freq]"]);
  assert.equal(S.form.frequency, "Weekdays");
  assert.equal(S.form.medicineId, "MED05");
  assert.equal(S.form.mealTiming, "Before meal");
  assert.deepEqual(S.form.doses, [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }]);
  // The weekday rows are only on the page for this frequency, which is what data-freq is for.
  assert.match(root.innerHTML, /name="weekdays"/);

  // Tick three days, then look at another frequency and come back: the days are still ticked.
  const weekly = makeForm("prescription", [
    field("medicineId", "MED05"), field("frequency", "Weekdays"), ...WEEKDAY_BOXES(["Mon", "Wed", "Fri"]),
    field("mealTiming", "Before meal"), ...DOSE_FIELDS({ Morning: "1" }), field("doctorId", "DOC01"), field("notes", ""),
  ]);
  await changeOn(weekly, "weekdays", "Fri", []);
  assert.deepEqual(S.form.weekdays, ["Mon", "Wed", "Fri"]);
  const asNeeded = makeForm("prescription", [
    field("medicineId", "MED05"), field("frequency", "As needed"), field("mealTiming", "Before meal"),
    ...DOSE_FIELDS({ Morning: "1" }), field("doctorId", "DOC01"), field("notes", ""),
  ]);
  await changeOn(asNeeded, "frequency", "As needed", ["[data-freq]"]);
  assert.deepEqual(S.form.weekdays, ["Mon", "Wed", "Fri"]);
});

test("the back arrow asks before dropping a half-filled form, and goes straight back when nothing was typed", async () => {
  await fresh();
  await clickOn({ changeDose: "RX01" });
  const form = makeForm("dose", [field("prescriptionId", "RX01"), ...DOSE_FIELDS({ Morning: "2" })]);
  // No form is passed with the cancel clicks on purpose: topBar() draws the back arrow in the top
  // bar, OUTSIDE the <form>, so closest("form[data-form]") from that button is null on a real
  // phone. What it goes back to is S.formFrom, and whether it asks is S.formDirty.

  // Nothing typed yet: no question, straight back to the medicine.
  await clickOn({ cancel: "" });
  assert.equal(confirms.length, 0);
  assert.equal(S.screen, "detail");
  assert.equal(S.form, null);

  // Something typed, and the answer is no: the form stays exactly where it was.
  await clickOn({ changeDose: "RX01" });
  await typeIn(form);
  confirmAnswer = false;
  await clickOn({ cancel: "" });
  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /without saving/);
  assert.equal(S.screen, "doseForm");
  assert.ok(S.form);

  confirmAnswer = true;
  await clickOn({ cancel: "" });
  assert.equal(S.screen, "detail");
});

test("adding a medicine from the prescription form comes back to it, filled in, with the new medicine chosen", async () => {
  await fresh();
  await clickOn({ addPrescription: "" });
  const half = makeForm("prescription", [
    field("medicineId", ""), field("frequency", "Weekdays"), ...WEEKDAY_BOXES(["Tue", "Sat"]),
    field("mealTiming", "After meal"), ...DOSE_FIELDS({ Evening: "2" }),
    field("doctorId", "DOC02"), field("notes", "with water"),
  ]);
  await clickOn({ newMedicine: "" }, half);
  assert.equal(S.screen, "medicineForm");
  assert.deepEqual(S.formStash.weekdays, ["Tue", "Sat"]);

  await submitOf(makeForm("medicine", [
    field("generic_name", "Furosemide"), field("brand_name", ""), field("strength", "40 mg"),
    field("form", "Tablet"), field("purpose", "Fluid"), field("notes", ""),
  ]));
  const created = world.ctx.db.rows("Medicines").find(m => m.generic_name === "Furosemide");
  assert.equal(S.screen, "prescriptionForm");
  assert.equal(S.form.medicineId, created.medicine_id);
  assert.deepEqual(S.form.weekdays, ["Tue", "Sat"]);
  assert.deepEqual(S.form.doses, [{ timeOfDay: "Evening", amount: 2, unit: "tablet" }]);
  assert.equal(S.form.notes, "with water");
  assert.equal(S.formStash, null);
  // And the new medicine is in the picker, chosen, straight out of the fresh bootstrap.
  render();
  assert.match(root.innerHTML, new RegExp(`value="${created.medicine_id}" selected`));
  assert.match(S.toast, /Furosemide is in the list now/);

  // Backing out of the medicine form must not drop the prescription behind it either.
  await clickOn({ newMedicine: "" }, half);
  assert.equal(S.screen, "medicineForm");
  confirmAnswer = true;
  await clickOn({ cancel: "" });
  assert.equal(S.screen, "prescriptionForm");
  assert.deepEqual(S.form.weekdays, ["Tue", "Sat"]);
});

test("every editing button on the Meds and detail screens is matched by the click listener", async () => {
  await fresh();
  S.detail = "RX01";
  const selector = String(listeners.get("click"));
  ["data-add-prescription", "data-change-dose", "data-change-schedule", "data-stop", "data-restart",
    "data-delete", "data-edit-medicine", "data-new-medicine", "data-upload-photo", "data-remove-photo",
    "data-cancel"].forEach(attr => {
    assert.ok(selector.includes(`[${attr}]`), `${attr} is not in the click listener's selector list`);
  });
  // And each one reaches a branch: an unmatched attribute would leave all of these untouched.
  confirmAnswer = false;
  for (const [dataset, screen] of [[{ changeDose: "RX01" }, "doseForm"], [{ changeSchedule: "RX01" }, "scheduleForm"], [{ editMedicine: "MED01" }, "medicineForm"], [{ addPrescription: "" }, "prescriptionForm"]]) {
    S.screen = "detail";
    await clickOn(dataset);
    assert.equal(S.screen, screen);
  }
});
