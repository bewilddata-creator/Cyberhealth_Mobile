import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedApiUrl, apiUrlFromLocation } from "../js/apiurl.js";

const REAL = "https://script.google.com/macros/s/AKfycbzEKzIVau9DyIaNWpm8gukTW/exec";

test("only an Apps Script /exec address, or mock, is allowed", () => {
  assert.equal(isAllowedApiUrl(REAL), true);
  assert.equal(isAllowedApiUrl(REAL, true), true);
  assert.equal(isAllowedApiUrl(REAL, false), true);
  assert.equal(isAllowedApiUrl(` ${REAL} `), true);
  assert.equal(isAllowedApiUrl(""), false);
  assert.equal(isAllowedApiUrl(null), false);
  assert.equal(isAllowedApiUrl("https://evil.example.com/exec"), false);
  assert.equal(isAllowedApiUrl("http://script.google.com/macros/s/AKfy/exec"), false);
  assert.equal(isAllowedApiUrl("https://script.google.com/macros/s/AKfy/dev"), false);
  assert.equal(isAllowedApiUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedApiUrl("https://script.google.com.evil.test/macros/s/AKfy/exec"), false);
});

test("mock is only for local development, never on the live https site", () => {
  assert.equal(isAllowedApiUrl("mock", false), true);
  assert.equal(isAllowedApiUrl("mock", true), false);
  assert.equal(isAllowedApiUrl("mock"), false); // fails safe when a caller forgets the protocol
});

test("the address is read from a private link's hash, or its query", () => {
  assert.equal(apiUrlFromLocation(`#api=${encodeURIComponent(REAL)}`, "", false), REAL);
  assert.equal(apiUrlFromLocation(`#api=${REAL}`, "", true), REAL);
  assert.equal(apiUrlFromLocation("", `?api=${encodeURIComponent(REAL)}`, true), REAL);
  assert.equal(apiUrlFromLocation(`#other=1&api=${REAL}`, "", false), REAL);
  assert.equal(apiUrlFromLocation("#api=mock", "", false), "mock");
  assert.equal(apiUrlFromLocation("#api=mock", "", true), "");
});

test("a link carrying someone else's server is ignored", () => {
  assert.equal(apiUrlFromLocation("#api=https://evil.example.com/exec", "", false), "");
  assert.equal(apiUrlFromLocation("#api=", "", false), "");
  assert.equal(apiUrlFromLocation("", "", false), "");
  assert.equal(apiUrlFromLocation("#nothing=here", "", false), "");
  assert.equal(apiUrlFromLocation("#api=%E0%A4%A", "", false), "");
});
