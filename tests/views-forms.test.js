// The three editing forms. They are plain strings, so these tests pin the things that would
// otherwise only show up on somebody's phone: every Sheet value escaped, the error where the eye
// lands, the save button dead while a save is in flight, and the exact values the server accepts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMedicineForm, renderPrescriptionForm, renderDoseForm, renderScheduleForm } from "../js/views/forms.js";

test("renderMedicineForm escapes what the user typed", () => {
  const html = renderMedicineForm({ medicine: { generic_name: `<script>alert(1)</script>` }, error: "", busy: false });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("renderMedicineForm shows an error above the fields when there is one", () => {
  const html = renderMedicineForm({ medicine: {}, error: "A medicine needs a name.", busy: false });
  assert.match(html, /A medicine needs a name\./);
});

test("renderMedicineForm disables the save button while busy", () => {
  assert.match(renderMedicineForm({ medicine: {}, error: "", busy: true }), /disabled/);
});

test("renderDoseForm shows one row per time of day with its current amount", () => {
  const html = renderDoseForm({
    model: {
      medicineName: "Amlodipine",
      doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }, { timeOfDay: "Evening", amount: 0.5, unit: "tablet" }],
    },
    error: "", busy: false,
  });
  assert.match(html, /Morning/);
  assert.match(html, /Evening/);
  assert.match(html, /value="1"/);
  assert.match(html, /value="0.5"/);
});

test("renderDoseForm carries an optional reason box that is not required", () => {
  const html = renderDoseForm({ model: { medicineName: "Amlodipine", doses: [] }, error: "", busy: false });
  assert.match(html, /name="reason"/);
  assert.doesNotMatch(html, /name="reason"[^>]*required/);
});

test("renderPrescriptionForm lists every medicine in the library plus a way to add a new one", () => {
  const html = renderPrescriptionForm({
    model: {
      medicines: [{ medicine_id: "MED01", generic_name: "Amlodipine", strength: "5 mg" }],
      doctors: [{ doctor_id: "DOC01", name: "Dr Somchai" }],
      frequency: "Daily", doses: [],
    },
    error: "", busy: false,
  });
  assert.match(html, /Amlodipine/);
  assert.match(html, /data-new-medicine/);
});

// ---- beyond the brief: the things Task 9 and the family depend on ----

test("every form carries the data-form name the submit handler dispatches on", () => {
  assert.match(renderMedicineForm({ medicine: {}, error: "", busy: false }), /data-form="medicine"/);
  assert.match(renderPrescriptionForm({ model: {}, error: "", busy: false }), /data-form="prescription"/);
  assert.match(renderDoseForm({ model: { doses: [] }, error: "", busy: false }), /data-form="dose"/);
  assert.match(renderScheduleForm({ model: {}, error: "", busy: false }), /data-form="schedule"/);
});

test("each form has exactly one submit button; every other button says type=button", () => {
  const forms = [
    renderMedicineForm({ medicine: {}, error: "", busy: false }),
    renderPrescriptionForm({ model: { medicines: [], doctors: [], frequency: "Every N days", doses: [] }, error: "", busy: false }),
    renderDoseForm({ model: { medicineName: "A", doses: [] }, error: "", busy: false }),
    renderScheduleForm({ model: { medicineName: "A", doctors: [], frequency: "Weekdays" }, error: "", busy: false }),
  ];
  for (const html of forms) {
    const buttons = html.match(/<button[^>]*>/g) || [];
    assert.ok(buttons.length > 1, "a form has a save button and at least a way back");
    const plain = buttons.filter(b => !/type="button"/.test(b));
    assert.equal(plain.length, 1, `exactly one submit button, got: ${plain.join(" ")}`);
  }
});

test("renderMedicineForm carries the id only when editing, so the same form adds and edits", () => {
  assert.doesNotMatch(renderMedicineForm({ medicine: {}, error: "", busy: false }), /name="medicineId"/);
  const editing = renderMedicineForm({ medicine: { medicine_id: "MED01", generic_name: "Amlodipine" }, error: "", busy: false });
  assert.match(editing, /name="medicineId" value="MED01"/);
});

