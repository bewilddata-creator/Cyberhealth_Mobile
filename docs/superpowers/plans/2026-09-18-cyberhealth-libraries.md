# CyberHealth Libraries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the family a Medicines, Doctors and Hospitals library on the More screen, each one browsable, addable and editable from a phone, so nothing about a medicine, doctor or hospital needs the Google Sheet any more.

**Architecture:** `bootstrap` already sends `medicines`, `doctors`, `hospitals` and `doctor_hospitals` to every logged-in user, so this adds no read paths — only write actions and screens. Every new action follows the shape `addMedicine`/`updateMedicine` already established: `requireUser`, a whitelist of fields, `ctx.lock`, a re-read before returning. Doctor photos reuse the same Drive pipeline as medicine photos, against the `Doctors.photo` column.

**Tech Stack:** Vanilla ES modules (no build step), Google Apps Script, Google Sheets, Google Drive, `node:test`, `node:vm`, Chrome DevTools Protocol.

**Spec:** `docs/superpowers/specs/2026-09-18-cyberhealth-release2a-design.md` (§3 decisions, §4 access rules — the libraries are shared family lists with no owner, editable by any logged-in user). The library screens themselves were agreed with the owner in conversation and are specified here.

## Global Constraints

- **No build step.** Plain ES modules, no framework, no bundler, no new dependency. Views are functions returning HTML strings.
- **`esc()` from `js/html.js` on every interpolated value**, without exception. Every one of these fields is typed by hand into a spreadsheet.
- **Six files are machine-copied** into `apps-script/*.gs` by `npm run sync-gs`: `js/schedule.js`→`Schedule.gs`, `js/access.js`→`Access.gs`, `js/authcore.js`→`AuthCore.gs`, `server/prescriptions.js`→`Prescriptions.gs`, `server/actions.js`→`Actions.gs`, `server/photos.js`→`Photos.gs`. Never hand-edit a generated `.gs`; run the sync and commit the regenerated files in the same commit as the source change. `apps-script/Code.gs`, `Adapters.gs`, `Data.gs`, `CheckSheet.gs`, `Drive.gs` and `appsscript.json` are hand-written.
- **Apps Script loads `.gs` in unspecified order:** no top-level statement may reference a name from another file, and every top-level name must be unique across all of `apps-script/*.gs`.
- Asia/Bangkok, fixed UTC+7. Timestamps `"YYYY-MM-DD HH:mm"` via `bangkokStamp(ctx.nowMs())`. Never `new Date()` in server or schedule code.
- **Ids** via `ctx.newId(prefix)`: `"MED"` medicines, `"DOC"` doctors, `"HOS"` hospitals, `"DH"` doctor–hospital links.
- **Every write takes `ctx.lock(fn)`** and re-reads inside it whatever it guards.
- Error codes from the fixed set; `throw new AppError(code, message)`. **Every user-facing message is plain English a non-technical family member reads on a phone** — say what is wrong and what to do. The readers are a 64-year-old man and his adult daughter.
- **Libraries are shared and have no owner:** any logged-in user may add and edit. Not gated on Sharing. A logged-out caller gets `AUTH_REQUIRED`.
- **`DoseLog` is never written, updated or deleted by anything in this plan.**
- Works at 390px and 320px; touch targets at least 44px; no horizontal page scroll.
- Every button that is not `type="submit"` carries `type="button"`.
- Run `npm test` before every commit. The suite is **450 tests** at the start of this plan.

## The deletion rule, which every delete in this plan follows

Nothing referenced is ever deleted. A row that anything points at stays, because deleting it would make the family's history stop reading correctly — a prescription naming a doctor who no longer exists, or a dose log for a medicine that has vanished.

| Deleting | Refused when | Message names |
|---|---|---|
| Medicine | any `Prescriptions` row references it (Active **or** Stopped) | that someone takes it or used to |
| Doctor | any `Prescriptions.doctor_id` or `CareTeam.doctor_id` references it | which it is |
| Hospital | any `HospitalNumbers`, `CareTeam` or `DoctorHospitals` row references it | which it is |

A `DoctorHospitals` link is not a record of care and may always be removed.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `server/actions.js` | hospital actions | 1 |
| `server/actions.js` | doctor actions + doctor–hospital links | 2 |
| `server/actions.js` | `deleteMedicine`, doctor photo actions | 3 |
| `server/photos.js` | `doctorPhotoFolderName`, `DOCTOR_PHOTO_FILE` | 3 |
| `js/viewmodel.js` | the four library models | 4 |
| `js/views/libraries.js` | **new**: three list screens + the library medicine detail | 5 |
| `js/views/forms.js` | doctor form, hospital form | 5 |
| `js/views/more.js` | the three library entries | 5 |
| `js/app.js`, `js/main.js` | screens, handlers, wiring | 6 |
| `README.md` | what the libraries do | 6 |

