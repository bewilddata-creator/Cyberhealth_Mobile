import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, telHref } from "../js/html.js";
import { fmtDay, fmtFullDay, fmtLong, greeting } from "../js/format.js";

test("esc escapes HTML-significant characters and blanks nullish values", () => {
  assert.equal(esc(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(esc(null), "");
  assert.equal(esc(2), "2");
});

test("telHref keeps digits and a leading plus", () => {
  assert.equal(telHref("02-555 0110"), "tel:025550110");
  assert.equal(telHref("+66 81 555 0142"), "tel:+66815550142");
  assert.equal(telHref(""), "");
});

test("date formats and greeting", () => {
  assert.equal(fmtDay("2026-09-15"), "Tue 15 Sep");
  assert.equal(fmtLong("2026-01-09"), "9 Jan 2026");
  assert.equal(fmtLong(""), "");
  assert.equal(fmtLong("12/01/1991"), "");
  assert.equal(fmtLong("not-a-date"), "");
  assert.deepEqual([6, 12, 17].map(greeting), ["Good morning,", "Good afternoon,", "Good evening,"]);
});

test("fmtFullDay spells out the day and month, for Today's header (I3)", () => {
  assert.equal(fmtFullDay("2026-09-17"), "Thursday 17 September");
  assert.equal(fmtFullDay(""), "");
  assert.equal(fmtFullDay("not-a-date"), "");
});
