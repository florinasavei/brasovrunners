import { and, eq, gt, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { eventTranslations, events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";
import { startHeldBack } from "@/modules/events/domain/dated";
import { readCoHosts } from "@/modules/events/domain/co-hosts";
import { costPaidToExternalOrganizer, type EventCostType } from "@/modules/events/domain/cost";
import { difficultyLevel, storedDifficulty } from "@/modules/events/domain/difficulty";
import { EVENT_NOTICE_TEXT_MAX, type EventChangeKind, eventChangesToAnnounce, eventNoticeTextSchema } from "@/modules/events/domain/event-changes";
import { EVENT_TYPES, type EventType, hasProgramme, takesRegistrations } from "@/modules/events/domain/event-type";
import { englishNameAfterSave, PLACE_NAME_FIELD, type PlaceNameField, placeNameIn, placeShown } from "@/modules/events/domain/place";
import { queueEventCancelledNotices, queueEventUpdateNotices } from "@/modules/notifications/event-notices";
import {
  horizonEnd,
  occurrencesBetween,
  readRepeatRule,
  type RepeatCadence,
  type RepeatRule,
  repeatRuleSchema,
  untilEnd,
  WEEKDAYS,
  type Weekday,
} from "@/modules/events/domain/repeat";
import { readScheduleItems, type ScheduleItem, shiftScheduleItems } from "@/modules/events/domain/schedule";
import { addWallClockInterval, fromWallTimeInput, toWallTimeInput, wallClockWeekday } from "@/modules/events/domain/zoned-time";
import { recordAuditEvent } from "@/modules/audit/repository";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { wakeJobs } from "@/modules/jobs/schedule-cache";
import { findCurrentApprovedVersionId } from "@/modules/legal-documents/repository";
import { groupRunDeclarationKeyFor } from "@/modules/legal-documents/domain/keys";
import { deleteGroupRunDeclarationMessagesOfEvent, rehomeGroupRunDeclarationsOfEvent } from "@/modules/group-run-declarations/repository";
import { eraseAllRegistrationsOfEvent } from "@/modules/registrations/admin-service";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import { countOccupied, countRegistrationsForEvent, countTestRegistrationsForEvent, lockEventForCapacity } from "@/modules/registrations/repository";
import { areTestRegistrationsAvailable, removeTestRegistrations } from "@/modules/registrations/test-registrations";
import { effectiveMinimumAge } from "@/modules/registrations/domain/age";
import { fillAvailableSpots } from "@/modules/registrations/service";
import {
  canCreateEvent,
  canDeleteEvent,
  canEditEventFields,
  canHardDeleteEvent,
  canEditTranslation,
  canTransitionEvent,
  type EditorialStatus,
  isLiveContent,
} from "@/modules/staff-identity/domain/roles";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { resolveStart, type StartSwitches } from "./start";
import { isBlankValue } from "@/shared/forms/blank-value";
import { type BilingualText, isWrittenText, missingLanguage, type TextLanguage } from "@/shared/forms/both-languages";
import { hasRichTextContent, parseRichText, type RichTextDoc, richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
import { attachYoutubePosters } from "@/modules/media/video-poster";
import {
  type EventFieldsInput,
  eventFieldsSchema,
  missingPublicFields,
  newEventSchema,
  type TranslationFields,
  translationFieldsSchema,
} from "./fields";
import {
  type EditableEvent,
  type EditableTranslation,
  findTakenSlugs,
  findTranslationById,
  findTranslationWithEventById,
  listTranslationsForEvent,
  readEventErasurePlan,
} from "./repository";

/**
 * Creating, editing, publishing and removing events (BR-REQ-050-01, BR-REQ-051-01). Priority-1
 * code (`docs/PRACTICES.md`). Three rules throughout:
 *
 *   1. Authorization is asserted here for every write (BR-REQ-060-01); the acting staff user is
 *      an argument, never a session read here.
 *   2. A save carries the version it was loaded with; a stale one is a CONFLICT and nothing is
 *      written (BR-REQ-051-01 criterion 5) — never last-write-wins.
 *   3. Publication is one state for the whole event and requires a complete translation in every
 *      locale (§28, BR-REQ-040-02).
 */

type Actor = Pick<StaffUser, "id" | "role">;

/**
 * The conflict check in one statement: `WHERE id = ? AND version = ?` with the version bumped in the
 * same UPDATE. Of two concurrent saves of version 4, the second blocks on the row lock, re-evaluates
 * its WHERE against the committed version 5, updates nothing and returns no row — so it is told its
 * copy is stale. A read-then-update in two statements would lose an edit under real concurrency.
 */
async function updateTranslationWithVersionGuard<T extends Record<string, unknown>>(
  db: Database<T>,
  translationId: string,
  expectedVersion: number,
  changes: Partial<typeof eventTranslations.$inferInsert>,
  now: Date,
): Promise<EditableTranslation> {
  const [updated] = await db
    .update(eventTranslations)
    .set({
      ...changes,
      version: sql`${eventTranslations.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(eq(eventTranslations.id, translationId), eq(eventTranslations.version, expectedVersion)),
    )
    .returning();

  if (updated) return updated;

  // Nothing was written: the row is gone, or somebody saved first — different answers for the caller.
  const current = await findTranslationById(db, translationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such event translation");

  throw new DomainError(
    "CONFLICT",
    `this translation was saved by someone else: you loaded version ${expectedVersion}, the current version is ${current.version}`,
  );
}

async function updateEventWithVersionGuard<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  expectedVersion: number,
  changes: Partial<typeof events.$inferInsert>,
  now: Date,
): Promise<EditableEvent> {
  const [updated] = await db
    .update(events)
    .set({ ...changes, version: sql`${events.version} + 1`, updatedAt: now })
    .where(and(eq(events.id, eventId), eq(events.version, expectedVersion)))
    .returning();

  if (updated) return updated;

  const [current] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such event");

  throw new DomainError(
    "CONFLICT",
    `this event was saved by someone else: you loaded version ${expectedVersion}, the current version is ${current.version}`,
  );
}

/**
 * Featuring an event un-features the previous one, in the caller's transaction. A partial unique
 * index is the guarantee; this clear keeps it from rejecting every save, and sharing the
 * transaction means never none featured and never a clear that survives a failed set.
 */
async function clearFeaturedExcept<T extends Record<string, unknown>>(
  tx: Database<T>,
  eventId: string | null,
  now: Date,
): Promise<void> {
  await tx
    .update(events)
    .set({ featured: false, updatedAt: now })
    .where(eventId === null ? eq(events.featured, true) : and(eq(events.featured, true), ne(events.id, eventId)));
}

/**
 * Every instant the form carries, resolved in the event's zone and checked against each other. The
 * CHECK constraints are what hold; this gives the organizer a sentence instead of a violation.
 */
type ResolvedTimes = {
  startsAt: Date;
  endsAt: Date | null;
  raceStartsAt: Date | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  /** The programme's rows with their instants, soonest first; empty for none (§117). */
  scheduleItems: ScheduleItem[];
};

/** The two switches as the save leaves them (§533): posted, else the row's; a new event starts announced. */
function switchesAfterSave(
  fields: Pick<EventFieldsInput, "dateToBeAnnounced" | "timeToBeAnnounced">,
  current: Pick<EditableEvent, "dateToBeAnnounced" | "timeToBeAnnounced"> | null,
): StartSwitches {
  return {
    dateToBeAnnounced: fields.dateToBeAnnounced ?? current?.dateToBeAnnounced ?? false,
    timeToBeAnnounced: fields.timeToBeAnnounced ?? current?.timeToBeAnnounced ?? false,
  };
}

function resolveTimes(fields: EventFieldsInput, switches: StartSwitches): ResolvedTimes {
  const zone = fields.timezone;

  // Every refusal here names its field (§47, §315).
  const required = (value: string, name: string): Date => {
    const parsed = fromWallTimeInput(value, zone);
    if (!parsed) throw new DomainError("VALIDATION_ERROR", `${name}: a date and time are required`, [name]);
    return parsed;
  };

  const optional = (value: string, name: string): Date | null => {
    const parsed = fromWallTimeInput(value, zone);
    if (value.trim() !== "" && !parsed) {
      throw new DomainError("VALIDATION_ERROR", `${name}: not a date and time`, [name]);
    }
    return parsed;
  };

  // Date and hour may be empty while to be announced (§533, §545): `resolveStart` stores provisional
  // parts and refuses an empty box the switches do not excuse (§47).
  const { startsAt, blank } = resolveStart(fields.startsAtWallTime, switches, zone);
  // A duration wins over an end time. A duration needs no hour, so it is kept whatever is blank; an
  // end on the clock is compared with the start, so it needs the start's date and hour.
  const endsAt =
    fields.durationMinutes != null
      ? new Date(startsAt.getTime() + fields.durationMinutes * 60_000)
      : optional(fields.endsAtWallTime, "endsAt");
  // A gun time is a race's (§71); on other types its hidden value is ignored.
  const raceStartsAt = fields.type === "RACE" ? optional(fields.raceStartsAtWallTime, "raceStartsAt") : null;
  // «Startul cursei» is compared with the start, so beside a blank date or hour it is refused on its
  // own box rather than compared with the provisional value (§545).
  if ((blank.date || blank.time) && raceStartsAt) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "raceStartsAt: the race's start needs the event's own date and hour first",
      ["raceStartsAt"],
    );
  }
  if ((blank.date || blank.time) && fields.durationMinutes == null && endsAt) {
    throw new DomainError("VALIDATION_ERROR", "endsAt: an end needs the event's own date and hour first", ["endsAt"]);
  }
  const registrationOpensAt = optional(fields.registrationOpensAtWallTime, "registrationOpensAt");
  const registrationClosesAt = optional(fields.registrationClosesAtWallTime, "registrationClosesAt");

  /**
   * The programme's rows (§117). A fully blank row is dropped, and so is one with only its date,
   * since the editor fills that in itself (§405). Otherwise a row needs a time and a label in both
   * languages; an end, when given, is on the same day at or after the start.
   */
  const scheduleItems = fields.scheduleRows
    .map((row, index) => {
      const blank = !row.time && !row.endTime && !row.ro && !row.en && !row.place;
      if (blank) return null;
      const name = `schedule[${index + 1}]`;
      // Paths name the row as the form posts it, zero-based (`scheduleRows.<i>.<box>`).
      const box = (which: string) => `scheduleRows.${index}.${which}`;
      if (!row.date || !row.time) {
        throw new DomainError("VALIDATION_ERROR", `${name}: a date and time are required`, [box(row.date ? "time" : "date")]);
      }
      const startsAt = required(`${row.date}T${row.time}`, box("time"));
      const endsAt = row.endTime ? required(`${row.date}T${row.endTime}`, box("endTime")) : null;
      if (endsAt && endsAt.getTime() < startsAt.getTime()) {
        throw new DomainError("VALIDATION_ERROR", `${name}: the end cannot be before the start`, [box("endTime")]);
      }
      if (!row.ro || !row.en) {
        throw new DomainError("VALIDATION_ERROR", `${name}: the label is needed in both languages`, [box(row.ro ? "en" : "ro")]);
      }
      return { startsAt: startsAt.toISOString(), endsAt: endsAt ? endsAt.toISOString() : null, label: { ro: row.ro, en: row.en }, place: row.place || null };
    })
    .filter((item): item is ScheduleItem => item !== null)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new DomainError("VALIDATION_ERROR", "endsAt: the event cannot end before it begins", ["endsAt"]);
  }
  if (raceStartsAt && raceStartsAt.getTime() < startsAt.getTime()) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "raceStartsAt: the race cannot start before the event begins",
      ["raceStartsAt"],
    );
  }
  if (raceStartsAt && endsAt && raceStartsAt.getTime() > endsAt.getTime()) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "raceStartsAt: the race cannot start after the event ends",
      ["raceStartsAt"],
    );
  }
  // «Se deschid în curând» (§451) and an opening date are two answers to one question: ask which.
  if (fields.registrationOpensSoon === true && registrationOpensAt) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "registrationOpensAt: an opening date and «opens soon» cannot both be set",
      ["registrationOpensAt"],
    );
  }
  // A start to be announced (§533) keeps registration at «în curând»: an opening date is refused.
  if (startHeldBack(fields) && registrationOpensAt) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "registrationOpensAt: registration cannot have an opening date while the event's date is to be announced",
      ["registrationOpensAt"],
    );
  }
  if (
    registrationOpensAt &&
    registrationClosesAt &&
    registrationClosesAt.getTime() < registrationOpensAt.getTime()
  ) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "registrationClosesAt: registration cannot close before it opens",
      ["registrationClosesAt"],
    );
  }

  return { startsAt, endsAt, raceStartsAt, registrationOpensAt, registrationClosesAt, scheduleItems };
}

/**
 * The combinations AGENTS.md §10.1 and §12.3 forbid, refused with a sentence. Each is also a CHECK
 * (the guarantee; this is the message), except the approved declaration on an internal event,
 * which lives in another table.
 */
/**
 * What «Data se anunță mai târziu» (§533) may not be switched on for: a series (a series is its
 * dates), or an event anybody registered for (hiding the date would be an untold postponement).
 * Checked only when the switch goes on; the series here, the registrations under the lock
 * (`assertNobodyRegisteredForUndated`).
 */
async function assertDateToBeAnnouncedAllowed<T extends Record<string, unknown>>(
  db: Database<T>,
  fields: EventFieldsInput,
  current: Pick<EditableEvent, "id" | "dateToBeAnnounced" | "timeToBeAnnounced" | "repeatRule" | "repeatOf"> | null,
): Promise<void> {
  if (!startHeldBack(fields)) return;
  // The refusal names the date's box when it is ticked, else the time's.
  const box = fields.dateToBeAnnounced === true ? "dateToBeAnnounced" : "timeToBeAnnounced";
  // The listing leads with a dated event (§470); featuring an undated one would unfeature that one.
  if (fields.featured) {
    throw new DomainError("VALIDATION_ERROR", "featured: an event whose start is to be announced cannot lead the listing", ["featured"]);
  }
  if (current && startHeldBack(current)) return;
  if (current && (current.repeatRule !== null || current.repeatOf !== null)) {
    throw new DomainError("VALIDATION_ERROR", `${box}: a date of a series cannot be announced later`, [box]);
  }
}

/**
 * Nobody may be registered when the switch goes on (§533), counted behind the event row's lock that
 * every submission takes (and under which `submitRegistration` re-reads the flag), so a concurrent
 * «Trimite» is either counted here or refused there.
 */
async function assertNobodyRegisteredForUndated<T extends Record<string, unknown>>(
  tx: Database<T>,
  fields: EventFieldsInput,
  current: Pick<EditableEvent, "id" | "dateToBeAnnounced" | "timeToBeAnnounced">,
): Promise<void> {
  if (!startHeldBack(fields) || startHeldBack(current)) return;
  const box = fields.dateToBeAnnounced === true ? "dateToBeAnnounced" : "timeToBeAnnounced";
  await lockEventForCapacity(tx, current.id);
  if ((await countRegistrationsForEvent(tx, current.id)) > 0) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `${box}: people are registered for this date; give the new start and tell them, or cancel the event`,
      [box],
    );
  }
}

async function assertCoherentRegistrationBlock<T extends Record<string, unknown>>(
  db: Database<T>,
  fields: EventFieldsInput,
  now: Date,
): Promise<void> {
  // Every refusal names its boxes (§47, §315).
  if (fields.registrationMode !== "INTERNAL") {
    // The waiting-list cap (§348) belongs with the places: refused with the capacity's sentence.
    const waitlistCapacitySet = fields.waitlistCapacity !== undefined && fields.waitlistCapacity !== null;
    if (fields.capacity !== null || waitlistCapacitySet || fields.declarationDocumentId !== null) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "capacity, a waiting-list length and a declaration belong to an event that takes registrations here; set the mode to INTERNAL or clear them",
        [
          "registrationMode",
          ...(fields.capacity !== null ? ["capacity"] : []),
          ...(waitlistCapacitySet ? ["waitlistCapacity"] : []),
          ...(fields.declarationDocumentId !== null ? ["declarationDocumentId"] : []),
        ],
      );
    }
  } else if (fields.declarationDocumentId === null) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "an event that takes registrations must name the approved declaration a participant signs",
      ["declarationDocumentId"],
    );
  }

  if (fields.participantListVisibility === "NAMES") {
    if (fields.registrationMode !== "INTERNAL") {
      // NONE has nobody to list; EXTERNAL's entrants are the other organizer's (BR-REQ-039-01).
      throw new DomainError(
        "VALIDATION_ERROR",
        "a start list can only be published for an event that takes registrations here",
        ["participantListVisibility"],
      );
    }

    /**
     * The public list must not be switched on before an approved privacy notice describes it
     * (AGENTS.md §10.10, §32, §346). "In force" as `legal-documents/service.ts` means it — approved,
     * effective, not withdrawn — by key alone, since publication needs both languages anyway (§28).
     */
    if (!(await findCurrentApprovedVersionId(db, "PRIVACY_NOTICE", now))) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "the participant list cannot be published before an approved, effective privacy notice describes the disclosure",
        ["participantListVisibility"],
      );
    }
  }

  if (fields.registrationMode === "EXTERNAL") {
    if (fields.externalRegistrationUrl === null) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "an externally registered event needs the organizer's registration link",
        ["externalRegistrationUrl"],
      );
    }
  } else if (fields.externalRegistrationUrl !== null || fields.externalProvider !== null) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "the external provider and link belong to an event registered elsewhere; set the mode to EXTERNAL or clear them",
      ["registrationMode", ...(fields.externalProvider !== null ? ["externalProvider"] : []), ...(fields.externalRegistrationUrl !== null ? ["externalRegistrationUrl"] : [])],
    );
  }
}

/** The cost type a create stores when given none (§398); `createEvent` gates the discount note on the same value. */
const COST_TYPE_ON_CREATE: EventCostType = "FREE";

/** The columns of `events` a form writes, in one place, so create and save cannot drift. */
function eventColumnsFrom(fields: EventFieldsInput, times: ResolvedTimes, options?: { isCreate?: boolean }) {
  return {
    type: fields.type,
    surface: fields.surface,
    // The level of fifteen (§526) from band and step; the retired `difficulty` column gets a
    // best-effort word for the previous release.
    ...storedDifficulty(fields.difficulty ? difficultyLevel(fields.difficulty, fields.difficultyStep) : null),
    eventStatus: fields.eventStatus,
    timezone: fields.timezone,
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    raceStartsAt: times.raceStartsAt,
    scheduleItems: times.scheduleItems.length > 0 ? times.scheduleItems : null,
    mapUrl: fields.mapUrl,
    // «Coordonate» (§416): only a caller that posts the box writes the pair; "" clears both halves.
    ...(fields.coordinates === undefined
      ? {}
      : { latitude: fields.coordinates?.latitude ?? null, longitude: fields.coordinates?.longitude ?? null }),
    routeUrl: fields.routeUrl,
    // No `video_url` (§481, §491): films live in the description.
    stravaEventUrl: fields.stravaEventUrl,
    facebookEventUrl: fields.facebookEventUrl,
    // The partners as a list (§168); the old `co_host_name`/`co_host_url` are neither written nor
    // read, and `readCoHosts` prefers the list when present — so removing every partner writes `[]`.
    // A caller silent about partners writes nothing (§169), or it would erase an old row's partner.
    ...(fields.coHosts === undefined ? {} : { coHosts: fields.coHosts }),
    // "Linkuri și fișiere" (§332), same discipline. None is stored as null, not `[]`, so a series edit
    // never sees a change between "never had links" and "links removed".
    ...(fields.links === undefined ? {} : { links: fields.links.length > 0 ? fields.links : null }),
    // Written even while the place is to be announced (§328): kept for staff, never handed to a public reader.
    locationName: fields.locationName,
    locationAddress: fields.locationAddress,
    locationToBeAnnounced: fields.locationToBeAnnounced,
    // §398: a create with no cost type stores `FREE`, the select's own default (`initialCostTypeOf`);
    // an edit with none leaves the stored value. A posted value, `null` included, is always written.
    ...(fields.costType === undefined ? (options?.isCreate ? { costType: COST_TYPE_ON_CREATE } : {}) : { costType: fields.costType }),
    // Absent means "not editing the cost" (§343); the editor always posts both.
    ...(fields.costAmount === undefined ? {} : { costAmount: fields.costAmount }),
    ...(fields.costUrl === undefined ? {} : { costUrl: fields.costUrl }),
    distanceMeters: fields.distanceMeters,
    elevationGainMeters: fields.elevationGainMeters,
    nightOverride: fields.nightOverride,
    // Only a group run on asphalt or trail offers a self-declaration (§393); anything else stores
    // false whatever a hidden box posted, as §111 normalizes.
    offersGroupRunDeclaration: fields.offersGroupRunDeclaration === true && groupRunDeclarationKeyFor(fields) !== null,
    featured: fields.featured,
    isSpecial: fields.isSpecial,
    registrationMode: fields.registrationMode,
    capacity: fields.capacity,
    // Waiting-list cap (§348): a caller silent about it writes nothing, so no save lifts the limit.
    ...(fields.waitlistCapacity === undefined ? {} : { waitlistCapacity: fields.waitlistCapacity }),
    // The race's band (§173): where numbers start and their colour (§177).
    bibStartNumber: fields.bibStartNumber,
    bibColour: fields.bibColour,
    /*
      The rest of the bib design (§249), same discipline: a form without the panel would otherwise
      read as "every switch off" and silently redesign the bib.
    */
    ...(fields.bibDesign === undefined ? {} : { bibDesign: fields.bibDesign }),
    confirmationOpensDaysBefore: fields.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: fields.confirmationDeadlineDaysBefore,
    // The minimum age, counted on the event's day at every door (§329).
    minAge: fields.minAge,
    // The reminder lead (§377): a caller silent about it keeps the organizer's choice.
    ...(fields.reminderHoursBefore === undefined ? {} : { reminderHoursBefore: fields.reminderHoursBefore }),
    registrationOpensAt: times.registrationOpensAt,
    // «Se deschid în curând» (§451): a caller silent about it opens nothing held shut.
    ...(fields.registrationOpensSoon === undefined ? {} : { registrationOpensSoon: fields.registrationOpensSoon }),
    // «Data se anunță mai târziu» (§533), same discipline. While on, internal registration stays at
    // «în curând» (§451), so announcing the date later opens nothing by itself.
    ...(fields.dateToBeAnnounced === undefined ? {} : { dateToBeAnnounced: fields.dateToBeAnnounced }),
    // «Ora se anunță mai târziu» (§533): the same, for the time alone.
    ...(fields.timeToBeAnnounced === undefined ? {} : { timeToBeAnnounced: fields.timeToBeAnnounced }),
    ...(startHeldBack(fields) && fields.registrationMode === "INTERNAL" ? { registrationOpensSoon: true } : {}),
    registrationClosesAt: times.registrationClosesAt,
    declarationDocumentId: fields.declarationDocumentId,
    participantListVisibility: fields.participantListVisibility,
    externalProvider: fields.externalProvider,
    externalRegistrationUrl: fields.externalRegistrationUrl,
  };
}

/**
 * A group run takes no registrations (§111): whatever the hidden block posted, the row is written
 * as a turn-up event. Ignored, not refused, since the organizer cannot see the field (as the gun
 * time, §71).
 */
function normalizeForType<T extends EventFieldsInput>(fields: T): T {
  if (takesRegistrations(fields.type)) return fields;
  return keepUnsentWaitlist(fields, { ...fields, ...TURN_UP_FIELDS });
}

/**
 * The waiting-list cap is written only by a caller that sent it (§350): null when a hidden block
 * posted it, nothing when it was not posted — so a save that never mentioned it never lifts it.
 */
function keepUnsentWaitlist<T extends EventFieldsInput>(fields: T, normalized: T): T {
  return fields.waitlistCapacity === undefined ? { ...normalized, waitlistCapacity: undefined } : normalized;
}

/** What a turn-up type is written with, whatever the hidden block posted (§111). */
const TURN_UP_FIELDS = {
  // No programme rows on a turn-up type (§111, §117).
  scheduleRows: [],
  registrationMode: "NONE",
  capacity: null,
  // A turn-up event queues nobody (§350).
  waitlistCapacity: null,
  declarationDocumentId: null,
  registrationOpensAtWallTime: "",
  registrationOpensSoon: false,
  registrationClosesAtWallTime: "",
  participantListVisibility: "HIDDEN",
  externalProvider: null,
  externalRegistrationUrl: null,
} as const;

/**
 * What the chosen registration mode hides is ignored, not refused (§350, extending §111): a value
 * left behind a mode switch sits in a box the organizer can no longer see. Not here → no capacity,
 * waiting-list cap, declaration or public list; not elsewhere → no organizer name or link. The
 * window, confirmation days, minimum age and bib band are kept in every mode.
 * `assertCoherentRegistrationBlock` still guards other paths.
 */
export function normalizeForMode<T extends EventFieldsInput>(fields: T): T {
  return keepUnsentWaitlist(fields, { ...fields, ...hiddenByMode(fields.registrationMode) });
}

/** What "Pe site" alone and "La organizator" alone show, as the values stored in their place. */
const INTERNAL_ONLY_FIELDS = {
  capacity: null,
  waitlistCapacity: null,
  declarationDocumentId: null,
  participantListVisibility: "HIDDEN",
  // «Se deschid în curând» (§451) is the site's own door; there is none elsewhere.
  registrationOpensSoon: false,
} as const;
const EXTERNAL_ONLY_FIELDS = { externalProvider: null, externalRegistrationUrl: null } as const;

function hiddenByMode(mode: "NONE" | "INTERNAL" | "EXTERNAL") {
  return { ...(mode === "INTERNAL" ? {} : INTERNAL_ONLY_FIELDS), ...(mode === "EXTERNAL" ? {} : EXTERNAL_ONLY_FIELDS) };
}

/**
 * The same two rules on the form as posted, before the schema reads it (§350): otherwise a hidden
 * box left wrong (e.g. `www.club.ro`) still reached `httpsUrl` and the refusal named an invisible
 * box. A hidden box is replaced by the value it would be stored as. Only keys the caller sent are
 * replaced (the schema is strict), and an unknown type or mode is left for the schema to name.
 * What every mode keeps is checked as typed; `OnlyForMode` brings its refusal on screen.
 */
export function ignoreHiddenFields(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const posted = raw as Record<string, unknown>;
  const turnUp = (EVENT_TYPES as readonly unknown[]).includes(posted.type) && !takesRegistrations(posted.type as EventType);
  const mode = posted.registrationMode;
  const hidden: Record<string, unknown> = turnUp
    ? TURN_UP_FIELDS
    : mode === "NONE" || mode === "INTERNAL" || mode === "EXTERNAL"
      ? hiddenByMode(mode)
      : {};
  const replaced = { ...posted };
  for (const [key, value] of Object.entries(hidden)) if (key in replaced) replaced[key] = value;
  /*
    Behind "Locația se anunță mai târziu" (§328, §350) typed values are kept, but a map link that is
    not one cannot be stored and its box is hidden, so it is written as no link. Switched off, it is
    checked as typed.
  */
  if (posted.locationToBeAnnounced === true && "mapUrl" in replaced && !eventFieldsSchema.shape.mapUrl.safeParse(replaced.mapUrl).success) {
    replaced.mapUrl = "";
  }
  // «Coordonate» (§416) hide with the map link, and are written as none likewise.
  if (
    posted.locationToBeAnnounced === true &&
    "coordinates" in replaced &&
    replaced.coordinates !== undefined &&
    !eventFieldsSchema.shape.coordinates.safeParse(replaced.coordinates).success
  ) {
    replaced.coordinates = "";
  }
  return replaced;
}

function parseOrThrow<Out>(schema: z.ZodType<Out>, value: unknown): Out {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      // The paths, so the form can name the boxes (§47, §315) — names, never values.
      [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")).filter((path) => path !== ""))],
    );
  }
  return parsed.data;
}

/**
 * A part's refusal with its field paths prefixed as the one form posts them (§315): a language's
 * bare `title` becomes `translations.<locale>.title` (so the summary opens the right tab and
 * `form-names.ts` does not read it as an event column), the repeat rule's `until` becomes
 * `repeat.until`. The code and message are unchanged.
 */
async function namedUnder<R>(prefix: string, save: () => Promise<R>): Promise<R> {
  try {
    return await save();
  } catch (error) {
    if (isDomainError(error) && error.fields.length > 0) {
      throw new DomainError(error.code, error.message, error.fields.map((field) => `${prefix}.${field}`));
    }
    throw error;
  }
}

// --- The place's name in each language (§362) -----------------------------------------------

/** Each language's place name as one event save leaves it; an absent language is not being edited. */
type PlaceNames = Partial<Record<Locale, string | null>>;

/**
 * The Locul box's names by language (§362). The Romanian is also the event's meeting point, so it is
 * always present; the English only when posted — absent, the English row keeps what it holds.
 */
function placeNamesFrom(fields: Pick<EventFieldsInput, PlaceNameField>): PlaceNames {
  const names: PlaceNames = {};
  for (const locale of routing.locales) {
    const name = fields[PLACE_NAME_FIELD[locale]];
    if (name !== undefined) names[locale] = name;
  }
  return names;
}

/**
 * The names written to each language's row inside the event save's transaction (§362). The place is
 * the event's (the Organizer's, §207), so this runs under the event row's version guard and the
 * translation rows' versions do not move: a Redactor saving the words in the same minute is not
 * refused over a place they never touched. Text saves cannot write the column.
 */
async function writePlaceNames<T extends Record<string, unknown>>(tx: Transaction<T>, eventId: string, names: PlaceNames): Promise<void> {
  for (const locale of routing.locales) {
    const name = names[locale];
    if (name === undefined) continue;
    await tx
      .update(eventTranslations)
      .set({ locationName: name })
      .where(and(eq(eventTranslations.eventId, eventId), eq(eventTranslations.locale, locale)));
  }
}

/**
 * Clears `discountNote` in both languages when the saved event no longer allows one (§394), inside
 * the event save's transaction: a settings-only save never goes through `applyTranslationSave`, so
 * otherwise a stale, invisible note would remain. Decided from the row as saved, not the parsed
 * fields (an omitted `costType` means "not editing").
 */
async function clearDiscountNoteIfNotAllowed<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  eventId: string,
  fields: { registrationMode: EditableEvent["registrationMode"]; costType: EditableEvent["costType"] },
): Promise<boolean> {
  if (costPaidToExternalOrganizer(fields)) return false;
  await tx.update(eventTranslations).set({ discountNote: null }).where(eq(eventTranslations.eventId, eventId));
  return true;
}

/** The rows as `writePlaceNames` left them, without reading them again. */
function withPlaceNames(rows: readonly EditableTranslation[], names: PlaceNames): EditableTranslation[] {
  return rows.map((row) => {
    const name = names[row.locale];
    return name === undefined ? row : { ...row, locationName: name };
  });
}

/** The place each language's page shows (§362), address folded in: what a series edit compares. */
function placesShown(event: EditableEvent, rows: readonly EditableTranslation[]): Record<Locale, string> {
  return Object.fromEntries(
    routing.locales.map((locale) => [locale, placeShown(event, rows.find((row) => row.locale === locale)?.locationName)]),
  ) as Record<Locale, string>;
}

/**
 * The names one save writes, an older event's English following its Romanian (§362,
 * `place.ts#englishNameAfterSave`), so moving only the Romanian box does not leave this date's
 * English page on the old place while a series save moves the others. `rows` are as loaded.
 */
function namesAfterSave(before: EditableEvent, rows: readonly EditableTranslation[], names: PlaceNames): PlaceNames {
  if (names.ro === undefined || names.en === undefined) return names;
  const own = (locale: Locale) => rows.find((row) => row.locale === locale)?.locationName;
  return { ...names, en: englishNameAfterSave(before, { ro: own("ro"), en: own("en") }, { ro: names.ro, en: names.en }) };
}

// --- Translations ---------------------------------------------------------------------------

function assertMayEdit(actor: Actor, event: EditableEvent, translation: EditableTranslation): void {
  if (
    !canEditTranslation(
      actor.role,
      { editorialStatus: event.editorialStatus, authorStaffUserId: translation.authorStaffUserId },
      actor.id,
    )
  ) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${actor.role} may not edit the text of a ${event.editorialStatus} event`,
    );
  }
}

export type SaveTranslationInput = {
  actor: Actor;
  translationId: string;
  expectedVersion: number;
  fields: unknown;
  /**
   * BR-REQ-051-01 criterion 4: a save that changes what the public reads now must have answered
   * the form's warning; the server refuses it otherwise.
   */
  acknowledgeLiveEdit?: boolean;
  now?: Date;
  /** Only for tests: a `fetch` stand-in for the YouTube poster fetches, never a live default. */
  fetchImpl?: typeof fetch;
};

/**
 * One translation's checks and guarded write on the caller's handle (a transaction during the
 * whole-event save), shared by both entry points so the slug, live-edit and authorship rules are
 * written once.
 */
async function applyTranslationSave<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    actor: Actor;
    event: EditableEvent;
    current: EditableTranslation;
    expectedVersion: number;
    fields: unknown;
    acknowledgeLiveEdit?: boolean;
    /** The event's type after this save. */
    eventType: EditableEvent["type"];
    /** Whether `discountNote` may be written after this save (§394): the mode and cost type after it. */
    registrationMode: EditableEvent["registrationMode"];
    costType: EditableEvent["costType"];
    now: Date;
  },
): Promise<EditableTranslation> {
  assertMayEdit(input.actor, input.event, input.current);

  if (isLiveContent(input.event.editorialStatus) && input.acknowledgeLiveEdit !== true) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "this event is published; confirm the warning before saving live content",
    );
  }

  // Never a poster fetch here (§403): this runs inside the save's transaction behind
  // `lockEventForCapacity`. Callers attach posters first (`attachPostersToPostedTexts`).
  const fields = parseOrThrow(translationFieldsSchema, input.fields);

  /**
   * AGENTS.md §11.5: a slug is editable before first publication, stable afterwards — keyed on
   * `published_at`, set once and never cleared, so unpublishing never frees an indexed URL. No
   * redirects exist yet, so no Administrator exception either.
   */
  if (input.event.publishedAt !== null && fields.slug !== input.current.slug) {
    throw new DomainError(
      "FORBIDDEN",
      "the slug of a published translation cannot be changed; it is a public URL",
    );
  }

  return updateTranslationWithVersionGuard(
    db,
    input.current.id,
    input.expectedVersion,
    {
      ...translationColumnsFrom(fields, input.eventType, costPaidToExternalOrganizer(input)),
      // An unclaimed row becomes the saver's (seeded rows have no author); an existing author is
      // never overwritten.
      authorStaffUserId: input.current.authorStaffUserId ?? input.actor.id,
    },
    input.now,
  );
}

/**
 * The `event_translations` columns one language writes — `eventColumnsFrom`'s sibling, shared by
 * create and save. The plain `excerpt` is derived from the rich one when posted, since the card,
 * meta description and publish check read the plain column (§73). An unposted field is
 * `undefined`: a save leaves it, an insert takes the column default.
 */
function translationColumnsFrom(fields: TranslationFields, eventType: EditableEvent["type"], discountAllowed: boolean) {
  const { body, rules, schedule, routeDescription, excerptBody, ...columns } = fields;
  const excerptJson = hasRichTextContent(excerptBody) ? excerptBody : null;
  return {
    ...columns,
    excerpt: excerptJson ? richTextToPlainText(excerptJson).replace(/\s+/g, " ").trim().slice(0, 500) || null : columns.excerpt,
    excerptJson,
    bodyJson: body,
    rulesJson: hasRichTextContent(rules) ? rules : null,
    // A group run has no programme (§111), even if the type changed in this save or a hidden box posted text.
    scheduleJson: hasProgramme(eventType) && hasRichTextContent(schedule) ? schedule : null,
    // The route description (§387), on every type.
    routeDescriptionJson: hasRichTextContent(routeDescription) ? routeDescription : null,
    // The discount note (§394), kept only while `EXTERNAL` + `PAID` needs it.
    ...(discountAllowed ? {} : { discountNote: null }),
  };
}

/** The five rich-text boxes of one language; any may carry a film. */
const RICH_TEXT_BOXES = ["body", "rules", "schedule", "routeDescription", "excerptBody"] as const;

type PosterOptions = { now?: Date; fetchImpl?: typeof fetch };

/**
 * Gives every film in one language's posted boxes the club's own poster (§403) before any
 * transaction opens: the fetches, `sharp` encode and R2 put must not sit behind
 * `lockEventForCapacity`, which every registration waits on. Works on the posted JSON strings so
 * validation still runs unchanged in `applyTranslationSave`; an invalid box is left as posted.
 * Best effort: a failed fetch leaves `poster: null`, never a refusal.
 */
async function attachPostersToPostedTexts<T extends Record<string, unknown>>(
  db: Database<T>,
  posted: unknown,
  options: PosterOptions,
): Promise<unknown> {
  if (!posted || typeof posted !== "object" || Array.isArray(posted)) return posted;
  const boxes = posted as Record<string, unknown>;
  const withPosters = { ...boxes };
  for (const key of RICH_TEXT_BOXES) {
    const raw = boxes[key];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    let doc: RichTextDoc;
    try {
      doc = parseRichText(JSON.parse(raw));
    } catch {
      continue;
    }
    const attached = await attachYoutubePosters(db, doc, options);
    if (attached !== doc) withPosters[key] = JSON.stringify(attached);
  }
  return withPosters;
}

/** The same for an already-parsed language (the create form, after `newEventSchema`). */
async function attachPostersToParsedTexts<T extends Record<string, unknown>>(
  db: Database<T>,
  fields: TranslationFields,
  options: PosterOptions,
): Promise<TranslationFields> {
  const withPosters = { ...fields };
  for (const key of RICH_TEXT_BOXES) {
    withPosters[key] = await attachYoutubePosters(db, fields[key], options);
  }
  return withPosters;
}

/** One language's optional texts as the row will hold them. */
type OptionalTextColumns = {
  bodyJson?: unknown;
  rulesJson?: unknown;
  scheduleJson?: unknown;
  routeDescriptionJson?: unknown;
  checklist?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  discountNote?: string | null;
};

/**
 * Whether each optional text says something, keyed by its box's name; rich text by the editor's
 * "· incomplet" rule (`isBlankValue`, §350), so the page mark and the refusal agree.
 */
function writtenOptionalTexts(row: OptionalTextColumns) {
  const writtenDoc = (doc: unknown) => doc !== null && doc !== undefined && !isBlankValue(JSON.stringify(doc));
  return {
    body: writtenDoc(row.bodyJson),
    rules: writtenDoc(row.rulesJson),
    schedule: writtenDoc(row.scheduleJson),
    routeDescription: writtenDoc(row.routeDescriptionJson),
    checklist: isWrittenText(row.checklist),
    seoTitle: isWrittenText(row.seoTitle),
    seoDescription: isWrittenText(row.seoDescription),
    // Nulled outside `EXTERNAL` + `PAID`, so it never fires there.
    discountNote: isWrittenText(row.discountNote),
  };
}

/**
 * Both languages or neither for the optional texts (§352): description, rules, programme notes,
 * what to bring and the two SEO overrides, refused on the empty side's box. Read on the columns as
 * stored, so a text not stored (a group run's notes, §111) never blocks the save. Title and address
 * are always required, the summary at publication (§28), the place name by `placeRule` (§362).
 */
function assertOptionalTextsInBothLanguages(rows: Readonly<Record<Locale, OptionalTextColumns>>): void {
  const ro = writtenOptionalTexts(rows.ro);
  const en = writtenOptionalTexts(rows.en);
  const missing = (Object.keys(ro) as Array<keyof typeof ro>).flatMap((field) => {
    const language = missingLanguage({ ro: ro[field], en: en[field] }, (written) => written);
    return language ? [`translations.${language}.${field}`] : [];
  });
  if (missing.length > 0) {
    throw new DomainError("VALIDATION_ERROR", `${missing.join(", ")}: written in the other language only; write both languages or neither`, missing);
  }
}

export async function saveEventTranslation<T extends Record<string, unknown>>(
  db: Database<T>,
  input: SaveTranslationInput,
): Promise<EditableTranslation> {
  const now = input.now ?? new Date();

  const record = await findTranslationWithEventById(db, input.translationId);
  if (!record) throw new DomainError("NOT_FOUND", "no such event translation");
  // Authorization before any poster is fetched on their behalf.
  assertMayEdit(input.actor, record.event, record.translation);
  const fields = await attachPostersToPostedTexts(db, input.fields, { now, fetchImpl: input.fetchImpl });

  const saved = await applyTranslationSave(db, {
    actor: input.actor,
    event: record.event,
    current: record.translation,
    expectedVersion: input.expectedVersion,
    fields,
    acknowledgeLiveEdit: input.acknowledgeLiveEdit,
    eventType: record.event.type,
    registrationMode: record.event.registrationMode,
    costType: record.event.costType,
    now,
  });
  // The public pages read events from a cache (§333); every write revalidates it.
  revalidatePublicContent("events");
  return saved;
}

// --- Publication ----------------------------------------------------------------------------

/**
 * What PUBLISHED requires, and why it is not a constraint: a CHECK sees one row, and this asserts
 * the set — every served locale has a row carrying `REQUIRED_PUBLIC_TRANSLATION_FIELDS`. The
 * CHECKs assert the halves they can see.
 */
/**
 * What the event itself lacks before publication (§36, §362): a meeting point in every language,
 * named by its Locul box (`locationName`, `locationNameEn`). A language's place is what its page
 * shows (`placeNameIn`: its own name, else the event's), so an event unsaved since §362 is not
 * refused for an English name it never needed. A place to be announced (§328) is complete without one.
 */
export function missingPublicEventFields(
  event: Pick<EditableEvent, "locationName" | "locationToBeAnnounced">,
  translations: readonly Pick<EditableTranslation, "locale" | "locationName">[] = [],
): PlaceNameField[] {
  if (event.locationToBeAnnounced) return [];
  return routing.locales
    .filter((locale) => placeNameIn(event, translations.find((row) => row.locale === locale)?.locationName) === null)
    .map((locale) => PLACE_NAME_FIELD[locale]);
}

export function describeIncompleteLocales(
  translations: readonly EditableTranslation[],
): Array<{ locale: string; missing: string[] }> {
  return routing.locales
    .map((locale) => {
      const translation = translations.find((row) => row.locale === locale);
      if (!translation) return { locale, missing: ["translation"] };
      return { locale, missing: missingPublicFields(translation) as string[] };
    })
    .filter((entry) => entry.missing.length > 0);
}

export type TransitionEventInput = {
  actor: Actor;
  eventId: string;
  expectedVersion: number;
  to: EditorialStatus;
  now?: Date;
};

/**
 * Moves one event through the editorial workflow (AGENTS.md §11.2, §28). Per event, not per
 * locale, so both languages go live together. A transition carries a version too: publishing a
 * draft a colleague rewrote since you opened it is the same failure as overwriting it.
 */
export async function transitionEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: TransitionEventInput,
): Promise<EditableEvent> {
  const now = input.now ?? new Date();

  const [current] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such event");

  const translations = await listTranslationsForEvent(db, input.eventId);
  // An Author may submit their own draft. The event has no author, so "own" means every authored
  // translation names this one.
  const authored = translations.filter((row) => row.authorStaffUserId !== null);
  const isOwnDraft =
    authored.length > 0 && authored.every((row) => row.authorStaffUserId === input.actor.id);

  if (!canTransitionEvent(input.actor.role, current.editorialStatus, input.to, isOwnDraft)) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${input.actor.role} may not move an event from ${current.editorialStatus} to ${input.to}`,
    );
  }

  const changes: Partial<typeof events.$inferInsert> = {
    editorialStatus: input.to,
    updatedByStaffUserId: input.actor.id,
  };

  if (input.to === "PUBLISHED") {
    const missingOnEvent = missingPublicEventFields(current, translations);
    if (missingOnEvent.length > 0) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `the event is missing ${missingOnEvent.join(", ")} and cannot be published`,
      );
    }

    const incomplete = describeIncompleteLocales(translations);
    if (incomplete.length > 0) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `every language must be complete before publishing: ${incomplete
          .map((entry) => `${entry.locale} is missing ${entry.missing.join(", ")}`)
          .join("; ")}`,
      );
    }

    // First publication stamps the date, never again: slug stability and the sitemap's
    // `lastModified` read it.
    if (current.publishedAt === null) changes.publishedAt = now;
  }

  const moved = await updateEventWithVersionGuard(db, input.eventId, input.expectedVersion, changes, now);
  // The listing, the page, the calendar and the feeds change.
  revalidatePublicContent("events");
  // The announcements of §146 wait on publication; the maintenance job looks again (§334).
  wakeJobs("registration-maintenance");
  return moved;
}

