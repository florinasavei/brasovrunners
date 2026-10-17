import { eq } from "drizzle-orm";
import { legalDocuments } from "@/db/schema/legal-documents";
import { events } from "@/db/schema/events";
import type { Database } from "@/db/types";
import { buildInfo } from "@/shared/config/build-info";
import { env } from "@/shared/config/env";
import { DomainError } from "@/shared/errors/domain-error";
import { recordAuditEvent } from "@/modules/audit/repository";
import { readRichText, hasRichTextContent } from "@/modules/content/rich-text/domain/schema";
import { readTeamPhotoCrop } from "@/modules/content/team/photo-crop";
import { readCoHosts } from "@/modules/events/domain/co-hosts";
import { difficultyLevelOf } from "@/modules/events/domain/difficulty";
import { readEventLinks } from "@/modules/events/domain/links";
import { startBoxValues } from "@/modules/events/domain/provisional-start";
import { readRepeatRule } from "@/modules/events/domain/repeat";
import { readRouteGpx } from "@/modules/events/domain/route-gpx";
import { readRouteMaps } from "@/modules/events/domain/route-maps";
import { readScheduleItems } from "@/modules/events/domain/schedule";
import { placeNameIn } from "@/modules/events/domain/place";
import { isRaceDeclarationKey, type RaceDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { readBibDesign } from "@/modules/registrations/bib-design";
import { readBadgeDesign } from "@/modules/volunteers/badges/badge-design";
import { effectiveMinimumAge } from "@/modules/registrations/domain/age";
import { canTransferEvents } from "@/modules/staff-identity/domain/roles";
import type { StaffUser } from "@/db/schema/staff-users";
import { readWeatherMode } from "@/modules/weather/domain/mode";
import { getStorage, type Storage } from "@/modules/media/storage";
import { waitlistChoiceOf } from "../waitlist-choice";
import { eventDurationMinutes } from "../duration";
import { type Checkpoint, sortedByKm } from "@/modules/event-checkpoints/domain/checkpoint";
import { listCheckpoints } from "@/modules/event-checkpoints/checkpoints";
import { type EditableEvent, type EditableTranslation, findCoverPicture, listTranslationsForEvent } from "../repository";
import {
  EVENT_FILE_FORMAT,
  EVENT_FILE_VERSION,
  type EventConfig,
  type EventFile,
  MAX_EVENT_FILE_BYTES,
  MAX_EVENT_FILE_MEDIA,
  serializeEventFile,
  type TranslationConfig,
} from "./file-format";
import { collectMediaRefs, describeMedia, mapMediaUrls, readStoredMedium } from "./media";
import { readVolunteersFile } from "./volunteers";

/**
 * Taking an event out as a JSON file (§751).
 *
 * `configFromRows` is the whole of what an event *is* for the file — a pure function of the event's
 * rows, the same one that reads the *target* of an import over an event, so the diff compares like
 * with like and a round trip (export, import as new, export) is the same configuration. What it does
 * not read is as much the point: no registration, invitation, participant, volunteer, to-do, audit row,
 * staff member or email address is reachable from here, and nothing keyed by an id that means
 * something in one database only. Nor the tick «Primește voluntari» (§754): a copy of an event starts with the
 * tick off, like the to-dos. The volunteers' **categories and roles** are the file's own key beside the event
 * (`volunteers`, §774, `volunteers.ts`): their words and the category contact the club published, never a person,
 * and applied only to an event made new — the diff and an import over an event leave them where they are.
 */

type Actor = Pick<StaffUser, "id" | "role">;

const doc = (stored: unknown): Record<string, unknown> | null => {
  if (stored === null || stored === undefined) return null;
  const read = readRichText(stored);
  return hasRichTextContent(read) ? (read as unknown as Record<string, unknown>) : null;
};

const textOrNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function translationConfig(row: EditableTranslation | undefined): TranslationConfig {
  return {
    slug: row?.slug ?? "",
    title: row?.title ?? "",
    excerpt: textOrNull(row?.excerpt),
    excerptBody: doc(row?.excerptJson),
    checklist: textOrNull(row?.checklist),
    body: doc(row?.bodyJson),
    rules: doc(row?.rulesJson),
    schedule: doc(row?.scheduleJson),
    routeDescription: doc(row?.routeDescriptionJson),
    seoTitle: textOrNull(row?.seoTitle),
    seoDescription: textOrNull(row?.seoDescription),
    discountNote: textOrNull(row?.discountNote),
    weatherNote: textOrNull(row?.weatherNote),
  };
}

/** What the rows cannot say by themselves: the three things that live behind an id or a store. */
export type ConfigContext = {
  /** The declaration's legal document key, resolved from `declaration_document_id`. */
  declarationKey: RaceDeclarationKey | null;
  /** The cover picture's public address, or null. */
  coverUrl: string | null;
  /** The GPX's public address, or null. */
  gpxUrl: string | null;
  /** Turns a site-relative picture address (`/api/media/…`, the developer's modes) into an absolute one. */
  absolute: (src: string) => string;
  /** The route's checkpoints (§757), a table of their own; none when the caller read none. */
  checkpoints?: readonly Checkpoint[];
};

/** The event's configuration, exactly as the file and the diff both read it. */
export function configFromRows(event: EditableEvent, rows: readonly EditableTranslation[], context: ConfigContext): EventConfig {
  const row = (locale: "ro" | "en") => rows.find((entry) => entry.locale === locale);
  const start = startBoxValues(event.startsAt, event.timezone);
  const gpx = readRouteGpx(event.routeGpx);
  const crop = readTeamPhotoCrop(event.coverCrop);
  const cover = event.coverMediaAssetId && context.coverUrl ? { url: context.coverUrl, crop: crop === "invalid" ? null : crop } : null;
  const config: EventConfig = {
    type: event.type,
    surface: event.surface,
    timezone: event.timezone,
    start: { date: start.date || null, time: start.time || null },
    // From the gun on a race that has one (§757, `durationBase`): the box the import posts back, so the end comes back the same.
    durationMinutes: eventDurationMinutes(event),
    raceStartsAt: event.raceStartsAt?.toISOString() ?? null,
    dateToBeAnnounced: event.dateToBeAnnounced,
    timeToBeAnnounced: event.timeToBeAnnounced,
    programme: readScheduleItems(event.scheduleItems),
    place: {
      name: { ro: placeNameIn(event, row("ro")?.locationName), en: placeNameIn(event, row("en")?.locationName) },
      address: textOrNull(event.locationAddress),
      toBeAnnounced: event.locationToBeAnnounced,
      mapUrl: event.mapUrl,
      coordinates: event.latitude !== null && event.longitude !== null ? { latitude: event.latitude, longitude: event.longitude } : null,
    },
    weather: { mode: readWeatherMode(event.weatherMode) },
    route: {
      url: event.routeUrl,
      maps: readRouteMaps(event.routeMaps) as unknown as Array<Record<string, unknown>>,
      gpx: gpx && context.gpxUrl ? { name: gpx.name, url: context.gpxUrl } : null,
      showRouteProfile: event.showRouteProfile,
      // By distance, the order every reader draws them in; no id — a row means something in one database only.
      checkpoints: sortedByKm(context.checkpoints ?? []).map((row) => ({
        km: row.km,
        name: { ro: row.nameRo, en: row.nameEn },
        kinds: [...row.kinds],
        cutoffMinutes: row.cutoffMinutes,
        note: { ro: row.noteRo, en: row.noteEn },
        onProfile: row.onProfile,
      })),
    },
    links: readEventLinks(event.links),
    partners: readCoHosts(event),
    stravaEventUrl: event.stravaEventUrl,
    facebookEventUrl: event.facebookEventUrl,
    measures: {
      distanceMeters: event.distanceMeters,
      distanceEstimated: event.distanceEstimated,
      elevationGainMeters: event.elevationGainMeters,
      elevationGainEstimated: event.elevationGainEstimated,
    },
    difficultyLevel: difficultyLevelOf(event),
    nightOverride: event.nightOverride,
    cost: { type: event.costType, amount: event.costAmount, url: event.costUrl },
    offersGroupRunDeclaration: event.offersGroupRunDeclaration,
    isSpecial: event.isSpecial,
    membersOnly: event.membersOnly,
    cover,
    registration: {
      mode: event.registrationMode,
      capacity: event.capacity,
      waitlist: { choice: waitlistChoiceOf(event.waitlistCapacity), limit: event.waitlistCapacity !== null && event.waitlistCapacity > 0 ? event.waitlistCapacity : null },
      waitlistAutoOffer: event.waitlistAutoOffer,
      opensAt: event.registrationOpensAt?.toISOString() ?? null,
      opensSoon: event.registrationOpensSoon,
      closesAt: event.registrationClosesAt?.toISOString() ?? null,
      confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
      confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
      // As it binds (§515): a row stored under the floor reads as the floor, the value the editor accepts back.
      minAge: effectiveMinimumAge(event.minAge),
      reminderHoursBefore: event.reminderHoursBefore,
      declaration: context.declarationKey ? { key: context.declarationKey } : null,
      external: { provider: event.externalProvider, url: event.externalRegistrationUrl },
      kitShirt: event.kitShirt,
      askHealthNote: event.askHealthNote,
    },
    publicList: {
      names: event.participantListVisibility === "NAMES",
      waitlist: event.waitlistPublic,
      waitlistCount: event.waitlistCountPublic,
      count: event.participantCountPublic,
      club: event.publicListClub,
    },
    hiddenList: { enabled: event.hiddenListEnabled, bibStart: event.hiddenListBibStart, counted: event.hiddenListCounted, public: event.hiddenListPublic },
    bib: { startNumber: event.bibStartNumber, colour: event.bibColour, design: readBibDesign(event.bibDesign) as unknown as Record<string, unknown> },
    // The volunteer badges' look (§764), never a volunteer nor a role: as `readBadgeDesign` answers.
    badges: { design: readBadgeDesign(event.badgeDesign) as unknown as Record<string, unknown> },
    translations: { ro: translationConfig(row("ro")), en: translationConfig(row("en")) },
  };
  // Every picture's address absolute, so the file reads the same wherever it is opened.
  return mapMediaUrls(config, (url) => (url.startsWith("/") ? context.absolute(url) : url));
}

/** The storage when this environment has one; a deployed environment without a bucket has no pictures to name. */
function storageOrNull(): Storage | null {
  try {
    return getStorage();
  } catch {
    return null;
  }
}

/** The facts the rows hold behind ids and keys, read once. */
export async function readConfigContext<T extends Record<string, unknown>>(db: Database<T>, event: EditableEvent): Promise<ConfigContext> {
  const storage = storageOrNull();
  let declarationKey: RaceDeclarationKey | null = null;
  if (event.declarationDocumentId) {
    const [document] = await db.select({ key: legalDocuments.key }).from(legalDocuments).where(eq(legalDocuments.id, event.declarationDocumentId)).limit(1);
    declarationKey = document && isRaceDeclarationKey(document.key) ? document.key : null;
  }
  const cover = event.coverMediaAssetId ? await findCoverPicture(db, event.coverMediaAssetId).catch(() => null) : null;
  const gpx = readRouteGpx(event.routeGpx);
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  return {
    declarationKey,
    coverUrl: cover ? (cover.webUrl.startsWith("/") ? `${base}${cover.webUrl}` : cover.webUrl) : null,
    gpxUrl: gpx && storage ? storage.publicUrl(gpx.key) : null,
    absolute: (src) => `${base}${src}`,
    checkpoints: await listCheckpoints(db, event.id),
  };
}

/** The event's configuration as it stands in this database, for the file and for the diff of an import over it. */
export async function readEventConfig<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ event: EditableEvent; translations: EditableTranslation[]; config: EventConfig } | null> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return null;
  const translations = await listTranslationsForEvent(db, eventId);
  return { event, translations, config: configFromRows(event, translations, await readConfigContext(db, event)) };
}

