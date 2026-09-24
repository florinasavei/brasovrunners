import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { MAX_CO_HOST_LINK_LABEL, MAX_CO_HOST_LINKS, MAX_CO_HOSTS } from "@/modules/events/domain/co-hosts";
import { MAX_EVENT_LINK_LABEL, MAX_EVENT_LINKS } from "@/modules/events/domain/links";

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
    "event.locationToBeAnnounced": t("editor.placeToBeAnnounced"),
    "event.mapUrl": t("editor.mapUrl"),
    "event.registrationMode": t("editor.registrationMode"),
    "event.capacity": t("editor.capacity"),
    "event.minAge": t("editor.minAge"),
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
    // `costRule` (`content/events/fields.ts`) never names `costAmount` outside `PAID` nor
    // `costUrl` outside `DONATION`, so each name has exactly one meaning to the organizer who
    // reads it back — the same box `CostFields` relabels by the chosen kind (§343).
    "event.costAmount": t("editor.costAmount"),
    "event.costUrl": t("editor.costDonationUrl"),
    "event.routeUrl": t("editor.routeUrl"),
    "event.distanceMeters": t("editor.distanceMeters"),
    "event.elevationGainMeters": t("editor.elevationGainMeters"),
    "event.stravaEventUrl": t("editor.stravaEventUrl"),
    "event.facebookEventUrl": t("editor.facebookEventUrl"),
    "event.featured": t("editor.featured"),
    "event.isSpecial": t("editor.special"),
    "event.schedule[].date": `${t("editor.programmeSection")}: ${t("editor.programmeRows.date")}`,
    "event.schedule[].time": `${t("editor.programmeSection")}: ${t("editor.programmeRows.time")}`,
    "event.schedule[].endTime": `${t("editor.programmeSection")}: ${t("editor.programmeRows.endTime")}`,
    "event.schedule[].ro": `${t("editor.programmeSection")}: ${t("editor.programmeRows.ro")}`,
    "event.schedule[].en": `${t("editor.programmeSection")}: ${t("editor.programmeRows.en")}`,
    "event.schedule[].place": `${t("editor.programmeSection")}: ${t("editor.programmeRows.place")}`,
    // Beside the save button (§331): what changed, and why the event is cancelled.
    "notice.note": t("editor.notice.note"),
    "cancel.reason": t("editor.notice.cancelReason"),
    "repeat.cadence": t("editor.repeatCadence"),
    "repeat.until": t("editor.repeatUntil"),
    weekday: t("editor.repeatWeekdays"),
  };

  /*
    The links (§332), named **by row** and by what is wrong with them — "Linkul 2: adresa trebuie
    să înceapă cu https://" — because a link row is refused for one reason a person can cause
    (the address), and "Linkuri: Adresa" in a list of eight would not say which of the rows to
    look at. `ActionForm` reads the exact name first, so the indexed entries win; the unindexed
    ones are the fallback for a name past the ceiling. A label or a kind can only be wrong from a
    form somebody tampered with — the boxes carry `maxLength` and the select posts the set.
  */
  labels["event.links"] = t("editor.linkRows.tooMany", { max: MAX_EVENT_LINKS });
  labels["event.links[].url"] = `${t("editor.linksSection")}: ${t("editor.linkRows.url")}`;
  labels["event.links[].kind"] = `${t("editor.linksSection")}: ${t("editor.linkRows.kind")}`;
  labels["event.links[].labelRo"] = `${t("editor.linksSection")}: ${t("editor.linkRows.labelRo")}`;
  labels["event.links[].labelEn"] = `${t("editor.linksSection")}: ${t("editor.linkRows.labelEn")}`;
  for (let index = 0; index < MAX_EVENT_LINKS; index += 1) {
    const n = index + 1;
    labels[`event.links[${index}].url`] = t("editor.linkRows.urlError", { n });
    labels[`event.links[${index}].kind`] = t("editor.linkRows.kindError", { n });
    labels[`event.links[${index}].labelRo`] = t("editor.linkRows.labelRoError", { n, max: MAX_EVENT_LINK_LABEL });
    labels[`event.links[${index}].labelEn`] = t("editor.linkRows.labelEnError", { n, max: MAX_EVENT_LINK_LABEL });
  }

  /*
    The partners (§168) and their links (§344), named **by card and by row** — "Partenerul 2,
    linkul 3: adresa trebuie să înceapă cu https://" — the same reasoning the plain links above
    follow, one level deeper: a link is wrong on one partner's one row, and naming only "Parteneri"
    would leave an organizer with eight cards to search. The unindexed entries are the fallback
    for a name past either ceiling; `ActionForm` tries the exact name first.
  */
  labels["event.coHosts"] = t("editor.coHostRows.tooMany", { max: MAX_CO_HOSTS });
  labels["event.coHosts[].name"] = `${t("editor.coHostSection")}: ${t("editor.coHostRows.name")}`;
  labels["event.coHosts[].links"] = t("editor.coHostRows.tooManyLinksGeneric", { max: MAX_CO_HOST_LINKS });
  labels["event.coHosts[].links[].kind"] = `${t("editor.coHostSection")}: ${t("editor.coHostRows.kind")}`;
  labels["event.coHosts[].links[].url"] = `${t("editor.coHostSection")}: ${t("editor.coHostRows.url")}`;
  labels["event.coHosts[].links[].labelRo"] = `${t("editor.coHostSection")}: ${t("editor.coHostRows.labelRo")}`;
  labels["event.coHosts[].links[].labelEn"] = `${t("editor.coHostSection")}: ${t("editor.coHostRows.labelEn")}`;
  for (let p = 0; p < MAX_CO_HOSTS; p += 1) {
    const partnerNumber = p + 1;
    labels[`event.coHosts[${p}].name`] = t("editor.coHostRows.nameError", { p: partnerNumber });
    labels[`event.coHosts[${p}].links`] = t("editor.coHostRows.tooManyLinks", { p: partnerNumber, max: MAX_CO_HOST_LINKS });
    for (let l = 0; l < MAX_CO_HOST_LINKS; l += 1) {
      const linkNumber = l + 1;
      labels[`event.coHosts[${p}].links[${l}].kind`] = t("editor.coHostRows.kindError", { p: partnerNumber, l: linkNumber });
      labels[`event.coHosts[${p}].links[${l}].url`] = t("editor.coHostRows.urlError", { p: partnerNumber, l: linkNumber });
      labels[`event.coHosts[${p}].links[${l}].labelRo`] = t("editor.coHostRows.labelRoError", {
        p: partnerNumber,
        l: linkNumber,
        max: MAX_CO_HOST_LINK_LABEL,
      });
      labels[`event.coHosts[${p}].links[${l}].labelEn`] = t("editor.coHostRows.labelEnError", {
        p: partnerNumber,
        l: linkNumber,
        max: MAX_CO_HOST_LINK_LABEL,
      });
    }
  }

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
