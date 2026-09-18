import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb } from "../dev/memory-db.js";
import { sharingRows } from "../server/actions.js";
import { fixtureTables, fakeCtx } from "./fixtures.js";

// Every test below pins one behaviour of dev/memory-db.js against SheetDb in
// apps-script/Data.gs, so the fake the whole suite runs on cannot drift back into being kinder
// than the real Sheet. The wording of these errors is SheetDb's own wording, on purpose: a
// missing column reaches the phone as the same message from the fake as from the real Sheet.

test("append throws for a field that is not a column, on a populated tab", () => {
  const db = memoryDb({ Users: [{ user_id: "U01", display_name: "Dad" }] });
  assert.throws(() => db.append("Users", { user_id: "U02", nickname: "Dad2" }), {
    message: 'The Users tab is missing the "nickname" column.',
    code: "SERVER",
  });
});

test("append throws for a field that is not a column, on an empty tab (columns from __columns)", () => {
  const db = memoryDb({ DoseLog: [], __columns: { DoseLog: ["log_id", "prescription_id", "date"] } });
  assert.throws(() => db.append("DoseLog", { log_id: "L01", oops: "1" }), {
    message: 'The DoseLog tab is missing the "oops" column.',
  });
  // A field that IS a declared column still appends fine, and append returns the caller's own
  // object plus _row -- not the stored row -- exactly like SheetDb.append.
  assert.deepEqual(db.append("DoseLog", { log_id: "L01" }), { log_id: "L01", _row: 2 });
});

test("update throws for a field that is not a column", () => {
  const db = memoryDb({ Users: [{ user_id: "U01", display_name: "Dad" }] });
  assert.throws(() => db.update("Users", "user_id", "U01", { nickname: "Dad2" }), {
    message: 'The Users tab is missing the "nickname" column.',
  });
  assert.equal(db.update("Users", "user_id", "U01", { display_name: "Daddy" }), true);
});

test("update refuses an unknown column even when the row does not exist", () => {
  const db = memoryDb({ Users: [{ user_id: "U01", display_name: "Dad" }] });
  assert.throws(() => db.update("Users", "user_id", "NOPE", { nickname: "Ghost" }), {
    message: 'The Users tab is missing the "nickname" column.',
  });
  // A real column with a missing row just reports "not found", it doesn't throw.
  assert.equal(db.update("Users", "user_id", "NOPE", { display_name: "Ghost" }), false);
});

test("update refuses an unknown column on an empty tab, using __columns", () => {
  const db = memoryDb({ DoseLog: [], __columns: { DoseLog: ["log_id", "prescription_id", "date"] } });
  assert.throws(() => db.update("DoseLog", "log_id", "L01", { oops: "1" }), {
    message: 'The DoseLog tab is missing the "oops" column.',
  });
});

test("a missing tab fails the same way as sheet_() in apps-script/Data.gs", () => {
  const db = memoryDb({ Users: [] });
  assert.throws(() => db.rows("Nope"), { message: 'The Sheet is missing the "Nope" tab.', code: "SERVER" });
  assert.throws(() => db.append("Nope", {}), { message: 'The Sheet is missing the "Nope" tab.' });
  assert.throws(() => db.update("Nope", "a", "b", {}), { message: 'The Sheet is missing the "Nope" tab.' });
  assert.throws(() => db.remove("Nope", () => true), { message: 'The Sheet is missing the "Nope" tab.' });
});

test("rows() returns every cell as a trimmed string, like cellToString_ in apps-script/Data.gs", () => {
  const db = memoryDb({
    __columns: { DoseLog: ["log_id", "prescription_id", "date", "amount_taken", "status", "taken_at"] },
    DoseLog: [
      // A number, a boolean, a padded string and two Date cells -- every shape a real Sheet cell
      // can hold. Nothing here comes back as a number, a boolean or a Date.
      { log_id: "  L01  ", prescription_id: "RX01", date: new Date(Date.parse("2026-09-15T18:30:00Z")), amount_taken: 2, status: true, taken_at: new Date(Date.parse("2026-09-15T18:30:00Z")) },
    ],
  });
  const [r] = db.rows("DoseLog");
  assert.equal(r.log_id, "L01", "trimmed");
  assert.equal(r.amount_taken, "2", "a number reads back as text");
  assert.equal(r.status, "TRUE", "a boolean reads back as TRUE/FALSE");
  // 18:30 UTC is 01:30 the next day in Bangkok: a date-only column keeps the day, a timestamp
  // column keeps the minute, both in Asia/Bangkok.
  assert.equal(r.date, "2026-09-16");
  assert.equal(r.taken_at, "2026-09-16 01:30");
});

test("rows() fills in every declared column of the tab, even one the row never stored", () => {
  const db = memoryDb({
    __columns: { Medicines: ["medicine_id", "generic_name", "photo_box"] },
    Medicines: [{ medicine_id: "MED01" }],
  });
  assert.deepEqual(db.rows("Medicines"), [{ _row: 2, medicine_id: "MED01", generic_name: "", photo_box: "" }]);
});

test("append writes every column of the row as text, blank where the caller sent nothing", () => {
  const tables = { __columns: { Medicines: ["medicine_id", "generic_name", "strength"] }, Medicines: [] };
  const db = memoryDb(tables);
  db.append("Medicines", { medicine_id: "MED01", strength: 5 });
  assert.deepEqual(tables.Medicines, [{ medicine_id: "MED01", generic_name: "", strength: "5" }]);
});

