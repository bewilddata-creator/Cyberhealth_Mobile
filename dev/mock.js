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

// Release 1 has no fake Drive photos (that's release 2's photo upload feature) -- js/api.js
// always wires this in as the mock backend's photo resolver, so it must exist and just says
// "no photo" for every reference rather than leaving js/mockphoto.js's resolver undefined.
export function mockPhotoUrl(ref) {
  return "";
}

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
  };
  await new Promise(r => setTimeout(r, 300)); // feel like a real network round trip
  const reply = handle(req, ctx);
  tables = db.tables;
  saveState();
  return JSON.parse(JSON.stringify(reply));
}
