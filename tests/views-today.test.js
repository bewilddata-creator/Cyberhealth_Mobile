// Pure view-string tests for Today (js/views/today.js): the header must show the full date being
// viewed with a clear "Not today" chip (I3), a Sheet-problems banner for the person being viewed
// (C2), and a day older than the loaded DoseLog window must read as untracked, never "missed" (M2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToday } from "../js/views/today.js";

const ctx = {
  me: { user_id: "U01", display_name: "Dad" },
  people: [{ user_id: "U01", display_name: "Dad", medicines: "Edit" }],
  owner: "U01",
};

function baseModel(over = {}) {
  return {
    date: "2026-09-17", isToday: true, canTick: true, viewerIsOwner: true, historyNotLoaded: false,
    taken: 0, due: 0, asNeeded: [],
    slots: [
      { timeOfDay: "Morning", items: [], taken: 0, due: 0, status: "none", canTickAll: false },
      { timeOfDay: "Noon", items: [], taken: 0, due: 0, status: "none", canTickAll: false },
      { timeOfDay: "Evening", items: [], taken: 0, due: 0, status: "none", canTickAll: false },
      { timeOfDay: "Bedtime", items: [], taken: 0, due: 0, status: "none", canTickAll: false },
    ],
    ...over,
  };
}

const week = ["14", "15", "16", "17", "18", "19", "20"].map(d => ({ date: `2026-09-${d}`, weekday: "Mon", day: Number(d), result: "" }));

test("renderToday's header spells out the full date being viewed", () => {
  const html = renderToday({ model: baseModel(), week, ctx, today: "2026-09-17", hour: 9, warnings: [] });
  assert.ok(html.includes("Thursday 17 September"), html);
});

test("renderToday shows a clear 'Not today' chip for a past day, and none for today", () => {
  const past = renderToday({ model: baseModel({ date: "2026-09-10", isToday: false }), week, ctx, today: "2026-09-17", hour: 9, warnings: [] });
  assert.ok(/not today/i.test(past));
  const now = renderToday({ model: baseModel(), week, ctx, today: "2026-09-17", hour: 9, warnings: [] });
  assert.ok(!/not today/i.test(now));
});

test("renderToday shows a Sheet-problems banner that opens More, only when there are warnings for this person", () => {
  const withWarnings = renderToday({ model: baseModel(), week, ctx, today: "2026-09-17", hour: 9, warnings: [{ user_id: "U01", message: "x" }] });
  assert.ok(withWarnings.includes("fixing in the Sheet"), withWarnings);
  assert.ok(withWarnings.includes('data-tab="more"'), withWarnings);
  const without = renderToday({ model: baseModel(), week, ctx, today: "2026-09-17", hour: 9, warnings: [] });
  assert.ok(!without.includes("fixing in the Sheet"));
});

test("renderToday shows the 60-day note and never a 'missed' count for an untracked old day", () => {
  const model = baseModel({
    date: "2026-06-01", isToday: false, historyNotLoaded: true,
    slots: [
      { timeOfDay: "Morning", items: [], taken: 0, due: 2, status: "unknown", canTickAll: false },
      { timeOfDay: "Noon", items: [], taken: 0, due: 0, status: "none", canTickAll: false },
      { timeOfDay: "Evening", items: [], taken: 0, due: 0, status: "none", canTickAll: false },
      { timeOfDay: "Bedtime", items: [], taken: 0, due: 0, status: "none", canTickAll: false },
    ],
  });
  const html = renderToday({ model, week, ctx, today: "2026-09-17", hour: 9, warnings: [] });
  assert.ok(html.includes("Older than 60 days"), html);
  assert.ok(!html.includes("missed"), html);
});
