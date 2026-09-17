import { API_URL } from "./config.js";
import { isAllowedApiUrl, apiUrlFromLocation } from "./apiurl.js";
import { setMockPhotoResolver } from "./mockphoto.js";

const TOKEN_KEY = "cyberhealth.token";
const API_KEY = "cyberhealth.api";

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
}
export function setToken(token) {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* storage blocked */ }
}

// Whether this page was loaded over https -- "mock" sample data is only ever allowed off of it,
// so a live https deploy can't be pointed at fake data by a link or a leftover local setting.
function pageIsHttps() {
  return typeof location !== "undefined" && location.protocol === "https:";
}

// The address this phone talks to: saved on the phone first, then js/config.js as a fallback.
export function getApiUrl() {
  const isHttps = pageIsHttps();
  try {
    const saved = localStorage.getItem(API_KEY);
    if (isAllowedApiUrl(saved, isHttps)) return String(saved).trim();
  } catch (e) { /* storage blocked */ }
  return isAllowedApiUrl(API_URL, isHttps) ? String(API_URL).trim() : "";
}
export function setApiUrl(url) {
  if (!isAllowedApiUrl(url, pageIsHttps())) return false;
  try { localStorage.setItem(API_KEY, String(url).trim()); } catch (e) { /* storage blocked */ }
  return true;
}
// Takes the address out of a private link like …/#api=<url> and saves it. Deliberately leaves the
// address bar alone: an iOS "Add to Home Screen" icon reopens exactly the page URL it was added
// from (manifest.webmanifest has no start_url, on purpose), #api=... included -- stripping it here
// would strip it from the icon forever, since a home-screen web app may not share Safari's
// storage at all (see README Part 5 / C1).
export function adoptApiUrlFromLocation(loc) {
  const where = loc || (typeof location === "undefined" ? null : location);
  if (!where) return false;
  const found = apiUrlFromLocation(where.hash, where.search, where.protocol === "https:");
  return !!found && setApiUrl(found);
}

export async function call(action, payload = {}) {
  const url = getApiUrl();
  const body = { action, token: getToken(), ...payload };
  let reply;
  if (url === "mock") {
    const { mockCall, mockPhotoUrl } = await import("../dev/mock.js");
    setMockPhotoResolver(mockPhotoUrl);
    reply = await mockCall(body);
  } else {
    if (!url) throw new ApiError("CONFIG", "This phone isn't connected yet. Open the private app link the family sent you, or paste the address below.");
    let res;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    } catch (e) {
      throw new ApiError("NETWORK", "No internet connection. Check Wi-Fi or mobile data and try again.");
    }
    try { reply = await res.json(); } catch (e) { throw new ApiError("SERVER", "The server sent an unexpected reply. Try again."); }
  }
  if (!reply.ok) {
    if (reply.error.code === "AUTH_REQUIRED") setToken(null);
    throw new ApiError(reply.error.code, reply.error.message);
  }
  return reply.data;
}
