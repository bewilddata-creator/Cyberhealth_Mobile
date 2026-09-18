// GENERATED from server/actions.js by scripts/sync-gs.mjs. Do not edit here: edit server/actions.js and run npm run sync-gs.
// All API actions. Pure: every outside effect goes through ctx (see plan Task 3 interface).
// Synced to Apps Script by scripts/sync-gs.mjs, so keep imports on one line and names unique.

class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const HARD_ATTEMPT_CAP = 50;
const ACTIONS = {};

function handle(req, ctx) {
  try {
    const action = req && Object.prototype.hasOwnProperty.call(ACTIONS, req.action) ? ACTIONS[req.action] : null;
    if (!action) throw new AppError("BAD_INPUT", "Unknown action.");
    return { ok: true, data: action(req, ctx) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message } };
    if (ctx && ctx.log) ctx.log(err);
    return { ok: false, error: { code: "SERVER", message: "Something went wrong on the server. Try again." } };
  }
}

const str = v => String(v == null ? "" : v).trim();
function stripRow(r) { const o = {}; Object.keys(r).forEach(k => { if (k !== "_row") o[k] = str(r[k]); }); return o; }
function activeUsers(ctx) { return ctx.db.rows("Users").filter(isActiveUser).map(u => ({ ...u, user_id: str(u.user_id), display_name: str(u.display_name), role: str(u.role) })); }
function findUserByName(ctx, name) {
  const n = str(name).toLowerCase();
  return n ? activeUsers(ctx).find(u => u.display_name.toLowerCase() === n) || null : null;
}
function attemptKey(name) { return str(name).toLowerCase(); }
function guardLockout(ctx, name) {
  if (ctx.attempts.get(attemptKey(name)) >= MAX_ATTEMPTS) throw new AppError("LOCKED_OUT", "Too many tries. Wait 15 minutes and try again.");
}
function startSession(ctx, user) {
  const token = ctx.randomToken();
  ctx.sessions.put(tokenHash(token, ctx.sha256), { userId: user.user_id, expires: ctx.nowMs() + SESSION_DAYS * 86400000 });
  return { token, user: publicUser(user) };
}
function requireUser(req, ctx) {
  if (!req.token) throw new AppError("AUTH_REQUIRED", "Please log in.");
  const hash = tokenHash(req.token, ctx.sha256);
  const rec = ctx.sessions.get(hash);
  if (!rec || rec.expires < ctx.nowMs()) {
    if (rec) ctx.sessions.remove(hash);
    throw new AppError("AUTH_REQUIRED", "Please log in again.");
  }
  const user = activeUsers(ctx).find(u => u.user_id === rec.userId);
  if (!user) { ctx.sessions.remove(hash); throw new AppError("AUTH_REQUIRED", "Please log in again."); }
  return { user, hash };
}
// The Sharing tab trimmed to the fields access.js cares about.
function sharingRows(ctx) {
  return ctx.db.rows("Sharing").map(r => ({
    owner_user_id: str(r.owner_user_id),
    shared_with_user_id: str(r.shared_with_user_id),
    section: str(r.section),
    access: str(r.access),
  }));
}

