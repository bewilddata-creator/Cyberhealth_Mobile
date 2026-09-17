// Where the app's backend address comes from, without ever putting it in the repo.
// The address is only ever an Apps Script /exec URL (or "mock" for local sample data),
// so a link from a stranger can't point the app at their own server.

const ALLOWED = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

// "mock" (sample data, no server) is only for local development: a page opened over https is the
// live site, where a link like #api=mock would swap a family member's real medicine list for fake
// data without warning. isHttps is a caller-supplied fact rather than something this pure module
// reads from `location` itself; it defaults to true so a caller that forgets to pass it fails safe.
export function isAllowedApiUrl(value, isHttps = true) {
  const s = String(value == null ? "" : value).trim();
  if (s === "mock") return !isHttps;
  return ALLOWED.test(s);
}

function readParam(source) {
  const raw = String(source == null ? "" : source).replace(/^[#?]/, "");
  if (!raw) return "";
  const pair = raw.split("&").map(part => part.split("=")).find(([key]) => key === "api");
  if (!pair) return "";
  try {
    return decodeURIComponent(pair.slice(1).join("=") || "");
  } catch (e) {
    return "";
  }
}

// Reads the address out of a link like  …/#api=https://script.google.com/macros/s/AKfy…/exec
export function apiUrlFromLocation(hash, search, isHttps = true) {
  const found = readParam(hash) || readParam(search);
  return isAllowedApiUrl(found, isHttps) ? found : "";
}
