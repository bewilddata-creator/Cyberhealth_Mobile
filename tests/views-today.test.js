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

// `dose`/`tick` are shorthand overrides for a single Morning-by-default dose item (used by the
// ticked-vs-current-dose tests below); they are consumed here and never leak into the model shape
// itself. An explicit `slots` override (used by other tests) still wins over the computed one.
function baseModel(over = {}) {
  const { dose, tick, ...rest } = over;
  const slots = [
    { timeOfDay: "Morning", items: [], taken: 0, due: 0, status: "none", canTickAll: false },
    { timeOfDay: "Noon", items: [], taken: 0, due: 0, status: "none", canTickAll: false },
    { timeOfDay: "Evening", items: [], taken: 0, due: 0, status: "none", canTickAll: false },
    { timeOfDay: "Bedtime", items: [], taken: 0, due: 0, status: "none", canTickAll: false },
  ];
  if (dose) {
    const timeOfDay = dose.timeOfDay || "Morning";
    const item = {
      key: dose.id || "DS01",
      timeOfDay,
      prescription: { meal: "" },
      dose: { amount: dose.amount, unit: dose.unit },
      medicine: null,
      tick: tick || null,
    };
    const slot = slots.find(s => s.timeOfDay === timeOfDay);
    slot.items.push(item);
    slot.due = slot.items.length;
    slot.taken = slot.items.filter(i => i.tick).length;
  }
  return {
    date: "2026-09-17", isToday: true, canTick: true, viewerIsOwner: true, historyNotLoaded: false,
    taken: 0, due: 0, asNeeded: [],
    slots,
    ...rest,
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

test("a ticked row shows the amount that was actually taken, not the amount now prescribed", () => {
  const model = baseModel({ dose: { id: "DS01", timeOfDay: "Morning", amount: 0.5, unit: "tablet" }, tick: { at: "07:42", amount: "1", unit: "tablet" } });
  const html = renderToday({ model, week, ctx, date: "2026-09-18", today: "2026-09-18" });
  // Target the quantity element itself, not just any occurrence of the taken amount elsewhere on
  // the row (the .by receipt div already prints tick.amount regardless of what .qty shows) --
  // otherwise this assertion cannot distinguish the fix from the bug it exists to catch.
  assert.match(html, /<span class="qty">1 tablet<\/span>/, "the taken amount is what the record says");
  assert.doesNotMatch(html, /<span class="qty">0\.5 tablet<\/span>/);
});

test("a ticked row whose dose has since changed also says what it is now", () => {
  const model = baseModel({ dose: { id: "DS01", timeOfDay: "Morning", amount: 0.5, unit: "tablet" }, tick: { at: "07:42", amount: "1", unit: "tablet" } });
  const html = renderToday({ model, week, ctx, date: "2026-09-18", today: "2026-09-18" });
  assert.match(html, /now 0\.5 tablet/i);
});

test("an un-ticked row shows the current dose", () => {
  const model = baseModel({ dose: { id: "DS01", timeOfDay: "Morning", amount: 0.5, unit: "tablet" }, tick: null });
  const html = renderToday({ model, week, ctx, date: "2026-09-18", today: "2026-09-18" });
  assert.match(html, /<span class="qty">0\.5 tablet<\/span>/);
});

test("a ticked row whose dose has not changed says nothing extra", () => {
  const model = baseModel({ dose: { id: "DS01", timeOfDay: "Morning", amount: 1, unit: "tablet" }, tick: { at: "07:42", amount: "1", unit: "tablet" } });
  const html = renderToday({ model, week, ctx, date: "2026-09-18", today: "2026-09-18" });
  assert.doesNotMatch(html, /now 1 tablet/i);
});

// ---- the receipt row: a dose he ticked whose dose row has since moved, gone, or been stopped ----
//
// `dose: null` is what marks it. It must show what he swallowed and when, say plainly why it is
// no longer an ordinary row, and draw NO tick control -- unticking it would put the moved dose
// straight back on Today as outstanding, offering a tablet already taken.

function receiptModel(over = {}) {
  const model = baseModel();
  const timeOfDay = over.timeOfDay || "Morning";
  const item = {
    key: `2026-09-18|${timeOfDay}|RX01`,
    timeOfDay,
    prescription: { meal: "After meal", status: over.status || "Active" },
    dose: null,
    medicine: { generic_name: "Amlodipine", strength: "5 mg", form: "Tablet" },
    tick: { at: "07:42", amount: "2", unit: "tablet" },
    receipt: true,
  };
  const slot = model.slots.find(s => s.timeOfDay === timeOfDay);
  slot.items.push(item);
  slot.due = 1;
  slot.taken = 1;
  slot.status = "done";
  return { ...model, taken: 1, due: 1 };
}

test("a receipt row shows the medicine, the amount recorded and the time he ticked", () => {
  const html = renderToday({ model: receiptModel(), week, ctx, today: "2026-09-18", hour: 9, warnings: [] });
  assert.match(html, /Amlodipine/);
  assert.match(html, /<span class="qty">2 tablet<\/span>/, "the amount the DoseLog row recorded");
  assert.match(html, /07:42/, "the time he ticked it");
  assert.match(html, /class="dose taken receipt"/);
});

test("a receipt row is not tickable, even for the owner on today", () => {
  const model = receiptModel();
  assert.equal(model.canTick, true, "the owner can tick today -- this is the case that matters");
  const html = renderToday({ model, week, ctx, today: "2026-09-18", hour: 9, warnings: [] });
  assert.doesNotMatch(html, /data-tick=/, "a receipt must draw no tick button: there is no live dose row behind it");
  assert.match(html, /class="check readonly" role="img" data-on="true"/);
  assert.doesNotMatch(html, /data-tickall=/);
});

test("a receipt row says in plain words why it is not an ordinary row", () => {
  const changed = renderToday({ model: receiptModel(), week, ctx, today: "2026-09-18", hour: 9, warnings: [] });
  assert.match(changed, /Already taken\. This dose has been changed since\./);
  const stopped = renderToday({ model: receiptModel({ status: "Stopped" }), week, ctx, today: "2026-09-18", hour: 9, warnings: [] });
  assert.match(stopped, /Already taken\. This medicine has been stopped since\./);
  assert.doesNotMatch(stopped, /has been changed since/);
});

test("a receipt row in the Noon section is drawn in the Noon section", () => {
  const html = renderToday({ model: receiptModel({ timeOfDay: "Noon" }), week, ctx, today: "2026-09-18", hour: 9, warnings: [] });
  const noon = html.slice(html.indexOf('aria-label="Noon"'), html.indexOf('aria-label="Evening"'));
  assert.match(noon, /Amlodipine/, "it belongs to the time of day he actually took it at");
});
