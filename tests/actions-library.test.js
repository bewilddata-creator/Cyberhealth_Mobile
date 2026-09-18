import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/actions.js";
import { fakeCtx, loginAs, withDrive } from "./fixtures.js";

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

// F2: the reference deleteDoctor used to miss. Reassigning a prescription to another doctor
// leaves the change rows naming the first one -- deleting them then leaves a history entry
// pointing at nobody, and the phone drops a name it cannot find, so the line quietly reads as if
// no doctor had ever been involved. Nothing on screen would ever say the name had been lost.
test("deleteDoctor refuses one still named on a change already recorded, and writes nothing", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const added = handle({ action: "addDoctor", token, fields: { name: "Dr. Nid P." } }, ctx);
  const id = added.data.doctor_id;
  assert.equal(handle({ action: "setDoctorHospitals", token, doctorId: id, hospitalIds: ["HOS01"] }, ctx).ok, true);
  const med = handle({ action: "addMedicine", token, fields: { generic_name: "Losartan", strength: "50 mg", form: "Tablet" } }, ctx);
  const rx = handle({
    action: "addPrescription", token, userId: "U01", medicineId: med.data.medicine_id,
    doctorId: id, frequency: "Daily", doses: [{ timeOfDay: "Morning", amount: 1 }],
  }, ctx);
  assert.equal(rx.ok, true, JSON.stringify(rx));
  // Now hand the prescription to someone else: no Prescriptions row names the first doctor any
  // more, but the "Started" change still does.
  const moved = handle({
    action: "changePrescriptionDose", token, prescriptionId: rx.data.prescription.prescription_id,
    doctorId: "DOC01", doses: [{ timeOfDay: "Morning", amount: 2 }],
  }, ctx);
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.equal(ctx.db.rows("Prescriptions").some(p => p.doctor_id === id), false, "no prescription points at them now");
  assert.equal(ctx.db.rows("PrescriptionChanges").some(c => c.doctor_id === id), true, "but a recorded change still does");

  const r = handle({ action: "deleteDoctor", token, doctorId: id }, ctx);
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.error.code, "CONFLICT");
  assert.match(r.error.message, /change|history/i);
  assert.equal(ctx.db.rows("Doctors").filter(d => d.doctor_id === id).length, 1);
  assert.equal(ctx.db.rows("DoctorHospitals").filter(dh => dh.doctor_id === id).length, 1, "a refused delete removes nothing at all");
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

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

test("deleteMedicine removes one nobody has ever been prescribed", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const added = handle({ action: "addMedicine", token, fields: { generic_name: "Losartan", strength: "50 mg", form: "Tablet" } }, ctx);
  const id = added.data.medicine_id;
  const r = handle({ action: "deleteMedicine", token, medicineId: id }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ctx.db.rows("Medicines").filter(m => m.medicine_id === id).length, 0);
});

test("deleteMedicine refuses one someone takes or used to take", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  // MED01 is on RX01 (Active); MED05 is on RX06 (Stopped) -- a stopped course is still history.
  for (const medicineId of ["MED01", "MED05"]) {
    const r = handle({ action: "deleteMedicine", token, medicineId }, ctx);
    assert.equal(r.ok, false, medicineId);
    assert.equal(r.error.code, "CONFLICT", medicineId);
    assert.equal(ctx.db.rows("Medicines").filter(m => m.medicine_id === medicineId).length, 1, medicineId);
  }
});

test("deleteMedicine trashes the photos it had", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  const added = handle({ action: "addMedicine", token, fields: { generic_name: "Losartan", form: "Tablet" } }, ctx);
  const id = added.data.medicine_id;
  const up = handle({ action: "uploadMedicinePhoto", token, medicineId: id, slot: "box", dataUrl: JPEG }, ctx);
  const r = handle({ action: "deleteMedicine", token, medicineId: id }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(drive.trashed, [up.data.url]);
});

// F1/F2: a medicine with several photos must have EVERY one attempted, even after an earlier one
// fails -- .some(url => !trash(url)) would stop at the first failure and leave the rest sitting
// in the family's Drive forever. ctx.drive.trash always returning false here, on withDrive's
// otherwise-succeeding fake, is what actually exercises the warning path (unlike the test above,
// where trash never fails and so never proves the warning branch is reachable at all).
test("deleteMedicine attempts every photo's trash even after one fails, and warns instead of failing", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  const added = handle({ action: "addMedicine", token, fields: { generic_name: "Losartan", form: "Tablet" } }, ctx);
  const id = added.data.medicine_id;
  const up1 = handle({ action: "uploadMedicinePhoto", token, medicineId: id, slot: "box", dataUrl: JPEG }, ctx);
  const up2 = handle({ action: "uploadMedicinePhoto", token, medicineId: id, slot: "packet_front", dataUrl: JPEG }, ctx);
  const attempted = [];
  ctx.drive.trash = url => { attempted.push(url); return false; };
  const r = handle({ action: "deleteMedicine", token, medicineId: id }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.data.warnings.length > 0, "a failed trash must not fail the delete");
  assert.deepEqual(attempted.sort(), [up1.data.url, up2.data.url].sort(), "every photo must be attempted, not just the first");
});

// F1: deleteDoctor landed one commit before doctors had photos. A portrait is readable by anyone
// who has the link, which is the whole reason a photo is binned when the thing it belongs to goes
// -- a doctor removed from the app with their photo left in Drive is only half removed, and
// nothing says so.
test("deleteDoctor trashes the doctor's photo", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  const added = handle({ action: "addDoctor", token, fields: { name: "Dr. Nid P." } }, ctx);
  const id = added.data.doctor_id;
  const up = handle({ action: "uploadDoctorPhoto", token, doctorId: id, dataUrl: JPEG }, ctx);
  assert.equal(up.ok, true, JSON.stringify(up));
  const r = handle({ action: "deleteDoctor", token, doctorId: id }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(drive.trashed, [up.data.url]);
});

