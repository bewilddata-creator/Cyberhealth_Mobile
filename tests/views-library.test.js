// The three library screens and the two library forms (Task 5). These views are plain strings,
// so every assertion here is anchored on the real markup the browser gets -- the whole opening
// tag, `<button type="button" class="medrow" data-open-medicine="MED01"`, not a bare attribute
// name that could match a different element on the same page. Two tests in this repo's history
// passed against buggy code by matching text from somewhere else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMedicineLibrary, renderMedicineLibraryDetail, renderDoctorLibrary, renderHospitalLibrary } from "../js/views/libraries.js";
import { renderDoctorForm, renderHospitalForm } from "../js/views/forms.js";
import { indexBoot, medicineLibraryModel, medicineLibraryDetail, doctorLibraryModel, hospitalLibraryModel } from "../js/viewmodel.js";

const openMedicine = id => `<button type="button" class="medrow" data-open-medicine="${id}">`;
const openDoctor = id => `<button type="button" class="medrow" data-open-doctor="${id}">`;
const openHospital = id => `<button type="button" class="medrow" data-open-hospital="${id}">`;

// ---- the medicine library ----
//
// Exactly the shape medicineLibraryModel returns (js/viewmodel.js): rows of
// { medicine, name, strength, photoUrl, takenBy: [displayName], takenBefore, canDelete }.
const medRow = (id, name, strength, over) => Object.assign({
  medicine: { medicine_id: id, generic_name: name, strength, form: "Tablet", purpose: "", notes: "" },
  name, strength, photoUrl: "", takenBy: [], takenBefore: false, canDelete: true,
}, over);

const medicineModel = () => ({
  rows: [
    medRow("MED01", "Norvasc (Amlodipine)", "5 mg", { takenBy: ["Dad"], canDelete: false }),
    medRow("MED05", "Vitamin C", "", { takenBefore: true, canDelete: false }),
    medRow("MED99", "Spare", "", { canDelete: true }),
  ],
});

test("renderMedicineLibrary renders a row for every medicine, each opening its own id", () => {
  const html = renderMedicineLibrary({ model: medicineModel(), query: "" });
  assert.ok(html.includes(openMedicine("MED01")), html);
  assert.ok(html.includes(openMedicine("MED05")));
  assert.ok(html.includes(openMedicine("MED99")));
  assert.ok(html.includes("3 medicines"), "the heading says how many the list holds");
});

test("renderMedicineLibrary offers an Add button and a search box", () => {
  const html = renderMedicineLibrary({ model: medicineModel(), query: "" });
  assert.ok(html.includes(`<button type="button" class="primary light" data-add-medicine>`), html);
  assert.ok(html.includes(`data-library-search`));
});

test("renderMedicineLibrary's search keeps only the rows whose shown name matches, and keeps what was typed", () => {
  const html = renderMedicineLibrary({ model: medicineModel(), query: "vitamin" });
  assert.ok(html.includes(openMedicine("MED05")), "Vitamin C matches");
  assert.ok(!html.includes(openMedicine("MED01")), "Norvasc must be filtered out");
  assert.ok(!html.includes(openMedicine("MED99")), "Spare must be filtered out");
  assert.ok(html.includes(`value="vitamin"`), "the box still shows what was typed");
});

test("renderMedicineLibrary matches the brand a search types, because that is the name shown", () => {
  const html = renderMedicineLibrary({ model: medicineModel(), query: "norvasc" });
  assert.ok(html.includes(openMedicine("MED01")));
  assert.ok(!html.includes(openMedicine("MED05")));
});

test("renderMedicineLibrary says so plainly when a search matches nothing", () => {
  const html = renderMedicineLibrary({ model: medicineModel(), query: "zzz" });
  assert.ok(!html.includes(`class="medrow"`), "no rows at all");
  assert.ok(html.includes("Nothing here matches “zzz”."), html);
});

