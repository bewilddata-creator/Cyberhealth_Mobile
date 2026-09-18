# CyberHealth Release 2a: Recording medicines from the app

**Date:** 2026-09-18
**Status:** Awaiting the family's review
**Builds on:** `docs/superpowers/specs/2026-09-17-cyberhealth-v2-design.md` (the v2 design) and the shipped release 1.
**Database:** unchanged. `CyberHealth_Sheet_v2.xlsx` already has every column this release writes. Nobody rebuilds their Sheet.

## 1. Why this release

Release 1 can show what dad takes but not change it. Every dose change still means opening the Google Sheet on a laptop, which is exactly what the family wanted to stop doing. This release adds the write paths for the data that changes week to week — what each person is prescribed, and the medicine library behind it — and leaves the data that barely changes (hospitals, doctors, HN, care team, sharing, passwords) in the Sheet until release 2b.

## 2. Scope

**In:**
- Medicine library: add a medicine, edit one, upload and replace its five photos.
- Prescriptions: add, change the dose, change the schedule, stop, restart, and delete one that has never been ticked.
- Every change writes its own history row, with an optional reason.

**Out (release 2b):** hospitals, doctors, doctor–hospital links, hospital numbers, care team, sharing, change password, adding family members. These stay Sheet-only, and the More screen keeps showing them as "Coming soon".

**Still out entirely:** Vitals, Appointments, Vaccinations, Documents, LINE reminders.

## 3. Decisions

| Topic | Decision |
|---|---|
| Who may edit a person's prescriptions | The owner, or anyone the owner granted `Medicines` / `Edit` in the Sharing tab. `View` keeps today's read-only screens. |
| Who may edit the medicine library | Any logged-in user. The library is shared and has no owner. |
| Ticking | Unchanged: owner only. Editing what someone is prescribed and recording what they took stay separate rights. |
| Reason for a change | Optional, free text, capped at 500 characters. Saving never blocks on it. |
| Doctor on a change | Carried over from the prescription unless the user picks a different one. Release 2a cannot create doctors, so the picker lists existing `Doctors` rows and "Not recorded". |
| A dose change partway through a day | Never touches `DoseLog`. Doses already ticked keep the amount actually taken; the new amount applies to the next un-ticked dose. |
| Deleting a prescription | Allowed only while it has no `DoseLog` rows at all. Otherwise it can only be stopped. |
| Deleting a medicine | Never, once any prescription (active, stopped, or historical) references it. Dad's history must keep reading correctly. |
| Editing a shared medicine | Allowed, and it changes for everyone. When another person has a prescription for it, the form says so before saving. |
| Photos | Shrunk on the phone to a 1600 px JPEG before upload, then stored in the Drive folder from `Settings.photo_folder_id`, one sub-folder per medicine named `<medicine_id> <generic_name> <strength>`. |
| Ids | Unchanged: `ctx.newId(prefix)` — prefix plus 8 random characters. |

## 4. Access rules

`js/access.js` already answers reads. This release uses its `canEdit(viewerId, ownerId, section, sharing)` for every prescription write, and adds no new sharing concepts.

| Action | Allowed when |
|---|---|
| `addPrescription`, `changePrescriptionDose`, `changePrescriptionSchedule`, `stopPrescription`, `restartPrescription`, `deletePrescription` | `canEdit(viewer, owner, "Medicines", sharing)` |
| `addMedicine`, `updateMedicine`, `uploadMedicinePhoto`, `removeMedicinePhoto` | any logged-in user |
| everything in release 1 | unchanged |

A viewer who may edit an owner's medicines may also read them — `canEdit` implies `canRead` in `access.js` today, and this release relies on that rather than restating it.

## 5. The change engine

One private server helper owns all history writing, so no action can update a prescription without recording it:

```
applyPrescriptionChange(ctx, user, prescriptionId, changeType, mutate, { reason, doctorId })
```

Inside the script lock it re-reads the prescription and its dose rows, renders the **before** description, runs `mutate` (which performs the actual Sheet writes), re-reads, renders the **after** description, and appends one `PrescriptionChanges` row:

