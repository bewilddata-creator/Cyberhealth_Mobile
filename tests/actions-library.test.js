import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/actions.js";
import { fakeCtx, loginAs } from "./fixtures.js";

// The libraries are shared family lists with no owner: any logged-in user may edit them, and
// that is deliberate -- a medicine or a hospital is a fact about the world, not about a person.
test("addHospital stores the whitelisted fields and gives the row a server id", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "addHospital", token, fields: { name: "  Sunrise Clinic ", phone: "02-555-0199", address: "12 Rama IV", map_link: "https://maps.example/x", notes: "Parking at the back", hospital_id: "HACK" } }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.name, "Sunrise Clinic");
  assert.equal(r.data.phone, "02-555-0199");
  assert.ok(r.data.hospital_id.startsWith("HOS-"), "the id is the server's, not the caller's");
  assert.match(r.data.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(r.data.created_by, "U02");
});

test("addHospital needs a name", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "addHospital", token, fields: { phone: "02-555-0199" } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
});

test("a logged-out caller cannot touch the hospital library", () => {
  const ctx = fakeCtx();
  const r = handle({ action: "addHospital", fields: { name: "Sunrise Clinic" } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "AUTH_REQUIRED");
});

test("updateHospital changes the shared row and stamps who changed it", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "updateHospital", token, hospitalId: "HOS01", fields: { phone: "02-555-0000" } }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const row = ctx.db.rows("Hospitals").find(h => h.hospital_id === "HOS01");
  assert.equal(row.phone, "02-555-0000");
  assert.equal(row.name, "Riverside General Hospital", "an untouched field is left alone");
  assert.equal(row.updated_by, "U02");
});

test("updateHospital refuses a blank name rather than erasing it", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "updateHospital", token, hospitalId: "HOS01", fields: { name: "   " } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
  assert.equal(ctx.db.rows("Hospitals").find(h => h.hospital_id === "HOS01").name, "Riverside General Hospital");
});

test("updateHospital says so plainly when the hospital is gone", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const r = handle({ action: "updateHospital", token, hospitalId: "HOS-GONE", fields: { phone: "1" } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_INPUT");
  assert.match(r.error.message, /list/i);
});

test("deleteHospital removes one nothing points at", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  const added = handle({ action: "addHospital", token, fields: { name: "Sunrise Clinic" } }, ctx);
  const id = added.data.hospital_id;
  const r = handle({ action: "deleteHospital", token, hospitalId: id }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data, { deleted: true });
  assert.equal(ctx.db.rows("Hospitals").filter(h => h.hospital_id === id).length, 0);
});

test("deleteHospital refuses one with a hospital number, a care team row or a doctor link, and says which", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  // HOS01 has HN01/HN03 (HospitalNumbers), CT01 (CareTeam) and DH01 (DoctorHospitals).
  const r = handle({ action: "deleteHospital", token, hospitalId: "HOS01" }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CONFLICT");
  assert.match(r.error.message, /hospital number|care team|doctor/i);
  assert.equal(ctx.db.rows("Hospitals").filter(h => h.hospital_id === "HOS01").length, 1);
});
