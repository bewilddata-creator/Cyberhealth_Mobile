// Entry point: registers every screen (Today is already on SCREENS from js/app.js; Task 8 adds
// the rest via Object.assign(SCREENS, {...}) here), then starts the app.
import { start, S, ctx, now, SCREENS, formModel } from "./app.js";
import { adoptApiUrlFromLocation } from "./api.js";
import { bangkokToday } from "./schedule.js";
import { medsModel, detailModel, doctorsModel, emergencyModel, canEditOwner, medicineLibraryModel, medicineLibraryDetail, doctorLibraryModel, hospitalLibraryModel } from "./viewmodel.js";
import { renderMeds } from "./views/meds.js";
import { renderDetail } from "./views/detail.js";
import { renderDoctors } from "./views/doctors.js";
import { renderEmergency, renderEmergencyEdit } from "./views/emergency.js";
import { renderMore } from "./views/more.js";
import { renderMedicineForm, renderPrescriptionForm, renderDoseForm, renderScheduleForm, renderDoctorForm, renderHospitalForm } from "./views/forms.js";
import { renderMedicineLibrary, renderMedicineLibraryDetail, renderDoctorLibrary, renderHospitalLibrary } from "./views/libraries.js";

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
  // The four editing forms. Each reads its model from formModel(), which is S.form (what has
  // been picked so far) plus the lists rebuilt from the freshest bootstrap -- so the medicine
  // just added is in the picker, and a re-render never un-picks anything.
  medicineForm: () => ({ tab: "meds", body: renderMedicineForm({ medicine: formModel().medicine, error: S.formError, busy: S.formBusy }) }),
  prescriptionForm: () => ({ tab: "meds", body: renderPrescriptionForm({ model: formModel(), error: S.formError, busy: S.formBusy }) }),
  doseForm: () => ({ tab: "meds", body: renderDoseForm({ model: formModel(), error: S.formError, busy: S.formBusy }) }),
  scheduleForm: () => ({ tab: "meds", body: renderScheduleForm({ model: formModel(), error: S.formError, busy: S.formBusy }) }),
  // The three lists the whole family shares. They hang off More rather than off anybody's
  // Medicines tab because they are not per-person -- so every one of these keeps the More tab lit
  // at the bottom of the screen, and their back arrows go there.
  //
  // The name of each screen is what js/app.js sets S.screen to, and it has to stay that way:
  // formReturnScreen() only honours the screen a form was opened from when SCREENS has it, so a
  // detail registered here under a different name would silently send Edit-then-Save to Meds.
  medicineLibrary: () => ({ tab: "more", body: renderMedicineLibrary({ model: medicineLibraryModel(S.idx), query: S.libraryQuery }) }),
  medicineLibraryDetail: () => ({ tab: "more", body: renderMedicineLibraryDetail({ model: medicineLibraryDetail(S.idx, S.libraryMedicine), photo: S.photo }) }),
  doctorLibrary: () => ({ tab: "more", body: renderDoctorLibrary({ model: doctorLibraryModel(S.idx), query: S.libraryQuery }) }),
  hospitalLibrary: () => ({ tab: "more", body: renderHospitalLibrary({ model: hospitalLibraryModel(S.idx), query: S.libraryQuery }) }),
  // Both library forms read their model from formModel(), which rebuilds the photo, the hospitals
  // to tick and canDelete from the freshest bootstrap on every render.
  doctorForm: () => ({ tab: "more", body: renderDoctorForm({ model: formModel(), error: S.formError, busy: S.formBusy }) }),
  hospitalForm: () => ({ tab: "more", body: renderHospitalForm({ model: formModel(), error: S.formError, busy: S.formBusy }) }),
});

// https-only: localhost/http development never registers the worker, so it never caches a stale
// build behind a developer's back.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
}

adoptApiUrlFromLocation();
start();
