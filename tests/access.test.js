import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SECTIONS,
  isActiveUser,
  publicUser,
  grantFor,
  canRead,
  canEdit,
  readableOwners,
  canTick,
} from "../js/access.js";

const sharing = [
  { owner_user_id: "U01", shared_with_user_id: "", section: "Medicines", access: "View" },
  { owner_user_id: "U02", shared_with_user_id: "U03", section: "Medicines", access: "Edit" },
  { owner_user_id: "U03", shared_with_user_id: "", section: "Care team", access: "View" },
  { owner_user_id: "U04", shared_with_user_id: "", section: "Medicines", access: "Bogus" },
];

test("the owner always gets Edit on both sections, even with no rows", () => {
  assert.equal(grantFor("U01", "U01", SECTIONS.MEDICINES, []), "Edit");
  assert.equal(grantFor("U01", "U01", SECTIONS.CARE_TEAM, []), "Edit");
  assert.equal(canRead("U01", "U01", SECTIONS.MEDICINES, []), true);
  assert.equal(canEdit("U01", "U01", SECTIONS.MEDICINES, []), true);
});

test("a blank shared_with_user_id row grants every viewer, for that section only", () => {
  assert.equal(grantFor("U02", "U01", SECTIONS.MEDICINES, sharing), "View");
  assert.equal(grantFor("U03", "U01", SECTIONS.MEDICINES, sharing), "View");
  assert.equal(grantFor("U02", "U01", SECTIONS.CARE_TEAM, sharing), "");
});

test("a named shared_with_user_id row grants only that viewer", () => {
  assert.equal(grantFor("U03", "U02", SECTIONS.MEDICINES, sharing), "Edit");
  assert.equal(grantFor("U01", "U02", SECTIONS.MEDICINES, sharing), "");
  assert.equal(grantFor("U04", "U02", SECTIONS.MEDICINES, sharing), "");
});

test("View grants read but not edit; Edit grants both", () => {
  assert.equal(canRead("U02", "U01", SECTIONS.MEDICINES, sharing), true);
  assert.equal(canEdit("U02", "U01", SECTIONS.MEDICINES, sharing), false);
  assert.equal(canRead("U03", "U02", SECTIONS.MEDICINES, sharing), true);
  assert.equal(canEdit("U03", "U02", SECTIONS.MEDICINES, sharing), true);
});

test("when several rows apply, the strongest wins", () => {
  const rows = [
    { owner_user_id: "U01", shared_with_user_id: "", section: "Medicines", access: "View" },
    { owner_user_id: "U01", shared_with_user_id: "U02", section: "Medicines", access: "Edit" },
  ];
  assert.equal(grantFor("U02", "U01", SECTIONS.MEDICINES, rows), "Edit");
  // order shouldn't matter
  assert.equal(grantFor("U02", "U01", SECTIONS.MEDICINES, [...rows].reverse()), "Edit");
});

test("an access value other than View or Edit grants nothing", () => {
  assert.equal(grantFor("U05", "U04", SECTIONS.MEDICINES, sharing), "");
  assert.equal(canRead("U05", "U04", SECTIONS.MEDICINES, sharing), false);
});

test("blank viewer or owner ids grant nothing", () => {
  assert.equal(grantFor("", "U01", SECTIONS.MEDICINES, sharing), "");
  assert.equal(grantFor("U01", "", SECTIONS.MEDICINES, sharing), "");
  assert.equal(grantFor("", "", SECTIONS.MEDICINES, sharing), "");
  assert.equal(grantFor(undefined, "U01", SECTIONS.MEDICINES, sharing), "");
  assert.equal(grantFor("U01", undefined, SECTIONS.MEDICINES, sharing), "");
});

test("readableOwners filters to the ids the viewer can read", () => {
  assert.deepEqual(
    readableOwners("U03", ["U01", "U02", "U03", "U04"], SECTIONS.MEDICINES, sharing),
    ["U01", "U02", "U03"]
  );
  assert.deepEqual(
    readableOwners("U03", ["U01", "U02", "U03", "U04"], SECTIONS.CARE_TEAM, sharing),
    ["U03"]
  );
});

test("canTick is the owner alone, and requires a non-blank id", () => {
  assert.equal(canTick("U01", "U01"), true);
  assert.equal(canTick("U02", "U01"), false);
  assert.equal(canTick("", ""), false);
  assert.equal(canTick("U01", ""), false);
});

test("isActiveUser and publicUser", () => {
  assert.equal(isActiveUser({ user_id: "U01", active: "TRUE" }), true);
  assert.equal(isActiveUser({ user_id: "U01", active: "" }), true);
  assert.equal(isActiveUser({ user_id: "U01", active: "false" }), false);
  assert.equal(isActiveUser({ user_id: " ", active: "TRUE" }), false);
  assert.equal(isActiveUser(null), false);
  assert.deepEqual(
    publicUser({ user_id: "U01", display_name: "Dad", role: "Dad", password_hash: "x", reset_code: "1", line_user_id: "L" }),
    { user_id: "U01", display_name: "Dad", role: "Dad" }
  );
});