// A destructive control has no business on a list he scrolls with a thumb. Removing a medicine
// lives on its detail screen, exactly as the Meds list leaves Delete to the prescription detail.
// MED99 is the dangerous case: the server WOULD let it go, so a stray Delete here would work.
test("renderMedicineLibrary puts no delete control on any row, not even one the server would let go", () => {
  const html = renderMedicineLibrary({ model: medicineModel(), query: "" });
  assert.ok(!html.includes("data-delete-medicine"), html);
  assert.ok(!html.includes("rowdelete"), "no row-level destructive button of any kind");
  assert.ok(html.includes(openMedicine("MED99")), "the deletable one is still on the list, just not deletable from here");
});

// takenBefore exists precisely so this row can explain itself: no current taker, no Delete
// button, and without the line no reason for either.
test("renderMedicineLibrary explains a medicine that is only in the list because it was taken before", () => {
  const html = renderMedicineLibrary({ model: medicineModel(), query: "" });
  assert.ok(html.includes(`<div class="s">Taken before — kept so the older records still read right</div>`), html);
  assert.ok(html.includes(`<div class="s">Taken by Dad</div>`), "a current taker is named instead");
});

test("renderMedicineLibrary escapes a malicious medicine name and strength in the row", () => {
  const model = { rows: [medRow("MED01", `<script>alert(1)</script>`, `"5 mg"`, { canDelete: true })] };
  const html = renderMedicineLibrary({ model, query: "" });
  assert.ok(!html.includes("<script>"), html);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&quot;5 mg&quot;"));
});

test("renderMedicineLibrary escapes what was typed into the search box", () => {
  const html = renderMedicineLibrary({ model: { rows: [] }, query: `"><script>x</script>` });
  assert.ok(!html.includes("<script>x"), html);
  assert.ok(html.includes("&quot;&gt;&lt;script&gt;"));
});

test("renderMedicineLibrary invites the first medicine when the list is empty", () => {
  const html = renderMedicineLibrary({ model: { rows: [] }, query: "" });
  assert.ok(html.includes("Nothing in this list yet"), html);
  assert.ok(html.includes("Tap “Add a medicine to the list” to put the first one in."));
});

// ---- one medicine, in full ----
//
// medicineLibraryDetail's shape: { medicine, name, strength, unit, photos: [{label, slot, url}],
// takenBy: [{userId, displayName}], takenBefore, canDelete }.
const detailModel = over => Object.assign({
  medicine: { medicine_id: "MED01", generic_name: "Amlodipine", brand_name: "Norvasc", strength: "5 mg", form: "Tablet", purpose: "Blood pressure", notes: "" },
  name: "Norvasc (Amlodipine)", strength: "5 mg", unit: "tablet",
  photos: [
    { label: "Box", slot: "box", url: "https://example.test/box.jpg" },
    { label: "Packet front", slot: "packet_front", url: "" },
    { label: "Packet back", slot: "packet_back", url: "" },
    { label: "Pill front", slot: "pill_front", url: "" },
    { label: "Pill back", slot: "pill_back", url: "" },
  ],
  takenBy: [{ userId: "U01", displayName: "Dad" }], takenBefore: false, canDelete: false,
}, over);

test("renderMedicineLibraryDetail gives all five photo slots an upload, and only a filled one a remove", () => {
  const html = renderMedicineLibraryDetail({ model: detailModel(), photo: 0 });
  assert.deepEqual(html.match(/data-upload-photo="[^"]*"/g) || [], [
    'data-upload-photo="MED01|box"',
    'data-upload-photo="MED01|packet_front"',
    'data-upload-photo="MED01|packet_back"',
    'data-upload-photo="MED01|pill_front"',
    'data-upload-photo="MED01|pill_back"',
  ]);
  assert.deepEqual(html.match(/data-remove-photo="[^"]*"/g) || [], ['data-remove-photo="MED01|box"']);
});