export type PublishEventInput = Omit<TransitionEventInput, "to">;

/**
 * «Publică» on the editor from a draft, in one press (§423, §406), as «Creează și publică» and the
 * list's bulk publish already do. It walks DRAFT → IN_REVIEW → PUBLISHED through `transitionEvent`
 * in one transaction, so every publication guard applies and a refusal leaves a draft a draft. A
 * role that may not publish is refused first; from any other state it is the plain transition.
 */
export async function publishEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: PublishEventInput,
): Promise<EditableEvent> {
  const now = input.now ?? new Date();
  if (!canTransitionEvent(input.actor.role, "IN_REVIEW", "PUBLISHED", false)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not publish an event`);
  }

  return db.transaction(async (tx) => {
    const [current] = await tx.select({ status: events.editorialStatus }).from(events).where(eq(events.id, input.eventId)).limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "no such event");
    let expectedVersion = input.expectedVersion;
    if (current.status === "DRAFT") {
      const reviewed = await transitionEvent(tx, { actor: input.actor, eventId: input.eventId, expectedVersion, to: "IN_REVIEW", now });
      expectedVersion = reviewed.version;
    }
    return transitionEvent(tx, { actor: input.actor, eventId: input.eventId, expectedVersion, to: "PUBLISHED", now });
  });
}

// --- Telling the participants (§331) --------------------------------------------------------

/** One organizer text as posted: a box per language (§354), either absent from a caller that did not draw it. */
export type EventNoticeTextInput = { ro?: string | null; en?: string | null };

/** "Anunță participanții despre schimbare", as the editor's save posts it: the box, and the optional note in both languages. */
export type EventNoticeRequest = { notify: boolean; note?: EventNoticeTextInput | null };

/** Why the event is being cancelled, in both languages, and whether its participants are told (the box starts ticked). */
export type EventCancellationRequest = { reason: EventNoticeTextInput; notify: boolean };

/**
 * What the save told the participants, for the banner; absent when nothing was asked.
 * - `update`: "details updated" queued for this many real registrations (test rows are told but
 *   not counted, `AGENTS.md` §12.6), across every date reached.
 * - `nothingToTell`: ticked, but nothing a runner plans by changed and no note was written.
 * - `cancelled`: the save cancelled the event or series dates; `queued` messages if "tell them"
 *   was ticked.
 * - `cancelledNobodyToTell`: cancelled an event without registration here, which had no box.
 */
export type EventNoticeOutcome =
  | { kind: "update"; queued: number; changes: EventChangeKind[] }
  | { kind: "nothingToTell" }
  | { kind: "cancelled"; queued: number; notified: boolean }
  | { kind: "cancelledNobodyToTell" };

type NoticeRequest = {
  notify: boolean;
  note: BilingualText | null;
  cancellation: { reason: BilingualText; notify: boolean } | null;
};

/** The posted box of each language: `notice.noteRo`, `cancel.reasonEn`. */
const noticeBox = (prefix: "notice.note" | "cancel.reason", language: TextLanguage) => `${prefix}${language === "ro" ? "Ro" : "En"}`;

/**
 * One organizer text, each language read by the notice rule (plain, at most 500 characters). A
 * language over the ceiling is refused on its box; the two come back as read, "" when empty.
 */
function readNoticeTexts(prefix: "notice.note" | "cancel.reason", posted: EventNoticeTextInput | null | undefined): Record<TextLanguage, string> {
  const read = {} as Record<TextLanguage, string>;
  const tooLong: string[] = [];
  for (const language of ["ro", "en"] as const) {
    const parsed = eventNoticeTextSchema.safeParse(posted?.[language] ?? "");
    if (parsed.success) read[language] = parsed.data;
    else tooLong.push(noticeBox(prefix, language));
  }
  if (tooLong.length > 0) throw new DomainError("VALIDATION_ERROR", `${tooLong.join(", ")}: at most ${EVENT_NOTICE_TEXT_MAX} characters`, tooLong);
  return read;
}

/**
 * The notice and cancellation, checked before any row is locked (§331). Both languages (§354): the
 * note is both or neither, the reason required in both. A cancellation must say why — it goes to
 * the participants and into the audit trail either way — refused on the box so the form keeps the
 * rest (§315). Only whoever may save the event row may tell its participants (`canEditEventFields`,
 * BR-REQ-060-01).
 */
function readNoticeRequest(
  actor: Actor,
  current: EditableEvent,
  nextStatus: EditableEvent["eventStatus"] | undefined,
  notice: EventNoticeRequest | undefined,
  cancellation: EventCancellationRequest | undefined,
): NoticeRequest {
  const cancelling = nextStatus === "CANCELLED" && current.eventStatus !== "CANCELLED";
  const notify = notice?.notify === true;
  if ((cancelling || notify) && !canEditEventFields(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not tell an event's participants about it`);
  }

  // A note is read only when sending was asked for.
  let note: BilingualText | null = null;
  if (notify && notice?.note) {
    const texts = readNoticeTexts("notice.note", notice.note);
    const missing = missingLanguage(texts, isWrittenText);
    if (missing) {
      const box = noticeBox("notice.note", missing);
      throw new DomainError("VALIDATION_ERROR", `${box}: the note is written in one language only; write both languages or neither`, [box]);
    }
    note = isWrittenText(texts.ro) ? { ro: texts.ro, en: texts.en } : null;
  }

  let cancelled: NoticeRequest["cancellation"] = null;
  if (cancelling) {
    const texts = readNoticeTexts("cancel.reason", cancellation?.reason);
    const empty = (["ro", "en"] as const).filter((language) => !isWrittenText(texts[language])).map((language) => noticeBox("cancel.reason", language));
    if (empty.length > 0) {
      throw new DomainError("VALIDATION_ERROR", `${empty.join(", ")}: say why the event is cancelled, in both languages`, empty);
    }
    cancelled = { reason: { ro: texts.ro, en: texts.en }, notify: cancellation?.notify === true };
  }
  return { notify, note, cancellation: cancelled };
}

