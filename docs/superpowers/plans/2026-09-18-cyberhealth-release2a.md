# CyberHealth Release 2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the family add and change medicines and prescriptions from the app instead of the Google Sheet, with every change recorded as history and photos uploaded from the phone.

**Architecture:** A single server helper, `applyPrescriptionChange`, wraps every prescription write so no action can alter a prescription without appending a `PrescriptionChanges` row. Pure logic stays in `js/` and `server/` ES modules that `scripts/sync-gs.mjs` machine-copies into `apps-script/*.gs`; anything that calls a Google service stays hand-written in `apps-script/`. The frontend adds edit controls and three forms to the existing no-build vanilla-ES-module screens.

**Tech Stack:** Vanilla ES modules (no build step), Google Apps Script, Google Sheets, Google Drive, `node:test`, `node:vm`, Chrome DevTools Protocol.

**Spec:** `docs/superpowers/specs/2026-09-18-cyberhealth-release2a-design.md`

## The test fixture, as it actually is

Every test below is written against `tests/fixtures.js` as it stands today. Verified, not assumed — do not re-derive it:

- **Helpers:** `fakeCtx(tables = fixtureTables())` (not `makeCtx`) and `loginAs(ctx, displayName, password)` — it takes the **display name and password**, never a user id. `NOW` is `2026-09-15T01:00:00Z`, i.e. Tue 15 Sep 2026 08:00 Bangkok.
- **Users:** `U01` Dad (`dad123`, Primary), `U02` Pim (`pim123`), `U03` Top (no password, reset code `123456`), `U04` Old (**inactive** — it cannot log in, so never use it as a "stranger").
- **Sharing:** `SH01` U01 → **everyone**, Medicines, **Edit**. `SH02` U01 → everyone, Care team, View. `SH03` U02 → U03, Medicines, **View**.
  So **every active user can already edit U01's medicines.** To test a refusal, use **U02 as the owner**: U03 has View on U02 (refused), and U01 has no grant at all on U02 (refused).
- **Medicines:** `MED01` Amlodipine 5 mg, `MED02` Metformin 500 mg, `MED03` Epoetin alfa, `MED04` Paracetamol, `MED05` Vitamin C.
- **Prescriptions:** `RX01` U01/MED01 Daily, Morning **2 tablet**. `RX02` U01/MED02 Daily, Morning 1 + Evening 2. `RX03` U01/MED03 Weekdays Wed. `RX04` U01/MED04 As needed. `RX05` **U02**/MED01 Every 2 days, Bedtime 0.5. `RX06` U01/MED05 **Stopped**, Morning 1.
- **`DoseLog` is empty.** Any test that needs a ticked dose must create one first, through the `tick` action.

Where a test needs something the fixture lacks, add it — but never change an existing row or Sharing grant without running the full suite, since release 1's tests are written against them.

## Global Constraints

These bind every task. Values are copied verbatim from the spec and the existing codebase.

- **No Sheet change.** Every column this release writes already exists in `CyberHealth_Sheet_v2.xlsx`. No task edits `scripts/make_template_v2.py`.
- **Apps Script load order is unspecified.** No top-level statement in any `apps-script/*.gs` file may reference a name defined in another file. Only code inside a function body may. Every top-level name must be unique across all `.gs` files.
- **Synced files are machine-generated.** `js/schedule.js`, `js/access.js`, `js/authcore.js`, `server/actions.js` and (from Task 2) `server/photos.js` are copied into `apps-script/` by `npm run sync-gs`. Never hand-edit `apps-script/Schedule.gs`, `Access.gs`, `AuthCore.gs`, `Actions.gs` or `Photos.gs`. Keep every `import` on one line — the sync strips whole lines matching `/^\s*import\s/`.
- **`js/config.js` must always ship `export const API_URL = "";`** — never a real address.
- **Time zone is Asia/Bangkok, fixed UTC+7.** Dates are `"YYYY-MM-DD"` via `bangkokToday(nowMs)`; timestamps are `"YYYY-MM-DD HH:mm"` via `bangkokStamp(nowMs)`. Never use `new Date()` directly in server or schedule code.
- **Times of day are Title Case:** `"Morning"`, `"Noon"`, `"Evening"`, `"Bedtime"` (`TIMES_OF_DAY`).
- **Frequencies** come from `FREQ`: `"Daily"`, `"Every N days"`, `"Weekdays"`, `"As needed"`.
- **Meal timings:** `"Before meal"`, `"After meal"`, `"With meal"`, `"Any time"`.
- **Change types** (Lists tab, exact strings): `"Started"`, `"Dose changed"`, `"Schedule changed"`, `"Stopped"`, `"Restarted"`, `"Corrected"`.
- **Statuses:** `"Active"`, `"Stopped"`.
- **Error codes:** `AUTH_REQUIRED`, `AUTH_FAILED`, `LOCKED_OUT`, `FORBIDDEN`, `NOT_DUE`, `FUTURE_DATE`, `BAD_INPUT`, `CONFLICT`, `SERVER`. Raise with `throw new AppError(code, message)`.
- **Every user-facing message is plain English a non-technical family member reads on a phone.** No jargon, no error numbers, no "invalid input". Say what is wrong and what to do.
- **Ids** come from `ctx.newId(prefix)`. Prefixes: `"RX"` prescriptions, `"DS"` doses, `"CH"` changes, `"MED"` medicines.
- **Every write takes the script lock** via `ctx.lock(fn)` and re-reads inside it whatever it guards.
- **Escape all interpolated text in views** with `esc()` from `js/html.js`.
- **Ticking stays owner-only.** No task changes `canTick`.
- **`DoseLog` is never written, updated or deleted by any prescription or medicine action.** Only `tick`, `tickAll` and `untick` touch it.
- **Run `npm test` before every commit.** All tests must pass. The suite is 198 tests at the start of this plan.
- **Run `npm run sync-gs` and commit the regenerated `apps-script/*.gs`** in the same commit as any change to a synced source file.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `js/schedule.js` | add `describeSchedule` (pure wording for history rows) | 1 |
| `server/photos.js` | **new** (salvaged from `phase-2`): photo slots, data-URL parsing, Drive folder and file naming | 2 |
| `apps-script/Drive.gs` | **new** (salvaged, hand-written): `DriveStore`, `SheetSettings` | 2 |
| `js/photoinput.js` | **new** (salvaged, browser-only): pick and shrink a photo | 6 |
| `server/prescriptions.js` | **new**: pure validation of prescription and dose input | 3 |
| `server/actions.js` | `applyPrescriptionChange` + the nine new actions | 3, 4, 5 |
| `js/views/today.js` | render the taken amount on ticked rows | 7 |
| `js/views/forms.js` | **new**: the medicine form, prescription form and dose form | 8 |
| `js/views/meds.js`, `js/views/detail.js` | edit controls, gated on `canEdit` | 8 |
| `js/viewmodel.js` | `canEditOwner`, `medicineFormModel`, `prescriptionFormModel` | 8 |
| `js/app.js`, `js/main.js` | screens, handlers, event wiring | 8, 9 |
| `README.md` | deploy steps, Sharing row, sync list | 10 |

Task order matters: 1–2 are leaf utilities, 3 builds the engine every later server task uses, 4–5 are the actions, 6–7 are small frontend pieces with no dependency on the forms, 8–9 are the screens, 10 is documentation and the live check.

---

### Task 1: `describeSchedule` — the words that go in history

**Files:**
- Modify: `js/schedule.js` (append after `describeDoses`, which ends at line 258)
- Test: `tests/schedule.test.js`

**Interfaces:**
- Consumes: `describeFrequency(prescription)`, `describeDoses(doses)`, both already exported from `js/schedule.js`.
- Produces: `describeSchedule(prescription, doses)` → `string`. `prescription` is the object `normalizePrescription(row).prescription` returns (fields `id, userId, medicineId, freq, n, days, countFrom, meal, doctorId, status, startedOn, notes`). `doses` is an array of `normalizeDose(row).dose` objects (fields `id, prescriptionId, timeOfDay, amount, unit`). Tasks 3–5 write its result into `PrescriptionChanges.before` and `.after`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/schedule.test.js`:

```js
test("describeSchedule joins frequency, meal timing and doses into one readable line", () => {
  const p = { freq: FREQ.DAILY, n: 0, days: [], meal: "After meal" };
  const doses = [
    { timeOfDay: "Morning", amount: 1, unit: "tablet" },
    { timeOfDay: "Evening", amount: 2, unit: "tablet" },
  ];
  assert.equal(describeSchedule(p, doses), "Every day, after meal: Morning 1 tablet, Evening 2 tablets");
});

test("describeSchedule leaves out the meal timing when it is Any time", () => {
  const p = { freq: FREQ.DAILY, n: 0, days: [], meal: "Any time" };
  const doses = [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }];
  assert.equal(describeSchedule(p, doses), "Every day: Morning 1 tablet");
});

test("describeSchedule orders doses Morning, Noon, Evening, Bedtime whatever order they arrive in", () => {
  const p = { freq: FREQ.DAILY, n: 0, days: [], meal: "Any time" };
  const doses = [
    { timeOfDay: "Bedtime", amount: 1, unit: "tablet" },
    { timeOfDay: "Morning", amount: 2, unit: "tablet" },
  ];
  assert.equal(describeSchedule(p, doses), "Every day: Morning 2 tablets, Bedtime 1 tablet");
});

test("describeSchedule says only 'When needed' for an As-needed prescription with no doses", () => {
  const p = { freq: FREQ.AS_NEEDED, n: 0, days: [], meal: "Any time" };
  assert.equal(describeSchedule(p, []), "When needed");
});