// ---- Account actions ----
Object.assign(ACTIONS, {
  listUsers(req, ctx) {
    return activeUsers(ctx).map(u => ({ user_id: u.user_id, display_name: u.display_name }));
  },
  login(req, ctx) {
    // A correct password always gets through the friendly lockout, so a family member's
    // wrong guesses can't shut the owner out of their own pills. This hard cap still
    // stops someone guessing passwords against the public web app address.
    if (ctx.attempts.get(attemptKey(req.name)) >= HARD_ATTEMPT_CAP) throw new AppError("LOCKED_OUT", "Too many tries. Wait 15 minutes and try again.");
    const user = findUserByName(ctx, req.name);
    if (!user || !str(user.password_hash) || !verifyPassword(req.password, str(user.password_hash), ctx.sha256)) {
      ctx.attempts.incr(attemptKey(req.name));
      if (ctx.attempts.get(attemptKey(req.name)) >= MAX_ATTEMPTS) throw new AppError("LOCKED_OUT", "Too many tries. Wait 15 minutes and try again.");
      throw new AppError("AUTH_FAILED", "Name or password is wrong. First time? Tap “Set or forgot password”.");
    }
    ctx.attempts.clear(attemptKey(req.name));
    return startSession(ctx, user);
  },
  setPassword(req, ctx) {
    guardLockout(ctx, req.name);
    const user = findUserByName(ctx, req.name);
    const code = str(req.code);
    if (!user || !isResetCode(code) || str(user.reset_code) !== code) {
      ctx.attempts.incr(attemptKey(req.name));
      throw new AppError("AUTH_FAILED", "Name or code is wrong. Ask the family admin for a new code.");
    }
    const problem = passwordProblem(req.newPassword);
    if (problem) throw new AppError("BAD_INPUT", problem);
    ctx.lock(() => ctx.db.update("Users", "user_id", user.user_id, { password_hash: makePasswordRecord(req.newPassword, ctx.randomSalt(), ctx.sha256), reset_code: "" }));
    ctx.sessions.removeForUser(user.user_id);
    ctx.attempts.clear(attemptKey(req.name));
    return startSession(ctx, user);
  },
  logout(req, ctx) {
    const { hash } = requireUser(req, ctx);
    ctx.sessions.remove(hash);
    return {};
  },
});

// ---- Data action helpers ----
const CARD_FIELDS = ["full_name", "date_of_birth", "blood_type", "allergies", "conditions", "contact1_name", "contact1_relation", "contact1_phone", "contact2_name", "contact2_relation", "contact2_phone", "notes"];

// Normalizes every row of a tab with normalizeFn, dropping blank spacer rows silently and
// pushing { user_id, message } into warnings for the rest (user_id "" when ownerFn is omitted or
// can't place blame on one person). Returns the successful values.
function normalizeTab(ctx, tab, normalizeFn, key, warnings, ownerFn) {
  const out = [];
  ctx.db.rows(tab).forEach(raw => {
    const row = stripRow(raw);
    if (Object.values(row).every(v => v === "")) return;
    const result = normalizeFn(row);
    if (result.ok) out.push(result[key]);
    else warnings.push({ user_id: ownerFn ? ownerFn(row) : "", message: `${tab} row ${result.id}: ${result.reason}` });
  });
  return out;
}

function personName(users, userId) {
  const u = users.find(x => x.user_id === userId);
  return u ? u.display_name : "Someone";
}

function medicineLabel(med) {
  if (!med) return "";
  return [str(med.generic_name), str(med.strength)].filter(Boolean).join(" ");
}

// One Card per active user. hospital_numbers is attached only when viewerUserId can read
// that person's Care team (a blank viewerUserId, as for publicEmergency, never qualifies).
function buildCards(ctx, prescriptions, viewerUserId, sharing) {
  const medicinesById = new Map(ctx.db.rows("Medicines").map(m => [str(m.medicine_id), stripRow(m)]));
  const hospitalsById = new Map(ctx.db.rows("Hospitals").map(h => [str(h.hospital_id), stripRow(h)]));
  const cardsByUser = new Map(ctx.db.rows("EmergencyCards").map(r => [str(r.user_id), stripRow(r)]));
  const hnRows = ctx.db.rows("HospitalNumbers").map(stripRow);
  return activeUsers(ctx).map(u => {
    const existing = cardsByUser.get(u.user_id) || {};
    const card = { user_id: u.user_id, display_name: u.display_name };
    CARD_FIELDS.forEach(f => { card[f] = str(existing[f]); });
    // A duplicate Active prescription for the same medicine (see C2) must not list the medicine
    // twice on the emergency card either -- collapsed to the first by prescription order, same
    // rule schedule.js applies for Today/Meds.
    card.current_medicines = dedupeActivePrescriptions(
      prescriptions.filter(p => p.userId === u.user_id && p.status === "Active" && p.freq !== FREQ.AS_NEEDED),
    ).map(p => medicineLabel(medicinesById.get(p.medicineId)));
    if (canRead(viewerUserId, u.user_id, SECTIONS.CARE_TEAM, sharing)) {
      card.hospital_numbers = hnRows.filter(h => h.user_id === u.user_id).map(h => {
        const hos = hospitalsById.get(h.hospital_id) || {};
        return { hospital_name: str(hos.name), hn: h.hn, phone: str(hos.phone) };
      });
    }
    return card;
  });
}