test("renderMedicineLibraryDetail shows who takes it, the unit its form implies, and an Edit button", () => {
  const html = renderMedicineLibraryDetail({ model: detailModel(), photo: 0 });
  assert.ok(html.includes(`<button type="button" class="primary light" data-edit-medicine="MED01">Edit details</button>`), html);
  assert.ok(html.includes("<dt>Doses are counted in</dt><dd>tablets</dd>"));
  assert.ok(html.includes("<dt>What it&#39;s for</dt><dd>Blood pressure</dd>"));
  assert.ok(html.includes("<p>Dad</p>"));
});

test("renderMedicineLibraryDetail hides Delete, and says why, while something still names the medicine", () => {
  const html = renderMedicineLibraryDetail({ model: detailModel({ canDelete: false }), photo: 0 });
  assert.ok(!html.includes("data-delete-medicine"), html);
  assert.ok(html.includes("can&#39;t be removed while somebody takes it"));
});

// The one screen a medicine is ever deleted from gets the same ruled-off section the doctor and
// hospital forms do -- not a red-lettered pill 8px under Edit details.
test("renderMedicineLibraryDetail offers Delete in its own ruled-off section, well clear of Edit details", () => {
  const html = renderMedicineLibraryDetail({ model: detailModel({ canDelete: true }), photo: 0 });
  assert.ok(html.includes(`<div class="dangerzone"><span class="dash">Removing this</span>`), html);
  assert.ok(html.includes(`<button type="button" class="primary light danger" data-delete-medicine="MED01">Delete this medicine</button>`));
  assert.ok(!html.includes(`data-edit-medicine="MED01">Edit details</button>\n      <button`), "Delete must not sit inside the same button group as Edit");
  assert.ok(html.indexOf("data-delete-medicine") > html.indexOf("dangerzone"), "the Delete is inside the ruled-off section");
});

test("renderMedicineLibraryDetail explains a medicine kept only because it was taken before", () => {
  const html = renderMedicineLibraryDetail({ model: detailModel({ takenBy: [], takenBefore: true }), photo: 0 });
  assert.ok(html.includes("It was taken before, and it stays in the list so the older records still read right."), html);
});

test("renderMedicineLibraryDetail escapes the medicine's own fields", () => {
  const html = renderMedicineLibraryDetail({
    model: detailModel({ name: `<img src=x onerror=alert(1)>`, medicine: { medicine_id: "MED01", purpose: `<b>bad</b>`, notes: "", form: "Tablet" } }),
    photo: 0,
  });
  assert.ok(!html.includes("<img src=x"), html);
  assert.ok(!html.includes("<b>bad</b>"));
  assert.ok(html.includes("&lt;img src=x"));
});

test("renderMedicineLibraryDetail returns a friendly note, not 'undefined', for a medicine that has gone", () => {
  const html = renderMedicineLibraryDetail({ model: null, photo: 0 });
  assert.ok(!html.includes("undefined"), html);
  assert.ok(html.includes("isn't in the list any more"));
});

// ---- the doctor library ----
//
// doctorLibraryModel's shape: rows of { doctor, hospitalNames, photoUrl, canDelete }.
const docRow = (id, name, over) => Object.assign({
  doctor: { doctor_id: id, name, specialty: "", phone: "", photo: "" },
  hospitalNames: [], photoUrl: "", canDelete: true,
}, over);

const doctorModel = () => ({
  rows: [
    docRow("DOC01", "Dr. Somchai K.", { doctor: { doctor_id: "DOC01", name: "Dr. Somchai K.", specialty: "Heart", phone: "02-555-0112" }, hospitalNames: ["Riverside General Hospital"], canDelete: false }),
    docRow("DOC99", "Dr. Spare", { canDelete: true }),
  ],
});