test("describeSchedule names an every-N-days schedule and its weekday list", () => {
  const every = { freq: FREQ.EVERY_N, n: 3, days: [], meal: "Any time" };
  assert.equal(describeSchedule(every, [{ timeOfDay: "Morning", amount: 1, unit: "shot" }]), "Every 3 days: Morning 1 shot");
  const week = { freq: FREQ.WEEKDAYS, n: 0, days: ["Mon", "Thu"], meal: "Before meal" };
  assert.equal(describeSchedule(week, [{ timeOfDay: "Noon", amount: 1, unit: "capsule" }]), "Mon + Thu, before meal: Noon 1 capsule");
});
```

Make sure `describeSchedule` and `FREQ` are in the import list at the top of `tests/schedule.test.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -E "describeSchedule|# (pass|fail)"`
Expected: FAIL — `describeSchedule is not a function`.

- [ ] **Step 3: Implement**

Append to `js/schedule.js`:

```js
// The wording stored in PrescriptionChanges.before / .after. Words, not ids, so a change still
// reads correctly years later even if the medicine or doctor behind it is renamed.
export function describeSchedule(prescription, doses) {
  const freq = describeFrequency(prescription);
  const meal = String(prescription.meal || "").trim();
  const head = meal && meal !== "Any time" ? `${freq}, ${meal.toLowerCase()}` : freq;
  if (!doses || doses.length === 0) return head;
  const byTime = new Map();
  doses.forEach(d => { if (!byTime.has(d.timeOfDay)) byTime.set(d.timeOfDay, d); });
  const parts = TIMES_OF_DAY.filter(t => byTime.has(t)).map(t => {
    const d = byTime.get(t);
    return `${t} ${d.amount} ${pluralUnit(d.unit, d.amount)}`;
  });
  return parts.length ? `${head}: ${parts.join(", ")}` : head;
}
```

`pluralUnit` is already defined above `describeDoses` in this file; it is module-private and needs no export.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 203 tests.

- [ ] **Step 5: Sync and commit**

```bash
npm run sync-gs
git add js/schedule.js apps-script/Schedule.gs tests/schedule.test.js
git commit -m "feat: describeSchedule renders a prescription as the words stored in its history"
```

---

### Task 2: Photo helpers and the Drive adapter

Salvage from the abandoned `phase-2` branch, renamed to v2 columns. Read each file off that branch with `git show phase-2:<path>` rather than retyping it.

**Files:**
- Create: `server/photos.js` (from `git show phase-2:server/photos.js`)
- Create: `apps-script/Drive.gs` (from `git show phase-2:apps-script/Drive.gs`)
- Modify: `scripts/sync-gs.mjs` — add `["server/photos.js", "Photos.gs"]` to `FILES`
- Test: `tests/photos.test.js` (from `git show phase-2:tests/photos.test.js`, adapted)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `PHOTO_SLOTS` = `["box", "packet_front", "packet_back", "pill_front", "pill_back"]`
  - `MAX_PHOTO_BYTES` = `6 * 1024 * 1024`
  - `isPhotoSlot(slot)` → `boolean`
  - `photoColumn(slot)` → `"photo_box"` … `"photo_pill_back"`, or `""` for an unknown slot
  - `parseDataUrl(dataUrl)` → `{mimeType, base64, bytes}` or `null`
  - `photoFolderName(medicine)` → `string`, built from `medicine.medicine_id`, `.generic_name`, `.strength`
  - `photoFileName(slot, mimeType)` → `"box.jpg"` / `"box.png"`
  - `isSameSlotFile(existingName, slot)` → `boolean`
  - In Apps Script only (hand-written, not synced): `DriveStore.folder(rootId, name)`, `DriveStore.putImage(rootId, folderName, fileName, base64, mimeType)` → `{id, url}`, `DriveStore.trashByUrl(url)` → `boolean`, `SheetSettings.get(key)` → `string`.

- [ ] **Step 1: Bring the files across**

```bash
git show phase-2:server/photos.js > server/photos.js
git show phase-2:apps-script/Drive.gs > apps-script/Drive.gs
git show phase-2:tests/photos.test.js > tests/photos.test.js
```

- [ ] **Step 2: Rename `med_id` to `medicine_id`**

In `server/photos.js`, `photoFolderName` reads `med.med_id`. The v2 `Medicines` key column is `medicine_id`. Change that one property read, and change the parameter name from `medication` to `medicine` throughout the function. Do the same in `tests/photos.test.js`. Nothing else in either file references `med_id` — confirm with:

```bash
grep -rn "med_id" server/photos.js apps-script/Drive.gs tests/photos.test.js
```
Expected after the edit: no output.

- [ ] **Step 3: Register the file for syncing**

In `scripts/sync-gs.mjs`, add to the `FILES` array, after the `server/actions.js` entry:

```js
  ["server/photos.js", "Photos.gs"],
```

- [ ] **Step 4: Add a test that the folder name keeps two same-named medicines apart**

Append to `tests/photos.test.js`:

```js
test("photoFolderName puts medicine_id first, so two brands of one generic never share a folder", () => {
  const a = { medicine_id: "MED01", generic_name: "Metformin", strength: "500 mg" };
  const b = { medicine_id: "MED02", generic_name: "Metformin", strength: "500 mg" };
  assert.equal(photoFolderName(a), "MED01 Metformin 500 mg");
  assert.equal(photoFolderName(b), "MED02 Metformin 500 mg");
  assert.notEqual(photoFolderName(a), photoFolderName(b));
});

test("photoColumn maps every slot to a real v2 Medicines column, and rejects anything else", () => {
  assert.deepEqual(PHOTO_SLOTS.map(photoColumn), [
    "photo_box", "photo_packet_front", "photo_packet_back", "photo_pill_front", "photo_pill_back",
  ]);
  assert.equal(photoColumn("sideways"), "");
  assert.equal(isPhotoSlot("sideways"), false);
});

test("parseDataUrl accepts JPEG and PNG and refuses anything else", () => {
  const jpeg = parseDataUrl("data:image/jpeg;base64,/9j/4AAQ");
  assert.equal(jpeg.mimeType, "image/jpeg");
  assert.ok(jpeg.bytes > 0);
  assert.equal(parseDataUrl("data:image/gif;base64,R0lGOD"), null);
  assert.equal(parseDataUrl("https://example.com/x.jpg"), null);
  assert.equal(parseDataUrl(""), null);
});
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS. The `tests/sync.test.js` suite checks every entry in `FILES` round-trips, so it now also covers `Photos.gs`.

- [ ] **Step 6: Sync and commit**

```bash
npm run sync-gs
git add server/photos.js apps-script/Drive.gs apps-script/Photos.gs scripts/sync-gs.mjs tests/photos.test.js
git commit -m "feat: salvage photo helpers and the Drive adapter from phase-2, renamed to v2 columns"
```

---

### Task 3: Prescription input validation + `applyPrescriptionChange`

The engine every prescription action in Tasks 4 and 5 goes through.

**Files:**
- Create: `server/prescriptions.js`
- Modify: `scripts/sync-gs.mjs` — add `["server/prescriptions.js", "Prescriptions.gs"]` to `FILES`
- Modify: `server/actions.js` — add the private helper `applyPrescriptionChange`
- Test: `tests/prescriptions.test.js` (new), `tests/actions-write.test.js` (new)

**Interfaces:**
- Consumes: `describeSchedule(prescription, doses)` (Task 1). From `js/schedule.js`: `TIMES_OF_DAY`, `FREQ`, `normalizePrescription`, `normalizeDose`, `bangkokStamp`, `bangkokToday`, `parseDate`. From `js/access.js`: `canEdit(viewerId, ownerId, section, sharing)`. From `server/actions.js` (already present): `AppError`, `requireUser(req, ctx)`, `sharingRows(ctx)`, `str(v)`, `stripRow(r)`, `activeUsers(ctx)`.
- Produces:
  - `validateDoses(doses, frequency)` → `{ok: true, doses: [{timeOfDay, amount, unit}]}` or `{ok: false, reason}`
  - `validateScheduleFields(fields)` → `{ok: true, fields: {frequency, every_n_days, weekdays, count_from, meal_timing}}` or `{ok: false, reason}`
  - `CHANGE_TYPES` = `["Started", "Dose changed", "Schedule changed", "Stopped", "Restarted", "Corrected"]`
  - `MAX_REASON_LENGTH` = `500`
  - In `server/actions.js`, module-private: `applyPrescriptionChange(ctx, user, prescriptionId, changeType, mutate, opts)` → the `{prescription, doses}` shape Tasks 4–5 return. `mutate` is `() => void` and runs between the before and after reads. `opts` is `{reason, doctorId}`, both optional.

- [ ] **Step 1: Write the failing validation tests**

