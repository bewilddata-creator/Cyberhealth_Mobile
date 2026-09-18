// Browser mock backend: runs the real server/actions.js on sample data saved in localStorage.
import { handle } from "../server/actions.js";
import { memoryDb } from "./memory-db.js";
import { sampleTables } from "./sample-data.js";

const KEY = "cyberhealth.mock";

// NOT cryptographic. Dev mock only: SubtleCrypto is async, handle() is sync.
export function fakeSha256(bytes) {
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (const b of bytes) { h1 = Math.imul(h1 ^ (b & 255), 16777619); h2 = Math.imul(h2 ^ (b & 255), 2246822519); }
  const out = [];
  for (let i = 0; i < 32; i++) {
    h1 = Math.imul(h1 ^ (h2 >>> (i % 17)), 16777619);
    h2 = Math.imul(h2 ^ h1, 3266489917);
    out.push((h1 ^ h2) & 255);
  }
  return out;
}

// The fake Drive. server/actions.js's photo actions need a ctx.drive and a ctx.settings, so
// without this the photo buttons throw in mock mode and cannot be tried locally at all.
// drive.put stores what the phone uploaded under a "mock:photo:<id>" reference and writes that
// reference into the Medicines row, exactly where a real Drive link would go; js/api.js wires
// mockPhotoUrl in as js/mockphoto.js's resolver, which is how js/viewmodel.js's driveImageUrl
// turns the reference back into something an <img> can show. Kept in localStorage alongside the
// tables so a reload still shows the photo; a quota error just means this session only.
const PHOTOS_KEY = KEY + ".photos";
let photos = null;
const trashed = [];

function loadPhotos() {
  try { photos = JSON.parse(localStorage.getItem(PHOTOS_KEY) || "{}"); } catch (e) { photos = {}; }
  if (!photos || typeof photos !== "object") photos = {};
}
function savePhotos() {
  try { localStorage.setItem(PHOTOS_KEY, JSON.stringify(photos)); } catch (e) { /* quota: memory only */ }
}

export function mockPhotoUrl(ref) {
  if (!photos) loadPhotos();
  return photos[String(ref == null ? "" : ref)] || "";
}
// What a real Drive would have moved to the bin, for the browser walk to check.
export function mockDriveTrashed() {
  return trashed.slice();
}

const mockDrive = {
  put(folderName, fileName, base64, mimeType) {
    if (!photos) loadPhotos();
    const id = `${folderName}/${fileName}#${Date.now().toString(36)}`;
    const url = `mock:photo:${id}`;
    photos[url] = `data:${mimeType};base64,${base64}`;
    savePhotos();
    return { id, url };
  },
  // Answers the way DriveStore.trashByUrl does: false when there is nothing there to bin, which
  // is what makes the server's "the old one is still in Drive" warning reachable in mock mode.
  trash(url) {
    if (!photos) loadPhotos();
    const key = String(url == null ? "" : url);
    trashed.push(key);
    if (!Object.prototype.hasOwnProperty.call(photos, key)) return false;
    delete photos[key];
    savePhotos();
    return true;
  },
};

let tables = null;
const sessions = new Map();
const attempts = new Map();
let seq = 0;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    tables = saved || sampleTables(fakeSha256);
    Object.entries(JSON.parse(localStorage.getItem(KEY + ".sessions") || "{}")).forEach(([k, v]) => sessions.set(k, v));
  } catch (e) {
    tables = sampleTables(fakeSha256);
  }
}
function saveState() {
  try {
    localStorage.setItem(KEY, JSON.stringify(tables));
    localStorage.setItem(KEY + ".sessions", JSON.stringify(Object.fromEntries(sessions)));
  } catch (e) { /* private mode: keep in memory only */ }
}

export async function mockCall(req) {
  if (!tables) loadState();
  const db = memoryDb(tables);
  const ctx = {
    db,
    sessions: {
      get: h => sessions.get(h) || null,
      put: (h, r) => { sessions.set(h, r); },
      remove: h => { sessions.delete(h); },
      removeForUser: id => { for (const [h, r] of sessions) if (r.userId === id) sessions.delete(h); },
    },
    attempts: { get: k => attempts.get(k) || 0, incr: k => { attempts.set(k, (attempts.get(k) || 0) + 1); }, clear: k => { attempts.delete(k); } },
    sha256: fakeSha256,
    randomToken: () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""),
    randomSalt: () => crypto.randomUUID(),
    newId: p => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`,
    nowMs: () => Date.now(),
    lock: fn => fn(),
    log: e => console.error(e),
    // Same read as apps-script/Drive.gs's SheetSettings.get, off the sample Settings tab.
    settings: key => {
      const row = db.rows("Settings").find(r => String(r.key || "").trim() === key);
      return row ? String(row.value || "").trim() : "";
    },
    drive: mockDrive,
  };
  await new Promise(r => setTimeout(r, 300)); // feel like a real network round trip
  const reply = handle(req, ctx);
  tables = db.tables;
  saveState();
  return JSON.parse(JSON.stringify(reply));
}
