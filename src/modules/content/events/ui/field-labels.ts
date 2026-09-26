import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { MAX_CO_HOST_DESCRIPTION, MAX_CO_HOST_LINK_LABEL, MAX_CO_HOST_LINKS, MAX_CO_HOSTS } from "@/modules/events/domain/co-hosts";
import { EVENT_NOTICE_TEXT_MAX } from "@/modules/events/domain/event-changes";
import { MAX_EVENT_LINK_LABEL, MAX_EVENT_LINKS } from "@/modules/events/domain/links";
import type { IdenticalLabels } from "./publish-check";

/**
 * The label of every box on the event form, by the `name` it posts — for the refusal summary
 * that links a named field to its box (§47, `DECISIONS.md` §315), so an organizer reads
 * "Titlu și rezumat › Română › Titlu" and never `translations.ro.title`.
 *
 * Every label starts with the title of the editor box that holds it (§350): the form is fourteen
 * boxes now, most of them shut, and the summary's line is what tells the reader which one to
 * open — the link opens it for them. The names are exactly the ones the form posts; only the
 * words changed.
 *
 * Numbered boxes are listed once, unindexed (`event.schedule[].date`); `ActionForm` strips the
 * index before it looks. A whole panel has an entry too (`event.bibDesign`), so a field inside
 * it that has no line of its own is still named by where it is.
 */