test("renderMedicineForm asks for a name and nothing else", () => {
  const html = renderMedicineForm({ medicine: {}, error: "", busy: false });
  assert.match(html, /name="generic_name"[^>]*required/, "the name is the one field the server insists on");
  for (const field of ["brand_name", "strength", "form", "purpose", "notes"]) {
    assert.match(html, new RegExp(`name="${field}"`), `${field} is on the form`);
    assert.doesNotMatch(html, new RegExp(`name="${field}"[^>]*required`), `${field} must stay optional`);
  }
});

test("renderPrescriptionForm offers exactly the four schedules and the four meal timings the server accepts", () => {
  const html = renderPrescriptionForm({ model: { medicines: [], doctors: [], frequency: "Daily", doses: [] }, error: "", busy: false });
  for (const v of ["Daily", "Every N days", "Weekdays", "As needed"]) assert.match(html, new RegExp(`value="${v}"`), v);
  for (const v of ["Before meal", "After meal", "With meal", "Any time"]) assert.match(html, new RegExp(`value="${v}"`), v);
});

test("renderPrescriptionForm asks how many days only for Every N days, and which weekdays only for Weekdays", () => {
  const daily = renderPrescriptionForm({ model: { medicines: [], doctors: [], frequency: "Daily", doses: [] }, error: "", busy: false });
  assert.doesNotMatch(daily, /name="everyNDays"/);
  assert.doesNotMatch(daily, /name="countFrom"/);
  assert.doesNotMatch(daily, /name="weekdays"/);

  const everyN = renderPrescriptionForm({ model: { medicines: [], doctors: [], frequency: "Every N days", everyNDays: 3, countFrom: "2026-09-18", doses: [] }, error: "", busy: false });
  assert.match(everyN, /name="everyNDays"[^>]*value="3"/);
  assert.match(everyN, /name="countFrom"[^>]*value="2026-09-18"/);
  assert.doesNotMatch(everyN, /name="weekdays"/);

  const weekdays = renderPrescriptionForm({ model: { medicines: [], doctors: [], frequency: "Weekdays", weekdays: ["Mon", "Thu"], doses: [] }, error: "", busy: false });
  const boxes = weekdays.match(/name="weekdays"[^>]*>/g) || [];
  assert.equal(boxes.length, 7, "one checkbox per day of the week");
  assert.equal(boxes.filter(b => /checked/.test(b)).length, 2, "Mon and Thu come back ticked");
  assert.doesNotMatch(weekdays, /name="everyNDays"/);
});

test("renderPrescriptionForm keeps a doctor optional and says so in words", () => {
  const html = renderPrescriptionForm({ model: { medicines: [], doctors: [{ doctor_id: "DOC01", name: "Dr Somchai" }], doctorId: "DOC01", frequency: "Daily", doses: [] }, error: "", busy: false });
  assert.match(html, /name="doctorId"/);
  assert.match(html, /Not recorded/);
  assert.match(html, /value="DOC01" selected/);
});

test("renderPrescriptionForm escapes a medicine, doctor and note typed into the Sheet by hand", () => {
  const html = renderPrescriptionForm({
    model: {
      medicines: [{ medicine_id: `M"1`, generic_name: `<b>Bad</b>`, strength: `5"mg` }],
      doctors: [{ doctor_id: "D<1", name: `<script>x</script>` }],
      frequency: "Daily", doses: [{ timeOfDay: "Morning", amount: 1, unit: `<i>tab</i>` }],
      notes: `<script>n</script>`,
    },
    error: `<script>e</script>`, busy: false,
  });
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>Bad<\/b>/);
  assert.doesNotMatch(html, /<i>tab<\/i>/);
});