/** One date of the save, as it was and as it was written. */
type SavedDate = {
  before: EditableEvent;
  after: EditableEvent;
  translationsBefore: readonly EditableTranslation[];
  translationsAfter: readonly EditableTranslation[];
};

/**
 * Tells one date's participants what the save did, inside its transaction (§331). A cancelled date
 * gets `EVENT_CANCELLED` if the box was ticked, and an audit row either way. A date still on whose
 * place, start or programme moved (or that is on again) gets `EVENT_UPDATE_NOTICE` when ticked, or
 * when the organizer wrote a note. Registrations are never touched: they stay as the record, and a
 * reinstated event finds its queue intact. `alreadyStarted` dates are told nothing, but a
 * cancellation of one is still audited.
 */
async function announceSavedDate<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  input: SavedDate & { actor: Actor; request: NoticeRequest; saveKey: string; alreadyStarted: boolean; now: Date },
): Promise<EventNoticeOutcome | null> {
  const { before, after, request, actor, now } = input;

  if (before.eventStatus !== "CANCELLED" && after.eventStatus === "CANCELLED") {
    if (!request.cancellation) return null;
    const tell = request.cancellation.notify && !input.alreadyStarted;
    const queued = tell
      ? await queueEventCancelledNotices(tx, { eventId: after.id, saveKey: input.saveKey, reason: request.cancellation.reason, actorStaffUserId: actor.id, now })
      : 0;
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.cancelled",
      entityType: "event",
      entityId: after.id,
      // Who, why, and whether the participants were told — a count, never who they are (§12.12).
      metadata: {
        reason: request.cancellation.reason,
        notified: tell,
        recipients: queued,
        version: after.version,
        ...(input.alreadyStarted ? { alreadyStarted: true } : {}),
      },
      now,
    });
    /*
      An event without registration here had no "tell them" box, so "not told because unticked" would
      name a box nobody saw. Judged on the mode the page was drawn from, and only when nothing queued.
    */
    if (before.registrationMode !== "INTERNAL" && queued === 0) return { kind: "cancelledNobodyToTell" };
    return { kind: "cancelled", queued, notified: tell };
  }

  if (!request.notify || after.eventStatus !== "SCHEDULED" || input.alreadyStarted) return null;
  const languages = (rows: readonly EditableTranslation[]) => rows.map((row) => ({ locale: row.locale, locationName: row.locationName }));
  const changes = eventChangesToAnnounce(before, after, languages(input.translationsBefore), languages(input.translationsAfter));
  if (changes.length === 0 && !request.note) return { kind: "nothingToTell" };

  const queued = await queueEventUpdateNotices(tx, {
    eventId: after.id,
    saveKey: input.saveKey,
    changes,
    note: request.note,
    actorStaffUserId: actor.id,
    now,
  });
  await recordAuditEvent(tx, {
    actorStaffUserId: actor.id,
    action: "event.update_notice_sent",
    entityType: "event",
    entityId: after.id,
    metadata: { changes, note: request.note, recipients: queued, version: after.version },
    now,
  });
  return { kind: "update", queued, changes };
}

