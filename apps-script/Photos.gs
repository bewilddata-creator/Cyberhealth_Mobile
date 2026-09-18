// GENERATED from server/photos.js by scripts/sync-gs.mjs. Do not edit here: edit server/photos.js and run npm run sync-gs.
// Pure helpers for pill photos: no DOM, no Node APIs, no Drive calls.
// Synced to Apps Script by scripts/sync-gs.mjs, so keep names unique across all synced files.

const PHOTO_SLOTS = ["box", "packet_front", "packet_back", "pill_front", "pill_back"];
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

const DATA_URL_RE = /^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/]+=*)$/;

function isPhotoSlot(slot) {
  return PHOTO_SLOTS.includes(slot);
}

function photoColumn(slot) {
  return isPhotoSlot(slot) ? `photo_${slot}` : "";
}

function parseDataUrl(dataUrl) {
  const m = DATA_URL_RE.exec(String(dataUrl == null ? "" : dataUrl));
  if (!m) return null;
  const mimeType = m[1];
  const base64 = m[2];
  const padding = (base64.match(/=+$/) || [""])[0].length;
  const bytes = Math.floor((base64.length * 3) / 4) - padding;
  return { mimeType, base64, bytes };
}

// The medicine_id makes every medicine's folder unique even when two medicines share the same name
// and strength (e.g. two brands of the same generic) -- otherwise their photos would land in the
// same folder and replacing one's photo could trash the other's. It also means renaming a
// medicine never points a fresh upload at a different (new-name) folder, orphaning the old one.
function photoFolderName(medicine) {
  const med = medicine || {};
  const id = String(med.medicine_id == null ? "" : med.medicine_id).trim();
  const name = String(med.generic_name == null ? "" : med.generic_name).trim();
  const strength = String(med.strength == null ? "" : med.strength).trim();
  const label = [name, strength].filter(Boolean).join(" ");
  const joined = [id, label].filter(Boolean).join(" ").replace(/[\\/]/g, "-").trim().slice(0, 80);
  return joined || id;
}

function photoFileName(slot, mimeType) {
  return `${slot}.${mimeType === "image/png" ? "png" : "jpg"}`;
}

// True when an existing Drive file name is a previous photo for this slot, whatever its
// extension -- so replacing a JPEG with a PNG (or the reverse) still finds and replaces it
// instead of leaving the old file orphaned. Compares only the part before the last dot.
function isSameSlotFile(existingName, slot) {
  const name = String(existingName == null ? "" : existingName);
  const dot = name.lastIndexOf(".");
  const base = dot === -1 ? name : name.slice(0, dot);
  return base === slot;
}

function driveViewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}