function requireDateTimeOfDay(req) {
  const date = parseDate(req.date);
  const timeOfDay = str(req.timeOfDay);
  if (!date || !TIMES_OF_DAY.includes(timeOfDay)) throw new AppError("BAD_INPUT", "Enter a valid date and time of day.");
  return { date, timeOfDay };
}

// The raw Prescriptions row (unnormalized) for an id, so ownership can be checked even
// when the row is otherwise malformed.
function ownerOf(ctx, prescriptionId) {
  const raw = ctx.db.rows("Prescriptions").find(r => str(r.prescription_id) === prescriptionId);
  return raw ? { raw, ownerId: str(raw.user_id) } : null;
}

// The dose row to write for (prescriptionId, timeOfDay) on date, or null when the
// prescription is missing, invalid, not due that date, or has no dose row for that time.
function dueDoseFor(ctx, prescriptionId, date, timeOfDay) {
  const found = ownerOf(ctx, prescriptionId);
  if (!found) return null;
  const norm = normalizePrescription(stripRow(found.raw));
  if (!norm.ok || !isDue(norm.prescription, date)) return null;
  const match = ctx.db.rows("PrescriptionDoses")
    .filter(d => str(d.prescription_id) === prescriptionId && str(d.time_of_day) === timeOfDay)
    .map(d => normalizeDose(stripRow(d)))
    .find(r => r.ok);
  return match ? match.dose : null;
}

function alreadyTaken(ctx, prescriptionId, date, timeOfDay) {
  return ctx.db.rows("DoseLog").some(r =>
    str(r.prescription_id) === prescriptionId && str(r.date) === date && str(r.time_of_day) === timeOfDay && str(r.status) === "Taken"
  );
}

function writeTaken(ctx, user, prescriptionId, date, timeOfDay, dose) {
  return stripRow(ctx.db.append("DoseLog", {
    log_id: ctx.newId("LOG"),
    prescription_id: prescriptionId,
    date,
    time_of_day: timeOfDay,
    amount_taken: String(dose.amount),
    unit: dose.unit,
    status: "Taken",
    taken_at: bangkokStamp(ctx.nowMs()),
    taken_by: user.user_id,
  }));
}

// Reads a prescription and its dose rows in the normalized shape describeSchedule wants.
function readPrescription(ctx, prescriptionId) {
  const row = ctx.db.rows("Prescriptions").find(r => str(r.prescription_id) === prescriptionId);
  if (!row) return null;
  const norm = normalizePrescription(row);
  if (!norm.ok) throw new AppError("BAD_INPUT", `This prescription has a problem in the Sheet: ${norm.reason}`);
  const doses = ctx.db.rows("PrescriptionDoses")
    .filter(d => str(d.prescription_id) === prescriptionId)
    .map(normalizeDose)
    .filter(d => d.ok)
    .map(d => d.dose);
  return { row, prescription: norm.prescription, doses };
}

// The ONLY way a prescription changes. Runs inside the script lock: reads the current state,
// runs the caller's writes, reads it back, and appends one PrescriptionChanges row describing
// the move in words. No action may write to Prescriptions or PrescriptionDoses except through
// here, so history can never drift from what the rows actually say.
function applyPrescriptionChange(ctx, user, prescriptionId, changeType, mutate, opts) {
  const options = opts || {};
  const start = readPrescription(ctx, prescriptionId);
  if (!start) throw new AppError("BAD_INPUT", "That medicine isn't on the list any more. Refresh and try again.");
  const before = changeType === "Started" ? "" : describeSchedule(start.prescription, start.doses);
  mutate(start);
  const end = readPrescription(ctx, prescriptionId);
  if (!end) throw new AppError("SERVER", "Something went wrong on the server. Try again.");
  const stamp = bangkokStamp(ctx.nowMs());
  const doctorId = end.prescription.doctorId;
  ctx.db.update("Prescriptions", "prescription_id", prescriptionId, { updated_at: stamp, updated_by: user.user_id });
  ctx.db.append("PrescriptionChanges", {
    change_id: ctx.newId("CH"),
    prescription_id: prescriptionId,
    changed_at: stamp,
    changed_by: user.user_id,
    change_type: changeType,
    doctor_id: doctorId,
    reason: str(options.reason).slice(0, MAX_REASON_LENGTH),
    before,
    after: describeSchedule(end.prescription, end.doses),
  });
  // end.row is stale in production: SheetDb.update (apps-script/Data.gs) writes to the
  // spreadsheet and does not mutate the object already read, unlike dev/memory-db.js's
  // update() which patches the live object in place. Re-read so the phone gets the stamps.
  const saved = ctx.db.rows("Prescriptions").find(r => str(r.prescription_id) === prescriptionId);
  return { prescription: stripRow(saved), doses: end.doses };
}