Tasks 1–3 are server-only and independent of each other. Task 4 is pure functions. Tasks 5 and 6 are the screens, split so a reviewer can reject the markup without rejecting the wiring.

---

### Task 1: Hospital actions

**Files:**
- Modify: `server/actions.js`
- Test: `tests/actions-library.test.js` (new)

**Interfaces:**
- Consumes: `requireUser(req, ctx)`, `AppError`, `str(v)`, `stripRow(row)`, `bangkokStamp`, `ctx.lock`, `ctx.newId` — all already in `server/actions.js`.
- Produces: actions `addHospital`, `updateHospital`, `deleteHospital`. `addHospital` and `updateHospital` return the `Hospitals` row; `deleteHospital` returns `{deleted: true}`. Task 6's frontend calls these by name.

- [ ] **Step 1: Write the failing tests**

Create `tests/actions-library.test.js`:

```js
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
  // HOS01 has HN01/HN03 (HospitalNumbers), CT01/CT03 (CareTeam) and DH01 (DoctorHospitals).
  const r = handle({ action: "deleteHospital", token, hospitalId: "HOS01" }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CONFLICT");
  assert.match(r.error.message, /hospital number|care team|doctor/i);
  assert.equal(ctx.db.rows("Hospitals").filter(h => h.hospital_id === "HOS01").length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -cE "^not ok"`
Expected: a non-zero count — the new tests fail with `Unknown action.`

- [ ] **Step 3: Implement**

Add to `server/actions.js`, beside `MEDICINE_FIELDS`/`medicineFields`:

```js
const HOSPITAL_FIELDS = ["name", "phone", "address", "map_link", "notes"];

function hospitalFields(fields) {
  const patch = {};
  HOSPITAL_FIELDS.forEach(k => { if (fields && fields[k] !== undefined) patch[k] = str(fields[k]).slice(0, 200); });
  return patch;
}

// Every library delete answers the same question: does anything still point at this row? If it
// does, removing it would leave a prescription naming a doctor who no longer exists, or a dose
// log for a medicine that has vanished -- the family's history would stop reading correctly. So
// the row stays, and the message says what is holding it.
function referencesTo(ctx, checks) {
  return checks.filter(c => ctx.db.rows(c.tab).some(r => str(r[c.column]) === c.value)).map(c => c.label);
}
```

Add to the `Object.assign(ACTIONS, {…})` block:

```js
  addHospital(req, ctx) {
    const { user } = requireUser(req, ctx);
    const patch = hospitalFields(req.fields);
    if (!patch.name) throw new AppError("BAD_INPUT", "A hospital or clinic needs a name.");
    return ctx.lock(() => {
      const stamp = bangkokStamp(ctx.nowMs());
      const row = Object.assign({ hospital_id: ctx.newId("HOS") }, patch, {
        created_at: stamp, created_by: user.user_id, updated_at: stamp, updated_by: user.user_id,
      });
      ctx.db.append("Hospitals", row);
      return stripRow(ctx.db.rows("Hospitals").find(h => str(h.hospital_id) === row.hospital_id));
    });
  },

  updateHospital(req, ctx) {
    const { user } = requireUser(req, ctx);
    const hospitalId = str(req.hospitalId);
    const patch = hospitalFields(req.fields);
    if (Object.prototype.hasOwnProperty.call(patch, "name") && !patch.name) {
      throw new AppError("BAD_INPUT", "A hospital or clinic needs a name.");
    }
    return ctx.lock(() => {
      if (!ctx.db.rows("Hospitals").some(h => str(h.hospital_id) === hospitalId)) {
        throw new AppError("BAD_INPUT", "That hospital isn't in the list any more. Refresh and try again.");
      }
      patch.updated_at = bangkokStamp(ctx.nowMs());
      patch.updated_by = user.user_id;
      ctx.db.update("Hospitals", "hospital_id", hospitalId, patch);
      return stripRow(ctx.db.rows("Hospitals").find(h => str(h.hospital_id) === hospitalId));
    });
  },

  deleteHospital(req, ctx) {
    requireUser(req, ctx);
    const hospitalId = str(req.hospitalId);
    return ctx.lock(() => {
      if (!ctx.db.rows("Hospitals").some(h => str(h.hospital_id) === hospitalId)) {
        throw new AppError("BAD_INPUT", "That hospital isn't in the list any more. Refresh and try again.");
      }
      const held = referencesTo(ctx, [
        { tab: "HospitalNumbers", column: "hospital_id", value: hospitalId, label: "a hospital number" },
        { tab: "CareTeam", column: "hospital_id", value: hospitalId, label: "someone's care team" },
        { tab: "DoctorHospitals", column: "hospital_id", value: hospitalId, label: "a doctor who works there" },
      ]);
      if (held.length) {
        throw new AppError("CONFLICT", `This hospital is still used by ${held.join(" and ")}, so it stays in the list. Remove those first if you really want it gone.`);
      }
      ctx.db.remove("Hospitals", h => str(h.hospital_id) === hospitalId);
      return { deleted: true };
    });
  },
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, 458 tests.

- [ ] **Step 5: Sync and commit**

```bash
npm run sync-gs
git add server/actions.js apps-script/Actions.gs tests/actions-library.test.js
git commit -m "feat: add, edit and delete hospitals from the app"
```

---

### Task 2: Doctor actions and doctor–hospital links

**Files:**
- Modify: `server/actions.js`
- Test: `tests/actions-library.test.js`

**Interfaces:**
- Consumes: everything Task 1 consumes, plus `referencesTo(ctx, checks)` and the `HOSPITAL_FIELDS` pattern from Task 1.
- Produces: actions `addDoctor`, `updateDoctor`, `deleteDoctor`, `setDoctorHospitals`. `addDoctor`/`updateDoctor` return the `Doctors` row; `deleteDoctor` returns `{deleted: true}`; `setDoctorHospitals` returns `{hospital_ids: string[]}` — the ids actually stored, in the order stored.

- [ ] **Step 1: Write the failing tests**

Append to `tests/actions-library.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | grep -cE "^not ok"`
Expected: non-zero — `Unknown action.`

- [ ] **Step 3: Implement**

Add beside `hospitalFields`:

```js
// photo is deliberately NOT here: it only ever holds a Drive link the server itself wrote, so a
// caller cannot point it at a file of their choosing.
const DOCTOR_FIELDS = ["name", "specialty", "phone", "other_contact", "notes"];

function doctorFields(fields) {
  const patch = {};
  DOCTOR_FIELDS.forEach(k => { if (fields && fields[k] !== undefined) patch[k] = str(fields[k]).slice(0, 200); });
  return patch;
}
```

Add to the actions block:

```js
  addDoctor(req, ctx) {
    const { user } = requireUser(req, ctx);
    const patch = doctorFields(req.fields);
    if (!patch.name) throw new AppError("BAD_INPUT", "A doctor needs a name.");
    return ctx.lock(() => {
      const stamp = bangkokStamp(ctx.nowMs());
      const row = Object.assign({ doctor_id: ctx.newId("DOC") }, patch, {
        created_at: stamp, created_by: user.user_id, updated_at: stamp, updated_by: user.user_id,
      });
      ctx.db.append("Doctors", row);
      return stripRow(ctx.db.rows("Doctors").find(d => str(d.doctor_id) === row.doctor_id));
    });
  },

  updateDoctor(req, ctx) {
    const { user } = requireUser(req, ctx);
    const doctorId = str(req.doctorId);
    const patch = doctorFields(req.fields);
    if (Object.prototype.hasOwnProperty.call(patch, "name") && !patch.name) {
      throw new AppError("BAD_INPUT", "A doctor needs a name.");
    }
    return ctx.lock(() => {
      if (!ctx.db.rows("Doctors").some(d => str(d.doctor_id) === doctorId)) {
        throw new AppError("BAD_INPUT", "That doctor isn't in the list any more. Refresh and try again.");
      }
      patch.updated_at = bangkokStamp(ctx.nowMs());
      patch.updated_by = user.user_id;
      ctx.db.update("Doctors", "doctor_id", doctorId, patch);
      return stripRow(ctx.db.rows("Doctors").find(d => str(d.doctor_id) === doctorId));
    });
  },

  deleteDoctor(req, ctx) {
    requireUser(req, ctx);
    const doctorId = str(req.doctorId);
    return ctx.lock(() => {
      if (!ctx.db.rows("Doctors").some(d => str(d.doctor_id) === doctorId)) {
        throw new AppError("BAD_INPUT", "That doctor isn't in the list any more. Refresh and try again.");
      }
      const held = referencesTo(ctx, [
        { tab: "Prescriptions", column: "doctor_id", value: doctorId, label: "a medicine someone takes" },
        { tab: "CareTeam", column: "doctor_id", value: doctorId, label: "someone's care team" },
      ]);
      if (held.length) {
        throw new AppError("CONFLICT", `This doctor is still named on ${held.join(" and ")}, so they stay in the list. That keeps the records readable.`);
      }
      // A doctor-hospital link says where someone works, not that anyone was treated -- there is
      // no history in it to protect, so it goes with the doctor rather than blocking the delete.
      ctx.db.remove("DoctorHospitals", dh => str(dh.doctor_id) === doctorId);
      ctx.db.remove("Doctors", d => str(d.doctor_id) === doctorId);
      return { deleted: true };
    });
  },

  // Replaces the whole set for one doctor, so the form can send what the user ticked without
  // working out what changed. All or nothing: an unknown hospital refuses the lot rather than
  // saving half of what they asked for.
  setDoctorHospitals(req, ctx) {
    requireUser(req, ctx);
    const doctorId = str(req.doctorId);
    const asked = Array.isArray(req.hospitalIds) ? req.hospitalIds.map(str).filter(Boolean) : [];
    const wanted = [];
    asked.forEach(id => { if (!wanted.includes(id)) wanted.push(id); });
    return ctx.lock(() => {
      if (!ctx.db.rows("Doctors").some(d => str(d.doctor_id) === doctorId)) {
        throw new AppError("BAD_INPUT", "That doctor isn't in the list any more. Refresh and try again.");
      }
      const known = ctx.db.rows("Hospitals").map(h => str(h.hospital_id));
      const missing = wanted.filter(id => !known.includes(id));
      if (missing.length) throw new AppError("BAD_INPUT", "One of those hospitals isn't in the list any more. Refresh and try again.");
      ctx.db.remove("DoctorHospitals", dh => str(dh.doctor_id) === doctorId);
      wanted.forEach(hospitalId => ctx.db.append("DoctorHospitals", {
        doctor_hospital_id: ctx.newId("DH"), doctor_id: doctorId, hospital_id: hospitalId,
      }));
      return { hospital_ids: wanted };
    });
  },
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, 465 tests.

