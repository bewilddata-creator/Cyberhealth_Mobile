// Pure password and token helpers. The SHA-256 function is injected:
// Node crypto in tests, a sync fake in the dev mock, Utilities.computeDigest in Apps Script.

export const MIN_PASSWORD_LENGTH = 6;
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 900;
export const SESSION_DAYS = 180;
export const HASH_ROUNDS = 1000;

export function utf8Bytes(str) {
  const out = [];
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
export function toHex(bytes) { return bytes.map(b => (b & 255).toString(16).padStart(2, "0")).join(""); }

export function hashPassword(password, salt, sha256) {
  const saltBytes = utf8Bytes(salt);
  let h = Array.from(sha256(utf8Bytes(salt + ":" + password)), b => b & 255);
  for (let i = 1; i < HASH_ROUNDS; i++) h = Array.from(sha256(h.concat(saltBytes)), b => b & 255);
  return toHex(h);
}
export function makePasswordRecord(password, salt, sha256) {
  return `v1$${salt}$${hashPassword(password, salt, sha256)}`;
}
export function verifyPassword(password, record, sha256) {
  const parts = String(record || "").split("$");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1]) return false;
  const actual = hashPassword(String(password == null ? "" : password), parts[1], sha256);
  const expected = parts[2];
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
export function passwordProblem(pw) {
  return String(pw == null ? "" : pw).length < MIN_PASSWORD_LENGTH ? `Password needs at least ${MIN_PASSWORD_LENGTH} characters.` : null;
}
export function isResetCode(code) { return /^\d{6}$/.test(String(code == null ? "" : code).trim()); }
export function tokenHash(token, sha256) { return toHex(Array.from(sha256(utf8Bytes(String(token))), b => b & 255)); }