test("renderDoctorLibrary renders a row for every doctor, with their specialty and where they work", () => {
  const html = renderDoctorLibrary({ model: doctorModel(), query: "" });
  assert.ok(html.includes(openDoctor("DOC01")), html);
  assert.ok(html.includes(openDoctor("DOC99")));
  assert.ok(html.includes(`<span class="spec">Heart</span>`));
  assert.ok(html.includes("Sees patients at Riverside General Hospital"));
  assert.ok(html.includes("2 doctors"));
});

test("renderDoctorLibrary offers an Add button and a search box", () => {
  const html = renderDoctorLibrary({ model: doctorModel(), query: "" });
  assert.ok(html.includes(`<button type="button" class="primary light" data-add-doctor>`), html);
  assert.ok(html.includes("data-library-search"));
});

test("renderDoctorLibrary's search keeps only the doctors whose name matches", () => {
  const html = renderDoctorLibrary({ model: doctorModel(), query: "somchai" });
  assert.ok(html.includes(openDoctor("DOC01")));
  assert.ok(!html.includes(openDoctor("DOC99")), html);
});

// DOC99 is the dangerous case: the server would let it go, so a Delete left on the row would
// actually fire. Removing a doctor lives at the foot of their edit form instead.
test("renderDoctorLibrary puts no delete control on any row, not even one the server would let go", () => {
  const html = renderDoctorLibrary({ model: doctorModel(), query: "" });
  assert.ok(!html.includes("data-delete-doctor"), html);
  assert.ok(!html.includes("rowdelete"), "no row-level destructive button of any kind");
  assert.ok(html.includes(openDoctor("DOC99")), "the deletable one is still on the list, just not deletable from here");
});

test("renderDoctorLibrary escapes a malicious doctor name and specialty", () => {
  const model = { rows: [docRow("DOC01", "x", { doctor: { doctor_id: "DOC01", name: `<script>x</script>`, specialty: `<em>y</em>` } })] };
  const html = renderDoctorLibrary({ model, query: "" });
  assert.ok(!html.includes("<script>x"), html);
  assert.ok(!html.includes("<em>y</em>"));
  assert.ok(html.includes("&lt;script&gt;x"));
});

// ---- the hospital library ----
//
// hospitalLibraryModel's shape: rows of { hospital, doctorNames, canDelete }.
const hosRow = (id, name, over) => Object.assign({
  hospital: { hospital_id: id, name, phone: "", address: "", map_link: "", notes: "" },
  doctorNames: [], canDelete: true,
}, over);

const hospitalModel = () => ({
  rows: [
    hosRow("HOS01", "Riverside General Hospital", { hospital: { hospital_id: "HOS01", name: "Riverside General Hospital", phone: "02-555-0110" }, doctorNames: ["Dr. Somchai K."], canDelete: false }),
    hosRow("HOS99", "Spare Clinic", { canDelete: true }),
  ],
});

test("renderHospitalLibrary renders a row for every place, showing its phone number", () => {
  const html = renderHospitalLibrary({ model: hospitalModel(), query: "" });
  assert.ok(html.includes(openHospital("HOS01")), html);
  assert.ok(html.includes(openHospital("HOS99")));
  assert.ok(html.includes(`<div class="s">02-555-0110</div>`));
  assert.ok(html.includes(`<div class="s">No phone number saved yet</div>`), "a place with no number says so");
  assert.ok(html.includes("2 places"));
});

test("renderHospitalLibrary offers an Add button and a search box", () => {
  const html = renderHospitalLibrary({ model: hospitalModel(), query: "" });
  assert.ok(html.includes(`<button type="button" class="primary light" data-add-hospital>`), html);
  assert.ok(html.includes("data-library-search"));
});

test("renderHospitalLibrary's search keeps only the places whose name matches", () => {
  const html = renderHospitalLibrary({ model: hospitalModel(), query: "spare" });
  assert.ok(html.includes(openHospital("HOS99")));
  assert.ok(!html.includes(openHospital("HOS01")), html);
});

