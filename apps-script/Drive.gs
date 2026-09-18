// Hand-written Drive adapter: not synced from a pure module, since it calls Google's Drive.
//
// WHAT THIS SCRIPT IS ALLOWED TO TOUCH. apps-script/appsscript.json asks for
// .../auth/drive.file, which grants access to exactly the files and folders this script made
// itself -- nothing else in the family's Drive, ever. That one fact shapes everything below:
//   * The app MAKES its own photo folder (setUpPhotoFolder, or the first upload if nobody ran
//     it) instead of being handed the id of a folder someone made by hand. A hand-made folder
//     is invisible to this scope, id or no id.
//   * Every per-medicine subfolder and every photo file is made by this script, inside that
//     folder, so it stays reachable afterwards -- including for trashing a replaced photo.
//   * A Drive URL somebody typed into a photo column by hand is NOT reachable. trashByUrl
//     answers false for it, and the caller turns that into a warning. That is deliberate: it
//     also means nobody with Sheet access can paste an arbitrary Drive link into a photo cell
//     and use the app's "remove photo" button to bin a file that has nothing to do with it.
//
// WHY THE ADVANCED SERVICE AND NOT DriveApp. Apps Script gates its BUILT-IN services on the
// scopes the manifest declares, at call time, before Drive ever sees the request: DriveApp is
// documented for .../auth/drive and .../auth/drive.readonly only, so under drive.file the very
// first DriveApp.createFolder would throw "You do not have permission to call
// DriveApp.createFolder. Required permissions: https://www.googleapis.com/auth/drive". The
// advanced Drive service (Drive.Files, Drive.Permissions -- Drive API v3, switched on by
// dependencies.enabledAdvancedServices in the manifest) is a thin REST wrapper with no such
// gate, so what the family granted is what decides, which is the whole point of the narrowing.
// Do not "simplify" this back to DriveApp without putting the wide scope back too.
const PHOTO_FOLDER_SETTING = "photo_folder_id";
const PHOTO_FOLDER_NAME = "CyberHealth Photos";
const FOLDER_MIME_ = "application/vnd.google-apps.folder";

function photoFolderUrl_(folderId) {
  return "https://drive.google.com/drive/folders/" + folderId;
}

// The HTTP status behind a Drive failure, or 0 when this is not a Drive API error at all.
// GoogleJsonResponseException carries it on .details.code.
function driveErrorCode_(err) {
  const details = err && err.details;
  const code = details && details.code;
  return typeof code === "number" ? code : 0;
}

// True only for "there is no such file, as far as this app is concerned". Drive answers 404 --
// NOT 403 -- for a file that exists but was not created by this app, on purpose, so that an app
// cannot use error codes to discover what is in someone's Drive. So under drive.file a 404 is
// exactly the everyday case: "not one of ours".
//
// Every other failure -- 403 for a scope that was not granted, 401, a 5xx from Drive -- is NOT
// this, and callers must not flatten it into "not ours". Telling the family to clear a Settings
// cell and start again would be the wrong advice, and would hide the real problem until it
// surfaced on somebody's phone.
function driveNotFound_(err) {
  return driveErrorCode_(err) === 404;
}