Create `tests/prescriptions.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDoses, validateScheduleFields, CHANGE_TYPES, MAX_REASON_LENGTH } from "../server/prescriptions.js";
import { FREQ } from "../js/schedule.js";

test("validateDoses accepts one row per time of day and normalises the numbers", () => {
  const r = validateDoses([{ timeOfDay: "Morning", amount: "1", unit: "tablet" }], FREQ.DAILY);
  assert.deepEqual(r, { ok: true, doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }] });
});

test("validateDoses refuses two rows for the same time of day", () => {
  const r = validateDoses([
    { timeOfDay: "Morning", amount: 1, unit: "tablet" },
    { timeOfDay: "Morning", amount: 2, unit: "tablet" },
  ], FREQ.DAILY);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Morning/);
});

test("validateDoses refuses an amount of zero or less, naming the time of day", () => {
  const r = validateDoses([{ timeOfDay: "Evening", amount: 0, unit: "tablet" }], FREQ.DAILY);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Evening/);
});

test("validateDoses refuses an unknown time of day", () => {
  const r = validateDoses([{ timeOfDay: "Teatime", amount: 1, unit: "tablet" }], FREQ.DAILY);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Teatime/);
});

test("validateDoses refuses a missing unit", () => {
  const r = validateDoses([{ timeOfDay: "Morning", amount: 1, unit: "  " }], FREQ.DAILY);
  assert.equal(r.ok, false);
  assert.match(r.reason, /unit/i);
});

test("validateDoses needs at least one dose for a scheduled prescription", () => {
  const r = validateDoses([], FREQ.DAILY);
  assert.equal(r.ok, false);
  assert.match(r.reason, /at least one/i);
});

test("validateDoses accepts no doses at all when the frequency is As needed", () => {
  assert.deepEqual(validateDoses([], FREQ.AS_NEEDED), { ok: true, doses: [] });
});

test("validateScheduleFields returns Sheet-shaped columns for a daily schedule", () => {
  const r = validateScheduleFields({ frequency: FREQ.DAILY, mealTiming: "After meal" });
  assert.deepEqual(r, { ok: true, fields: { frequency: "Daily", every_n_days: "", weekdays: "", count_from: "", meal_timing: "After meal" } });
});

test("validateScheduleFields requires every_n_days and count_from for an every-N-days schedule", () => {
  assert.equal(validateScheduleFields({ frequency: FREQ.EVERY_N, everyNDays: 0, countFrom: "2026-09-18" }).ok, false);
  assert.equal(validateScheduleFields({ frequency: FREQ.EVERY_N, everyNDays: 3, countFrom: "" }).ok, false);
  const good = validateScheduleFields({ frequency: FREQ.EVERY_N, everyNDays: 3, countFrom: "2026-09-18" });
  assert.deepEqual(good.fields, { frequency: "Every N days", every_n_days: "3", weekdays: "", count_from: "2026-09-18", meal_timing: "Any time" });
});

test("validateScheduleFields joins weekdays with commas and refuses an unknown day", () => {
  const good = validateScheduleFields({ frequency: FREQ.WEEKDAYS, weekdays: ["Mon", "Thu"] });
  assert.equal(good.fields.weekdays, "Mon, Thu");
  const bad = validateScheduleFields({ frequency: FREQ.WEEKDAYS, weekdays: ["Mon", "Funday"] });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /Funday/);
});

test("validateScheduleFields refuses an unknown frequency and an unknown meal timing", () => {
  assert.equal(validateScheduleFields({ frequency: "Sometimes" }).ok, false);
  assert.equal(validateScheduleFields({ frequency: FREQ.DAILY, mealTiming: "Whenever" }).ok, false);
});

test("the change types match the Sheet's Lists tab exactly", () => {
  assert.deepEqual(CHANGE_TYPES, ["Started", "Dose changed", "Schedule changed", "Stopped", "Restarted", "Corrected"]);
  assert.equal(MAX_REASON_LENGTH, 500);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — cannot find module `../server/prescriptions.js`.

- [ ] **Step 3: Implement the validators**

Create `server/prescriptions.js`:

```js
// Pure validation for prescription writes: no DOM, no Node APIs, no Sheet access.
// Synced to Apps Script by scripts/sync-gs.mjs, so keep names unique across all synced files.
import { TIMES_OF_DAY, FREQ, WEEKDAYS, parseDate } from "../js/schedule.js";

export const CHANGE_TYPES = ["Started", "Dose changed", "Schedule changed", "Stopped", "Restarted", "Corrected"];
export const MAX_REASON_LENGTH = 500;
const MEAL_TIMING_VALUES = ["Before meal", "After meal", "With meal", "Any time"];

const txt = v => String(v == null ? "" : v).trim();

export function validateDoses(doses, frequency) {
  const list = Array.isArray(doses) ? doses : [];
  const fail = reason => ({ ok: false, reason });
  const out = [];
  const seen = {};
  for (const raw of list) {
    const timeOfDay = txt(raw && raw.timeOfDay);
    if (!TIMES_OF_DAY.includes(timeOfDay)) return fail(`"${timeOfDay}" isn't a time of day. Use Morning, Noon, Evening or Bedtime.`);
    if (seen[timeOfDay]) return fail(`There are two ${timeOfDay} rows. Put the whole ${timeOfDay} amount on one row.`);
    seen[timeOfDay] = true;
    const amount = Number(raw.amount);
    if (!(amount > 0)) return fail(`The ${timeOfDay} amount must be more than 0.`);
    const unit = txt(raw.unit);
    if (!unit) return fail(`The ${timeOfDay} row needs a unit, like tablet or ml.`);
    out.push({ timeOfDay, amount, unit });
  }
  if (out.length === 0 && txt(frequency) !== FREQ.AS_NEEDED) {
    return fail("Add at least one time of day, so it shows up on Today.");
  }
  return { ok: true, doses: out };
}

export function validateScheduleFields(fields) {
  const f = fields || {};
  const fail = reason => ({ ok: false, reason });
  const frequency = txt(f.frequency);
  if (!Object.values(FREQ).includes(frequency)) {
    return fail(`"${frequency}" isn't a schedule the app knows. Pick every day, every so many days, certain weekdays, or when needed.`);
  }
  const mealRaw = txt(f.mealTiming) || "Any time";
  if (!MEAL_TIMING_VALUES.includes(mealRaw)) return fail(`"${mealRaw}" isn't a meal timing the app knows.`);

  let everyNDays = "";
  let countFrom = "";
  if (frequency === FREQ.EVERY_N) {
    const n = Number(f.everyNDays);
    if (!Number.isInteger(n) || n < 1) return fail("How many days between doses? Type a whole number of 1 or more.");
    everyNDays = String(n);
    countFrom = parseDate(f.countFrom);
    if (!countFrom) return fail("Pick the day to count from, so the app knows which days are dose days.");
  }

  let weekdays = "";
  if (frequency === FREQ.WEEKDAYS) {
    const days = Array.isArray(f.weekdays) ? f.weekdays.map(txt).filter(Boolean) : [];
    if (days.length === 0) return fail("Pick at least one day of the week.");
    const picked = [];
    for (const d of days) {
      if (!WEEKDAYS.includes(d)) return fail(`"${d}" isn't a day of the week.`);
      if (!picked.includes(d)) picked.push(d);
    }
    weekdays = WEEKDAYS.filter(d => picked.includes(d)).join(", ");
  }

  return { ok: true, fields: { frequency, every_n_days: everyNDays, weekdays, count_from: countFrom, meal_timing: mealRaw } };
}
```

- [ ] **Step 4: Register the file for syncing**

In `scripts/sync-gs.mjs`, add to `FILES` **before** the `server/actions.js` entry (order in this array is only the write order, but keeping dependencies first reads better):

```js
  ["server/prescriptions.js", "Prescriptions.gs"],
```

- [ ] **Step 5: Run the validator tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Note the tests that Task 4 will carry**

**Do not create `tests/actions-write.test.js` in this task.** `applyPrescriptionChange` is a private helper with no action calling it yet, so it cannot be exercised until Task 4 lands the actions — and this plan's Global Constraints require every commit to leave the suite green. Task 4 creates that file and carries the three tests below along with its own.

They are reproduced here only so you can see what your helper must satisfy; **they are Task 4's to write**, not yours.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/actions.js";
import { fakeCtx, loginAs } from "./fixtures.js";

// Pim (U02) edits Dad's (U01) RX01 — the fixture's SH01 grants the whole family Edit on U01's
// Medicines. RX01 is Amlodipine, Daily, Morning 2 tablet.
test("a dose change appends exactly one history row, with before and after in words", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const before = ctx.db.rows("PrescriptionChanges").length;
  const r = handle({
    action: "changePrescriptionDose",
    token,
    prescriptionId: "RX01",
    doses: [{ timeOfDay: "Morning", amount: 0.5, unit: "tablet" }],
    reason: "Doctor halved it",
  }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const rows = ctx.db.rows("PrescriptionChanges");
  assert.equal(rows.length, before + 1);
  const change = rows[rows.length - 1];
  assert.equal(change.prescription_id, "RX01");
  assert.equal(change.change_type, "Dose changed");
  assert.equal(change.changed_by, "U02", "the acting user, not the owner");
  assert.equal(change.reason, "Doctor halved it");
  assert.match(change.before, /Morning 2 tablets/);
  assert.match(change.after, /Morning 0.5 tablet/);
  assert.match(change.changed_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.ok(change.change_id, "every change row gets an id");
});

test("a prescription write stamps updated_at and updated_by on the Prescriptions row", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }] }, ctx);
  const rx = ctx.db.rows("Prescriptions").find(r => r.prescription_id === "RX01");
  assert.equal(rx.updated_by, "U02");
  assert.match(rx.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("a reason longer than 500 characters is cut to 500, not refused", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }], reason: "x".repeat(700) }, ctx);
  const rows = ctx.db.rows("PrescriptionChanges");
  assert.equal(rows[rows.length - 1].reason.length, 500);
});
```

Note `describeDoses`/`describeSchedule` pluralise the unit, so 2 tablets renders as `Morning 2 tablets` and 0.5 as `Morning 0.5 tablets` — match on what `pluralUnit` actually produces rather than assuming the singular.

- [ ] **Step 7: Implement `applyPrescriptionChange`**

Add to `server/actions.js`, among the other private helpers (after `writeTaken`, before the `Object.assign(ACTIONS, {…})` block that begins at line 209). Add `describeSchedule` to the existing one-line import from `../js/schedule.js`, and add a one-line import from `../server/prescriptions.js` for `validateDoses`, `validateScheduleFields` and `MAX_REASON_LENGTH`.

```js
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
  const doctorId = options.doctorId === undefined ? end.prescription.doctorId : str(options.doctorId);
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
  return { prescription: stripRow(end.row), doses: end.doses };
}
```

**`end.row` is stale by the time it is returned.** `dev/memory-db.js` `update()` does `Object.assign(r, patch)` on the live object, so in tests the stamps appear on `end.row` for free — but `SheetDb.update` in `apps-script/Data.gs` writes to the spreadsheet and does **not** touch the object you already read. Returning `stripRow(end.row)` would therefore pass every Node test and hand the phone a row with no `updated_at` in production. Re-read explicitly as the last step:

```js
  const saved = ctx.db.rows("Prescriptions").find(r => str(r.prescription_id) === prescriptionId);
  return { prescription: stripRow(saved), doses: end.doses };
```

Add a test that pins this, so the divergence cannot come back:

```js
test("the row handed back to the phone carries the stamps that were just written", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }] }, ctx);
  assert.equal(r.data.prescription.updated_by, "U02");
  assert.match(r.data.prescription.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});
```

- [ ] **Step 8: Run the tests**