// HOS99 is the dangerous case: the server would let it go. Removing a place lives at the foot of
// its edit form instead.
test("renderHospitalLibrary puts no delete control on any row, not even one the server would let go", () => {
  const html = renderHospitalLibrary({ model: hospitalModel(), query: "" });
  assert.ok(!html.includes("data-delete-hospital"), html);
  assert.ok(!html.includes("rowdelete"), "no row-level destructive button of any kind");
  assert.ok(html.includes(openHospital("HOS99")), "the deletable one is still on the list, just not deletable from here");
});

test("renderHospitalLibrary escapes a malicious hospital name and phone", () => {
  const model = { rows: [hosRow("HOS01", "x", { hospital: { hospital_id: "HOS01", name: `<script>x</script>`, phone: `<b>02</b>` } })] };
  const html = renderHospitalLibrary({ model, query: "" });
  assert.ok(!html.includes("<script>x"), html);
  assert.ok(!html.includes("<b>02</b>"));
  assert.ok(html.includes("&lt;script&gt;x"));
});

// ---- the two forms ----

const doctorFormModel = over => Object.assign({
  doctorId: "DOC01",
  doctor: { doctor_id: "DOC01", name: "Dr. Somchai K.", specialty: "Heart", phone: "02-555-0112", other_contact: "LINE: somchai", notes: "Speaks English" },
  photoUrl: "",
  hospitals: [
    { hospital_id: "HOS01", name: "Riverside General Hospital" },
    { hospital_id: "HOS02", name: "Northgate Kidney Center" },
  ],
  hospitalIds: ["HOS01"],
}, over);

test("renderDoctorForm posts the server's own field names, under data-form=\"doctor\"", () => {
  const html = renderDoctorForm({ model: doctorFormModel(), error: "", busy: false });
  assert.ok(html.includes(`<form class="edit-form" data-form="doctor">`), html);
  assert.ok(html.includes(`<input type="hidden" name="doctorId" value="DOC01">`));
  for (const [name, value] of [["name", "Dr. Somchai K."], ["specialty", "Heart"], ["phone", "02-555-0112"], ["other_contact", "LINE: somchai"]]) {
    assert.ok(html.includes(`name="${name}" value="${value}"`), `${name} is missing or not filled in`);
  }
  assert.ok(html.includes(`<textarea id="f-doc-notes" name="notes" rows="3">Speaks English</textarea>`));
});

test("renderDoctorForm renders one hospital checkbox per hospital, all named hospitalIds, the current ones ticked", () => {
  const html = renderDoctorForm({ model: doctorFormModel(), error: "", busy: false });
  assert.ok(html.includes(`<input type="checkbox" name="hospitalIds" value="HOS01" checked>`), html);
  assert.ok(html.includes(`<input type="checkbox" name="hospitalIds" value="HOS02" >`), "HOS02 is not one of theirs");
  assert.equal((html.match(/name="hospitalIds"/g) || []).length, 2);
  assert.ok(html.includes("Riverside General Hospital") && html.includes("Northgate Kidney Center"));
});

test("renderDoctorForm escapes everything the doctor row holds, including the hospital names", () => {
  const html = renderDoctorForm({
    model: doctorFormModel({
      doctor: { doctor_id: "DOC01", name: `"><script>alert(1)</script>`, specialty: "", phone: "", other_contact: "", notes: `<b>x</b>` },
      hospitals: [{ hospital_id: "HOS01", name: `<i>clinic</i>` }],
    }),
    error: "", busy: false,
  });
  assert.ok(!html.includes("<script>alert"), html);
  assert.ok(!html.includes("<b>x</b>"));
  assert.ok(!html.includes("<i>clinic</i>"));
  assert.ok(html.includes("&lt;script&gt;alert"));
});