/** Every date's answer as one banner: a cancellation first (with a box before without), then messages, then "nothing to tell". */
function combineNoticeOutcomes(outcomes: readonly (EventNoticeOutcome | null)[]): EventNoticeOutcome | undefined {
  const cancelled = outcomes.filter((outcome): outcome is Extract<EventNoticeOutcome, { kind: "cancelled" }> => outcome?.kind === "cancelled");
  if (cancelled.length > 0) {
    return { kind: "cancelled", queued: cancelled.reduce((sum, outcome) => sum + outcome.queued, 0), notified: cancelled.some((outcome) => outcome.notified) };
  }
  if (outcomes.some((outcome) => outcome?.kind === "cancelledNobodyToTell")) return { kind: "cancelledNobodyToTell" };
  const updates = outcomes.filter((outcome): outcome is Extract<EventNoticeOutcome, { kind: "update" }> => outcome?.kind === "update");
  if (updates.length > 0) {
    return {
      kind: "update",
      queued: updates.reduce((sum, outcome) => sum + outcome.queued, 0),
      changes: [...new Set(updates.flatMap((outcome) => outcome.changes))],
    };
  }
  return outcomes.some((outcome) => outcome?.kind === "nothingToTell") ? { kind: "nothingToTell" } : undefined;
}

/**
 * Tells every date the save reached (§331), each date's registrants once about their own date,
 * keyed by the saved event and its new version so a retried press queues nothing twice. Other
 * series dates that already began are told nothing (their cancellation is still audited and they
 * are left out of the count); the edited date is always told when asked.
 */
async function announceSave<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  input: { actor: Actor; request: NoticeRequest; saved: EditableEvent; dates: readonly SavedDate[]; now: Date },
): Promise<EventNoticeOutcome | undefined> {
  if (!input.request.notify && !input.request.cancellation) return undefined;
  const saveKey = `${input.saved.id}:v${input.saved.version}`;
  const outcomes: (EventNoticeOutcome | null)[] = [];
  for (const [index, date] of input.dates.entries()) {
    const alreadyStarted = index > 0 && date.before.startsAt.getTime() <= input.now.getTime();
    const outcome = await announceSavedDate(tx, { ...date, actor: input.actor, request: input.request, saveKey, alreadyStarted, now: input.now });
    if (!alreadyStarted) outcomes.push(outcome);
  }
  return combineNoticeOutcomes(outcomes);
}

// --- The event row --------------------------------------------------------------------------

export type SaveEventFieldsInput = {
  actor: Actor;
  eventId: string;
  expectedVersion: number;
  fields: unknown;
  /** Tell the participants what changed (§331); absent or unticked sends nothing. */
  notice?: EventNoticeRequest;
  /** Required when the save moves the event to CANCELLED (§331). */
  cancellation?: EventCancellationRequest;
  now?: Date;
};

/**
 * Every column an organizer owns: type, surface, status, times and zone, map and route links,
 * distance, climb, featured, and the registration block. An Author is refused (§10.2). Wall-clock
 * times are read in the event's zone, never the server's.
 */