| Column | Value |
|---|---|
| `change_id` | `ctx.newId("CH")` |
| `prescription_id` | the prescription |
| `changed_at` | `bangkokStamp(ctx.nowMs())` |
| `changed_by` | the acting user's `user_id` (not the owner's) |
| `change_type` | one of `Started`, `Dose changed`, `Schedule changed`, `Stopped`, `Restarted`, `Corrected` — the values already in the Lists tab |
| `doctor_id` | the prescription's doctor after the change |
| `reason` | the optional text, trimmed, capped at 500 |
| `before` / `after` | human-readable descriptions, blank `before` for `Started` |

`before` and `after` are produced by `describeSchedule(prescription, doses)`, a pure function in `js/schedule.js` built from the existing `describeFrequency` and `describeDoses`, e.g. `Every day, after meal: Morning 1 tablet, Evening 2 tablets`. Storing words rather than ids means the history still reads correctly years later even if a medicine is renamed.

Every prescription write also stamps `updated_at` and `updated_by` on the `Prescriptions` row.

## 6. The mid-day rule

Three parts, and only one is new:

1. **A tick already snapshots** `amount_taken` and `unit` into `DoseLog`. Unchanged.
2. **Today must render the snapshot on ticked rows.** `js/views/today.js:47` currently renders `item.dose.amount` for every row, so a dose change would silently restate what dad already took. A ticked row must render `item.tick.amount` and `item.tick.unit`; only un-ticked rows render the current dose. When the two differ, the row also carries a quiet line naming the new amount, so the change is visible without altering the record.
3. **No prescription write ever touches `DoseLog`.** Stated as an invariant and tested directly.

Together these mean a change can never prompt a second dose, and the record never claims dad took something he did not.

## 7. Photos

Salvaged from the abandoned `phase-2` branch and renamed to v2 columns:

| File | Change needed |
|---|---|
| `js/photoinput.js` | none beyond re-testing: `pickImage()` opens a plain file input so iPhone offers both camera and library; `shrinkToDataUrl()` draws to a canvas at 1600 px and returns a JPEG data URL, which also converts HEIC. |
| `server/photos.js` | `med_id` → `medicine_id`; `PHOTO_SLOTS` and `photoColumn()` already match the v2 `photo_*` columns. |
| `apps-script/Drive.gs` | none: it already carries the phase-2 review's fix — `DriveStore.putImage` only ever creates, and `DriveStore.trashByUrl` removes the old file by the URL the column held, never by scanning the folder for a same-named file. It brings `SheetSettings.get("photo_folder_id")` with it. |
| `js/mockphoto.js` | already on `rebuild`; keeps dev mode working without Drive. |

Upload order, so a failure never leaves a broken link: shrink on the phone → upload and create the Drive file **outside** the script lock → take the lock, write the new URL into the `Medicines` row → trash the file the column previously pointed at. A failed trash returns a warning; it never fails the save.

`removeMedicinePhoto` clears the column and trashes the file the column named.

## 8. API

New actions, all `POST {action, token, …}` with the release 1 envelope and error codes.

