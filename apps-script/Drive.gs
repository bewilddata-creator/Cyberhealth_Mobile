// Hand-written Drive adapter: not synced from a pure module, since it calls DriveApp.
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
};