export async function saveEventFields<T extends Record<string, unknown>>(
  db: Database<T>,
  input: SaveEventFieldsInput,
): Promise<EditableEvent> {
  const now = input.now ?? new Date();

  if (!canEditEventFields(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not edit event details`);
  }

  const [current] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such event");

  const fields = normalizeForMode(normalizeForType(parseOrThrow(eventFieldsSchema, ignoreHiddenFields(input.fields))));
  await assertCoherentRegistrationBlock(db, fields, now);
  await assertDateToBeAnnouncedAllowed(db, fields, current);
  const times = resolveTimes(fields, switchesAfterSave(fields, current));
  // As the editor's save (§331): a cancellation says why, and tells whom it was asked to.
  const request = readNoticeRequest(input.actor, current, fields.eventStatus, input.notice, input.cancellation);

  /**
   * Capacity below the places taken is refused (AGENTS.md §10.6, BR-REQ-034-02 criterion 3),
   * counted behind the event row's lock — the point every allocation serializes on — so a
   * concurrent confirmation waits rather than slipping past.
   */
  const saved = await db.transaction(async (tx) => {
    await assertNobodyRegisteredForUndated(tx, fields, current);
    if (fields.capacity !== null) {
      await lockEventForCapacity(tx, input.eventId);
      const occupied = computeOccupied(await countOccupied(tx, input.eventId, now));
      if (fields.capacity < occupied) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `capacity: ${occupied} places are already taken; capacity cannot be lowered below that`,
        );
      }
    }

    if (fields.featured) await clearFeaturedExcept(tx, input.eventId, now);

    const saved = await updateEventWithVersionGuard(
      tx,
      input.eventId,
      input.expectedVersion,
      { ...eventColumnsFrom(fields, times), updatedByStaffUserId: input.actor.id },
      now,
    );
    // The place names are the event's (§362), written with the row under its version; an older
    // event's English follows its Romanian via `namesAfterSave`, which needs the rows as they were.
    const announcing = request.notify || request.cancellation !== null;
    const translationsBefore = await listTranslationsForEvent(tx, input.eventId);
    const names = namesAfterSave(current, translationsBefore, placeNamesFrom(fields));
    await writePlaceNames(tx, input.eventId, names);
    await clearDiscountNoteIfNotAllowed(tx, input.eventId, saved);
    if (announcing) {
      // No words are saved here; only the place names moved, and the notice compares those.
      await announceSave(tx, {
        actor: input.actor,
        request,
        saved,
        dates: [{ before: current, after: saved, translationsBefore, translationsAfter: withPlaceNames(translationsBefore, names) }],
        now,
      });
    }
    return saved;
  });
  // Every column here is public, capacity included (`public-cache/reads.ts` files the free places
  // under events too).
  revalidatePublicContent("events");
  // The event's instants are the maintenance job's (§334).
  wakeJobs("registration-maintenance");
  return saved;
}

export type SaveEventAndTranslationsInput = {
  actor: Actor;
  eventId: string;
  /**
   * The event row's fields, or `undefined` when the actor may not edit them (an Author, §10.2).
   * `undefined` means "not part of this save", never "clear these columns".
   */
  fields?: unknown;
  /** Only needed when `fields` is present: the version the settings panel was rendered from. */
  expectedVersion?: number;
  /** One entry per language the actor may edit; a read-only language posts nothing. */
  translations: ReadonlyArray<{ translationId: string; expectedVersion: number; fields: unknown }>;
  acknowledgeLiveEdit?: boolean;
  /** Which dates of the series this save reaches (§130); "this" — the default — is the one event. */
  scope?: SeriesEditScope;
  /** "Anunță participanții despre schimbare" (§331); absent or unticked sends nothing. */
  notice?: EventNoticeRequest;
  /** Required when the save moves the event to CANCELLED (§331): the reason, and whether to tell. */
  cancellation?: EventCancellationRequest;
  /**
   * The Locul names were typed with JavaScript running (§362): the English box already followed
   * the Romanian on screen, so both are kept as posted. Absent (no JavaScript, a script, a test),
   * the server applies `place.ts#englishNameAfterSave`.
   */
  placeNamesAsTyped?: boolean;
  now?: Date;
  /** Only for tests: a `fetch` stand-in for the YouTube poster fetches, never a live default. */
  fetchImpl?: typeof fetch;
};

/** As Google Calendar asks: this date, this and the following ones, or every date of the series. */
export const SERIES_EDIT_SCOPES = ["this", "following", "all"] as const;
/**
 * Which other dates a save reaches (§130): one of the three words, or hand-ticked ids (§134) —
 * ids outside the series are ignored, none means "this".
 */
export type SeriesEditScope = (typeof SERIES_EDIT_SCOPES)[number] | { ids: readonly string[] };

/** The row's columns a series edit carries to other dates. */
const SERIES_COLUMNS = [
  "type",
  "surface",
  "eventStatus",
  "timezone",
  "mapUrl",
  // «Coordonate» travel with the map link they stand in for (§416).
  "latitude",
  "longitude",
  "routeUrl",
  // The links are the route's kin (§332): carried like the route.
  "links",
  "coHosts",
  // Not `locationName`/`locationAddress`: the place travels by what each page shows (`placesShown`,
  // §362) in `applyToSeries`. Whether it is announced travels with it (§328).
  "locationToBeAnnounced",
  // The level (§526), and the retired column's best-effort word written beside it.
  "difficulty",
  "difficultyLevel",
  "costType",
  "costAmount",
  "costUrl",
  "distanceMeters",
  "elevationGainMeters",
  // The night override (§394): "Automat" on every date lets each follow its own sunset.
  "nightOverride",
  // The run's self-declaration offer (§393), like the night override.
  "offersGroupRunDeclaration",
  "registrationMode",
  // «Se deschid în curând» (§451) travels with the opening date it stands in for.
  "registrationOpensSoon",
  "capacity",
  // The waiting-list cap (§348). No lock or allocation: raising it offers nothing, lowering it
  // removes nobody already waiting.
  "waitlistCapacity",
  // One race, one band (§173, §177).
  "bibStartNumber",
  "bibColour",
  "bibDesign",
  "confirmationOpensDaysBefore",
  "confirmationDeadlineDaysBefore",
  // One race, one age rule (§329).
  "minAge",
  // One reminder rule (§377).
  "reminderHoursBefore",
  "declarationDocumentId",
  "participantListVisibility",
  "externalProvider",
  "externalRegistrationUrl",
  // Strava and Facebook give a recurring event one address for every date, so these travel (§300).
  "stravaEventUrl",
  "facebookEventUrl",
] as const;
/** The instants: carried at the same wall-clock time on each date's own day. */
const SERIES_TIME_COLUMNS = ["startsAt", "endsAt", "raceStartsAt", "registrationOpensAt", "registrationClosesAt"] as const;
/** A translation's words; never the slug, which is a public address carrying its own date. */
const SERIES_TRANSLATION_COLUMNS = [
  "title",
  "excerpt",
  "excerptJson",
  "bodyJson",
  "rulesJson",
  "scheduleJson",
  // The route description (§387): the same course on every date.
  "routeDescriptionJson",
  "checklist",
  "coverAltText",
  // Not `locationName`: the place name is the event's (§362) and travels with the place.
  "seoTitle",
  "seoDescription",
  // The discount belongs to the race, like `costType` (§394).
  "discountNote",
] as const;

/** Equal as stored: dates by their instant, JSON by its text, null by null. */
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** An instant's calendar day on `zone`'s wall clock, as UTC midnight, for counting days between two. */
function wallDay(date: Date, zone: string): number {
  const wall = toWallTimeInput(date, zone);
  return Date.UTC(Number(wall.slice(0, 4)), Number(wall.slice(5, 7)) - 1, Number(wall.slice(8, 10)));
}

/**
 * The series edit (§130): what this save changed on one date, applied to the following dates or
 * all of them, like Google Calendar's "this and following". Only the difference travels, so a
 * date's own exceptions (another place, a cancellation) survive unless that field was edited.
 * Instants land at the same wall-clock time on each date's own day; programme rows shift with
 * them. Partners (§168) and the Strava/Facebook links (§300) travel; featured, the special mark,
 * the rule, the publication state and the slug are each date's own. Capacity is checked per date,
 * and one full date refuses the whole save, naming its day. Every touched row takes a new version,
 * in the caller's transaction.
 */
async function applyToSeries<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  input: {
    actor: Actor;
    scope: SeriesEditScope;
    before: EditableEvent;
    after: EditableEvent;
    translationsBefore: readonly EditableTranslation[];
    translationsAfter: readonly EditableTranslation[];
    /** Return each touched date as it was and as written, for its participants' notice (§331). */
    collect?: boolean;
    now: Date;
    /** The club's deadlines, read before the transaction, for the offers a raised capacity makes (§377). */
    deadlines: Deadlines;
    /**
     * The saved date's note was cleared (§394): siblings in scope must lose theirs too, even though
     * `translationChanges` sees no change when the saved date's note was already null. One silent
     * `UPDATE` for every member in scope.
     */
    discountNoteCleared?: boolean;
  },
): Promise<{ applied: number; offered: number; dates: SavedDate[] }> {
  const { before, after, now } = input;
  const dates: SavedDate[] = [];
  const sourceId = before.repeatOf ?? (before.repeatRule ? before.id : null);
  if (!sourceId) return { applied: 0, offered: 0, dates };
  if (!canEditEventFields(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not edit a series`);
  }

  const rowChanges: Partial<Record<(typeof SERIES_COLUMNS)[number], unknown>> = {};
  for (const column of SERIES_COLUMNS) {
    // Partners compared by meaning (`readCoHosts`, §169), not raw column: `null` and `[]` both mean
    // none, and a raw compare would propagate a phantom change from every legacy row.
    const differs =
      column === "coHosts"
        ? !sameValue(readCoHosts(before), readCoHosts(after))
        : !sameValue(before[column], after[column]);
    if (differs) rowChanges[column] = after[column];
  }
  const timeChanges = SERIES_TIME_COLUMNS.filter((column) => !sameValue(before[column], after[column]));
  const scheduleChanged = !sameValue(before.scheduleItems, after.scheduleItems);
  const translationChanges = input.translationsAfter.flatMap((saved) => {
    const was = input.translationsBefore.find((row) => row.id === saved.id);
    if (!was) return [];
    const changes: Partial<Record<(typeof SERIES_TRANSLATION_COLUMNS)[number], unknown>> = {};
    for (const column of SERIES_TRANSLATION_COLUMNS) {
      if (!sameValue(was[column], saved[column])) changes[column] = saved[column];
    }
    return Object.keys(changes).length > 0 ? [{ locale: saved.locale, changes }] : [];
  });
  /*
    The place (§362), compared by what each page shows, not column by column: an older event's
    first save rewrites the columns without moving the place, so nothing travels. A language whose
    place did move sends its name to every date reached; the Romanian takes `events.location_name`.
  */
  const shownBefore = placesShown(before, input.translationsBefore);
  const shownAfter = placesShown(after, input.translationsAfter);
  const placeMoved = routing.locales.filter((locale) => shownBefore[locale] !== shownAfter[locale]);
  const movedNames: PlaceNames = Object.fromEntries(
    placeMoved.map((locale) => [locale, input.translationsAfter.find((row) => row.locale === locale)?.locationName ?? null]),
  );
  if (
    Object.keys(rowChanges).length === 0 &&
    timeChanges.length === 0 &&
    !scheduleChanged &&
    translationChanges.length === 0 &&
    placeMoved.length === 0 &&
    !input.discountNoteCleared
  ) {
    return { applied: 0, offered: 0, dates };
  }

  // "following" is by this date's day before the save, so moving it does not change which dates
  // follow; ticked dates are exactly those.
  const chosen = typeof input.scope === "object" ? input.scope.ids.filter((id) => id !== before.id) : null;
  if (chosen && chosen.length === 0) return { applied: 0, offered: 0, dates };
  const members = await tx
    .select()
    .from(events)
    .where(
      and(
        or(eq(events.id, sourceId), eq(events.repeatOf, sourceId)),
        ne(events.id, before.id),
        input.scope === "following" ? gt(events.startsAt, before.startsAt) : undefined,
        chosen ? inArray(events.id, chosen) : undefined,
      ),
    );

  /*
    Only members that are not `EXTERNAL` + `PAID` after propagation lose the note (§395): a sibling
    that is so on its own keeps it. Done before the per-member loop so a later touch reads correctly.
  */
  if (input.discountNoteCleared && members.length > 0) {
    const toClear = members.filter(
      (member) =>
        !costPaidToExternalOrganizer({
          registrationMode: (rowChanges.registrationMode as EditableEvent["registrationMode"] | undefined) ?? member.registrationMode,
          costType: (rowChanges.costType as EditableEvent["costType"] | undefined) ?? member.costType,
        }),
    );
    if (toClear.length > 0) {
      await tx.update(eventTranslations).set({ discountNote: null }).where(
        inArray(
          eventTranslations.eventId,
          toClear.map((member) => member.id),
        ),
      );
    }
  }

  const zone = after.timezone;
  let applied = 0;
  let offered = 0;
  for (const member of members) {
    const days = Math.round((wallDay(member.startsAt, zone) - wallDay(before.startsAt, zone)) / 86_400_000);
    const shift = (date: Date | null) => (date ? addWallClockInterval(date, zone, { days }) : null);
    const changes: Partial<typeof events.$inferInsert> = { ...(rowChanges as Partial<typeof events.$inferInsert>) };
    for (const column of timeChanges) {
      if (column === "startsAt") changes.startsAt = addWallClockInterval(after.startsAt, zone, { days });
      else changes[column] = shift(after[column]);
    }
    if (scheduleChanged) {
      changes.scheduleItems = after.scheduleItems ? shiftScheduleItems(readScheduleItems(after.scheduleItems), zone, { days }) : null;
    }
    if (movedNames.ro !== undefined) {
      changes.locationName = after.locationName;
      changes.locationAddress = after.locationAddress;
    }

    if (typeof changes.capacity === "number") {
      await lockEventForCapacity(tx, member.id);
      const occupied = computeOccupied(await countOccupied(tx, member.id, now));
      if (changes.capacity < occupied) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `capacity: ${occupied} places are already taken on ${toWallTimeInput(member.startsAt, zone).slice(0, 10)}; capacity cannot be lowered below that`,
        );
      }
    }

    // Read before this date is written, only when a notice needs to compare (§331).
    const memberTranslationsBefore = input.collect ? await listTranslationsForEvent(tx, member.id) : [];
    let touched = false;
    // A place moved in one language still bumps the date's version: the names are guarded by the
    // event row (`writePlaceNames`).
    if (Object.keys(changes).length > 0 || placeMoved.length > 0) {
      await tx
        .update(events)
        .set({ ...changes, version: sql`${events.version} + 1`, updatedAt: now, updatedByStaffUserId: input.actor.id })
        .where(eq(events.id, member.id));
      touched = true;
      // Each date has its own queue and places (§147): the raise is measured against this date's
      // capacity, and a cancelled date offers nothing.
      if (
        "capacity" in changes &&
        capacityRaised(member, {
          eventStatus: changes.eventStatus ?? member.eventStatus,
          registrationMode: changes.registrationMode ?? member.registrationMode,
          capacity: changes.capacity ?? null,
        })
      ) {
        offered += await offerRaisedCapacity(tx, member.id, now, input.deadlines);
      }
    }
    if (translationChanges.length > 0) {
      const memberTranslations = await listTranslationsForEvent(tx, member.id);
      for (const { locale, changes: words } of translationChanges) {
        const target = memberTranslations.find((row) => row.locale === locale);
        if (!target) continue;
        await tx
          .update(eventTranslations)
          .set({ ...(words as Partial<typeof eventTranslations.$inferInsert>), version: sql`${eventTranslations.version} + 1`, updatedAt: now })
          .where(eq(eventTranslations.id, target.id));
        touched = true;
      }
    }
    if (placeMoved.length > 0) {
      await writePlaceNames(tx, member.id, movedNames);
      touched = true;
    }
    if (touched) {
      applied += 1;
      if (input.collect) {
        const [written] = await tx.select().from(events).where(eq(events.id, member.id)).limit(1);
        if (written) {
          dates.push({
            before: member,
            after: written,
            translationsBefore: memberTranslationsBefore,
            translationsAfter: await listTranslationsForEvent(tx, member.id),
          });
        }
      }
    }
  }
  return { applied, offered, dates };
}

/**
 * Whether a save gave more places (a higher number or the cap lifted) on an event that will run;
 * cancelled and widened in one press offers nothing (§147).
 */
function capacityRaised(
  before: { capacity: number | null },
  after: { eventStatus: EditableEvent["eventStatus"]; registrationMode: EditableEvent["registrationMode"]; capacity: number | null },
): boolean {
  if (after.eventStatus !== "SCHEDULED" || after.registrationMode !== "INTERNAL") return false;
  if (after.capacity === null) return before.capacity !== null;
  return before.capacity !== null && after.capacity > before.capacity;
}

/**
 * Offers the places a raised capacity adds to the waiting list at once (§147, BR-REQ-034-02
 * criterion 5), inside the save's transaction after the row is locked (AGENTS.md §10.6), so the
 * number and the offers commit together. `fillAvailableSpots` is the one thing that offers.
 * `deadlines` is read by the caller beforehand (§377), so nothing reads `platform_settings` under
 * the lock.
 */
async function offerRaisedCapacity<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  eventId: string,
  now: Date,
  deadlines: Deadlines,
): Promise<number> {
  const event = await lockEventForCapacity(tx, eventId);
  if (!event) return 0;
  return fillAvailableSpots(
    tx,
    {
      id: event.id,
      eventStatus: event.eventStatus,
      registrationMode: event.registrationMode,
      startsAt: event.startsAt,
      registrationOpensAt: event.registrationOpensAt,
      registrationOpensSoon: event.registrationOpensSoon,
      registrationClosesAt: event.registrationClosesAt,
      confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
      confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
      capacity: event.capacity,
      raceId: event.raceId,
      publishedAt: event.publishedAt,
    },
    now,
    deadlines,
  );
}

/**
 * The editor's single save: the event row and every language in one transaction (BR-REQ-051-01),
 * so there is one answer — everything is written, or a CONFLICT and nothing is. Each row keeps its
 * own version guard; a stale version on any of them throws inside the transaction and rolls back
 * the rest, since half a save is what criterion 5 exists to prevent.
 */
export async function saveEventAndTranslations<T extends Record<string, unknown>>(
  db: Database<T>,
  input: SaveEventAndTranslationsInput,
): Promise<{ appliedTo: number; offered: number; placeAnnounced: boolean; notice?: EventNoticeOutcome }> {
  const now = input.now ?? new Date();

  const [current] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such event");

  const existingTranslations = await listTranslationsForEvent(db, input.eventId);

  // Parsed before the transaction, so a malformed form never holds a row lock.
  const parsedEventFields =
    input.fields === undefined ? undefined : normalizeForMode(normalizeForType(parseOrThrow(eventFieldsSchema, ignoreHiddenFields(input.fields))));
  if (parsedEventFields) {
    if (!canEditEventFields(input.actor.role)) {
      throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not edit event details`);
    }
    await assertCoherentRegistrationBlock(db, parsedEventFields, now);
    await assertDateToBeAnnouncedAllowed(db, parsedEventFields, current);
  }
  const times = parsedEventFields ? resolveTimes(parsedEventFields, switchesAfterSave(parsedEventFields, current)) : undefined;
  // The notice and the cancellation's reason, refused like any other box (§331, §315).
  const request = readNoticeRequest(input.actor, current, parsedEventFields?.eventStatus, input.notice, input.cancellation);
  /*
    YouTube posters are fetched before the transaction (§403): `applyTranslationSave` runs behind
    `lockEventForCapacity` and fetches nothing. Write permission is asked first.
  */
  for (const submitted of input.translations) {
    const existing = existingTranslations.find((row) => row.id === submitted.translationId);
    if (existing) assertMayEdit(input.actor, current, existing);
  }
  const enrichedTranslations = await Promise.all(
    input.translations.map(async (submitted) => ({
      ...submitted,
      fields: await attachPostersToPostedTexts(db, submitted.fields, { now, fetchImpl: input.fetchImpl }),
    })),
  );
  /*
    The club's deadlines for a raised capacity's offers (§377), read before the transaction so
    `platform_settings` is never read under the event row's lock.
  */
  const deadlines = await currentDeadlines(db);

  const outcome = await db.transaction(async (tx) => {
    let savedEvent: EditableEvent = current;
    const savedTranslations: EditableTranslation[] = [];
    // The place names, when the event's fields are part of this save (§362), with an older event's
    // English following its Romanian unless the editor already did so on screen.
    const posted: PlaceNames = parsedEventFields ? placeNamesFrom(parsedEventFields) : {};
    const names: PlaceNames = input.placeNamesAsTyped ? posted : namesAfterSave(current, existingTranslations, posted);
    // Set when `clearDiscountNoteIfNotAllowed` nulled the note: the rows loaded before the
    // transaction do not see that write, and `translationsAfter` needs to.
    let discountNoteCleared = false;
    if (parsedEventFields && times) {
      await assertNobodyRegisteredForUndated(tx, parsedEventFields, current);
      /**
       * Capacity below the places taken is refused (AGENTS.md §10.6, BR-REQ-034-02 criterion 3).
       * The row is locked first — every allocation serializes on it — so a concurrent confirmation
       * waits; the version guard alone would only catch another save.
       */
      if (parsedEventFields.capacity !== null) {
        await lockEventForCapacity(tx, input.eventId);
        const occupied = computeOccupied(await countOccupied(tx, input.eventId, now));
        if (parsedEventFields.capacity < occupied) {
          throw new DomainError(
            "VALIDATION_ERROR",
            `capacity: ${occupied} places are already taken; capacity cannot be lowered below that`,
          );
        }
      }

      if (parsedEventFields.featured) await clearFeaturedExcept(tx, input.eventId, now);

      savedEvent = await updateEventWithVersionGuard(
        tx,
        input.eventId,
        input.expectedVersion as number,
        { ...eventColumnsFrom(parsedEventFields, times), updatedByStaffUserId: input.actor.id },
        now,
      );
      // Before the words, so each row a text save writes back carries its new name.
      await writePlaceNames(tx, input.eventId, names);
      // Before the translations loop: a settings-only save never runs `applyTranslationSave`, so this
      // is the only path that clears a note the new mode forbids. The flag is kept because
      // `existingTranslations` still holds the stale note in memory; without it a series save would
      // see no change and leave other dates' notes in place (§394).
      discountNoteCleared = await clearDiscountNoteIfNotAllowed(tx, input.eventId, savedEvent);
    }

    for (const submitted of enrichedTranslations) {
      const existing = existingTranslations.find((row) => row.id === submitted.translationId);
      if (!existing) throw new DomainError("NOT_FOUND", "no such event translation");

      savedTranslations.push(
        await namedUnder(`translations.${existing.locale}`, () =>
          applyTranslationSave(tx, {
            actor: input.actor,
            event: current,
            current: existing,
            expectedVersion: submitted.expectedVersion,
            fields: submitted.fields,
            acknowledgeLiveEdit: input.acknowledgeLiveEdit,
            eventType: parsedEventFields?.type ?? current.type,
            // As saved (`savedEvent` is `current` when the fields are not part of this save): the
            // same answer the gate read.
            registrationMode: savedEvent.registrationMode,
            costType: savedEvent.costType,
            now,
          }),
        ),
      );
    }

    /*
      Both languages or neither (§352), on the rows as this save leaves them, inside the transaction.
      Only when this save carries both: a save carrying one language cannot fix the other.
    */
    const savedRo = savedTranslations.find((row) => row.locale === "ro");
    const savedEn = savedTranslations.find((row) => row.locale === "en");
    if (savedRo && savedEn) assertOptionalTextsInBothLanguages({ ro: savedRo, en: savedEn });

    // More places: the difference goes to the waiting list now (§147), under the lock, uncommitted.
    let offered = capacityRaised(current, savedEvent) ? await offerRaisedCapacity(tx, savedEvent.id, now, deadlines) : 0;

    /*
      This date's languages as they now stand: rows a text save wrote back, others as loaded with the
      names written above (an Organizer's save moves the place without writing words).
    */
    const translationsAfter = withPlaceNames(existingTranslations, names).map((row) => {
      const saved = savedTranslations.find((s) => s.id === row.id) ?? row;
      return discountNoteCleared ? { ...saved, discountNote: null } : saved;
    });

    // The series' other dates, when asked (§130): after this one, so exactly what was written
    // travels, and inside the transaction, so a refused date undoes it all.
    const scope = input.scope ?? "this";
    const announcing = request.notify || request.cancellation !== null;
    let appliedTo = 0;
    const otherDates: SavedDate[] = [];
    if (scope !== "this") {
      const series = await applyToSeries(tx, {
        actor: input.actor,
        scope,
        before: current,
        after: savedEvent,
        translationsBefore: existingTranslations,
        translationsAfter,
        collect: announcing,
        now,
        deadlines,
        discountNoteCleared,
      });
      appliedTo = series.applied;
      offered += series.offered;
      otherDates.push(...series.dates);
    }
    /*
      This save announced the place (§328): it is public from this commit. Nobody is written to as a
      side effect of a save; telling the participants is the organizer's separate act.
    */
    const placeAnnounced = current.locationToBeAnnounced && !savedEvent.locationToBeAnnounced;

    /*
      Telling the participants (§331), last, when nothing is left to refuse: the messages are rows in
      this transaction, so a refused save queues nothing.
    */
    const notice = announcing
      ? await announceSave(tx, {
          actor: input.actor,
          request,
          saved: savedEvent,
          dates: [
            {
              before: current,
              after: savedEvent,
              translationsBefore: existingTranslations,
              translationsAfter,
            },
            ...otherDates,
          ],
          now,
        })
      : undefined;
    return notice ? { appliedTo, offered, placeAnnounced, notice } : { appliedTo, offered, placeAnnounced };
  });
  // A cancelled event must never read as scheduled: the cached rows go at commit (§28, §333).
  revalidatePublicContent("events");
  /*
    Any event-row change may move what the maintenance job has to do (§334); a translation's words
    move nothing it acts on.
  */
  if (parsedEventFields) wakeJobs("registration-maintenance");
  return outcome;
}

