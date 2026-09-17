// Shared test fixtures: a v2 in-memory Sheet (columns matching scripts/make_template_v2.py
// exactly) and a fake ctx every server action test builds on.
import { createHash, randomBytes } from "node:crypto";
import { memoryDb } from "../dev/memory-db.js";
import { makePasswordRecord } from "../js/authcore.js";
import { handle } from "../server/actions.js";

export const NOW = Date.parse("2026-09-15T01:00:00Z"); // Tue 15 Sep 2026, 08:00 Bangkok
export const sha256 = bytes => Array.from(createHash("sha256").update(Uint8Array.from(bytes.map(b => b & 255))).digest());

// Column lists, in order, exactly as scripts/make_template_v2.py defines each tab.
const COLUMNS = {
  Users: ["user_id", "display_name", "role", "password_hash", "reset_code", "active", "created_at"],
  Sharing: ["sharing_id", "owner_user_id", "shared_with_user_id", "section", "access", "created_at", "created_by"],
  Medicines: ["medicine_id", "generic_name", "brand_name", "strength", "form", "purpose", "notes", "photo_box", "photo_packet_front", "photo_packet_back", "photo_pill_front", "photo_pill_back", "created_at", "created_by", "updated_at", "updated_by"],
  Hospitals: ["hospital_id", "name", "phone", "address", "map_link", "notes", "created_at", "created_by", "updated_at", "updated_by"],
  Doctors: ["doctor_id", "name", "specialty", "phone", "other_contact", "photo", "notes", "created_at", "created_by", "updated_at", "updated_by"],
  DoctorHospitals: ["doctor_hospital_id", "doctor_id", "hospital_id"],
  HospitalNumbers: ["hn_id", "user_id", "hospital_id", "hn", "notes", "created_at", "created_by", "updated_at", "updated_by"],
  CareTeam: ["care_id", "user_id", "doctor_id", "hospital_id", "reason", "active", "created_at", "created_by", "updated_at", "updated_by"],
  Prescriptions: ["prescription_id", "user_id", "medicine_id", "frequency", "every_n_days", "weekdays", "count_from", "meal_timing", "doctor_id", "status", "started_on", "notes", "created_at", "created_by", "updated_at", "updated_by"],
  PrescriptionDoses: ["dose_id", "prescription_id", "time_of_day", "amount", "unit"],
  PrescriptionChanges: ["change_id", "prescription_id", "changed_at", "changed_by", "change_type", "doctor_id", "reason", "before", "after"],
  DoseLog: ["log_id", "prescription_id", "date", "time_of_day", "amount_taken", "unit", "status", "taken_at", "taken_by", "note"],
  EmergencyCards: ["user_id", "full_name", "date_of_birth", "blood_type", "allergies", "conditions", "contact1_name", "contact1_relation", "contact1_phone", "contact2_name", "contact2_relation", "contact2_phone", "notes", "updated_at", "updated_by"],
  Settings: ["key", "value", "notes"],
};

// Build a row object from positional values against a tab's column list, filling the rest "".
function row(tab, values) {
  const cols = COLUMNS[tab];
  const o = {};
  cols.forEach((c, i) => { o[c] = values[i] === undefined ? "" : String(values[i]); });
  return o;
}

