// Hand-written Drive adapter: not synced from a pure module, since it calls DriveApp.
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
const PHOTO_FOLDER_SETTING = "photo_folder_id";
const PHOTO_FOLDER_NAME = "CyberHealth Photos";

function photoFolderUrl_(folderId) {
  return "https://drive.google.com/drive/folders/" + folderId;
}

// The app's own photo folder: opening it, and the ONE place that creates it. setUpPhotoFolder
// and a photo upload that finds no folder yet both come through here, so there is only ever
// one idea of what the folder is called and where its id is written down.
const PhotoFolder = {
  // The folder, or null when the id is blank or this script is not allowed to open it. Never
  // throws: "can the app open this?" is a question every caller here wants answered, not an
  // error to handle.
  open(folderId) {
    if (!folderId) return null;
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      return null;
    }
  },
  // Makes the folder in My Drive and writes its id into the Settings tab. The admin can move
  // the folder anywhere in Drive afterwards: it is found by id, never by where it sits.
  create() {
    const folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
    SheetSettings.set(PHOTO_FOLDER_SETTING, folder.getId());
    return folder;
  },
  // The id to file photos under, making the folder if the Sheet has none yet. An id that IS
  // set but cannot be opened is not this function's problem to paper over -- the caller
  // (server/actions.js uploadMedicinePhoto) checks for that first and refuses with a message
  // saying what to do, rather than quietly making a second folder nobody knows about.
  ensureId() {
    const existing = SheetSettings.get(PHOTO_FOLDER_SETTING);
    return existing || PhotoFolder.create().getId();
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
        'Medicine photos go into your folder "' + folder.getName() + '":\n' +
        photoFolderUrl_(folder.getId()) + '\n\n' +
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
    'A new folder called "' + folder.getName() + '" is waiting at the top level of your Google Drive:\n' +
    photoFolderUrl_(folder.getId()) + '\n\n' +
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
    const root = DriveApp.getFolderById(rootId);
    const found = root.getFoldersByName(name);
    return found.hasNext() ? found.next() : root.createFolder(name);
  },
  putImage(rootId, folderName, fileName, base64, mimeType) {
    // Only ever creates a new file. The caller (server/actions.js uploadPhoto) is responsible for
    // trashing whatever the Sheet's photo column pointed at before -- by that URL, not by
    // scanning the folder for a same-named file, which used to trash a same-slot file belonging
    // to a DIFFERENT medicine sharing this folder, or miss the old file entirely after a rename.
    const folder = DriveStore.folder(rootId, folderName);
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { id: file.getId(), url: driveViewUrl(file.getId()) };
  },
  // False when there is nothing to bin, or when this script is not allowed to touch what the
  // URL points at -- a photo the app uploaded is always its own file and so always reachable;
  // a link someone pasted into the column by hand is somebody else's file and is not.
  trashByUrl(url) {
    const m = String(url || "").match(/\/d\/([\w-]{10,})/) || String(url || "").match(/[?&]id=([\w-]{10,})/);
    if (!m) return false;
    try { DriveApp.getFileById(m[1]).setTrashed(true); return true; } catch (e) { return false; }
  },
};

const SheetSettings = {
  get(key) {
    const row = SheetDb.rows("Settings").find(r => String(r.key).trim() === key);
    return row ? String(row.value).trim() : "";
  },
  // Updates the row when the key is already there, adds one when it is not. Takes the script
  // lock, like every other write in this project: two people can be saving in the same second,
  // and a Settings row written half-way is a folder id nobody can read. The notes column is
  // left out of a new row on purpose -- append() writes every column, blank where nothing was
  // given, and the admin's own notes are not this function's to invent.
  set(key, value) {
    const text = String(value == null ? "" : value);
    return withLock_(() => {
      const existing = SheetDb.rows("Settings").find(r => String(r.key).trim() === key);
      if (existing) SheetDb.update("Settings", "key", String(existing.key).trim(), { value: text });
      else SheetDb.append("Settings", { key: key, value: text });
      return text;
    });
  },
};
