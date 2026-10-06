import { placeNameIn } from "@/modules/events/domain/place";
import { withoutPlaces } from "@/modules/events/domain/schedule";
import type { PublicEventPage } from "@/modules/events/repository";
import { readBibDesign } from "@/modules/registrations/bib-design";
import { dayIn } from "@/modules/registrations/domain/age";
import type { EditableEvent, EditableTranslation } from "./repository";

/**
 * The shape the public page and the listing card render, assembled from the editable rows — for
 * the staff preview of a saved draft (BR-REQ-051-02) and the editor's preview before saving (§579),
 * which hands it the rows the save would leave (`service.ts#draftEvent`). One mapping, so the two
 * previews cannot draw an event differently from each other or from the page.
 *
 * Written out field by field rather than spread from the two rows, so a column added to `events`
 * or `event_translations` cannot arrive on a public component by accident — the public queries
 * name their columns for the same reason (BR-REQ-070-01).
 */
export function previewPageOf(event: EditableEvent, translation: EditableTranslation): PublicEventPage {
  // The place not announced yet (§328) is withheld here exactly as the public query withholds it,
  // so the preview shows the sentence the page will show — including the programme rows' places.
  const placeLater = event.locationToBeAnnounced;
  // The start not announced yet (§533) — its date, or only its time — withheld the same way: the
  // preview says «Data se anunță» or the day with «Ora se anunță», as the page will.
  const dateLater = event.dateToBeAnnounced || event.timeToBeAnnounced;
  const dayOnly = event.timeToBeAnnounced && !event.dateToBeAnnounced ? dayIn(event.startsAt, event.timezone) : null;
  return {
    id: event.id,
    type: event.type,
    surface: event.surface,
    eventStatus: event.eventStatus,
    startsAt: dateLater ? null : event.startsAt,
    endsAt: dateLater ? null : event.endsAt,
    raceStartsAt: dateLater ? null : event.raceStartsAt,
    dateToBeAnnounced: event.dateToBeAnnounced,
    timeToBeAnnounced: event.timeToBeAnnounced,
    announcedDay: dayOnly,
    timezone: event.timezone,
    mapUrl: placeLater ? null : event.mapUrl,
    // «Coordonate» (§416): withheld with the place, as the public query withholds them.
    latitude: placeLater ? null : event.latitude,
    longitude: placeLater ? null : event.longitude,
    routeUrl: event.routeUrl,
    stravaEventUrl: event.stravaEventUrl,
    facebookEventUrl: event.facebookEventUrl,
    featured: event.featured,
    distanceMeters: event.distanceMeters,
    // «Aproximativ» (§598): the same pills as the page, so the preview says «≈ 10 km» the same way.
    distanceEstimated: event.distanceEstimated,
    elevationGainMeters: event.elevationGainMeters,
    // «Estimativ» (§585): the preview draws the same pills as the page, so it says «≈» the same way.
    elevationGainEstimated: event.elevationGainEstimated,
    nightOverride: event.nightOverride,
    offersGroupRunDeclaration: event.offersGroupRunDeclaration,
    registrationMode: event.registrationMode,
    registrationOpensAt: event.registrationOpensAt,
    registrationOpensSoon: event.registrationOpensSoon,
    registrationClosesAt: event.registrationClosesAt,
    kitShirt: event.kitShirt,
    askHealthNote: event.askHealthNote,
    // The members' race number (§664): the draft's own switch, read as the page reads the saved one.
    offersMemberBib: readBibDesign(event.bibDesign).member.enabled,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
    minAge: event.minAge,
    reminderHoursBefore: event.reminderHoursBefore,
    updatedAt: event.updatedAt,
    externalRegistrationUrl: event.externalRegistrationUrl,
    externalProvider: event.externalProvider,
    participantListVisibility: event.participantListVisibility,
    waitlistPublic: event.waitlistPublic,
    // «Arată public câți așteaptă» (§634): the preview's door says the count only as the page would.
    waitlistCountPublic: event.waitlistCountPublic,
    // «Lista ascunsă» (§647): the preview's «Cine vine» counts as the page would.
    hiddenListEnabled: event.hiddenListEnabled,
    participantCountPublic: event.participantCountPublic,
    hiddenListCounted: event.hiddenListCounted,
    // The place's name in this language (§362), else the event's, exactly as `PUBLIC_COLUMNS`
    // reads it — one rule, `placeNameIn`; the address and the rest from the event row (§36).
    locationName: placeLater ? null : placeNameIn(event, translation.locationName),
    locationAddress: placeLater ? null : event.locationAddress,
    locationToBeAnnounced: placeLater,
    difficultyLevel: event.difficultyLevel,
    costType: event.costType,
    costAmount: event.costAmount,
    costUrl: event.costUrl,
    slug: translation.slug,
    title: translation.title,
    excerpt: translation.excerpt,
    excerptJson: translation.excerptJson,
    bodyJson: translation.bodyJson,
    rulesJson: translation.rulesJson,
    scheduleJson: translation.scheduleJson,
    routeDescriptionJson: translation.routeDescriptionJson,
    checklist: translation.checklist,
    discountNote: translation.discountNote,
    // No programme while the start is held back (§533): its rows are instants, as on the page.
    scheduleItems: dateLater ? null : placeLater ? withoutPlaces(event.scheduleItems) : event.scheduleItems,
    coHosts: event.coHosts,
    coHostName: event.coHostName,
    coHostUrl: event.coHostUrl,
    links: event.links,
    isSpecial: event.isSpecial,
    // For the members alone (§552): the staff preview shows it as a member will see it.
    membersOnly: event.membersOnly,
    seoTitle: translation.seoTitle,
    seoDescription: translation.seoDescription,
    publishedAt: event.publishedAt,
  };
}
