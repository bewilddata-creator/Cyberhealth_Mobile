// The script lock, which nothing tested.
//
// Two family members can tap Save at the same second: Dad ticks a dose on his phone while his
// daughter saves a new dose on hers. LockService is the only thing that stops one write landing
// on top of the other, and every write action does take ctx.lock -- but the test fake was
// `lock: fn => fn()` with no counter, so an action that simply never took it would have passed all
// 342 tests and only shown up as a lost dose in the family's Sheet.
//
// fakeCtx now counts, and this file asserts, one write action at a time, that the lock was taken.
// The last test closes the hole this approach would otherwise leave: a NEW action added later
// without a lock. Every action name defined in server/actions.js must appear in one of the two
// lists below, so adding one fails here until its lock is decided on deliberately.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handle } from "../server/actions.js";
import { fakeCtx, loginAs } from "./fixtures.js";

// Dad's token, plus the photo services the two photo actions need (the same shape
// apps-script/Code.gs's liveCtx_ builds and dev/mock.js mirrors).
function world() {
  const ctx = fakeCtx();
  ctx.settings = key => (key === "photo_folder_id" ? "FOLDER123" : "");
  ctx.drive = {
    canOpen: folderId => folderId === "FOLDER123",
    put: () => ({ id: "FILE1", url: "https://drive.google.com/file/d/FILE1/view" }),
    trash: () => true,
  };
  return { ctx, token: loginAs(ctx, "Dad", "dad123") };
}

const TINY_JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const DAY = "2026-09-15"; // fixtures.NOW, in Bangkok

// [action name, the request that should succeed]. Every one of these writes to the Sheet, so
// every one must hold the lock while it does.
const WRITE_ACTIONS = [
  ["setPassword", () => ({ action: "setPassword", name: "Top", code: "123456", newPassword: "top-pw-1" })],
  ["tick", t => ({ action: "tick", token: t, prescriptionId: "RX01", date: DAY, timeOfDay: "Morning", doseId: "DS01", amount: 2 })],
  ["tickAll", t => ({ action: "tickAll", token: t, date: DAY, timeOfDay: "Morning", items: [{ prescriptionId: "RX01", doseId: "DS01", amount: 2 }, { prescriptionId: "RX02", doseId: "DS02", amount: 1 }] })],
  ["untick", t => ({ action: "untick", token: t, prescriptionId: "RX01", date: DAY, timeOfDay: "Morning" })],
  ["saveEmergencyCard", t => ({ action: "saveEmergencyCard", token: t, fields: { blood_type: "B+" } })],
  ["addPrescription", t => ({ action: "addPrescription", token: t, userId: "U01", medicineId: "MED05", frequency: "Daily", doses: [{ timeOfDay: "Noon", amount: 1, unit: "tablet" }] })],
  ["changePrescriptionDose", t => ({ action: "changePrescriptionDose", token: t, prescriptionId: "RX01", doses: [{ timeOfDay: "Morning", amount: 1, unit: "tablet" }] })],
  ["changePrescriptionSchedule", t => ({ action: "changePrescriptionSchedule", token: t, prescriptionId: "RX01", frequency: "Daily" })],
  ["stopPrescription", t => ({ action: "stopPrescription", token: t, prescriptionId: "RX01" })],
  ["restartPrescription", t => ({ action: "restartPrescription", token: t, prescriptionId: "RX06" })],
  ["deletePrescription", t => ({ action: "deletePrescription", token: t, prescriptionId: "RX03" })],
  ["addMedicine", t => ({ action: "addMedicine", token: t, fields: { generic_name: "Aspirin" } })],
  ["updateMedicine", t => ({ action: "updateMedicine", token: t, medicineId: "MED01", fields: { generic_name: "Amlodipine besylate" } })],
  ["uploadMedicinePhoto", t => ({ action: "uploadMedicinePhoto", token: t, medicineId: "MED01", slot: "box", dataUrl: TINY_JPEG })],
  ["removeMedicinePhoto", t => ({ action: "removeMedicinePhoto", token: t, medicineId: "MED01", slot: "pill_front" })],
];

// Actions that only read. A lock here would serialize every phone's refresh behind every write
// for no gain, so taking one is a bug in the other direction.
const READ_ACTIONS = [
  ["listUsers", () => ({ action: "listUsers" })],
  ["login", () => ({ action: "login", name: "Dad", password: "dad123" })],
  ["logout", t => ({ action: "logout", token: t })],
  ["publicEmergency", () => ({ action: "publicEmergency" })],
  ["bootstrap", t => ({ action: "bootstrap", token: t })],
];

for (const [name, build] of WRITE_ACTIONS) {
  test(`${name} takes the script lock`, () => {
    const { ctx, token } = world();
    const before = ctx.locksTaken();
    const r = handle(build(token), ctx);
    assert.equal(r.ok, true, `${name} should have succeeded: ${JSON.stringify(r)}`);
    assert.ok(
      ctx.locksTaken() > before,
      `${name} wrote to the Sheet without taking ctx.lock -- two phones saving at once can lose one of the writes`,
    );
  });
}

for (const [name, build] of READ_ACTIONS) {
  test(`${name} takes no lock, because it only reads`, () => {
    const { ctx, token } = world();
    const before = ctx.locksTaken();
    const r = handle(build(token), ctx);
    assert.equal(r.ok, true, `${name} should have succeeded: ${JSON.stringify(r)}`);
    assert.equal(ctx.locksTaken(), before, `${name} is a read: locking it queues every refresh behind every write`);
  });
}

test("every action in server/actions.js is covered by one of the two lists above", () => {
  const src = readFileSync("server/actions.js", "utf8");
  const defined = [...src.matchAll(/^ {2}(\w+)\(req, ctx\) \{$/gm)].map(m => m[1]);
  assert.ok(defined.length >= 20, `only found ${defined.length} actions -- has the shape changed?`);
  const covered = new Set([...WRITE_ACTIONS, ...READ_ACTIONS].map(([n]) => n));
  for (const name of defined) {
    assert.ok(covered.has(name), `"${name}" is a new action with no lock decision: add it to WRITE_ACTIONS or READ_ACTIONS`);
  }
  // And nothing in the lists has been quietly renamed away from a real action.
  for (const name of covered) assert.ok(defined.includes(name), `"${name}" is listed here but no longer exists`);
});

// The Apps Script lock does one more thing the fake cannot: it drops the per-request tab cache the
// moment it is held, so an action that read a tab BEFORE locking still re-reads it inside. The
// behaviour is exercised through the vm harness in tests/gs-actions.test.js; this pins the wiring
// itself, so deleting the invalidate() call cannot pass on a day the harness test is skipped.
test("liveCtx_ drops the request cache inside the lock, before the action's own work", () => {
  const code = readFileSync("apps-script/Code.gs", "utf8");
  assert.match(
    code,
    /lock:\s*fn\s*=>\s*withLock_\(\(\)\s*=>\s*\{\s*db\.invalidate\(\);\s*return fn\(\);\s*\}\)/,
    "liveCtx_'s lock must call db.invalidate() before fn(), or an in-lock read is served from a stale cache",
  );
});