export type ExportEventInput = { actor: Actor; eventId: string; now?: Date };

/**
 * One event as a file (§751): the Administrator's, asserted here on the server whatever button the
 * editor showed, and recorded — who, which event, the version and how many media the file names.
 *
 * The media are named with the size and the hash of what this environment's store holds, read now; an
 * object the store cannot answer is named without them, so the importing side lists it as one it
 * could not verify instead of copying something unchecked.
 */
export async function exportEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: ExportEventInput,
): Promise<{ file: EventFile; fileName: string }> {
  if (!canTransferEvents(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not export an event`);
  }
  const now = input.now ?? new Date();
  const read = await readEventConfig(db, input.eventId);
  if (!read) throw new DomainError("NOT_FOUND", "no such event");

  const storage = storageOrNull();
  const refs = collectMediaRefs(read.config);
  const media = await describeMedia(refs, async (ref) => (storage ? readStoredMedium(storage, ref) : null));
  // A file this release could not read back is not made: said now, not at the other site.
  if (media.length > MAX_EVENT_FILE_MEDIA) {
    throw new DomainError("VALIDATION_ERROR", `the event names ${media.length} pictures and files; a file takes at most ${MAX_EVENT_FILE_MEDIA}`);
  }
  const rule = readRepeatRule(read.event.repeatRule);
  const file: EventFile = {
    format: EVENT_FILE_FORMAT,
    version: EVENT_FILE_VERSION,
    exportedAt: now.toISOString(),
    exportedFrom: { environment: env.APP_ENV, baseline: buildInfo.baseline },
    series: {
      partOfASeries: read.event.repeatRule !== null || read.event.repeatOf !== null,
      rule: rule ? { cadence: rule.cadence, weekdays: rule.weekdays, until: rule.until } : null,
    },
    event: read.config,
    // The volunteers' categories and roles (§774): their words and the contact the club published, never a person.
    volunteers: await readVolunteersFile(db, input.eventId),
    media,
  };
  const bytes = Buffer.byteLength(serializeEventFile(file));
  if (bytes > MAX_EVENT_FILE_BYTES) {
    throw new DomainError("VALIDATION_ERROR", `the event's file would be ${Math.round(bytes / 1000)} KB; a file takes at most ${Math.round(MAX_EVENT_FILE_BYTES / 1000)} KB`);
  }

  await recordAuditEvent(db, {
    actorStaffUserId: input.actor.id,
    action: "event.exported",
    entityType: "event",
    entityId: input.eventId,
    metadata: { version: EVENT_FILE_VERSION, media: media.length },
    now,
  });

  const slug = read.config.translations.ro.slug || read.config.translations.en.slug || "event";
  return { file, fileName: `${slug}-${now.toISOString().slice(0, 10)}.json` };
}