export type CreateEventInput = {
  actor: Actor;
  fields: unknown;
  now?: Date;
  /** Only for tests: a `fetch` stand-in for the YouTube poster fetches, never a live default. */
  fetchImpl?: typeof fetch;
  /**
   * Why an event created cancelled is cancelled (§448): required in both languages for
   * `CANCELLED`, ignored otherwise. Its "tell them" is ignored — nobody is registered yet.
   */
  cancellation?: EventCancellationRequest;
};

type PreparedEventCreate = {
  parsed: ReturnType<typeof normalizeForMode>;
  times: ReturnType<typeof resolveTimes>;
  translationColumns: { ro: ReturnType<typeof translationColumnsFrom>; en: ReturnType<typeof translationColumnsFrom> };
  names: PlaceNames;
  /** The reason of an event created cancelled (§448), for its audit row; null for any other status. */
  cancelledBecause: BilingualText | null;
};

/**
 * The status a new event is created with (§448): `SCHEDULED`; `CANCELLED` asking why in both
 * languages as the editor does (§331, §354), only for a role that may save the event row
 * (BR-REQ-060-01) and telling nobody; or `COMPLETED` only once the start has passed.
 */
function readCreateStatus(actor: Actor, status: EditableEvent["eventStatus"], startsAt: Date, cancellation: EventCancellationRequest | undefined, now: Date): BilingualText | null {
  if (status === "COMPLETED" && startsAt.getTime() > now.getTime()) {
    throw new DomainError("VALIDATION_ERROR", "eventStatus: an event can only be created as completed once its start has passed", ["eventStatus"]);
  }
  if (status !== "CANCELLED") return null;
  if (!canEditEventFields(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not cancel an event`);
  }
  const texts = readNoticeTexts("cancel.reason", cancellation?.reason);
  const empty = (["ro", "en"] as const).filter((language) => !isWrittenText(texts[language])).map((language) => noticeBox("cancel.reason", language));
  if (empty.length > 0) {
    throw new DomainError("VALIDATION_ERROR", `${empty.join(", ")}: say why the event is cancelled, in both languages`, empty);
  }
  return { ro: texts.ro, en: texts.en };
}

/**
 * The status of a new series date — §448's create rule applied per date, never copied from the
 * source (§483): `CANCELLED` is never inherited, `COMPLETED` only for a past start, else `SCHEDULED`.
 */
export function seriesDateStatus(sourceStatus: EditableEvent["eventStatus"], startsAt: Date, now: Date): EditableEvent["eventStatus"] {
  return sourceStatus === "COMPLETED" && startsAt.getTime() <= now.getTime() ? "COMPLETED" : "SCHEDULED";
}

/**
 * Everything a create needs from outside the database — parsing, the rule checks and every YouTube
 * poster fetch — run once before any transaction (§403). Takes a plain, non-transactional `db` so
 * no caller can run the fetches inside a transaction or under the event row's lock; only
 * `insertPreparedEvent` touches one.
 */
async function prepareEventCreate<T extends Record<string, unknown>>(
  db: Database<T>,
  input: CreateEventInput,
  now: Date,
): Promise<PreparedEventCreate> {
  if (!canCreateEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not create an event`);
  }

  const parsed = normalizeForMode(normalizeForType(parseOrThrow(newEventSchema, ignoreHiddenFields(input.fields))));
  await assertCoherentRegistrationBlock(db, parsed, now);
  // A new event has nobody registered and repeats only after it exists (`repeatEvent` asks then).
  await assertDateToBeAnnouncedAllowed(db, parsed, null);
  const times = resolveTimes(parsed, switchesAfterSave(parsed, null));
  // Created cancelled or completed (§448): judged before any fetch.
  const cancelledBecause = readCreateStatus(input.actor, parsed.eventStatus, times.startsAt, input.cancellation, now);
  // A film in any of a new event's rich texts gets the club's poster too (§403), before any transaction.
  const posterOptions = { now, fetchImpl: input.fetchImpl };
  parsed.translations.ro = await attachPostersToParsedTexts(db, parsed.translations.ro, posterOptions);
  parsed.translations.en = await attachPostersToParsedTexts(db, parsed.translations.en, posterOptions);
  // Each language's columns, checked both-or-neither (§352) then inserted as checked. The discount
  // note is gated on the cost the insert stores (`COST_TYPE_ON_CREATE` when absent).
  const discountAllowed = costPaidToExternalOrganizer({
    registrationMode: parsed.registrationMode,
    costType: parsed.costType === undefined ? COST_TYPE_ON_CREATE : parsed.costType,
  });
  const translationColumns = {
    ro: translationColumnsFrom(parsed.translations.ro, parsed.type, discountAllowed),
    en: translationColumnsFrom(parsed.translations.en, parsed.type, discountAllowed),
  };
  assertOptionalTextsInBothLanguages(translationColumns);
  // The place name per language (§362); with no English name posted, the English row uses the event's.
  const names = placeNamesFrom(parsed);

  return { parsed, times, translationColumns, names, cancelledBecause };
}

