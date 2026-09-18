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
