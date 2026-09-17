// GENERATED from js/access.js by scripts/sync-gs.mjs. Do not edit here: edit js/access.js and run npm run sync-gs.
// Pure access rules: who may read or edit whose records, per section.
// Shared by the app and Apps Script. No DOM, no network, no clock.

const SECTIONS = { MEDICINES: "Medicines", CARE_TEAM: "Care team" };

function toId(id) {
  return id == null ? "" : String(id).trim();
}

function isActiveUser(u) {
  return !!u && !!toId(u.user_id) && String(u.active || "").trim().toUpperCase() !== "FALSE";
}

function publicUser(u) {
  return { user_id: u.user_id, display_name: u.display_name, role: u.role };
}

function grantFor(viewerId, ownerId, section, sharing) {
  const viewer = toId(viewerId);
  const owner = toId(ownerId);
  if (!viewer || !owner) return "";
  if (viewer === owner) return "Edit";
  let best = "";
  (sharing || []).forEach(r => {
    if (!r) return;
    if (toId(r.owner_user_id) !== owner) return;
    if (String(r.section || "").trim() !== section) return;
    const sharedWith = toId(r.shared_with_user_id);
    if (sharedWith && sharedWith !== viewer) return;
    const access = String(r.access || "").trim();
    if (access !== "View" && access !== "Edit") return;
    if (access === "Edit") best = "Edit";
    else if (access === "View" && best !== "Edit") best = "View";
  });
  return best;
}

function canRead(viewerId, ownerId, section, sharing) {
  return grantFor(viewerId, ownerId, section, sharing) !== "";
}

function canEdit(viewerId, ownerId, section, sharing) {
  return grantFor(viewerId, ownerId, section, sharing) === "Edit";
}

function readableOwners(viewerId, userIds, section, sharing) {
  return (userIds || []).filter(id => canRead(viewerId, id, section, sharing));
}

function canTick(viewerId, ownerId) {
  const viewer = toId(viewerId);
  const owner = toId(ownerId);
  return !!viewer && viewer === owner;
}
