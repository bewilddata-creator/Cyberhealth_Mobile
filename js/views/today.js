import { esc } from "../html.js";
import { I } from "../icons.js";
import { fmtDay, greeting } from "../format.js";
import { SLOT_COLORS, thumb, ownerSwitch, medName, avatarColor, personName } from "./common.js";

function ring(model) {
  const R = 50, C = 60, GAP = 16;
  const point = a => [C + R * Math.cos(((a - 90) * Math.PI) / 180), C + R * Math.sin(((a - 90) * Math.PI) / 180)];
  const arcs = model.slots.map((s, i) => {
    const [x0, y0] = point(i * 90 + GAP / 2), [x1, y1] = point((i + 1) * 90 - GAP / 2);
    const d = `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    const frac = s.due ? s.taken / s.due : 0;
    return `<path d="${d}" class="ring-track"/>` + (frac ? `<path d="${d}" class="ring-fill" pathLength="100" stroke="${SLOT_COLORS[s.timeOfDay][0]}" stroke-dasharray="${(frac * 100).toFixed(1)} 100"/>` : "");
  }).join("");
  const legend = model.slots.map(s => `<div><i style="background:${SLOT_COLORS[s.timeOfDay][0]}"></i>${esc(s.timeOfDay)}<span class="num">${s.due ? `${s.taken}/${s.due}` : "–"}</span></div>`).join("");
  return `<div class="card ring-card"><div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true">${arcs}</svg><div class="mid"><b class="num">${model.taken}/${model.due}</b><small>${model.isToday ? "taken today" : "taken"}</small></div></div><div class="legend">${legend}</div></div>`;
}

function countChip(s) {
  if (s.status === "none") return "";
  if (s.status === "done") return `<span class="count done">All taken</span>`;
  if (s.status === "missed") return `<span class="count miss">${s.due - s.taken} missed</span>`;
  return `<span class="count">${s.taken}/${s.due}${s.status === "now" ? " · now" : ""}</span>`;
}

function mealTag(meal) {
  if (meal === "Before meal") return `<span class="mini before">Before meal</span>`;
  if (meal === "After meal" || meal === "With meal") return `<span class="mini after">${esc(meal)}</span>`;
  return "";
}

function doseRow(item, canTick) {
  const name = item.medicine ? item.medicine.generic_name : "medicine";
  const shot = item.medicine && item.medicine.form === "Injection" ? `<span class="mini shot">Injection</span>` : "";
  const t = item.tick;
  // A tick always shows the amount recorded in the DoseLog row, not the prescription's current
  // dose -- so this line still reads right even after the dose has since been changed.
  const by = t ? `<div class="by">✓ ${esc(t.at)} · ${esc(t.amount)} ${esc(t.unit)}</div>` : "";
  const control = canTick
    ? `<button class="check" data-tick="${esc(item.key)}" aria-pressed="${!!t}" aria-label="${t ? "Untick" : "Tick"} ${esc(name)}">${I.check}</button>`
    : `<span class="check readonly" role="img" data-on="${!!t}" aria-label="${esc(name)}: ${t ? "taken" : "not taken yet"}">${I.check}</span>`;
  return `<div class="dose ${t ? "taken" : ""}" style="--slot-soft:${SLOT_COLORS[item.timeOfDay][1]}">${thumb(item.medicine)}
    <div class="info"><div class="name">${medName(item.medicine)}</div>
      <div class="meta"><span class="qty">${esc(item.dose.amount)} ${esc(item.dose.unit)}</span>${mealTag(item.prescription.meal)}${shot}</div>${by}</div>
    ${control}</div>`;
}

export function renderToday({ model, week, ctx, today, hour }) {
  const mine = ctx.owner === ctx.me.user_id;
  const ownerName = personName(ctx, ctx.owner);
  const head = `<div class="top"><div class="hello"><span class="av" style="background:${avatarColor(ctx.people, ctx.me.user_id)}">${esc(ctx.me.display_name.slice(0, 1))}</span>
    <div><small>${mine ? greeting(hour) : "Viewing"}</small><strong>${mine ? esc(ctx.me.display_name) : `${esc(ownerName)}'s pills`}</strong></div></div>${ownerSwitch(ctx)}</div>`;
  const banner = !model.viewerIsOwner
    ? `<div class="banner">Only ${esc(ownerName)} can tick these pills. You can see what has been taken.</div>`
    : !model.canTick ? `<div class="banner">This day hasn't happened yet. You can tick on the day.</div>` : "";
  const days = week.map(d => `<button class="day ${d.date === today ? "today" : ""}" data-date="${d.date}" aria-pressed="${d.date === model.date}" aria-label="${fmtDay(d.date)}"><small>${d.weekday.slice(0, 2)}</small><b class="num">${d.day}</b><i class="${d.result}"></i></button>`).join("");
  const slots = model.slots.map(s => {
    const label = `<span class="slot-label" style="--c:${s.due ? SLOT_COLORS[s.timeOfDay][0] : "transparent"}">${esc(s.timeOfDay)}</span>`;
    const tickAll = s.canTickAll ? `<button class="tickall" data-tickall="${esc(s.timeOfDay)}">${I.checks}Tick all ${s.due - s.taken}</button>` : "";
    const rows = s.items.length ? s.items.map(i => doseRow(i, model.canTick)).join("") : `<p class="none">Nothing at this time.</p>`;
    return `<section aria-label="${esc(s.timeOfDay)}"><div class="sec-head">${label}<span class="head-right">${countChip(s)}${tickAll}</span></div><div class="doses">${rows}</div></section>`;
  }).join("");
  const prn = model.asNeeded.length
    ? `<section aria-label="When needed"><div class="sec-head"><span class="dash">When needed · no reminder</span></div><div class="doses">${model.asNeeded.map(x =>
        `<div class="dose prn">${thumb(x.medicine)}<div class="info"><div class="name">${medName(x.medicine)}</div><div class="meta">${x.medicine && x.medicine.purpose ? `<span class="mini after">${esc(x.medicine.purpose)}</span>` : ""}</div></div></div>`).join("")}</div></section>`
    : "";
  return `${head}${banner}
    <div class="week"><button class="arr" data-shift="-7" aria-label="Previous week">‹</button>${days}<button class="arr" data-shift="7" aria-label="Next week">›</button></div>
    ${ring(model)}
    ${model.isToday ? "" : `<button class="count back-today" data-date="${today}">← Back to today</button>`}
    ${slots}${prn}`;
}