// ---- Data actions ----
Object.assign(ACTIONS, {
  publicEmergency(req, ctx) {
    const sharing = sharingRows(ctx);
    const warnings = [];
    const prescriptions = normalizeTab(ctx, "Prescriptions", normalizePrescription, "prescription", warnings);
    return buildCards(ctx, prescriptions, "", sharing);
  },

  bootstrap(req, ctx) {
    const { user } = requireUser(req, ctx);
    const sharing = sharingRows(ctx);
    const users = activeUsers(ctx);
    const warnings = [];
    // Built from the raw (unnormalized) rows so a dose row can still be blamed on its
    // prescription's owner even when other rows in the tab are broken.
    const ownerByRxId = new Map(ctx.db.rows("Prescriptions").map(r => [str(r.prescription_id), str(r.user_id)]).filter(([id]) => id));
    const prescriptions = normalizeTab(ctx, "Prescriptions", normalizePrescription, "prescription", warnings, row => str(row.user_id));
    const doses = normalizeTab(ctx, "PrescriptionDoses", normalizeDose, "dose", warnings, row => ownerByRxId.get(str(row.prescription_id)) || "");

    // Duplicate Active prescriptions for the same person + medicine: the pill would otherwise
    // show twice on Today (schedule.js's dedupeActivePrescriptions is what actually hides the
    // second one there) -- name both ids and the person so whoever reads More can fix the Sheet.
    const activeCombos = new Map();
    prescriptions.forEach(p => {
      if (p.status !== "Active") return;
      const combo = `${p.userId}|${p.medicineId}`;
      const prior = activeCombos.get(combo);
      if (prior) {
        warnings.push({ user_id: p.userId, message: `${personName(users, p.userId)} has two active prescriptions for the same medicine: ${prior} and ${p.id}.` });
      } else {
        activeCombos.set(combo, p.id);
      }
    });

    // Duplicate dose rows for the same prescription + time of day: doseItemsOn already keeps only
    // the first, but silently -- name both ids and the person.
    const doseCombos = new Map();
    doses.forEach(d => {
      const combo = `${d.prescriptionId}|${d.timeOfDay}`;
      const prior = doseCombos.get(combo);
      if (prior) {
        const owner = ownerByRxId.get(d.prescriptionId) || "";
        warnings.push({ user_id: owner, message: `${personName(users, owner)}'s prescription ${d.prescriptionId} has two dose rows for ${d.timeOfDay}: ${prior} and ${d.id}.` });
      } else {
        doseCombos.set(combo, d.id);
      }
    });

    // An Active, scheduled (not As-needed) prescription with no dose rows at all never shows on
    // Today, with nothing to say why.
    const dosedRxIds = new Set(doses.map(d => d.prescriptionId));
    prescriptions.forEach(p => {
      if (p.status === "Active" && p.freq !== FREQ.AS_NEEDED && !dosedRxIds.has(p.id)) {
        warnings.push({ user_id: p.userId, message: `${personName(users, p.userId)}'s prescription ${p.id} is Active with no dose rows, so it won't show on Today.` });
      }
    });

    const allUserIds = users.map(u => u.user_id);
    const medOwners = new Set(readableOwners(user.user_id, allUserIds, SECTIONS.MEDICINES, sharing));
    const careOwners = new Set(readableOwners(user.user_id, allUserIds, SECTIONS.CARE_TEAM, sharing));

    const visiblePrescriptions = prescriptions.filter(p => medOwners.has(p.userId));
    const visibleIds = new Set(visiblePrescriptions.map(p => p.id));
    const visibleDoses = doses.filter(d => visibleIds.has(d.prescriptionId));
    const changes = ctx.db.rows("PrescriptionChanges").map(stripRow).filter(c => visibleIds.has(c.prescription_id));

    const cutoff = addDays(bangkokToday(ctx.nowMs()), -(DOSE_LOG_WINDOW_DAYS - 1));
    const doseLog = ctx.db.rows("DoseLog").map(stripRow).filter(r => visibleIds.has(r.prescription_id) && r.date >= cutoff);

    const hospitalNumbers = ctx.db.rows("HospitalNumbers").map(stripRow).filter(r => careOwners.has(r.user_id));
    const careTeam = ctx.db.rows("CareTeam").map(stripRow).filter(r => careOwners.has(r.user_id));

    const people = users.map(u => ({
      user_id: u.user_id,
      display_name: u.display_name,
      role: u.role,
      medicines: grantFor(user.user_id, u.user_id, SECTIONS.MEDICINES, sharing),
      care_team: grantFor(user.user_id, u.user_id, SECTIONS.CARE_TEAM, sharing),
    }));

    return {
      today: bangkokToday(ctx.nowMs()),
      nowTimeOfDay: bangkokTimeOfDay(ctx.nowMs()),
      me: publicUser(user),
      people,
      medicines: ctx.db.rows("Medicines").map(stripRow),
      hospitals: ctx.db.rows("Hospitals").map(stripRow),
      doctors: ctx.db.rows("Doctors").map(stripRow),
      doctor_hospitals: ctx.db.rows("DoctorHospitals").map(stripRow),
      prescriptions: visiblePrescriptions,
      doses: visibleDoses,
      changes,
      dose_log: doseLog,
      hospital_numbers: hospitalNumbers,
      care_team: careTeam,
      emergency: buildCards(ctx, prescriptions, user.user_id, sharing),
      warnings,
    };
  },

  // The phone always sends the doseId and amount it showed on screen (I1's ruling). Re-reading
  // the due dose happens INSIDE the lock (M4: a stale read outside the lock could still race a
  // concurrent Sheet edit), and a mismatch there means someone edited PrescriptionDoses since
  // this phone last loaded -- refuse with CONFLICT rather than logging an amount nobody saw.
  // Already-Taken is still accepted idempotently even if the dose has since changed underneath:
  // that dose was genuinely logged at the time, and re-asking about it would only alarm Dad.
  tick(req, ctx) {
    const { user } = requireUser(req, ctx);
    const { date, timeOfDay } = requireDateTimeOfDay(req);
    const prescriptionId = str(req.prescriptionId);
    const doseId = str(req.doseId);
    const amount = Number(req.amount);
    const found = ownerOf(ctx, prescriptionId);
    if (!found) throw new AppError("BAD_INPUT", "Unknown prescription.");
    if (!canTick(user.user_id, found.ownerId)) {
      const owner = activeUsers(ctx).find(u => u.user_id === found.ownerId);
      throw new AppError("FORBIDDEN", `Only ${owner ? owner.display_name : "the owner"} can tick these doses.`);
    }
    if (date > bangkokToday(ctx.nowMs())) throw new AppError("FUTURE_DATE", "You can't tick a future date.");
    return ctx.lock(() => {
      const existing = ctx.db.rows("DoseLog").find(r =>
        str(r.prescription_id) === prescriptionId && str(r.date) === date && str(r.time_of_day) === timeOfDay && str(r.status) === "Taken"
      );
      if (existing) return stripRow(existing);
      const dose = dueDoseFor(ctx, prescriptionId, date, timeOfDay);
      if (!dose) throw new AppError("NOT_DUE", "This dose isn't due at that time.");
      if (dose.id !== doseId || dose.amount !== amount) {
        throw new AppError("CONFLICT", "This dose changed in the Sheet. The app has refreshed — check the amount and tick again.");
      }
      return writeTaken(ctx, user, prescriptionId, date, timeOfDay, dose);
    });
  },

  tickAll(req, ctx) {
    const { user } = requireUser(req, ctx);
    const { date, timeOfDay } = requireDateTimeOfDay(req);
    if (!Array.isArray(req.items) || req.items.length === 0) throw new AppError("BAD_INPUT", "Choose at least one dose to tick.");
    if (date > bangkokToday(ctx.nowMs())) throw new AppError("FUTURE_DATE", "You can't tick a future date.");
    return ctx.lock(() => {
      const ticked = [];
      const skipped = [];
      req.items.forEach(rawItem => {
        const item = rawItem && typeof rawItem === "object" ? rawItem : {};
        const prescriptionId = str(item.prescriptionId);
        const doseId = str(item.doseId);
        const amount = Number(item.amount);
        const found = ownerOf(ctx, prescriptionId);
        if (!found || !canTick(user.user_id, found.ownerId)) { skipped.push(prescriptionId); return; }
        if (alreadyTaken(ctx, prescriptionId, date, timeOfDay)) { skipped.push(prescriptionId); return; }
        const dose = dueDoseFor(ctx, prescriptionId, date, timeOfDay);
        if (!dose || dose.id !== doseId || dose.amount !== amount) { skipped.push(prescriptionId); return; }
        ticked.push(writeTaken(ctx, user, prescriptionId, date, timeOfDay, dose));
      });
      return { ticked, skipped };
    });
  },

  untick(req, ctx) {
    const { user } = requireUser(req, ctx);
    const { date, timeOfDay } = requireDateTimeOfDay(req);
    const prescriptionId = str(req.prescriptionId);
    const found = ownerOf(ctx, prescriptionId);
    if (!found) throw new AppError("BAD_INPUT", "Unknown prescription.");
    if (!canTick(user.user_id, found.ownerId)) {
      const owner = activeUsers(ctx).find(u => u.user_id === found.ownerId);
      throw new AppError("FORBIDDEN", `Only ${owner ? owner.display_name : "the owner"} can untick these doses.`);
    }
    return ctx.lock(() => {
      const removed = ctx.db.remove("DoseLog", r =>
        str(r.prescription_id) === prescriptionId && str(r.date) === date && str(r.time_of_day) === timeOfDay && str(r.status) === "Taken"
      );
      return { removed };
    });
  },

  saveEmergencyCard(req, ctx) {
    const { user } = requireUser(req, ctx);
    const fields = req.fields && typeof req.fields === "object" ? req.fields : {};
    const patch = {};
    CARD_FIELDS.forEach(f => {
      if (Object.prototype.hasOwnProperty.call(fields, f)) patch[f] = str(fields[f]).slice(0, 500);
    });
    if (patch.date_of_birth && !parseDate(patch.date_of_birth)) throw new AppError("BAD_INPUT", "Date of birth must be a valid date.");
    patch.updated_at = bangkokStamp(ctx.nowMs());
    patch.updated_by = user.user_id;
    return ctx.lock(() => {
      const existing = ctx.db.rows("EmergencyCards").find(r => str(r.user_id) === user.user_id);
      if (existing) ctx.db.update("EmergencyCards", "user_id", user.user_id, patch);
      else ctx.db.append("EmergencyCards", { user_id: user.user_id, ...patch });
      const sharing = sharingRows(ctx);
      const warnings = [];
      const prescriptions = normalizeTab(ctx, "Prescriptions", normalizePrescription, "prescription", warnings);
      return buildCards(ctx, prescriptions, user.user_id, sharing).find(c => c.user_id === user.user_id);
    });
  },
});

