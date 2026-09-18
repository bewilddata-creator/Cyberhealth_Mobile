// Apps Script implementations of the ctx services used by handle().
const ScriptSessions = {
  props_() { return PropertiesService.getScriptProperties(); },
  get(hash) { const v = this.props_().getProperty("sess_" + hash); return v ? JSON.parse(v) : null; },
  put(hash, rec) { this.props_().setProperty("sess_" + hash, JSON.stringify(rec)); },
  remove(hash) { this.props_().deleteProperty("sess_" + hash); },
  removeForUser(userId) {
    const props = this.props_();
    const all = props.getProperties();
    Object.keys(all).forEach(k => {
      if (k.indexOf("sess_") !== 0) return;
      let rec = null;
      try { rec = JSON.parse(all[k]); } catch (e) { rec = null; }
      if (!rec || rec.userId === userId) props.deleteProperty(k);
    });
  },
};

const CacheAttempts = {
  key_(name) { return "att_" + encodeURIComponent(name).slice(0, 200); },
  get(name) { return Number(CacheService.getScriptCache().get(this.key_(name)) || 0); },
  incr(name) { CacheService.getScriptCache().put(this.key_(name), String(this.get(name) + 1), LOCKOUT_SECONDS); },
  clear(name) { CacheService.getScriptCache().remove(this.key_(name)); },
};

function sha256Live_(bytes) {
  const signed = bytes.map(b => (b > 127 ? b - 256 : b));
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, signed).map(b => b & 255);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new AppError("SERVER", "The app is busy. Try again in a moment.");
  try { return fn(); } finally { lock.releaseLock(); }
}

// Reads each tab at most once per request; any write to a tab clears that tab's cache.
// The cache only ever knows about THIS request's writes, so a tab read before a lock was taken
// would still be answered from that stale copy inside the lock, while another phone's request
// was busy changing it. liveCtx_ (apps-script/Code.gs) therefore calls invalidate() the moment
// the lock is acquired: outside a lock the cache is a plain optimisation for read-only paths
// like bootstrap, and inside one every read is a fresh read of the Sheet.
function requestDb_() {
  const cache = {};
  return {
    rows(tab) {
      if (!cache[tab]) cache[tab] = SheetDb.rows(tab);
      return cache[tab].map(r => Object.assign({}, r));
    },
    append(tab, obj) { delete cache[tab]; return SheetDb.append(tab, obj); },
    update(tab, keyCol, keyVal, patch) { delete cache[tab]; return SheetDb.update(tab, keyCol, keyVal, patch); },
    remove(tab, pred) { delete cache[tab]; return SheetDb.remove(tab, pred); },
    invalidate() { Object.keys(cache).forEach(tab => { delete cache[tab]; }); },
  };
}
