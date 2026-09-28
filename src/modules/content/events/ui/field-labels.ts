import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { MAX_CO_HOST_DESCRIPTION, MAX_CO_HOST_LINK_LABEL, MAX_CO_HOST_LINKS, MAX_CO_HOSTS } from "@/modules/events/domain/co-hosts";
import { EVENT_NOTICE_TEXT_MAX } from "@/modules/events/domain/event-changes";
import { MAX_EVENT_LINK_LABEL, MAX_EVENT_LINKS } from "@/modules/events/domain/links";
import type { IdenticalLabels } from "./publish-check";

/**
 * The label of every box on the event form by its posted `name`, for the refusal summary (§47,
 * §315): "Titlu și rezumat › Română › Titlu", never `translations.ro.title`. Each label starts with
 * its editor box's title (§350), which tells the reader which box to open. Numbered boxes are
 * listed unindexed (`ActionForm` strips the index); a whole panel has an entry too, as a fallback.
 */
export async function eventFormFieldLabels(): Promise<Record<string, string>> {
  const t = await getTranslations("Admin");
  const tSite = await getTranslations("Site");
  const inBox = (box: string, label: string) => `${t(`editor.boxes.${box}.title`)} › ${label}`;
  // The status is a card inside the first box (§448): named by both.
  const inStatus = (label: string) => inBox("kind", `${t("editor.boxes.status.title")} › ${label}`);
  // «Când și unde» holds the date, the place and the time zone (§481).
  const inWhenWhere = (label: string) => inBox("whenWhere", label);
  // A field in «Program, regulament și declarație» is named by the card and its inner card (§481, §512).
  const inProgrammeRules = (card: "programme" | "rules" | "declaration" | "startList", label: string) =>
    inBox("programmeRules", `${t(`editor.boxes.${card}.title`)} › ${label}`);

  const labels: Record<string, string> = {
    "event.type": inBox("kind", t("editor.type")),
    "event.surface": inBox("course", t("editor.surface")),
    // The one page refusal of the select: "Încheiat" on a new event not started yet (§448); the
    // card's title once, then the sentence (§483).
    "event.eventStatus": inBox("kind", `${t("editor.boxes.status.title")}: ${t("editor.boxes.status.completedRefused")}`),
    "event.timezone": inWhenWhere(t("editor.timezone")),
    "event.startsAtDate": inWhenWhere(t("editor.startsAt")),
    "event.startsAtTime": inWhenWhere(t("editor.startsAt")),
    "event.endsAtDate": inWhenWhere(t("editor.endsAt")),
    "event.endsAtTime": inWhenWhere(t("editor.endsAt")),
    "event.raceStartsAtDate": inWhenWhere(t("editor.raceStartsAt")),
    "event.raceStartsAtTime": inWhenWhere(t("editor.raceStartsAt")),
    // «Durata» (§433): a refusal of the total names the hours box.
    "event.durationHours": inWhenWhere(`${t("editor.duration")} › ${t("editor.durationHours")}`),
    "event.durationMinutesPart": inWhenWhere(`${t("editor.duration")} › ${t("editor.durationMinutesPart")}`),
    // "Punct de întâlnire" per language (§362): the refusal names the empty one's language.
    "event.locationName": inWhenWhere(`${t("editor.fields.locationName")} (${tSite("languageName.ro")})`),
    "event.locationNameEn": inWhenWhere(`${t("editor.fields.locationName")} (${tSite("languageName.en")})`),
    "event.locationToBeAnnounced": inWhenWhere(t("editor.placeToBeAnnounced")),
    "event.mapUrl": inWhenWhere(t("editor.mapUrl")),
    "event.coordinates": inWhenWhere(t("editor.coordinates")),
    "event.registrationMode": inBox("registration", t("editor.registrationMode")),
    "event.capacity": inBox("registration", t("editor.capacity")),
    "event.waitlistCapacity": inBox("registration", t("editor.waitlistCapacity")),
    // One box for every type, in «Regulamentul» (§505).
    "event.minAge": inProgrammeRules("rules", t("editor.minAge")),
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
    "event.declarationDocumentId": inProgrammeRules("declaration", t("editor.declarationDocument")),
    "event.participantListVisibility": inProgrammeRules("startList", t("editor.participantList")),
    "event.externalProvider": inBox("registration", t("editor.externalProvider")),
    "event.externalRegistrationUrl": inBox("registration", t("editor.externalRegistrationUrl")),
    // Both in «Ce fel de eveniment», side by side (§526).
    "event.difficulty": inBox("kind", t("editor.fields.difficulty")),
    "event.difficultyStep": inBox("kind", t("editor.fields.difficultyStep")),
    "event.costType": inBox("registration", t("editor.fields.costType")),
    // `costRule` names `costAmount` only for `PAID` and `costUrl` only for `DONATION`, so each
    // name has one meaning — the box `CostFields` relabels (§343).
    "event.costAmount": inBox("registration", t("editor.costAmount")),
    "event.costUrl": inBox("registration", t("editor.costDonationUrl")),
    "event.routeUrl": inBox("course", t("editor.routeUrl")),
    "event.distanceMeters": inBox("course", t("editor.distanceMeters")),
    "event.elevationGainMeters": inBox("course", t("editor.elevationGainMeters")),
    "event.nightOverride": inBox("course", t("editor.night.label")),
    "event.offersGroupRunDeclaration": inProgrammeRules("declaration", t("editor.groupRunDeclaration.label")),
    "event.stravaEventUrl": inBox("links", t("editor.stravaEventUrl")),
    "event.facebookEventUrl": inBox("links", t("editor.facebookEventUrl")),
    "event.featured": inBox("promotion", t("editor.featured")),
    "event.isSpecial": inBox("promotion", t("editor.special")),
    "event.schedule[].date": inProgrammeRules("programme", t("editor.programmeRows.date")),
    "event.schedule[].time": inProgrammeRules("programme", t("editor.programmeRows.time")),
    "event.schedule[].endTime": inProgrammeRules("programme", t("editor.programmeRows.endTime")),
    "event.schedule[].ro": inProgrammeRules("programme", t("editor.programmeRows.ro")),
    "event.schedule[].en": inProgrammeRules("programme", t("editor.programmeRows.en")),
    "event.schedule[].place": inProgrammeRules("programme", t("editor.programmeRows.place")),
    /*
      The update note (Salvare, §331) and the cancellation reason (status card): one box per language
      (§354), each named with its language, since a both-or-neither refusal names only the empty side.
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
    The links (§332), named by row ("Linkul 2: adresa trebuie să înceapă cu https://") so the
    organizer knows which row. `ActionForm` tries the exact name first; the unindexed entries are
    the fallback past the ceiling.
  */
  labels["event.links"] = t("editor.linkRows.tooMany", { max: MAX_EVENT_LINKS });
  labels["event.links[].url"] = inBox("links", t("editor.linkRows.url"));
  labels["event.links[].kind"] = inBox("links", t("editor.linkRows.kind"));
  labels["event.links[].labelRo"] = inBox("links", t("editor.linkRows.labelRo"));
  labels["event.links[].labelEn"] = inBox("links", t("editor.linkRows.labelEn"));
  for (let index = 0; index < MAX_EVENT_LINKS; index += 1) {
    const n = index + 1;
    // "Linkul 2: …" already says where: the row's words, without the box's title.
    labels[`event.links[${index}].url`] = t("editor.linkRows.urlError", { n });
    labels[`event.links[${index}].kind`] = t("editor.linkRows.kindError", { n });
    labels[`event.links[${index}].labelRo`] = t("editor.linkRows.labelRoError", { n, max: MAX_EVENT_LINK_LABEL });
    labels[`event.links[${index}].labelEn`] = t("editor.linkRows.labelEnError", { n, max: MAX_EVENT_LINK_LABEL });
  }

  /*
    The partners (§168) and their links (§344), named by card and row ("Partenerul 2, linkul 3: …"),
    as the links above; the unindexed entries are the fallback past either ceiling.
  */
  labels["event.coHosts"] = t("editor.coHostRows.tooMany", { max: MAX_CO_HOSTS });
  labels["event.coHosts[].name"] = inBox("coHosts", t("editor.coHostRows.name"));
  // What the partnership is (§352): the box's heading and its language.
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
    // The empty side of a one-language text (§352), the only side a both-or-neither refusal names.
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
    // The discount note on an external event's fee (§394), in the cost's box.
    discountNote: ["registration", t("editor.discountNote")],
  };
  for (const locale of routing.locales) {
    const language = tSite(`languageName.${locale}`);
    for (const [field, [box, label]] of Object.entries(perLanguage)) {
      // The programme's and the rules' texts are cards inside «Program, regulament și declarație» (§481).
      labels[`translations.${locale}.${field}`] =
        box === "programme" || box === "rules" ? inProgrammeRules(box, `${language} › ${label}`) : inBox(box, `${language} › ${label}`);
    }
  }

  return labels;
}

/**
 * How the Publicare box names a text whose English equals its Romanian (§354): box, partner
 * number, language and field, as the boxes say them.
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
    // `identicalTextLabel` fills in the card's number, so the placeholder travels as itself.
    partner: t("editor.identical.partner", { p: "{p}" }),
  };
}
