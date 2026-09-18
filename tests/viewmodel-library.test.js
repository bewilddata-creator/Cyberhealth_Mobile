// View models for the Medicine, Doctor and Hospital libraries (Task 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexBoot, medicineLibraryModel, medicineLibraryDetail, doctorLibraryModel, hospitalLibraryModel } from "../js/viewmodel.js";

// indexBoot reads exactly eight arrays (dose_log, medicines, hospitals, doctors, people,
// prescriptions, doses, changes) and throws if any is missing. The library models also reach
// through idx.boot for doctor_hospitals, care_team and hospital_numbers, so those are supplied
// too. prescriptions here are already in the normalized shape indexBoot expects (keyed by "id",
// not "prescription_id") -- these are not raw Sheet rows.
function medicine(id, generic, brand, strength, extra) {
  return Object.assign({
    medicine_id: id, generic_name: generic, brand_name: brand, strength, form: "Tablet",
    photo_box: "", photo_packet_front: "", photo_packet_back: "", photo_pill_front: "", photo_pill_back: "",
  }, extra);
}
function prescription(id, userId, medicineId, status, doctorId) {
  return {
    id, userId, medicineId, freq: "Daily", n: 0, days: [], countFrom: "", meal: "Any time",
    doctorId: doctorId || "", status, startedOn: "2026-01-01", notes: "",
  };
}

