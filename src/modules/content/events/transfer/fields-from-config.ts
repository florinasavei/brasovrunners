import { coordinatesText } from "@/modules/weather/domain/place";
import { difficultyBandOf, difficultyStepOf } from "@/modules/events/domain/difficulty";
import { routeMapFieldValue, type RouteMap } from "@/modules/events/domain/route-maps";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import type { RouteGpx } from "@/modules/events/domain/route-gpx";
import { readBadgeDesign } from "@/modules/volunteers/badges/badge-design";
import { DomainError } from "@/shared/errors/domain-error";
import type { EventConfig, TranslationConfig } from "./file-format";

/**
 * A configuration back into what the editor posts (§751): the same names, the same strings, the same
 * empty-means-not-stated, so the import goes through the editor's own validation
 * (`eventFieldsSchema`, `translationFieldsSchema`) and its own save, and a value the editor would
 * refuse is refused here for the same sentence. Nothing is written by this file and nothing is checked
 * by it either, beyond what it cannot express: a programme row that ends on another day than it starts
 * (the editor's row has one date).
 *
 * The inverse of `export.ts#configFromRows`, which a test holds it to: export, import as new, export
 * again gives the same configuration.
 */

export type PostedFieldsContext = {
  /** The configuration with its pictures already this environment's own (`import.ts#resolveMedia`). */
  config: EventConfig;
  /** The cover's stored picture: its id, null for none, `undefined` to leave the event's own alone. */
  coverAssetId: string | null | undefined;
  /** The GPX in the store: the object, null for none, `undefined` to leave the event's own alone. */
  routeGpx: RouteGpx | null | undefined;
  /** This environment's id of the declaration version in force for the file's key, or null. */
  declarationDocumentId: string | null;
  /** An import never moves what the site leads with: the target's own flag, false on a new event. */
  featured: boolean;
  /** Left out entirely when it equals what the event holds (a null column stays null). */
  includeBibDesign: boolean;
  /** The volunteer badges' design (§NNN), by the same rule: left out when it equals what the event holds. */
  includeBadgeDesign?: boolean;
  /** The public list's switch as it is to be stored — the file's, or off where the notice that describes it is not in force. */
  participantListNames: boolean;
  /** The event's status as it stands: never imported, a cancellation being its own act (§331). */
  eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED";
};

const asText = (value: string | null | undefined) => value ?? "";
const asNumber = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));
const asDocument = (document: Record<string, unknown> | null) => (document ? JSON.stringify(document) : "");

/** The programme's rows as the editor posts them: a date, a time, an end on the same day. */
function scheduleRowsOf(config: EventConfig) {
  return config.programme.map((item, index) => {
    const starts = toWallTimeInput(new Date(item.startsAt), config.timezone);
    const ends = item.endsAt ? toWallTimeInput(new Date(item.endsAt), config.timezone) : null;
    if (ends && ends.slice(0, 10) !== starts.slice(0, 10)) {
      throw new DomainError("VALIDATION_ERROR", `scheduleRows.${index}.endTime: a programme row ends on another day than it starts`, [`scheduleRows.${index}.endTime`]);
    }
    return { date: starts.slice(0, 10), time: starts.slice(11), endTime: ends ? ends.slice(11) : "", ro: item.label.ro, en: item.label.en, place: asText(item.place) };
  });
}

/** The start's one posted value from its two boxes: whole, the date alone, `THH:mm`, or empty (`readStartBoxes`). */
function startWallTime(start: EventConfig["start"]): string {
  if (start.date && start.time) return `${start.date}T${start.time}`;
  return start.date ?? (start.time ? `T${start.time}` : "");
}

const wall = (iso: string | null, timezone: string) => (iso ? toWallTimeInput(new Date(iso), timezone) : "");

/** One map's box, as the editor shows it and a save reads it back to the same map. */
const mapBox = (config: EventConfig, provider: RouteMap["provider"]) =>
  routeMapFieldValue(config.route.maps.find((map) => map.provider === provider) as RouteMap | undefined);

