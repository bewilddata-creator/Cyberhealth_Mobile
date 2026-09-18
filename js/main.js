// Entry point: registers every screen (Today is already on SCREENS from js/app.js; Task 8 adds
// the rest via Object.assign(SCREENS, {...}) here), then starts the app.
import { start, S, ctx, now, SCREENS } from "./app.js";
import { adoptApiUrlFromLocation } from "./api.js";
import { bangkokToday } from "./schedule.js";
import { medsModel, detailModel, doctorsModel, emergencyModel, canEditOwner } from "./viewmodel.js";
import { renderMeds } from "./views/meds.js";
import { renderDetail } from "./views/detail.js";
import { renderDoctors } from "./views/doctors.js";
import { renderEmergency, renderEmergencyEdit } from "./views/emergency.js";
import { renderMore } from "./views/more.js";

Object.assign(SCREENS, {
  meds: () => ({ tab: "meds", body: renderMeds({ model: medsModel(S.idx, S.owner), ctx: ctx(), canEdit: canEditOwner(S.idx, S.owner) }) }),
  detail: () => ({ tab: "meds", body: renderDetail({ model: detailModel(S.idx, S.owner, S.detail), photo: S.photo, canEdit: canEditOwner(S.idx, S.owner) }) }),
  team: () => ({ tab: "team", body: renderDoctors({ rows: doctorsModel(S.idx, S.owner), ctx: ctx() }) }),
  sos: () => {
    const cards = S.pub ? S.cards : (S.boot ? S.boot.emergency : null);
    const bootLike = S.pub ? { emergency: cards || [], today: bangkokToday(now()) } : S.boot;
    const model = cards && bootLike ? emergencyModel(bootLike, S.sosFor) : null;
    return { tab: "sos", body: renderEmergency({ cards, model, ctx: S.pub ? null : ctx(), publicMode: S.pub }) };
  },
  emergencyEdit: () => {
    const card = S.boot.emergency.find(c => c.user_id === S.boot.me.user_id) || { user_id: S.boot.me.user_id };
    return { tab: "sos", body: renderEmergencyEdit({ card, error: S.editError, busy: S.editBusy }) };
  },
  more: () => ({ tab: "more", body: renderMore({ me: S.boot.me, warnings: S.boot.warnings }) }),
});

// https-only: localhost/http development never registers the worker, so it never caches a stale
// build behind a developer's back.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
}

adoptApiUrlFromLocation();
start();