// ---- Prescription write actions ----
// Every prescription write goes through applyPrescriptionChange, inside ctx.lock, so the Sheet
// and the history can never disagree. DoseLog is never touched here: a dose already taken is a
// record of what went in someone's mouth, not a setting to be updated.
function requireEditable(req, ctx, ownerId) {
  const { user } = requireUser(req, ctx);
  if (!canEdit(user.user_id, ownerId, SECTIONS.MEDICINES, sharingRows(ctx))) {
    const owner = activeUsers(ctx).find(u => u.user_id === ownerId);
    throw new AppError("FORBIDDEN", `Only ${owner ? owner.display_name : "the owner"} — or someone they've shared editing with — can change these medicines.`);
  }
  return user;
}

function activeConflict(ctx, userId, medicineId, exceptId) {
  return ctx.db.rows("Prescriptions").some(r =>
    str(r.user_id) === userId && str(r.medicine_id) === medicineId &&
    str(r.status) === "Active" && str(r.prescription_id) !== exceptId
  );
}

function writeDoseRows(ctx, prescriptionId, doses) {
  ctx.db.remove("PrescriptionDoses", d => str(d.prescription_id) === prescriptionId);
  doses.forEach(d => ctx.db.append("PrescriptionDoses", {
    dose_id: ctx.newId("DS"), prescription_id: prescriptionId,
    time_of_day: d.timeOfDay, amount: String(d.amount), unit: d.unit,
  }));
}