// Escapes a value for a Drive search query, where ' ends a string literal and \ escapes.
// photoFolderName (server/photos.js) already replaces slashes, but an apostrophe in a medicine
// name is an ordinary thing to type and would otherwise break the query.
function driveQuote_(value) {
  return "'" + String(value == null ? "" : value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

// The six Drive calls this project makes, each in one place. Advanced-service shapes (Drive API
// v3) are fiddly enough -- resource first, id second, media in between -- that spreading them
// through the file would be asking for a mismatched argument nobody notices until upload day.
const DriveApi = {
  // A new folder. With no parentId it lands at the top level of My Drive, which is where
  // setUpPhotoFolder puts the photo folder so the admin can find it and move it.
  createFolder(name, parentId) {
    const resource = { name: name, mimeType: FOLDER_MIME_ };
    if (parentId) resource.parents = [parentId];
    return Drive.Files.create(resource);
  },
  // The file's metadata, or null when this app may not see it. Throws on anything that is not
  // a plain 404 -- see driveNotFound_.
  getOrNull(fileId) {
    try {
      return Drive.Files.get(fileId, { fields: "id,name,mimeType,trashed" });
    } catch (e) {
      if (driveNotFound_(e)) return null;
      throw e;
    }
  },
  // The child folder of parentId with this exact name, or null. Only ever finds folders this
  // app made: a listing under drive.file returns nothing else, which is all we want here.
  findChildFolder(parentId, name) {
    const q = [
      driveQuote_(parentId) + " in parents",
      "name = " + driveQuote_(name),
      "mimeType = " + driveQuote_(FOLDER_MIME_),
      "trashed = false",
    ].join(" and ");
    const found = Drive.Files.list({ q: q, fields: "files(id,name)", pageSize: 10 });
    const files = (found && found.files) || [];
    return files.length ? files[0] : null;
  },
  createFile(parentId, name, blob) {
    return Drive.Files.create({ name: name, parents: [parentId] }, blob);
  },
  shareAnyoneWithLinkCanView(fileId) {
    return Drive.Permissions.create({ role: "reader", type: "anyone" }, fileId);
  },
  trash(fileId) {
    return Drive.Files.update({ trashed: true }, fileId);
  },
};

// The app's own photo folder: opening it, and the ONE place that creates it. setUpPhotoFolder
// and a photo upload that finds no folder yet both come through here, so there is only ever
// one idea of what the folder is called and where its id is written down.
const PhotoFolder = {
  // The folder, or null when the id is blank or this app did not make it. A permission problem
  // is NOT null -- it throws, so it announces itself as a permission problem instead of being
  // mistaken for "somebody pasted a hand-made folder id in here" and answered with advice that
  // would not help.
  open(folderId) {
    if (!folderId) return null;
    return DriveApi.getOrNull(folderId);
  },
  // Makes the folder and writes its id into the Settings tab, as ONE step under the script
  // lock: two people adding their first photo in the same second must not end up with a folder
  // each. The admin can move the folder anywhere in Drive afterwards -- it is found by id,
  // never by where it sits.
  create() {
    return withLock_(() => PhotoFolder.createInLock_());
  },
  // The caller already holds the script lock.
  createInLock_() {
    const folder = DriveApi.createFolder(PHOTO_FOLDER_NAME);
    try {
      SheetSettings.setInLock_(PHOTO_FOLDER_SETTING, folder.id);
    } catch (e) {
      // The Sheet did not take the id, so nothing knows this folder exists. Bin it rather than
      // leave an empty stray behind that the next run would make a twin of, and let the real
      // error travel on.
      try { DriveApi.trash(folder.id); } catch (ignored) { /* best effort; the error below matters more */ }
      throw e;
    }
    return folder;
  },
  // The id to file photos under, making the folder if the Sheet has none yet. An id that IS
  // set but cannot be opened is not this function's problem to paper over -- the caller
  // (server/actions.js uploadMedicinePhoto) checks for that first and refuses with a message
  // saying what to do, rather than quietly making a second folder nobody knows about.
  ensureId() {
    const existing = SheetSettings.get(PHOTO_FOLDER_SETTING);
    if (existing) return existing;
    return withLock_(() => {
      // Re-read inside the lock. Two first uploads can race here, and the loser must use the
      // winner's folder rather than make a second one.
      const again = SheetSettings.get(PHOTO_FOLDER_SETTING);
      return again || PhotoFolder.createInLock_().id;
    });
  },
};

// Run this from the Apps Script editor -- pick setUpPhotoFolder in the function dropdown and
// press Run, the same way you run checkSheet -- to give the app a folder for medicine photos.
// Everything it prints is meant to be read by whoever set the Sheet up, not by a programmer.
function setUpPhotoFolder() {
  const existing = SheetSettings.get(PHOTO_FOLDER_SETTING);

  if (existing) {
    const folder = PhotoFolder.open(existing);
    if (folder) {
      console.log(
        'All set -- there was nothing to do.\n\n' +
        'Medicine photos go into your folder "' + folder.name + '":\n' +
        photoFolderUrl_(folder.id) + '\n\n' +
        'You can drag that folder anywhere you like in Drive. The app finds it by its id, ' +
        'which is written in the Settings tab, not by where it sits -- so moving it will not ' +
        'break anything. Just do not delete it.'
      );
      return;
    }
    console.log(
      'Nothing has been changed, and you need to do one thing.\n\n' +
      'The Settings tab already has a photo folder id in it, and this app is not allowed to ' +
      'open that folder. That is normal if the folder was made by hand and its id pasted in: ' +
      'the app may only touch folders it made itself, so a folder you made is invisible to it.\n\n' +
      'No new folder was made on purpose. Making one behind your back would leave you with two ' +
      'folders and no way to tell which one your photos went into.\n\n' +
      'To fix it:\n' +
      '  1. Open the Sheet and go to the Settings tab.\n' +
      '  2. On the photo_folder_id row, delete whatever is in the value box, so it is empty.\n' +
      '  3. Come back here and run setUpPhotoFolder again. It will make a folder called ' +
      '"' + PHOTO_FOLDER_NAME + '" and fill that box in for you.\n' +
      '  4. If the old folder has photos in it already, drag them into the new folder yourself.\n\n' +
      'Until that is done, adding a photo in the app will politely refuse.'
    );
    return;
  }

  const folder = PhotoFolder.create();
  console.log(
    'Done. Medicine photos now have a home.\n\n' +
    'A new folder called "' + folder.name + '" is waiting at the top level of your Google Drive:\n' +
    photoFolderUrl_(folder.id) + '\n\n' +
    'Its id has been written into the Settings tab for you, on the photo_folder_id row, so there ' +
    'is nothing to copy or paste.\n\n' +
    'You can drag the folder anywhere you like in Drive -- tuck it inside another folder if you ' +
    'prefer. The app finds it by its id, not by where it sits, so moving it will not break ' +
    'anything. Renaming it is fine too. Just do not delete it, and do not empty the ' +
    'photo_folder_id box.'
  );
}

const DriveStore = {
  folder(rootId, name) {
    const found = DriveApi.findChildFolder(rootId, name);
    return found || DriveApi.createFolder(name, rootId);
  },
  putImage(rootId, folderName, fileName, base64, mimeType) {
    // Only ever creates a new file. The caller (server/actions.js uploadPhoto) is responsible for
    // trashing whatever the Sheet's photo column pointed at before -- by that URL, not by
    // scanning the folder for a same-named file, which used to trash a same-slot file belonging
    // to a DIFFERENT medicine sharing this folder, or miss the old file entirely after a rename.
    const folder = DriveStore.folder(rootId, folderName);
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, fileName);
    const file = DriveApi.createFile(folder.id, fileName, blob);
    // Or the phone cannot show it: the photo <img> is loaded straight from the Drive link, by a
    // browser that is not signed in to the account the script runs as.
    DriveApi.shareAnyoneWithLinkCanView(file.id);
    return { id: file.id, url: driveViewUrl(file.id) };
  },
  // False when there is nothing to bin, or when this script is not allowed to touch what the
  // URL points at -- a photo the app uploaded is always its own file and so always reachable;
  // a link someone pasted into the column by hand is somebody else's file and is not.
  trashByUrl(url) {
    const m = String(url || "").match(/\/d\/([\w-]{10,})/) || String(url || "").match(/[?&]id=([\w-]{10,})/);
    if (!m) return false;
    try { DriveApi.trash(m[1]); return true; } catch (e) { return false; }
  },
};

const SheetSettings = {
  get(key) {
    const row = SheetDb.rows("Settings").find(r => String(r.key).trim() === key);
    return row ? String(row.value).trim() : "";
  },
  // Updates the row when the key is already there, adds one when it is not. Takes the script
  // lock, like every other write in this project: two people can be saving in the same second,
  // and a Settings row written half-way is a folder id nobody can read.
  set(key, value) {
    return withLock_(() => SheetSettings.setInLock_(key, value));
  },
  // The same write, for a caller that already holds the lock (PhotoFolder.createInLock_, which
  // has to make the folder and record its id without letting go in between). Nesting withLock_
  // would have the inner finally release the outer caller's lock, so there is one locking
  // entry point per path and never two.
  setInLock_(key, value) {
    const text = String(value == null ? "" : value);
    const existing = SheetDb.rows("Settings").find(r => String(r.key).trim() === key);
    // The notes column is left out of a new row on purpose -- append() writes every column,
    // blank where nothing was given, and the admin's own notes are not this function's to invent.
    if (!existing) {
      SheetDb.append("Settings", { key: key, value: text });
      return text;
    }
    // The key EXACTLY as the cell holds it. SheetDb.update matches the cell as it reads it, so
    // a tidied-up copy could match nothing, write nothing, and hand back a false that nobody was
    // looking at -- leaving PhotoFolder.create() sure it had recorded a folder id it never did,
    // and the next upload making a second folder.
    if (!SheetDb.update("Settings", "key", existing.key, { value: text })) {
      throw new AppError("SERVER", `The Settings tab has no "${key}" row to write to any more.`);
    }
    return text;
  },
};
