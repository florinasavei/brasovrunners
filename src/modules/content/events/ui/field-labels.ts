import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

/**
 * The label of every box on the event form, by the `name` it posts — for the refusal summary
 * that links a named field to its box (§47, `DECISIONS.md` §315), so an organizer reads
 * "Română: Titlu" and never `translations.ro.title`, the same lookup the editor's "not ready
 * to publish" alert makes (§170).
 *
 * Numbered boxes are listed once, unindexed (`event.schedule[].date`); `ActionForm` strips the
 * index before it looks. A whole panel has an entry too (`event.bibDesign`), so a field inside
 * it that has no line of its own is still named by where it is.
 */
export async function eventFormFieldLabels(): Promise<Record<string, string>> {
  const t = await getTranslations("Admin");
  const tSite = await getTranslations("Site");

  const labels: Record<string, string> = {
    "event.type": t("editor.type"),
    "event.surface": t("editor.surface"),
    "event.eventStatus": t("editor.eventStatus"),
    "event.timezone": t("editor.timezone"),
    "event.startsAtDate": t("editor.startsAt"),
    "event.startsAtTime": t("editor.startsAt"),
    "event.endsAtDate": t("editor.endsAt"),
    "event.endsAtTime": t("editor.endsAt"),
    "event.raceStartsAtDate": t("editor.raceStartsAt"),
    "event.raceStartsAtTime": t("editor.raceStartsAt"),
    "event.durationMinutes": t("editor.durationMinutes"),
    "event.locationName": t("editor.fields.locationName"),
    "event.mapUrl": t("editor.mapUrl"),
    "event.registrationMode": t("editor.registrationMode"),
    "event.capacity": t("editor.capacity"),
    "event.registrationOpensAtDate": t("editor.registrationOpensAt"),
    "event.registrationOpensAtTime": t("editor.registrationOpensAt"),
    "event.registrationClosesAtDate": t("editor.registrationClosesAt"),
    "event.registrationClosesAtTime": t("editor.registrationClosesAt"),
    "event.confirmationOpensDaysBefore": t("editor.confirmationOpensDaysBefore"),
    "event.confirmationDeadlineDaysBefore": t("editor.confirmationDeadlineDaysBefore"),
    "event.bibStartNumber": t("editor.bibStartNumber"),
    "event.bibColour": t("editor.bibColour"),
    "event.bibDesign": t("editor.bibDesign.title"),
    "event.declarationDocumentId": t("editor.declarationDocument"),
    "event.participantListVisibility": t("editor.participantList"),
    "event.externalProvider": t("editor.externalProvider"),
    "event.externalRegistrationUrl": t("editor.externalRegistrationUrl"),
    "event.difficulty": t("editor.fields.difficulty"),
    "event.costType": t("editor.fields.costType"),
    "event.routeUrl": t("editor.routeUrl"),
    "event.distanceMeters": t("editor.distanceMeters"),
    "event.elevationGainMeters": t("editor.elevationGainMeters"),
    "event.stravaEventUrl": t("editor.stravaEventUrl"),
    "event.facebookEventUrl": t("editor.facebookEventUrl"),
    "event.featured": t("editor.featured"),
    "event.isSpecial": t("editor.special"),
    "event.coHosts[].name": `${t("editor.coHostSection")}: ${t("editor.coHostName")}`,
    "event.coHosts[].url": `${t("editor.coHostSection")}: ${t("editor.coHostUrl")}`,
    "event.schedule[].date": `${t("editor.programmeSection")}: ${t("editor.programmeRows.date")}`,
    "event.schedule[].time": `${t("editor.programmeSection")}: ${t("editor.programmeRows.time")}`,
    "event.schedule[].endTime": `${t("editor.programmeSection")}: ${t("editor.programmeRows.endTime")}`,
    "event.schedule[].ro": `${t("editor.programmeSection")}: ${t("editor.programmeRows.ro")}`,
    "event.schedule[].en": `${t("editor.programmeSection")}: ${t("editor.programmeRows.en")}`,
    "event.schedule[].place": `${t("editor.programmeSection")}: ${t("editor.programmeRows.place")}`,
    // Beside the save button (§NNN): what changed, and why the event is cancelled.
    "notice.note": t("editor.notice.note"),
    "cancel.reason": t("editor.notice.cancelReason"),
    "repeat.cadence": t("editor.repeatCadence"),
    "repeat.until": t("editor.repeatUntil"),
    weekday: t("editor.repeatWeekdays"),
  };

  // Every language's boxes, named with the language first, as the publication alert does.
  const perLanguage: Record<string, string> = {
    title: t("editor.fields.title"),
    slug: t("editor.fields.slug"),
    excerpt: t("editor.fields.excerpt"),
    excerptBody: t("editor.fields.excerpt"),
    body: t("editor.fields.body"),
    rules: t("editor.fields.rules"),
    schedule: t("editor.fields.scheduleNotes"),
    checklist: t("editor.fields.checklist"),
    locationName: t("editor.locationNameInLanguage"),
    seoTitle: t("editor.fields.seoTitle"),
    seoDescription: t("editor.fields.seoDescription"),
  };
  for (const locale of routing.locales) {
    const language = tSite(`languageName.${locale}`);
    for (const [field, label] of Object.entries(perLanguage)) {
      labels[`translations.${locale}.${field}`] = `${language}: ${label}`;
    }
  }

  return labels;
}
