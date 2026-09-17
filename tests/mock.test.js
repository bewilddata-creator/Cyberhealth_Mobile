// The dev sample data, run through the real server (not the browser mock.js, which needs
// localStorage/crypto.randomUUID): a Node-side sanity check that dev/sample-data.js is well
// formed and rich enough for the browser walkthrough.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handle } from "../server/actions.js";
import { memoryDb } from "../dev/memory-db.js";
import { sampleTables } from "../dev/sample-data.js";

const sha256 = bytes => Array.from(createHash("sha256").update(Uint8Array.from(bytes.map(b => b & 255))).digest());

function ctxFor(tables) {
  const sessions = new Map(), attempts = new Map(), idSeq = new Map();
  let seq = 0;
  return {
    db: memoryDb(tables),
    sessions: {
      get: h => sessions.get(h) || null,
      put: (h, r) => { sessions.set(h, r); },
      remove: h => { sessions.delete(h); },
      removeForUser: id => { for (const [h, r] of sessions) if (r.userId === id) sessions.delete(h); },
    },
    attempts: { get: k => attempts.get(k) || 0, incr: k => { attempts.set(k, (attempts.get(k) || 0) + 1); }, clear: k => { attempts.delete(k); } },
    sha256,
    randomToken: () => `tok${++seq}`,
    randomSalt: () => `salt${seq}`,
    newId(prefix) { const n = (idSeq.get(prefix) || 0) + 1; idSeq.set(prefix, n); return `${prefix}-${String(n).padStart(6, "0")}`; },
    nowMs: () => Date.now(),
    lock: fn => fn(),
  };
}

test("sample data: Dad logs in and bootstraps with no warnings, at least 8 active prescriptions", () => {
  const ctx = ctxFor(sampleTables(sha256));
  const login = handle({ action: "login", name: "Dad", password: "dad123" }, ctx);
  assert.equal(login.ok, true, login.ok ? "" : login.error.message);
  const token = login.data.token;

  const r = handle({ action: "bootstrap", token }, ctx);
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  assert.deepEqual(r.data.warnings, []);

  const dadActive = r.data.prescriptions.filter(p => p.userId === "U01" && p.status === "Active");
  assert.ok(dadActive.length >= 8, `expected at least 8 active prescriptions for Dad, got ${dadActive.length}`);
});

test("sample data: Top can set a password with the 123456 reset code", () => {
  const ctx = ctxFor(sampleTables(sha256));
  const r = handle({ action: "setPassword", name: "Top", code: "123456", newPassword: "toppass1" }, ctx);
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  assert.ok(r.data.token);

  // The new password works for a fresh login.
  const login = handle({ action: "login", name: "Top", password: "toppass1" }, ctx);
  assert.equal(login.ok, true, login.ok ? "" : login.error.message);
});