test("append stores a copy: mutating what it returns does not change the stored row", () => {
  const tables = { __columns: { Medicines: ["medicine_id", "generic_name"] }, Medicines: [] };
  const db = memoryDb(tables);
  const returned = db.append("Medicines", { medicine_id: "MED01", generic_name: "Amlodipine" });
  returned.generic_name = "Something else";
  assert.equal(db.rows("Medicines")[0].generic_name, "Amlodipine");
});

test("update writes String(patch[k]), so undefined lands in the Sheet as the text 'undefined'", () => {
  // SheetDb.update has no null guard (append does): setValue(String(patch[k])). A caller that
  // patches a column with undefined really does write the word into the family's Sheet.
  const db = memoryDb({ __columns: { Medicines: ["medicine_id", "notes"] }, Medicines: [{ medicine_id: "MED01", notes: "" }] });
  assert.equal(db.update("Medicines", "medicine_id", "MED01", { notes: undefined }), true);
  assert.equal(db.rows("Medicines")[0].notes, "undefined");
});

test("update finds its row through rows(), so the key is matched against the trimmed cell", () => {
  const db = memoryDb({ __columns: { Medicines: ["medicine_id", "generic_name"] }, Medicines: [{ medicine_id: "  MED01  ", generic_name: "Amlodipine" }] });
  assert.equal(db.update("Medicines", "medicine_id", "MED01", { generic_name: "Renamed" }), true);
  assert.equal(db.rows("Medicines")[0].generic_name, "Renamed");
  // ...and a number never matches the text a Sheet cell holds.
  const numeric = memoryDb({ __columns: { Settings: ["key", "value"] }, Settings: [{ key: "5", value: "x" }] });
  assert.equal(numeric.update("Settings", "key", 5, { value: "y" }), false);
});

test("update skips a blank spacer row and writes to the right sheet row", () => {
  const tables = {
    __columns: { Medicines: ["medicine_id", "generic_name"] },
    Medicines: [{ medicine_id: "", generic_name: "" }, { medicine_id: "MED01", generic_name: "Amlodipine" }],
  };
  const db = memoryDb(tables);
  assert.equal(db.update("Medicines", "medicine_id", "MED01", { generic_name: "Renamed" }), true);
  assert.equal(tables.Medicines[0].generic_name, "", "the spacer row is untouched");
  assert.equal(tables.Medicines[1].generic_name, "Renamed");
});

test("update does not touch a row object the caller read earlier (SheetDb writes to the Sheet, not to your object)", () => {
  const db = memoryDb({ __columns: { Medicines: ["medicine_id", "generic_name"] }, Medicines: [{ medicine_id: "MED01", generic_name: "Amlodipine" }] });
  const stale = db.rows("Medicines")[0];
  db.update("Medicines", "medicine_id", "MED01", { generic_name: "Renamed" });
  assert.equal(stale.generic_name, "Amlodipine", "an already-read row stays stale -- re-read to see a write");
  assert.equal(db.rows("Medicines")[0].generic_name, "Renamed");
});

test("remove() gives the predicate a backfilled row, never a blank spacer row", () => {
  const tables = {
    __columns: { Medicines: ["medicine_id", "generic_name", "photo_box"] },
    Medicines: [
      { medicine_id: "MED01", generic_name: "Amlodipine" }, // photo_box never stored
      { medicine_id: "", generic_name: "", photo_box: "" }, // spacer row an admin left behind
      { medicine_id: "MED02", generic_name: "Metformin", photo_box: "" },
    ],
  };
  const db = memoryDb(tables);
  const seen = [];
  const removed = db.remove("Medicines", r => { seen.push(r); return r.photo_box === ""; });
  assert.deepEqual(seen.map(r => r.medicine_id), ["MED01", "MED02"], "the spacer row is never offered to the predicate");
  assert.deepEqual(seen.map(r => r._row), [2, 4], "rows keep their true sheet numbers");
  assert.equal(removed, 2, "remove reports how many rows it deleted");
  assert.deepEqual(tables.Medicines, [{ medicine_id: "", generic_name: "", photo_box: "" }], "only the spacer row is left");
});

test("remove() deletes nothing when the predicate matches nothing", () => {
  const tables = { __columns: { DoseLog: ["log_id"] }, DoseLog: [{ log_id: "L01" }] };
  const db = memoryDb(tables);
  assert.equal(db.remove("DoseLog", r => r.log_id === "L99"), 0);
  assert.equal(tables.DoseLog.length, 1);
});

test("rows() skips a blank spacer row and later rows keep their true _row (same rule as SheetDb.rows() in apps-script/Data.gs)", () => {
  const db = memoryDb({
    Medicines: [
      { medicine_id: "MED01", generic_name: "Amlodipine" },
      { medicine_id: "", generic_name: "" },
      { medicine_id: "MED02", generic_name: "Metformin" },
    ],
  });
  const rows = db.rows("Medicines");
  assert.deepEqual(rows.map(r => r.medicine_id), ["MED01", "MED02"]);
  assert.deepEqual(rows.map(r => r._row), [2, 4], "the blank row at index 1 (_row 3) is skipped, not renumbered away");
});

test("sharingRows returns trimmed owner/shared_with/section/access rows from the fixtures", () => {
  const ctx = fakeCtx(fixtureTables());
  assert.deepEqual(sharingRows(ctx), [
    { owner_user_id: "U01", shared_with_user_id: "", section: "Medicines", access: "Edit" },
    { owner_user_id: "U01", shared_with_user_id: "", section: "Care team", access: "View" },
    { owner_user_id: "U02", shared_with_user_id: "U03", section: "Medicines", access: "View" },
  ]);
});
