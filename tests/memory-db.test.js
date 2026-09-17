import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb } from "../dev/memory-db.js";
import { sharingRows } from "../server/actions.js";
import { fixtureTables, fakeCtx } from "./fixtures.js";

test("append throws for a field that is not a column, on a populated tab", () => {
  const db = memoryDb({ Users: [{ user_id: "U01", display_name: "Dad" }] });
  assert.throws(() => db.append("Users", { user_id: "U02", nickname: "Dad2" }), {
    message: 'The Users tab has no "nickname" column.',
  });
});

test("append throws for a field that is not a column, on an empty tab (columns from __columns)", () => {
  const db = memoryDb({ DoseLog: [], __columns: { DoseLog: ["log_id", "prescription_id", "date"] } });
  assert.throws(() => db.append("DoseLog", { log_id: "L01", oops: "1" }), {
    message: 'The DoseLog tab has no "oops" column.',
  });
  // A field that IS a declared column still appends fine.
  assert.deepEqual(db.append("DoseLog", { log_id: "L01" }), { log_id: "L01", _row: 2 });
});

test("update throws for a field that is not a column", () => {
  const db = memoryDb({ Users: [{ user_id: "U01", display_name: "Dad" }] });
  assert.throws(() => db.update("Users", "user_id", "U01", { nickname: "Dad2" }), {
    message: 'The Users tab has no "nickname" column.',
  });
  assert.equal(db.update("Users", "user_id", "U01", { display_name: "Daddy" }), true);
});

test("update refuses an unknown column even when the row does not exist", () => {
  const db = memoryDb({ Users: [{ user_id: "U01", display_name: "Dad" }] });
  assert.throws(() => db.update("Users", "user_id", "NOPE", { nickname: "Ghost" }), {
    message: 'The Users tab has no "nickname" column.',
  });
  // A real column with a missing row just reports "not found", it doesn't throw.
  assert.equal(db.update("Users", "user_id", "NOPE", { display_name: "Ghost" }), false);
});

test("update refuses an unknown column on an empty tab, using __columns", () => {
  const db = memoryDb({ DoseLog: [], __columns: { DoseLog: ["log_id", "prescription_id", "date"] } });
  assert.throws(() => db.update("DoseLog", "log_id", "L01", { oops: "1" }), {
    message: 'The DoseLog tab has no "oops" column.',
  });
});

test("sharingRows returns trimmed owner/shared_with/section/access rows from the fixtures", () => {
  const ctx = fakeCtx(fixtureTables());
  assert.deepEqual(sharingRows(ctx), [
    { owner_user_id: "U01", shared_with_user_id: "", section: "Medicines", access: "Edit" },
    { owner_user_id: "U01", shared_with_user_id: "", section: "Care team", access: "View" },
    { owner_user_id: "U02", shared_with_user_id: "U03", section: "Medicines", access: "View" },
  ]);
});