/** The event's fields, as `eventFieldsSchema` reads them. */
export function eventFieldsFromConfig(context: PostedFieldsContext): Record<string, unknown> {
  const { config } = context;
  const level = config.difficultyLevel;
  return {
    type: config.type,
    surface: config.surface ?? "",
    eventStatus: context.eventStatus,
    timezone: config.timezone,
    startsAtWallTime: startWallTime(config.start),
    endsAtWallTime: "",
    durationMinutes: config.durationMinutes === null ? "" : String(config.durationMinutes),
    raceStartsAtWallTime: config.type === "RACE" ? wall(config.raceStartsAt, config.timezone) : "",
    scheduleRows: scheduleRowsOf(config),
    locationName: asText(config.place.name.ro),
    locationNameEn: asText(config.place.name.en),
    locationAddress: asText(config.place.address),
    locationToBeAnnounced: config.place.toBeAnnounced,
    dateToBeAnnounced: config.dateToBeAnnounced,
    timeToBeAnnounced: config.timeToBeAnnounced,
    difficulty: level === null ? "" : difficultyBandOf(level),
    difficultyStep: level === null ? "" : difficultyStepOf(level),
    costType: config.cost.type ?? "",
    costAmount: asText(config.cost.amount),
    costUrl: asText(config.cost.url),
    mapUrl: asText(config.place.mapUrl),
    coordinates: config.place.coordinates ? coordinatesText(config.place.coordinates) : "",
    routeUrl: asText(config.route.url),
    routeStrava: mapBox(config, "strava"),
    routeGarmin: mapBox(config, "garmin"),
    ...(context.routeGpx === undefined ? {} : { routeGpx: context.routeGpx ? JSON.stringify(context.routeGpx) : "" }),
    stravaEventUrl: asText(config.stravaEventUrl),
    facebookEventUrl: asText(config.facebookEventUrl),
    coHosts: config.partners.map((partner) => ({
      name: partner.name,
      descriptionRo: asText(partner.descriptionRo),
      descriptionEn: asText(partner.descriptionEn),
      links: partner.links.map((link) => ({ kind: link.kind, url: link.url, labelRo: asText(link.labelRo), labelEn: asText(link.labelEn) })),
    })),
    links: config.links.map((link) => ({ kind: link.kind, url: link.url, labelRo: asText(link.labelRo), labelEn: asText(link.labelEn) })),
    distanceMeters: asNumber(config.measures.distanceMeters),
    distanceEstimated: config.measures.distanceEstimated,
    elevationGainMeters: asNumber(config.measures.elevationGainMeters),
    elevationGainEstimated: config.measures.elevationGainEstimated,
    nightOverride: config.nightOverride,
    weatherMode: config.weather.mode,
    offersGroupRunDeclaration: config.offersGroupRunDeclaration,
    featured: context.featured,
    isSpecial: config.isSpecial,
    ...(context.coverAssetId === undefined
      ? {}
      : { coverAssetId: context.coverAssetId ?? "", coverCrop: context.coverAssetId && config.cover?.crop ? config.cover.crop : "" }),
    membersOnly: config.membersOnly,
    registrationMode: config.registration.mode,
    capacity: asNumber(config.registration.capacity),
    waitlistMode: config.registration.waitlist.choice,
    waitlistCapacity: asNumber(config.registration.waitlist.limit),
    kitShirt: config.registration.kitShirt,
    waitlistAutoOffer: config.registration.waitlistAutoOffer,
    askHealthNote: config.registration.askHealthNote,
    bibStartNumber: String(config.bib.startNumber),
    bibColour: asText(config.bib.colour),
    ...(context.includeBibDesign ? { bibDesign: config.bib.design } : {}),
    // Read through the one forgiving reader first: a key a later release added is left out, never a refusal of the file.
    ...(context.includeBadgeDesign ? { badgeDesign: readBadgeDesign(config.badges.design) } : {}),
    confirmationOpensDaysBefore: String(config.registration.confirmationOpensDaysBefore),
    confirmationDeadlineDaysBefore: String(config.registration.confirmationDeadlineDaysBefore),
    minAge: String(config.registration.minAge),
    reminderHoursBefore: asNumber(config.registration.reminderHoursBefore),
    registrationOpensAtWallTime: wall(config.registration.opensAt, config.timezone),
    registrationOpensSoon: config.registration.opensSoon,
    registrationClosesAtWallTime: wall(config.registration.closesAt, config.timezone),
    declarationDocumentId: context.declarationDocumentId ?? "",
    participantListVisibility: context.participantListNames ? "NAMES" : "HIDDEN",
    waitlistPublic: context.participantListNames && config.publicList.waitlist,
    waitlistCountPublic: config.publicList.waitlistCount,
    participantCountPublic: config.publicList.count,
    publicListClub: config.publicList.club,
    hiddenListEnabled: config.hiddenList.enabled,
    hiddenListBibStart: asNumber(config.hiddenList.bibStart),
    hiddenListCounted: config.hiddenList.counted,
    hiddenListPublic: config.hiddenList.public,
    externalProvider: asText(config.registration.external.provider),
    externalRegistrationUrl: asText(config.registration.external.url),
  };
}

/** One language's fields, as `translationFieldsSchema` reads them; `slug` is the caller's (suffixed, or kept on a published event). */
export function translationFieldsFromConfig(row: TranslationConfig, slug: string): Record<string, unknown> {
  return {
    slug,
    title: row.title,
    excerpt: asText(row.excerpt),
    excerptBody: asDocument(row.excerptBody),
    checklist: asText(row.checklist),
    body: asDocument(row.body),
    rules: asDocument(row.rules),
    schedule: asDocument(row.schedule),
    routeDescription: asDocument(row.routeDescription),
    seoTitle: asText(row.seoTitle),
    seoDescription: asText(row.seoDescription),
    discountNote: asText(row.discountNote),
    weatherNote: asText(row.weatherNote),
  };
}