- [ ] **Step 5: Sync and commit**

```bash
npm run sync-gs
git add server/actions.js apps-script/Actions.gs tests/actions-library.test.js
git commit -m "feat: add, edit and delete doctors, and say which hospitals they work at"
```

---

### Task 3: Deleting a medicine, and doctor photos

**Files:**
- Modify: `server/photos.js`, `server/actions.js`
- Test: `tests/actions-library.test.js`, `tests/photos.test.js`

**Interfaces:**
- Consumes: Task 1's `referencesTo`. From `server/photos.js`: `parseDataUrl`, `MAX_PHOTO_BYTES`, `driveViewUrl`. `ctx.drive.put(folderName, fileName, base64, mimeType)` → `{id, url}`, `ctx.drive.trash(url)` → `boolean`, `ctx.drive.canOpen(id)` → `boolean`, `ctx.settings(key)` → `string`.
- Produces: `doctorPhotoFolderName(doctor)` and `DOCTOR_PHOTO_FILE` in `server/photos.js`; actions `deleteMedicine`, `uploadDoctorPhoto`, `removeDoctorPhoto`. The photo actions return `{url, warnings}` and `{warnings}` exactly as the medicine ones do.

- [ ] **Step 1: Write the failing tests**

Append to `tests/photos.test.js`:

```js
test("doctorPhotoFolderName puts doctor_id first, so two doctors with one name never share a folder", () => {
  const a = { doctor_id: "DOC01", name: "Dr. Somchai K." };
  const b = { doctor_id: "DOC02", name: "Dr. Somchai K." };
  assert.equal(doctorPhotoFolderName(a), "DOC01 Dr. Somchai K.");
  assert.notEqual(doctorPhotoFolderName(a), doctorPhotoFolderName(b));
  assert.equal(doctorPhotoFolderName({ doctor_id: "DOC03", name: "" }), "DOC03");
});
```

Add `doctorPhotoFolderName` and `DOCTOR_PHOTO_FILE` to that file's import list.

Append to `tests/actions-library.test.js` (the `withDrive(ctx)` helper you need lives in `tests/actions-photo.test.js` but is **not exported**. Move it into `tests/fixtures.js`, export it there, and import it from both test files — do not copy it, or the two fakes will drift apart, which is a failure this repo has already had three times):

```js
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

test("deleteMedicine trashes the photos it had, and a failed trash is a warning not a failure", () => {
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

test("a doctor photo must be a JPEG or PNG, and not too big", () => {
  const ctx = fakeCtx();
  withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  assert.equal(handle({ action: "uploadDoctorPhoto", token, doctorId: "DOC01", dataUrl: "data:text/html;base64,PGI+" }, ctx).error.code, "BAD_INPUT");
  const huge = `data:image/jpeg;base64,${"A".repeat(9 * 1024 * 1024)}`;
  assert.equal(handle({ action: "uploadDoctorPhoto", token, doctorId: "DOC01", dataUrl: huge }, ctx).error.code, "BAD_INPUT");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | grep -cE "^not ok"`