Run: `npm test`
Expected: PASS — every existing test plus the new `tests/prescriptions.test.js`. `applyPrescriptionChange` and `readPrescription` are defined but not yet called by any action; that is expected and Task 4 covers them. If any pre-existing test now fails, that is a real regression from your import edits — fix it before committing.

- [ ] **Step 9: Sync and commit**

```bash
npm run sync-gs
git add server/prescriptions.js server/actions.js scripts/sync-gs.mjs apps-script/Prescriptions.gs apps-script/Actions.gs tests/prescriptions.test.js
git commit -m "feat: prescription input validation and the change engine that records every edit"
```

---

### Task 4: Prescription actions

**Files:**
- Modify: `server/actions.js` — register six actions
- Create: `tests/actions-write.test.js` — **this task creates it**, carrying Task 3's three `applyPrescriptionChange` tests (reproduced in Task 3 Step 6) plus every test below

**Interfaces:**
- Consumes: `applyPrescriptionChange`, `readPrescription`, `validateDoses`, `validateScheduleFields` (Task 3); `canEdit` from `js/access.js`; `sharingRows(ctx)`, `requireUser`, `AppError`, `str`, `stripRow`, `activeUsers` from `server/actions.js`.
- Produces: actions `addPrescription`, `changePrescriptionDose`, `changePrescriptionSchedule`, `stopPrescription`, `restartPrescription`, `deletePrescription`. All except `deletePrescription` return `{prescription, doses}`; `deletePrescription` returns `{deleted: true}`. Task 8's frontend calls these by name.

- [ ] **Step 1: Write the failing tests**

Create `tests/actions-write.test.js`. Start it with the header and the three `applyPrescriptionChange` tests shown in Task 3 Step 6 (copy them verbatim — they are this task's to write), then append everything below into the same file.

```js
// Refusals are tested against U02 as the owner. U01's Sharing row (SH01) already grants the
// WHOLE family Edit on his medicines, so no active user can be refused on him.
test("a viewer with only View access cannot change a dose", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Top", "shared-code-pw"); // see the note below on logging Top in
  const r = handle({ action: "changePrescriptionDose", token, prescriptionId: "RX05", doses: [{ timeOfDay: "Bedtime", amount: 1, unit: "tablet" }] }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "FORBIDDEN");
  assert.match(r.error.message, /Pim/, "the message names who to ask");
});

test("someone with no sharing row at all cannot change another person's dose", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123"); // U01 has no grant on U02's medicines
  const r = handle({ action: "changePrescriptionDose", token, prescriptionId: "RX05", doses: [{ timeOfDay: "Bedtime", amount: 1, unit: "tablet" }] }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "FORBIDDEN");
});

test("addPrescription writes the prescription, its dose rows and a Started history row", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const med = handle({ action: "addMedicine", token, fields: { generic_name: "Losartan", strength: "50 mg" } }, ctx);
  const r = handle({
    action: "addPrescription", token, userId: "U01", medicineId: med.data.medicine_id,
    frequency: "Daily", mealTiming: "After meal",
    doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }],
  }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const id = r.data.prescription.prescription_id;
  assert.ok(id.startsWith("RX-"));
  assert.equal(r.data.doses.length, 1);
  assert.equal(ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === id).length, 1);
  const change = ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === id);
  assert.equal(change.length, 1);
  assert.equal(change[0].change_type, "Started");
  assert.equal(change[0].before, "", "a Started row has nothing before it");
  assert.match(change[0].after, /Every day, after meal: Morning 1 tablet/);
});

test("addPrescription refuses a second active prescription for the same person and medicine", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // RX01 already has U01 on MED01, Active.
  const r = handle({
    action: "addPrescription", token, userId: "U01", medicineId: "MED01",
    frequency: "Daily", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }],
  }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CONFLICT");
});

test("addPrescription allows a medicine whose only other prescription is Stopped", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // RX06 is U01 on MED05, Stopped — so a fresh active one is fine.
  const r = handle({
    action: "addPrescription", token, userId: "U01", medicineId: "MED05",
    frequency: "Daily", doses: [{ timeOfDay: "Noon", amount: 1, unit: "tablet" }],
  }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("addPrescription refuses a start date in the future", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const r = handle({
    action: "addPrescription", token, userId: "U01", medicineId: "MED05",
    frequency: "Daily", startedOn: "2099-01-01",
    doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }],
  }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
});

test("changePrescriptionSchedule replaces the schedule and records Schedule changed", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // RX05 is U02's Every-2-days prescription; U01 cannot touch it, so use U01's own RX03 (Weekdays Wed).
  const r = handle({ action: "changePrescriptionSchedule", token, prescriptionId: "RX03", frequency: "Weekdays", weekdays: ["Mon", "Thu"] }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const rx = ctx.db.rows("Prescriptions").find(x => x.prescription_id === "RX03");
  assert.equal(rx.frequency, "Weekdays");
  assert.equal(rx.weekdays, "Mon, Thu");
  assert.equal(rx.every_n_days, "", "the every-N fields are cleared, not left stale");
  const rows = ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === "RX03");
  assert.equal(rows[rows.length - 1].change_type, "Schedule changed");
});

test("switching to Every N days and back to Daily clears count_from, leaving no stale field", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  handle({ action: "changePrescriptionSchedule", token, prescriptionId: "RX01", frequency: "Every N days", everyNDays: 3, countFrom: "2026-09-15" }, ctx);
  handle({ action: "changePrescriptionSchedule", token, prescriptionId: "RX01", frequency: "Daily" }, ctx);
  const rx = ctx.db.rows("Prescriptions").find(x => x.prescription_id === "RX01");
  assert.equal(rx.every_n_days, "");
  assert.equal(rx.count_from, "");
  assert.equal(rx.weekdays, "");
});

test("stop then restart flips status and records both, and keeps every dose row", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const dosesBefore = ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === "RX01").length;
  assert.equal(handle({ action: "stopPrescription", token, prescriptionId: "RX01", reason: "BP fine now" }, ctx).ok, true);
  assert.equal(ctx.db.rows("Prescriptions").find(x => x.prescription_id === "RX01").status, "Stopped");
  assert.equal(handle({ action: "restartPrescription", token, prescriptionId: "RX01" }, ctx).ok, true);
  assert.equal(ctx.db.rows("Prescriptions").find(x => x.prescription_id === "RX01").status, "Active");
  assert.equal(ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === "RX01").length, dosesBefore);
  const types = ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === "RX01").map(c => c.change_type);
  assert.deepEqual(types.slice(-2), ["Stopped", "Restarted"]);
});

test("restartPrescription refuses when another active prescription now covers the same medicine", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // RX06 is U01/MED05, already Stopped. Add an active MED05, then try to restart RX06.
  handle({ action: "addPrescription", token, userId: "U01", medicineId: "MED05", frequency: "Daily", doses: [{ timeOfDay: "Noon", amount: 1, unit: "tablet" }] }, ctx);
  const r = handle({ action: "restartPrescription", token, prescriptionId: "RX06" }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CONFLICT");
});

test("deletePrescription removes an untouched prescription with its doses and history", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  const added = handle({ action: "addPrescription", token, userId: "U01", medicineId: "MED05", frequency: "Daily", doses: [{ timeOfDay: "Noon", amount: 1, unit: "tablet" }] }, ctx);
  const id = added.data.prescription.prescription_id;
  const r = handle({ action: "deletePrescription", token, prescriptionId: id }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ctx.db.rows("Prescriptions").filter(x => x.prescription_id === id).length, 0);
  assert.equal(ctx.db.rows("PrescriptionDoses").filter(d => d.prescription_id === id).length, 0);
  assert.equal(ctx.db.rows("PrescriptionChanges").filter(c => c.prescription_id === id).length, 0);
});

test("deletePrescription refuses one that has ever been ticked, and says it can be stopped instead", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  // DoseLog starts empty, so tick RX01 first — only Dad may tick his own.
  const tick = handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  assert.equal(tick.ok, true, JSON.stringify(tick));
  const r = handle({ action: "deletePrescription", token, prescriptionId: "RX01" }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CONFLICT");
  assert.match(r.error.message, /stopped/i);
});

test("no prescription action ever touches DoseLog", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Dad", "dad123");
  handle({ action: "tick", token, prescriptionId: "RX01", date: "2026-09-15", timeOfDay: "Morning", doseId: "DS01", amount: 2 }, ctx);
  const before = JSON.stringify(ctx.db.rows("DoseLog"));
  handle({ action: "changePrescriptionDose", token, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 0.5, unit: "tablet" }] }, ctx);
  handle({ action: "changePrescriptionSchedule", token, prescriptionId: "RX01", frequency: "Daily" }, ctx);
  handle({ action: "stopPrescription", token, prescriptionId: "RX01" }, ctx);
  handle({ action: "restartPrescription", token, prescriptionId: "RX01" }, ctx);
  assert.equal(JSON.stringify(ctx.db.rows("DoseLog")), before, "a dose already taken must never be rewritten");
});
```

**Logging in as Top (U03).** The fixture gives U03 a `reset_code` of `123456` and no password, so `loginAs` cannot be used directly. Set one first and use the token it returns:

```js
const token = handle({ action: "setPassword", name: "Top", code: "123456", newPassword: "shared-code-pw" }, ctx).data.token;
```

Use that in the View-access test in place of the `loginAs` call shown above. No fixture change is needed for any test in this task.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | grep -cE "^not ok"`
Expected: a non-zero count — the new tests fail with `Unknown action.`

- [ ] **Step 3: Implement the six actions**

Add a second `Object.assign(ACTIONS, {…})` block at the end of `server/actions.js`:

```js
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
      ctx.db.append("Prescriptions", {
        prescription_id: prescriptionId, user_id: userId, medicine_id: medicineId,
        frequency: schedule.fields.frequency, every_n_days: schedule.fields.every_n_days,
        weekdays: schedule.fields.weekdays, count_from: schedule.fields.count_from,
        meal_timing: schedule.fields.meal_timing, doctor_id: str(req.doctorId),
        status: "Active", started_on: startedOn, notes: str(req.notes).slice(0, MAX_REASON_LENGTH),
        created_at: stamp, created_by: user.user_id, updated_at: stamp, updated_by: user.user_id,
      });
      writeDoseRows(ctx, prescriptionId, doses.doses);
      return applyPrescriptionChange(ctx, user, prescriptionId, "Started", () => {}, { reason: req.reason, doctorId: str(req.doctorId) });
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
      }, { reason: req.reason, doctorId: req.doctorId });
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
        if (req.doctorId !== undefined) patch.doctor_id = str(req.doctorId);
        ctx.db.update("Prescriptions", "prescription_id", prescriptionId, patch);
      }, { reason: req.reason, doctorId: req.doctorId });
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
```

Add `canEdit` and `SECTIONS` to the existing one-line import from `../js/access.js` if they are not already there.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, including every test from Task 3 that was left failing.

- [ ] **Step 5: Sync and commit**

```bash
npm run sync-gs
git add server/actions.js apps-script/Actions.gs tests/actions-write.test.js tests/fixtures.js
git commit -m "feat: add, change, stop, restart and delete prescriptions from the app"
```

---

### Task 5: Medicine library actions and photo upload

**Files:**
- Modify: `server/actions.js` — four more actions
- Modify: `apps-script/Code.gs` — add `drive` and `settings` to the live `ctx`
- Test: `tests/actions-write.test.js`, `tests/actions-photo.test.js` (new)

**Interfaces:**
- Consumes: `PHOTO_SLOTS`, `isPhotoSlot`, `photoColumn`, `parseDataUrl`, `photoFolderName`, `photoFileName`, `MAX_PHOTO_BYTES` (Task 2); `requireUser`, `AppError`, `str`, `stripRow` (existing).
- Produces: actions `addMedicine`, `updateMedicine`, `uploadMedicinePhoto`, `removeMedicinePhoto`. Adds two `ctx` members the Apps Script adapter must supply: `ctx.drive.put(folderName, fileName, base64, mimeType)` → `{id, url}`, `ctx.drive.trash(url)` → `boolean`, and `ctx.settings(key)` → `string`. Task 8's frontend calls the four actions by name.

- [ ] **Step 1: Write the failing tests**

Append to `tests/actions-write.test.js`:

```js
test("addMedicine trims the whitelisted fields and ignores anything else", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "addMedicine", token, fields: { generic_name: "  Losartan ", strength: "50 mg", photo_box: "https://evil/x.jpg", medicine_id: "HACK" } }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.generic_name, "Losartan");
  assert.equal(r.data.photo_box, "", "a photo URL can only be set by uploading");
  assert.ok(r.data.medicine_id.startsWith("MED-"), "the id is the server's, not the caller's");
});

