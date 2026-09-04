import { and, eq, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { eventTranslations, events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";
import { fromWallTimeInput } from "@/modules/events/domain/zoned-time";
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
  const endsAt = optional(fields.endsAtWallTime, "endsAt");
  const raceStartsAt = optional(fields.raceStartsAtWallTime, "raceStartsAt");
  const registrationOpensAt = optional(fields.registrationOpensAtWallTime, "registrationOpensAt");
  const registrationClosesAt = optional(fields.registrationClosesAtWallTime, "registrationClosesAt");

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

  return { startsAt, endsAt, raceStartsAt, registrationOpensAt, registrationClosesAt };
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
  if ((fields.latitude === null) !== (fields.longitude === null)) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "coordinates: give both latitude and longitude, or neither",
    );
  }

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
    kind: fields.kind,
    eventStatus: fields.eventStatus,
    timezone: fields.timezone,
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    raceStartsAt: times.raceStartsAt,
    latitude: fields.latitude,
    longitude: fields.longitude,
    mapUrl: fields.mapUrl,
    distanceMeters: fields.distanceMeters,
    elevationGainMeters: fields.elevationGainMeters,
    featured: fields.featured,
    registrationMode: fields.registrationMode,
    capacity: fields.capacity,
    registrationOpensAt: times.registrationOpensAt,
    registrationClosesAt: times.registrationClosesAt,
    declarationDocumentId: fields.declarationDocumentId,
    externalProvider: fields.externalProvider,
    externalRegistrationUrl: fields.externalRegistrationUrl,
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

export async function saveEventTranslation<T extends Record<string, unknown>>(
  db: Database<T>,
  input: SaveTranslationInput,
): Promise<EditableTranslation> {
  const now = input.now ?? new Date();

  const record = await findTranslationWithEventById(db, input.translationId);
  if (!record) throw new DomainError("NOT_FOUND", "no such event translation");
  const { event, translation: current } = record;

  assertMayEdit(input.actor, event, current);

  if (isLiveContent(event.editorialStatus) && input.acknowledgeLiveEdit !== true) {
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
  if (event.publishedAt !== null && fields.slug !== current.slug) {
    throw new DomainError(
      "FORBIDDEN",
      "the slug of a published translation cannot be changed; it is a public URL",
    );
  }

  return updateTranslationWithVersionGuard(
    db,
    input.translationId,
    input.expectedVersion,
    {
      ...fields,
      // A row nobody has claimed becomes the saver's — the seeded rows have no author, and
      // "their own drafts" needs one for the rule to mean anything. An existing author is
      // never overwritten: an Editor fixing a typo does not take the piece.
      authorStaffUserId: current.authorStaffUserId ?? input.actor.id,
    },
    now,
  );
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
 * Every column an organizer owns: the kind, the status, the times and the timezone, the
 * coordinates and the map link, the distance and the climb, the featured flag, and the whole
 * registration block.
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

  const fields = parseOrThrow(eventFieldsSchema, input.fields);
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

  const parsed = parseOrThrow(newEventSchema, input.fields);
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
      .values({
        raceId: source.raceId,
        kind: source.kind,
        eventStatus: source.eventStatus,
        startsAt: source.startsAt,
        endsAt: source.endsAt,
        raceStartsAt: source.raceStartsAt,
        timezone: source.timezone,
        latitude: source.latitude,
        longitude: source.longitude,
        mapUrl: source.mapUrl,
        distanceMeters: source.distanceMeters,
        elevationGainMeters: source.elevationGainMeters,
        featured: false,
        capacity: source.capacity,
        registrationMode: source.registrationMode,
        registrationOpensAt: source.registrationOpensAt,
        registrationClosesAt: source.registrationClosesAt,
        declarationDocumentId: source.declarationDocumentId,
        externalProvider: source.externalProvider,
        externalRegistrationUrl: source.externalRegistrationUrl,
        editorialStatus: "DRAFT",
        publishedAt: null,
        createdByStaffUserId: input.actor.id,
        updatedByStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await tx.insert(eventTranslations).values(
      sourceTranslations.map((translation) => ({
        eventId: copy.id,
        locale: translation.locale,
        slug: slugs.get(translation.id) as string,
        title: translation.title,
        excerpt: translation.excerpt,
        bodyJson: translation.bodyJson,
        locationName: translation.locationName,
        locationAddress: translation.locationAddress,
        difficultyLabel: translation.difficultyLabel,
        coverAltText: translation.coverAltText,
        costText: translation.costText,
        seoTitle: translation.seoTitle,
        seoDescription: translation.seoDescription,
        authorStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })),
    );

    return copy;
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
    throw new DomainError(
      "VALIDATION_ERROR",
      `this event has ${registered} registration(s) and cannot be deleted; archive it instead`,
    );
  }

  // `event_translations` cascades from the event; nothing else references an event with no
  // registrations against it.
  await db.delete(events).where(eq(events.id, input.eventId));
}