/** The insert half of a create: no network fetch, safe to run inside any transaction or savepoint. */
async function insertPreparedEvent<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  actor: Actor,
  prepared: PreparedEventCreate,
  now: Date,
): Promise<EditableEvent> {
  const { parsed, times, translationColumns, names, cancelledBecause } = prepared;
  if (parsed.featured) await clearFeaturedExcept(tx, null, now);

  const [event] = await tx
    .insert(events)
    .values({
      ...eventColumnsFrom(parsed, times, { isCreate: true }),
      editorialStatus: "DRAFT",
      createdByStaffUserId: actor.id,
      updatedByStaffUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Through the same function a save writes with (`translationColumnsFrom`).
  await tx.insert(eventTranslations).values(
    routing.locales.map((locale) => ({
      eventId: event.id,
      locale,
      ...translationColumns[locale],
      locationName: names[locale] ?? null,
      authorStaffUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    })),
  );

  /*
    Created cancelled (§448): the editor's cancellation audit row (§331), marked as told to nobody.
    A create never queues `EVENT_CANCELLED`.
  */
  if (cancelledBecause) {
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.cancelled",
      entityType: "event",
      entityId: event.id,
      metadata: { reason: cancelledBecause, notified: false, recipients: 0, version: event.version, createdCancelled: true },
      now,
    });
  }

  return event;
}

/**
 * A new event with a translation in every locale, as a DRAFT — never created published:
 * publication is a transition an Editor makes after reading the page.
 */
export async function createEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: CreateEventInput,
): Promise<EditableEvent> {
  const now = input.now ?? new Date();
  const prepared = await prepareEventCreate(db, input, now);
  const created = await db.transaction((tx) => insertPreparedEvent(tx, input.actor, prepared, now));
  // A draft shows nowhere, but a featured one just took the flag from the public lead event.
  if (prepared.parsed.featured) revalidatePublicContent("events");
  return created;
}

export type CreateAndPublishResult = {
  event: EditableEvent;
  /** Whether the event went live in the same breath. */
  published: boolean;
  /** Why it did not, when it did not — the refusal the publication guard gave, or null. */
  refusal: DomainError | null;
  /** How many dates of the series were made with it; 0 when it does not repeat. */
  repeated: number;
};

/**
 * The create form's repeat rule (§64, §170). No `publish` of its own: the series goes live when its
 * source does (§122), known only after publication has run.
 */
export type NewEventRepeatRule = Omit<RepeatEventInput["rule"], "publish"> & { publish?: boolean };

/**
 * A new event, published in the same transaction when asked (§315). Publication walks the same two
 * transitions through `transitionEvent`, so every guard applies unchanged. It runs in its own
 * savepoint: a refusal rolls it back, the draft commits, and the refusal is returned beside it so
 * the editor can say what is missing. A role that may not publish is answered before either
 * transition. The series is made in the same transaction and `repeatEvent` judges its rule once the
 * start exists; a refused rule rolls back the whole create, naming `repeat.until` or
 * `repeat.weekday`, so the form comes back as typed.
 */
export async function createEventAndPublish<T extends Record<string, unknown>>(
  db: Database<T>,
  input: CreateEventInput & { publish: boolean; repeat?: NewEventRepeatRule | null },
): Promise<CreateAndPublishResult> {
  const now = input.now ?? new Date();
  // Every poster fetch before any transaction opens (§403).
  const prepared = await prepareEventCreate(db, { actor: input.actor, fields: input.fields, now, fetchImpl: input.fetchImpl, cancellation: input.cancellation }, now);

  const result = await db.transaction(async (tx) => {
    const created = await insertPreparedEvent(tx, input.actor, prepared, now);
    const { event, published, refusal } = await publishNewEvent(tx, input.actor, created, input.publish, now);
    if (!input.repeat) return { event, published, refusal, repeated: 0 };

    // Series dates as drafts, or live when the source just went live and the rule asks (§350); a
    // caller that does not say gets "live exactly when the source is".
    const rule = { ...input.repeat, publish: input.repeat.publish ?? published };
    const series = await namedUnder("repeat", () => repeatEvent(tx, { actor: input.actor, eventId: event.id, rule, now }));
    return { event, published, refusal, repeated: series.created };
  });
  // Only after the whole create committed: a featured flag undone by a rolled-back savepoint must
  // not expire the cache. (A publish already revalidates through `transitionEvent`.)
  if (prepared.parsed.featured) revalidatePublicContent("events");
  return result;
}

/** The publication half of `createEventAndPublish`: its own savepoint, so a refusal keeps the draft. */
async function publishNewEvent<T extends Record<string, unknown>>(
  tx: Database<T>,
  actor: Actor,
  event: EditableEvent,
  publish: boolean,
  now: Date,
): Promise<Omit<CreateAndPublishResult, "repeated">> {
  if (!publish) return { event, published: false, refusal: null };

  if (!canTransitionEvent(actor.role, "IN_REVIEW", "PUBLISHED", false)) {
    return {
      event,
      published: false,
      refusal: new DomainError("FORBIDDEN", `role ${actor.role} may not publish; the event was created as a draft`),
    };
  }

  try {
    const published = await tx.transaction(async (inner) => {
      const reviewed = await transitionEvent(inner, { actor, eventId: event.id, expectedVersion: event.version, to: "IN_REVIEW", now });
      return transitionEvent(inner, { actor, eventId: event.id, expectedVersion: reviewed.version, to: "PUBLISHED", now });
    });
    return { event: published, published: true, refusal: null };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    // The savepoint rolled the two transitions back; the draft stands.
    return { event, published: false, refusal: error };
  }
}

export type DuplicateEventInput = {
  actor: Actor;
  eventId: string;
  now?: Date;
};

/**
 * The same event again, as a fresh draft. Not copied: publication, its date, the featured flag and
 * the slugs — each locale's slug gets the first free `-2`, `-3`… suffix, asked of the database,
 * since `UNIQUE(locale, slug)` would reject the copy.
 */
export async function duplicateEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: DuplicateEventInput,
): Promise<EditableEvent> {
  const now = input.now ?? new Date();

  if (!canCreateEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not duplicate an event`);
  }

  const [source] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!source) throw new DomainError("NOT_FOUND", "no such event");

  const sourceTranslations = await listTranslationsForEvent(db, input.eventId);

  const slugs = new Map<string, string>();
  for (const translation of sourceTranslations) {
    slugs.set(translation.id, await nextFreeSlug(db, translation.locale, translation.slug));
  }

  return db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(events)
      .values(copiedEventValues(source, input.actor, now))
      .returning();

    await tx.insert(eventTranslations).values(
      sourceTranslations.map((translation) =>
        copiedTranslationValues(translation, copy.id, slugs.get(translation.id) as string, input.actor, now),
      ),
    );

    return copy;
  });
}

type EventRow = typeof events.$inferSelect;
type TranslationRow = typeof eventTranslations.$inferSelect;

/**
 * Every column a copy inherits, shared by duplicating and repeating. Not inherited: publication and
 * its date, featured, the special mark (§168), and the start list, which starts HIDDEN — publishing
 * names is a decision about that event's entrants.
 */
function copiedEventValues(source: EventRow, actor: Actor, now: Date) {
  return {
    raceId: source.raceId,
    type: source.type,
    surface: source.surface,
    eventStatus: source.eventStatus,
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    raceStartsAt: source.raceStartsAt,
    // The programme's rows travel with a copy at the source's dates; a repeat shifts them.
    scheduleItems: source.scheduleItems,
    timezone: source.timezone,
    mapUrl: source.mapUrl,
    latitude: source.latitude,
    longitude: source.longitude,
    routeUrl: source.routeUrl,
    // The links travel with the route (§332), to a duplicate and to every series date.
    links: source.links,
    // Not carried by a duplicate: next year's race has its own Strava and Facebook pages. A repeat
    // puts the source's links back (§300), since both platforms keep one address per recurring
    // event. Partners are carried by both.
    stravaEventUrl: null,
    facebookEventUrl: null,
    coHosts: source.coHosts,
    // The two columns the list replaced (§168) travel too, so a legacy row's partner is not lost.
    coHostName: source.coHostName,
    coHostUrl: source.coHostUrl,
    // Never the rule: a copy is one date, and only the source repeats (§122).
    repeatRule: null,
    repeatOf: null,
    locationName: source.locationName,
    locationAddress: source.locationAddress,
    // A hidden place stays hidden on the copy (§328).
    locationToBeAnnounced: source.locationToBeAnnounced,
    // A held-back date stays held back (§533); `repeatEvent` refuses such a source, so only a
    // duplicate carries it.
    dateToBeAnnounced: source.dateToBeAnnounced,
    timeToBeAnnounced: source.timeToBeAnnounced,
    difficulty: source.difficulty,
    difficultyLevel: source.difficultyLevel,
    costType: source.costType,
    costAmount: source.costAmount,
    costUrl: source.costUrl,
    distanceMeters: source.distanceMeters,
    elevationGainMeters: source.elevationGainMeters,
    // The night override travels with the route (§394); "Automat" lets each date follow its sunset.
    nightOverride: source.nightOverride,
    // The self-declaration offer travels with the route too (§393).
    offersGroupRunDeclaration: source.offersGroupRunDeclaration,
    featured: false,
    // Nor the special mark (§168): it belongs to one edition.
    isSpecial: false,
    capacity: source.capacity,
    // The waiting-list cap goes with the places (§348).
    waitlistCapacity: source.waitlistCapacity,
    confirmationOpensDaysBefore: source.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: source.confirmationDeadlineDaysBefore,
    // The minimum age belongs to the race (§329), as it binds (§515): an older source below
    // fourteen gives the copy fourteen.
    minAge: effectiveMinimumAge(source.minAge),
    // And its reminder rule (§377).
    reminderHoursBefore: source.reminderHoursBefore,
    registrationMode: source.registrationMode,
    registrationOpensAt: source.registrationOpensAt,
    registrationOpensSoon: source.registrationOpensSoon,
    registrationClosesAt: source.registrationClosesAt,
    declarationDocumentId: source.declarationDocumentId,
    participantListVisibility: "HIDDEN" as const,
    externalProvider: source.externalProvider,
    externalRegistrationUrl: source.externalRegistrationUrl,
    editorialStatus: "DRAFT" as const,
    publishedAt: null,
    createdByStaffUserId: actor.id,
    updatedByStaffUserId: actor.id,
    createdAt: now,
    updatedAt: now,
  };
}

function copiedTranslationValues(
  translation: TranslationRow,
  eventId: string,
  slug: string,
  actor: Actor,
  now: Date,
) {
  return {
    eventId,
    locale: translation.locale,
    slug,
    title: translation.title,
    excerpt: translation.excerpt,
    excerptJson: translation.excerptJson,
    bodyJson: translation.bodyJson,
    rulesJson: translation.rulesJson,
    scheduleJson: translation.scheduleJson,
    routeDescriptionJson: translation.routeDescriptionJson,
    checklist: translation.checklist,
    coverAltText: translation.coverAltText,
    // The place's name in this language goes with the copy: the same place, the same word.
    locationName: translation.locationName,
    seoTitle: translation.seoTitle,
    seoDescription: translation.seoDescription,
    // The discount travels with the mode and cost it belongs to (both carried unchanged).
    discountNote: translation.discountNote,
    authorStaffUserId: actor.id,
    createdAt: now,
    updatedAt: now,
  };
}

export type RepeatEventInput = {
  actor: Actor;
  eventId: string;
  /** How it recurs, until when (null: for ever), and whether occurrences go live as they are made. */
  rule: { cadence: RepeatCadence; weekdays?: readonly Weekday[]; until: string | null; publish: boolean };
  now?: Date;
};

/**
 * The same event every week, fortnight or month — a standing series (§64, §122). The rule is
 * written on the source; dates inside the club's horizon (§377) are created now and the maintenance
 * job adds the rest (`materializeStandingRepeats`). Each date is the source shifted on the wall
 * clock in its own zone, its slug carrying the date, `repeat_of` naming the source. Dates are
 * drafts unless `publish` is asked (by a role that publishes) and the source is published.
 */
export async function repeatEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: RepeatEventInput,
): Promise<{ created: number; published: boolean }> {
  const now = input.now ?? new Date();

  if (!canCreateEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not repeat an event`);
  }

  const [source] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!source) throw new DomainError("NOT_FOUND", "no such event");
  // A date to be announced (§533) is a provisional note; a series would publish it on every date.
  if (startHeldBack(source)) {
    throw new DomainError("VALIDATION_ERROR", "repeat: an event whose date is to be announced cannot repeat", ["repeat"]);
  }
  if (source.repeatOf) {
    throw new DomainError("VALIDATION_ERROR", "this date is part of a series already; the series repeats from its first event");
  }

  if ((input.rule.weekdays ?? []).some((day) => !WEEKDAYS.includes(day))) {
    throw new DomainError("VALIDATION_ERROR", "weekdays: 1 (Monday) to 7 (Sunday)", ["weekday"]);
  }
  // The event's own day is always in the series (§128): the source is the first date.
  const ownWeekday = wallClockWeekday(source.startsAt, source.timezone) as Weekday;
  const weekdays =
    input.rule.cadence === "MONTHLY" || (input.rule.weekdays ?? []).length === 0
      ? []
      : [...new Set([...(input.rule.weekdays ?? []), ownWeekday])].sort((a, b) => a - b);
  /*
    The rule stores what was asked; each date goes live only while the source is live
    (`materializeSeries`). Storing the effective answer made a series started from a draft stay
    "off" for good (§350).
  */
  const publish = input.rule.publish && source.editorialStatus === "PUBLISHED";
  if (input.rule.publish && !canTransitionEvent(input.actor.role, "IN_REVIEW", "PUBLISHED", false)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not publish`);
  }
  const rule = repeatRuleSchema.safeParse({ cadence: input.rule.cadence, weekdays, until: input.rule.until, publish: input.rule.publish });
  if (!rule.success) throw new DomainError("VALIDATION_ERROR", "until: a date, or nothing for a series without an end", ["until"]);
  const end = untilEnd(rule.data, source.timezone);
  if (end && end.getTime() <= source.startsAt.getTime()) {
    throw new DomainError("VALIDATION_ERROR", "until: the end must be after this event", ["until"]);
  }

  await db.update(events).set({ repeatRule: rule.data, updatedAt: now, updatedByStaffUserId: input.actor.id }).where(eq(events.id, source.id));
  // As far ahead as the club keeps its series (§377).
  const created = await materializeSeries(db, { ...source, repeatRule: rule.data }, rule.data, input.actor, now, await currentDeadlines(db));
  // Even with every date a draft, the source's rule is public: it leaves the past events (§275).
  revalidatePublicContent("events");
  // A new rule for the maintenance job to extend (§122); it looks at its next ping (§334).
  wakeJobs("registration-maintenance");
  return { created, published: publish };
}

/**
 * The dates a source's rule still owes inside the club's horizon (§377), in one transaction. A
 * shortened horizon deletes nothing. Idempotent: each date is a whole number of periods from the
 * source, and an existing address is skipped. Usually two indexed reads and no write, so the job
 * can run it every quarter hour.
 */
async function materializeSeries<T extends Record<string, unknown>>(
  db: Database<T>,
  source: EventRow,
  rule: RepeatRule,
  actor: Actor | null,
  now: Date,
  deadlines: Pick<Deadlines, "seriesHorizonDays">,
): Promise<number> {
  const [latest] = await db
    .select({ startsAt: sql<Date | null>`max(${events.startsAt})` })
    .from(events)
    .where(eq(events.repeatOf, source.id));
  const after = latest?.startsAt ? new Date(Math.max(new Date(latest.startsAt).getTime(), source.startsAt.getTime())) : source.startsAt;
  const before = horizonEnd(rule, source.timezone, now, deadlines);
  const dates = occurrencesBetween(source, rule, after, before);
  if (dates.length === 0) return 0;

  const sourceTranslations = await listTranslationsForEvent(db, source.id);
  const publish = rule.publish && source.editorialStatus === "PUBLISHED";

  // All slugs checked before writing; a taken one means the date exists and is skipped.
  const occurrences = dates.map((startsAt) => ({
    startsAt,
    step: { days: Math.round((startsAt.getTime() - source.startsAt.getTime()) / 86_400_000) },
    slugs: new Map(
      sourceTranslations.map((translation) => [
        translation.id,
        `${translation.slug.replace(/-\d{4}-\d{2}-\d{2}$/, "")}-${startsAt.toISOString().slice(0, 10)}`,
      ]),
    ),
  }));
  const taken = new Set<string>();
  for (const translation of sourceTranslations) {
    const wanted = occurrences.map((occurrence) => occurrence.slugs.get(translation.id) as string);
    for (const slug of await findTakenSlugs(db, translation.locale, wanted)) taken.add(`${translation.locale}:${slug}`);
  }
  const fresh = occurrences.filter(
    (occurrence) => !sourceTranslations.some((translation) => taken.has(`${translation.locale}:${occurrence.slugs.get(translation.id)}`)),
  );
  if (fresh.length === 0) return 0;

  // Shifted on the wall clock (§64): a date four weeks on keeps its 08:00 across a clock change.
  const shift = (date: Date | null, occurrence: (typeof fresh)[number]) => {
    if (date === null) return null;
    const wallDays = occurrence.step.days;
    return addWallClockInterval(date, source.timezone, { days: wallDays });
  };
  const by = actor?.id ?? source.createdByStaffUserId;

  await db.transaction(async (tx) => {
    for (const occurrence of fresh) {
      const [copy] = await tx
        .insert(events)
        .values({
          ...copiedEventValues(source, { id: by ?? source.updatedByStaffUserId ?? "", role: "MODERATOR" }, now),
          // A series keeps the source's event pages (§300); a duplicate does not.
          stravaEventUrl: source.stravaEventUrl,
          facebookEventUrl: source.facebookEventUrl,
          createdByStaffUserId: by,
          updatedByStaffUserId: by,
          repeatOf: source.id,
          startsAt: occurrence.startsAt,
          // The date's own status, never the source's cancellation or completion (§483).
          eventStatus: seriesDateStatus(source.eventStatus, occurrence.startsAt, now),
          endsAt: shift(source.endsAt, occurrence),
          raceStartsAt: shift(source.raceStartsAt, occurrence),
          scheduleItems: source.scheduleItems
            ? shiftScheduleItems(readScheduleItems(source.scheduleItems), source.timezone, { days: occurrence.step.days })
            : null,
          registrationOpensAt: shift(source.registrationOpensAt, occurrence),
          registrationClosesAt: shift(source.registrationClosesAt, occurrence),
          ...(publish ? { editorialStatus: "PUBLISHED" as const, publishedAt: now } : {}),
        })
        .returning();

      await tx.insert(eventTranslations).values(
        sourceTranslations.map((translation) => ({
          ...copiedTranslationValues(translation, copy.id, occurrence.slugs.get(translation.id) as string, { id: by ?? "", role: "MODERATOR" }, now),
          authorStaffUserId: by,
        })),
      );
    }
  });

  // New dates on the listing and the calendar (§122); drafts show nowhere.
  if (publish) revalidatePublicContent("events");
  return fresh.length;
}

/**
 * Every standing series brought up to the horizon (§122), run by the maintenance job. A source
 * past its rule's end keeps the rule (shown as ended) and creates nothing.
 */
export async function materializeStandingRepeats<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  /** The club's deadlines, read once by the maintenance run (§377). */
  deadlines: Pick<Deadlines, "seriesHorizonDays">,
): Promise<{ sources: number; created: number }> {
  const sources = await db.select().from(events).where(sql`${events.repeatRule} IS NOT NULL`);
  let created = 0;
  for (const source of sources) {
    const rule = readRepeatRule(source.repeatRule);
    if (!rule) continue;
    created += await materializeSeries(db, source, rule, null, now, deadlines);
  }
  return { sources: sources.length, created };
}

/**
 * The series' source from any of its dates: itself, or its `repeat_of` (one level deep — a copy is
 * never repeated).
 */
async function seriesSourceOf<T extends Record<string, unknown>>(db: Database<T>, eventId: string) {
  const [row] = await db
    .select({ id: events.id, repeatOf: events.repeatOf })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "no such event");
  const sourceId = row.repeatOf ?? row.id;
  const [source] = await db
    .select({ id: events.id, repeatRule: events.repeatRule, editorialStatus: events.editorialStatus })
    .from(events)
    .where(eq(events.id, sourceId))
    .limit(1);
  if (!source) throw new DomainError("NOT_FOUND", "no such event");
  return source;
}

/** Stops a series: no further dates are made; existing ones stay. */
export async function stopRepeat<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; eventId: string; now?: Date },
): Promise<void> {
  if (!canCreateEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not change a series`);
  }
  // From any series date (§350): a copy's id resolves to its source.
  const source = await seriesSourceOf(db, input.eventId);
  await db
    .update(events)
    .set({ repeatRule: null, updatedAt: input.now ?? new Date(), updatedByStaffUserId: input.actor.id })
    .where(eq(events.id, source.id));
  // Without its rule a past source is history again (§275).
  revalidatePublicContent("events");
}

