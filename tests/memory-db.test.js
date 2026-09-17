import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb } from "../dev/memory-db.js";

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
