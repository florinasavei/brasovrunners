import { and, eq, gt, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { eventTranslations, events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";
import { readCoHosts } from "@/modules/events/domain/co-hosts";
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
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { wakeJobs } from "@/modules/jobs/schedule-cache";
import { findCurrentApprovedVersionId } from "@/modules/legal-documents/repository";
import { eraseAllRegistrationsOfEvent } from "@/modules/registrations/admin-service";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import { countOccupied, countRegistrationsForEvent, countTestRegistrationsForEvent, lockEventForCapacity } from "@/modules/registrations/repository";
import { areTestRegistrationsAvailable, removeTestRegistrations } from "@/modules/registrations/test-registrations";
import { fillAvailableSpots } from "@/modules/registrations/service";
import {
  canCreateEvent,
  canDeleteEvent,
  canEditEventFields,
  canHardDeleteEvent,
  canEditTranslation,
  canTransition,
  type EditorialStatus,
  isLiveContent,
} from "@/modules/staff-identity/domain/roles";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { isBlankValue } from "@/shared/forms/blank-value";
import { type BilingualText, isWrittenText, missingLanguage, type TextLanguage } from "@/shared/forms/both-languages";
import { hasRichTextContent, richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
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
 * Creating, editing, publishing and removing events (BR-REQ-050-01, BR-REQ-051-01).
 *
 * Priority-1 code — `docs/PRACTICES.md`. Read every line.
 *
 * Three rules run through all of it:
 *
 *   1. Authorization is asserted here, on the server, for every write (BR-REQ-060-01). The
 *      acting staff user is an argument, never a session this module reads for itself, so a
 *      page cannot pass "the user I already checked" and a test needs no browser.
 *   2. A save carries the version it was loaded with. A stale one is a CONFLICT and nothing is
 *      written (BR-REQ-051-01 criterion 5). Two organizers editing one event on a Sunday
 *      morning is the ordinary case, and last-write-wins would silently discard one of them.
 *   3. Publication is one state for the whole event, and reaching it requires a complete
 *      translation in every locale (`DECISIONS.md` §28). Both languages go live together;
 *      there is no half-published event for BR-REQ-040-02 to have to describe any more.
 */

type Actor = Pick<StaffUser, "id" | "role">;

/**
 * The conflict check, in one statement — once per table that carries a version.
 *
 * `WHERE id = ? AND version = ?` with the version incremented in the same UPDATE is what makes
 * this safe, and it is worth being explicit about why. Two organizers load version 4. Both
 * submit. PostgreSQL runs the first UPDATE; the second one blocks on the row lock, and when
 * the first commits it re-evaluates its WHERE clause against the *committed* row — now version
 * 5 — which no longer matches. It updates nothing, `RETURNING` yields no row, and the second
 * organizer is told their copy is stale.
 *
 * Reading the version and then updating in two statements would pass every single-threaded
 * test and lose an edit the first time two people saved within the same second.
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

  // Nothing was written. Either the row is gone, or somebody else saved first — and the two
  // deserve different answers, so the caller can say "reload and reapply your changes" for
  // one and "this event no longer exists" for the other.
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
 * Featuring an event un-features the previous one, in the caller's transaction.
 *
 * The database is the guarantee — a partial unique index refuses a second featured row — and
 * this clear is the mechanism that keeps the guarantee from simply rejecting every save. Both
 * statements are in one transaction so there is never an instant with none, and never a clear
 * that survives a failed set. Creating and duplicating go through it for the same reason a save
 * does: "remembering" to clear the flag is a race between two organizers, not a rule.
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
 * Every instant the form carries, resolved in the event's own timezone and checked against each
 * other before the database sees them.
 *
 * The CHECK constraints are what actually hold — a seed and a hand-written `UPDATE` reach the
 * same columns — but an organizer deserves a sentence rather than a constraint violation, and
 * the two are independently tested for exactly that reason.
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

function resolveTimes(fields: EventFieldsInput): ResolvedTimes {
  const zone = fields.timezone;

  // Every refusal here names its field (§47, §315): the form links the sentence to the box.
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

  const startsAt = required(fields.startsAtWallTime, "startsAt");
  // A duration wins over an end time when both arrive: it is what the form asks for now.
  const endsAt =
    fields.durationMinutes != null
      ? new Date(startsAt.getTime() + fields.durationMinutes * 60_000)
      : optional(fields.endsAtWallTime, "endsAt");
  // A gun time is a race's (§71): on any other type the field is hidden and its value ignored.
  const raceStartsAt = fields.type === "RACE" ? optional(fields.raceStartsAtWallTime, "raceStartsAt") : null;
  const registrationOpensAt = optional(fields.registrationOpensAtWallTime, "registrationOpensAt");
  const registrationClosesAt = optional(fields.registrationClosesAtWallTime, "registrationClosesAt");

  /**
   * The programme's rows (§117). A row left blank in every box is the editor's spare line and
   * is dropped; anything else must say when, and what in both languages — the page shows the
   * rows in either language, so a label in one is a row missing from the other. The end, when
   * given, is a time on the same day, at or after the start.
   */
  const scheduleItems = fields.scheduleRows
    .map((row, index) => {
      const blank = !row.date && !row.time && !row.endTime && !row.ro && !row.en && !row.place;
      if (blank) return null;
      const name = `schedule[${index + 1}]`;
      // The field paths name the row as the form posts it, zero-based (`scheduleRows.<i>.<box>`).
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
 * The combinations AGENTS.md §10.1 and §12.3 forbid, refused with a sentence.
 *
 * Each of these is also a CHECK on the table, and neither is redundant: the constraint is the
 * guarantee, this is the message. The one rule that exists only here is the declaration —
 * §12.3 requires an approved declaration on an internal event, and it cannot be a CHECK because
 * "approved" lives in another table.
 */
async function assertCoherentRegistrationBlock<T extends Record<string, unknown>>(
  db: Database<T>,
  fields: EventFieldsInput,
  now: Date,
): Promise<void> {
  // Every refusal names the boxes it is about (§47, §315), so the form can link to them.
  if (fields.registrationMode !== "INTERNAL") {
    // The waiting list's length is the places' kin (§348): nothing queues on an event that takes
    // no registrations here, so a number left in its box is refused with the capacity's sentence.
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
      // For NONE there are no participants to list, and for EXTERNAL the people who entered are
      // the other organizer's — the club holds no registrations for them (BR-REQ-039-01).
      throw new DomainError(
        "VALIDATION_ERROR",
        "a start list can only be published for an event that takes registrations here",
        ["participantListVisibility"],
      );
    }

    /**
     * `AGENTS.md` §10.10, `DECISIONS.md` §32, §346: the disclosure MUST NOT be switched on
     * before the approved privacy notice describes it. §32 recorded the rule and left it
     * unenforced because no environment had an approved notice at all yet, so nothing could be
     * blocked — that stopped being true on 2026-09-22, when production approved one. The check
     * asks the same question `legal-documents/service.ts` asks for "in force" — approved,
     * effective by now, never withdrawn — and by key alone, the same way `declarationNone`
     * reads the environment rather than one locale: an event is publishable only with both
     * languages complete (§28), so a notice missing from one language is not a state a public
     * disclosure should be allowed to launch from either.
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

/** The columns of `events` a form writes, in one place, so create and save cannot drift. */
function eventColumnsFrom(fields: EventFieldsInput, times: ResolvedTimes) {
  return {
    type: fields.type,
    surface: fields.surface,
    eventStatus: fields.eventStatus,
    timezone: fields.timezone,
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    raceStartsAt: times.raceStartsAt,
    scheduleItems: times.scheduleItems.length > 0 ? times.scheduleItems : null,
    mapUrl: fields.mapUrl,
    routeUrl: fields.routeUrl,
    // No form posts a film any more (a film is a figure in the description, §266), and a
    // column nobody mentioned is a column nobody may erase: the stored link of an older event
    // survives every save. Only a caller that says `videoUrl` writes it.
    ...(fields.videoUrl === undefined ? {} : { videoUrl: fields.videoUrl }),
    stravaEventUrl: fields.stravaEventUrl,
    facebookEventUrl: fields.facebookEventUrl,
    // The partners as a list (§168). `co_host_name`/`co_host_url` are not written here any
    // more and not read anywhere: they hold whatever they held until a later contraction
    // drops them, and `readCoHosts` prefers the list whenever the row has one — which is why
    // an editor that removed every partner must write `[]` rather than null.
    //
    // A caller that said nothing about the partners writes no column at all (§169): `[]`
    // would be indistinguishable from "remove them", and on a row saved before the list
    // existed that would erase the partner its two old columns still hold.
    ...(fields.coHosts === undefined ? {} : { coHosts: fields.coHosts }),
    // "Linkuri și fișiere" (§332), by the same discipline: a caller that said nothing writes
    // nothing. An empty list is written as null, not `[]` — unlike the partners there is no
    // older column for `[]` to shadow, and one value for "none" means a series edit never
    // reports a change between a row that never had links and one whose links were removed.
    ...(fields.links === undefined ? {} : { links: fields.links.length > 0 ? fields.links : null }),
    // Whatever was typed is written even while the place is to be announced (§328): it is kept
    // for staff and shown the moment the switch goes off, and no public reader is handed it.
    locationName: fields.locationName,
    locationAddress: fields.locationAddress,
    locationToBeAnnounced: fields.locationToBeAnnounced,
    difficulty: fields.difficulty,
    costType: fields.costType,
    // Absent means this caller is not editing the cost fields (§343), the discipline `links`
    // and `bibDesign` follow — the editor always posts both, so a save from it writes whatever
    // is in the boxes even while the chosen kind does not need one of them.
    ...(fields.costAmount === undefined ? {} : { costAmount: fields.costAmount }),
    ...(fields.costUrl === undefined ? {} : { costUrl: fields.costUrl }),
    distanceMeters: fields.distanceMeters,
    elevationGainMeters: fields.elevationGainMeters,
    featured: fields.featured,
    isSpecial: fields.isSpecial,
    registrationMode: fields.registrationMode,
    capacity: fields.capacity,
    // The waiting list's length (§348), by the partners' discipline: a caller that said nothing
    // about it — a fixture, a caller from before it existed — writes nothing, so no save lifts a
    // limit the organizer set just by not mentioning it. The editor and the create form post it.
    ...(fields.waitlistCapacity === undefined ? {} : { waitlistCapacity: fields.waitlistCapacity }),
    // The race's band (§173): where its numbers start and what colour they print. Both were
    // parsed and validated by `fields.ts` from the day they were added and then dropped here,
    // so the editor's two controls posted into nothing — caught by review (§177).
    bibStartNumber: fields.bibStartNumber,
    bibColour: fields.bibColour,
    /*
      The rest of the bib's design (§249), and the same discipline the partners' list above
      follows: a caller that said nothing writes no column at all.

      A checkbox that is off posts nothing, so a form without the design panel — the create
      form, an older caller, a test fixture — would otherwise read as "every switch off" and
      silently redesign a bib nobody had touched.
    */
    ...(fields.bibDesign === undefined ? {} : { bibDesign: fields.bibDesign }),
    confirmationOpensDaysBefore: fields.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: fields.confirmationDeadlineDaysBefore,
    // Who may enter, counted on the event's day at every door (§329).
    minAge: fields.minAge,
    registrationOpensAt: times.registrationOpensAt,
    registrationClosesAt: times.registrationClosesAt,
    declarationDocumentId: fields.declarationDocumentId,
    participantListVisibility: fields.participantListVisibility,
    externalProvider: fields.externalProvider,
    externalRegistrationUrl: fields.externalRegistrationUrl,
  };
}

/**
 * A group run takes no registrations (`DECISIONS.md` §111): whatever the form posted for the
 * block it does not show — the fields stay in the document, hidden, so a run that was once a
 * race still posts INTERNAL — the row is written as an event one simply turns up to. The same
 * shape as the gun time on anything but a race (§71): ignored, not refused, because the
 * organizer cannot see the field a refusal would name.
 */
function normalizeForType<T extends EventFieldsInput>(fields: T): T {
  if (takesRegistrations(fields.type)) return fields;
  return keepUnsentWaitlist(fields, { ...fields, ...TURN_UP_FIELDS });
}

/**
 * The waiting list's length is written only by a caller that sent it (§350, the waiting-list
 * cap): a hidden block stores null in its place when the form posted the box, and nothing at all
 * when it did not — so a save that never mentioned the limit never lifts it.
 */
function keepUnsentWaitlist<T extends EventFieldsInput>(fields: T, normalized: T): T {
  return fields.waitlistCapacity === undefined ? { ...normalized, waitlistCapacity: undefined } : normalized;
}

/** What a turn-up type is written with, whatever the hidden block posted (§111). */
const TURN_UP_FIELDS = {
  // No programme rows on a turn-up type either (§111, §117).
  scheduleRows: [],
  registrationMode: "NONE",
  capacity: null,
  // A turn-up event queues nobody (§350, the waiting-list cap).
  waitlistCapacity: null,
  declarationDocumentId: null,
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  participantListVisibility: "HIDDEN",
  externalProvider: null,
  externalRegistrationUrl: null,
} as const;

/**
 * What the chosen registration mode hides is ignored, not refused (§350, extending §111's shape
 * to the mode): the editor's "Participare și înscrieri" box shows only the fields of the chosen
 * mode (`OnlyForMode`) and keeps the others in the document, hidden, so switching back finds what
 * was typed. A capacity left behind a switch to "Fără înscrieri" is a box the organizer can no
 * longer see — refusing the save over it would name a field that is not on the screen.
 *
 * So: not here → no capacity, no waiting-list length, no declaration, no public list; not
 * elsewhere → no organizer's name or link. The window, the confirmation days, the minimum age and
 * the bib band are kept whatever the mode, so a switch back restores them.
 * `assertCoherentRegistrationBlock` stays as the guarantee for anything that reaches the service
 * another way.
 */
export function normalizeForMode<T extends EventFieldsInput>(fields: T): T {
  return keepUnsentWaitlist(fields, { ...fields, ...hiddenByMode(fields.registrationMode) });
}

/** What "Pe site" alone shows, and what "La organizator" alone shows — as the values stored in their place. */
const INTERNAL_ONLY_FIELDS = { capacity: null, waitlistCapacity: null, declarationDocumentId: null, participantListVisibility: "HIDDEN" } as const;
const EXTERNAL_ONLY_FIELDS = { externalProvider: null, externalRegistrationUrl: null } as const;

function hiddenByMode(mode: "NONE" | "INTERNAL" | "EXTERNAL") {
  return { ...(mode === "INTERNAL" ? {} : INTERNAL_ONLY_FIELDS), ...(mode === "EXTERNAL" ? {} : EXTERNAL_ONLY_FIELDS) };
}

/**
 * The same two rules on the form **as posted**, before the schema reads it (§350, found by
 * review). Applied only after parsing, "ignored, not refused" held for what was left blank and not
 * for what was left wrong: a link typed as `www.club.ro` under "La organizator" and then hidden by
 * a switch to "Pe site" still reached `httpsUrl`, and the refusal named a box that was not on the
 * screen — the exact case the rules exist for. So a box the chosen type or mode hides is replaced
 * by the value it would be stored as before anything checks it; what it held is never read.
 *
 * Only keys the caller sent are replaced, so a strict schema is never handed one it did not ask
 * for, and an unknown type or mode is left alone for the schema to name. What both modes keep —
 * the window's two days, the minimum age, the bib band — is checked as typed, because it is
 * stored as typed; a refusal over one of those is brought on screen by the form (`OnlyForMode`).
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
    The place behind "Locația se anunță mai târziu" (§328; §350, the editor's boxes, found by
    re-review): hidden with the switch on, and kept — a venue and a map link typed before the
    switch went on are saved as typed, never published. But a map link that is not one cannot be
    stored, and refusing the save over it names a box the switch hides: it is written as no link,
    exactly as a blank box would be. Switched off, the box is on screen and checked as typed.
  */
  if (posted.locationToBeAnnounced === true && "mapUrl" in replaced && !eventFieldsSchema.shape.mapUrl.safeParse(replaced.mapUrl).success) {
    replaced.mapUrl = "";
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
 * A part's refusal, naming its boxes the way the one form that carries it posts them (§315).
 *
 * `translationFieldsSchema` speaks for one language, so its paths are bare (`title`); the editor
 * carries both languages in one form, as `translations.<locale>.title`. Without the language the
 * summary could not say which tab to open, and `form-names.ts` would read a bare `title` as an
 * event column. The same for the repeat rule on the create form: `repeatEvent` names `until`, and
 * the form posts `repeat.until`. Only the field names change — the code and the message are the
 * refusal's own.
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

/** Each language's name for the place as one save of the event's fields leaves it; a language absent here is not being edited. */
type PlaceNames = Partial<Record<Locale, string | null>>;

/**
 * The Locul box's names, by language (§362; the owner: "There is some redundance on this meeting
 * spot location"). The place is asked once per language, and the Romanian box is also the event's
 * own meeting point, so it is always part of the event's fields; the English one only when the
 * caller posted it — absent, the English row keeps what it holds (an older caller, a fixture).
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
 * The names written to each language's row, inside the event save's transaction (§362).
 *
 * Not a translation save, and deliberately so: the place is the event's — the Organizer's, who
 * sets the place and may not write the words (§207) — so this runs under the event row's version
 * guard, which the save has just checked and bumped, and the rows' own versions do not move. A
 * text save cannot write the column any more (`translationFieldsSchema` has no `locationName`),
 * so there is no second writer to race with, and a Redactor's save in the same minute, carrying
 * the row versions it was rendered with, is not refused over a place it never touched.
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

/** The rows as `writePlaceNames` left them, without reading them again. */
function withPlaceNames(rows: readonly EditableTranslation[], names: PlaceNames): EditableTranslation[] {
  return rows.map((row) => {
    const name = names[row.locale];
    return name === undefined ? row : { ...row, locationName: name };
  });
}

/** The place each language's page shows (§362), the street address folded in: what a series edit compares. */
function placesShown(event: EditableEvent, rows: readonly EditableTranslation[]): Record<Locale, string> {
  return Object.fromEntries(
    routing.locales.map((locale) => [locale, placeShown(event, rows.find((row) => row.locale === locale)?.locationName)]),
  ) as Record<Locale, string>;
}

/**
 * The names one save writes, an older event's English following its Romanian (§362, found by
 * review; `place.ts#englishNameAfterSave`). Without it, an older event whose organizer moved only
 * the Romanian box stored the old place as its English name — and a series save carried the new
 * Romanian to every other date, whose English pages follow it, while this date's English page
 * kept the old meeting point. `rows` are this date's languages as loaded, before the save.
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
   * BR-REQ-051-01 criterion 4. The form warns before a save that changes what the public can
   * read right now, and the server refuses the save unless the warning was answered — a
   * warning nothing checks is decoration.
   */
  acknowledgeLiveEdit?: boolean;
  now?: Date;
};

/**
 * One translation's checks and its guarded write, against whatever database handle the caller
 * holds — a transaction, when the whole-event save is running.
 *
 * Extracted so the single-translation entry point and the one-form save cannot drift: the slug
 * rule, the live-edit acknowledgement and the authorship rule are written once and both paths
 * run them.
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
    /** The type the event has after this save — the form's, when the settings are saved too. */
    eventType: EditableEvent["type"];
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

  const fields = parseOrThrow(translationFieldsSchema, input.fields);

  /**
   * AGENTS.md §11.5: a slug is editable before first publication and stable afterwards.
   *
   * Keyed on the event's `published_at`, which is set once and never cleared, rather than on
   * the current status — unpublishing must not hand back an editable slug for a URL people have
   * already followed and search engines have already indexed. §11.5 allows an Administrator an
   * exceptional change with a redirect plan; there are no redirects yet, so there is no
   * exception yet either.
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
      ...translationColumnsFrom(fields, input.eventType),
      // A row nobody has claimed becomes the saver's — the seeded rows have no author, and
      // "their own drafts" needs one for the rule to mean anything. An existing author is
      // never overwritten: an Editor fixing a typo does not take the piece.
      authorStaffUserId: input.current.authorStaffUserId ?? input.actor.id,
    },
    input.now,
  );
}

/**
 * The columns of `event_translations` one language's fields write, in one place, so the create
 * and the save cannot drift — `eventColumnsFrom`'s sibling for the words. The create form
 * renders the editor's own language panel now, so what it posts is what a save posts, and
 * "the excerpt is the summary's words" has to be true from the first insert rather than from
 * the first save.
 *
 * The rich excerpt, when the editor posted one, and its words as the plain `excerpt` — the
 * listing card, the meta description and the publish check all read the plain column
 * (`DECISIONS.md` §73). An editor that posted nothing leaves the plain text as typed. A field
 * the caller did not post at all is `undefined` here, which a save leaves as it is and an
 * insert leaves at the column's default.
 */
function translationColumnsFrom(fields: TranslationFields, eventType: EditableEvent["type"]) {
  const { body, rules, schedule, excerptBody, ...columns } = fields;
  const excerptJson = hasRichTextContent(excerptBody) ? excerptBody : null;
  return {
    ...columns,
    excerpt: excerptJson ? richTextToPlainText(excerptJson).replace(/\s+/g, " ").trim().slice(0, 500) || null : columns.excerpt,
    excerptJson,
    bodyJson: body,
    rulesJson: hasRichTextContent(rules) ? rules : null,
    // A group run has no programme (§111): the editor hides the field, and this is what
    // holds when the type changed in the same save or the hidden field still posted text.
    scheduleJson: hasProgramme(eventType) && hasRichTextContent(schedule) ? schedule : null,
  };
}

/** The optional texts of one language, as the row will hold them — the columns, not the posted boxes. */
type OptionalTextColumns = {
  bodyJson?: unknown;
  rulesJson?: unknown;
  scheduleJson?: unknown;
  checklist?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

/**
 * Whether each optional text of one language says something, keyed by the name its box posts.
 * A rich text is read by the rule the editor's "· incomplet" marks use (`isBlankValue`, §350), so
 * a tab the page marks unfinished and a text the save refuses are always the same text.
 */
function writtenOptionalTexts(row: OptionalTextColumns) {
  const writtenDoc = (doc: unknown) => doc !== null && doc !== undefined && !isBlankValue(JSON.stringify(doc));
  return {
    body: writtenDoc(row.bodyJson),
    rules: writtenDoc(row.rulesJson),
    schedule: writtenDoc(row.scheduleJson),
    checklist: isWrittenText(row.checklist),
    seoTitle: isWrittenText(row.seoTitle),
    seoDescription: isWrittenText(row.seoDescription),
  };
}

/**
 * Both languages or neither, for the event's optional texts (§352; the owner: "I want
 * multi-lingual, always"): the description, the rules, the programme's notes, what to bring, and
 * the two search-engine overrides. Each is optional; none may be written in one language and left
 * empty in the other. Refused on the empty side's box (`translations.<locale>.<field>`), so the
 * summary links to the language still owed and brings its tab forward.
 *
 * Read on the columns as they will be stored, after `translationColumnsFrom`: a programme note on
 * a group run is not stored (§111) and so cannot be refused, which is "a hidden box never blocks
 * the save" (§350) for this rule too.
 *
 * Three texts are deliberately not here. The title and the page address are required in both
 * languages at every save already (`translationFieldsSchema`). The summary is required in both
 * before publication (§28) and may be half-written in a draft, the way a title may not. And the
 * place's name is required in both languages by the event's own schema since §362 (`placeRule`),
 * where the switch that excuses it (§328) is known.
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

  const saved = await applyTranslationSave(db, {
    actor: input.actor,
    event: record.event,
    current: record.translation,
    expectedVersion: input.expectedVersion,
    fields: input.fields,
    acknowledgeLiveEdit: input.acknowledgeLiveEdit,
    eventType: record.event.type,
    now,
  });
  // The public pages read events from a cache (§333); every write below says so the same way.
  revalidatePublicContent("events");
  return saved;
}

// --- Publication ----------------------------------------------------------------------------

/**
 * What PUBLISHED requires, and why it cannot be a database constraint.
 *
 * Every locale the site serves must have a translation row, and each of those rows must carry
 * every field a public page renders in that language (`fields.ts`
 * `REQUIRED_PUBLIC_TRANSLATION_FIELDS`). A CHECK sees one row; this sees the set, which is
 * exactly the thing being asserted — so it is asserted here, and the CHECKs assert the halves
 * they can see honestly: a published event has a publication date, and a translation's required
 * fields are not blank strings.
 */
/**
 * What the *event* itself is missing before it can be published (`DECISIONS.md` §36, §362): a
 * meeting point in every language, named by the Locul box that asks for it (`locationName` for
 * Romanian, `locationNameEn` for English) — a missing English place is refused like any other
 * missing translation.
 *
 * A language's place is what its page would show (`placeNameIn`): its own name, else the event's.
 * Every save through the editor writes both; the fallback speaks for an event nobody has saved
 * since §362, whose English page has always shown the event's name — so such an event is not
 * refused for an English name it never needed, and a row with no meeting point at all (written
 * before the column existed) is refused in both languages. Without the rows, the event's own
 * column answers for every language.
 *
 * An event whose place is to be announced (§328) is complete without one: every public surface
 * says "Locația se anunță în curând" instead, which is a whole answer to "where", and publishing
 * the race before the venue is settled is exactly what the switch is for.
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
 * Move one event through the editorial workflow (AGENTS.md §11.2, as amended by
 * `DECISIONS.md` §28).
 *
 * Publication is per event, not per locale: this acts on the `events` row, so Romanian and
 * English go live in the same moment and neither language can be serving a stub while the other
 * is public — the state BR-REQ-040-02's old wording had to describe.
 *
 * A transition carries a version too. Publishing what you think is a reviewed draft, when a
 * colleague has rewritten it since you opened the page, is the same failure as overwriting it.
 */
export async function transitionEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: TransitionEventInput,
): Promise<EditableEvent> {
  const now = input.now ?? new Date();

  const [current] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such event");

  const translations = await listTranslationsForEvent(db, input.eventId);
  // An Author may submit their own draft. The event carries no author of its own, so "own" is
  // read the only way it can be: every translation that has an author names this one.
  const authored = translations.filter((row) => row.authorStaffUserId !== null);
  const isOwnDraft =
    authored.length > 0 && authored.every((row) => row.authorStaffUserId === input.actor.id);

  if (!canTransition(input.actor.role, current.editorialStatus, input.to, isOwnDraft)) {
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

    // First publication stamps the date. Later ones do not touch it: it is what slug stability
    // and the sitemap's `lastModified` both read, and re-stamping would claim the page is new
    // every time a typo is fixed.
    if (current.publishedAt === null) changes.publishedAt = now;
  }

  const moved = await updateEventWithVersionGuard(db, input.eventId, input.expectedVersion, changes, now);
  // Published, unpublished, archived: the listing, the page, the calendar and the feeds change.
  revalidatePublicContent("events");
  // And the announcements of §146 wait on publication, so the maintenance job looks again at its
  // next ping (§334).
  wakeJobs("registration-maintenance");
  return moved;
}

// --- Telling the participants (§331) --------------------------------------------------------

/**
 * One of the organizer's texts as the form posts it: a box per language (§354, bilingual
 * everywhere), either of which may be missing from a caller that did not draw it.
 */
export type EventNoticeTextInput = { ro?: string | null; en?: string | null };

/** "Anunță participanții despre schimbare", as the editor's save posts it: the box, and the optional note in both languages. */
export type EventNoticeRequest = { notify: boolean; note?: EventNoticeTextInput | null };

/** Why the event is being cancelled, in both languages, and whether its participants are told (the box starts ticked). */
export type EventCancellationRequest = { reason: EventNoticeTextInput; notify: boolean };

/**
 * What the save told the participants, for the banner that follows it. Absent when the save was
 * asked for nothing: the box unticked, and the event not cancelled by it.
 *
 * - `update` — "details updated" queued for this many real registrations (test ones are told but
 *   never counted, `AGENTS.md` §12.6), across every date the save reached.
 * - `nothingToTell` — the box was ticked, but nothing a runner plans by changed and no note was
 *   written, so nothing was sent; the banner says so rather than letting the tick look ignored.
 * - `cancelled` — the save cancelled the event (or dates of its series); `queued` messages when
 *   the organizer left "tell them" ticked, none when they did not.
 * - `cancelledNobodyToTell` — the save cancelled an event that takes no registrations here (a
 *   group run, or the organizer's own page), so the editor drew no "tell them" box and nobody was
 *   written to. Said apart so the banner does not blame a box that was never on the page.
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
 * One of the organizer's texts, each language read by the notice rule on its own (plain text, at
 * most five hundred characters). A language over the ceiling is refused on its own box; the two
 * are returned as read, `""` for a box left empty.
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
 * The notice and the cancellation, checked before any row is locked (§331).
 *
 * **Both languages** (§354, bilingual everywhere; the owner: "I want multi-lingual, always").
 * Every registrant is written to in their own language, so the note and the reason are typed
 * twice, Română and English side by side. The note is optional in both at once: written in both,
 * or in neither — one side only is refused on the empty box, the rest of the form kept (§315). The
 * reason was required, so it is required in both: each empty box is named.
 *
 * **Cancelling asks why.** A save that moves the event to `CANCELLED` must carry a reason: it
 * goes to the participants when they are told, and into the audit trail whether or not they are
 * — the owner reads "who cancelled the race, and why" there months later. Refused with the box
 * named, so the form comes back with everything else still typed (§315).
 *
 * **Only whoever may save the event row may tell its participants** (BR-REQ-060-01): the same
 * gate as the settings (`canEditEventFields`). A Redactor, who writes the words and not the
 * facts, sees no box; one who posts it anyway is refused here, whatever the page drew.
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

  // Only a note somebody asked to send is read: unticked, the boxes are ignored, as before.
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
 * Tell one date's participants what the save did to it, inside the save's transaction (§331).
 *
 * A date the save cancelled gets `EVENT_CANCELLED` — when the organizer left the box ticked —
 * and an audit row naming who and why either way. A date that is still on and whose place, start
 * or programme moved, or that is on again, gets `EVENT_UPDATE_NOTICE` when the box was ticked;
 * with nothing of that kind changed it still goes when the organizer wrote a note, because a
 * note is a thing they chose to say. A date that is cancelled or over is not told about an edit:
 * it is not happening.
 *
 * Registrations are not touched. A cancelled event's registrations keep their status as the
 * record of who had entered; nothing is cancelled on the runner's behalf, and a reinstated event
 * finds its queue where it left it.
 *
 * `alreadyStarted` is a date of the series other than the one being edited that had begun before
 * the save (`announceSave`): nobody is written to about it, but a cancellation of it is still
 * recorded — who, why, marked as told to nobody — because the audit trail is one row per date
 * the save cancelled, whatever the date.
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
      // Who, why, and whether the participants were told — the count, never who they are (§12.12).
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
      An event that takes no registrations here had no "tell them" box on the page (the editor
      draws it for `INTERNAL` only), so "not told because the box was unticked" would name a box
      nobody saw. Judged on the mode the page was drawn from, and only when nothing was queued:
      a row left from an earlier mode that was written to is reported as told.
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

/**
 * Every date's answer as the one the banner gives: a cancellation first (one with a box before
 * one without), then messages sent, then "nothing to tell".
 */
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
 * Tell every date the save reached (§331): this one, then each date of the series it carried
 * the change to — each date's own registrants once, about their own date. The save is named by
 * the event that was saved and the version it now has, so a retried press queues nothing twice.
 *
 * Another date of the series that has already begun is not told anything: "every date" reaches
 * last month's too (§130), and a runner who ran it is owed no "details updated" and no "it is
 * cancelled" about a morning that is over. Its cancellation is still audited, and it is left out
 * of the banner's count, which is of messages. The date being edited is always told when asked —
 * the organizer is looking at it, and a race called off at the start line is still news.
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
 * Every column an organizer owns: the type and the surface, the status, the times and the
 * timezone, the map link and the route link, the distance and the climb, the featured flag, and
 * the whole registration block.
 *
 * Editorial control of what the club advertises, so an Author is refused (§10.2). The times
 * arrive as wall-clock strings and are interpreted in the event's own timezone — never the
 * server's, which is UTC on Vercel and something else on the organizer's laptop.
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
  const times = resolveTimes(fields);
  // The same rule as the editor's save (§331): a cancellation says why, and tells whom it was asked to.
  const request = readNoticeRequest(input.actor, current, fields.eventStatus, input.notice, input.cancellation);

  /**
   * Lowering capacity below the places already taken is refused (AGENTS.md §10.6,
   * BR-REQ-034-02 criterion 3). Counted here rather than trusted from a cached figure, behind
   * the event row's lock — the serialization point every allocation takes — so a confirmation
   * landing between the count and the write waits rather than slipping past it.
   */
  const saved = await db.transaction(async (tx) => {
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
    // The place's name in each language is the event's (§362): written with the row, under its version.
    // An older event's English name follows its Romanian one when only the Romanian moved, which
    // needs the rows as they were (`namesAfterSave`) — the notice compares the same rows.
    const announcing = request.notify || request.cancellation !== null;
    const translationsBefore = await listTranslationsForEvent(tx, input.eventId);
    const names = namesAfterSave(current, translationsBefore, placeNamesFrom(fields));
    await writePlaceNames(tx, input.eventId, names);
    if (announcing) {
      // No words are saved here; only the place's names moved, and the notice compares those.
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
  // Every column here is on a public page, the capacity included (the free places are expired
  // with the events: `public-cache/reads.ts` files them under both).
  revalidatePublicContent("events");
  // As in `saveEventAndTranslations`: the event's instants are the maintenance job's (§334).
  wakeJobs("registration-maintenance");
  return saved;
}

export type SaveEventAndTranslationsInput = {
  actor: Actor;
  eventId: string;
  /**
   * The event row's fields, or `undefined` when the actor may not edit them.
   *
   * An Author may write the text of their own draft and may not touch the event row (§10.2), so
   * the editor renders no settings fields for them and this save writes none. `undefined` means
   * "not part of this save" and never "clear these columns".
   */
  fields?: unknown;
  /** Only needed when `fields` is present: the version the settings panel was rendered from. */
  expectedVersion?: number;
  /** One entry per language the actor may edit; a read-only language posts nothing. */
  translations: ReadonlyArray<{ translationId: string; expectedVersion: number; fields: unknown }>;
  acknowledgeLiveEdit?: boolean;
  /** Which dates of the series this save reaches (§130); "this" — the default — is the one event. */
  scope?: SeriesEditScope;
  /** "Anunță participanții despre schimbare" (§331); absent or unticked sends nothing, as before. */
  notice?: EventNoticeRequest;
  /** Required when the save moves the event to CANCELLED (§331): the reason, and whether to tell. */
  cancellation?: EventCancellationRequest;
  /**
   * The Locul box's names were typed in the editor with JavaScript running (§362, found by
   * re-review): its English box already followed the Romanian one on the screen while the two
   * agreed, and what it holds now is what the organizer left there — "Tractorul Park" put back
   * after the Romanian became "Parcul Tractorul" included, under the line that says so. Both
   * names are then kept as posted. Absent — no JavaScript, a script, a test — an older event's
   * English follows its Romanian on the server instead (`place.ts#englishNameAfterSave`).
   */
  placeNamesAsTyped?: boolean;
  now?: Date;
};

/** As Google Calendar asks: this date, this and the following ones, or every date of the series. */
export const SERIES_EDIT_SCOPES = ["this", "following", "all"] as const;
/**
 * Which other dates a save reaches (§130): one of the three words, or the dates ticked by
 * hand in the editor's header (§134) — ids outside the series are ignored, none is "this".
 */
export type SeriesEditScope = (typeof SERIES_EDIT_SCOPES)[number] | { ids: readonly string[] };

/** The row's columns a series edit carries to its other dates — every one an organizer sets, minus the ones below. */
const SERIES_COLUMNS = [
  "type",
  "surface",
  "eventStatus",
  "timezone",
  "mapUrl",
  "routeUrl",
  // The links are the route's kin (§332): the GPX and the rules do not change from one
  // Wednesday to the next, so a series edit carries them like the route.
  "links",
  "coHosts",
  // Not `locationName` and `locationAddress`: the place travels by what each language's page
  // shows (`placesShown`, §362), in `applyToSeries` below, with the names on each language's row.
  // Whether the place is announced travels with the place (§328): a series moved to a venue
  // not yet settled is moved on every date it reaches, and announced on them all at once.
  "locationToBeAnnounced",
  "difficulty",
  "costType",
  "costAmount",
  "costUrl",
  "distanceMeters",
  "elevationGainMeters",
  "registrationMode",
  "capacity",
  // The waiting list's length, like the places (§348). No lock and no allocation when it moves:
  // raising it offers nobody anything, and lowering it removes nobody already waiting.
  "waitlistCapacity",
  // One race, one band: a series is the same event on several dates (§173, §177).
  "bibStartNumber",
  "bibColour",
  "bibDesign",
  "confirmationOpensDaysBefore",
  "confirmationDeadlineDaysBefore",
  // One race, one age rule: every date of a series takes the same people (§329).
  "minAge",
  "declarationDocumentId",
  "participantListVisibility",
  "externalProvider",
  "externalRegistrationUrl",
  // A recurring Strava club event and a Facebook event with several dates each keep one address
  // for every occurrence, so the series' links are the series' (§300): change them on one date
  // and "the following" or "all" carry them, like the place.
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
  "checklist",
  "coverAltText",
  // Not `locationName`: the place's name in each language is the event's since §362 and travels
  // with the place (`placesShown`), whoever saved — the Organizer posts no words at all.
  "seoTitle",
  "seoDescription",
] as const;

/** Equal as stored: dates by their instant, JSON by its text, null by null. */
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The calendar day of an instant on the wall clock of `zone`, as a UTC midnight, for counting days between two. */
function wallDay(date: Date, zone: string): number {
  const wall = toWallTimeInput(date, zone);
  return Date.UTC(Number(wall.slice(0, 4)), Number(wall.slice(5, 7)) - 1, Number(wall.slice(8, 10)));
}

/**
 * The series edit (`DECISIONS.md` §130): what this save *changed* on one date, applied to the
 * other dates of its series — the following ones or all of them — the way Google Calendar's
 * "this and following events" does. Only the difference travels: a date moved to another place
 * on its own keeps that place unless the place is what was edited; a cancelled date stays
 * cancelled unless the status is what was edited. An instant lands at the same wall-clock time
 * on each date's own day (the run moved to 18:50 is at 18:50 every Wednesday), the programme's
 * rows shifted by the same days as when the date was made; a partner is the series' and
 * travels with it (§168); the featured flag, **the special mark** — the owner: "some dates can
 * be special events where we overlap with, say, Brașov Marathon on the same Wednesday" — the
 * rule, the publication state and a film are one date's own and never travel; the Strava and
 * Facebook event links do travel since §300, because both platforms give a recurring event one
 * address for all its dates; a slug is a public address and never changes. Capacity is checked against each date's own places
 * taken, and one date too full refuses the whole save, naming its day. Every touched row takes
 * a new version, in the caller's transaction.
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
    /** Hand back each touched date as it was and as it was written, for its participants' notice (§331). */
    collect?: boolean;
    now: Date;
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
    // The partners are compared by what the row *means*, not by what the column holds
    // (§169). A row nobody has saved since the list existed holds `null` where a saved one
    // holds `[]`, and both mean "no partners" — comparing the raw columns would make the
    // first series save of every legacy event report and apply a change nobody made, on a
    // save that changed nothing. `readCoHosts` is the one place that decides what a row
    // means, so it is the one place this may ask.
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
    The place (§362), compared by what each language's page shows — its own name, else the event's,
    the address folded in — and not column by column. The first save of an older event writes the
    event's name onto both rows and folds its address into the name: the columns change, the place
    does not, and nothing travels, so a date moved to another place on its own keeps it. A language
    whose place did move sends its name to every date the save reaches; the Romanian one takes the
    event's own meeting point with it (`events.location_name`, the address now folded in).
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
    placeMoved.length === 0
  ) {
    return { applied: 0, offered: 0, dates };
  }

  // The series is the source and every date made from it; "following" is by the day this
  // date had before the save, so moving it does not change which dates follow; ticked dates
  // are those and no other, whatever else the list carried.
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

    // Read before anything is written to this date, only when a notice needs to compare (§331).
    const memberTranslationsBefore = input.collect ? await listTranslationsForEvent(tx, member.id) : [];
    let touched = false;
    // A place moved in one language only still takes the date's version: the names are the
    // event's, guarded by the event row's version (`writePlaceNames`).
    if (Object.keys(changes).length > 0 || placeMoved.length > 0) {
      await tx
        .update(events)
        .set({ ...changes, version: sql`${events.version} + 1`, updatedAt: now, updatedByStaffUserId: input.actor.id })
        .where(eq(events.id, member.id));
      touched = true;
      // Each date has its own queue, checked against its own places (§147): the new capacity
      // is the source's, the raise is measured against what this date had, and the status is
      // this date's as it now stands — a cancelled date offers nothing.
      if (
        "capacity" in changes &&
        capacityRaised(member, {
          eventStatus: changes.eventStatus ?? member.eventStatus,
          registrationMode: changes.registrationMode ?? member.registrationMode,
          capacity: changes.capacity ?? null,
        })
      ) {
        offered += await offerRaisedCapacity(tx, member.id, now);
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
 * Whether a save gave the event more places than it had: a higher number, or the cap lifted —
 * on an event that will run. A race cancelled and widened in the same press offers nothing:
 * the offer's link would only answer that the event is cancelled (§147).
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
 * The places a raised capacity adds, offered to the waiting list at once (§147, BR-REQ-034-02
 * criterion 5) — inside the save's own transaction, so the new number and the offers it makes
 * commit together or not at all, and after the event row is locked, the serialization point
 * every capacity-changing decision takes (AGENTS.md §10.6). `fillAvailableSpots` is the one
 * thing that offers; this only asks it, with the row as it now stands. Returns the offers made.
 */
async function offerRaisedCapacity<T extends Record<string, unknown>>(tx: Transaction<T>, eventId: string, now: Date): Promise<number> {
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
      registrationClosesAt: event.registrationClosesAt,
      confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
      confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
      capacity: event.capacity,
      raceId: event.raceId,
      publishedAt: event.publishedAt,
    },
    now,
  );
}

/**
 * The editor's single save: the event row and every language, in one transaction
 * (BR-REQ-051-01).
 *
 * Six forms and two save buttons were what this replaced, and the reason for the change is not
 * tidiness — it is that "save the settings, then save Romanian, then save English" is three
 * chances to lose an edit, three version guards a person has to reason about separately, and
 * two of them silently stale the moment the first one succeeds. One transaction has one answer:
 * everything is written, or a CONFLICT is raised and nothing is.
 *
 * The version guards do not change. Each row still carries the version its panel was rendered
 * from, `updateEventWithVersionGuard` and `updateTranslationWithVersionGuard` are the same two
 * statements as before, and a stale version on *any* of them throws inside the transaction —
 * which rolls back the rest. That is stricter than the old behaviour and deliberately so: half a
 * save is exactly the state criterion 5 exists to prevent.
 */
export async function saveEventAndTranslations<T extends Record<string, unknown>>(
  db: Database<T>,
  input: SaveEventAndTranslationsInput,
): Promise<{ appliedTo: number; offered: number; placeAnnounced: boolean; notice?: EventNoticeOutcome }> {
  const now = input.now ?? new Date();

  const [current] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such event");

  const existingTranslations = await listTranslationsForEvent(db, input.eventId);

  // Parsed and checked before the transaction opens, so a malformed form never holds a row lock
  // while the organizer's browser is told what is wrong with it.
  const parsedEventFields =
    input.fields === undefined ? undefined : normalizeForMode(normalizeForType(parseOrThrow(eventFieldsSchema, ignoreHiddenFields(input.fields))));
  if (parsedEventFields) {
    if (!canEditEventFields(input.actor.role)) {
      throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not edit event details`);
    }
    await assertCoherentRegistrationBlock(db, parsedEventFields, now);
  }
  const times = parsedEventFields ? resolveTimes(parsedEventFields) : undefined;
  // The notice and the cancellation's reason, refused here like any other box (§331, §315).
  const request = readNoticeRequest(input.actor, current, parsedEventFields?.eventStatus, input.notice, input.cancellation);

  const outcome = await db.transaction(async (tx) => {
    let savedEvent: EditableEvent = current;
    const savedTranslations: EditableTranslation[] = [];
    // The place's name in each language, when the event's fields are part of this save (§362) —
    // an older event's English following its Romanian when only the Romanian moved, unless the
    // editor's box did that on the screen already and the organizer saw what it holds.
    const posted: PlaceNames = parsedEventFields ? placeNamesFrom(parsedEventFields) : {};
    const names: PlaceNames = input.placeNamesAsTyped ? posted : namesAfterSave(current, existingTranslations, posted);
    if (parsedEventFields && times) {
      /**
       * Lowering capacity below the places already taken is refused (AGENTS.md §10.6,
       * BR-REQ-034-02 criterion 3). The event row is locked first — the serialization point
       * every allocation takes — so a confirmation landing between the count and the write
       * waits behind this save instead of slipping past it; the version guard alone would
       * only catch another *save*.
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
      // Before the words, so each row a text save writes back already carries its new name.
      await writePlaceNames(tx, input.eventId, names);
    }

    for (const submitted of input.translations) {
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
            now,
          }),
        ),
      );
    }

    /*
      Both languages or neither (§352), on the two languages exactly as this save leaves them —
      inside the transaction, so a refusal writes nothing. Only when this save carries both: the
      editor posts both for anybody who may write both, and a save that carries one language (a
      reader who may write only that one, a script) is not refused over the other language's text,
      which it could not change.
    */
    const savedRo = savedTranslations.find((row) => row.locale === "ro");
    const savedEn = savedTranslations.find((row) => row.locale === "en");
    if (savedRo && savedEn) assertOptionalTextsInBothLanguages({ ro: savedRo, en: savedEn });

    // More places than before: the difference goes to the waiting list at once (§147), here,
    // where the row is already locked by the guarded update and the number is not yet committed.
    let offered = capacityRaised(current, savedEvent) ? await offerRaisedCapacity(tx, savedEvent.id, now) : 0;

    /*
      This date's languages as they now stand: the rows a text save wrote back (which already carry
      the place's names), and the others as loaded with the names written above — an Organizer's
      save writes no words, yet moves the place in both languages.
    */
    const translationsAfter = withPlaceNames(existingTranslations, names).map(
      (row) => savedTranslations.find((saved) => saved.id === row.id) ?? row,
    );

    // The other dates of the series, when asked (§130) — after this one, so what travels is
    // exactly what was written, and inside the transaction, so a refused date undoes it all.
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
      });
      appliedTo = series.applied;
      offered += series.offered;
      otherDates.push(...series.dates);
    }
    /*
      This save announced the place (§328): the switch was on and is off now, so the place is on
      every public surface from this commit. Nobody is written to about it: a message sent as a
      side effect of a save would reach every entrant for a typo fixed the minute after, so telling
      the participants is the organizer's own, separate act, and the editor's banner says so.
    */
    const placeAnnounced = current.locationToBeAnnounced && !savedEvent.locationToBeAnnounced;

    /*
      Telling the participants (§331), last, when every date is written and nothing is left to
      refuse: a refused save queues nothing, because the messages are rows in this transaction.
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
  // The one save of the whole event (§36), cancelling included: a cancelled event must never read
  // as scheduled, so the cached rows go the moment it commits (§28, §333).
  revalidatePublicContent("events");
  /*
    The date, the close, the participation window, the status, the capacity: any of them moves
    what the maintenance job has to do and when (§334). Only when the event row itself was saved
    — a translation's words move nothing the job acts on.
  */
  if (parsedEventFields) wakeJobs("registration-maintenance");
  return outcome;
}

export type CreateEventInput = {
  actor: Actor;
  fields: unknown;
  now?: Date;
};

/**
 * A new event, with a translation in every locale, as a DRAFT.
 *
 * Never created published: publication is a transition an Editor makes after reading the page,
 * and an event that appeared live the instant it was saved would put an unreviewed draft on the
 * landing page. `src/db/seeds/pilot.ts` is no longer how an event is configured — this is.
 */
export async function createEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: CreateEventInput,
): Promise<EditableEvent> {
  const now = input.now ?? new Date();

  if (!canCreateEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not create an event`);
  }

  const parsed = normalizeForMode(normalizeForType(parseOrThrow(newEventSchema, ignoreHiddenFields(input.fields))));
  await assertCoherentRegistrationBlock(db, parsed, now);
  const times = resolveTimes(parsed);
  // Each language's columns, once: checked for both-or-neither (§352) before anything is written,
  // then inserted exactly as checked.
  const translationColumns = {
    ro: translationColumnsFrom(parsed.translations.ro, parsed.type),
    en: translationColumnsFrom(parsed.translations.en, parsed.type),
  };
  assertOptionalTextsInBothLanguages(translationColumns);
  // Each language's name for the place, from the Locul box (§362); a caller that posts no English
  // name leaves the English row to the event's, as every event before it did.
  const names = placeNamesFrom(parsed);

  const created = await db.transaction(async (tx) => {
    if (parsed.featured) await clearFeaturedExcept(tx, null, now);

    const [event] = await tx
      .insert(events)
      .values({
        ...eventColumnsFrom(parsed, times),
        editorialStatus: "DRAFT",
        createdByStaffUserId: input.actor.id,
        updatedByStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Through the same function a save writes with: the rich summary's words become the
    // plain `excerpt`, the empty documents become null, a group run gets no programme.
    await tx.insert(eventTranslations).values(
      routing.locales.map((locale) => ({
        eventId: event.id,
        locale,
        ...translationColumns[locale],
        locationName: names[locale] ?? null,
        authorStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })),
    );

    return event;
  });
  // A draft shows nowhere — but a featured one has just taken the flag from the event the
  // listing leads with, and that one is public.
  if (parsed.featured) revalidatePublicContent("events");
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
 * The repeat rule the create form asks for (§64, §170). No `publish` of its own: the series goes
 * live exactly when its source does (§122), which is only known once the publication has run.
 */
export type NewEventRepeatRule = Omit<RepeatEventInput["rule"], "publish"> & { publish?: boolean };

/**
 * A new event, and — when asked — published in the same transaction (`DECISIONS.md` §315; the
 * owner: "ar trebui sa pot crea si publica dintr-un foc!").
 *
 * A new event is a draft (`createEvent`), and taking it live used to be two more presses in
 * the editor: DRAFT → IN_REVIEW → PUBLISHED (§201). This walks those same two transitions,
 * through `transitionEvent`, so every publication guard applies unchanged — the role that may
 * publish, both languages complete (`REQUIRED_PUBLIC_TRANSLATION_FIELDS`), the meeting point —
 * and nothing here knows a second way to go live.
 *
 * **The draft is never thrown away.** The create and the publication share one transaction,
 * but the publication runs in a savepoint of its own: when the guard refuses — a summary left
 * empty, a role below Administrator — the savepoint rolls back, the draft commits, and the
 * refusal comes back beside it so the editor can say "created, not published, and here is what
 * is missing" (§170's words). What the organizer typed is in the database, not lost to an
 * alert. A role that may not publish is answered before either transition is tried, so the
 * event is a draft and not a submission nobody asked for.
 *
 * **The series is made in the same transaction, and a refused rule refuses the whole create.**
 * `repeatEvent` is the only judge of a rule — the weekdays, an end on or before the event's
 * start, the date format — and it can only judge the end once the start exists. It used to run
 * after this function had committed, so an end before the start left an event behind, the
 * action had nothing left to return but a redirect, and the repeat settings the organizer had
 * chosen were gone (the review of §315). Here, a refusal rolls back the create and the
 * publication with it, and comes back naming `repeat.until` or `repeat.weekday` — the boxes the
 * create form posts — so the action returns the form with every box as it was typed.
 */
export async function createEventAndPublish<T extends Record<string, unknown>>(
  db: Database<T>,
  input: CreateEventInput & { publish: boolean; repeat?: NewEventRepeatRule | null },
): Promise<CreateAndPublishResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const created = await createEvent(tx, { actor: input.actor, fields: input.fields, now });
    const { event, published, refusal } = await publishNewEvent(tx, input.actor, created, input.publish, now);
    if (!input.repeat) return { event, published, refusal, repeated: 0 };

    // The series, as drafts — or live, when the source has just gone live and the rule asks for it
    // (§350): the create page's "Publică datele noi automat", ticked by default. A caller that
    // does not say keeps the old answer — live exactly when the source went live.
    const rule = { ...input.repeat, publish: input.repeat.publish ?? published };
    const series = await namedUnder("repeat", () => repeatEvent(tx, { actor: input.actor, eventId: event.id, rule, now }));
    return { event, published, refusal, repeated: series.created };
  });
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

  if (!canTransition(actor.role, "IN_REVIEW", "PUBLISHED", false)) {
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
 * The same event again, as a fresh draft.
 *
 * What a duplicate deliberately does not copy: publication, the first-publication date, the
 * featured flag, and the slugs. A copy that led the site the moment it was made, or that
 * claimed a URL the original already owns, is not a starting point — it is an incident. The
 * slug gets the first free `-2`, `-3`, … suffix in each locale, asked of the database rather
 * than assumed, because `UNIQUE(locale, slug)` would otherwise reject the whole copy.
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
 * Every column a copy inherits from its source, in one place for duplicating and repeating.
 *
 * What a copy deliberately does not inherit: publication and the first-publication date, the
 * featured flag, the special mark (§168), and the start list switch — publishing names is a decision about the people
 * who entered *that* event, and a copy has none. It starts HIDDEN like every other new event.
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
    routeUrl: source.routeUrl,
    // The links travel with the route (§332), to a duplicate and to every date of a repeat:
    // last year's GPX and rules are this year's starting point, and a weekly run's are the same.
    links: source.links,
    // Not carried by a *duplicate*: a film is of one edition, and last year's would be wrong on
    // next year's; next year's race has its own Strava and Facebook event pages. A *repeat* is
    // different — a recurring Strava club event and a Facebook event with several dates keep one
    // address for every occurrence — so `repeatEvent` and the job put the source's two links
    // back on top of this (§300). The co-host is carried by both: a series held with a partner
    // is held with them every time.
    videoUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    coHosts: source.coHosts,
    // The two columns the list replaced (§168) travel with a copy as well, so that copying a
    // row nobody has saved since the list existed does not lose the partner it still holds
    // there. Nothing reads them while `co_hosts` is a list.
    coHostName: source.coHostName,
    coHostUrl: source.coHostUrl,
    // Never the rule: a copy is one date, and only the source repeats (§122).
    repeatRule: null,
    repeatOf: null,
    locationName: source.locationName,
    locationAddress: source.locationAddress,
    // A copy of an event whose place is not announced is not announced either (§328): the
    // hidden place travels with it and stays hidden until somebody switches it on.
    locationToBeAnnounced: source.locationToBeAnnounced,
    difficulty: source.difficulty,
    costType: source.costType,
    costAmount: source.costAmount,
    costUrl: source.costUrl,
    distanceMeters: source.distanceMeters,
    elevationGainMeters: source.elevationGainMeters,
    featured: false,
    // Nor the special mark (§168): it says something about one edition — the anniversary, the
    // Wednesday another club's race passes through — and the copy is a different one.
    isSpecial: false,
    capacity: source.capacity,
    // The waiting list's length goes with the places it queues for (§348): a copy, and every
    // date of a series, queue as many as the source does.
    waitlistCapacity: source.waitlistCapacity,
    confirmationOpensDaysBefore: source.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: source.confirmationDeadlineDaysBefore,
    // Who may enter is a property of the race, not of one edition (§329): a copy and every date
    // of a series keep the source's minimum age, like its capacity.
    minAge: source.minAge,
    registrationMode: source.registrationMode,
    registrationOpensAt: source.registrationOpensAt,
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
    checklist: translation.checklist,
    coverAltText: translation.coverAltText,
    // The place's name in this language goes with the copy: the same place, the same word.
    locationName: translation.locationName,
    seoTitle: translation.seoTitle,
    seoDescription: translation.seoDescription,
    authorStaffUserId: actor.id,
    createdAt: now,
    updatedAt: now,
  };
}

export type RepeatEventInput = {
  actor: Actor;
  eventId: string;
  /** How it recurs, until when (null: for ever), and whether the occurrences go live as they are made. */
  rule: { cadence: RepeatCadence; weekdays?: readonly Weekday[]; until: string | null; publish: boolean };
  now?: Date;
};

/**
 * The same event again, every week, fortnight or month — a standing series (`DECISIONS.md`
 * §64, §122): "every Monday and Wednesday, until 20 December, or for ever".
 *
 * The rule is written on the source, and the next eight weeks of occurrences are created at
 * once; from then on the maintenance job creates each week as it comes into the horizon
 * (`materializeStandingRepeats`). Each occurrence is the source shifted on the wall clock in
 * its own zone (`addWallClockInterval`), everything with a time moving with it, the slug
 * carrying the date (`alergare-de-duminica-2026-10-04`), and names the source in `repeat_of`.
 *
 * Occurrences are drafts unless `publish` is asked for **and** the source is published: a
 * published source has both languages complete (`transitionEvent` asserted that), so its copies
 * can go live without re-checking. Asking to publish needs the role that publishes.
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
  if (source.repeatOf) {
    throw new DomainError("VALIDATION_ERROR", "this date is part of a series already; the series repeats from its first event");
  }

  if ((input.rule.weekdays ?? []).some((day) => !WEEKDAYS.includes(day))) {
    throw new DomainError("VALIDATION_ERROR", "weekdays: 1 (Monday) to 7 (Sunday)", ["weekday"]);
  }
  // The event's own day is always in the series (§128): a Sunday run with "Wednesday" ticked
  // runs on Sundays and Wednesdays — the source is the first date, not a one-off before them.
  const ownWeekday = wallClockWeekday(source.startsAt, source.timezone) as Weekday;
  const weekdays =
    input.rule.cadence === "MONTHLY" || (input.rule.weekdays ?? []).length === 0
      ? []
      : [...new Set([...(input.rule.weekdays ?? []), ownWeekday])].sort((a, b) => a - b);
  /*
    The rule stores what was **asked** — "publish the new dates by themselves" — and each date made
    goes live only while the source is live too (`materializeSeries`). It used to store the
    effective answer, so a series started from a draft with the box ticked came out "off" for good
    and made a draft every week after the source was published (§350; the create page's
    `repeat.publish` is ticked by default now, and a new event is a draft).
  */
  const publish = input.rule.publish && source.editorialStatus === "PUBLISHED";
  if (input.rule.publish && !canTransition(input.actor.role, "IN_REVIEW", "PUBLISHED", false)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not publish`);
  }
  const rule = repeatRuleSchema.safeParse({ cadence: input.rule.cadence, weekdays, until: input.rule.until, publish: input.rule.publish });
  if (!rule.success) throw new DomainError("VALIDATION_ERROR", "until: a date, or nothing for a series without an end", ["until"]);
  const end = untilEnd(rule.data, source.timezone);
  if (end && end.getTime() <= source.startsAt.getTime()) {
    throw new DomainError("VALIDATION_ERROR", "until: the end must be after this event", ["until"]);
  }

  await db.update(events).set({ repeatRule: rule.data, updatedAt: now, updatedByStaffUserId: input.actor.id }).where(eq(events.id, source.id));
  const created = await materializeSeries(db, { ...source, repeatRule: rule.data }, rule.data, input.actor, now);
  // Even with every date a draft, the source's rule is public: a date of a series is not history,
  // so it leaves the listing's past events (§275).
  revalidatePublicContent("events");
  // A new standing rule is the maintenance job's to keep extending (§122); it looks at its next
  // ping rather than at the end of the quiet it last promised (§334).
  wakeJobs("registration-maintenance");
  return { created, published: publish };
}

/**
 * The occurrences a source's rule still owes inside the horizon — from the latest one that
 * exists (or the source itself) up to `horizonEnd` — created in one transaction. Idempotent:
 * every occurrence is a whole number of periods from the source, and a date whose address
 * already exists is skipped, never duplicated. Two indexed reads and usually no write, which
 * is what lets the job run it every quarter hour.
 */
async function materializeSeries<T extends Record<string, unknown>>(
  db: Database<T>,
  source: EventRow,
  rule: RepeatRule,
  actor: Actor | null,
  now: Date,
): Promise<number> {
  const [latest] = await db
    .select({ startsAt: sql<Date | null>`max(${events.startsAt})` })
    .from(events)
    .where(eq(events.repeatOf, source.id));
  const after = latest?.startsAt ? new Date(Math.max(new Date(latest.startsAt).getTime(), source.startsAt.getTime())) : source.startsAt;
  const before = horizonEnd(rule, source.timezone, now);
  const dates = occurrencesBetween(source, rule, after, before);
  if (dates.length === 0) return 0;

  const sourceTranslations = await listTranslationsForEvent(db, source.id);
  const publish = rule.publish && source.editorialStatus === "PUBLISHED";

  // The slugs, all of them, checked before anything is written; a taken address means that
  // date exists — made by hand, or by a series stopped and started again — and is skipped.
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

  // The shift is on the wall clock: the same interval the start moved by, applied to every
  // other time the source carries (§64), so an occurrence four weeks on keeps its 08:00 across
  // the clock change even though the instants differ by 27 days and 23 hours.
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
          // A series inherits the source's event pages (§300): a recurring Strava club event and
          // a Facebook event with several dates keep one address for every occurrence, so the
          // address on the source is the address of this date. A duplicate does not get them.
          stravaEventUrl: source.stravaEventUrl,
          facebookEventUrl: source.facebookEventUrl,
          createdByStaffUserId: by,
          updatedByStaffUserId: by,
          repeatOf: source.id,
          startsAt: occurrence.startsAt,
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

  // New dates on the listing and the calendar — the maintenance job's one public write (§122).
  // Drafts show nowhere, so a run that made only drafts expires nothing.
  if (publish) revalidatePublicContent("events");
  return fresh.length;
}

/**
 * Every standing series, brought up to the horizon (§122). Run by the maintenance job: one
 * indexed read for the sources with a rule, then `materializeSeries` per source — which on
 * most runs reads twice and writes nothing. A source whose rule is past its end keeps the rule
 * (the editor shows it as ended) and creates nothing.
 */
export async function materializeStandingRepeats<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<{ sources: number; created: number }> {
  const sources = await db.select().from(events).where(sql`${events.repeatRule} IS NOT NULL`);
  let created = 0;
  for (const source of sources) {
    const rule = readRepeatRule(source.repeatRule);
    if (!rule) continue;
    created += await materializeSeries(db, source, rule, null, now);
  }
  return { sources: sources.length, created };
}

/**
 * The series' first event — the one that holds the rule — from any of its dates: the date itself
 * when it is not a copy, the event it was copied from otherwise (`repeat_of`, one level deep: a
 * copy is never copied, `repeatEvent` refuses a date that is part of a series).
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

/** Stop a series: no further occurrences are made; the ones that exist stay (the bulk verbs remove them). */
export async function stopRepeat<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; eventId: string; now?: Date },
): Promise<void> {
  if (!canCreateEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not change a series`);
  }
  // From any date of the series (§350): the rule lives on the source, and the Recurență box offers
  // "Oprește recurența" on every date, so a copied date's id is resolved to its source.
  const source = await seriesSourceOf(db, input.eventId);
  await db
    .update(events)
    .set({ repeatRule: null, updatedAt: input.now ?? new Date(), updatedByStaffUserId: input.actor.id })
    .where(eq(events.id, source.id));
  // Without its rule the source is a one-off again, and a past one-off is history (§275).
  revalidatePublicContent("events");
}

/**
 * Switch a running series' automatic publication on or off (`DECISIONS.md` §341): whether the
 * dates the job makes from now on go live as they are made, or wait as drafts.
 *
 * The rule's `publish` flag was chosen once, with the tick under "Repetă evenimentul", and never
 * again: a series started from a draft — or without the tick — made every future date a draft
 * for good, and the only way out was to stop the series and start it again. The owner met the
 * result as "Ciornă · 1 date" on the list and could not tell the site was missing a Monday.
 *
 * Only the flag changes; the cadence, the days and the end stay as they are, and the dates that
 * already exist keep their state — publishing those is the list's bulk verb or each date's own
 * editor, which pass the checks publication has. Switching it on asks for the role that
 * publishes, as the first creation did (`repeatEvent`). It does not ask for a published source:
 * on a draft source the switch is stored and waits, because the copies of an unpublished event
 * are drafts anyway (`materializeSeries`) — the dates go live as they are made once the source is
 * live, and until then the Recurență box says the series is waiting for exactly that.
 */
export async function setRepeatPublish<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; eventId: string; publish: boolean; now?: Date },
): Promise<void> {
  if (!canCreateEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not change a series`);
  }
  // From any date of the series (§350): the Recurență box offers the switch on every date.
  const source = await seriesSourceOf(db, input.eventId);
  const rule = readRepeatRule(source.repeatRule);
  if (!rule) throw new DomainError("VALIDATION_ERROR", "this series does not repeat any more; start it again from its first event");
  /*
    Switching it on while the source is a draft is stored and waits (§350, amending the hints
    branch's refusal): the rule says what was asked, and the dates go live only while the source
    is live too (`materializeSeries`) — the editor says "waiting" for exactly that state, and the
    create page's own tick stores the same thing for a new draft.
  */
  if (input.publish && !canTransition(input.actor.role, "IN_REVIEW", "PUBLISHED", false)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not publish`);
  }
  // Guarded on `repeatRule` still being set, not merely on the id: a `stopRepeat` landing
  // between the read above and this write would otherwise have this `{ ...rule, publish }` — the
  // rule as it was before the stop — write the series back into existence. With the guard, that
  // race makes this update match nothing, and the stopped series stays stopped.
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
 * Remove an event outright — Administrator only, and never one anybody has registered for.
 *
 * Archiving is the answer for an event that happened; deletion is for a row that should not
 * exist at all. A participant's registration is not tidy-up: it carries the version of the
 * privacy notice they acknowledged and, once signed, the declaration they accepted, and
 * cascading those away to remove a duplicate would destroy the evidence AGENTS.md §10.8 exists
 * to keep. Test registrations count — "Remove test registrations" is what clears those, and it
 * is what makes a demonstration repeatable.
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
     * An event whose only registrations are **test** rows takes them with it (§176; the owner:
     * "încerc să șterg un eveniment și nu merge! e destul de grav! asta o să îmi umple baza de
     * date").
     *
     * The refusal was right and its advice was a dead end: it said "archive it instead" to
     * somebody looking at an event that was **already archived**, and the rows in the way were
     * data he had created himself to rehearse with. Nothing new is permitted here — clearing
     * test rows is already a verb on the event page (`removeTestRegistrations`), already an
     * Administrator's, and already refused in production; this is those two presses in one,
     * which is what stops a QA database filling with events nobody can remove.
     *
     * A single **real** registration still blocks the delete, and that is the rule that matters:
     * it carries the privacy notice the person acknowledged and, once signed, their declaration
     * (`AGENTS.md` §10.8). Archive is the answer there, and the message says so with the count.
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

  // `event_translations` cascades from the event; nothing else references an event with no
  // registrations against it.
  await db.delete(events).where(eq(events.id, input.eventId));
  revalidatePublicContent("events");
}

export type HardDeleteEventInput = {
  actor: Actor;
  eventId: string;
  /** The event's title, as the person typed it. Anything else refuses. */
  typedTitle: string;
  /** Why — kept in the audit row, which is all that survives. */
  reason: string;
  now?: Date;
};

/**
 * Erase an event **and everyone registered for it** — the hard delete.
 *
 * `deleteEvent` above refuses an event that has registrations, and refusing was right for as
 * long as the only thing behind the refusal was "archive it instead". It is not the only thing:
 * the club's own data controller had an archived event carrying two registrations he had
 * entered himself, and no way at all to remove either. "We cannot delete this" is not an answer
 * a controller can be given about his own records, and the same argument that produced
 * `deleteRegistrationByStaff` (BR-REQ-037-06 — somebody exercising their right to erasure)
 * produces this: the safe verb stays the default, and the destructive one exists, named
 * differently, behind a confirmation nobody presses by accident.
 *
 * **It is allowed in production**, and that is a decision rather than an oversight. `DECISIONS.md`
 * §30 forbids *test registrations* in production because a synthetic row would corrupt the
 * club's own counts; it says nothing about erasure, and erasure is the opposite case — the
 * environment where the club's real mistakes and its real erasure requests live is production,
 * so a verb that worked only on QA would be a verb that never worked. The environment is not
 * the guard here. The guard is: a role that may already erase each of these rows one at a time,
 * a title typed by hand, a reason, an audit row per person, an audit row for the event, and no
 * bulk control anywhere that can reach it.
 *
 * **One transaction.** The audit row for the event is written first, then every registration is
 * erased through `eraseAllRegistrationsOfEvent` — the same path a single erasure takes, so each
 * one releases its place through the allocator, takes its declaration acceptance with it, and
 * leaves its own audit row — and the event row goes last. If anything fails, nothing happened:
 * `registrations.event_id` has no `ON DELETE` clause, so a half-done version of this could not
 * commit even if it wanted to.
 *
 * **What the audit rows say, and what they do not.** The event's row carries the title, the
 * date and the counts; each registration's row carries the status it was in and the reason.
 * Not one of them carries a name, an address or an identity document — §12.12, and the whole
 * reason the verb is called erasure.
 */
export async function hardDeleteEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: HardDeleteEventInput,
): Promise<{ registrationsErased: number }> {
  // The role first, before the screen's own inputs are even looked at: an organizer who may not
  // do this is told that, rather than being told their reason was too short (BR-REQ-060-01).
  if (!canHardDeleteEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not erase an event and its registrations`);
  }

  const plan = await readEventErasurePlan(db, input.eventId);
  if (!plan) throw new DomainError("NOT_FOUND", "no such event");

  const reason = input.reason.trim();
  if (reason.length < 3) {
    // Named, so the erase form's summary points at the box that was wrong (§315) — the form
    // posts these two names, and nothing else here is typed.
    throw new DomainError("VALIDATION_ERROR", "an erasure needs a reason; it is the only thing that survives it", ["reason"]);
  }

  /**
   * The typed confirmation. Either language's title is accepted — the organizer types the one
   * on the screen in front of them — and an event with no title at all (a draft nobody has
   * named) is confirmed by its id, which is what the screen then shows. Compared trimmed and
   * exactly: a case-insensitive match would accept a title somebody half-remembered, and the
   * whole purpose of this field is to be impossible to satisfy by accident.
   */
  const accepted = plan.titles.length > 0 ? plan.titles.map((entry) => entry.title) : [plan.eventId];
  if (!accepted.some((title) => title.trim() === input.typedTitle.trim())) {
    throw new DomainError("VALIDATION_ERROR", "the typed title does not match this event's title", ["typedTitle"]);
  }

  const now = input.now ?? new Date();

  const erased = await db.transaction(async (tx) => {
    // First, inside the transaction: the row that says this happened. It outlives the event —
    // `audit_logs.entity_id` carries no foreign key — and it is written before anything is
    // destroyed so that there is no ordering in which the destruction has no record.
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

    // `event_translations` and `registration_interests` cascade; a gallery album's `event_id`
    // and a later edition's `repeat_of` are set to null. The registrations are gone above,
    // which is the only reference that would have refused this.
    await tx.delete(events).where(eq(events.id, plan.eventId));

    return { registrationsErased };
  });
  // The event, and an album that pointed at it, leave the public pages (`reads.ts` files the album
  // under both kinds, so this one call reaches it).
  revalidatePublicContent("events");
  return erased;
}
