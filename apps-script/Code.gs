// Web app entry points. Deploy: Deploy > New deployment > Web app, execute as Me, access Anyone.
//
// AUTHORIZATION IS DECLARED, NOT GUESSED. The exact scopes this project asks for are listed in
// apps-script/appsscript.json ("oauthScopes"), so the consent screen the family sees is fixed and
// reviewable instead of whatever Apps Script's automatic scope scan happens to infer from the code:
//   * .../auth/spreadsheets.currentonly -- this one spreadsheet only, never any other Sheet.
//   * .../auth/drive.file -- the pill photos, and ONLY the files this script made itself. It
//     makes its own photo folder (setUpPhotoFolder in Drive.gs, or the first upload), a
//     subfolder per medicine inside it, and the photo files, shares those link-readable, and
//     trashes the ones it replaces. Nothing else in the family's Drive is reachable at all --
//     not even a folder they made by hand and pasted into Settings.photo_folder_id. See
//     README Part 2.
//
// There used to be an OnlyCurrentDoc annotation on this line. It is deliberately GONE, and must
// not be put back: that annotation only steers the automatic scan, which an explicit "oauthScopes"
// list switches off entirely, so keeping it would have promised a Drive narrowing the declared
// drive scope does not give. If the Drive calls in Drive.gs are ever removed, drop the drive scope
// from the manifest instead. tests/sync.test.js pins both halves of this.
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
      // Can this script open the folder whose id the Sheet holds? Only a folder it made itself,
      // under .../auth/drive.file -- so this is false for the hand-made folder older setups
      // pasted in, which is what lets uploadMedicinePhoto say so plainly instead of failing
      // with a Drive error nobody can read.
      canOpen: folderId => !!PhotoFolder.open(folderId),
      // A blank photo_folder_id makes the folder here, rather than failing: whoever is holding
      // the phone should not have to know that an admin never ran setUpPhotoFolder.
      put: (folderName, fileName, base64, mimeType) =>
        DriveStore.putImage(PhotoFolder.ensureId(), folderName, fileName, base64, mimeType),
      trash: url => DriveStore.trashByUrl(url),
    },
  };
}
