// Run checkSheet from the Apps Script editor (select it, press Run) to find setup mistakes
// before anyone uses the app. Read-only: it never writes to the Sheet.
//
// Apps Script loads .gs files in an unspecified order, so nothing at the top level of this
// file may depend on a name from another file -- only code inside a function body may, since
// that only runs once every file has finished loading. That is why the required-column list
// lives in a function instead of a top-level constant.
function requiredColumns_() {
  return {
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
}

// Reads a tab with the Sheet's own range API only -- not SheetDb, which throws on a missing
// tab or column. A checker must survive exactly the half-built Sheets it exists to diagnose,
// and must never write anything back. Returns null when the tab itself is missing.
function readTab_(book, tab) {
  const sh = book.getSheetByName(tab);
  if (!sh) return null;
  const width = sh.getLastColumn();
  const last = sh.getLastRow();
  const headers = width ? sh.getRange(1, 1, 1, width).getDisplayValues()[0].map(h => String(h).trim()) : [];
  if (last < 2 || !headers.length) return { headers, rows: [] };
  const display = sh.getRange(2, 1, last - 1, headers.length).getDisplayValues();
  const rows = display.map((r, i) => {
    const o = { _row: i + 2 };
    headers.forEach((h, j) => { if (h) o[h] = String(r[j] == null ? "" : r[j]).trim(); });
    return o;
  });
  return { headers, rows };
}

// A spacer row left blank on purpose (openpyxl example rows, or just extra room) -- every
// column empty. Every other check should silently skip these, the same way bootstrap does.
function blankRow_(row) {
  return Object.keys(row).every(k => k === "_row" || String(row[k] || "") === "");
}

// Names a row by its own key column, falling back to its sheet row number when the key
// itself is blank (so a row that is broken in more than one way can still be pointed at).
function rowLabel_(tab, row) {
  const key = requiredColumns_()[tab][0];
  const id = String(row[key] || "").trim();
  return id || `sheet row ${row._row}`;
}

function checkSheet() {
  const book = SpreadsheetApp.getActive();
  const required = requiredColumns_();
  const problems = [];
  const tabs = {};

  Object.keys(required).forEach(tab => {
    const info = readTab_(book, tab);
    if (!info) {
      problems.push(`Missing tab: "${tab}".`);
      tabs[tab] = { headers: [], rows: [] };
      return;
    }
    required[tab].forEach(col => { if (info.headers.indexOf(col) < 0) problems.push(`${tab} is missing the "${col}" column.`); });
    tabs[tab] = info;
  });

  const rowsOf = tab => tabs[tab].rows;

  // Duplicate keys, in every tab -- blank keys don't count (that is a missing-field problem,
  // reported separately for the tabs it matters in).
  Object.keys(required).forEach(tab => {
    const key = required[tab][0];
    const seen = {};
    rowsOf(tab).forEach(row => {
      if (blankRow_(row)) return;
      const id = String(row[key] || "").trim();
      if (!id) return;
      if (seen[id]) problems.push(`${tab} has two rows with "${id}".`);
      seen[id] = true;
    });
  });

  // Bootstrap-style warnings: the same normalizers the app itself uses to decide what is
  // safe to show, so a row that would silently vanish from the app is called out here.
  rowsOf("Prescriptions").forEach(row => {
    if (blankRow_(row)) return;
    const result = normalizePrescription(row);
    if (!result.ok) problems.push(`Prescriptions row ${result.id || `sheet row ${row._row}`}: ${result.reason}`);
  });
  rowsOf("PrescriptionDoses").forEach(row => {
    if (blankRow_(row)) return;
    const result = normalizeDose(row);
    if (!result.ok) problems.push(`PrescriptionDoses row ${result.id || `sheet row ${row._row}`}: ${result.reason}`);
  });

  // Broken references, named by the row that holds the broken id.
  const checkReferences_ = (tab, refs) => {
    rowsOf(tab).forEach(row => {
      if (blankRow_(row)) return;
      refs.forEach(([col, targetTab]) => {
        const val = String(row[col] || "").trim();
        if (!val) return;
        const targetKey = required[targetTab][0];
        const known = rowsOf(targetTab).some(t => String(t[targetKey] || "").trim() === val);
        if (!known) problems.push(`${tab} row ${rowLabel_(tab, row)}: ${col} "${val}" is not in ${targetTab}.`);
      });
    });
  };
  checkReferences_("Prescriptions", [["user_id", "Users"], ["medicine_id", "Medicines"], ["doctor_id", "Doctors"]]);
  checkReferences_("PrescriptionDoses", [["prescription_id", "Prescriptions"]]);
  // A change row names the doctor who made the change. The app drops a doctor id it cannot find,
  // so a history entry pointing at a deleted doctor loses the name silently rather than showing
  // anything wrong -- which is exactly why it has to be said here.
  checkReferences_("PrescriptionChanges", [["prescription_id", "Prescriptions"], ["doctor_id", "Doctors"]]);
  checkReferences_("CareTeam", [["user_id", "Users"], ["doctor_id", "Doctors"], ["hospital_id", "Hospitals"]]);
  checkReferences_("HospitalNumbers", [["user_id", "Users"], ["hospital_id", "Hospitals"]]);
  checkReferences_("DoctorHospitals", [["doctor_id", "Doctors"], ["hospital_id", "Hospitals"]]);
  checkReferences_("EmergencyCards", [["user_id", "Users"]]);

  // A date typed the Thai/British way (14/07/1962) is a perfectly sensible thing to write and
  // the app cannot read it: the card silently says "Birth date not added" instead of the age.
  rowsOf("EmergencyCards").forEach(row => {
    if (blankRow_(row)) return;
    const dob = String(row.date_of_birth || "").trim();
    if (dob && !parseDate(dob)) {
      problems.push(`EmergencyCards row ${rowLabel_("EmergencyCards", row)}: date_of_birth "${dob}" is not a date the app can read -- write it as YYYY-MM-DD, like 1962-07-14.`);
    }
  });

  // Duplicate active prescriptions for the same person and medicine.
  const activeCombos = {};
  rowsOf("Prescriptions").forEach(row => {
    if (blankRow_(row) || String(row.status || "").trim() !== "Active") return;
    const combo = `${String(row.user_id || "").trim()}|${String(row.medicine_id || "").trim()}`;
    if (activeCombos[combo]) {
      problems.push(`Prescriptions row ${rowLabel_("Prescriptions", row)}: another active prescription (${activeCombos[combo]}) already covers the same person and medicine.`);
    } else {
      activeCombos[combo] = rowLabel_("Prescriptions", row);
    }
  });

  // Duplicate dose rows for the same prescription and time of day.
  const doseCombos = {};
  const doseCountByRx_ = {};
  rowsOf("PrescriptionDoses").forEach(row => {
    if (blankRow_(row)) return;
    const combo = `${String(row.prescription_id || "").trim()}|${String(row.time_of_day || "").trim()}`;
    if (doseCombos[combo]) {
      problems.push(`PrescriptionDoses row ${rowLabel_("PrescriptionDoses", row)}: another dose row (${doseCombos[combo]}) already covers this prescription at this time of day.`);
    } else {
      doseCombos[combo] = rowLabel_("PrescriptionDoses", row);
    }
    const pid = String(row.prescription_id || "").trim();
    if (pid) doseCountByRx_[pid] = (doseCountByRx_[pid] || 0) + 1;
  });

  // An Active, scheduled (not As-needed) prescription with no dose rows at all never shows on
  // Today, with nothing in the Sheet to say why.
  rowsOf("Prescriptions").forEach(row => {
    if (blankRow_(row)) return;
    if (String(row.status || "").trim() !== "Active") return;
    if (String(row.frequency || "").trim() === "As needed") return;
    const pid = String(row.prescription_id || "").trim();
    if (pid && !doseCountByRx_[pid]) {
      problems.push(`Prescriptions row ${rowLabel_("Prescriptions", row)}: Active with no dose rows, so it won't show on Today.`);
    }
  });

  // A blank active cell is treated as "active" by the app (isActiveUser), but that's easy to
  // mistake for a typo or an unfinished row -- call it out so the admin types TRUE/FALSE on purpose.
  rowsOf("Users").forEach(row => {
    if (blankRow_(row)) return;
    if (String(row.active == null ? "" : row.active).trim() === "") {
      problems.push(`Users row ${rowLabel_("Users", row)}: active is blank; type TRUE or FALSE.`);
    }
  });

  // People: exactly one role the app opens on by default, and names that are typed at login
  // must be unique.
  const activeUserRows = rowsOf("Users").filter(row => !blankRow_(row) && isActiveUser(row));
  if (!activeUserRows.some(u => String(u.role || "").trim() === "Primary")) {
    problems.push('No active user has role "Primary".');
  }
  const seenNames = {};
  activeUserRows.forEach(u => {
    const name = String(u.display_name || "").trim().toLowerCase();
    if (!name) return;
    if (seenNames[name]) problems.push(`Users ${u.user_id} and ${seenNames[name]} share the display_name "${u.display_name}".`);
    else seenNames[name] = u.user_id;
  });

  // Settings: an empty photo_folder_id is no longer a problem -- setUpPhotoFolder fills it in,
  // and so does the first photo anyone adds. The problem worth reporting is the opposite one: an
  // id that IS filled in and that the app cannot open. The app may only touch folders it made
  // itself, so a folder made by hand and pasted in here is invisible to it, and every photo
  // upload will refuse until the box is emptied and setUpPhotoFolder has been run.
  const folderSetting = rowsOf("Settings").find(row => String(row.key || "").trim() === "photo_folder_id");
  const folderId = folderSetting ? String(folderSetting.value || "").trim() : "";
  if (folderId) {
    // PhotoFolder.open answers null only for "Drive says there is no such folder for this app",
    // and throws for anything else. A checker must not turn a permission problem into the
    // hand-made-folder advice: clearing the cell would not fix it, and the real error would
    // then wait to surprise somebody on a phone. So report what actually happened.
    let folder = null;
    let failed = "";
    try {
      folder = PhotoFolder.open(folderId);
    } catch (e) {
      failed = String((e && e.message) || e);
    }
    if (failed) {
      problems.push(`Settings: checking the photo folder in photo_folder_id ("${folderId}") did not work: ${failed}`);
    } else if (!folder) {
      problems.push(`Settings: the app cannot open the photo folder in photo_folder_id ("${folderId}"). Empty that box on the Settings tab, then run setUpPhotoFolder to make a folder the app can use.`);
    }
  }

  // Sharing: section and access are typed by hand, so a typo here silently grants nothing.
  const SECTION_VALUES_ = ["Medicines", "Care team"];
  const ACCESS_VALUES_ = ["View", "Edit"];
  rowsOf("Sharing").forEach(row => {
    if (blankRow_(row)) return;
    const label = rowLabel_("Sharing", row);
    const section = String(row.section || "").trim();
    if (section && SECTION_VALUES_.indexOf(section) < 0) problems.push(`Sharing row ${label}: unknown section "${section}".`);
    const access = String(row.access || "").trim();
    if (access && ACCESS_VALUES_.indexOf(access) < 0) problems.push(`Sharing row ${label}: unknown access "${access}".`);
  });

  console.log(problems.length ? `Problems found:\n- ${problems.join("\n- ")}` : "The Sheet looks good.");
  return problems;
}
