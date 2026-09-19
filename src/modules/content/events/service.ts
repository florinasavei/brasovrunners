import { and, eq, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { eventTranslations, events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";
import { hasProgramme, takesRegistrations } from "@/modules/events/domain/event-type";
import { readScheduleItems, type ScheduleItem, shiftScheduleItems } from "@/modules/events/domain/schedule";
import { addWallClockInterval, fromWallTimeInput, wallClockWeekday } from "@/modules/events/domain/zoned-time";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import { countOccupied, countRegistrationsForEvent } from "@/modules/registrations/repository";
import {
  canCreateEvent,
  canDeleteEvent,
  canEditEventFields,
  canEditTranslation,
  canTransition,
  type EditorialStatus,
  isLiveContent,
} from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { hasRichTextContent, richTextToPlainText } from "@/modules/content/rich-text/domain/schema";
import {
  type EventFieldsInput,
  eventFieldsSchema,
  missingPublicFields,
  newEventSchema,
  translationFieldsSchema,
} from "./fields";
import {
  type EditableEvent,
  type EditableTranslation,
  findTakenSlugs,
  findTranslationById,
  findTranslationWithEventById,
  listTranslationsForEvent,
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

  const required = (value: string, name: string): Date => {
    const parsed = fromWallTimeInput(value, zone);
    if (!parsed) throw new DomainError("VALIDATION_ERROR", `${name}: a date and time are required`);
    return parsed;
  };

  const optional = (value: string, name: string): Date | null => {
    const parsed = fromWallTimeInput(value, zone);
    if (value.trim() !== "" && !parsed) {
      throw new DomainError("VALIDATION_ERROR", `${name}: not a date and time`);
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
      if (!row.date || !row.time) throw new DomainError("VALIDATION_ERROR", `${name}: a date and time are required`);
      const startsAt = required(`${row.date}T${row.time}`, name);
      const endsAt = row.endTime ? required(`${row.date}T${row.endTime}`, `${name}.end`) : null;
      if (endsAt && endsAt.getTime() < startsAt.getTime()) {
        throw new DomainError("VALIDATION_ERROR", `${name}: the end cannot be before the start`);
      }
      if (!row.ro || !row.en) throw new DomainError("VALIDATION_ERROR", `${name}: the label is needed in both languages`);
      return { startsAt: startsAt.toISOString(), endsAt: endsAt ? endsAt.toISOString() : null, label: { ro: row.ro, en: row.en }, place: row.place || null };
    })
    .filter((item): item is ScheduleItem => item !== null)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new DomainError("VALIDATION_ERROR", "endsAt: the event cannot end before it begins");
  }
  if (raceStartsAt && raceStartsAt.getTime() < startsAt.getTime()) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "raceStartsAt: the race cannot start before the event begins",
    );
  }
  if (raceStartsAt && endsAt && raceStartsAt.getTime() > endsAt.getTime()) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "raceStartsAt: the race cannot start after the event ends",
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
function assertCoherentRegistrationBlock(fields: EventFieldsInput): void {
  if (fields.registrationMode !== "INTERNAL") {
    if (fields.capacity !== null || fields.declarationDocumentId !== null) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "capacity and a declaration belong to an event that takes registrations here; set the mode to INTERNAL or clear them",
      );
    }
  } else if (fields.declarationDocumentId === null) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "an event that takes registrations must name the approved declaration a participant signs",
    );
  }

  if (fields.participantListVisibility === "NAMES" && fields.registrationMode !== "INTERNAL") {
    // For NONE there are no participants to list, and for EXTERNAL the people who entered are
    // the other organizer's — the club holds no registrations for them (BR-REQ-039-01).
    throw new DomainError(
      "VALIDATION_ERROR",
      "a start list can only be published for an event that takes registrations here",
    );
  }

  if (fields.registrationMode === "EXTERNAL") {
    if (fields.externalRegistrationUrl === null) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "an externally registered event needs the organizer's registration link",
      );
    }
  } else if (fields.externalRegistrationUrl !== null || fields.externalProvider !== null) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "the external provider and link belong to an event registered elsewhere; set the mode to EXTERNAL or clear them",
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
    videoUrl: fields.videoUrl,
    stravaEventUrl: fields.stravaEventUrl,
    coHostName: fields.coHostName,
    coHostUrl: fields.coHostName ? fields.coHostUrl : null,
    locationName: fields.locationName,
    locationAddress: fields.locationAddress,
    difficulty: fields.difficulty,
    costType: fields.costType,
    distanceMeters: fields.distanceMeters,
    elevationGainMeters: fields.elevationGainMeters,
    featured: fields.featured,
    registrationMode: fields.registrationMode,
    capacity: fields.capacity,
    confirmationOpensDaysBefore: fields.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: fields.confirmationDeadlineDaysBefore,
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
  return {
    ...fields,
    // No programme rows on a turn-up type either (§111, §117).
    scheduleRows: [],
    registrationMode: "NONE",
    capacity: null,
    declarationDocumentId: null,
    registrationOpensAtWallTime: "",
    registrationClosesAtWallTime: "",
    participantListVisibility: "HIDDEN",
    externalProvider: null,
    externalRegistrationUrl: null,
  };
}

