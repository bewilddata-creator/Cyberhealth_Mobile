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
    // The real one (apps-script/Code.gs) answers false for any folder this script did not make
    // itself, which under .../auth/drive.file it cannot open at all.
    canOpen: folderId => folderId === "FOLDER123",
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

test("a medicine deleted while the photo was uploading fails the save instead of reporting success", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  const token = loginAs(ctx, "Pim", "pim123");
  // The row is checked before the upload and gone by the time the lock is taken -- exactly the
  // race the in-lock re-check exists for.
  const put = ctx.drive.put;
  ctx.drive.put = (...args) => {
    ctx.db.remove("Medicines", m => m.medicine_id === "MED01");
    return put(...args);
  };
  const r = handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG }, ctx);
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.error.code, "BAD_INPUT");
  assert.match(r.error.message, /isn't in the list any more/);
  assert.equal(drive.trashed.length, 0, "nothing of anyone else's is trashed on the way out");
});

test("uploading before anyone set a photo folder up still works: the folder is made on the way", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  ctx.settings = () => "";
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(drive.created.length, 1, "the adapter was asked for the folder, not refused before it got there");
  assert.equal(ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").photo_box, r.data.url);
});

test("uploading when the folder id in Settings cannot be opened refuses, and makes no second folder", () => {
  const ctx = fakeCtx();
  const drive = withDrive(ctx);
  // The id of a folder somebody made by hand and pasted in. Under .../auth/drive.file the app
  // cannot open it, and quietly making a new one would leave the family with two folders and
  // no idea which one holds their photos.
  ctx.settings = key => (key === "photo_folder_id" ? "MADE_BY_HAND" : "");
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "uploadMedicinePhoto", token, medicineId: "MED01", slot: "box", dataUrl: JPEG }, ctx);
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.error.code, "BAD_INPUT");
  assert.match(r.error.message, /photo_folder_id/);
  assert.match(r.error.message, /setUpPhotoFolder/);
  assert.equal(drive.created.length, 0, "nothing reached Drive");
  assert.equal(ctx.db.rows("Medicines").find(m => m.medicine_id === "MED01").photo_box, "", "and nothing reached the Sheet");
});
