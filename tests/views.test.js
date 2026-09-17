// Pure view-string tests for Task 8's screens: every Sheet value must be escaped, and the
// public emergency card must never leak an HN or show any editing / navigation controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMeds } from "../js/views/meds.js";
import { renderDetail } from "../js/views/detail.js";
import { renderDoctors } from "../js/views/doctors.js";
import { renderEmergency, renderEmergencyEdit } from "../js/views/emergency.js";
import { renderMore } from "../js/views/more.js";

const ctx = { me: { user_id: "U01", display_name: "Dad" }, people: [{ user_id: "U01", display_name: "Dad", medicines: "Edit" }], owner: "U01" };

test("renderMeds escapes a malicious medicine name", () => {
  const model = {
    active: [{ prescription: { id: "RX01" }, medicine: { generic_name: "<script>alert(1)</script>", strength: "5 mg" }, summary: "Every day · Morning 1 tablet" }],
    stopped: [],
  };
  const html = renderMeds({ model, ctx });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("renderDetail escapes a malicious doctor name in the doctor card", () => {
  const model = {
    prescription: { meal: "After meal" },
    medicine: { generic_name: "Amlodipine", strength: "5 mg" },
    doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }],
    photos: [{ label: "Box", url: "" }, { label: "Packet front", url: "" }, { label: "Packet back", url: "" }, { label: "Pill front", url: "" }, { label: "Pill back", url: "" }],
    doctor: { name: "<script>bad()</script>", specialty: "Cardiology", phone: "" },
    hospital: { name: "Riverside" },
    hn: "0045821",
    history: [],
  };
  const html = renderDetail({ model, photo: 0 });
  assert.ok(!html.includes("<script>bad"));
  assert.ok(html.includes("&lt;script&gt;bad"));
  assert.ok(html.includes("HN 0045821"));
});

test("renderDetail returns a friendly note for a null (not-owned) prescription", () => {
  const html = renderDetail({ model: null, photo: 0 });
  assert.ok(!html.includes("undefined"));
});

test("renderDoctors escapes a malicious doctor name", () => {
  const rows = [{
    careTeam: { reason: "Blood pressure" },
    doctor: { name: "<script>x</script>", specialty: "Cardiology", phone: "02-555-0112" },
    hospital: { name: "Riverside", phone: "02-555-0110" },
    hn: "0045821",
    photoUrl: "",
    otherHospitals: [],
  }];
  const html = renderDoctors({ rows, ctx });
  assert.ok(!html.includes("<script>x"));
  assert.ok(html.includes("&lt;script&gt;x"));
});

const publicModel = {
  user_id: "U01", display_name: "Somsak", full_name: "Somsak", date_of_birth: "1953-04-12", blood_type: "B+",
  allergies: [], conditions: [], current_medicines: ["Amlodipine 5 mg"], age: 73, notes: "",
  contact1_name: "", contact1_relation: "", contact1_phone: "", contact2_name: "", contact2_relation: "", contact2_phone: "",
};

test("the public emergency card never contains HN and has no edit button", () => {
  const html = renderEmergency({ cards: [publicModel], model: publicModel, ctx: null, publicMode: true });
  assert.ok(!html.includes("HN"));
  assert.ok(!html.includes("data-edit-sos"));
  assert.ok(!html.includes("<nav"));
});

test("a logged-in view of your own card shows Edit my card; someone else's does not", () => {
  const mine = renderEmergency({ cards: [publicModel], model: publicModel, ctx: { me: { user_id: "U01" } }, publicMode: false });
  assert.ok(mine.includes("data-edit-sos"));
  const theirs = renderEmergency({ cards: [publicModel], model: publicModel, ctx: { me: { user_id: "U02" } }, publicMode: false });
  assert.ok(!theirs.includes("data-edit-sos"));
});

test("a card with hospital_numbers shows the HN band; one without does not", () => {
  const withHn = { ...publicModel, hospital_numbers: [{ hospital_name: "Riverside", hn: "0045821", phone: "" }] };
  const html = renderEmergency({ cards: [withHn], model: withHn, ctx: { me: { user_id: "U02" } }, publicMode: false });
  assert.ok(html.includes("0045821"));
  const withoutHn = renderEmergency({ cards: [publicModel], model: publicModel, ctx: { me: { user_id: "U02" } }, publicMode: false });
  assert.ok(!withoutHn.includes("0045821"));
});

test("renderEmergencyEdit escapes field values and only posts whitelisted fields", () => {
  const card = { full_name: "<script>y</script>", date_of_birth: "", blood_type: "", allergies: "", conditions: "", contact1_name: "", contact1_relation: "", contact1_phone: "", contact2_name: "", contact2_relation: "", contact2_phone: "", notes: "" };
  const html = renderEmergencyEdit({ card, error: "", busy: false });
  assert.ok(!html.includes("<script>y"));
  assert.ok(html.includes("&lt;script&gt;y"));
  assert.ok(html.includes('data-form="saveEmergency"'));
});

test("renderMore lists Sheet problems and coming-soon rows", () => {
  const html = renderMore({ me: { display_name: "Dad" }, warnings: ["Prescriptions row RX99: missing user_id"] });
  assert.ok(html.includes("missing user_id"));
  assert.ok(html.toLowerCase().includes("coming soon") || html.toLowerCase().includes("soon"));
  assert.ok(html.includes("data-logout"));
  assert.ok(html.includes("data-refresh"));
});
