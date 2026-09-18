import { test } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_SLOTS, photoColumn, isPhotoSlot, parseDataUrl, photoFolderName, photoFileName, isSameSlotFile, driveViewUrl, MAX_PHOTO_BYTES, doctorPhotoFolderName, DOCTOR_PHOTO_FILE } from "../server/photos.js";

test("slots map to the Sheet's photo columns", () => {
  assert.deepEqual(PHOTO_SLOTS, ["box", "packet_front", "packet_back", "pill_front", "pill_back"]);
  assert.equal(photoColumn("pill_front"), "photo_pill_front");
  assert.equal(photoColumn("nope"), "");
  assert.equal(isPhotoSlot("box"), true);
  assert.equal(isPhotoSlot("Box"), false);
  // Every slot maps to a real v2 Medicines column, in order.
  assert.deepEqual(PHOTO_SLOTS.map(photoColumn), [
    "photo_box", "photo_packet_front", "photo_packet_back", "photo_pill_front", "photo_pill_back",
  ]);
  assert.equal(photoColumn("sideways"), "");
  assert.equal(isPhotoSlot("sideways"), false);
});

test("only base64 JPEG and PNG data URLs are accepted", () => {
  const png = parseDataUrl("data:image/png;base64,iVBORw0KGgo=");
  assert.equal(png.mimeType, "image/png");
  assert.equal(png.base64, "iVBORw0KGgo=");
  assert.equal(png.bytes, 8);
  const jpeg = parseDataUrl("data:image/jpeg;base64,/9j/4AAQ");
  assert.equal(jpeg.mimeType, "image/jpeg");
  assert.ok(jpeg.bytes > 0);
  assert.equal(parseDataUrl("data:text/html;base64,PHNjcmlwdD4="), null);
  assert.equal(parseDataUrl("data:image/gif;base64,R0lGOD"), null);
  assert.equal(parseDataUrl("https://example.com/x.jpg"), null);
  assert.equal(parseDataUrl(""), null);
  assert.equal(MAX_PHOTO_BYTES, 6291456);
});

test("folder and file names are safe and readable", () => {
  assert.equal(photoFolderName({ medicine_id: "M01", generic_name: "Amlodipine", strength: "5 mg" }), "M01 Amlodipine 5 mg");
  assert.equal(photoFolderName({ medicine_id: "M02", generic_name: "Co/trimoxazole", strength: "" }), "M02 Co-trimoxazole");
  assert.equal(photoFolderName({ medicine_id: "M03", generic_name: "  ", strength: "" }), "M03");
  assert.equal(photoFolderName({ medicine_id: "M04", generic_name: "x".repeat(200), strength: "5 mg" }).length, 80);
  assert.equal(photoFileName("box", "image/png"), "box.png");
  assert.equal(photoFileName("pill_back", "image/jpeg"), "pill_back.jpg");
  assert.equal(driveViewUrl("1AbC"), "https://drive.google.com/file/d/1AbC/view");
});

// I2: two medicines that share a generic name and strength (e.g. two brands) must never land in
// the same photo folder, or replacing one's photo could trash the other's. medicine_id is put
// first in the folder name so it always disambiguates them.
test("two medicines with the same name and strength get different folders", () => {
  const a = photoFolderName({ medicine_id: "M05", generic_name: "Metformin", strength: "500 mg" });
  const b = photoFolderName({ medicine_id: "M06", generic_name: "Metformin", strength: "500 mg" });
  assert.notEqual(a, b);

  const c = photoFolderName({ medicine_id: "MED01", generic_name: "Metformin", strength: "500 mg" });
  const d = photoFolderName({ medicine_id: "MED02", generic_name: "Metformin", strength: "500 mg" });
  assert.equal(c, "MED01 Metformin 500 mg");
  assert.equal(d, "MED02 Metformin 500 mg");
  assert.notEqual(c, d);
});

test("isSameSlotFile matches an old photo for the slot regardless of extension", () => {
  assert.equal(isSameSlotFile("box.jpg", "box"), true);
  assert.equal(isSameSlotFile("box.png", "box"), true);
  assert.equal(isSameSlotFile("box.jpeg", "box"), true);
  assert.equal(isSameSlotFile("box-old.jpg", "box"), false);
  assert.equal(isSameSlotFile("packet_front.jpg", "box"), false);
  assert.equal(isSameSlotFile("boxed.jpg", "box"), false);
});

test("doctorPhotoFolderName puts doctor_id first, so two doctors with one name never share a folder", () => {
  const a = { doctor_id: "DOC01", name: "Dr. Somchai K." };
  const b = { doctor_id: "DOC02", name: "Dr. Somchai K." };
  assert.equal(doctorPhotoFolderName(a), "DOC01 Dr. Somchai K.");
  assert.notEqual(doctorPhotoFolderName(a), doctorPhotoFolderName(b));
  assert.equal(doctorPhotoFolderName({ doctor_id: "DOC03", name: "" }), "DOC03");
});