| Action | Request | Returns | Rules |
|---|---|---|---|
| `addMedicine` | `{fields}` | the new `Medicines` row | Whitelist: `generic_name, brand_name, strength, form, purpose, notes`. `generic_name` required. Trim, cap 200 each. |
| `updateMedicine` | `{medicineId, fields}` | the updated row | Same whitelist. `BAD_INPUT` on an unknown medicine. |
| `uploadMedicinePhoto` | `{medicineId, slot, dataUrl}` | `{url, warnings}` | `slot` from `PHOTO_SLOTS`; `dataUrl` a JPEG or PNG under 6 MB. |
| `removeMedicinePhoto` | `{medicineId, slot}` | `{warnings}` | |
| `addPrescription` | `{userId, medicineId, frequency, everyNDays?, weekdays?, countFrom?, mealTiming?, doctorId?, startedOn?, notes?, doses:[{timeOfDay, amount, unit}], reason?}` | the prescription with its doses | `canEdit` on `userId`. Refuses a second Active prescription for the same person and medicine (`CONFLICT`). `startedOn` defaults to today, never in the future. Writes a `Started` change. |
| `changePrescriptionDose` | `{prescriptionId, doses, reason?, doctorId?}` | the prescription with its doses | Replaces the whole dose set: one row per time of day, amounts positive, no duplicate times, at least one row unless the frequency is `As needed`. Writes `Dose changed`. |
| `changePrescriptionSchedule` | `{prescriptionId, frequency, everyNDays?, weekdays?, countFrom?, mealTiming?, doctorId?, reason?}` | the prescription | Validated by the existing `normalizePrescription`, so an invalid combination is refused with the same wording the Sheet checker uses. Writes `Schedule changed`. |
| `stopPrescription` | `{prescriptionId, reason?}` | the prescription | Sets `status` to `Stopped`. Keeps every row. Writes `Stopped`. |
| `restartPrescription` | `{prescriptionId, reason?}` | the prescription | Sets `status` to `Active`, refuses if another Active prescription now covers the same person and medicine. Writes `Restarted`. |
| `deletePrescription` | `{prescriptionId}` | `{deleted: true}` | Refused with `CONFLICT` when any `DoseLog` row references it: "This has doses recorded against it, so it can only be stopped." Removes the prescription, its dose rows and its change rows. |

Every one of these takes the script lock and re-reads what it guards inside it. Validation happens before the lock where it needs no Sheet state, and inside where it does.

## 9. Screens

- **Meds** gains an **Add medicine** button and, on each prescription, **Change dose**, **Change schedule**, **Stop** / **Restart** and (only when untouched) **Delete**. Every one of these appears only when the viewer may edit that person.
- **Add a prescription** is one form: pick the medicine, the schedule, the times of day with their amounts, an optional doctor and note. Picking a medicine that is not in the library opens the **new medicine** form and returns to this one with it selected — the flow the family asked for.
- **Change dose** shows every time of day with its current amount, lets rows be added or removed, and carries the optional "Why?" box.
- **Medicine detail** gains **Edit details** and five photo slots, each tappable to add or replace, with a remove button on a filled slot.
- **More** keeps its "Coming soon" list, now shorter.

Read-only viewers see none of these controls, and the server refuses them anyway.

## 10. What is reused

| Reused | New |
|---|---|
| `js/photoinput.js`, `server/photos.js`, `apps-script/Drive.gs`, `js/mockphoto.js` from `phase-2` | `applyPrescriptionChange` and every action in §8 |
| `normalizePrescription`, `normalizeDose`, `describeFrequency`, `describeDoses` | `describeSchedule` in `js/schedule.js` |
| `canEdit` in `js/access.js`, the lock and id helpers in `apps-script/` | the Meds edit controls and the three forms |
| `SheetDb.append` / `update` / `remove` (`apps-script/Data.gs`) and their `dev/memory-db.js` twins — all four already exist and need no change | — |

## 11. Testing

- **Node:** every action against an in-memory v2 Sheet — edit rights per section and access level, each validation refusal with its exact message, `CONFLICT` on a duplicate active prescription and on deleting a ticked one, and one history row with the right `change_type`, `before` and `after` for each of the six change types.
- **The invariant:** tick a dose, change its amount, and assert `DoseLog` is byte-for-byte unchanged and Today still shows the taken amount.
- **Apps Script:** the new actions driven through `doPost` in the existing `node:vm` harness with a fake `DriveApp`, including a photo upload, a replace, and a failed trash returning a warning rather than failing the save.
- **Browser:** mock mode through the Chrome DevTools Protocol at 390 px and 320 px, walking the add-prescription, change-dose and photo flows.
- **`checkSheet`:** unchanged, but re-run against a Sheet the app has written to, to prove the app writes rows the checker accepts.

## 12. Deployment

No Sheet change and no template change. The family pastes the updated `apps-script/` files, runs `checkSheet`, then Deploy → Manage deployments → Edit → **New version**, so the address stays the same. The first photo upload will prompt for Drive authorization; the README step says to accept it in the editor before deploying.

Before anyone can edit dad's medicines, his Sharing tab needs a row: `owner_user_id` = his id, `shared_with_user_id` = the person (or blank for the whole family), `section` = `Medicines`, `access` = `Edit`.