export async function eventFormFieldLabels(): Promise<Record<string, string>> {
  const t = await getTranslations("Admin");
  const tSite = await getTranslations("Site");
  const inBox = (box: string, label: string) => `${t(`editor.boxes.${box}.title`)} › ${label}`;
  // The status is a card inside the first box since §448: its fields are named by both.
  const inStatus = (label: string) => inBox("kind", `${t("editor.boxes.status.title")} › ${label}`);

  const labels: Record<string, string> = {
    "event.type": inBox("kind", t("editor.type")),
    "event.surface": inBox("course", t("editor.surface")),
    // The one way the select is refused from a page: "Încheiat" on a new event not started yet (§448).
    "event.eventStatus": inStatus(t("editor.boxes.status.completedRefused")),
    "event.timezone": inBox("when", t("editor.timezone")),
    "event.startsAtDate": inBox("when", t("editor.startsAt")),
    "event.startsAtTime": inBox("when", t("editor.startsAt")),
    "event.endsAtDate": inBox("when", t("editor.endsAt")),
    "event.endsAtTime": inBox("when", t("editor.endsAt")),
    "event.raceStartsAtDate": inBox("when", t("editor.raceStartsAt")),
    "event.raceStartsAtTime": inBox("when", t("editor.raceStartsAt")),
    // «Durata» as hours and minutes (§433); a refusal of the total names the hours box.
    "event.durationHours": inBox("when", `${t("editor.duration")} › ${t("editor.durationHours")}`),
    "event.durationMinutesPart": inBox("when", `${t("editor.duration")} › ${t("editor.durationMinutesPart")}`),
    // "Punct de întâlnire", once per language (§362): the refusal names the empty one's language.
    "event.locationName": inBox("place", `${t("editor.fields.locationName")} (${tSite("languageName.ro")})`),
    "event.locationNameEn": inBox("place", `${t("editor.fields.locationName")} (${tSite("languageName.en")})`),
    "event.locationToBeAnnounced": inBox("place", t("editor.placeToBeAnnounced")),
    "event.mapUrl": inBox("place", t("editor.mapUrl")),
    "event.coordinates": inBox("place", t("editor.coordinates")),
    "event.registrationMode": inBox("registration", t("editor.registrationMode")),
    "event.capacity": inBox("registration", t("editor.capacity")),
    "event.waitlistCapacity": inBox("registration", t("editor.waitlistCapacity")),
    "event.minAge": inBox("conditions", t("editor.minAge")),
    "event.registrationOpensAtDate": inBox("registrationWindow", t("editor.registrationOpensAt")),
    "event.registrationOpensAtTime": inBox("registrationWindow", t("editor.registrationOpensAt")),
    "event.registrationClosesAtDate": inBox("registrationWindow", t("editor.registrationClosesAt")),
    "event.registrationClosesAtTime": inBox("registrationWindow", t("editor.registrationClosesAt")),
    "event.confirmationOpensDaysBefore": inBox("confirmation", t("editor.confirmationOpensDaysBefore")),
    "event.confirmationDeadlineDaysBefore": inBox("confirmation", t("editor.confirmationDeadlineDaysBefore")),
    // The event's own reminder lead (§377): "as usual", 24, 48, 72 hours or none.
    "event.reminderHoursBefore": inBox("reminder", t("editor.reminder.label")),
    "event.bibStartNumber": inBox("bibs", t("editor.bibStartNumber")),
    "event.bibColour": inBox("bibs", t("editor.bibColour")),
    "event.bibDesign": inBox("bibs", t("editor.bibDesign.title")),
    "event.declarationDocumentId": inBox("rules", `${t("editor.boxes.declaration.title")} › ${t("editor.declarationDocument")}`),
    "event.participantListVisibility": inBox("startList", t("editor.participantList")),
    "event.externalProvider": inBox("registration", t("editor.externalProvider")),
    "event.externalRegistrationUrl": inBox("registration", t("editor.externalRegistrationUrl")),
    "event.difficulty": inBox("course", t("editor.fields.difficulty")),
    "event.costType": inBox("registration", t("editor.fields.costType")),
    // `costRule` (`content/events/fields.ts`) never names `costAmount` outside `PAID` nor
    // `costUrl` outside `DONATION`, so each name has exactly one meaning to the organizer who
    // reads it back — the same box `CostFields` relabels by the chosen kind (§343).
    "event.costAmount": inBox("registration", t("editor.costAmount")),
    "event.costUrl": inBox("registration", t("editor.costDonationUrl")),
    "event.routeUrl": inBox("course", t("editor.routeUrl")),
    "event.distanceMeters": inBox("course", t("editor.distanceMeters")),
    "event.elevationGainMeters": inBox("course", t("editor.elevationGainMeters")),
    "event.nightOverride": inBox("course", t("editor.night.label")),
    "event.offersGroupRunDeclaration": inBox("rules", `${t("editor.boxes.declaration.title")} › ${t("editor.groupRunDeclaration.label")}`),
    "event.stravaEventUrl": inBox("links", t("editor.stravaEventUrl")),
    "event.facebookEventUrl": inBox("links", t("editor.facebookEventUrl")),
    "event.featured": inBox("promotion", t("editor.featured")),
    "event.isSpecial": inBox("promotion", t("editor.special")),
    "event.schedule[].date": inBox("programme", t("editor.programmeRows.date")),
    "event.schedule[].time": inBox("programme", t("editor.programmeRows.time")),
    "event.schedule[].endTime": inBox("programme", t("editor.programmeRows.endTime")),
    "event.schedule[].ro": inBox("programme", t("editor.programmeRows.ro")),
    "event.schedule[].en": inBox("programme", t("editor.programmeRows.en")),
    "event.schedule[].place": inBox("programme", t("editor.programmeRows.place")),
    /*
      In the Salvare box (§331): what changed; in the status box: why the event is cancelled — one
      box per language (§354, bilingual everywhere), each named with its language and what it
      needs, since a both-or-neither refusal names only the empty side.
    */
    "notice.noteRo": inBox("save", t("editor.notice.noteRoError", { max: EVENT_NOTICE_TEXT_MAX })),
    "notice.noteEn": inBox("save", t("editor.notice.noteEnError", { max: EVENT_NOTICE_TEXT_MAX })),
    "cancel.reasonRo": inStatus(t("editor.notice.cancelReasonRoError", { max: EVENT_NOTICE_TEXT_MAX })),
    "cancel.reasonEn": inStatus(t("editor.notice.cancelReasonEnError", { max: EVENT_NOTICE_TEXT_MAX })),
    "repeat.cadence": inBox("recurrence", t("editor.repeatCadence")),
    "repeat.until": inBox("recurrence", t("editor.repeatUntil")),
    weekday: inBox("recurrence", t("editor.repeatWeekdays")),
  };

  /*
    The links (§332), named **by row** and by what is wrong with them — "Linkul 2: adresa trebuie
    să înceapă cu https://" — because a link row is refused for one reason a person can cause
    (the address), and "Linkuri: Adresa" in a list of eight would not say which of the rows to
    look at. `ActionForm` reads the exact name first, so the indexed entries win; the unindexed
    ones are the fallback for a name past the ceiling.
  */
  labels["event.links"] = t("editor.linkRows.tooMany", { max: MAX_EVENT_LINKS });
  labels["event.links[].url"] = inBox("links", t("editor.linkRows.url"));
  labels["event.links[].kind"] = inBox("links", t("editor.linkRows.kind"));
  labels["event.links[].labelRo"] = inBox("links", t("editor.linkRows.labelRo"));
  labels["event.links[].labelEn"] = inBox("links", t("editor.linkRows.labelEn"));
  for (let index = 0; index < MAX_EVENT_LINKS; index += 1) {
    const n = index + 1;
    // "Linkul 2: …" already says where it is: the row's own words, without the box's title.
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
    for a name past either ceiling, under the box's title like every other box; `ActionForm` tries
    the exact name first.
  */
  labels["event.coHosts"] = t("editor.coHostRows.tooMany", { max: MAX_CO_HOSTS });
  labels["event.coHosts[].name"] = inBox("coHosts", t("editor.coHostRows.name"));
  // What the partnership is (§352): the box's own heading and its language, as the boxes say it.
  labels["event.coHosts[].descriptionRo"] = inBox("coHosts", `${t("editor.coHostRows.about")} (${tSite("languageName.ro")})`);
  labels["event.coHosts[].descriptionEn"] = inBox("coHosts", `${t("editor.coHostRows.about")} (${tSite("languageName.en")})`);
  labels["event.coHosts[].links"] = t("editor.coHostRows.tooManyLinksGeneric", { max: MAX_CO_HOST_LINKS });
  labels["event.coHosts[].links[].kind"] = inBox("coHosts", t("editor.coHostRows.kind"));
  labels["event.coHosts[].links[].url"] = inBox("coHosts", t("editor.coHostRows.url"));
  labels["event.coHosts[].links[].labelRo"] = inBox("coHosts", t("editor.coHostRows.labelRo"));
  labels["event.coHosts[].links[].labelEn"] = inBox("coHosts", t("editor.coHostRows.labelEn"));
  for (let p = 0; p < MAX_CO_HOSTS; p += 1) {
    const partnerNumber = p + 1;
    labels[`event.coHosts[${p}].name`] = t("editor.coHostRows.nameError", { p: partnerNumber });
    // "Partenerul 1 — despre parteneriat (English): …": the empty side of a one-language text
    // (§352), which is the only side a both-or-neither refusal ever names.
    labels[`event.coHosts[${p}].descriptionRo`] = t("editor.coHostRows.descriptionRoError", { p: partnerNumber, max: MAX_CO_HOST_DESCRIPTION });
    labels[`event.coHosts[${p}].descriptionEn`] = t("editor.coHostRows.descriptionEnError", { p: partnerNumber, max: MAX_CO_HOST_DESCRIPTION });
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

  // Every language's boxes: the box, the language (the tab to bring forward), the field.
  const perLanguage: Record<string, [box: string, label: string]> = {
    title: ["titleSummary", t("editor.fields.title")],
    excerpt: ["titleSummary", t("editor.boxes.summaryLabel")],
    excerptBody: ["titleSummary", t("editor.boxes.summaryLabel")],
    body: ["description", t("editor.fields.body")],
    rules: ["rules", t("editor.fields.rules")],
    schedule: ["programme", t("editor.fields.scheduleNotes")],
    // The route / training description (§387), in the "Traseul" card.
    routeDescription: ["course", t("editor.fields.routeDescription")],
    checklist: ["programme", t("editor.fields.checklist")],
    slug: ["address", t("editor.fields.slug")],
    seoTitle: ["address", t("editor.fields.seoTitle")],
    seoDescription: ["address", t("editor.fields.seoDescription")],
    // The club's discount on an external event's own fee (`DECISIONS.md` §394), under the same
    // box the cost boxes live in.
    discountNote: ["registration", t("editor.discountNote")],
  };
  for (const locale of routing.locales) {
    const language = tSite(`languageName.${locale}`);
    for (const [field, [box, label]] of Object.entries(perLanguage)) {
      labels[`translations.${locale}.${field}`] = inBox(box, `${language} › ${label}`);
    }
  }

  return labels;
}

/**
 * The words the Publicare box names a text by when its English is its Romanian word for word
 * (§354, bilingual everywhere): the box's title, the partner's number, the language and the
 * field, as the boxes themselves say them — "Descrierea evenimentului › English › Descriere".
 */
export async function identicalTextLabels(): Promise<IdenticalLabels> {
  const t = await getTranslations("Admin");
  const tSite = await getTranslations("Site");
  return {
    boxes: {
      titleSummary: t("editor.boxes.titleSummary.title"),
      description: t("editor.boxes.description.title"),
      programme: t("editor.boxes.programme.title"),
      rules: t("editor.boxes.rules.title"),
      coHosts: t("editor.boxes.coHosts.title"),
      course: t("editor.boxes.course.title"),
    },
    fields: {
      excerpt: t("editor.boxes.summaryLabel"),
      body: t("editor.fields.body"),
      schedule: t("editor.fields.scheduleNotes"),
      checklist: t("editor.fields.checklist"),
      rules: t("editor.fields.rules"),
      coHostDescription: t("editor.coHostRows.about"),
      routeDescription: t("editor.fields.routeDescription"),
    },
    languages: Object.fromEntries(routing.locales.map((locale) => [locale, tSite(`languageName.${locale}`)])),
    // The card's number is filled in by `identicalTextLabel`, so the placeholder travels as itself.
    partner: t("editor.identical.partner", { p: "{p}" }),
  };
}
