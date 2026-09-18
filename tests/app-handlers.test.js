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

globalThis.location = { protocol: "https:", hash: "", search: "" };
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
globalThis.document = {
  body: { appendChild: () => {} },
  activeElement: null,
  getElementById: id => (id === "app" ? root : null),
  addEventListener: () => {},
  // Only js/photoinput.js's pickImage uses this. It answers "cancelled", so a tap on a photo
  // button can be followed all the way into the handler without a real file or canvas.
  createElement: () => {
    const on = {};
    pickerOpened++;
    return {
      style: {}, files: null,
      addEventListener: (type, fn) => { on[type] = fn; },
      click: () => { if (on.cancel) on.cancel(); },
      remove: () => {},
    };
  },
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
  world = { ctx, token, sent: [], created, trashed, breakBootstrap: false };
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

// ---- the photo buttons ----

test("the photo target splits on the last bar, so an id with a bar in it still works", () => {
  assert.deepEqual(splitPhotoTarget("MED01|box"), { medicineId: "MED01", slot: "box" });
  assert.deepEqual(splitPhotoTarget("MED|01|pill_front"), { medicineId: "MED|01", slot: "pill_front" });
  assert.deepEqual(splitPhotoTarget("MED01"), { medicineId: "MED01", slot: "" });
});

test("removing a photo asks with the slot and the medicine named, then sends that slot", async () => {
  await fresh();
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

  // Nothing typed yet: no question, straight back to the medicine.
  await clickOn({ cancel: "" }, form);
  assert.equal(confirms.length, 0);
  assert.equal(S.screen, "detail");
  assert.equal(S.form, null);

  // Something typed, and the answer is no: the form stays exactly where it was.
  await clickOn({ changeDose: "RX01" });
  await typeIn(form);
  confirmAnswer = false;
  await clickOn({ cancel: "" }, form);
  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /without saving/);
  assert.equal(S.screen, "doseForm");
  assert.ok(S.form);

  confirmAnswer = true;
  await clickOn({ cancel: "" }, form);
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
  await clickOn({ cancel: "" }, makeForm("medicine", [field("generic_name", "half typed")]));
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