Expected: non-zero.

- [ ] **Step 3: Implement the photo helpers**

Add to `server/photos.js`:

```js
// One file per doctor, in a folder of the doctor's own -- doctor_id first for the same reason
// photoFolderName puts medicine_id first: two doctors can share a name, and a folder chosen by
// name alone would let one doctor's photo replace the other's.
export const DOCTOR_PHOTO_FILE = "portrait";

export function doctorPhotoFolderName(doctor) {
  const d = doctor || {};
  const id = String(d.doctor_id == null ? "" : d.doctor_id).trim();
  const name = String(d.name == null ? "" : d.name).trim();
  const joined = [id, name].filter(Boolean).join(" ").replace(/[\\/]/g, "-").trim().slice(0, 80);
  return joined || id;
}
```

- [ ] **Step 4: Implement the actions**

Add `doctorPhotoFolderName`, `DOCTOR_PHOTO_FILE` to the existing one-line `../server/photos.js` import in `server/actions.js`, then add to the actions block. Read `uploadMedicinePhoto` first and follow its ordering exactly — **the Drive file is created BEFORE the lock, the column is written INSIDE it, and the old file is trashed AFTER it is released.** A slow phone upload must not hold the spreadsheet against the rest of the family, and a failed trash must never fail a save whose photo is already stored.

