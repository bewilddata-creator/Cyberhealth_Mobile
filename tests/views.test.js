// Pure view-string tests for Task 8's screens: every Sheet value must be escaped, and the
// public emergency card must never leak an HN or show any editing / navigation controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMeds } from "../js/views/meds.js";
import { renderDetail } from "../js/views/detail.js";
import { renderDoctors } from "../js/views/doctors.js";
import { renderEmergency, renderEmergencyEdit } from "../js/views/emergency.js";
import { renderMore } from "../js/views/more.js";

const ctx = { me: { user_id: "U01", display_name: "Dad" }, people: [{ user_id: "U01", display_name: "Dad", medicines: "Edit", care_team: "Edit" }], owner: "U01" };

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

// The edit controls are drawn from the grant bootstrap sent (canEditOwner). A viewer with only
// View must not see a single control -- the server would refuse the write anyway, but a button
// that always fails is worse than no button.
const editableModel = (over = {}) => ({
  prescription: { id: "RX01", meal: "Any time", status: "Active" },
  medicine: { medicine_id: "MED01", generic_name: "Amlodipine", strength: "5 mg" },
  doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }],
  photos: [
    { label: "Box", slot: "box", url: "https://example.test/box.jpg" },
    { label: "Packet front", slot: "packet_front", url: "" },
    { label: "Packet back", slot: "packet_back", url: "" },
    { label: "Pill front", slot: "pill_front", url: "" },
    { label: "Pill back", slot: "pill_back", url: "" },
  ],
  doctor: null, hospital: null, hn: "", history: [], canDelete: true,
  ...over,
});

test("renderDetail shows no editing control at all when the viewer only has View", () => {
  const html = renderDetail({ model: editableModel(), photo: 0, canEdit: false });
  for (const attr of ["data-change-dose", "data-change-schedule", "data-stop", "data-restart", "data-delete", "data-edit-medicine", "data-upload-photo", "data-remove-photo"]) {
    assert.ok(!html.includes(attr), `${attr} must not appear without Edit`);
  }
});

test("renderDetail shows the editing controls when the viewer has Edit", () => {
  const html = renderDetail({ model: editableModel(), photo: 0, canEdit: true });
  for (const attr of ["data-change-dose=\"RX01\"", "data-change-schedule=\"RX01\"", "data-stop=\"RX01\"", "data-delete=\"RX01\"", "data-edit-medicine=\"MED01\""]) {
    assert.ok(html.includes(attr), `${attr} is missing`);
  }
  assert.ok(!html.includes("data-restart"), "an active prescription offers Stop, not Restart");
});

test("renderDetail offers Restart, not Stop, for a stopped prescription", () => {
  const html = renderDetail({ model: editableModel({ prescription: { id: "RX01", meal: "Any time", status: "Stopped" } }), photo: 0, canEdit: true });
  assert.ok(html.includes('data-restart="RX01"'));
  assert.ok(!html.includes("data-stop="));
});

test("renderDetail hides Delete once a dose has been ticked (canDelete false), keeping Stop", () => {
  const html = renderDetail({ model: editableModel({ canDelete: false }), photo: 0, canEdit: true });
  assert.ok(!html.includes("data-delete"));
  assert.ok(html.includes('data-stop="RX01"'));
});

test("renderDetail gives every photo slot an upload, and only a filled one a remove", () => {
  const html = renderDetail({ model: editableModel(), photo: 0, canEdit: true });
  const uploads = html.match(/data-upload-photo="[^"]*"/g) || [];
  assert.deepEqual(uploads, [
    'data-upload-photo="MED01|box"',
    'data-upload-photo="MED01|packet_front"',
    'data-upload-photo="MED01|packet_back"',
    'data-upload-photo="MED01|pill_front"',
    'data-upload-photo="MED01|pill_back"',
  ]);
  assert.deepEqual(html.match(/data-remove-photo="[^"]*"/g) || [], ['data-remove-photo="MED01|box"']);
});

test("renderMeds offers adding a medicine only to someone with Edit", () => {
  const model = { active: [], stopped: [] };
  assert.ok(renderMeds({ model, ctx, canEdit: true }).includes("data-add-prescription"));
  assert.ok(!renderMeds({ model, ctx, canEdit: false }).includes("data-add-prescription"));
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

test("renderDoctors: no Care team access to the owner shows a share-needed note, not the generic empty note (M1)", () => {
  const noAccessCtx = {
    me: { user_id: "U03", display_name: "Top" },
    people: [
      { user_id: "U02", display_name: "Pim", medicines: "View", care_team: "" },
      { user_id: "U03", display_name: "Top", medicines: "Edit", care_team: "Edit" },
    ],
    owner: "U02",
  };
  const html = renderDoctors({ rows: [], ctx: noAccessCtx });
  assert.ok(html.includes("Pim") && html.toLowerCase().includes("shared their care team"), html);
  assert.ok(!html.includes("No doctors added"));
});

test("renderDoctors: has Care team access but genuinely no doctors yet shows the generic empty note", () => {
  const html = renderDoctors({ rows: [], ctx });
  assert.ok(html.includes("No doctors added"));
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

test("a hospital number row with a blank hn shows a dash, never a bare 'HN'", () => {
  const blankHn = { ...publicModel, hospital_numbers: [{ hospital_name: "Riverside", hn: "", phone: "" }] };
  const html = renderEmergency({ cards: [blankHn], model: blankHn, ctx: { me: { user_id: "U02" } }, publicMode: false });
  assert.ok(!html.includes("HN "), "must not render a bare 'HN ' with nothing after it");
  assert.ok(html.includes("Riverside"));
});

test("renderEmergencyEdit escapes field values and only posts whitelisted fields", () => {
  const card = { full_name: "<script>y</script>", date_of_birth: "", blood_type: "", allergies: "", conditions: "", contact1_name: "", contact1_relation: "", contact1_phone: "", contact2_name: "", contact2_relation: "", contact2_phone: "", notes: "" };
  const html = renderEmergencyEdit({ card, error: "", busy: false });
  assert.ok(!html.includes("<script>y"));
  assert.ok(html.includes("&lt;script&gt;y"));
  assert.ok(html.includes('data-form="saveEmergency"'));
});

test("renderMore lists Sheet problems (as { user_id, message } objects) and coming-soon rows", () => {
  const html = renderMore({ me: { display_name: "Dad" }, warnings: [{ user_id: "U01", message: "Prescriptions row RX99: missing user_id" }] });
  assert.ok(html.includes("missing user_id"));
  assert.ok(html.includes("Coming soon"));
  assert.ok(html.includes("data-logout"));
  assert.ok(html.includes("data-refresh"));
});
