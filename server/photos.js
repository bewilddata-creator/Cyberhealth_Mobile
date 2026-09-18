// Pure helpers for pill photos: no DOM, no Node APIs, no Drive calls.
// Synced to Apps Script by scripts/sync-gs.mjs, so keep names unique across all synced files.

export const PHOTO_SLOTS = ["box", "packet_front", "packet_back", "pill_front", "pill_back"];
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

const DATA_URL_RE = /^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/]+=*)$/;

export function isPhotoSlot(slot) {
  return PHOTO_SLOTS.includes(slot);
}

export function photoColumn(slot) {
  return isPhotoSlot(slot) ? `photo_${slot}` : "";
}

export function parseDataUrl(dataUrl) {
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
export function photoFolderName(medicine) {
  const med = medicine || {};
  const id = String(med.medicine_id == null ? "" : med.medicine_id).trim();
  const name = String(med.generic_name == null ? "" : med.generic_name).trim();
  const strength = String(med.strength == null ? "" : med.strength).trim();
  const label = [name, strength].filter(Boolean).join(" ");
  const joined = [id, label].filter(Boolean).join(" ").replace(/[\\/]/g, "-").trim().slice(0, 80);
  return joined || id;
}

export function photoFileName(slot, mimeType) {
  return `${slot}.${mimeType === "image/png" ? "png" : "jpg"}`;
}

// True when an existing Drive file name is a previous photo for this slot, whatever its
// extension -- so replacing a JPEG with a PNG (or the reverse) still finds and replaces it
// instead of leaving the old file orphaned. Compares only the part before the last dot.
export function isSameSlotFile(existingName, slot) {
  const name = String(existingName == null ? "" : existingName);
  const dot = name.lastIndexOf(".");
  const base = dot === -1 ? name : name.slice(0, dot);
  return base === slot;
}

export function driveViewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

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