```js
  deleteMedicine(req, ctx) {
    requireUser(req, ctx);
    const medicineId = str(req.medicineId);
    const doomed = ctx.lock(() => {
      const row = ctx.db.rows("Medicines").find(m => str(m.medicine_id) === medicineId);
      if (!row) throw new AppError("BAD_INPUT", "That medicine isn't in the list any more. Refresh and try again.");
      const held = referencesTo(ctx, [
        { tab: "Prescriptions", column: "medicine_id", value: medicineId, label: "someone's medicines" },
      ]);
      if (held.length) {
        throw new AppError("CONFLICT", "Someone takes this medicine, or used to, so it stays in the list. That keeps their record readable.");
      }
      const urls = PHOTO_SLOTS.map(slot => str(row[photoColumn(slot)])).filter(Boolean);
      ctx.db.remove("Medicines", m => str(m.medicine_id) === medicineId);
      return urls;
    });
    const warnings = [];
    if (doomed.some(url => !ctx.drive.trash(url))) {
      warnings.push("The medicine was removed, but some of its photos are still in Drive. You can delete them there.");
    }
    return { deleted: true, warnings };
  },

  uploadDoctorPhoto(req, ctx) {
    const { user } = requireUser(req, ctx);
    const doctorId = str(req.doctorId);
    const parsed = parseDataUrl(req.dataUrl);
    if (!parsed) throw new AppError("BAD_INPUT", "That photo has to be a JPEG or PNG image.");
    if (parsed.bytes > MAX_PHOTO_BYTES) throw new AppError("BAD_INPUT", "That photo is too big. Try taking it again.");
    const rootId = ctx.settings("photo_folder_id");
    if (rootId && !ctx.drive.canOpen(rootId)) {
      throw new AppError("BAD_INPUT", "The app can't open the photo folder set up in the Sheet, so the photo wasn't saved. Ask whoever set up the Sheet to empty the photo_folder_id box on the Settings tab and then run setUpPhotoFolder.");
    }
    const doctor = ctx.db.rows("Doctors").find(d => str(d.doctor_id) === doctorId);
    if (!doctor) throw new AppError("BAD_INPUT", "That doctor isn't in the list any more. Refresh and try again.");
    const fileName = `${DOCTOR_PHOTO_FILE}.${parsed.mimeType === "image/png" ? "png" : "jpg"}`;
    const created = ctx.drive.put(doctorPhotoFolderName(doctor), fileName, parsed.base64, parsed.mimeType);
    const previous = ctx.lock(() => {
      const row = ctx.db.rows("Doctors").find(d => str(d.doctor_id) === doctorId);
      if (!row) throw new AppError("BAD_INPUT", "That doctor isn't in the list any more. Refresh and try again.");
      const before = str(row.photo);
      ctx.db.update("Doctors", "doctor_id", doctorId, {
        photo: created.url, updated_at: bangkokStamp(ctx.nowMs()), updated_by: user.user_id,
      });
      return before;
    });
    const warnings = [];
    if (previous && previous !== created.url && !ctx.drive.trash(previous)) {
      warnings.push("The photo was saved, but the old one is still in Drive. You can delete it there.");
    }
    return { url: created.url, warnings };
  },

  removeDoctorPhoto(req, ctx) {
    const { user } = requireUser(req, ctx);
    const doctorId = str(req.doctorId);
    const previous = ctx.lock(() => {
      const row = ctx.db.rows("Doctors").find(d => str(d.doctor_id) === doctorId);
      if (!row) throw new AppError("BAD_INPUT", "That doctor isn't in the list any more. Refresh and try again.");
      const before = str(row.photo);
      ctx.db.update("Doctors", "doctor_id", doctorId, {
        photo: "", updated_at: bangkokStamp(ctx.nowMs()), updated_by: user.user_id,
      });
      return before;
    });
    const warnings = [];
    if (previous && !ctx.drive.trash(previous)) {
      warnings.push("The photo was removed from the app, but the file is still in Drive. You can delete it there.");
    }
    return { warnings };
  },
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, 473 tests.

- [ ] **Step 6: Sync and commit**

```bash
npm run sync-gs
git add server/photos.js server/actions.js apps-script/Photos.gs apps-script/Actions.gs tests/photos.test.js tests/actions-library.test.js
git commit -m "feat: delete an unused medicine, and give doctors a photo"
```

---

### Task 4: The library view models

**Files:**
- Modify: `js/viewmodel.js`
- Test: `tests/viewmodel-library.test.js` (new)

**Interfaces:**
- Consumes: `indexBoot(boot)` → `idx`, whose `idx.medicines`, `idx.doctors`, `idx.hospitals` are `Map`s keyed by id, and whose `idx.boot` holds the raw payload arrays (`prescriptions`, `doses`, `doctor_hospitals`, `care_team`, `hospital_numbers`, `people`). `medicineNameParts(med)` → `{name, strength}` and `unitForMedicineForm(form)` from `js/schedule.js`. `driveImageUrl(link)` from `js/viewmodel.js`.
- Produces, all exported from `js/viewmodel.js`:
  - `medicineLibraryModel(idx)` → `{rows: [{medicine, name, strength, photoUrl, takenBy: string[], canDelete: boolean}]}`, sorted by `name` then `strength`, locale-aware.
  - `medicineLibraryDetail(idx, medicineId)` → `{medicine, name, strength, unit, photos: [{label, url}], takenBy: [{userId, displayName}], canDelete}` or `null`.
  - `doctorLibraryModel(idx)` → `{rows: [{doctor, photoUrl, hospitalNames: string[], canDelete}]}`, sorted by `doctor.name`, locale-aware.
  - `hospitalLibraryModel(idx)` → `{rows: [{hospital, doctorNames: string[], canDelete}]}`, sorted by `hospital.name`, locale-aware.

- [ ] **Step 1: Write the failing tests**

Create `tests/viewmodel-library.test.js`. Build the `idx` with `indexBoot` over a literal boot object. **Verified:** `indexBoot` itself reads exactly eight arrays and throws if any is missing — `dose_log`, `medicines`, `hospitals`, `doctors`, `people`, `prescriptions`, `doses`, `changes`. Your models also reach through `idx.boot` for `doctor_hospitals`, `care_team` and `hospital_numbers`, so supply those too. Note `prescriptions` is keyed by `id` (not `prescription_id`) and `doses` group by `prescriptionId` — those are the normalized shapes, not raw Sheet rows; copy their shape from an existing test that calls `indexBoot`.

```js
test("medicineLibraryModel lists every medicine with who takes it, sorted by the name shown", () => {
  const idx = libraryIdx();
  const { rows } = medicineLibraryModel(idx);
  assert.deepEqual(rows.map(r => r.name), ["Glucophage (Metformin)", "Norvasc (Amlodipine)", "Vitamin C"]);
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
```

Write `libraryIdx()` in this file. Base it on the shapes in `tests/fixtures.js` (`fixtureTables()`), adding `MED99`, `DOC99` and `HOS99` as unreferenced spares. The medicine forms matter: MED01 is `Tablet`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — the functions are not exported.

- [ ] **Step 3: Implement**

Add to `js/viewmodel.js`. Sorting is locale-aware throughout (`localeCompare(b, undefined, { sensitivity: "base", numeric: true })`) because these names carry Thai characters, and `numeric: true` keeps "10 mg" after "5 mg".

The `canDelete` rules must mirror the server's exactly (Task 1's table): a wrong `canDelete` offers a button the server refuses. **Verified: `js/viewmodel.js` already defines `PHOTO_FIELDS`** (module-private, around line 224) as `[field, label, slot]` triples — `photo_box`/"Box"/`box`, `photo_packet_front`/"Packet front"/`packet_front`, `photo_packet_back`/"Packet back"/`packet_back`, `photo_pill_front`/"Pill front"/`pill_front`, `photo_pill_back`/"Pill back"/`pill_back`. Reuse it; `detailModel` already builds its photo list from it at line 298. Do not define a second list — the labels are asserted in Task 4's tests and must match.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, 479 tests.

- [ ] **Step 5: Commit**

```bash
git add js/viewmodel.js tests/viewmodel-library.test.js
git commit -m "feat: view models for the medicine, doctor and hospital libraries"
```

---

### Task 5: The library screens

**Files:**
- Create: `js/views/libraries.js`
- Modify: `js/views/forms.js`, `js/views/more.js`, `styles.css`
- Test: `tests/views-library.test.js` (new), `tests/views.test.js`

**Interfaces:**
- Consumes: Task 4's four models; `esc` from `js/html.js`; `I` from `js/icons.js`. Read `js/views/meds.js` and `js/views/forms.js` FIRST — `renderMeds`'s row markup and `renderMedicineForm`'s field/error/busy markup are the patterns to mirror, so these screens inherit the app's look with almost no new CSS.
- Produces, exported from `js/views/libraries.js`: `renderMedicineLibrary({model, query})`, `renderMedicineLibraryDetail({model, photo})`, `renderDoctorLibrary({model, query})`, `renderHospitalLibrary({model, query})`. From `js/views/forms.js`: `renderDoctorForm({model, error, busy})`, `renderHospitalForm({model, error, busy})`.

- [ ] **Step 1: Add the three entries to More**

In `js/views/more.js`, add a card above "Coming soon" holding three buttons: `data-library="medicines"`, `data-library="doctors"`, `data-library="hospitals"`, labelled **Medicines**, **Doctors** and **Hospitals & clinics**, each with a one-line description of what it holds. Remove "Hospitals & doctors" from `COMING_SOON` — it is no longer coming, it is here. Leave the rest of that array alone.

Add a test to `tests/views.test.js` asserting all three `data-library` attributes render and that `COMING_SOON` no longer advertises hospitals and doctors.

- [ ] **Step 2: Write the failing view tests**

Create `tests/views-library.test.js`. Cover, for each of the three lists: every row renders; the search box filters on the name shown; a `data-add-*` button is present; a row carries `data-open-*` with its id; a row whose model says `canDelete: false` renders **no** delete control; one that says true does. Plus, for the forms: every value escaped, the error line shows when set, the save button is disabled while busy, and the doctor form renders a hospital checkbox per hospital with `name="hospitalIds"`.

Anchor every assertion on real markup — `<button class="medrow" data-open-medicine="MED01"` — not on a substring that could match elsewhere on the page. Two tests in this repo's history passed against buggy code by matching text from a different element.

- [ ] **Step 3: Build the screens**

Each list screen: a heading naming the library and how many it holds, a search input (`data-library-search`, filtering client-side on the displayed name), the rows, and an **Add** button at the top. Rows show what identifies the thing at a glance: medicines show the photo thumbnail, name, strength and who takes it; doctors show their photo, name and specialty; hospitals show the name and phone.

The medicine library detail screen shows the five photo slots exactly as the prescription detail does (reuse that markup), the medicine's fields, the unit its form implies, who takes it, an **Edit details** button, and a **Delete** button only when `canDelete`.

The doctor form carries name, specialty, phone, other contact, notes, a **photo** with add/replace/remove, and a checkbox per hospital. The hospital form carries name, phone, address, map link, notes.

`data-form` names: `doctor`, `hospital`. Keep input `name` attributes identical to the server's field names (`name`, `specialty`, `phone`, `other_contact`, `notes`; `address`, `map_link`) so Task 6's handler needs no translation table.

- [ ] **Step 4: Style**

Add to `styles.css` only what the new markup needs; reuse existing row, card, field and button classes wherever they fit. Every touch target at least 44px in **both** directions — measure width as well as height.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/views/libraries.js js/views/forms.js js/views/more.js styles.css tests/views-library.test.js tests/views.test.js
git commit -m "feat: library screens for medicines, doctors and hospitals"
```

---

### Task 6: Wiring, browser check and README

**Files:**
- Modify: `js/app.js`, `js/main.js`, `README.md`
- Test: `tests/app-handlers.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: `SCREENS` entries `medicineLibrary`, `medicineLibraryDetail`, `doctorLibrary`, `hospitalLibrary`, `doctorForm`, `hospitalForm`.

- [ ] **Step 1: Register the screens and extend the click handler**

In `js/main.js` add the six `SCREENS` entries. In `js/app.js` extend the `closest(...)` selector list with every new attribute — `[data-library],[data-add-medicine],[data-add-doctor],[data-add-hospital],[data-open-medicine],[data-open-doctor],[data-open-hospital],[data-edit-doctor],[data-edit-hospital],[data-delete-medicine],[data-delete-doctor],[data-delete-hospital],[data-doctor-photo],[data-remove-doctor-photo],[data-library-search]` — and add a branch for each, following the existing `if (d.open) {…}` style.

- [ ] **Step 2: Add the save and delete handlers**

Follow `runSave`'s existing shape exactly: set busy, render, `await call(...)`, `await loadBoot()`, then navigate and announce; on failure set the error and re-render. **Every one must go through the existing `sessionEnded()` guard** — a save whose reload ends the session must land on the login screen, not a dead spinner.

The doctor form saves in two calls: `addDoctor`/`updateDoctor`, then `setDoctorHospitals` with the ticked ids. Read the hospital checkboxes with `FormData.getAll("hospitalIds")` — **not** `Object.fromEntries`, which keeps only the last ticked box. That exact mistake silently reduced a Mon/Wed/Fri prescription to Friday alone earlier in this project; the same trap is here. Test it with two hospitals ticked.

Every delete asks first with `confirm()`, naming the thing and saying what happens.

- [ ] **Step 3: Write the handler tests**

Assert payloads, not the DOM: submitting the doctor form with two hospitals ticked sends both ids; a failed save leaves `formError` set and `formBusy` false; a declined `confirm()` sends no request at all.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Browser check**

Headless Chrome over the DevTools Protocol with `Emulation.setDeviceMetricsOverride` at 390×844 **and** 320×700 — a plain `--window-size` does not emulate mobile width on this machine and gives a false pass. A driver from earlier work is in the scratchpad directory; reuse it rather than writing another.

In mock mode, walk: More → each of the three libraries → search → add one of each → edit one of each → open a medicine from the library and upload a photo → add a doctor photo → delete an unused one of each (declining the confirm first, then accepting). Assert at both widths that `document.documentElement.scrollWidth <= innerWidth`, no element exceeds the viewport, and no control is under 44px in either direction.

- [ ] **Step 6: Update the README**

Add a short section saying the three libraries live under More, that they are shared — everyone sees and edits the same lists — and that anything in use cannot be deleted, with the reason (it keeps the records readable). Match the existing non-technical voice. Note that adding a doctor makes them available in "Who prescribed it?" straight away.

- [ ] **Step 7: Commit**

```bash
npm test
git add js/app.js js/main.js README.md tests/app-handlers.test.js
git commit -m "feat: wire the libraries to the server, with doctor photos"
```

- [ ] **Step 8: Hand back**

Do **not** push or deploy. Report the commit range, the test count, what you saw in the browser at both widths, and anything left parked.

---

## Self-Review

**Spec coverage.** The v2 spec's §3 "Medicines, Hospitals, Doctors — shared family libraries with no person attached; doctors can work at several hospitals (DoctorHospitals); doctors have a photo" → Tasks 1, 2, 3, 5. §4's "Medicines, Hospitals, Doctors, DoctorHospitals: every logged-in user may read and write" → the `requireUser`-only gating in Tasks 1–3. The owner's agreed design (three libraries under More, doctor photos, doctor–hospital links included) → Tasks 5 and 6. The deletion rule is this plan's own, stated once up front and referenced by each task.

**Gap found and closed:** `deleteMedicine` did not exist — the app could add and edit library medicines but never remove one. Added to Task 3, including trashing its photos.

**Type consistency.** `referencesTo(ctx, checks)` is defined in Task 1 and used in Tasks 2 and 3. `doctorPhotoFolderName(doctor)` / `DOCTOR_PHOTO_FILE` are defined in Task 3 Step 3 and used in Step 4. The four models Task 4 produces are consumed under exactly those names in Task 5's interfaces and Task 6's `SCREENS`. `setDoctorHospitals` returns `{hospital_ids}` in Task 2 and is read as such in Task 6.

**Known soft spots the implementer must check rather than guess:** whether `withDrive(ctx)` is exported from `tests/actions-photo.test.js` or must be copied (Task 3 Step 1 says to check and report); the exact array list `indexBoot` requires (Task 4 Step 1 says to read it first); whether `js/viewmodel.js` already defines the five photo-slot labels (Task 4 Step 3 says to reuse them if so).