export function fixtureTables() {
  const pw = p => makePasswordRecord(p, "fixture-salt", sha256);
  return {
    __columns: COLUMNS,
    Users: [
      row("Users", ["U01", "Dad", "Primary", pw("dad123"), "", "TRUE", ""]),
      row("Users", ["U02", "Pim", "Family", pw("pim123"), "", "TRUE", ""]),
      row("Users", ["U03", "Top", "Family", "", "123456", "TRUE", ""]),
      row("Users", ["U04", "Old", "Family", pw("old123"), "", "FALSE", ""]),
      row("Users", []),
    ],
    Sharing: [
      row("Sharing", ["SH01", "U01", "", "Medicines", "Edit", "", ""]),
      row("Sharing", ["SH02", "U01", "", "Care team", "View", "", ""]),
      row("Sharing", ["SH03", "U02", "U03", "Medicines", "View", "", ""]),
    ],
    Medicines: [
      row("Medicines", ["MED01", "Amlodipine", "", "5 mg", "Tablet", "Blood pressure", "", "", "", "", "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view", "", "", "", "", ""]),
      row("Medicines", ["MED02", "Metformin", "", "500 mg", "Tablet", "", "", "", "", "", "", "", "", "", "", ""]),
      row("Medicines", ["MED03", "Epoetin alfa", "", "4,000 IU", "Injection", "", "", "", "", "", "", "", "", "", "", ""]),
      row("Medicines", ["MED04", "Paracetamol", "", "500 mg", "Tablet", "", "", "", "", "", "", "", "", "", "", ""]),
      row("Medicines", ["MED05", "Vitamin C", "", "1,000 mg", "Tablet", "", "", "", "", "", "", "", "", "", "", ""]),
    ],
    Hospitals: [
      row("Hospitals", ["HOS01", "Riverside General Hospital", "02-555-0110", "", "", "", "", "", "", ""]),
      row("Hospitals", ["HOS02", "Northgate Kidney Center", "02-555-0167", "", "", "", "", "", "", ""]),
    ],
    Doctors: [
      row("Doctors", ["DOC01", "Dr. Somchai K.", "Cardiology", "02-555-0112", "", "", "", "", "", "", ""]),
      row("Doctors", ["DOC02", "Dr. Anan S.", "Nephrology", "", "", "", "", "", "", "", ""]),
    ],
    DoctorHospitals: [
      row("DoctorHospitals", ["DH01", "DOC01", "HOS01"]),
      row("DoctorHospitals", ["DH02", "DOC01", "HOS02"]),
      row("DoctorHospitals", ["DH03", "DOC02", "HOS02"]),
    ],
    HospitalNumbers: [
      row("HospitalNumbers", ["HN01", "U01", "HOS01", "0045821", "", "", "", "", ""]),
      row("HospitalNumbers", ["HN02", "U01", "HOS02", "26-11873", "", "", "", "", ""]),
      row("HospitalNumbers", ["HN03", "U02", "HOS01", "0099120", "", "", "", "", ""]),
    ],
    CareTeam: [
      row("CareTeam", ["CT01", "U01", "DOC01", "HOS01", "Blood pressure", "TRUE", "", "", "", ""]),
      row("CareTeam", ["CT02", "U01", "DOC02", "HOS02", "Kidneys", "TRUE", "", "", "", ""]),
      row("CareTeam", ["CT03", "U02", "DOC01", "HOS02", "Check-up", "TRUE", "", "", "", ""]),
    ],
    Prescriptions: [
      row("Prescriptions", ["RX01", "U01", "MED01", "Daily", "", "", "", "After meal", "DOC01", "Active", "2026-01-10", "", "", "", "", ""]),
      row("Prescriptions", ["RX02", "U01", "MED02", "Daily", "", "", "", "After meal", "DOC02", "Active", "2025-11-02", "", "", "", "", ""]),
      row("Prescriptions", ["RX03", "U01", "MED03", "Weekdays", "", "Wed", "", "Any time", "DOC02", "Active", "2026-05-06", "", "", "", "", ""]),
      row("Prescriptions", ["RX04", "U01", "MED04", "As needed", "", "", "", "After meal", "DOC01", "Active", "2026-01-10", "", "", "", "", ""]),
      row("Prescriptions", ["RX05", "U02", "MED01", "Every N days", "2", "", "2026-09-01", "Any time", "DOC01", "Active", "2026-09-01", "", "", "", "", ""]),
      row("Prescriptions", ["RX06", "U01", "MED05", "Daily", "", "", "", "Any time", "", "Stopped", "2026-02-01", "", "", "", "", ""]),
    ],
    PrescriptionDoses: [
      row("PrescriptionDoses", ["DS01", "RX01", "Morning", "2", "tablet"]),
      row("PrescriptionDoses", ["DS02", "RX02", "Morning", "1", "tablet"]),
      row("PrescriptionDoses", ["DS03", "RX02", "Evening", "2", "tablet"]),
      row("PrescriptionDoses", ["DS04", "RX03", "Morning", "1", "injection"]),
      row("PrescriptionDoses", ["DS05", "RX05", "Bedtime", "0.5", "tablet"]),
      row("PrescriptionDoses", ["DS06", "RX06", "Morning", "1", "tablet"]),
    ],
    PrescriptionChanges: [
      row("PrescriptionChanges", ["CH01", "RX01", "2026-01-10 09:00", "U02", "Started", "DOC01", "High blood pressure", "", "Every day, after meal: Morning 1 tablet"]),
      row("PrescriptionChanges", ["CH02", "RX01", "2026-03-12 10:00", "U02", "Dose changed", "DOC01", "BP still high", "Morning 1 tablet", "Morning 2 tablet"]),
      row("PrescriptionChanges", ["CH03", "RX02", "2025-11-02 09:00", "U01", "Started", "DOC02", "Blood sugar", "", "Every day, after meal: Morning 1 tablet, Evening 2 tablets"]),
      row("PrescriptionChanges", ["CH04", "RX06", "2026-06-01 12:00", "U01", "Stopped", "", "Finished", "Morning 1 tablet", ""]),
    ],
    DoseLog: [],
    EmergencyCards: [
      row("EmergencyCards", ["U01", "Somsak", "1953-04-12", "B+", "Penicillin (rash); Shellfish (hives)", "Hypertension; Diabetes", "Pim", "Daughter", "081-555-0142", "", "", "", "", "", ""]),
      row("EmergencyCards", ["U02", "Pim", "", "O+", "", "", "", "", "", "", "", "", "", "", ""]),
    ],
    Settings: [
      row("Settings", ["photo_folder_id", "SAMPLE_FOLDER_ID", ""]),
    ],
  };
}

export function fakeCtx(tables = fixtureTables()) {
  const sessions = new Map(), attempts = new Map(), idSeq = new Map();
  let clock = NOW, seq = 0;
  const db = memoryDb(tables);
  return {
    db,
    sessions: {
      get: h => sessions.get(h) || null,
      put: (h, r) => { sessions.set(h, r); },
      remove: h => { sessions.delete(h); },
      removeForUser: id => { for (const [h, r] of sessions) if (r.userId === id) sessions.delete(h); },
    },
    attempts: { get: k => attempts.get(k) || 0, incr: k => { attempts.set(k, (attempts.get(k) || 0) + 1); }, clear: k => { attempts.delete(k); } },
    sha256,
    randomToken: () => `tok${++seq}${randomBytes(8).toString("hex")}`,
    randomSalt: () => randomBytes(12).toString("base64"),
    // Deterministic ids, per prefix, so later tests can predict them: RX-000001, RX-000002, ...
    newId(prefix) {
      const n = (idSeq.get(prefix) || 0) + 1;
      idSeq.set(prefix, n);
      return `${prefix}-${String(n).padStart(6, "0")}`;
    },
    nowMs: () => clock,
    lock: fn => fn(),
    setNow: ms => { clock = ms; },
  };
}

export function loginAs(ctx, name, password) {
  const r = handle({ action: "login", name, password }, ctx);
  if (!r.ok) throw new Error(`login failed: ${r.error.message}`);
  return r.data.token;
}