test("addMedicine needs a generic name", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "addMedicine", token, fields: { strength: "50 mg" } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
});

test("updateMedicine changes the shared library row for everyone", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "updateMedicine", token, medicineId: "MED01", fields: { generic_name: "Amlodipine besylate" } }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").generic_name, "Amlodipine besylate");
});

test("any logged-in user may edit the shared library, with no sharing row at all", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Top", "shared-code-pw");
  assert.equal(handle({ action: "addMedicine", token, fields: { generic_name: "Aspirin" } }, ctx).ok, true);
});

test("a logged-out caller may not touch the library", () => {
  const ctx = fakeCtx();
  const r = handle({ action: "addMedicine", fields: { generic_name: "Aspirin" } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "AUTH_REQUIRED");
});
```

Create `tests/actions-photo.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/actions.js";
import { fakeCtx, loginAs } from "./fixtures.js";

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

function withDrive(ctx) {
  const created = [];
  const trashed = [];
  ctx.settings = key => (key === "photo_folder_id" ? "FOLDER123" : "");
  ctx.drive = {
    put: (folderName, fileName, base64, mimeType) => {
      const id = `FILE${created.length + 1}`;
      created.push({ folderName, fileName, base64, mimeType, id });
      return { id, url: `https://drive.google.com/file/d/${id}/view` };
    },
    trash: url => { trashed.push(url); return true; },
  };
  return { created, trashed };
}

test("uploadMedicinePhoto puts the file in the medicine's own folder and stores the link", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(drive.created.length, 1);
  assert.match(drive.created[0].folderName, /^MED01 /);
  assert.equal(drive.created[0].fileName, "box.jpg");
  assert.equal(ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").photo_box, r.data.url);
});

test("replacing a photo trashes exactly the file the column pointed at", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  const first = handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG }, ctx);
  const second = handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG }, ctx);
  assert.equal(second.ok, true);
  assert.deepEqual(drive.trashed, [first.data.url]);
  assert.equal(ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").photo_box, second.data.url);
});

test("a photo upload never touches another medicine's folder", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG }, ctx);
  handle({ action: "uploadMedicinePhoto", token, medicineId: "MED02", slot: "box", dataUrl: JPEG }, ctx);
  assert.notEqual(drive.created[0].folderName, drive.created[1].folderName);
  assert.deepEqual(drive.trashed, [], "two different medicines never clobber each other");
});

test("a failed trash returns a warning instead of failing the save", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  ctx.drive.trash = () => false;
  const token = loginAs(ctx, "Pim", "pim123");
  handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG }, ctx);
  const r = handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG }, ctx);
  assert.equal(r.ok, true);
  assert.ok(r.data.warnings.length > 0);
  assert.ok(ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").photo_box);
});

test("an unknown slot, a non-image and an oversized photo are all refused", () => {
  const ctx = fakeCtx();
  withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  assert.equal(handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "sideways", dataUrl: JPEG }, ctx).error.code, "BAD_INPUT");
  assert.equal(handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: "data:text/html;base64,PGI+" }, ctx).error.code, "BAD_INPUT");
  const huge = `data:image/jpeg;base64,${"A".repeat(9 * 1024 * 1024)}`;
  assert.equal(handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: huge }, ctx).error.code, "BAD_INPUT");
});

test("removeMedicinePhoto clears the column and trashes the file", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  const up = handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG }, ctx);
  const r = handle({ action: "removeMedicinePhoto", token, medicineId: "MED01", slot: "box" }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").photo_box, "");
  assert.deepEqual(drive.trashed, [up.data.url]);
});

test("uploading with no photo folder configured says so in plain words", () => {
  const ctx = fakeCtx();
  withDrive(ctx);
  ctx.settings = () => "";
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG }, ctx);
  assert.equal(r.ok, false);
  assert.match(r.error.message, /folder/i);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | grep -E "^not ok" | head`
Expected: the new tests fail with `Unknown action.`

- [ ] **Step 3: Implement the four actions**

Add to the `Object.assign(ACTIONS, {…})` block from Task 4. Add a one-line import from `../server/photos.js` for `isPhotoSlot`, `photoColumn`, `parseDataUrl`, `photoFolderName`, `photoFileName`, `MAX_PHOTO_BYTES`.

```js
const MEDICINE_FIELDS = ["generic_name", "brand_name", "strength", "form", "purpose", "notes"];

function medicineFields(fields) {
  const patch = {};
  MEDICINE_FIELDS.forEach(k => { if (fields && fields[k] !== undefined) patch[k] = str(fields[k]).slice(0, 200); });
  return patch;
}
```

```js
  addMedicine(req, ctx) {
    const { user } = requireUser(req, ctx);
    const patch = medicineFields(req.fields);
    if (!patch.generic_name) throw new AppError("BAD_INPUT", "A medicine needs a name.");
    return ctx.lock(() => {
      const stamp = bangkokStamp(ctx.nowMs());
      const row = Object.assign({ medicine_id: ctx.newId("MED") }, patch, {
        created_at: stamp, created_by: user.user_id, updated_at: stamp, updated_by: user.user_id,
      });
      ctx.db.append("Medicines", row);
      return stripRow(ctx.db.rows("Medicines").find(m => str(m.medicine_id) === row.medicine_id));
    });
  },

  updateMedicine(req, ctx) {
    const { user } = requireUser(req, ctx);
    const medicineId = str(req.medicineId);
    const patch = medicineFields(req.fields);
    if (Object.prototype.hasOwnProperty.call(patch, "generic_name") && !patch.generic_name) {
      throw new AppError("BAD_INPUT", "A medicine needs a name.");
    }
    return ctx.lock(() => {
      if (!ctx.db.rows("Medicines").some(m => str(m.medicine_id) === medicineId)) {
        throw new AppError("BAD_INPUT", "That medicine isn't in the list any more. Refresh and try again.");
      }
      patch.updated_at = bangkokStamp(ctx.nowMs());
      patch.updated_by = user.user_id;
      ctx.db.update("Medicines", "medicine_id", medicineId, patch);
      return stripRow(ctx.db.rows("Medicines").find(m => str(m.medicine_id) === medicineId));
    });
  },

  // The Drive file is created BEFORE the lock is taken: a slow upload must not hold the Sheet
  // against everyone else, and a failed upload must leave nothing behind to clean up. The old
  // file is trashed last, by the URL the column actually held -- never by scanning the folder.
  uploadMedicinePhoto(req, ctx) {
    const { user } = requireUser(req, ctx);
    const medicineId = str(req.medicineId);
    const slot = str(req.slot);
    if (!isPhotoSlot(slot)) throw new AppError("BAD_INPUT", "That isn't one of the photo slots.");
    const parsed = parseDataUrl(req.dataUrl);
    if (!parsed) throw new AppError("BAD_INPUT", "That photo has to be a JPEG or PNG image.");
    if (parsed.bytes > MAX_PHOTO_BYTES) throw new AppError("BAD_INPUT", "That photo is too big. Try taking it again.");
    const rootId = ctx.settings("photo_folder_id");
    if (!rootId) throw new AppError("BAD_INPUT", "No photo folder is set up yet. Ask whoever set up the Sheet to add one.");
    const medicine = ctx.db.rows("Medicines").find(m => str(m.medicine_id) === medicineId);
    if (!medicine) throw new AppError("BAD_INPUT", "That medicine isn't in the list any more. Refresh and try again.");
    const created = ctx.drive.put(photoFolderName(medicine), photoFileName(slot, parsed.mimeType), parsed.base64, parsed.mimeType);
    const column = photoColumn(slot);
    const previous = ctx.lock(() => {
      const before = str((ctx.db.rows("Medicines").find(m => str(m.medicine_id) === medicineId) || {})[column]);
      const patch = { updated_at: bangkokStamp(ctx.nowMs()), updated_by: user.user_id };
      patch[column] = created.url;
      ctx.db.update("Medicines", "medicine_id", medicineId, patch);
      return before;
    });
    const warnings = [];
    if (previous && previous !== created.url && !ctx.drive.trash(previous)) {
      warnings.push("The photo was saved, but the old one is still in Drive. You can delete it there.");
    }
    return { url: created.url, warnings };
  },

  removeMedicinePhoto(req, ctx) {
    const { user } = requireUser(req, ctx);
    const medicineId = str(req.medicineId);
    const slot = str(req.slot);
    if (!isPhotoSlot(slot)) throw new AppError("BAD_INPUT", "That isn't one of the photo slots.");
    const column = photoColumn(slot);
    const previous = ctx.lock(() => {
      const row = ctx.db.rows("Medicines").find(m => str(m.medicine_id) === medicineId);
      if (!row) throw new AppError("BAD_INPUT", "That medicine isn't in the list any more. Refresh and try again.");
      const before = str(row[column]);
      const patch = { updated_at: bangkokStamp(ctx.nowMs()), updated_by: user.user_id };
      patch[column] = "";
      ctx.db.update("Medicines", "medicine_id", medicineId, patch);
      return before;
    });
    const warnings = [];
    if (previous && !ctx.drive.trash(previous)) {
      warnings.push("The photo was removed from the app, but the file is still in Drive. You can delete it there.");
    }
    return { warnings };
  },
