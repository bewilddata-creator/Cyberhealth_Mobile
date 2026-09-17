import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/actions.js";
import { fakeCtx, loginAs, NOW } from "./fixtures.js";

const code = r => (r.ok ? "OK" : r.error.code);

test("unknown action and unexpected errors", () => {
  const ctx = fakeCtx();
  assert.equal(code(handle({ action: "nope" }, ctx)), "BAD_INPUT");
  assert.equal(code(handle(null, ctx)), "BAD_INPUT");
  const logged = [];
  ctx.log = e => logged.push(e);
  ctx.db.rows = () => { throw new Error("boom"); };
  const r = handle({ action: "listUsers" }, ctx);
  assert.equal(code(r), "SERVER");
  assert.equal(r.error.message, "Something went wrong on the server. Try again.");
  assert.equal(logged.length, 1);
});

test("listUsers returns active named users only, without secrets", () => {
  const r = handle({ action: "listUsers" }, fakeCtx());
  assert.deepEqual(r.data, [{ user_id: "U01", display_name: "Dad" }, { user_id: "U02", display_name: "Pim" }, { user_id: "U03", display_name: "Top" }]);
});

test("login succeeds with the right password, case-insensitive name", () => {
  const ctx = fakeCtx();
  const r = handle({ action: "login", name: " dad ", password: "dad123" }, ctx);
  assert.equal(code(r), "OK");
  assert.deepEqual(r.data.user, { user_id: "U01", display_name: "Dad", role: "Primary" });
  assert.ok(r.data.token.length > 10);
});

test("login fails the same way for wrong password, unknown name, no password yet, inactive user", () => {
  const ctx = fakeCtx();
  for (const [name, password] of [["Dad", "wrong1"], ["Nobody", "dad123"], ["Top", ""], ["Old", "old123"]]) {
    const r = handle({ action: "login", name, password }, ctx);
    assert.equal(code(r), "AUTH_FAILED");
    assert.equal(r.error.message, "Name or password is wrong. First time? Tap “Set or forgot password”.");
  }
});

test("five wrong passwords lock out further wrong tries, but the right password always still logs in", () => {
  const ctx = fakeCtx();
  for (let i = 0; i < 4; i++) assert.equal(code(handle({ action: "login", name: "Dad", password: "nope00" }, ctx)), "AUTH_FAILED");
  const fifth = handle({ action: "login", name: "Dad", password: "nope00" }, ctx);
  assert.equal(code(fifth), "LOCKED_OUT");
  assert.equal(fifth.error.message, "Too many tries. Wait 15 minutes and try again.");
  const sixthWrong = handle({ action: "login", name: "DAD", password: "stillwrong" }, ctx);
  assert.equal(code(sixthWrong), "LOCKED_OUT");
  assert.equal(code(handle({ action: "login", name: "DAD", password: "dad123" }, ctx)), "OK");
  assert.equal(code(handle({ action: "login", name: "Pim", password: "pim123" }, ctx)), "OK");
});

test("after 50 wrong tries even the right password is refused until the counter expires", () => {
  const ctx = fakeCtx();
  for (let i = 0; i < 50; i++) handle({ action: "login", name: "Dad", password: "nope00" }, ctx);
  const capped = handle({ action: "login", name: "Dad", password: "dad123" }, ctx);
  assert.equal(code(capped), "LOCKED_OUT");
  assert.equal(capped.error.message, "Too many tries. Wait 15 minutes and try again.");
  assert.equal(code(handle({ action: "login", name: "Pim", password: "pim123" }, ctx)), "OK");
  ctx.attempts.clear("dad");
  assert.equal(code(handle({ action: "login", name: "Dad", password: "dad123" }, ctx)), "OK");
});

test("a successful login clears earlier failures", () => {
  const ctx = fakeCtx();
  for (let i = 0; i < 4; i++) handle({ action: "login", name: "Dad", password: "nope00" }, ctx);
  loginAs(ctx, "Dad", "dad123");
  for (let i = 0; i < 4; i++) handle({ action: "login", name: "Dad", password: "nope00" }, ctx);
  assert.equal(code(handle({ action: "login", name: "Dad", password: "dad123" }, ctx)), "OK");
});

test("setPassword with a reset code", () => {
  const ctx = fakeCtx();
  assert.equal(code(handle({ action: "setPassword", name: "Top", code: "000000", newPassword: "top1234" }, ctx)), "AUTH_FAILED");
  assert.equal(code(handle({ action: "setPassword", name: "Dad", code: "", newPassword: "top1234" }, ctx)), "AUTH_FAILED");
  const short = handle({ action: "setPassword", name: "Top", code: "123456", newPassword: "abc" }, ctx);
  assert.equal(code(short), "BAD_INPUT");
  assert.equal(short.error.message, "Password needs at least 6 characters.");
  const ok = handle({ action: "setPassword", name: "Top", code: " 123456 ", newPassword: "top1234" }, ctx);
  assert.equal(code(ok), "OK");
  assert.equal(ok.data.user.user_id, "U03");
  const top = ctx.db.tables.Users.find(u => u.user_id === "U03");
  assert.equal(top.reset_code, "");
  assert.match(top.password_hash, /^v1\$/);
  assert.equal(code(handle({ action: "login", name: "Top", password: "top1234" }, ctx)), "OK");
  assert.equal(code(handle({ action: "setPassword", name: "Top", code: "123456", newPassword: "again12" }, ctx)), "AUTH_FAILED");
});

test("setPassword logs out the user's other sessions", () => {
  const ctx = fakeCtx();
  ctx.db.tables.Users[0].reset_code = "654321";
  const oldToken = loginAs(ctx, "Dad", "dad123");
  const r = handle({ action: "setPassword", name: "Dad", code: "654321", newPassword: "newdad1" }, ctx);
  assert.equal(code(r), "OK");
  assert.equal(code(handle({ action: "logout", token: oldToken }, ctx)), "AUTH_REQUIRED");
  assert.equal(code(handle({ action: "logout", token: r.data.token }, ctx)), "OK");
});

test("logout ends the session; missing or expired tokens need login", () => {
  const ctx = fakeCtx();
  assert.equal(code(handle({ action: "logout" }, ctx)), "AUTH_REQUIRED");
  const token = loginAs(ctx, "Pim", "pim123");
  ctx.setNow(NOW + 181 * 86400000);
  assert.equal(code(handle({ action: "logout", token }, ctx)), "AUTH_REQUIRED");
  ctx.setNow(NOW);
  const t2 = loginAs(ctx, "Pim", "pim123");
  assert.equal(code(handle({ action: "logout", token: t2 }, ctx)), "OK");
  assert.equal(code(handle({ action: "logout", token: t2 }, ctx)), "AUTH_REQUIRED");
});

test("a deactivated user's session stops working", () => {
  const ctx = fakeCtx();
  const token = loginAs(ctx, "Pim", "pim123");
  ctx.db.tables.Users[1].active = "FALSE";
  assert.equal(code(handle({ action: "logout", token }, ctx)), "AUTH_REQUIRED");
});