/**
 * Switches a series' automatic publication on or off (§341): whether dates made from now on go
 * live as made. Only the flag changes; existing dates keep their state. Turning it on needs the
 * role that publishes. A draft source is fine: the flag is stored and waits, since copies of an
 * unpublished event are drafts anyway (`materializeSeries`).
 */
export async function setRepeatPublish<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; eventId: string; publish: boolean; now?: Date },
): Promise<void> {
  if (!canCreateEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not change a series`);
  }
  // From any series date (§350).
  const source = await seriesSourceOf(db, input.eventId);
  const rule = readRepeatRule(source.repeatRule);
  if (!rule) throw new DomainError("VALIDATION_ERROR", "this series does not repeat any more; start it again from its first event");
  /*
    On while the source is a draft is stored and waits (§350): dates go live only while the source
    is live (`materializeSeries`).
  */
  if (input.publish && !canTransitionEvent(input.actor.role, "IN_REVIEW", "PUBLISHED", false)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not publish`);
  }
  // Guarded on `repeatRule` still being set: a concurrent `stopRepeat` would otherwise be undone by
  // writing the pre-stop rule back. With the guard, that race updates nothing.
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const written = await tx
      .update(events)
      .set({ repeatRule: { ...rule, publish: input.publish }, updatedAt: now, updatedByStaffUserId: input.actor.id })
      .where(and(eq(events.id, source.id), isNotNull(events.repeatRule)))
      .returning({ id: events.id });
    if (written.length === 0 || rule.publish === input.publish) return;
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "event.repeat_publish_changed",
      entityType: "event",
      entityId: source.id,
      metadata: { from: rule.publish, to: input.publish, ...(input.eventId !== source.id ? { fromDate: input.eventId } : {}) },
      now,
    });
  });
}

/** `crosul-aniversar` → `crosul-aniversar-2`, or the first suffix nobody is using. */
async function nextFreeSlug<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
  slug: string,
): Promise<string> {
  const candidates = Array.from({ length: 50 }, (_, index) => `${slug}-${index + 2}`);
  const taken = await findTakenSlugs(db, locale, candidates);
  const free = candidates.find((candidate) => !taken.has(candidate));
  if (!free) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `there are already 50 copies of "${slug}" in ${locale}; rename one before making another`,
    );
  }
  return free;
}

export type DeleteEventInput = {
  actor: Actor;
  eventId: string;
};

/**
 * Removes an event outright — Administrator only, never one anybody registered for: a registration
 * carries the privacy notice acknowledged and the declaration accepted, evidence AGENTS.md §10.8
 * keeps. Archiving is the answer for an event that happened.
 */
export async function deleteEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: DeleteEventInput,
): Promise<void> {
  if (!canDeleteEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not delete an event`);
  }

  const [current] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such event");

  const registered = await countRegistrationsForEvent(db, input.eventId);
  if (registered > 0) {
    /**
     * An event whose only registrations are test rows takes them with it (§176): the same as
     * `removeTestRegistrations` (Administrator-only, refused in production) plus delete. A single
     * real registration still blocks it (`AGENTS.md` §10.8); the message says to archive, with the
     * count.
     */
    const test = await countTestRegistrationsForEvent(db, input.eventId);
    const real = registered - test;
    if (real > 0 || !areTestRegistrationsAvailable()) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `this event has ${real} real registration(s) and cannot be deleted; archive it instead`,
      );
    }
    await removeTestRegistrations(db, input.actor, input.eventId);
  }

  // `event_translations` and a group run's self-declarations cascade (§393); their outbox rows go
  // first in the same transaction. A declaration also covering the run's other dates moves there (§523).
  await db.transaction(async (tx) => {
    await rehomeGroupRunDeclarationsOfEvent(tx, input.eventId);
    await deleteGroupRunDeclarationMessagesOfEvent(tx, input.eventId);
    await tx.delete(events).where(eq(events.id, input.eventId));
  });
  revalidatePublicContent("events");
}

export type HardDeleteEventInput = {
  actor: Actor;
  eventId: string;
  /** The event's title, as the person typed it. Anything else refuses. */
  typedTitle: string;
  /** Why — kept in the audit row, all that survives. */
  reason: string;
  now?: Date;
};

/**
 * Erases an event and everyone registered for it — the hard delete, for erasure requests and the
 * controller's own records (as `deleteRegistrationByStaff`, BR-REQ-037-06). Allowed in production
 * deliberately: §30 forbids test rows there, not erasure, and real erasures live there. The guards
 * are the role, a hand-typed title, a reason, and audit rows, with no bulk control reaching it.
 *
 * One transaction: the event's audit row first, then each registration through
 * `eraseAllRegistrationsOfEvent` (releasing its place through the allocator, taking its declaration
 * acceptance, auditing each), the event row last. `registrations.event_id` has no `ON DELETE`, so a
 * half-done erasure cannot commit. No audit row carries a name, address or identity document (§12.12).
 */
export async function hardDeleteEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: HardDeleteEventInput,
): Promise<{ registrationsErased: number }> {
  // The role first, so an unauthorized organizer is told that, not that the reason was short (BR-REQ-060-01).
  if (!canHardDeleteEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not erase an event and its registrations`);
  }

  const plan = await readEventErasurePlan(db, input.eventId);
  if (!plan) throw new DomainError("NOT_FOUND", "no such event");

  const reason = input.reason.trim();
  if (reason.length < 3) {
    // Named, so the erase form's summary points at the box (§315).
    throw new DomainError("VALIDATION_ERROR", "an erasure needs a reason; it is the only thing that survives it", ["reason"]);
  }

  /**
   * The typed confirmation: either language's title (or the id for an untitled draft), trimmed and
   * exact — a case-insensitive match would accept a half-remembered title, and the point is to be
   * impossible to satisfy by accident.
   */
  const accepted = plan.titles.length > 0 ? plan.titles.map((entry) => entry.title) : [plan.eventId];
  if (!accepted.some((title) => title.trim() === input.typedTitle.trim())) {
    throw new DomainError("VALIDATION_ERROR", "the typed title does not match this event's title", ["typedTitle"]);
  }

  const now = input.now ?? new Date();

  const erased = await db.transaction(async (tx) => {
    // First: the record of this happening, which outlives the event (`audit_logs.entity_id` has no
    // foreign key), written before anything is destroyed.
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "event.hard_deleted",
      entityType: "event",
      entityId: plan.eventId,
      metadata: {
        title: accepted[0].slice(0, 200),
        startsAt: plan.startsAt.toISOString(),
        registrations: plan.total,
        confirmed: plan.confirmed,
        real: plan.real,
        test: plan.test,
        reason: reason.slice(0, 500),
      },
      now,
    });

    const registrationsErased = await eraseAllRegistrationsOfEvent(tx, input.actor, plan.eventId, reason, now);

    // Translations and interests cascade; an album's `event_id` and a later edition's `repeat_of`
    // go null. A group run's self-declarations cascade (§393), their outbox rows first — unless the
    // run has another date, which they cover and move to (§523).
    await rehomeGroupRunDeclarationsOfEvent(tx, plan.eventId);
    await deleteGroupRunDeclarationMessagesOfEvent(tx, plan.eventId);
    await tx.delete(events).where(eq(events.id, plan.eventId));

    return { registrationsErased };
  });
  // The event, and an album pointing at it, leave the public pages (`reads.ts` files albums under both).
  revalidatePublicContent("events");
  return erased;
}
