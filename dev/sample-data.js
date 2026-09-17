// Realistic v2 family sample data for the browser mock backend (dev/mock.js) and for
// tests/mock.test.js. Same column shape as scripts/make_template_v2.py / tests/fixtures.js,
// but fuller: enough variety in Dad's prescriptions to exercise every scheduling rule from
// the browser (two dose times, every-N-days, a weekday injection, as-needed, and one stopped).
import { makePasswordRecord } from "../js/authcore.js";

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

export function sampleTables(sha256) {
  const pw = p => makePasswordRecord(p, "sample-salt", sha256);
  return {
    __columns: COLUMNS,
    Users: [
      row("Users", ["U01", "Dad", "Primary", pw("dad123"), "", "TRUE", "2024-01-01 09:00"]),
      row("Users", ["U02", "Pim", "Family", pw("pim123"), "", "TRUE", "2024-01-01 09:00"]),
      row("Users", ["U03", "Top", "Family", "", "123456", "TRUE", "2024-01-01 09:00"]),
    ],
    // Dad shares his own Medicines (Edit) and Care team (View) with the whole family (a blank
    // shared_with_user_id matches any viewer); Pim shares her own Medicines (View only) with Top.
    Sharing: [
      row("Sharing", ["SH01", "U01", "", "Medicines", "Edit", "2024-01-01 09:00", "U01"]),
      row("Sharing", ["SH02", "U01", "", "Care team", "View", "2024-01-01 09:00", "U01"]),
      row("Sharing", ["SH03", "U02", "U03", "Medicines", "View", "2024-01-01 09:00", "U02"]),
    ],
    Medicines: [
      row("Medicines", ["MED01", "Amlodipine", "Norvasc", "5 mg", "Tablet", "Blood pressure", "", "", "", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Medicines", ["MED02", "Metformin", "Glucophage", "500 mg", "Tablet", "Blood sugar", "", "", "", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Medicines", ["MED03", "Epoetin alfa", "", "4,000 IU", "Injection", "Kidneys", "Given by a nurse if unsure", "", "", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Medicines", ["MED04", "Paracetamol", "Tylenol", "500 mg", "Tablet", "Pain or fever", "", "", "", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Medicines", ["MED05", "Vitamin C", "", "1,000 mg", "Tablet", "", "", "", "", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Medicines", ["MED06", "Losartan", "Cozaar", "50 mg", "Tablet", "Blood pressure", "", "", "", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Medicines", ["MED07", "Simvastatin", "Zocor", "20 mg", "Tablet", "Cholesterol", "", "", "", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Medicines", ["MED08", "Omeprazole", "Losec", "20 mg", "Tablet", "Stomach acid", "", "", "", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Medicines", ["MED09", "Aspirin", "", "81 mg", "Tablet", "Heart", "", "", "", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Medicines", ["MED10", "Calcium carbonate", "", "500 mg", "Tablet", "Bones", "", "", "", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Medicines", ["MED11", "Cetirizine", "Zyrtec", "10 mg", "Tablet", "Allergies", "", "", "", "", "", "", "2024-01-01", "U02", "", ""]),
      row("Medicines", ["MED12", "Ibuprofen", "Advil", "400 mg", "Tablet", "Pain", "", "", "", "", "", "", "2024-01-01", "U02", "", ""]),
    ],
    Hospitals: [
      row("Hospitals", ["HOS01", "Riverside General Hospital", "02-555-0110", "88 Riverside Rd", "", "", "2024-01-01", "U01", "", ""]),
      row("Hospitals", ["HOS02", "Northgate Kidney Center", "02-555-0167", "12 Northgate Ave", "", "", "2024-01-01", "U01", "", ""]),
      row("Hospitals", ["HOS03", "Sunrise Family Clinic", "02-555-0199", "5 Sunrise St", "", "", "2024-01-01", "U02", "", ""]),
    ],
    Doctors: [
      row("Doctors", ["DOC01", "Dr. Somchai K.", "Cardiology", "02-555-0112", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Doctors", ["DOC02", "Dr. Anan S.", "Nephrology", "02-555-0168", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Doctors", ["DOC03", "Dr. Malee P.", "Endocrinology", "02-555-0113", "", "", "", "2024-01-01", "U01", "", ""]),
      row("Doctors", ["DOC04", "Dr. Preecha T.", "Family medicine", "02-555-0200", "", "", "", "2024-01-01", "U02", "", ""]),
    ],
    DoctorHospitals: [
      row("DoctorHospitals", ["DH01", "DOC01", "HOS01"]),
      row("DoctorHospitals", ["DH02", "DOC02", "HOS02"]),
      row("DoctorHospitals", ["DH03", "DOC03", "HOS01"]),
      row("DoctorHospitals", ["DH04", "DOC04", "HOS03"]),
    ],
    HospitalNumbers: [
      row("HospitalNumbers", ["HN01", "U01", "HOS01", "0045821", "", "2024-01-01", "U01", "", ""]),
      row("HospitalNumbers", ["HN02", "U01", "HOS02", "26-11873", "", "2024-01-01", "U01", "", ""]),
      row("HospitalNumbers", ["HN03", "U02", "HOS03", "PIM-4471", "", "2024-01-01", "U02", "", ""]),
    ],
    CareTeam: [
      row("CareTeam", ["CT01", "U01", "DOC01", "HOS01", "Blood pressure", "TRUE", "2024-01-01", "U01", "", ""]),
      row("CareTeam", ["CT02", "U01", "DOC02", "HOS02", "Kidneys", "TRUE", "2024-01-01", "U01", "", ""]),
      row("CareTeam", ["CT03", "U01", "DOC03", "HOS01", "Blood sugar", "TRUE", "2024-01-01", "U01", "", ""]),
      row("CareTeam", ["CT04", "U02", "DOC04", "HOS03", "Check-up", "TRUE", "2024-01-01", "U02", "", ""]),
    ],
    // Dad: 9 Active prescriptions (a Morning+Evening pair, an every-N-days, a weekday injection,
    // an as-needed, and five plain dailies) plus one Stopped. Pim: two of her own.
    Prescriptions: [
      row("Prescriptions", ["RX01", "U01", "MED01", "Daily", "", "", "", "After meal", "DOC01", "Active", "2024-01-10", "", "2024-01-10", "U01", "", ""]),
      row("Prescriptions", ["RX02", "U01", "MED02", "Daily", "", "", "", "After meal", "DOC03", "Active", "2024-01-10", "", "2024-01-10", "U01", "", ""]),
      row("Prescriptions", ["RX03", "U01", "MED03", "Weekdays", "", "Wed,Sat", "", "Any time", "DOC02", "Active", "2024-02-01", "", "2024-02-01", "U01", "", ""]),
      row("Prescriptions", ["RX04", "U01", "MED04", "As needed", "", "", "", "After meal", "DOC01", "Active", "2024-01-10", "", "2024-01-10", "U01", "", ""]),
      row("Prescriptions", ["RX05", "U01", "MED06", "Daily", "", "", "", "Before meal", "DOC01", "Active", "2024-03-01", "", "2024-03-01", "U01", "", ""]),
      row("Prescriptions", ["RX06", "U01", "MED07", "Daily", "", "", "", "Any time", "DOC01", "Active", "2024-03-01", "", "2024-03-01", "U01", "", ""]),
      row("Prescriptions", ["RX07", "U01", "MED08", "Every N days", "2", "", "2024-04-01", "Before meal", "DOC03", "Active", "2024-04-01", "", "2024-04-01", "U01", "", ""]),
      row("Prescriptions", ["RX08", "U01", "MED09", "Daily", "", "", "", "After meal", "DOC01", "Active", "2024-01-10", "", "2024-01-10", "U01", "", ""]),
      row("Prescriptions", ["RX09", "U01", "MED10", "Daily", "", "", "", "With meal", "DOC03", "Active", "2024-05-01", "", "2024-05-01", "U01", "", ""]),
      row("Prescriptions", ["RX10", "U01", "MED05", "Daily", "", "", "", "Any time", "", "Stopped", "2024-01-10", "", "2024-01-10", "U01", "", ""]),
      row("Prescriptions", ["RX11", "U02", "MED11", "Daily", "", "", "", "Any time", "DOC04", "Active", "2024-06-01", "", "2024-06-01", "U02", "", ""]),
      row("Prescriptions", ["RX12", "U02", "MED12", "As needed", "", "", "", "After meal", "DOC04", "Active", "2024-06-01", "", "2024-06-01", "U02", "", ""]),
    ],
    PrescriptionDoses: [
      row("PrescriptionDoses", ["DS01", "RX01", "Morning", "1", "tablet"]),
      row("PrescriptionDoses", ["DS02", "RX02", "Morning", "1", "tablet"]),
      row("PrescriptionDoses", ["DS03", "RX02", "Evening", "2", "tablet"]),
      row("PrescriptionDoses", ["DS04", "RX03", "Morning", "1", "injection"]),
      row("PrescriptionDoses", ["DS05", "RX05", "Morning", "1", "tablet"]),
      row("PrescriptionDoses", ["DS06", "RX06", "Bedtime", "1", "tablet"]),
      row("PrescriptionDoses", ["DS07", "RX07", "Morning", "1", "tablet"]),
      row("PrescriptionDoses", ["DS08", "RX08", "Morning", "1", "tablet"]),
      row("PrescriptionDoses", ["DS09", "RX09", "Noon", "1", "tablet"]),
      row("PrescriptionDoses", ["DS10", "RX10", "Morning", "1", "tablet"]),
      row("PrescriptionDoses", ["DS11", "RX11", "Morning", "1", "tablet"]),
    ],
    PrescriptionChanges: [
      row("PrescriptionChanges", ["CH01", "RX01", "2024-01-10 09:00", "U01", "Started", "DOC01", "High blood pressure", "", "Every day, after meal: Morning 1 tablet"]),
      row("PrescriptionChanges", ["CH02", "RX02", "2024-01-10 09:00", "U01", "Started", "DOC03", "Blood sugar", "", "Every day, after meal: Morning 1 tablet, Evening 2 tablets"]),
      row("PrescriptionChanges", ["CH03", "RX10", "2024-06-01 12:00", "U01", "Stopped", "", "Finished course", "Morning 1 tablet", ""]),
    ],
    DoseLog: [],
    EmergencyCards: [
      row("EmergencyCards", ["U01", "Somsak", "1953-04-12", "B+", "Penicillin (rash); Shellfish (hives)", "Hypertension; Diabetes; Chronic kidney disease", "Pim", "Daughter", "081-555-0142", "Top", "Son", "081-555-0198", "", "2024-01-01", "U01"]),
      row("EmergencyCards", ["U02", "Pim", "1985-09-02", "O+", "", "Seasonal allergies", "Somsak", "Father", "081-555-0100", "", "", "", "", "2024-01-01", "U02"]),
    ],
    Settings: [
      row("Settings", ["photo_folder_id", "SAMPLE_FOLDER_ID", ""]),
    ],
  };
}
