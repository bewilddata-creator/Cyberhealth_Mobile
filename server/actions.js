// All API actions. Pure: every outside effect goes through ctx (see plan Task 3 interface).
// Synced to Apps Script by scripts/sync-gs.mjs, so keep imports on one line and names unique.
import { isActiveUser, publicUser } from "../js/access.js";
import { MAX_ATTEMPTS, SESSION_DAYS, makePasswordRecord, verifyPassword, passwordProblem, isResetCode, tokenHash } from "../js/authcore.js";

export class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const HARD_ATTEMPT_CAP = 50;
const ACTIONS = {};

export function handle(req, ctx) {
  try {
    const action = req && Object.prototype.hasOwnProperty.call(ACTIONS, req.action) ? ACTIONS[req.action] : null;
    if (!action) throw new AppError("BAD_INPUT", "Unknown action.");
    return { ok: true, data: action(req, ctx) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message } };
    if (ctx && ctx.log) ctx.log(err);
    return { ok: false, error: { code: "SERVER", message: "Something went wrong on the server. Try again." } };
  }
}

const str = v => String(v == null ? "" : v).trim();
function stripRow(r) { const o = {}; Object.keys(r).forEach(k => { if (k !== "_row") o[k] = str(r[k]); }); return o; }
function activeUsers(ctx) { return ctx.db.rows("Users").filter(isActiveUser).map(u => ({ ...u, user_id: str(u.user_id), display_name: str(u.display_name), role: str(u.role) })); }
function findUserByName(ctx, name) {
  const n = str(name).toLowerCase();
  return n ? activeUsers(ctx).find(u => u.display_name.toLowerCase() === n) || null : null;
}
function attemptKey(name) { return str(name).toLowerCase(); }
function guardLockout(ctx, name) {
  if (ctx.attempts.get(attemptKey(name)) >= MAX_ATTEMPTS) throw new AppError("LOCKED_OUT", "Too many tries. Wait 15 minutes and try again.");
}
function startSession(ctx, user) {
  const token = ctx.randomToken();
  ctx.sessions.put(tokenHash(token, ctx.sha256), { userId: user.user_id, expires: ctx.nowMs() + SESSION_DAYS * 86400000 });
  return { token, user: publicUser(user) };
}
function requireUser(req, ctx) {
  if (!req.token) throw new AppError("AUTH_REQUIRED", "Please log in.");
  const hash = tokenHash(req.token, ctx.sha256);
  const rec = ctx.sessions.get(hash);
  if (!rec || rec.expires < ctx.nowMs()) {
    if (rec) ctx.sessions.remove(hash);
    throw new AppError("AUTH_REQUIRED", "Please log in again.");
  }
  const user = activeUsers(ctx).find(u => u.user_id === rec.userId);
  if (!user) { ctx.sessions.remove(hash); throw new AppError("AUTH_REQUIRED", "Please log in again."); }
  return { user, hash };
}
// The Sharing tab trimmed to the fields access.js cares about.
function sharingRows(ctx) {
  return ctx.db.rows("Sharing").map(r => ({
    owner_user_id: str(r.owner_user_id),
    shared_with_user_id: str(r.shared_with_user_id),
    section: str(r.section),
    access: str(r.access),
  }));
}

// ---- Account actions ----
Object.assign(ACTIONS, {
  listUsers(req, ctx) {
    return activeUsers(ctx).map(u => ({ user_id: u.user_id, display_name: u.display_name }));
  },
  login(req, ctx) {
    // A correct password always gets through the friendly lockout, so a family member's
    // wrong guesses can't shut the owner out of their own pills. This hard cap still
    // stops someone guessing passwords against the public web app address.
    if (ctx.attempts.get(attemptKey(req.name)) >= HARD_ATTEMPT_CAP) throw new AppError("LOCKED_OUT", "Too many tries. Wait 15 minutes and try again.");
    const user = findUserByName(ctx, req.name);
    if (!user || !str(user.password_hash) || !verifyPassword(req.password, str(user.password_hash), ctx.sha256)) {
      ctx.attempts.incr(attemptKey(req.name));
      if (ctx.attempts.get(attemptKey(req.name)) >= MAX_ATTEMPTS) throw new AppError("LOCKED_OUT", "Too many tries. Wait 15 minutes and try again.");
      throw new AppError("AUTH_FAILED", "Name or password is wrong. First time? Tap “Set or forgot password”.");
    }
    ctx.attempts.clear(attemptKey(req.name));
    return startSession(ctx, user);
  },
  setPassword(req, ctx) {
    guardLockout(ctx, req.name);
    const user = findUserByName(ctx, req.name);
    const code = str(req.code);
    if (!user || !isResetCode(code) || str(user.reset_code) !== code) {
      ctx.attempts.incr(attemptKey(req.name));
      throw new AppError("AUTH_FAILED", "Name or code is wrong. Ask the family admin for a new code.");
    }
    const problem = passwordProblem(req.newPassword);
    if (problem) throw new AppError("BAD_INPUT", problem);
    ctx.lock(() => ctx.db.update("Users", "user_id", user.user_id, { password_hash: makePasswordRecord(req.newPassword, ctx.randomSalt(), ctx.sha256), reset_code: "" }));
    ctx.sessions.removeForUser(user.user_id);
    ctx.attempts.clear(attemptKey(req.name));
    return startSession(ctx, user);
  },
  logout(req, ctx) {
    const { hash } = requireUser(req, ctx);
    ctx.sessions.remove(hash);
    return {};
  },
});