test("renderDoctorForm shows the error line and kills the save button while a save is in flight", () => {
  const withError = renderDoctorForm({ model: doctorFormModel(), error: "A doctor needs a name.", busy: false });
  assert.ok(withError.includes(`<p class="err" role="alert">A doctor needs a name.</p>`), withError);
  const busy = renderDoctorForm({ model: doctorFormModel(), error: "", busy: true });
  assert.ok(busy.includes(`<button class="primary" disabled>Saving…</button>`), busy);
});

test("renderDoctorForm offers photo buttons for a saved doctor and explains their absence for a new one", () => {
  const saved = renderDoctorForm({ model: doctorFormModel({ photoUrl: "https://example.test/doc.jpg" }), error: "", busy: false });
  assert.ok(saved.includes(`<button type="button" data-upload-doctor-photo="DOC01">Replace</button>`), saved);
  assert.ok(saved.includes(`<button type="button" class="danger" data-remove-doctor-photo="DOC01">Remove</button>`));
  const fresh = renderDoctorForm({ model: { doctor: {}, hospitals: [], hospitalIds: [] }, error: "", busy: false });
  assert.ok(!fresh.includes("data-upload-doctor-photo"), fresh);
  assert.ok(fresh.includes("once they're saved"));
});

// Removing a doctor lives at the foot of the form that opens them -- outside the <form>, so it
// can never be taken for Save -- and only when the server would allow it.
test("renderDoctorForm offers Delete, outside the form, when the model says canDelete", () => {
  const html = renderDoctorForm({ model: doctorFormModel({ canDelete: true }), error: "", busy: false });
  assert.ok(html.includes(`<button type="button" class="primary light danger" data-delete-doctor="DOC01">Delete this doctor</button>`), html);
  assert.ok(html.indexOf("data-delete-doctor") > html.indexOf("</form>"), "it must sit after the form, not inside it");
});

test("renderDoctorForm offers no Delete at all, and says what is holding the doctor, when canDelete is false", () => {
  const html = renderDoctorForm({ model: doctorFormModel({ canDelete: false }), error: "", busy: false });
  assert.ok(!html.includes("data-delete-doctor"), html);
  assert.ok(html.includes("can&#39;t be removed while they&#39;re named on a medicine somebody takes"), html);
});

// "Nobody worked it out" is not "the server said no". A model that arrives without canDelete --
// a caller that forgot to pass it -- must not go on to assert a specific reason the doctor can't
// be removed, because that reason may simply not be true.
test("renderDoctorForm claims no reason at all when canDelete was never worked out", () => {
  for (const missing of [{}, { canDelete: undefined }, { canDelete: null }]) {
    const html = renderDoctorForm({ model: doctorFormModel(missing), error: "", busy: false });
    assert.ok(!html.includes("data-delete-doctor"), "no button it cannot stand behind");
    assert.ok(!html.includes("can&#39;t be removed while"), `must not state a reason it doesn't know: ${JSON.stringify(missing)}`);
    assert.ok(!html.includes("dangerzone"), "no Removing-this section at all");
  }
});

test("renderHospitalForm claims no reason at all when canDelete was never worked out", () => {
  for (const missing of [{}, { canDelete: undefined }, { canDelete: null }]) {
    const html = renderHospitalForm({ model: hospitalFormModel(missing), error: "", busy: false });
    assert.ok(!html.includes("data-delete-hospital"));
    assert.ok(!html.includes("can&#39;t be removed while"), `must not state a reason it doesn't know: ${JSON.stringify(missing)}`);
    assert.ok(!html.includes("dangerzone"));
  }
});

test("renderDoctorForm offers no Delete on a doctor that has not been saved yet", () => {
  const html = renderDoctorForm({ model: { doctor: {}, hospitals: [], hospitalIds: [], canDelete: true }, error: "", busy: false });
  assert.ok(!html.includes("data-delete-doctor"), html);
  assert.ok(!html.includes("dangerzone"), "nothing to remove yet, so no section for it");
});

