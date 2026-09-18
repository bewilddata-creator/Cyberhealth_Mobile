import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/actions.js";
import { fakeCtx, loginAs } from "./fixtures.js";

// The libraries are shared family lists with no owner: any logged-in user may edit them, and
// that is deliberate -- a medicine or a hospital is a fact about the world, not about a person.
test("addHospital stores the whitelisted fields and gives the row a server id", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "addHospital", token, fields: { name: "  Sunrise Clinic ", phone: "02-555-0199", address: "12 Rama IV", map_link: "https://maps.example/x", notes: "Parking at the back", hospital_id: "HACK" } }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.name, "Sunrise Clinic");
  assert.equal(r.data.phone, "02-555-0199");
  assert.ok(r.data.hospital_id.startsWith("HOS-"), "the id is the server's, not the caller's");
  assert.match(r.data.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(r.data.created_by, "U02");
});

test("addHospital needs a name", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "addHospital", token, fields: { phone: "02-555-0199" } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
});

test("a logged-out caller cannot touch the hospital library", () => {
  const ctx = fakeCtx();
  const r = handle({ action: "addHospital", fields: { name: "Sunrise Clinic" } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "AUTH_REQUIRED");
});

test("updateHospital changes the shared row and stamps who changed it", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "updateHospital", token, hospitalId: "HOS01", fields: { phone: "02-555-0000" } }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const row = ctx.db.rows("Hospitals").find(h => h.hospital_id === "HOS01");
  assert.equal(row.phone, "02-555-0000");
  assert.equal(row.name, "Riverside General Hospital", "an untouched field is left alone");
  assert.equal(row.updated_by, "U02");
});

test("updateHospital refuses a blank name rather than erasing it", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "updateHospital", token, hospitalId: "HOS01", fields: { name: "   " } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
  assert.equal(ctx.db.rows("Hospitals").find(h => h.hospital_id === "HOS01").name, "Riverside General Hospital");
});

test("updateHospital says so plainly when the hospital is gone", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "updateHospital", token, hospitalId: "HOS-GONE", fields: { phone: "1" } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
  assert.match(r.error.message, /list/i);
});

test("deleteHospital removes one nothing points at", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const added = handle({ action: "addHospital", token, fields: { name: "Sunrise Clinic" } }, ctx);
  const id = added.data.hospital_id;
  const r = handle({ action: "deleteHospital", token, hospitalId: id }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data, { deleted: true });
  assert.equal(ctx.db.rows("Hospitals").filter(h => h.hospital_id === id).length, 0);
});

test("deleteHospital refuses one with a hospital number, a care team row or a doctor link, and says which", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  // HOS01 has HN01/HN03 (HospitalNumbers), CT01 (CareTeam) and DH01 (DoctorHospitals).
  const r = handle({ action: "deleteHospital", token, hospitalId: "HOS01" }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CONFLICT");
  assert.match(r.error.message, /hospital number|care team|doctor/i);
  assert.equal(ctx.db.rows("Hospitals").filter(h => h.hospital_id === "HOS01").length, 1);
});

test("addDoctor stores the whitelisted fields and refuses a nameless doctor", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const ok = handle({ action: "addDoctor", token, fields: { name: " Dr. Nid P. ", specialty: "Endocrinology", phone: "02-555-0143", other_contact: "LINE: drnid", notes: "Speaks English", photo: "https://evil/x.jpg" } }, ctx);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.data.name, "Dr. Nid P.");
  assert.equal(ok.data.specialty, "Endocrinology");
  assert.equal(ok.data.photo, "", "a photo can only be set by uploading one");
  assert.ok(ok.data.doctor_id.startsWith("DOC-"));
  const bad = handle({ action: "addDoctor", token, fields: { specialty: "Endocrinology" } }, ctx);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, "BAD_INPUT");
});

test("updateDoctor changes the shared row and refuses a blank name", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  assert.equal(handle({ action: "updateDoctor", token, doctorId: "DOC01", fields: { specialty: "Cardiology and BP" } }, ctx).ok, true);
  assert.equal(ctx.db.rows("Doctors").find(d => d.doctor_id === "DOC01").specialty, "Cardiology and BP");
  const bad = handle({ action: "updateDoctor", token, doctorId: "DOC01", fields: { name: "  " } }, ctx);
  assert.equal(bad.ok, false);
  assert.equal(ctx.db.rows("Doctors").find(d => d.doctor_id === "DOC01").name, "Dr. Somchai K.");
});

test("deleteDoctor refuses one named on a prescription or a care team, and says which", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  // DOC01 is on RX01/RX04/RX05 (Prescriptions) and CT01/CT03 (CareTeam).
  const r = handle({ action: "deleteDoctor", token, doctorId: "DOC01" }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CONFLICT");
  assert.match(r.error.message, /medicine|care team/i);
  assert.equal(ctx.db.rows("Doctors").filter(d => d.doctor_id === "DOC01").length, 1);
});

test("deleteDoctor removes one nothing points at, and takes their hospital links with them", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const added = handle({ action: "addDoctor", token, fields: { name: "Dr. Nid P." } }, ctx);
  const id = added.data.doctor_id;
  assert.equal(handle({ action: "setDoctorHospitals", token, doctorId: id, hospitalIds: ["HOS01"] }, ctx).ok, true);
  assert.equal(ctx.db.rows("DoctorHospitals").filter(dh => dh.doctor_id === id).length, 1);
  const r = handle({ action: "deleteDoctor", token, doctorId: id }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ctx.db.rows("Doctors").filter(d => d.doctor_id === id).length, 0);
  assert.equal(ctx.db.rows("DoctorHospitals").filter(dh => dh.doctor_id === id).length, 0, "a link is not a record of care");
});

test("setDoctorHospitals replaces the whole set, adding and removing in one go", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  // DOC01 starts on HOS01 (DH01) and HOS02 (DH02).
  const r = handle({ action: "setDoctorHospitals", token, doctorId: "DOC01", hospitalIds: ["HOS02"] }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.hospital_ids, ["HOS02"]);
  const links = ctx.db.rows("DoctorHospitals").filter(dh => dh.doctor_id === "DOC01").map(dh => dh.hospital_id);
  assert.deepEqual(links, ["HOS02"]);
});

test("setDoctorHospitals accepts an empty list, and ignores a repeated hospital", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  assert.deepEqual(handle({ action: "setDoctorHospitals", token, doctorId: "DOC01", hospitalIds: [] }, ctx).data.hospital_ids, []);
  assert.equal(ctx.db.rows("DoctorHospitals").filter(dh => dh.doctor_id === "DOC01").length, 0);
  const again = handle({ action: "setDoctorHospitals", token, doctorId: "DOC01", hospitalIds: ["HOS01", "HOS01"] }, ctx);
  assert.deepEqual(again.data.hospital_ids, ["HOS01"]);
  assert.equal(ctx.db.rows("DoctorHospitals").filter(dh => dh.doctor_id === "DOC01").length, 1);
});

test("setDoctorHospitals refuses a hospital that isn't in the list, and writes nothing", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const before = ctx.db.rows("DoctorHospitals").filter(dh => dh.doctor_id === "DOC01").length;
  const r = handle({ action: "setDoctorHospitals", token, doctorId: "DOC01", hospitalIds: ["HOS01", "HOS-GONE"] }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
  assert.equal(ctx.db.rows("DoctorHospitals").filter(dh => dh.doctor_id === "DOC01").length, before, "all or nothing");
});
