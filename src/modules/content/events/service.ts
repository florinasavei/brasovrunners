import { and, eq, ne, sql } from "drizzle-orm";
import { eventTranslations, events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { fromWallTimeInput } from "@/modules/events/domain/zoned-time";
import {
  canEditEventFields,
  canEditTranslation,
  canTransition,
  type EditorialStatus,
  isLiveContent,
} from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { eventFieldsSchema, translationFieldsSchema } from "./fields";
import { type EditableEvent, type EditableTranslation, findTranslationById } from "./repository";

/**
 * Editing and publishing event content (BR-REQ-050-01, BR-REQ-051-01).
 *
 * Priority-1 code — `docs/PRACTICES.md`. Read every line.
 *
 * Two rules run through all of it:
 *
 *   1. Authorization is asserted here, on the server, for every write (BR-REQ-060-01). The
 *      acting staff user is an argument, never a session this module reads for itself, so a
 *      page cannot pass "the user I already checked" and a test needs no browser.
 *   2. A save carries the version it was loaded with. A stale one is a CONFLICT and nothing is
 *      written (BR-REQ-051-01 criterion 5). Two organizers editing one event on a Sunday
 *      morning is the ordinary case, and last-write-wins would silently discard one of them.
 */

type Actor = Pick<StaffUser, "id" | "role">;

/**
 * The conflict check, in one statement.
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
async function updateWithVersionGuard<T extends Record<string, unknown>>(
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

function assertMayEdit(actor: Actor, translation: EditableTranslation): void {
  if (
    !canEditTranslation(
      actor.role,
      {
        editorialStatus: translation.editorialStatus,
        authorStaffUserId: translation.authorStaffUserId,
      },
      actor.id,
    )
  ) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${actor.role} may not edit a ${translation.editorialStatus} translation`,
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

  const current = await findTranslationById(db, input.translationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such event translation");

  assertMayEdit(input.actor, current);

  if (isLiveContent(current.editorialStatus) && input.acknowledgeLiveEdit !== true) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "this translation is published; confirm the warning before saving live content",
    );
  }

  const parsed = translationFieldsSchema.safeParse(input.fields);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }

  /**
   * AGENTS.md §11.5: a slug is editable before first publication and stable afterwards.
   *
   * Keyed on `published_at`, which is set once and never cleared, rather than on the current
   * status — unpublishing must not hand back an editable slug for a URL people have already
   * followed and search engines have already indexed. §11.5 allows an Administrator an
   * exceptional change with a redirect plan; there are no redirects yet, so there is no
   * exception yet either.
   */
  if (current.publishedAt !== null && parsed.data.slug !== current.slug) {
    throw new DomainError(
      "FORBIDDEN",
      "the slug of a published translation cannot be changed; it is a public URL",
    );
  }

  return updateWithVersionGuard(
    db,
    input.translationId,
    input.expectedVersion,
    {
      ...parsed.data,
      // A row nobody has claimed becomes the saver's — the seeded rows have no author, and
      // "their own drafts" needs one for the rule to mean anything. An existing author is
      // never overwritten: an Editor fixing a typo does not take the piece.
      authorStaffUserId: current.authorStaffUserId ?? input.actor.id,
    },
    now,
  );
}

export type TransitionInput = {
  actor: Actor;
  translationId: string;
  expectedVersion: number;
  to: EditorialStatus;
  now?: Date;
};

/**
 * Move one locale through the editorial workflow (AGENTS.md §11.2).
 *
 * Publication is per locale by construction: this acts on one `event_translations` row, so
 * Romanian can go live while English is still being written, which is the state BR-REQ-040-02
 * requires the public pages to handle.
 *
 * A transition carries a version too. Publishing what you think is a reviewed draft, when a
 * colleague has rewritten it since you opened the page, is the same failure as overwriting it.
 */
export async function transitionTranslation<T extends Record<string, unknown>>(
  db: Database<T>,
  input: TransitionInput,
): Promise<EditableTranslation> {
  const now = input.now ?? new Date();

  const current = await findTranslationById(db, input.translationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such event translation");

  const isOwnDraft = current.authorStaffUserId === input.actor.id;
  if (!canTransition(input.actor.role, current.editorialStatus, input.to, isOwnDraft)) {
    throw new DomainError(
      "FORBIDDEN",
      `role ${input.actor.role} may not move a translation from ${current.editorialStatus} to ${input.to}`,
    );
  }

  const changes: Partial<typeof eventTranslations.$inferInsert> = {
    editorialStatus: input.to,
  };

  // First publication stamps the date. Later ones do not touch it: it is what slug stability
  // and the sitemap's `lastModified` both read, and re-stamping would claim the page is new
  // every time a typo is fixed.
  if (input.to === "PUBLISHED") {
    changes.reviewedByStaffUserId = input.actor.id;
    if (current.publishedAt === null) changes.publishedAt = now;
  }
  if (current.editorialStatus === "IN_REVIEW" && input.to === "DRAFT") {
    changes.reviewedByStaffUserId = input.actor.id;
  }

  return updateWithVersionGuard(db, input.translationId, input.expectedVersion, changes, now);
}

export type SaveEventFieldsInput = {
  actor: Actor;
  eventId: string;
  fields: unknown;
  now?: Date;
};

/**
 * The event row: its two times, its map link, and whether the site leads with it.
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

  const parsed = eventFieldsSchema.safeParse(input.fields);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }

  const startsAt = fromWallTimeInput(parsed.data.startsAtWallTime, current.timezone);
  if (!startsAt) {
    throw new DomainError("VALIDATION_ERROR", "startsAt: a date and time are required");
  }

  const raceStartsAt = fromWallTimeInput(parsed.data.raceStartsAtWallTime, current.timezone);
  if (parsed.data.raceStartsAtWallTime.trim() !== "" && !raceStartsAt) {
    throw new DomainError("VALIDATION_ERROR", "raceStartsAt: not a date and time");
  }
  // Checked here so the organizer gets a sentence rather than a constraint violation. The
  // CHECK on the table is what actually holds, and a test asserts it independently.
  if (raceStartsAt && raceStartsAt.getTime() < startsAt.getTime()) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "raceStartsAt: the race cannot start before the event begins",
    );
  }
  if (raceStartsAt && current.endsAt && raceStartsAt.getTime() > current.endsAt.getTime()) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "raceStartsAt: the race cannot start after the event ends",
    );
  }

  /**
   * Featuring an event un-features the previous one, in one transaction.
   *
   * The database is the guarantee — a partial unique index refuses a second featured row — and
   * this clear is the mechanism that keeps the guarantee from simply rejecting every save.
   * Both statements are in one transaction so there is never an instant with none, and never a
   * clear that survives a failed set.
   */
  return db.transaction(async (tx) => {
    if (parsed.data.featured) {
      await tx
        .update(events)
        .set({ featured: false, updatedAt: now })
        .where(and(eq(events.featured, true), ne(events.id, input.eventId)));
    }

    const [updated] = await tx
      .update(events)
      .set({
        startsAt,
        raceStartsAt,
        mapUrl: parsed.data.mapUrl,
        featured: parsed.data.featured,
        updatedByStaffUserId: input.actor.id,
        updatedAt: now,
      })
      .where(eq(events.id, input.eventId))
      .returning();

    if (!updated) throw new DomainError("NOT_FOUND", "no such event");
    return updated;
  });
}