function libraryIdx() {
  return indexBoot({
    today: "2026-09-18",
    dose_log: [],
    doses: [],
    changes: [],
    medicines: [
      medicine("MED01", "Amlodipine", "Norvasc", "5 mg", { photo_pill_front: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrS/view" }),
      medicine("MED02", "Metformin", "Glucophage", "500 mg"),
      medicine("MED05", "Vitamin C", "", ""),
      medicine("MED99", "Spare", "", ""),
    ],
    doctors: [
      { doctor_id: "DOC01", name: "Dr. Somchai K.", photo: "" },
      { doctor_id: "DOC99", name: "Dr. Spare", photo: "" },
    ],
    hospitals: [
      { hospital_id: "HOS01", name: "Riverside General Hospital" },
      { hospital_id: "HOS02", name: "Northgate Kidney Center" },
      { hospital_id: "HOS99", name: "Spare Clinic" },
    ],
    people: [
      { user_id: "U01", display_name: "Dad" },
    ],
    prescriptions: [
      prescription("RX01", "U01", "MED01", "Active", "DOC01"),
      prescription("RX02", "U01", "MED05", "Stopped"),
    ],
    // The rest of these live under idx.boot, not one of indexBoot's eight normalized arrays --
    // the library models reach through idx.boot directly for them.
    doctor_hospitals: [
      { doctor_id: "DOC01", hospital_id: "HOS01" },
      { doctor_id: "DOC01", hospital_id: "HOS02" },
    ],
    care_team: [
      { user_id: "U01", doctor_id: "DOC01", hospital_id: "HOS01", active: "TRUE" },
    ],
    hospital_numbers: [
      { user_id: "U01", hospital_id: "HOS01", hn: "0045821" },
    ],
  });
}

test("medicineLibraryModel lists every medicine with who takes it, sorted by the name shown", () => {
  const idx = libraryIdx();
  const { rows } = medicineLibraryModel(idx);
  assert.deepEqual(rows.map(r => r.name), ["Glucophage (Metformin)", "Norvasc (Amlodipine)", "Spare", "Vitamin C"]);
  const norvasc = rows.find(r => r.medicine.medicine_id === "MED01");
  assert.deepEqual(norvasc.takenBy, ["Dad"]);
  assert.equal(norvasc.canDelete, false, "someone takes it");
  const vitc = rows.find(r => r.medicine.medicine_id === "MED05");
  assert.equal(vitc.canDelete, false, "a stopped course is still history");
});

test("medicineLibraryModel lets an untouched medicine be deleted", () => {
  const idx = libraryIdx();
  const spare = medicineLibraryModel(idx).rows.find(r => r.medicine.medicine_id === "MED99");
  assert.equal(spare.canDelete, true);
  assert.deepEqual(spare.takenBy, []);
});

test("medicineLibraryModel says whether an undeletable medicine is currently taken or only used to be", () => {
  const idx = libraryIdx();
  const rows = medicineLibraryModel(idx).rows;

  // MED01: an Active prescription -- takenBy already says who, so no further explanation needed.
  const norvasc = rows.find(r => r.medicine.medicine_id === "MED01");
  assert.deepEqual(norvasc.takenBy, ["Dad"]);
  assert.equal(norvasc.takenBefore, false);
  assert.equal(norvasc.canDelete, false);

  // MED05: only a Stopped prescription -- nobody takes it now, but the row must say why it can't
  // be deleted rather than showing an empty takenBy with no explanation at all.
  const vitc = rows.find(r => r.medicine.medicine_id === "MED05");
  assert.deepEqual(vitc.takenBy, []);
  assert.equal(vitc.takenBefore, true);
  assert.equal(vitc.canDelete, false);

  // MED99: never prescribed to anyone -- no current or former taker to explain.
  const spare = rows.find(r => r.medicine.medicine_id === "MED99");
  assert.deepEqual(spare.takenBy, []);
  assert.equal(spare.takenBefore, false);
  assert.equal(spare.canDelete, true);
});

test("medicineLibraryDetail gives the five photo slots in order, labelled, blank where empty", () => {
  const idx = libraryIdx();
  const d = medicineLibraryDetail(idx, "MED01");
  assert.equal(d.name, "Norvasc (Amlodipine)");
  assert.equal(d.strength, "5 mg");
  assert.equal(d.unit, "tablet", "worked out from the medicine's form");
  assert.equal(d.photos.length, 5);
  assert.deepEqual(d.photos.map(p => p.label), ["Box", "Packet front", "Packet back", "Pill front", "Pill back"]);
  assert.equal(d.photos[0].url, "", "no box photo on this fixture");
  assert.ok(d.photos[3].url, "the pill front photo is a Drive thumbnail URL");
});

// The slot, not the label, is what uploadMedicinePhoto and removeMedicinePhoto take. It travels
// with the label so no view ever has to work it back out of "Packet front" -- a label is
// presentation, somebody will reword it, and a derived slot would stop matching that same day.
test("medicineLibraryDetail sends each photo's server slot alongside its label", () => {
  const d = medicineLibraryDetail(libraryIdx(), "MED01");
  assert.deepEqual(d.photos.map(p => p.slot), ["box", "packet_front", "packet_back", "pill_front", "pill_back"]);
  assert.deepEqual(
    d.photos.map(p => `${p.label}=${p.slot}`),
    ["Box=box", "Packet front=packet_front", "Packet back=packet_back", "Pill front=pill_front", "Pill back=pill_back"],
    "each slot stays paired with its own label"
  );
});

test("medicineLibraryDetail returns null for a medicine that isn't there", () => {
  assert.equal(medicineLibraryDetail(libraryIdx(), "MED-GONE"), null);
});

test("doctorLibraryModel lists the hospitals each doctor works at, and blocks deleting a doctor in use", () => {
  const idx = libraryIdx();
  const { rows } = doctorLibraryModel(idx);
  const somchai = rows.find(r => r.doctor.doctor_id === "DOC01");
  assert.deepEqual(somchai.hospitalNames, ["Northgate Kidney Center", "Riverside General Hospital"]);
  assert.equal(somchai.canDelete, false);
  const spare = rows.find(r => r.doctor.doctor_id === "DOC99");
  assert.deepEqual(spare.hospitalNames, []);
  assert.equal(spare.canDelete, true);
});

test("hospitalLibraryModel lists the doctors at each hospital, and blocks deleting one in use", () => {
  const idx = libraryIdx();
  const { rows } = hospitalLibraryModel(idx);
  const riverside = rows.find(r => r.hospital.hospital_id === "HOS01");
  assert.deepEqual(riverside.doctorNames, ["Dr. Somchai K."]);
  assert.equal(riverside.canDelete, false, "it has hospital numbers and care team rows");
  const spare = rows.find(r => r.hospital.hospital_id === "HOS99");
  assert.equal(spare.canDelete, true);
});