function parseOrThrow<Out>(schema: z.ZodType<Out>, value: unknown): Out {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  return parsed.data;
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

  const { body, rules, schedule, excerptBody, ...columns } = fields;
  // The rich excerpt, when the editor posted one, and its words as the plain `excerpt` — the
  // listing card, the meta description and the publish check all read the plain column
  // (`DECISIONS.md` §73). An editor that posted nothing leaves the plain text as typed.
  const excerptJson = hasRichTextContent(excerptBody) ? excerptBody : null;
  return updateTranslationWithVersionGuard(
    db,
    input.current.id,
    input.expectedVersion,
    {
      ...columns,
      excerpt: excerptJson ? richTextToPlainText(excerptJson).replace(/\s+/g, " ").trim().slice(0, 500) || null : columns.excerpt,
      excerptJson,
      bodyJson: body,
      rulesJson: hasRichTextContent(rules) ? rules : null,
      // A group run has no programme (§111): the editor hides the field, and this is what
      // holds when the type changed in the same save or the hidden field still posted text.
      scheduleJson: hasProgramme(input.eventType) && hasRichTextContent(schedule) ? schedule : null,
      // A row nobody has claimed becomes the saver's — the seeded rows have no author, and
      // "their own drafts" needs one for the rule to mean anything. An existing author is
      // never overwritten: an Editor fixing a typo does not take the piece.
      authorStaffUserId: input.current.authorStaffUserId ?? input.actor.id,
    },
    input.now,
  );
}