```

- [ ] **Step 4: Wire the live `ctx`**

In `apps-script/Code.gs`, inside the object `liveCtx_` returns (which already has `newId`, `lock`, `db`, …), add:

```js
    settings: key => SheetSettings.get(key),
    drive: {
      put: (folderName, fileName, base64, mimeType) =>
        DriveStore.putImage(SheetSettings.get("photo_folder_id"), folderName, fileName, base64, mimeType),
      trash: url => DriveStore.trashByUrl(url),
    },
```

`SheetSettings` and `DriveStore` live in `apps-script/Drive.gs` from Task 2. This reference is inside a function body, so it does not break the load-order rule.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Sync and commit**

```bash
npm run sync-gs
git add server/actions.js apps-script/Actions.gs apps-script/Code.gs tests/actions-write.test.js tests/actions-photo.test.js
git commit -m "feat: add and edit library medicines, upload and remove their photos"
```

---

### Task 6: The Apps Script end-to-end harness covers the new actions

Proves the generated `.gs` files actually run inside a Google-shaped environment, not just as ES modules.

**Files:**
- Modify: `tests/gs-sheet-fake.js` — add a fake `DriveApp` and `Utilities.base64Decode` / `newBlob`
- Test: `tests/gs-actions.test.js` (new, or append to the existing `node:vm` suite if one already drives `doPost` — check with `grep -rln "doPost" tests/`)

**Interfaces:**
- Consumes: every action from Tasks 4 and 5, through `doPost` only.
- Produces: nothing other code imports.

- [ ] **Step 1: Write the failing test**

Create `tests/gs-actions.test.js`. Load every `apps-script/*.gs` into one `vm` context exactly as `tests/checksheet.test.js` does (copy its `loadGs()`), then drive `doPost`:

```js
function post(context, body) {
  const e = { postData: { contents: JSON.stringify(body) } };
  const out = vm.runInContext("doPost", context)(e);
  return JSON.parse(out.getContent());
}

test("the real .gs files add a prescription and record its history through doPost", () => {
  const context = loadGs();
  installFakes(context); // SpreadsheetApp, PropertiesService, CacheService, Utilities, DriveApp
  const login = post(context, { action: "setPassword", name: "Somsak", code: "123456", newPassword: "lion-rock-7" });
  assert.equal(login.ok, true, JSON.stringify(login));
  const added = post(context, {
    action: "addPrescription", token: login.data.token, userId: "U01", medicineId: "MED03",
    frequency: "Daily", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }],
  });
  assert.equal(added.ok, true, JSON.stringify(added));
  const changes = context.SpreadsheetApp.getActive().getSheetByName("PrescriptionChanges");
  assert.ok(changes.grid.length > 1, "a history row reached the Sheet");
});

test("the real .gs files upload a photo through doPost and store the Drive link", () => {
  const context = loadGs();
  installFakes(context);
  const login = post(context, { action: "setPassword", name: "Somsak", code: "123456", newPassword: "lion-rock-7" });
  const r = post(context, {
    action: "uploadMedicinePhoto", token: login.data.token, medicineId: "MED01",
    slot: "box", dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.data.url, /drive\.google\.com/);
});
```

Write `installFakes(context)` in this file. The fake `DriveApp` needs `getFolderById(id)` returning an object with `getFoldersByName(name)` → `{hasNext, next}`, `createFolder(name)`, and a folder with `createFile(blob)` returning `{getId, setSharing}`; plus `DriveApp.Access.ANYONE_WITH_LINK` and `DriveApp.Permission.VIEW`, and `getFileById(id)` → `{setTrashed}`. `Utilities` needs `base64Decode(s)` → array, `newBlob(bytes, type, name)` → `{}`, `getUuid()`, and the `computeDigest` / `DigestAlgorithm` the auth code already uses — copy those from whichever existing test file already fakes them (`grep -rn "computeDigest" tests/`).

- [ ] **Step 2: Run to verify it fails**

Run: `npm test 2>&1 | grep -E "gs-actions|^not ok" | head`
Expected: FAIL.

- [ ] **Step 3: Implement the fakes until the tests pass**

No production code should need changing. If a test fails because of a real bug in `apps-script/`, fix the **source** module in `js/` or `server/` and re-run `npm run sync-gs` — never hand-edit a generated `.gs`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/gs-actions.test.js tests/gs-sheet-fake.js
git commit -m "test: drive the new write actions through doPost in the Apps Script harness"
```

---

### Task 7: Today shows what was actually taken

The one place the rejected mid-day behaviour can leak in.

**Files:**
- Modify: `js/views/today.js:47`
- Test: `tests/views-today.test.js`

**Interfaces:**
- Consumes: the `todayModel` item shape already built in `js/viewmodel.js:71-76` — `{key, timeOfDay, prescription, dose, medicine, tick}`, where `tick` is `null` or `{at, amount, unit}` taken from the `DoseLog` row.
- Produces: no new exports. Later tasks rely on the rendering rule only.

- [ ] **Step 1: Write the failing tests**

Append to `tests/views-today.test.js`. That file already defines a module-level `ctx` object and a `baseModel(over = {})` helper — **use those**; do not invent `todayModelWith` or `ctxFor`. Read the file's first 30 lines to see exactly what `baseModel` accepts, and pass the dose/tick overrides through it.

```js
test("a ticked row shows the amount that was actually taken, not the amount now prescribed", () => {
  const model = baseModel({ dose: { id: "DS01", timeOfDay: "Morning", amount: 0.5, unit: "tablet" }, tick: { at: "07:42", amount: "1", unit: "tablet" } });
  const html = renderToday({ model, ctx, date: "2026-09-18", today: "2026-09-18" });
  assert.match(html, /1 tablet/, "the taken amount is what the record says");
  assert.doesNotMatch(html.split("</button>")[0], /0\.5 tablet(?![^<]*now)/);
});

test("a ticked row whose dose has since changed also says what it is now", () => {
  const model = baseModel({ dose: { id: "DS01", timeOfDay: "Morning", amount: 0.5, unit: "tablet" }, tick: { at: "07:42", amount: "1", unit: "tablet" } });
  const html = renderToday({ model, ctx, date: "2026-09-18", today: "2026-09-18" });
  assert.match(html, /now 0\.5 tablet/i);
});

test("an un-ticked row shows the current dose", () => {
  const model = baseModel({ dose: { id: "DS01", timeOfDay: "Morning", amount: 0.5, unit: "tablet" }, tick: null });
  const html = renderToday({ model, ctx, date: "2026-09-18", today: "2026-09-18" });
  assert.match(html, /0\.5 tablet/);
});

test("a ticked row whose dose has not changed says nothing extra", () => {
  const model = baseModel({ dose: { id: "DS01", timeOfDay: "Morning", amount: 1, unit: "tablet" }, tick: { at: "07:42", amount: "1", unit: "tablet" } });
  const html = renderToday({ model, ctx, date: "2026-09-18", today: "2026-09-18" });
  assert.doesNotMatch(html, /now 1 tablet/i);
});
```

`baseModel` builds a whole Today model; if its override shape does not reach the individual dose item, widen `baseModel` itself rather than adding a second helper beside it.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test 2>&1 | grep -E "actually taken|now 0" | head`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `js/views/today.js`, replace the `<div class="meta">` expression on line 47. The current line reads:

```js
      <div class="meta"><span class="qty">${esc(item.dose.amount)} ${esc(item.dose.unit)}</span>${mealTag(item.prescription.meal)}${shot}</div>${by}</div>
```

Replace it with:

```js
      <div class="meta"><span class="qty">${esc(shownAmount(item))} ${esc(shownUnit(item))}</span>${mealTag(item.prescription.meal)}${shot}</div>${changedNote(item)}${by}</div>
```

and add above the row function, with the comment:

```js
// A ticked row shows what was actually swallowed -- the DoseLog snapshot -- not whatever the
// prescription says now. A dose changed later in the day must never rewrite the morning's record,
// which is how the old version ended up prompting a second dose.
const shownAmount = item => (item.tick ? item.tick.amount : item.dose.amount);
const shownUnit = item => (item.tick ? item.tick.unit : item.dose.unit);
function changedNote(item) {
  if (!item.tick) return "";
  const sameAmount = String(item.tick.amount) === String(item.dose.amount);
  const sameUnit = String(item.tick.unit) === String(item.dose.unit);
  if (sameAmount && sameUnit) return "";
  return `<div class="s changed">Now ${esc(item.dose.amount)} ${esc(item.dose.unit)}</div>`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Add the style**

In `styles.css`, next to the existing `.s` rule, add:

```css
.changed { opacity: .65; font-style: italic; }
```

- [ ] **Step 6: Commit**

```bash
git add js/views/today.js styles.css tests/views-today.test.js
git commit -m "fix: a ticked dose shows the amount actually taken, not a later change"
```

---

### Task 8: The editing screens

The largest task. Build it in the order below and run the browser check before committing.

**Files:**
- Create: `js/views/forms.js`
- Create: `js/photoinput.js` (from `git show phase-2:js/photoinput.js`)
- Modify: `js/viewmodel.js`, `js/views/meds.js`, `js/views/detail.js`, `js/app.js`, `js/main.js`, `styles.css`
- Test: `tests/views-forms.test.js` (new), `tests/viewmodel-screens.test.js`

**Interfaces:**
- Consumes: every action from Tasks 4 and 5; `medsModel(idx, ownerId)` and `detailModel(idx, ownerId, prescriptionId)` from `js/viewmodel.js`; `call(action, payload)` from `js/api.js`; `S`, `render`, `go`, `toast`, `loadBoot`, `SCREENS`, `ctx()` from `js/app.js`; `esc` from `js/html.js`; `pickImage()` and `shrinkToDataUrl(file, maxSide, quality)` from `js/photoinput.js`.
- Produces:
  - `canEditOwner(idx, ownerId)` → `boolean` in `js/viewmodel.js`
  - `renderMedicineForm({medicine, error, busy})`, `renderPrescriptionForm({model, error, busy})`, `renderDoseForm({model, error, busy})` in `js/views/forms.js`, each returning an HTML string
  - screens `medicineForm`, `prescriptionForm`, `doseForm` on `SCREENS`

- [ ] **Step 1: Add `canEditOwner` with its test**

Append to `tests/viewmodel-screens.test.js`:

**No server change is needed.** `bootstrap` already sends, for every person in `boot.people`, a `medicines` field holding that viewer's grant for that person — `""`, `"View"` or `"Edit"` — computed server-side by `grantFor` (`server/actions.js:285`). `indexBoot` indexes those rows as `idx.people`. So the phone already knows, and the Sharing rows themselves never need to reach the client.

```js
test("canEditOwner reads the grant bootstrap already sent for each person", () => {
  // indexBoot reads these eight arrays; bootFixture() does not exist, so build the object here.
  const idx = indexBoot({
    today: "2026-09-18", dose_log: [], medicines: [], hospitals: [], doctors: [],
    prescriptions: [], doses: [], changes: [],
    me: { user_id: "U02", display_name: "Pim", role: "Family" },
    people: [
      { user_id: "U01", display_name: "Dad", role: "Primary", medicines: "Edit", care_team: "View" },
      { user_id: "U02", display_name: "Pim", role: "Family", medicines: "Edit", care_team: "Edit" },
      { user_id: "U03", display_name: "Top", role: "Family", medicines: "View", care_team: "" },
      { user_id: "U05", display_name: "Nan", role: "Family", medicines: "", care_team: "" },
    ],
  });
  assert.equal(canEditOwner(idx, "U01"), true, "an Edit share");
  assert.equal(canEditOwner(idx, "U02"), true, "yourself — the server always grants Edit on your own");
  assert.equal(canEditOwner(idx, "U03"), false, "View only");
  assert.equal(canEditOwner(idx, "U05"), false, "no share at all");
  assert.equal(canEditOwner(idx, "U99"), false, "somebody the payload never mentioned");
});
```

Implement in `js/viewmodel.js`:

```js
// Whether to draw an edit button. The grant came from the server inside bootstrap (people[].medicines),
// and the server checks it again on every write -- so a wrong answer here is a missing or extra
// button, never a way in.
export function canEditOwner(idx, ownerId) {
  const person = idx.people.get(ownerId);
  return !!person && person.medicines === "Edit";
}
```

No new import is needed. Note the signature is `canEditOwner(idx, ownerId)` — two arguments, because the payload is already scoped to the logged-in viewer.

Run `npm test`. Expected: PASS.

- [ ] **Step 2: Bring `photoinput.js` across**

```bash
git show phase-2:js/photoinput.js > js/photoinput.js
```

No edit needed — it references no Sheet column. It is browser-only and never synced to Apps Script, so do **not** add it to `scripts/sync-gs.mjs`.

- [ ] **Step 3: Write the form-rendering tests**

Create `tests/views-forms.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMedicineForm, renderPrescriptionForm, renderDoseForm } from "../js/views/forms.js";

test("renderMedicineForm escapes what the user typed", () => {
  const html = renderMedicineForm({ medicine: { generic_name: `<script>alert(1)</script>` }, error: "", busy: false });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("renderMedicineForm shows an error above the fields when there is one", () => {
  const html = renderMedicineForm({ medicine: {}, error: "A medicine needs a name.", busy: false });
  assert.match(html, /A medicine needs a name\./);
});

test("renderMedicineForm disables the save button while busy", () => {
  assert.match(renderMedicineForm({ medicine: {}, error: "", busy: true }), /disabled/);
});

test("renderDoseForm shows one row per time of day with its current amount", () => {
  const html = renderDoseForm({
    model: {
      medicineName: "Amlodipine",
      doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }, { timeOfDay: "Evening", amount: 0.5, unit: "tablet" }],
    },
    error: "", busy: false,
  });
  assert.match(html, /Morning/);
  assert.match(html, /Evening/);
  assert.match(html, /value="1"/);
  assert.match(html, /value="0.5"/);
});

test("renderDoseForm carries an optional reason box that is not required", () => {
  const html = renderDoseForm({ model: { medicineName: "Amlodipine", doses: [] }, error: "", busy: false });
  assert.match(html, /name="reason"/);
  assert.doesNotMatch(html, /name="reason"[^>]*required/);
});

test("renderPrescriptionForm lists every medicine in the library plus a way to add a new one", () => {
  const html = renderPrescriptionForm({
    model: {
      medicines: [{ medicine_id: "MED01", generic_name: "Amlodipine", strength: "5 mg" }],
      doctors: [{ doctor_id: "DOC01", name: "Dr Somchai" }],
      frequency: "Daily", doses: [],
    },
    error: "", busy: false,
  });
  assert.match(html, /Amlodipine/);
  assert.match(html, /data-new-medicine/);
});
```

Run `npm test`. Expected: FAIL — cannot find `../js/views/forms.js`.

- [ ] **Step 4: Build `js/views/forms.js`**

Follow the existing view conventions exactly: read `js/views/emergency.js` first — it already has a form (`renderEmergencyEdit`) with a `data-form` attribute, an error line, a busy-disabled button and `esc()` on every value. Mirror its markup and class names so the three new forms inherit the app's styling with no new CSS beyond what Step 7 adds.

Each form is a `<form data-form="…">` whose name the Task 9 submit handler dispatches on: `medicine`, `prescription`, `dose`. Requirements per form:

- **`renderMedicineForm({medicine, error, busy})`** — text inputs for `generic_name` (required), `brand_name`, `strength`, `form`, `purpose`, and a textarea for `notes`. `medicine` is `{}` when adding and the library row when editing; when editing, include a hidden `medicineId`.
- **`renderPrescriptionForm({model, error, busy})`** — a `<select name="medicineId">` of `model.medicines` labelled `generic_name strength`, plus a button carrying `data-new-medicine` that opens the medicine form; a `<select name="frequency">` over the four `FREQ` values; a number input `everyNDays` and date input `countFrom` shown only for `Every N days`; weekday checkboxes shown only for `Weekdays`; a `<select name="mealTiming">` over the four meal timings; four amount/unit rows, one per time of day, blank meaning "not at this time"; an optional `<select name="doctorId">` over `model.doctors` with a "Not recorded" option; and a `notes` textarea.
- **`renderDoseForm({model, error, busy})`** — `model.medicineName` in the heading, four amount/unit rows pre-filled from `model.doses` (blank where there is no dose at that time), and a `reason` textarea labelled "Why the change? (optional)".

Every interpolated value passes through `esc()`. Every button that is not `type="submit"` carries `type="button"`.

- [ ] **Step 5: Run the form tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Add the edit controls to Meds and Detail**

In `js/views/meds.js`, `renderMeds` gains a `canEdit` argument (passed from `main.js` as `canEditOwner(S.idx, S.owner)`). When true, render a button carrying `data-add-prescription` under the heading. When false, render nothing extra — the existing read-only screen is unchanged.

In `js/views/detail.js`, when `canEdit` is true, render a row of buttons: `data-change-dose="<prescription id>"`, `data-change-schedule="<prescription id>"`, and either `data-stop="<id>"` or `data-restart="<id>"` depending on `model.prescription.status`. Render `data-delete="<id>"` **only** when `model.canDelete` is true. Add `canDelete` to `detailModel`'s return value, computed as "no tick for this prescription exists in `idx.ticks`":

```js
  const canDelete = ![...idx.ticks.values()].some(t => t.prescription_id === prescriptionId);
```

Also add an `Edit details` button carrying `data-edit-medicine="<medicine id>"` and, on each of the five photo slots, `data-upload-photo="<medicine id>|<slot>"` plus, on a filled slot, `data-remove-photo="<medicine id>|<slot>"`.

Add a test to `tests/views.test.js` asserting that with `canEdit: false` none of `data-change-dose`, `data-stop` or `data-delete` appears in the HTML, and with `canEdit: true` they do.

- [ ] **Step 7: Style the new controls**

Add to `styles.css` only what the new markup needs and nothing more — reuse existing button and field classes wherever they fit. Keep every touch target at least 44px tall.

- [ ] **Step 8: Run the browser check**

Headless Chrome over the DevTools Protocol, with `Emulation.setDeviceMetricsOverride` at 390×844 and again at 320×700. A plain `--window-size` does **not** emulate mobile width on this machine and will give a false pass. Reuse the CDP driver from the session scratchpad pattern if one exists, otherwise write one in the scratchpad directory (not in the repo).

Walk, in mock mode: Meds → Add medicine → save; Meds → Add prescription → pick the new medicine → Daily, Morning 1 tablet → save; the prescription's detail → Change dose → 0.5 → save; Stop; Restart. At both widths assert no horizontal scrollbar (`document.documentElement.scrollWidth <= innerWidth`) and no element wider than the viewport.

- [ ] **Step 9: Commit**

```bash
npm test
git add js/views/forms.js js/photoinput.js js/views/meds.js js/views/detail.js js/viewmodel.js styles.css tests/views-forms.test.js tests/views.test.js tests/viewmodel-screens.test.js
git commit -m "feat: medicine, prescription and dose forms with edit controls on Meds and detail"
```

---

### Task 9: Wire the screens to the server

**Files:**
- Modify: `js/app.js` (the `click` and `submit` listeners, new handler functions, new `S` keys), `js/main.js` (register the three screens)
- Test: `tests/app-handlers.test.js` (new) — or, if the existing suite has no DOM harness, cover the handlers by asserting the request payloads through a stubbed `call`; check `grep -rn "js/app.js" tests/` first.

**Interfaces:**
- Consumes: everything from Task 8.
- Produces: no new exports beyond the three `SCREENS` entries.

- [ ] **Step 1: Extend `S` and register the screens**

In `js/app.js`, add to the `S` object: `form: null` (the in-progress form model), `formError: ""`, `formBusy: false`.

In `js/main.js`, add to the `Object.assign(SCREENS, {…})` block:

```js
  medicineForm: () => ({ tab: "meds", body: renderMedicineForm({ medicine: S.form.medicine, error: S.formError, busy: S.formBusy }) }),
  prescriptionForm: () => ({ tab: "meds", body: renderPrescriptionForm({ model: S.form, error: S.formError, busy: S.formBusy }) }),
  doseForm: () => ({ tab: "meds", body: renderDoseForm({ model: S.form, error: S.formError, busy: S.formBusy }) }),
```

and import the three renderers from `./views/forms.js`.

- [ ] **Step 2: Add the click targets**

Extend the `closest(…)` selector in the `click` listener with every new attribute: `[data-add-prescription],[data-change-dose],[data-change-schedule],[data-stop],[data-restart],[data-delete],[data-edit-medicine],[data-new-medicine],[data-upload-photo],[data-remove-photo]`, and add a branch for each, following the existing `if (d.open) {…}` style.

`data-stop`, `data-restart` and `data-delete` call the server directly. `data-delete` asks first with `confirm()` — the message must name the medicine, e.g. `Remove Losartan from Dad's list? Nothing has been ticked for it yet, so nothing is lost.` The others open a form screen.

- [ ] **Step 3: Add the submit branches**

In the `submit` listener, add:

```js
  if (form.dataset.form === "medicine") return saveMedicine(f);
  if (form.dataset.form === "prescription") return savePrescription(f);
  if (form.dataset.form === "dose") return saveDose(f);
```

Each handler follows the shape `saveEmergencyCard` already uses in `js/app.js:176-187`: set `formBusy`, `render()`, `await call(...)`, then `await loadBoot()` so the whole picture refreshes from the Sheet, then `go("meds")` (or `go("detail")` when editing an existing one) and `toast(...)` on success; on failure set `formError` from `e.message`, clear `formBusy`, `render()`.

Reading the four amount/unit rows out of the `FormData` into the `doses` array the server wants is the fiddly part: a row with a blank amount is omitted entirely, not sent as zero.

- [ ] **Step 4: Add the photo handler**

```js
async function uploadPhoto(medicineId, slot) {
  const file = await pickImage();
  if (!file) return;
  S.formBusy = true; render();
  try {
    const dataUrl = await shrinkToDataUrl(file);
    const { warnings } = await call("uploadMedicinePhoto", { medicineId, slot, dataUrl });
    await loadBoot();
    toast(warnings && warnings.length ? warnings[0] : "Photo saved.");
  } catch (e) {
    toast(e.message);
  } finally {
    S.formBusy = false; render();
  }
}
```

Import `pickImage` and `shrinkToDataUrl` from `./photoinput.js`. `data-remove-photo` calls `removeMedicinePhoto` the same way, after a `confirm()`.

- [ ] **Step 5: The new-medicine-from-prescription flow**

When `data-new-medicine` is clicked from the prescription form, stash the half-filled prescription model on `S` before switching screens, and after `addMedicine` succeeds, restore it with the new medicine pre-selected and return to `prescriptionForm`. This is the flow the family explicitly asked for; do not drop the partly filled form.

- [ ] **Step 6: Write the handler tests**

Assert the payloads, not the DOM: stub `call` and check that submitting a dose form with Morning `1` and Evening blank sends exactly `doses: [{timeOfDay: "Morning", amount: 1, unit: "tablet"}]`, and that a failed call leaves `S.formError` set and `S.formBusy` false.

- [ ] **Step 7: Run everything**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Browser check**

Repeat Task 8 Step 8's CDP walk end to end in mock mode, this time including a photo upload against the mock Drive (`js/mockphoto.js`), at 390px and 320px.

- [ ] **Step 9: Commit**

```bash
git add js/app.js js/main.js tests/app-handlers.test.js
git commit -m "feat: wire the editing screens to the server, with photo upload from the phone"
```

---

### Task 10: README, `checkSheet` round-trip, and the live check

**Files:**
- Modify: `README.md`
- Test: `tests/checksheet.test.js`

**Interfaces:**
- Consumes: everything.
- Produces: nothing code depends on.

- [ ] **Step 1: Prove the app writes rows the checker accepts**

Append to `tests/checksheet.test.js`:

```js
test("checkSheet accepts a Sheet after the app has added a prescription and a medicine through it", () => {
  const tables = clone(fixtureTables());
  const ctx = fakeCtx(tables);
  const token = loginAs(ctx, "Dad", "dad123");
  const med = handle({ action: "addMedicine", token, fields: { generic_name: "Losartan", strength: "50 mg" } }, ctx);
  assert.equal(med.ok, true, JSON.stringify(med));
  const rx = handle({
    action: "addPrescription", token, userId: "U01", medicineId: med.data.medicine_id,
    frequency: "Daily", doses: [{ timeOfDay: "Noon", amount: 1, unit: "tablet" }],
  }, ctx);
  assert.equal(rx.ok, true, JSON.stringify(rx));
  assert.deepEqual(runCheckSheet(tables), [], "the app must never write a row its own checker rejects");
});
```

`fakeCtx(tables)` already takes the tables object, so passing the same `tables` to both it and `runCheckSheet` makes the writes visible to the checker. `runCheckSheet` lives in `tests/checksheet.test.js`; import `fakeCtx`, `loginAs` and `handle` at the top of that file.

Run `npm test`. Expected: PASS.

- [ ] **Step 2: Update the README**

Three edits, in the existing non-technical voice:

1. The **sync list** in the Develop section must name all six synced files: `js/schedule.js`, `js/access.js`, `js/authcore.js`, `server/actions.js`, `server/prescriptions.js`, `server/photos.js`, and the ten `apps-script/` files the family pastes (now including `Drive.gs`, `Photos.gs`, `Prescriptions.gs`).
2. A new **"Changing a medicine from the app"** section: where the buttons are, that a change never alters a dose already ticked, that a medicine anyone has taken can be stopped but not deleted, and that editing a library medicine changes it for the whole family.
3. The **deploy steps** must say: paste every `apps-script/` file, run `checkSheet` **in the editor and accept the Drive permission prompt** — the first photo upload needs it and a deployment made before authorizing will fail — then Deploy → Manage deployments → Edit → New version.

Also add, under setup: to let someone else edit a person's medicines, add a `Sharing` row — `owner_user_id` the person, `shared_with_user_id` the helper (blank means the whole family), `section` `Medicines`, `access` `Edit`.

- [ ] **Step 3: Final whole-suite run**

Run: `npm test`
Expected: PASS, every test.

- [ ] **Step 4: Commit**

```bash
git add README.md tests/checksheet.test.js
git commit -m "docs: release 2a setup, editing guide and the Drive permission step"
```

- [ ] **Step 5: Hand back to the controller**

Do **not** push, deploy, or touch the family's live Sheet. Report to the controller: the commit range, the test count, and anything left parked.

---

## Self-Review

**Spec coverage:** §2 scope → Tasks 4, 5, 8, 9. §3 decisions: edit rights → Task 4 `requireEditable`; library open to all → Task 5; reason optional and capped → Tasks 3, 8; doctor carried over → Tasks 3, 4; mid-day rule → Tasks 4 (the DoseLog invariant test) and 7 (the rendering); delete rules → Task 4; shared-medicine edit → Task 5; photos → Tasks 2, 5, 9; ids → Global Constraints. §4 access → Task 4. §5 change engine → Task 3. §6 mid-day → Tasks 4, 7. §7 photos → Tasks 2, 5, 9. §8 API, all ten actions → Tasks 4, 5. §9 screens → Tasks 8, 9. §10 reuse → Tasks 2, 8. §11 testing → every task, plus Tasks 6 and 10. §12 deployment → Task 10.

**Gap found and closed:** §9's "Medicine detail gains Edit details and five photo slots" had no explicit step; it is now Task 8 Step 6.

**Type consistency:** `describeSchedule(prescription, doses)` (Task 1) is called with exactly that shape in Task 3's `applyPrescriptionChange`. `validateDoses`/`validateScheduleFields` return `{ok, doses}` / `{ok, fields}` in Task 3 and are destructured that way in Task 4. `ctx.drive.put/trash` and `ctx.settings` are defined in Task 5 Step 3's usage, faked in Task 5 Step 1, and wired live in Task 5 Step 4. `canEditOwner(idx, ownerId)` is defined in Task 8 Step 1 and used in Task 8 Step 6.

**Known soft spots for the implementer to resolve, not guess:** `tests/fixtures.js` export names (Task 3 Step 6 says to check), whether `dev/memory-db.js` `update()` mutates in place (Task 3 Step 8), each is now resolved in the plan text with the verified answer.
