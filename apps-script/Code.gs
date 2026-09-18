/** @OnlyCurrentDoc */
// Web app entry points. Deploy: Deploy > New deployment > Web app, execute as Me, access Anyone.
// @OnlyCurrentDoc scopes the authorization Google asks for to this one spreadsheet, instead of
// every Sheet in the family admin's Drive.
function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: { code: "BAD_INPUT", message: "The request was not valid JSON." } });
  }
  return json_(handle(req, liveCtx_()));
}

function doGet() {
  return json_({ ok: true, data: { service: "CyberHealth", time: new Date().toISOString() } });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function liveCtx_() {
  const db = requestDb_();
  return {
    db,
    sessions: ScriptSessions,
    attempts: CacheAttempts,
    sha256: sha256Live_,
    randomToken: () => Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, ""),
    randomSalt: () => Utilities.base64Encode(Utilities.getUuid()),
    // prefix + "-" + 8 random [a-z0-9] chars. Utilities.getUuid() is lower-case hex (0-9a-f),
    // a subset of [a-z0-9], so the first 8 characters (with the dashes stripped) are enough.
    newId: prefix => prefix + "-" + Utilities.getUuid().replace(/-/g, "").slice(0, 8),
    nowMs: () => Date.now(),
    // Every cached tab is dropped once the lock is held and before the callback runs, so
    // "re-read inside the lock" means a real re-read of the Sheet in every action at once,
    // rather than each action having to remember not to read the tab before locking.
    lock: fn => withLock_(() => { db.invalidate(); return fn(); }),
    log: err => console.error(err && err.stack ? err.stack : err),
    settings: key => SheetSettings.get(key),
    drive: {
      put: (folderName, fileName, base64, mimeType) =>
        DriveStore.putImage(SheetSettings.get("photo_folder_id"), folderName, fileName, base64, mimeType),
      trash: url => DriveStore.trashByUrl(url),
    },
  };
}