test("renderPrescriptionForm and renderDoseForm both have all four times of day, blank where there is no dose", () => {
  for (const html of [
    renderPrescriptionForm({ model: { medicines: [], doctors: [], frequency: "Daily", doses: [{ timeOfDay: "Noon", amount: 2, unit: "tablet" }] }, error: "", busy: false }),
    renderDoseForm({ model: { medicineName: "A", doses: [{ timeOfDay: "Noon", amount: 2, unit: "tablet" }] }, error: "", busy: false }),
  ]) {
    for (const t of ["Morning", "Noon", "Evening", "Bedtime"]) {
      assert.match(html, new RegExp(`name="amount${t}"`), `${t} amount`);
      assert.match(html, new RegExp(`name="unit${t}"`), `${t} unit`);
    }
    assert.match(html, /name="amountNoon"[^>]*value="2"/);
    assert.match(html, /name="amountMorning"[^>]*value=""/, "no Morning dose means an empty box, not a 0");
  }
});

test("renderDoseForm names the medicine and carries the prescription it is changing", () => {
  const html = renderDoseForm({ model: { prescriptionId: "RX01", medicineName: "Amlodipine", doses: [] }, error: "", busy: false });
  assert.match(html, /Amlodipine/);
  assert.match(html, /name="prescriptionId" value="RX01"/);
});

test("every form disables its save button and says what it is doing while busy", () => {
  for (const html of [
    renderMedicineForm({ medicine: {}, error: "", busy: true }),
    renderPrescriptionForm({ model: { medicines: [], doctors: [], frequency: "Daily", doses: [] }, error: "", busy: true }),
    renderDoseForm({ model: { medicineName: "A", doses: [] }, error: "", busy: true }),
    renderScheduleForm({ model: { medicineName: "A", doctors: [], frequency: "Daily" }, error: "", busy: true }),
  ]) {
    assert.match(html, /disabled/);
    assert.match(html, /Saving…/);
  }
});

test("every form shows the error in a live region so a screen reader announces it", () => {
  for (const html of [
    renderMedicineForm({ medicine: {}, error: "Nope.", busy: false }),
    renderPrescriptionForm({ model: { medicines: [], doctors: [], frequency: "Daily", doses: [] }, error: "Nope.", busy: false }),
    renderDoseForm({ model: { medicineName: "A", doses: [] }, error: "Nope.", busy: false }),
    renderScheduleForm({ model: { medicineName: "A", doctors: [], frequency: "Daily" }, error: "Nope.", busy: false }),
  ]) {
    assert.match(html, /<p class="err" role="alert">Nope\.<\/p>/);
  }
});

test("no form ever prints undefined or null from a model field nobody filled in", () => {
  for (const html of [
    renderMedicineForm({ medicine: {}, error: "", busy: false }),
    renderPrescriptionForm({ model: {}, error: "", busy: false }),
    renderDoseForm({ model: {}, error: "", busy: false }),
    renderScheduleForm({ model: {}, error: "", busy: false }),
  ]) {
    assert.doesNotMatch(html, /undefined/);
    assert.doesNotMatch(html, />null</);
  }
});

test("an amount box refuses a literal 0 on the phone, so 0 never travels to the server", () => {
  for (const html of [
    renderPrescriptionForm({ model: { medicines: [], doctors: [], frequency: "Daily", doses: [] }, error: "", busy: false }),
    renderDoseForm({ model: { medicineName: "A", doses: [] }, error: "", busy: false }),
  ]) {
    const amounts = html.match(/<input[^>]*name="amount(?:Morning|Noon|Evening|Bedtime)"[^>]*>/g) || [];
    assert.equal(amounts.length, 4);
    for (const box of amounts) {
      assert.doesNotMatch(box, /min="0"/, "min=0 would let a 0 through to an action that rejects it");
      assert.match(box, /min="0\.01"/);
      assert.match(box, /step="any"/, "half and quarter tablets still have to go through");
    }
  }
});

test("the amount and unit columns are labelled by something that stays after he types", () => {
  const html = renderDoseForm({ model: { medicineName: "A", doses: [] }, error: "", busy: false });
  assert.match(html, /class="form-row dose-row dose-head"/);
  assert.match(html, /How much/);
  assert.match(html, /Tablets, ml, drops/);
});