// F1, second half: same reasoning as removeDoctorPhoto below -- withDrive's trash always succeeds,
// so only forcing it to fail proves the failure is a warning rather than a thrown error that
// would refuse a delete already done.
test("deleteDoctor's failed trash is a warning, not a failure", () => {
  const ctx = fakeCtx();
  withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  const added = handle({ action: "addDoctor", token, fields: { name: "Dr. Nid P." } }, ctx);
  const id = added.data.doctor_id;
  assert.equal(handle({ action: "uploadDoctorPhoto", token, doctorId: id, dataUrl: JPEG }, ctx).ok, true);
  ctx.drive.trash = () => false;
  const r = handle({ action: "deleteDoctor", token, doctorId: id }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.data.warnings.length > 0, "a failed trash must not fail the delete");
  assert.equal(ctx.db.rows("Doctors").filter(d => d.doctor_id === id).length, 0, "the doctor is gone either way");
});

test("uploadDoctorPhoto stores the link on the doctor, and replacing trashes the old file", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  const first = handle({ action: "uploadDoctorPhoto", token, doctorId: "DOC01", dataUrl: JPEG }, ctx);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.match(drive.created[0].folderName, /^DOC01 /);
  assert.equal(ctx.db.rows("Doctors").find(d => d.doctor_id === "DOC01").photo, first.data.url);
  const second = handle({ action: "uploadDoctorPhoto", token, doctorId: "DOC01", dataUrl: JPEG }, ctx);
  assert.equal(second.ok, true);
  assert.deepEqual(drive.trashed, [first.data.url]);
});

// F2: withDrive's trash always succeeds, so a warning path claimed by a passing test can still be
// a thrown error underneath. Forcing trash to fail is what actually proves the old file's trash
// failing is a warning, not a failure that loses the just-saved new photo.
test("uploadDoctorPhoto's failed trash of the old file is a warning, not a failure", () => {
  const ctx = fakeCtx();
  withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  const first = handle({ action: "uploadDoctorPhoto", token, doctorId: "DOC01", dataUrl: JPEG }, ctx);
  assert.equal(first.ok, true, JSON.stringify(first));
  ctx.drive.trash = () => false;
  const second = handle({ action: "uploadDoctorPhoto", token, doctorId: "DOC01", dataUrl: JPEG }, ctx);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.ok(second.data.warnings.length > 0, "a failed trash of the old file must not fail the upload");
  assert.equal(ctx.db.rows("Doctors").find(d => d.doctor_id === "DOC01").photo, second.data.url, "the new photo is still stored");
});

test("removeDoctorPhoto clears the column and trashes the file", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  const up = handle({ action: "uploadDoctorPhoto", token, doctorId: "DOC01", dataUrl: JPEG }, ctx);
  const r = handle({ action: "removeDoctorPhoto", token, doctorId: "DOC01" }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ctx.db.rows("Doctors").find(d => d.doctor_id === "DOC01").photo, "");
  assert.deepEqual(drive.trashed, [up.data.url]);
});

// F2: same reasoning as uploadDoctorPhoto above -- a trash that always succeeds cannot prove the
// warning-not-failure path exists.
test("removeDoctorPhoto's failed trash is a warning, not a failure", () => {
  const ctx = fakeCtx();
  withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  handle({ action: "uploadDoctorPhoto", token, doctorId: "DOC01", dataUrl: JPEG }, ctx);
  ctx.drive.trash = () => false;
  const r = handle({ action: "removeDoctorPhoto", token, doctorId: "DOC01" }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.data.warnings.length > 0, "a failed trash must not fail the removal");
  assert.equal(ctx.db.rows("Doctors").find(d => d.doctor_id === "DOC01").photo, "", "the column is still cleared");
});

// F4: same ordering as uploadMedicinePhoto -- the Drive upload must run before the script lock is
// taken, so a slow phone upload never holds the Sheet against the rest of the family. Comparing
// ctx.locksTaken() at the moment put() runs against the count just before handle() is what
// actually proves it; moving ctx.drive.put inside ctx.lock passes every other test here.
test("uploadDoctorPhoto creates the Drive file before taking the lock, not during it", () => {
  const ctx = fakeCtx();
  withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  const realPut = ctx.drive.put;
  let locksWhilePutRan = null;
  ctx.drive.put = (...args) => {
    locksWhilePutRan = ctx.locksTaken();
    return realPut(...args);
  };
  const before = ctx.locksTaken();
  const r = handle({ action: "uploadDoctorPhoto", token, doctorId: "DOC01", dataUrl: JPEG }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(locksWhilePutRan, before, "the script lock must not be held while the Drive upload runs");
});

test("a doctor photo must be a JPEG or PNG, and not too big", () => {
  const ctx = fakeCtx();
  withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  assert.equal(handle({ action: "uploadDoctorPhoto", token, doctorId: "DOC01", dataUrl: "data:text/html;base64,PGI+" }, ctx).error.code, "BAD_INPUT");
  const huge = `data:image/jpeg;base64,${"A".repeat(9 * 1024 * 1024)}`;
  assert.equal(handle({ action: "uploadDoctorPhoto", token, doctorId: "DOC01", dataUrl: huge }, ctx).error.code, "BAD_INPUT");
});