test("renderDoctorForm says where to add a hospital when there are none to tick yet", () => {
  const html = renderDoctorForm({ model: { doctor: {}, hospitals: [], hospitalIds: [] }, error: "", busy: false });
  assert.ok(!html.includes(`name="hospitalIds"`), html);
  assert.ok(html.includes("no hospitals or clinics in the list yet"));
});

const hospitalFormModel = over => Object.assign({
  hospitalId: "HOS01",
  hospital: { hospital_id: "HOS01", name: "Riverside General Hospital", phone: "02-555-0110", address: "12 River Rd", map_link: "https://maps.example.test/r", notes: "Park at the back" },
}, over);

test("renderHospitalForm posts the server's own field names, under data-form=\"hospital\"", () => {
  const html = renderHospitalForm({ model: hospitalFormModel(), error: "", busy: false });
  assert.ok(html.includes(`<form class="edit-form" data-form="hospital">`), html);
  assert.ok(html.includes(`<input type="hidden" name="hospitalId" value="HOS01">`));
  assert.ok(html.includes(`name="name" value="Riverside General Hospital"`));
  assert.ok(html.includes(`name="phone" value="02-555-0110"`));
  assert.ok(html.includes(`name="map_link" value="https://maps.example.test/r"`));
  assert.ok(html.includes(`<textarea id="f-hos-address" name="address" rows="2">12 River Rd</textarea>`));
  assert.ok(html.includes(`<textarea id="f-hos-notes" name="notes" rows="2">Park at the back</textarea>`));
});

test("renderHospitalForm offers Delete, outside the form, when the model says canDelete", () => {
  const html = renderHospitalForm({ model: hospitalFormModel({ canDelete: true }), error: "", busy: false });
  assert.ok(html.includes(`<button type="button" class="primary light danger" data-delete-hospital="HOS01">Delete this place</button>`), html);
  assert.ok(html.indexOf("data-delete-hospital") > html.indexOf("</form>"), "it must sit after the form, not inside it");
});

test("renderHospitalForm offers no Delete at all, and says what is holding the place, when canDelete is false", () => {
  const html = renderHospitalForm({ model: hospitalFormModel({ canDelete: false }), error: "", busy: false });
  assert.ok(!html.includes("data-delete-hospital"), html);
  assert.ok(html.includes("can&#39;t be removed while somebody&#39;s hospital number"), html);
});

test("renderHospitalForm offers no Delete on a place that has not been saved yet", () => {
  const html = renderHospitalForm({ model: { hospital: {}, canDelete: true }, error: "", busy: false });
  assert.ok(!html.includes("data-delete-hospital"), html);
  assert.ok(!html.includes("dangerzone"));
});

test("renderHospitalForm escapes every value it was handed", () => {
  const html = renderHospitalForm({
    model: hospitalFormModel({ hospital: { hospital_id: "HOS01", name: `"><script>alert(1)</script>`, phone: "", address: `<b>x</b>`, map_link: "", notes: "" } }),
    error: "", busy: false,
  });
  assert.ok(!html.includes("<script>alert"), html);
  assert.ok(!html.includes("<b>x</b>"));
  assert.ok(html.includes("&lt;script&gt;alert"));
});

test("renderHospitalForm shows the error line and kills the save button while a save is in flight", () => {
  const withError = renderHospitalForm({ model: hospitalFormModel(), error: "A hospital or clinic needs a name.", busy: false });
  assert.ok(withError.includes(`<p class="err" role="alert">A hospital or clinic needs a name.</p>`), withError);
  const busy = renderHospitalForm({ model: hospitalFormModel(), error: "", busy: true });
  assert.ok(busy.includes(`<button class="primary" disabled>Saving…</button>`), busy);
});