export async function saveEventTranslation<T extends Record<string, unknown>>(
  db: Database<T>,
  input: SaveTranslationInput,
): Promise<EditableTranslation> {
  const now = input.now ?? new Date();

  const record = await findTranslationWithEventById(db, input.translationId);
  if (!record) throw new DomainError("NOT_FOUND", "no such event translation");

  return applyTranslationSave(db, {
    actor: input.actor,
    event: record.event,
    current: record.translation,
    expectedVersion: input.expectedVersion,
    fields: input.fields,
    acknowledgeLiveEdit: input.acknowledgeLiveEdit,
    eventType: record.event.type,
    now,
  });
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
 * What the *event* itself is missing before it can be published (`DECISIONS.md` §36).
 *
 * The meeting point is one value for the whole event now, so its completeness is not a per-locale
 * question any more. Every save through this module fills it; this catches a row written before
 * the column existed and never saved since.
 */
export function missingPublicEventFields(event: Pick<EditableEvent, "locationName">): string[] {
  return (event.locationName ?? "").trim() === "" ? ["locationName"] : [];
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
    const missingOnEvent = missingPublicEventFields(current);
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

  return updateEventWithVersionGuard(db, input.eventId, input.expectedVersion, changes, now);
}

// --- The event row --------------------------------------------------------------------------

export type SaveEventFieldsInput = {
  actor: Actor;
  eventId: string;
  expectedVersion: number;
  fields: unknown;
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

  const fields = normalizeForType(parseOrThrow(eventFieldsSchema, input.fields));
  assertCoherentRegistrationBlock(fields);
  const times = resolveTimes(fields);

  /**
   * Lowering capacity below the places already taken is refused (AGENTS.md §10.6,
   * BR-REQ-034-02 criterion 3). Counted here rather than trusted from a cached figure, and
   * inside the same transaction as the write so a confirmation landing between the two cannot
   * slip past it.
   */
  return db.transaction(async (tx) => {
    if (fields.capacity !== null) {
      const occupied = computeOccupied(await countOccupied(tx, input.eventId, now));
      if (fields.capacity < occupied) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `capacity: ${occupied} places are already taken; capacity cannot be lowered below that`,
        );
      }
    }

    if (fields.featured) await clearFeaturedExcept(tx, input.eventId, now);

    return updateEventWithVersionGuard(
      tx,
      input.eventId,
      input.expectedVersion,
      { ...eventColumnsFrom(fields, times), updatedByStaffUserId: input.actor.id },
      now,
    );
  });
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
  now?: Date;
};

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
): Promise<void> {
  const now = input.now ?? new Date();

  const [current] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!current) throw new DomainError("NOT_FOUND", "no such event");

  const existingTranslations = await listTranslationsForEvent(db, input.eventId);

  // Parsed and checked before the transaction opens, so a malformed form never holds a row lock
  // while the organizer's browser is told what is wrong with it.
  const parsedEventFields =
    input.fields === undefined ? undefined : normalizeForType(parseOrThrow(eventFieldsSchema, input.fields));
  if (parsedEventFields) {
    if (!canEditEventFields(input.actor.role)) {
      throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not edit event details`);
    }
    assertCoherentRegistrationBlock(parsedEventFields);
  }
  const times = parsedEventFields ? resolveTimes(parsedEventFields) : undefined;

  await db.transaction(async (tx) => {
    if (parsedEventFields && times) {
      /**
       * Lowering capacity below the places already taken is refused (AGENTS.md §10.6,
       * BR-REQ-034-02 criterion 3). Counted inside the transaction so a confirmation landing
       * between the count and the write cannot slip past it.
       */
      if (parsedEventFields.capacity !== null) {
        const occupied = computeOccupied(await countOccupied(tx, input.eventId, now));
        if (parsedEventFields.capacity < occupied) {
          throw new DomainError(
            "VALIDATION_ERROR",
            `capacity: ${occupied} places are already taken; capacity cannot be lowered below that`,
          );
        }
      }

      if (parsedEventFields.featured) await clearFeaturedExcept(tx, input.eventId, now);

      await updateEventWithVersionGuard(
        tx,
        input.eventId,
        input.expectedVersion as number,
        { ...eventColumnsFrom(parsedEventFields, times), updatedByStaffUserId: input.actor.id },
        now,
      );
    }

    for (const submitted of input.translations) {
      const existing = existingTranslations.find((row) => row.id === submitted.translationId);
      if (!existing) throw new DomainError("NOT_FOUND", "no such event translation");

      await applyTranslationSave(tx, {
        actor: input.actor,
        event: current,
        current: existing,
        expectedVersion: submitted.expectedVersion,
        fields: submitted.fields,
        acknowledgeLiveEdit: input.acknowledgeLiveEdit,
        eventType: parsedEventFields?.type ?? current.type,
        now,
      });
    }
  });
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

  const parsed = normalizeForType(parseOrThrow(newEventSchema, input.fields));
  assertCoherentRegistrationBlock(parsed);
  const times = resolveTimes(parsed);

  return db.transaction(async (tx) => {
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

    await tx.insert(eventTranslations).values(
      routing.locales.map((locale) => ({
        eventId: event.id,
        locale,
        ...parsed.translations[locale],
        authorStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })),
    );

    return event;
  });
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
 * featured flag, and the start list switch — publishing names is a decision about the people
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
    // Not carried: a film is of one edition, and last year's would be wrong on next year's;
    // a Strava group event is one occurrence's page. The co-host is: a series held with a
    // partner is held with them every time.
    videoUrl: null,
    stravaEventUrl: null,
    coHostName: source.coHostName,
    coHostUrl: source.coHostUrl,
    locationName: source.locationName,
    locationAddress: source.locationAddress,
    difficulty: source.difficulty,
    costType: source.costType,
    distanceMeters: source.distanceMeters,
    elevationGainMeters: source.elevationGainMeters,
    featured: false,
    capacity: source.capacity,
    confirmationOpensDaysBefore: source.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: source.confirmationDeadlineDaysBefore,
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
    seoTitle: translation.seoTitle,
    seoDescription: translation.seoDescription,
    authorStaffUserId: actor.id,
    createdAt: now,
    updatedAt: now,
  };
}

/** How often a repeated event recurs. Three cadences, because three is what the club runs. */
export const REPEAT_CADENCES = ["WEEKLY", "FORTNIGHTLY", "MONTHLY"] as const;
export type RepeatCadence = (typeof REPEAT_CADENCES)[number];

const CADENCE_INTERVAL: Record<RepeatCadence, { days?: number; months?: number }> = {
  WEEKLY: { days: 7 },
  FORTNIGHTLY: { days: 14 },
  MONTHLY: { months: 1 },
};

/** At most a year of weekly copies in one go; a longer series is a second press. */
export const REPEAT_MAX_COUNT = 52;
/** Two a week for a year, with weekdays; a bigger series is a second press. */
export const REPEAT_MAX_OCCURRENCES = 104;
/** ISO weekdays, 1 = Monday … 7 = Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type RepeatEventInput = {
  actor: Actor;
  eventId: string;
  cadence: RepeatCadence;
  /**
   * How many further occurrences to create after the source — or, with `weekdays`, how many
   * weeks (fortnights) the series covers, the source's own week included.
   */
  count: number;
  /**
   * "Every Monday and Wednesday" (2026-09-18, `DECISIONS.md` §64): the days of the week the
   * event happens on, ISO numbered. With WEEKLY or FORTNIGHTLY only; MONTHLY ignores it. The
   * source's own day need not be in the set — a Sunday run "every Monday and Wednesday" starts
   * the Monday after. Empty or absent means the source's own weekday, as before.
   */
  weekdays?: readonly Weekday[];
  /** Publish the copies as they are made. Only honoured when the source is itself published. */
  publish: boolean;
  now?: Date;
};

/**
 * The same event again, every week, fortnight or month — the weekly run, made once.
 *
 * Each copy is the source shifted on the wall clock in its own zone (`addWallClockInterval`),
 * and everything that has a time moves with it — the end, the gun time, the registration
 * window — so the relationships the organizer set hold on every occurrence. The slug carries
 * the date (`alergare-de-duminica-2026-10-04`) rather than a `-2`, `-3` suffix: a URL that
 * says which Sunday it is, in both languages, and never collides with next year's series.
 *
 * Copies are drafts unless `publish` is asked for **and** the source is published: a published
 * source is one whose both languages are complete (`transitionEvent` asserted that), so its
 * copies can go live without re-checking; a draft source cannot be, and the flag is ignored
 * rather than refused so a form with the box ticked still does something useful. Publishing
 * copies needs the role that publishes (`AGENTS.md` §10.2), like any other publication.
 *
 * One transaction: all the occurrences or none, so a collision on the ninth slug does not
 * leave eight events behind for somebody to find later.
 */
export async function repeatEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: RepeatEventInput,
): Promise<{ created: number; published: boolean }> {
  const now = input.now ?? new Date();

  if (!canCreateEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not repeat an event`);
  }
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > REPEAT_MAX_COUNT) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `count: repeat an event between 1 and ${REPEAT_MAX_COUNT} times in one go`,
    );
  }

  const [source] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!source) throw new DomainError("NOT_FOUND", "no such event");
  const sourceTranslations = await listTranslationsForEvent(db, input.eventId);

  const publish = input.publish && source.editorialStatus === "PUBLISHED";
  if (publish && !canTransition(input.actor.role, "IN_REVIEW", "PUBLISHED", false)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not publish`);
  }

  const interval = CADENCE_INTERVAL[input.cadence];
  const weekdays = input.cadence === "MONTHLY" ? [] : [...new Set(input.weekdays ?? [])].sort();
  if (weekdays.some((day) => !WEEKDAYS.includes(day))) {
    throw new DomainError("VALIDATION_ERROR", "weekdays: 1 (Monday) to 7 (Sunday)");
  }

  /**
   * How far each occurrence sits from the source, on the calendar. Without weekdays: one
   * interval per occurrence, as before. With them: for each week the series covers, each
   * chosen day at its offset from the source's own day — skipping anything on or before the
   * source, so the source is never duplicated and a series never runs backwards.
   */
  const sourceWeekday = wallClockWeekday(source.startsAt, source.timezone);
  const steps: Array<{ days?: number; months?: number }> =
    weekdays.length === 0
      ? Array.from({ length: input.count }, (_, index) => ({
          days: (interval.days ?? 0) * (index + 1),
          months: (interval.months ?? 0) * (index + 1),
        }))
      : Array.from({ length: input.count }, (_, week) =>
          weekdays.map((day) => ({ days: day - sourceWeekday + (interval.days ?? 7) * week })),
        )
          .flat()
          .filter((step) => (step.days ?? 0) > 0);
  if (steps.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "the chosen days give no occurrence after this event");
  }
  if (steps.length > REPEAT_MAX_OCCURRENCES) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `that is ${steps.length} occurrences; at most ${REPEAT_MAX_OCCURRENCES} in one go`,
    );
  }
  const shift = (date: Date | null, step: { days?: number; months?: number }) =>
    date === null ? null : addWallClockInterval(date, source.timezone, step);

  // The slugs, all of them, checked before anything is written: the date suffix is what
  // makes them distinct, and a series already made once collides on every one of them.
  const occurrences = steps.map((step) => {
    const startsAt = shift(source.startsAt, step) as Date;
    const dateSuffix = startsAt.toISOString().slice(0, 10);
    return {
      step,
      startsAt,
      slugs: new Map(
        sourceTranslations.map((translation) => [
          translation.id,
          `${translation.slug.replace(/-\d{4}-\d{2}-\d{2}$/, "")}-${dateSuffix}`,
        ]),
      ),
    };
  });
  for (const translation of sourceTranslations) {
    const wanted = occurrences.map((occurrence) => occurrence.slugs.get(translation.id) as string);
    const taken = await findTakenSlugs(db, translation.locale, wanted);
    const collision = wanted.find((slug) => taken.has(slug));
    if (collision) {
      throw new DomainError(
        "CONFLICT",
        `an event already has the address "${collision}" in ${translation.locale}; this series exists`,
      );
    }
  }

  await db.transaction(async (tx) => {
    for (const occurrence of occurrences) {
      const [copy] = await tx
        .insert(events)
        .values({
          ...copiedEventValues(source, input.actor, now),
          startsAt: occurrence.startsAt,
          endsAt: shift(source.endsAt, occurrence.step),
          raceStartsAt: shift(source.raceStartsAt, occurrence.step),
          scheduleItems: source.scheduleItems
            ? shiftScheduleItems(readScheduleItems(source.scheduleItems), source.timezone, occurrence.step)
            : null,
          registrationOpensAt: shift(source.registrationOpensAt, occurrence.step),
          registrationClosesAt: shift(source.registrationClosesAt, occurrence.step),
          ...(publish ? { editorialStatus: "PUBLISHED" as const, publishedAt: now } : {}),
        })
        .returning();

      await tx.insert(eventTranslations).values(
        sourceTranslations.map((translation) =>
          copiedTranslationValues(
            translation,
            copy.id,
            occurrence.slugs.get(translation.id) as string,
            input.actor,
            now,
          ),
        ),
      );
    }
  });

  return { created: occurrences.length, published: publish };
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
    throw new DomainError(
      "VALIDATION_ERROR",
      `this event has ${registered} registration(s) and cannot be deleted; archive it instead`,
    );
  }

  // `event_translations` cascades from the event; nothing else references an event with no
  // registrations against it.
  await db.delete(events).where(eq(events.id, input.eventId));
}
