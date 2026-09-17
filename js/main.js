// Entry point: registers every screen (Today is already on SCREENS from js/app.js; Task 8 adds
// the rest via Object.assign(SCREENS, {...}) here), then starts the app.
import { start, S, ctx, now, SCREENS } from "./app.js";
import { adoptApiUrlFromLocation } from "./api.js";
import { bangkokToday } from "./schedule.js";
import { medsModel, detailModel, doctorsModel, emergencyModel } from "./viewmodel.js";
import { renderMeds } from "./views/meds.js";
import { renderDetail } from "./views/detail.js";
import { renderDoctors } from "./views/doctors.js";
import { renderEmergency, renderEmergencyEdit } from "./views/emergency.js";
import { renderMore } from "./views/more.js";

Object.assign(SCREENS, {
  meds: () => ({ tab: "meds", body: renderMeds({ model: medsModel(S.idx, S.owner), ctx: ctx() }) }),
  detail: () => ({ tab: "meds", body: renderDetail({ model: detailModel(S.idx, S.owner, S.detail), photo: S.photo }) }),
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

adoptApiUrlFromLocation();
start();
