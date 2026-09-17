// C1: after "Add to Home Screen", the icon must still carry #api=... -- adoptApiUrlFromLocation
// must save the address without ever touching the address bar (an iOS home-screen web app may
// not share Safari's storage at all, so the only thing that reliably survives is the URL itself).
import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptApiUrlFromLocation, getApiUrl } from "../js/api.js";

function fakeStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
}

const REAL = "https://script.google.com/macros/s/AKfycbzEKzIVau9DyIaNWpm8gukTW/exec";

test("adoptApiUrlFromLocation saves the address but never calls history.replaceState", () => {
  globalThis.localStorage = fakeStorage();
  let replaceStateCalls = 0;
  globalThis.history = { replaceState: () => { replaceStateCalls++; } };
  try {
    const loc = { hash: `#api=${REAL}`, search: "", protocol: "https:", pathname: "/index.html" };
    const found = adoptApiUrlFromLocation(loc);
    assert.equal(found, true);
    assert.equal(replaceStateCalls, 0, "the address bar must keep #api=... so a home-screen icon (which reopens this exact URL) still has it");
    assert.equal(getApiUrl(), REAL);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.history;
  }
});

test("adoptApiUrlFromLocation returns false and saves nothing when there is no #api= to adopt", () => {
  globalThis.localStorage = fakeStorage();
  try {
    const found = adoptApiUrlFromLocation({ hash: "", search: "", protocol: "https:", pathname: "/index.html" });
    assert.equal(found, false);
  } finally {
    delete globalThis.localStorage;
  }
});
