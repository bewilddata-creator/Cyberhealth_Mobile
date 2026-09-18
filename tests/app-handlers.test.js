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
const { S, SCREENS, loadBoot, render, formModel, splitPhotoTarget } = await import("../js/app.js");
await import("../js/main.js");

function newWorld() {
  const ctx = fakeCtx();
  const created = [];
  const trashed = [];
  ctx.settings = key => (key === "photo_folder_id" ? "FOLDER123" : "");
  ctx.drive = {
    canOpen: folderId => folderId === "FOLDER123",
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
  Object.assign(S, { boot: null, idx: null, owner: null, date: null, screen: "loading", toast: "", form: null, formStash: null, formError: "", formBusy: false, formDirty: false, detail: null, libraryQuery: "", libraryMedicine: null });
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
// A character typed into the one search box the three library screens share. It is not in a form
// and never submitted: the list filters on `input`, which is why this fires that and nothing else.
const searchFor = value => listeners.get("input")({
  target: { value, matches: sel => sel.includes("data-library-search"), closest: () => null },
});

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
  // A cream is the one kind of medicine the form still asks a unit for -- nothing sensible can be
  // derived from "Cream" -- so leaving it blank is still refused here. (For MED01's usual Tablet
  // the server would fill in "tablet" itself and this would simply save.)
  world.ctx.db.update("Medicines", "medicine_id", "MED01", { form: "Cream" });
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

// F3: this one is release 2a code the family already has on their phones, and it used to say
// "nothing is lost" -- while deletePrescription removes the prescription's PrescriptionChanges
// rows, so every dose adjustment recorded before she decided to remove it goes too. Same shape as
// the three library questions: what is deleted, then what is kept, then that it cannot be undone.
test("delete names the medicine, says what goes and what stays, and saying no sends nothing", async () => {
  await fresh();
  confirmAnswer = false;
  await clickOn({ delete: "RX01" });
  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /Amlodipine/);
  assert.match(confirms[0], /Dad's list/);
  assert.match(confirms[0], /every change recorded for it are deleted/, "the history goes too, so say so");
  assert.match(confirms[0], /stays in the family's medicine list/, "and say what is kept");
  assert.doesNotMatch(confirms[0], /nothing is lost|no record is lost/i, "something IS lost: the schedule and the history");
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

// ---- Edit details comes back where it was tapped ----
//
// data-edit-medicine is on two screens now: the prescription detail, and the medicine library's
// own detail (Task 5). The return screen used to be the literal string "detail", so tapping Edit
// on the library screen and then saving -- or backing out -- dropped the family on the
// prescription detail for whatever happened to be selected, or on Meds when nothing was. They
// tapped Edit on one screen and landed on an unrelated one, which only ever shows up in a
// browser.

test("Edit details goes back to the screen it was tapped on, not always the prescription detail", async () => {
  await fresh();
  // The medicine library's own detail, which Task 6 registered for real. The point is that it is
  // not "detail", and that leaving the form lands back on it.
  assert.ok(SCREENS.medicineLibraryDetail, "the library detail has to be a registered screen, or the form falls back to Meds");
  S.detail = null;
  S.libraryMedicine = "MED01";
  S.screen = "medicineLibraryDetail";

  await clickOn({ editMedicine: "MED01" });
  assert.equal(S.screen, "medicineForm");
  assert.equal(S.formFrom, "medicineLibraryDetail", "the form remembers where Edit was tapped");

  confirmAnswer = true;
  await clickOn({ cancel: "" });
  assert.equal(S.screen, "medicineLibraryDetail", "backing out returns to the library detail, not the prescription detail");

  // And saving from there lands back on it too, not on Meds.
  await clickOn({ editMedicine: "MED01" });
  await submitOf(makeForm("medicine", [
    field("medicineId", "MED01"),
    field("generic_name", "Amlodipine"), field("brand_name", "Norvasc"), field("strength", "5 mg"),
    field("form", "Tablet"), field("purpose", "Blood pressure"), field("notes", ""),
  ]));
  assert.equal(S.screen, "medicineLibraryDetail");
});

test("Edit details tapped on the prescription detail still goes back to the prescription detail", async () => {
  await fresh();
  S.detail = "RX01";
  S.screen = "detail";
  await clickOn({ editMedicine: "MED01" });
  assert.equal(S.formFrom, "detail");
  confirmAnswer = true;
  await clickOn({ cancel: "" });
  assert.equal(S.screen, "detail");
});

// A screen that cannot be drawn is never somewhere to land: a prescription detail with nothing
// selected, and a screen nobody has registered, both fall back to the medicine list.
test("leaving a form falls back to Meds when the screen it came from can't be shown", async () => {
  await fresh();
  S.detail = null;
  S.screen = "aScreenNobodyRegistered";
  await clickOn({ editMedicine: "MED01" });
  assert.equal(S.formFrom, "aScreenNobodyRegistered");
  confirmAnswer = true;
  await clickOn({ cancel: "" });
  assert.equal(S.screen, "meds");
});

// ---- he stops typing the unit ----
//
// The form that ships now has four amount boxes and no unit box at all for a medicine whose form
// says what it is counted in. These post exactly what that form posts, and check the Sheet still
// ends up with a unit on every dose row -- put there by the server, from the Medicines row.

const AMOUNTS_ONLY = (amounts = {}) => ["Morning", "Noon", "Evening", "Bedtime"]
  .map(t => field(`amount${t}`, amounts[t] === undefined ? "" : amounts[t]));

test("the dose form sends no unit, and the Sheet still gets the medicine's own", async () => {
  await fresh();
  await clickOn({ changeDose: "RX01" });
  await submitOf(makeForm("dose", [field("prescriptionId", "RX01"), ...AMOUNTS_ONLY({ Morning: "1", Evening: "0.5" })]));
  assert.deepEqual(lastSent("changePrescriptionDose").doses, [
    { timeOfDay: "Morning", amount: 1, unit: "" },
    { timeOfDay: "Evening", amount: 0.5, unit: "" },
  ], "nothing on the phone claims to know the unit");
  assert.deepEqual(
    world.ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === "RX01").map(d => [d.time_of_day, d.amount, d.unit]),
    [["Morning", "1", "tablet"], ["Evening", "0.5", "tablet"]],
    "MED01 is a Tablet, so both rows are tablets",
  );
  assert.equal(S.screen, "detail");
  assert.match(S.toast, /new dose is saved/);
});

test("adding a medicine to the list sends no unit either, and it saves", async () => {
  await fresh();
  await clickOn({ addPrescription: "" });
  await submitOf(makeForm("prescription", [
    field("medicineId", "MED05"), field("frequency", "Daily"), field("mealTiming", "Any time"),
    ...AMOUNTS_ONLY({ Morning: "2" }), field("doctorId", ""), field("notes", ""),
  ]));
  const sent = lastSent("addPrescription");
  assert.deepEqual(sent.doses, [{ timeOfDay: "Morning", amount: 2, unit: "" }]);
  const rx = world.ctx.db.rows("Prescriptions").find(r => r.medicine_id === "MED05" && r.status === "Active");
  assert.ok(rx, "the prescription reached the Sheet");
  assert.deepEqual(
    world.ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === rx.prescription_id).map(d => d.unit),
    ["tablet"],
  );
});

// The unit word beside the box follows what is typed without a re-render: a re-render per
// keystroke costs him the keyboard mid-word, and one on blur would fight him for the focus.
test("typing an amount rewrites the unit word beside it, and re-renders nothing", async () => {
  await fresh();
  await clickOn({ changeDose: "RX01" });
  const word = { textContent: "tablets" };
  const box = {
    value: "1",
    getAttribute: name => (name === "data-unit" ? "tablet" : null),
    parentElement: { querySelector: sel => (sel.includes("data-unit-word") ? word : null) },
    closest: sel => (sel.includes("form[data-form]") ? { dataset: { form: "dose" } } : null),
  };
  listeners.get("input")({ target: box });
  assert.equal(word.textContent, "tablet", "1 tablet");
  box.value = "2";
  listeners.get("input")({ target: box });
  assert.equal(word.textContent, "tablets", "2 tablets");
  box.value = "";
  listeners.get("input")({ target: box });
  assert.equal(word.textContent, "tablets", "an empty box reads as the plural");
  assert.equal(S.screen, "doseForm", "still on the form, nothing re-rendered out from under him");
});

// F2: the picker is read by eye, down a list, looking for the box in her hand. It now labels
// brand-first, so sorting by generic_name behind the label left it running Norvasc, Glucophage,
// Cozaar -- unsorted to the only person who uses it.

const pickerLabels = () => formModel().medicines.map(m => {
  const brand = String(m.brand_name || "").trim();
  const generic = String(m.generic_name || "").trim();
  const name = !brand ? generic : (brand.toLowerCase() === generic.toLowerCase() ? brand : `${brand} (${generic})`);
  return [name, String(m.strength || "").trim()].filter(Boolean).join(" ");
});

test("the medicine picker is sorted by the name it shows, not the generic behind it", async () => {
  await fresh();
  world.ctx.db.update("Medicines", "medicine_id", "MED01", { brand_name: "Norvasc" });    // Amlodipine
  world.ctx.db.update("Medicines", "medicine_id", "MED02", { brand_name: "Glucophage" }); // Metformin
  world.ctx.db.update("Medicines", "medicine_id", "MED04", { brand_name: "Calpol" });     // Paracetamol
  await loadBoot();
  await clickOn({ addPrescription: "" });
  assert.deepEqual(pickerLabels(), [
    "Calpol (Paracetamol) 500 mg",
    "Epoetin alfa 4,000 IU",
    "Glucophage (Metformin) 500 mg",
    "Norvasc (Amlodipine) 5 mg",
    "Vitamin C 1,000 mg",
  ], "A to Z by what is on screen");
});

// Not a raw < : that compares UTF-16 code units, which puts every lower-case name after every
// upper-case one and every Thai name in code-point rather than dictionary order.
test("the picker's sort is locale-aware, not a code-unit comparison", async () => {
  await fresh();
  world.ctx.db.update("Medicines", "medicine_id", "MED01", { generic_name: "aspirin", brand_name: "" });
  world.ctx.db.update("Medicines", "medicine_id", "MED02", { generic_name: "Betahistine", brand_name: "" });
  await loadBoot();
  await clickOn({ addPrescription: "" });
  const labels = pickerLabels();
  assert.ok(labels.indexOf("aspirin 5 mg") < labels.indexOf("Betahistine 500 mg"),
    `a lower-case a must come before an upper-case B, got ${JSON.stringify(labels)}`);
  assert.ok("aspirin" > "Betahistine", "and a raw comparison would have got this backwards");
});

// Two strengths of the same medicine sit together, weakest first -- 5 mg before 10 mg, which a
// plain string comparison would reverse.
test("two strengths of one medicine sort together, and by number", async () => {
  await fresh();
  world.ctx.db.append("Medicines", { medicine_id: "MED-10", generic_name: "Amlodipine", strength: "10 mg", form: "Tablet" });
  await loadBoot();
  await clickOn({ addPrescription: "" });
  const labels = pickerLabels().filter(l => l.startsWith("Amlodipine"));
  assert.deepEqual(labels, ["Amlodipine 5 mg", "Amlodipine 10 mg"]);
});

// ---- the three shared lists under More (Task 6) ----
//
// These are the whole family's lists, not one person's. Everything below asserts the PAYLOAD the
// phone sends and the screen it lands on, because that is where a wiring bug hides: nothing here
// throws, it just saves the wrong thing quietly.

const DOCTOR_FORM = (over = {}) => [
  ...(over.doctorId ? [field("doctorId", over.doctorId)] : []),
  field("name", over.name === undefined ? "Dr. Nid P." : over.name),
  field("specialty", over.specialty === undefined ? "Eyes" : over.specialty),
  field("phone", over.phone === undefined ? "02-555-0199" : over.phone),
  field("other_contact", over.other_contact === undefined ? "" : over.other_contact),
  field("notes", over.notes === undefined ? "" : over.notes),
];
const HOSPITAL_BOXES = (all, picked) => all.map(id => box("hospitalIds", id, picked.includes(id)));
const HOSPITAL_FORM = (over = {}) => [
  ...(over.hospitalId ? [field("hospitalId", over.hospitalId)] : []),
  field("name", over.name === undefined ? "Lakeside Clinic" : over.name),
  field("phone", over.phone === undefined ? "02-555-0120" : over.phone),
  field("address", over.address === undefined ? "12 Lake Road" : over.address),
  field("map_link", over.map_link === undefined ? "maps.app.goo.gl/x" : over.map_link),
  field("notes", over.notes === undefined ? "" : over.notes),
];

// A doctor and a place nothing points at yet, which is the only kind either screen offers to
// delete. Everything in the fixture is already referenced by a prescription, a care team or a
// hospital number, so the delete tests have to make their own.
async function addSpareDoctor() {
  await clickOn({ library: "doctors" });
  await clickOn({ addDoctor: "" });
  await submitOf(makeForm("doctor", [...DOCTOR_FORM({ name: "Dr. Nobody" }), ...HOSPITAL_BOXES(["HOS01", "HOS02"], [])]));
  return world.ctx.db.rows("Doctors").find(d => d.name === "Dr. Nobody").doctor_id;
}
async function addSpareHospital() {
  await clickOn({ library: "hospitals" });
  await clickOn({ addHospital: "" });
  await submitOf(makeForm("hospital", HOSPITAL_FORM({ name: "Lakeside Clinic" })));
  return world.ctx.db.rows("Hospitals").find(h => h.name === "Lakeside Clinic").hospital_id;
}

test("More opens each of the three lists, and the back arrow goes back to More", async () => {
  await fresh();
  S.screen = "more";
  for (const [which, screen] of [["medicines", "medicineLibrary"], ["doctors", "doctorLibrary"], ["hospitals", "hospitalLibrary"]]) {
    await clickOn({ library: which });
    assert.equal(S.screen, screen);
    // The screen really draws -- an unregistered name would fall through to Today.
    render();
    assert.match(root.innerHTML, /data-back-more/);
    await clickOn({ backMore: "" });
    assert.equal(S.screen, "more");
  }
});

test("a filter typed on one list does not follow him to the next one", async () => {
  await fresh();
  S.screen = "more";
  await clickOn({ library: "medicines" });
  await searchFor("amlo");
  assert.equal(S.libraryQuery, "amlo");
  assert.match(root.innerHTML, /Amlodipine/);
  assert.doesNotMatch(root.innerHTML, /Metformin/, "the list really is filtered, not just the box");
  await clickOn({ backMore: "" });
  await clickOn({ library: "doctors" });
  assert.equal(S.libraryQuery, "", "a word typed on the medicines list would hide doctors for no visible reason");
  render();
  assert.match(root.innerHTML, /Somchai/);
});

test("opening a medicine from the library opens its own page, and Edit details comes back to it", async () => {
  await fresh();
  await clickOn({ library: "medicines" });
  await clickOn({ openMedicine: "MED01" });
  assert.equal(S.screen, "medicineLibraryDetail");
  assert.equal(S.libraryMedicine, "MED01");
  render();
  assert.match(root.innerHTML, /Amlodipine/);

  // The whole point of registering it under this exact name: formReturnScreen() only honours the
  // screen a form was opened from when SCREENS has it, so a mismatch sends Save back to Meds.
  await clickOn({ editMedicine: "MED01" });
  assert.equal(S.formFrom, "medicineLibraryDetail");
  await submitOf(makeForm("medicine", [
    field("generic_name", "Amlodipine"), field("brand_name", "Norvasc"), field("strength", "5 mg"),
    field("form", "Tablet"), field("purpose", "Blood pressure"), field("notes", ""),
  ]));
  assert.equal(S.screen, "medicineLibraryDetail", "Save must come back where Edit was tapped");
  assert.equal(world.ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").brand_name, "Norvasc");
});

test("Add a medicine from the library saves and comes back to the library, not to Meds", async () => {
  await fresh();
  await clickOn({ library: "medicines" });
  await clickOn({ addMedicine: "" });
  assert.equal(S.screen, "medicineForm");
  assert.equal(S.formStash, null, "nothing was half-filled behind this one");
  await submitOf(makeForm("medicine", [
    field("generic_name", "Simvastatin"), field("brand_name", ""), field("strength", "20 mg"),
    field("form", "Tablet"), field("purpose", "Cholesterol"), field("notes", ""),
  ]));
  assert.equal(S.screen, "medicineLibrary");
  assert.ok(world.ctx.db.rows("Medicines").some(m => m.generic_name === "Simvastatin"));
});

// The trap this file already guards for the seven weekday boxes, on the hospital boxes this time:
// all of them share name="hospitalIds", and Object.fromEntries keeps only the last ticked one.
// setDoctorHospitals REPLACES the whole set, so reading it that way would not merely miss a
// hospital -- it would delete every link but one, with a "Saved." toast over the top.
test("a doctor ticked at two hospitals sends both ids, because the boxes are read with getAll", async () => {
  await fresh();
  await clickOn({ library: "doctors" });
  await clickOn({ addDoctor: "" });
  assert.equal(S.screen, "doctorForm");
  const form = makeForm("doctor", [
    ...DOCTOR_FORM({ name: "Dr. Nid P.", specialty: "Eyes" }),
    ...HOSPITAL_BOXES(["HOS01", "HOS02"], ["HOS01", "HOS02"]),
  ]);
  // The obvious read, and what it would have sent.
  assert.equal(Object.fromEntries(new FormData(form)).hospitalIds, "HOS02");

  await submitOf(form);
  const added = lastSent("addDoctor");
  assert.deepEqual(added.fields, { name: "Dr. Nid P.", specialty: "Eyes", phone: "02-555-0199", other_contact: "", notes: "" });
  const saved = world.ctx.db.rows("Doctors").find(d => d.name === "Dr. Nid P.");
  const links = lastSent("setDoctorHospitals");
  assert.equal(links.doctorId, saved.doctor_id);
  assert.deepEqual(links.hospitalIds, ["HOS01", "HOS02"], "both ticked hospitals must arrive, not just the last one");
  assert.deepEqual(
    world.ctx.db.rows("DoctorHospitals").filter(r => r.doctor_id === saved.doctor_id).map(r => r.hospital_id).sort(),
    ["HOS01", "HOS02"],
  );
  // Two calls then one reload -- the screen shows what the Sheet now says, not a patched copy.
  assert.deepEqual(world.sent.map(r => r.action), ["addDoctor", "setDoctorHospitals", "bootstrap"]);
  assert.equal(S.screen, "doctorLibrary");
  assert.match(S.toast, /Dr\. Nid P\. is in the family's doctor list/);
});

test("opening a doctor fills the form in, and unticking a hospital removes that link", async () => {
  await fresh();
  await clickOn({ library: "doctors" });
  // DOC01 is linked to both hospitals in the fixture.
  await clickOn({ openDoctor: "DOC01" });
  assert.equal(S.screen, "doctorForm");
  assert.equal(S.form.doctorId, "DOC01");
  assert.deepEqual(S.form.hospitalIds, ["HOS01", "HOS02"]);
  render();
  assert.match(root.innerHTML, /value="HOS01" checked/);
  assert.match(root.innerHTML, /value="HOS02" checked/);

  await submitOf(makeForm("doctor", [
    ...DOCTOR_FORM({ doctorId: "DOC01", name: "Dr. Somchai K.", specialty: "Cardiology", phone: "02-555-0112" }),
    ...HOSPITAL_BOXES(["HOS01", "HOS02"], ["HOS02"]),
  ]));
  assert.equal(lastSent("updateDoctor").doctorId, "DOC01");
  assert.equal(world.sent.some(r => r.action === "addDoctor"), false, "editing must never add a second copy");
  assert.deepEqual(lastSent("setDoctorHospitals").hospitalIds, ["HOS02"]);
  assert.deepEqual(
    world.ctx.db.rows("DoctorHospitals").filter(r => r.doctor_id === "DOC01").map(r => r.hospital_id),
    ["HOS02"],
  );
  assert.equal(S.screen, "doctorLibrary");
});

// The doctor form saves in two calls, and the second can fail on its own. The family must not be
// told everything saved when the hospitals did not -- and tapping Save again must not leave two
// copies of the same doctor in the list.
test("a doctor saved whose hospitals were refused says exactly that, and saving again updates rather than duplicates", async () => {
  await fresh();
  await clickOn({ library: "doctors" });
  await clickOn({ addDoctor: "" });
  // A hospital another phone removed between opening this form and saving it.
  await submitOf(makeForm("doctor", [
    ...DOCTOR_FORM({ name: "Dr. Half" }),
    ...HOSPITAL_BOXES(["HOS01", "HOS-GONE"], ["HOS-GONE"]),
  ]));
  const saved = world.ctx.db.rows("Doctors").filter(d => d.name === "Dr. Half");
  assert.equal(saved.length, 1, "the doctor really was added");
  assert.equal(S.screen, "doctorForm", "the form stays open, because half of it did not land");
  assert.equal(S.formBusy, false, "and the Save button is alive again");
  assert.match(S.formError, /Dr\. Half is in the list/, "it must not read as a failure -- the doctor IS saved");
  assert.match(S.formError, /where they see patients/, "and it must not read as a success either");
  assert.match(S.formError, /isn't in the list any more/, "the server's own words, not a guess");
  assert.equal(S.form.doctorId, saved[0].doctor_id, "the form now knows the doctor exists");
  render();
  assert.match(root.innerHTML, /where they see patients/, "and she can read it above the button");

  // Ticking a real hospital and saving again finishes the job, without a second Dr. Half.
  await submitOf(makeForm("doctor", [
    ...DOCTOR_FORM({ doctorId: saved[0].doctor_id, name: "Dr. Half" }),
    ...HOSPITAL_BOXES(["HOS01", "HOS02"], ["HOS01"]),
  ]));
  assert.equal(world.sent.filter(r => r.action === "addDoctor").length, 1, "exactly one Dr. Half was ever added");
  assert.ok(lastSent("updateDoctor"));
  assert.equal(world.ctx.db.rows("Doctors").filter(d => d.name === "Dr. Half").length, 1);
  assert.deepEqual(
    world.ctx.db.rows("DoctorHospitals").filter(r => r.doctor_id === saved[0].doctor_id).map(r => r.hospital_id),
    ["HOS01"],
  );
  assert.equal(S.screen, "doctorLibrary");
  assert.equal(S.formError, "");
});

test("a place is added, then edited, and the map link is sent exactly as it was pasted", async () => {
  await fresh();
  await clickOn({ library: "hospitals" });
  await clickOn({ addHospital: "" });
  assert.equal(S.screen, "hospitalForm");
  await submitOf(makeForm("hospital", HOSPITAL_FORM()));
  assert.deepEqual(lastSent("addHospital").fields, {
    name: "Lakeside Clinic", phone: "02-555-0120", address: "12 Lake Road", map_link: "maps.app.goo.gl/x", notes: "",
  });
  assert.equal(S.screen, "hospitalLibrary");
  const made = world.ctx.db.rows("Hospitals").find(h => h.name === "Lakeside Clinic");
  assert.equal(made.map_link, "maps.app.goo.gl/x");

  await clickOn({ openHospital: made.hospital_id });
  assert.equal(S.form.hospitalId, made.hospital_id);
  await submitOf(makeForm("hospital", HOSPITAL_FORM({ hospitalId: made.hospital_id, name: "Lakeside Clinic", phone: "02-555-0121" })));
  assert.equal(lastSent("updateHospital").hospitalId, made.hospital_id);
  assert.equal(world.ctx.db.rows("Hospitals").find(h => h.hospital_id === made.hospital_id).phone, "02-555-0121");
  assert.equal(S.screen, "hospitalLibrary");
  assert.equal(S.toast, "Saved.");
});

test("a library save the server refuses keeps every box as it was typed and shows its own words", async () => {
  await fresh();
  await clickOn({ library: "hospitals" });
  await clickOn({ addHospital: "" });
  await submitOf(makeForm("hospital", HOSPITAL_FORM({ name: "", notes: "typed but not saved" })));
  assert.equal(S.screen, "hospitalForm");
  assert.equal(S.formBusy, false);
  assert.match(S.formError, /needs a name/);
  assert.equal(S.form.hospital.notes, "typed but not saved");
  assert.equal(world.ctx.db.rows("Hospitals").length, 2, "nothing was written");
  render();
  assert.match(root.innerHTML, /needs a name/);
});

// Every delete asks first, names the thing, and says what happens. Saying no sends NOTHING -- not
// a request that the server happens to refuse, nothing at all.
test("saying no to a library delete sends no request whatsoever", async () => {
  await fresh();
  const doctorId = await addSpareDoctor();
  const hospitalId = await addSpareHospital();
  const medicineId = "MED-SPARE";
  world.ctx.db.append("Medicines", { medicine_id: medicineId, generic_name: "Spare", strength: "1 mg", form: "Tablet" });
  await loadBoot();
  world.sent.length = 0;
  confirms.length = 0;
  confirmAnswer = false;

  await clickOn({ deleteMedicine: medicineId });
  await clickOn({ deleteDoctor: doctorId });
  await clickOn({ deleteHospital: hospitalId });
  assert.equal(confirms.length, 3);
  assert.match(confirms[0], /Spare/);
  assert.match(confirms[0], /can't be undone/);
  assert.match(confirms[1], /Dr\. Nobody/);
  assert.match(confirms[1], /hospitals they work at/);
  assert.match(confirms[1], /photo/, "the photo goes too, so the question has to say so");
  assert.match(confirms[2], /Lakeside Clinic/);
  // F3: none of the three may promise "no record is lost" -- each one deletes the row it names,
  // and this is the last sentence read before something nobody here can undo.
  confirms.forEach(ask => assert.doesNotMatch(ask, /no record is lost|nothing is lost/i, ask));
  assert.equal(world.sent.length, 0, "a declined question must not reach the network at all");
  assert.ok(world.ctx.db.rows("Medicines").some(m => m.medicine_id === medicineId));
  assert.ok(world.ctx.db.rows("Doctors").some(d => d.doctor_id === doctorId));
  assert.ok(world.ctx.db.rows("Hospitals").some(h => h.hospital_id === hospitalId));
});

test("saying yes removes the thing and goes back to the list it came from", async () => {
  await fresh();
  const doctorId = await addSpareDoctor();
  await clickOn({ openDoctor: doctorId });
  assert.equal(S.screen, "doctorForm");
  // The button is only drawn when nothing points at the doctor -- which is why this one was made.
  render();
  assert.match(root.innerHTML, new RegExp(`data-delete-doctor="${doctorId}"`));
  await clickOn({ deleteDoctor: doctorId });
  assert.equal(lastSent("deleteDoctor").doctorId, doctorId);
  assert.equal(world.ctx.db.rows("Doctors").some(d => d.doctor_id === doctorId), false);
  assert.equal(S.screen, "doctorLibrary");
  assert.equal(S.form, null, "the form it was deleted from is not left half-open behind the list");
  assert.match(S.toast, /Dr\. Nobody is off the doctor list/);

  const hospitalId = await addSpareHospital();
  await clickOn({ openHospital: hospitalId });
  await clickOn({ deleteHospital: hospitalId });
  assert.equal(lastSent("deleteHospital").hospitalId, hospitalId);
  assert.equal(S.screen, "hospitalLibrary");
  assert.match(S.toast, /Lakeside Clinic is off the list/);

  world.ctx.db.append("Medicines", { medicine_id: "MED-SPARE", generic_name: "Spare", strength: "1 mg", form: "Tablet" });
  await loadBoot();
  await clickOn({ library: "medicines" });
  await clickOn({ openMedicine: "MED-SPARE" });
  await clickOn({ deleteMedicine: "MED-SPARE" });
  assert.equal(lastSent("deleteMedicine").medicineId, "MED-SPARE");
  assert.equal(S.screen, "medicineLibrary");
  assert.equal(S.libraryMedicine, null);
  assert.match(S.toast, /Spare is off the medicine list/);
});

// F1: the server answers a doctor delete whose photo it could not bin with a warning, and a bare
// "off the doctor list" would leave a portrait anyone with the link can open sitting in the
// family's Drive with nobody told. Same handling as deleteMedicine's photos.
test("a doctor delete whose photo could not be binned says so instead of a clean goodbye", async () => {
  await fresh();
  const doctorId = await addSpareDoctor();
  await clickOn({ openDoctor: doctorId });
  nextPickedFile = { name: "doc.jpg", type: "image/jpeg" };
  await clickOn({ uploadDoctorPhoto: doctorId });
  assert.match(world.ctx.db.rows("Doctors").find(d => d.doctor_id === doctorId).photo, /drive\.google\.com/);
  world.ctx.drive.trash = () => false;
  await clickOn({ deleteDoctor: doctorId });
  assert.equal(world.ctx.db.rows("Doctors").some(d => d.doctor_id === doctorId), false, "the delete itself still landed");
  assert.match(S.toast, /still in Drive/);
});

test("a delete the server refuses says why, and leaves the screen where it was", async () => {
  await fresh();
  await clickOn({ library: "doctors" });
  await clickOn({ openDoctor: "DOC01" });
  // DOC01 writes RX01 and is on Dad's care team, so the button is not drawn at all...
  render();
  assert.doesNotMatch(root.innerHTML, /data-delete-doctor/);
  assert.match(root.innerHTML, /can&#39;t be removed while/);
  // ...and even reaching the handler another way is refused, said out loud, and changes nothing.
  await clickOn({ deleteDoctor: "DOC01" });
  assert.match(S.toast, /still named on/);
  assert.equal(S.screen, "doctorForm");
  assert.ok(world.ctx.db.rows("Doctors").some(d => d.doctor_id === "DOC01"));
});

test("a library save whose reload ends the session leaves the user on the login screen", async () => {
  await fresh();
  await clickOn({ library: "hospitals" });
  await clickOn({ addHospital: "" });
  world.expireSession = true;
  await submitOf(makeForm("hospital", HOSPITAL_FORM()));
  assert.ok(world.ctx.db.rows("Hospitals").some(h => h.name === "Lakeside Clinic"), "the write itself landed");
  assertOnLoginScreen();
});

test("a library delete whose reload ends the session does the same", async () => {
  await fresh();
  const doctorId = await addSpareDoctor();
  await clickOn({ openDoctor: doctorId });
  world.expireSession = true;
  await clickOn({ deleteDoctor: doctorId });
  assert.equal(world.ctx.db.rows("Doctors").some(d => d.doctor_id === doctorId), false, "the delete itself landed");
  assertOnLoginScreen();
});

test("a doctor photo whose reload ends the session does the same", async () => {
  await fresh();
  await clickOn({ library: "doctors" });
  await clickOn({ openDoctor: "DOC01" });
  world.expireSession = true;
  nextPickedFile = { name: "doc.jpg", type: "image/jpeg" };
  await clickOn({ uploadDoctorPhoto: "DOC01" });
  assert.match(world.ctx.db.rows("Doctors").find(d => d.doctor_id === "DOC01").photo, /drive\.google\.com/);
  assertOnLoginScreen();
});

test("the doctor's photo is shrunk, uploaded and then removable, and removing it asks first", async () => {
  await fresh();
  await clickOn({ library: "doctors" });
  await clickOn({ openDoctor: "DOC02" });
  // A doctor with no photo yet is offered one, because DOC02 is already saved.
  render();
  assert.match(root.innerHTML, /data-upload-doctor-photo="DOC02"/);
  assert.doesNotMatch(root.innerHTML, /data-remove-doctor-photo/);

  nextPickedFile = { name: "doc.jpg", type: "image/jpeg" };
  await clickOn({ uploadDoctorPhoto: "DOC02" });
  assert.equal(canvasesMade, 1, "the photo is shrunk on the phone before it goes anywhere");
  assert.match(lastSent("uploadDoctorPhoto").dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(lastSent("uploadDoctorPhoto").doctorId, "DOC02");
  assert.match(world.ctx.db.rows("Doctors").find(d => d.doctor_id === "DOC02").photo, /drive\.google\.com/);
  assert.equal(S.toast, "Photo saved.");
  assert.equal(S.screen, "doctorForm", "still on the doctor, with the photo now on it");
  render();
  assert.match(root.innerHTML, /data-remove-doctor-photo="DOC02"/);

  confirmAnswer = false;
  confirms.length = 0;
  world.sent.length = 0;
  await clickOn({ removeDoctorPhoto: "DOC02" });
  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /Dr\. Anan S\./);
  assert.match(confirms[0], /stay in the doctor list/);
  assert.equal(world.sent.length, 0);

  confirmAnswer = true;
  await clickOn({ removeDoctorPhoto: "DOC02" });
  assert.equal(world.ctx.db.rows("Doctors").find(d => d.doctor_id === "DOC02").photo, "");
  assert.equal(S.toast, "Photo removed.");
});

test("a medicine photo added from the library page says so there, rather than in silence", async () => {
  await fresh();
  await clickOn({ library: "medicines" });
  await clickOn({ openMedicine: "MED02" });
  nextPickedFile = { name: "box.jpg", type: "image/jpeg" };
  await clickOn({ uploadPhoto: "MED02|box" });
  assert.equal(lastSent("uploadMedicinePhoto").slot, "box");
  assert.match(world.ctx.db.rows("Medicines").find(m => m.medicine_id === "MED02").photo_box, /drive\.google\.com/);
  assert.equal(S.toast, "Photo saved.", "a photo saved with nothing said reads as a photo that did not save");

  // And Remove names the slot from the library's own model, not from the prescription detail's.
  confirmAnswer = false;
  confirms.length = 0;
  await clickOn({ removePhoto: "MED02|box" });
  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /box photo of Metformin/);
});

test("every library control is in the click listener's selector list, and each one reaches a branch", async () => {
  await fresh();
  const selector = String(listeners.get("click"));
  ["data-library", "data-back-more", "data-back-library", "data-library-search",
    "data-add-medicine", "data-add-doctor", "data-add-hospital",
    "data-open-medicine", "data-open-doctor", "data-open-hospital",
    "data-edit-doctor", "data-edit-hospital",
    "data-delete-medicine", "data-delete-doctor", "data-delete-hospital",
    "data-upload-doctor-photo", "data-remove-doctor-photo"].forEach(attr => {
    assert.ok(selector.includes(`[${attr}]`), `${attr} is not in the click listener's selector list`);
  });
  for (const [dataset, screen] of [
    [{ library: "medicines" }, "medicineLibrary"],
    [{ openMedicine: "MED01" }, "medicineLibraryDetail"],
    [{ backLibrary: "medicines" }, "medicineLibrary"],
    [{ library: "doctors" }, "doctorLibrary"],
    [{ openDoctor: "DOC01" }, "doctorForm"],
    [{ editDoctor: "DOC01" }, "doctorForm"],
    [{ library: "hospitals" }, "hospitalLibrary"],
    [{ openHospital: "HOS01" }, "hospitalForm"],
    [{ editHospital: "HOS01" }, "hospitalForm"],
    [{ addHospital: "" }, "hospitalForm"],
    [{ addDoctor: "" }, "doctorForm"],
    [{ addMedicine: "" }, "medicineForm"],
    [{ backMore: "" }, "more"],
  ]) {
    await clickOn(dataset);
    assert.equal(S.screen, screen, `${JSON.stringify(dataset)} should reach ${screen}`);
  }
});

// ---- Fix round 1: "Who prescribed it?" offers the whole shared doctor list ----
//
// The doctor library let the family record a doctor and then did nothing with them: the picker on
// a prescription was built from the owner's CareTeam rows alone, so a doctor added through the new
// screen could never be chosen as the prescriber. The only way to use one was to hand-edit the
// CareTeam tab in the Sheet -- the very thing this release exists to remove.
//
// In the fixture both DOC01 and DOC02 are on Dad's care team, so these tests add library-only
// doctors whose names sort BEFORE both of them. That is deliberate: a flat A-to-Z sort, or the two
// groups concatenated the wrong way round, would put a library-only doctor first, and the ordering
// test below would fail.

const doctorNames = () => formModel().doctors.map(d => d.name);

async function withLibraryDoctors() {
  await fresh();
  // Appended out of alphabetical order, so the sort WITHIN the second group is pinned too.
  world.ctx.db.append("Doctors", { doctor_id: "DOC-LIB2", name: "Dr. Bbb Library", specialty: "Skin" });
  world.ctx.db.append("Doctors", { doctor_id: "DOC-LIB1", name: "Dr. Aaa Library", specialty: "Bones" });
  await loadBoot();
  await clickOn({ changeSchedule: "RX01" });
  assert.equal(S.screen, "scheduleForm");
}

test("a doctor on the owner's care team is offered as the prescriber", async () => {
  await withLibraryDoctors();
  const offered = formModel().doctors;
  assert.ok(offered.some(d => d.doctor_id === "DOC01"), "Dr. Somchai K. writes RX01 and is on Dad's care team");
  assert.ok(offered.some(d => d.doctor_id === "DOC02"), "Dr. Anan S. is on Dad's care team too");
  render();
  assert.match(root.innerHTML, /value="DOC01" selected/);
});

// The gap this fix round exists to close.
test("a doctor who is only in the family's shared list is offered too, and saving keeps them", async () => {
  await withLibraryDoctors();
  assert.ok(formModel().doctors.some(d => d.doctor_id === "DOC-LIB1"), "a doctor added in the library must be choosable as the prescriber");
  render();
  assert.match(root.innerHTML, /value="DOC-LIB1"/);

  // Not merely listed: chosen, sent, and written to the Sheet.
  await submitOf(makeForm("schedule", [
    field("prescriptionId", "RX01"), field("frequency", "Daily"),
    field("mealTiming", "After meal"), field("doctorId", "DOC-LIB1"), field("reason", ""),
  ]));
  assert.equal(lastSent("changePrescriptionSchedule").doctorId, "DOC-LIB1");
  assert.equal(world.ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01").doctor_id, "DOC-LIB1");
});

test("a doctor the prescription names who has left the care team is still offered, so the save can't erase them", async () => {
  await withLibraryDoctors();
  // CT01 is Dad's care-team row for DOC01, who wrote RX01. Deactivate it: DOC01 is off the care
  // team, but RX01 still names him.
  world.ctx.db.update("CareTeam", "care_id", "CT01", { active: "FALSE" });
  await loadBoot();
  await clickOn({ changeSchedule: "RX01" });
  const offered = formModel().doctors;
  assert.ok(offered.some(d => d.doctor_id === "DOC01"), "the doctor the prescription names must still have an <option> to come back as");
  // He is no longer on the care team, so he belongs after everyone who is.
  assert.ok(doctorNames().indexOf("Dr. Somchai K.") > doctorNames().indexOf("Dr. Anan S."),
    `the one still on the care team comes first, got ${JSON.stringify(doctorNames())}`);
  await submitOf(makeForm("schedule", [
    field("prescriptionId", "RX01"), field("frequency", "Daily"),
    field("mealTiming", "After meal"), field("doctorId", "DOC01"), field("reason", ""),
  ]));
  assert.equal(world.ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01").doctor_id, "DOC01");
});

// The ordering, pinned exactly. Concatenating the two groups the other way round, or sorting the
// whole list flat, both put "Dr. Aaa Library" first and fail this.
test("the owner's own care team comes first, then the rest of the family's list, each A to Z", async () => {
  await withLibraryDoctors();
  assert.deepEqual(doctorNames(), [
    "Dr. Anan S.",      // care team
    "Dr. Somchai K.",   // care team
    "Dr. Aaa Library",  // the rest of the shared list
    "Dr. Bbb Library",
  ]);
  const flat = [...doctorNames()].sort();
  assert.notDeepEqual(doctorNames(), flat, "a flat A-to-Z sort must NOT pass this test, or it pins nothing");
  // And the screen draws them in that order too.
  render();
  const picker = root.innerHTML.match(/<select id="f-doctor"[\s\S]*?<\/select>/)[0];
  const shown = [...picker.matchAll(/<option value="[^"]*"[^>]*>([^<]*)<\/option>/g)].map(m => m[1]);
  assert.deepEqual(shown, ["Not recorded", "Dr. Anan S.", "Dr. Somchai K.", "Dr. Aaa Library", "Dr. Bbb Library"]);
});

// Widening the picker must not show anything the phone was not already holding. The shared lists
// (Medicines, Hospitals, Doctors, DoctorHospitals) are sent to every logged-in user in full;
// hospital_numbers and care_team are the per-person rows, and bootstrap filters those -- nothing
// here touches them.
test("every doctor the picker offers is one bootstrap already sent this phone", async () => {
  await withLibraryDoctors();
  const known = new Set(S.boot.doctors.map(d => d.doctor_id));
  formModel().doctors.forEach(d => {
    assert.ok(known.has(d.doctor_id), `${d.doctor_id} is in the picker but not in this phone's own bootstrap`);
  });
  assert.equal(formModel().doctors.length, S.boot.doctors.length, "and every doctor it holds, no more and no fewer");
});

// ---- Fix round 2: the two groups are drawn with headings of their own ----
//
// Ordered but unlabelled, the picker read as one alphabetical list that restarts halfway down --
// which looks like a broken screen, and the one job this control has is "did I pick the right
// doctor". Each group now carries an <optgroup> heading.
//
// Reads the rendered <select> back into groups, so these tests pin what is actually on the phone
// rather than what the model happened to hold. Names come back HTML-escaped, exactly as the
// browser receives them.
function readPicker() {
  const sel = root.innerHTML.match(/<select id="f-doctor"[\s\S]*?<\/select>/)[0];
  const groups = [];
  const outside = [];
  let current = null;
  const token = /<optgroup label="([^"]*)">|<\/optgroup>|<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g;
  let m;
  while ((m = token.exec(sel))) {
    if (m[0].startsWith("<optgroup")) { current = { label: m[1], names: [] }; groups.push(current); continue; }
    if (m[0] === "</optgroup>") { current = null; continue; }
    (current ? current.names : outside).push(m[3]);
  }
  return { sel, groups, outside };
}

test("the prescriber picker draws two labelled groups, with every doctor under the right heading", async () => {
  await withLibraryDoctors();
  render();
  const { sel, groups, outside } = readPicker();

  assert.equal(groups.length, 2, "flattening the two groups back into one list must fail this");
  // The owner's display name is typed into the Sheet, so it arrives escaped.
  assert.equal(groups[0].label, "Dad&#39;s own doctors");
  assert.deepEqual(groups[0].names, ["Dr. Anan S.", "Dr. Somchai K."], "the care team, A to Z");
  assert.equal(groups[1].label, "The family&#39;s other doctors");
  assert.deepEqual(groups[1].names, ["Dr. Aaa Library", "Dr. Bbb Library"], "the rest of the shared list, A to Z");

  // "Not recorded" is not a doctor and belongs to neither group -- and it stays at the top.
  assert.deepEqual(outside, ["Not recorded"]);
  assert.ok(sel.indexOf(">Not recorded<") < sel.indexOf("<optgroup"), "Not recorded comes before the first heading");
  // Nobody was dropped on the way through: every name the model offers is on the screen once.
  assert.deepEqual(
    groups.flatMap(g => g.names).concat(outside.filter(n => n !== "Not recorded")).sort(),
    formModel().doctors.map(d => d.name).sort(),
  );
  // And the headings are short enough for a narrow native picker.
  groups.forEach(g => assert.ok(g.label.replace(/&#39;/g, "'").length <= 30, `heading too long: ${g.label}`));
});

test("a doctor with no group at all is still drawn, rather than dropped between the headings", async () => {
  await withLibraryDoctors();
  // The one case the two groups cannot claim: the Doctors row itself is gone from the Sheet, but
  // RX01 still names DOC01. Without an <option> carrying that id the <select> comes back "" and
  // the save silently erases who prescribed the medicine.
  world.ctx.db.remove("Doctors", d => d.doctor_id === "DOC01");
  await loadBoot();
  await clickOn({ changeSchedule: "RX01" });
  render();
  const { groups, outside } = readPicker();
  assert.equal(groups.length, 2);
  assert.ok(!groups.some(g => g.names.some(n => /not in the doctor list/i.test(n))), "they are in neither group");
  assert.ok(outside.some(n => /not in the doctor list/i.test(n)), "but they are still on the screen");
  assert.match(root.innerHTML, /value="DOC01" selected/);

  await submitOf(makeForm("schedule", [
    field("prescriptionId", "RX01"), field("frequency", "Daily"),
    field("mealTiming", "After meal"), field("doctorId", "DOC01"), field("reason", ""),
  ]));
  assert.equal(world.ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01").doctor_id, "DOC01");
});