// ---- the schedule change (F1: the flow the detail screen has a button for) ----

test("renderScheduleForm carries the prescription it is changing and names the medicine", () => {
  const html = renderScheduleForm({ model: { prescriptionId: "RX01", medicineName: "Amlodipine", frequency: "Daily", doctors: [] }, error: "", busy: false });
  assert.match(html, /name="prescriptionId" value="RX01"/);
  assert.match(html, /Amlodipine/);
  assert.match(html, /Save the new schedule/);
  assert.doesNotMatch(html, /Add to the list/);
});

// changePrescriptionSchedule reads neither, so offering them would silently discard an edit.
test("renderScheduleForm shows no medicine picker and no amount rows, because the action ignores both", () => {
  const html = renderScheduleForm({
    model: { prescriptionId: "RX01", medicineName: "Amlodipine", frequency: "Daily", doctors: [], medicines: [{ medicine_id: "MED01", generic_name: "Amlodipine" }], doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }] },
    error: "", busy: false,
  });
  assert.doesNotMatch(html, /name="medicineId"/);
  assert.doesNotMatch(html, /data-new-medicine/);
  for (const t of ["Morning", "Noon", "Evening", "Bedtime"]) {
    assert.doesNotMatch(html, new RegExp(`name="amount${t}"`), `${t} amount must not be on this form`);
    assert.doesNotMatch(html, new RegExp(`name="unit${t}"`), `${t} unit must not be on this form`);
  }
});

test("renderScheduleForm offers exactly the schedule fields the action writes", () => {
  const html = renderScheduleForm({ model: { prescriptionId: "RX01", medicineName: "A", frequency: "Daily", doctors: [{ doctor_id: "DOC01", name: "Dr Somchai" }], doctorId: "DOC01" }, error: "", busy: false });
  for (const name of ["frequency", "mealTiming", "doctorId", "reason"]) {
    assert.match(html, new RegExp(`name="${name}"`), name);
  }
  assert.match(html, /value="DOC01" selected/);
  for (const v of ["Daily", "Every N days", "Weekdays", "As needed"]) assert.match(html, new RegExp(`value="${v}"`), v);
  for (const v of ["Before meal", "After meal", "With meal", "Any time"]) assert.match(html, new RegExp(`value="${v}"`), v);
});

test("renderScheduleForm asks how many days only for Every N days, and which weekdays only for Weekdays", () => {
  const daily = renderScheduleForm({ model: { frequency: "Daily", doctors: [] }, error: "", busy: false });
  assert.doesNotMatch(daily, /name="everyNDays"/);
  assert.doesNotMatch(daily, /name="weekdays"/);

  const everyN = renderScheduleForm({ model: { frequency: "Every N days", everyNDays: 2, countFrom: "2026-09-18", doctors: [] }, error: "", busy: false });
  assert.match(everyN, /name="everyNDays"[^>]*value="2"/);
  assert.match(everyN, /name="countFrom"[^>]*value="2026-09-18"/);

  const weekdays = renderScheduleForm({ model: { frequency: "Weekdays", weekdays: ["Wed"], doctors: [] }, error: "", busy: false });
  const boxes = weekdays.match(/name="weekdays"[^>]*>/g) || [];
  assert.equal(boxes.length, 7);
  assert.equal(boxes.filter(b => /checked/.test(b)).length, 1);
});

test("renderScheduleForm keeps the reason optional and escapes a hand-typed medicine name", () => {
  const html = renderScheduleForm({ model: { prescriptionId: "RX01", medicineName: `<script>x</script>`, frequency: "Daily", doctors: [], reason: `<b>why</b>` }, error: "", busy: false });
  assert.match(html, /name="reason"/);
  assert.doesNotMatch(html, /name="reason"[^>]*required/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>why<\/b>/);
  assert.match(html, /&lt;script&gt;/);
});