Object.assign(ACTIONS, {
  addPrescription(req, ctx) {
    const userId = str(req.userId);
    const user = requireEditable(req, ctx, userId);
    const medicineId = str(req.medicineId);
    const schedule = validateScheduleFields(req);
    if (!schedule.ok) throw new AppError("BAD_INPUT", schedule.reason);
    const doses = validateDoses(req.doses, schedule.fields.frequency);
    if (!doses.ok) throw new AppError("BAD_INPUT", doses.reason);
    const today = bangkokToday(ctx.nowMs());
    const startedOn = req.startedOn ? parseDate(req.startedOn) : today;
    if (!startedOn) throw new AppError("BAD_INPUT", "The start date must be a real date.");
    if (startedOn > today) throw new AppError("BAD_INPUT", "A medicine can't start in the future. Pick today or a day already past.");
    return ctx.lock(() => {
      if (!ctx.db.rows("Medicines").some(m => str(m.medicine_id) === medicineId)) {
        throw new AppError("BAD_INPUT", "That medicine isn't in the list. Add it first.");
      }
      if (activeConflict(ctx, userId, medicineId, "")) {
        throw new AppError("CONFLICT", "This person is already taking that medicine. Change the one they have instead of adding a second.");
      }
      const stamp = bangkokStamp(ctx.nowMs());
      const prescriptionId = ctx.newId("RX");
      // The only case where a write to Prescriptions/PrescriptionDoses happens outside
      // applyPrescriptionChange's mutate: there is no existing row for readPrescription to find
      // yet, so the row must be created before applyPrescriptionChange can even run its "before"
      // read. This is still safe: it happens inside the same ctx.lock, and the
      // applyPrescriptionChange call just below re-reads these committed rows as its own
      // "before"/"after" state (before === "" for a Started change) before writing history. Do
      // not treat this as licence to write these tables elsewhere outside the chokepoint.
      ctx.db.append("Prescriptions", {
        prescription_id: prescriptionId, user_id: userId, medicine_id: medicineId,
        frequency: schedule.fields.frequency, every_n_days: schedule.fields.every_n_days,
        weekdays: schedule.fields.weekdays, count_from: schedule.fields.count_from,
        meal_timing: schedule.fields.meal_timing, doctor_id: str(req.doctorId),
        status: "Active", started_on: startedOn, notes: str(req.notes).slice(0, MAX_REASON_LENGTH),
        created_at: stamp, created_by: user.user_id, updated_at: stamp, updated_by: user.user_id,
      });
      writeDoseRows(ctx, prescriptionId, doses.doses);
      return applyPrescriptionChange(ctx, user, prescriptionId, "Started", () => {}, { reason: req.reason });
    });
  },

  changePrescriptionDose(req, ctx) {
    const prescriptionId = str(req.prescriptionId);
    const found = ownerOf(ctx, prescriptionId);
    if (!found) throw new AppError("BAD_INPUT", "That medicine isn't on the list any more. Refresh and try again.");
    const user = requireEditable(req, ctx, found.ownerId);
    return ctx.lock(() => {
      const current = readPrescription(ctx, prescriptionId);
      if (!current) throw new AppError("BAD_INPUT", "That medicine isn't on the list any more. Refresh and try again.");
      const doses = validateDoses(req.doses, current.prescription.freq);
      if (!doses.ok) throw new AppError("BAD_INPUT", doses.reason);
      return applyPrescriptionChange(ctx, user, prescriptionId, "Dose changed", () => {
        if (req.doctorId !== undefined) ctx.db.update("Prescriptions", "prescription_id", prescriptionId, { doctor_id: str(req.doctorId) });
        writeDoseRows(ctx, prescriptionId, doses.doses);
      }, { reason: req.reason });
    });
  },

  changePrescriptionSchedule(req, ctx) {
    const prescriptionId = str(req.prescriptionId);
    const found = ownerOf(ctx, prescriptionId);
    if (!found) throw new AppError("BAD_INPUT", "That medicine isn't on the list any more. Refresh and try again.");
    const user = requireEditable(req, ctx, found.ownerId);
    const schedule = validateScheduleFields(req);
    if (!schedule.ok) throw new AppError("BAD_INPUT", schedule.reason);
    return ctx.lock(() => {
      const current = readPrescription(ctx, prescriptionId);
      if (!current) throw new AppError("BAD_INPUT", "That medicine isn't on the list any more. Refresh and try again.");
      const doses = validateDoses(current.doses.map(d => ({ timeOfDay: d.timeOfDay, amount: d.amount, unit: d.unit })), schedule.fields.frequency);
      if (!doses.ok) throw new AppError("BAD_INPUT", doses.reason);
      return applyPrescriptionChange(ctx, user, prescriptionId, "Schedule changed", () => {
        const patch = Object.assign({}, schedule.fields);
        // validateScheduleFields defaults meal_timing to "Any time" when the caller omits
        // mealTiming, which is right for a fresh prescription but wrong for a schedule-only
        // edit: without this guard, changing a Daily prescription to Weekdays would silently
        // erase an existing "After meal" instruction. Leave the column untouched unless the
        // caller actually sent a mealTiming.
        if (req.mealTiming === undefined) delete patch.meal_timing;
        if (req.doctorId !== undefined) patch.doctor_id = str(req.doctorId);
        ctx.db.update("Prescriptions", "prescription_id", prescriptionId, patch);
      }, { reason: req.reason });
    });
  },

  stopPrescription(req, ctx) {
    const prescriptionId = str(req.prescriptionId);
    const found = ownerOf(ctx, prescriptionId);
    if (!found) throw new AppError("BAD_INPUT", "That medicine isn't on the list any more. Refresh and try again.");
    const user = requireEditable(req, ctx, found.ownerId);
    return ctx.lock(() => applyPrescriptionChange(ctx, user, prescriptionId, "Stopped", () => {
      ctx.db.update("Prescriptions", "prescription_id", prescriptionId, { status: "Stopped" });
    }, { reason: req.reason }));
  },

  restartPrescription(req, ctx) {
    const prescriptionId = str(req.prescriptionId);
    const found = ownerOf(ctx, prescriptionId);
    if (!found) throw new AppError("BAD_INPUT", "That medicine isn't on the list any more. Refresh and try again.");
    const user = requireEditable(req, ctx, found.ownerId);
    return ctx.lock(() => {
      const current = readPrescription(ctx, prescriptionId);
      if (!current) throw new AppError("BAD_INPUT", "That medicine isn't on the list any more. Refresh and try again.");
      if (activeConflict(ctx, current.prescription.userId, current.prescription.medicineId, prescriptionId)) {
        throw new AppError("CONFLICT", "There's already a current prescription for this medicine. Stop that one first if you want this one back.");
      }
      return applyPrescriptionChange(ctx, user, prescriptionId, "Restarted", () => {
        ctx.db.update("Prescriptions", "prescription_id", prescriptionId, { status: "Active" });
      }, { reason: req.reason });
    });
  },

  deletePrescription(req, ctx) {
    const prescriptionId = str(req.prescriptionId);
    const found = ownerOf(ctx, prescriptionId);
    if (!found) throw new AppError("BAD_INPUT", "That medicine isn't on the list any more. Refresh and try again.");
    requireEditable(req, ctx, found.ownerId);
    return ctx.lock(() => {
      if (ctx.db.rows("DoseLog").some(r => str(r.prescription_id) === prescriptionId)) {
        throw new AppError("CONFLICT", "This has doses already recorded against it, so it can only be stopped — that way the record of what was taken stays right.");
      }
      ctx.db.remove("PrescriptionDoses", d => str(d.prescription_id) === prescriptionId);
      ctx.db.remove("PrescriptionChanges", c => str(c.prescription_id) === prescriptionId);
      ctx.db.remove("Prescriptions", r => str(r.prescription_id) === prescriptionId);
      return { deleted: true };
    });
  },
});