// ---- the views against the real view models ----
//
// Every fixture above is hand-written, so it can drift from what Task 4 actually returns. This
// one feeds the genuine models straight into the views: if a field is ever renamed, these fail
// instead of the screens quietly going blank on somebody's phone.
function libraryIdx() {
  return indexBoot({
    today: "2026-09-18",
    dose_log: [], doses: [], changes: [],
    medicines: [
      { medicine_id: "MED01", generic_name: "Amlodipine", brand_name: "Norvasc", strength: "5 mg", form: "Tablet", photo_box: "", photo_packet_front: "", photo_packet_back: "", photo_pill_front: "", photo_pill_back: "" },
      { medicine_id: "MED99", generic_name: "Spare", brand_name: "", strength: "", form: "Tablet", photo_box: "", photo_packet_front: "", photo_packet_back: "", photo_pill_front: "", photo_pill_back: "" },
    ],
    doctors: [{ doctor_id: "DOC01", name: "Dr. Somchai K.", specialty: "Heart", phone: "", photo: "" }],
    hospitals: [{ hospital_id: "HOS01", name: "Riverside General Hospital", phone: "02-555-0110" }],
    people: [{ user_id: "U01", display_name: "Dad" }],
    prescriptions: [{ id: "RX01", userId: "U01", medicineId: "MED01", freq: "Daily", n: 0, days: [], countFrom: "", meal: "Any time", doctorId: "DOC01", status: "Active", startedOn: "2026-01-01", notes: "" }],
    doctor_hospitals: [{ doctor_id: "DOC01", hospital_id: "HOS01" }],
    care_team: [], hospital_numbers: [],
  });
}

test("the three lists render from the real view models, right down to who takes what", () => {
  const idx = libraryIdx();
  const meds = renderMedicineLibrary({ model: medicineLibraryModel(idx), query: "" });
  assert.ok(meds.includes(openMedicine("MED01")), meds);
  assert.ok(meds.includes(openMedicine("MED99")));
  assert.ok(meds.includes(`<div class="s">Taken by Dad</div>`), "the real model's takenBy reaches the row");
  assert.ok(!meds.includes("data-delete-medicine"), "no delete on the list, whatever canDelete says");

  const docs = renderDoctorLibrary({ model: doctorLibraryModel(idx), query: "" });
  assert.ok(docs.includes(openDoctor("DOC01")), docs);
  assert.ok(docs.includes("Sees patients at Riverside General Hospital"));
  assert.ok(!docs.includes("data-delete-doctor"), "no delete on the list");

  const hospitals = renderHospitalLibrary({ model: hospitalLibraryModel(idx), query: "" });
  assert.ok(hospitals.includes(openHospital("HOS01")), hospitals);
  assert.ok(hospitals.includes("Doctors here: Dr. Somchai K."));
  assert.ok(!hospitals.includes("data-delete-hospital"), "no delete on the list");
});

// The slot the photo buttons send is the model's, never something the view worked back out of
// the label. Feeding the real medicineLibraryDetail through is what proves it: if the view were
// deriving slots from labels again, rewording a label would break these buttons silently.
test("the medicine detail's photo buttons carry the slots the real view model supplies", () => {
  const html = renderMedicineLibraryDetail({ model: medicineLibraryDetail(libraryIdx(), "MED01"), photo: 0 });
  assert.deepEqual(html.match(/data-upload-photo="[^"]*"/g) || [], [
    'data-upload-photo="MED01|box"',
    'data-upload-photo="MED01|packet_front"',
    'data-upload-photo="MED01|packet_back"',
    'data-upload-photo="MED01|pill_front"',
    'data-upload-photo="MED01|pill_back"',
  ]);
});

// A model whose photos carry no slot at all must render no photo buttons, rather than buttons
// that would send "MED01|" to the server.
test("the medicine detail renders no photo buttons for a photo with no slot", () => {
  const html = renderMedicineLibraryDetail({ model: detailModel({ photos: [{ label: "Box", url: "" }] }), photo: 0 });
  assert.ok(!html.includes("data-upload-photo"), html);
  assert.ok(html.includes("<strong>Box</strong>"), "the slot is still shown, just with nothing to press");
});
