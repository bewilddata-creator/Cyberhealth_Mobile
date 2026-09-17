import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { utf8Bytes, toHex, hashPassword, makePasswordRecord, verifyPassword, passwordProblem, isResetCode, tokenHash, HASH_ROUNDS } from "../js/authcore.js";

const sha256 = bytes => Array.from(createHash("sha256").update(Uint8Array.from(bytes.map(b => b & 255))).digest());

test("byte helpers", () => {
  assert.deepEqual(utf8Bytes("Aé€😀"), [65, 195, 169, 226, 130, 172, 240, 159, 152, 128]);
  assert.equal(toHex([0, 255, 16, -1]), "00ff10ff");
  assert.equal(HASH_ROUNDS, 1000);
});

test("password records verify only the right password", () => {
  const rec = makePasswordRecord("dad123", "c2FsdA==", sha256);
  assert.match(rec, /^v1\$c2FsdA==\$[0-9a-f]{64}$/);
  assert.equal(verifyPassword("dad123", rec, sha256), true);
  assert.equal(verifyPassword("dad124", rec, sha256), false);
  assert.equal(verifyPassword("dad123", "", sha256), false);
  assert.equal(verifyPassword("dad123", "v2$c2FsdA==$abc", sha256), false);
  assert.notEqual(hashPassword("dad123", "a", sha256), hashPassword("dad123", "b", sha256));
  assert.equal(hashPassword("dad123", "a", sha256), hashPassword("dad123", "a", sha256));
});

test("works with a signed-byte digest like Apps Script returns", () => {
  const signed = bytes => sha256(bytes).map(b => (b > 127 ? b - 256 : b));
  const rec = makePasswordRecord("pim123", "salt", signed);
  assert.equal(verifyPassword("pim123", rec, sha256), true);
});

test("password rules, reset codes, token hashes", () => {
  assert.equal(passwordProblem("12345"), "Password needs at least 6 characters.");
  assert.equal(passwordProblem("123456"), null);
  assert.equal(isResetCode("012345"), true);
  assert.equal(isResetCode(" 482915 "), true);
  assert.equal(isResetCode("12345"), false);
  assert.equal(isResetCode("12a456"), false);
  assert.equal(tokenHash("abc", sha256), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
