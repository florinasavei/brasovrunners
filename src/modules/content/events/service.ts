import { and, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { eventTranslations, events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import { routing } from "@/i18n/routing";
import type { Locale } from "@/i18n/routing";
import { readCoHosts } from "@/modules/events/domain/co-hosts";
import { hasProgramme, takesRegistrations } from "@/modules/events/domain/event-type";
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
function assertCoherentRegistrationBlock(fields: EventFieldsInput): void {
  // Every refusal names the boxes it is about (§47, §315), so the form can link to them.
  if (fields.registrationMode !== "INTERNAL") {
    if (fields.capacity !== null || fields.declarationDocumentId !== null) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "capacity and a declaration belong to an event that takes registrations here; set the mode to INTERNAL or clear them",
        ["registrationMode", ...(fields.capacity !== null ? ["capacity"] : []), ...(fields.declarationDocumentId !== null ? ["declarationDocumentId"] : [])],
      );
    }
  } else if (fields.declarationDocumentId === null) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "an event that takes registrations must name the approved declaration a participant signs",
      ["declarationDocumentId"],
    );
  }

  if (fields.participantListVisibility === "NAMES" && fields.registrationMode !== "INTERNAL") {
    // For NONE there are no participants to list, and for EXTERNAL the people who entered are
    // the other organizer's — the club holds no registrations for them (BR-REQ-039-01).
    throw new DomainError(
      "VALIDATION_ERROR",
      "a start list can only be published for an event that takes registrations here",
      ["participantListVisibility"],
    );
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
    locationName: fields.locationName,
    locationAddress: fields.locationAddress,
    difficulty: fields.difficulty,
    costType: fields.costType,
    distanceMeters: fields.distanceMeters,
    elevationGainMeters: fields.elevationGainMeters,
    featured: fields.featured,
    isSpecial: fields.isSpecial,
    registrationMode: fields.registrationMode,
    capacity: fields.capacity,
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
    // Who may enter, counted on the event's day at every door (§NNN).
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
   * BR-REQ-034-02 criterion 3). Counted here rather than trusted from a cached figure, behind
   * the event row's lock — the serialization point every allocation takes — so a confirmation
   * landing between the count and the write waits rather than slipping past it.
   */
  return db.transaction(async (tx) => {
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
  /** Which dates of the series this save reaches (§130); "this" — the default — is the one event. */
  scope?: SeriesEditScope;
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
  "coHosts",
  "locationName",
  "locationAddress",
  "difficulty",
  "costType",
  "distanceMeters",
  "elevationGainMeters",
  "registrationMode",
  "capacity",
  // One race, one band: a series is the same event on several dates (§173, §177).
  "bibStartNumber",
  "bibColour",
  "bibDesign",
  "confirmationOpensDaysBefore",
  "confirmationDeadlineDaysBefore",
  // One race, one age rule: every date of a series takes the same people (§NNN).
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
  // The place's name in this language (migration `0058`): a word, so it travels like one.
  "locationName",
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
    now: Date;
  },
): Promise<{ applied: number; offered: number }> {
  const { before, after, now } = input;
  const sourceId = before.repeatOf ?? (before.repeatRule ? before.id : null);
  if (!sourceId) return { applied: 0, offered: 0 };
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
  if (Object.keys(rowChanges).length === 0 && timeChanges.length === 0 && !scheduleChanged && translationChanges.length === 0) {
    return { applied: 0, offered: 0 };
  }

  // The series is the source and every date made from it; "following" is by the day this
  // date had before the save, so moving it does not change which dates follow; ticked dates
  // are those and no other, whatever else the list carried.
  const chosen = typeof input.scope === "object" ? input.scope.ids.filter((id) => id !== before.id) : null;
  if (chosen && chosen.length === 0) return { applied: 0, offered: 0 };
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

    let touched = false;
    if (Object.keys(changes).length > 0) {
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
    if (touched) applied += 1;
  }
  return { applied, offered };
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
): Promise<{ appliedTo: number; offered: number }> {
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

  return db.transaction(async (tx) => {
    let savedEvent: EditableEvent = current;
    const savedTranslations: EditableTranslation[] = [];
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

    // More places than before: the difference goes to the waiting list at once (§147), here,
    // where the row is already locked by the guarded update and the number is not yet committed.
    let offered = capacityRaised(current, savedEvent) ? await offerRaisedCapacity(tx, savedEvent.id, now) : 0;

    // The other dates of the series, when asked (§130) — after this one, so what travels is
    // exactly what was written, and inside the transaction, so a refused date undoes it all.
    const scope = input.scope ?? "this";
    let appliedTo = 0;
    if (scope !== "this") {
      const series = await applyToSeries(tx, {
        actor: input.actor,
        scope,
        before: current,
        after: savedEvent,
        translationsBefore: existingTranslations,
        translationsAfter: savedTranslations,
        now,
      });
      appliedTo = series.applied;
      offered += series.offered;
    }
    return { appliedTo, offered };
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

    // Through the same function a save writes with: the rich summary's words become the
    // plain `excerpt`, the empty documents become null, a group run gets no programme.
    await tx.insert(eventTranslations).values(
      routing.locales.map((locale) => ({
        eventId: event.id,
        locale,
        ...translationColumnsFrom(parsed.translations[locale], parsed.type),
        authorStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })),
    );

    return event;
  });
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
export type NewEventRepeatRule = Omit<RepeatEventInput["rule"], "publish">;

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

    // The series, as drafts — or live, when the source has just gone live: the rule's own
    // `publish` flag is what §122 already does for a published source.
    const rule = { ...input.repeat, publish: published };
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
    difficulty: source.difficulty,
    costType: source.costType,
    distanceMeters: source.distanceMeters,
    elevationGainMeters: source.elevationGainMeters,
    featured: false,
    // Nor the special mark (§168): it says something about one edition — the anniversary, the
    // Wednesday another club's race passes through — and the copy is a different one.
    isSpecial: false,
    capacity: source.capacity,
    confirmationOpensDaysBefore: source.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: source.confirmationDeadlineDaysBefore,
    // Who may enter is a property of the race, not of one edition (§NNN): a copy and every date
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
  const publish = input.rule.publish && source.editorialStatus === "PUBLISHED";
  if (publish && !canTransition(input.actor.role, "IN_REVIEW", "PUBLISHED", false)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not publish`);
  }
  const rule = repeatRuleSchema.safeParse({ cadence: input.rule.cadence, weekdays, until: input.rule.until, publish });
  if (!rule.success) throw new DomainError("VALIDATION_ERROR", "until: a date, or nothing for a series without an end", ["until"]);
  const end = untilEnd(rule.data, source.timezone);
  if (end && end.getTime() <= source.startsAt.getTime()) {
    throw new DomainError("VALIDATION_ERROR", "until: the end must be after this event", ["until"]);
  }

  await db.update(events).set({ repeatRule: rule.data, updatedAt: now, updatedByStaffUserId: input.actor.id }).where(eq(events.id, source.id));
  const created = await materializeSeries(db, { ...source, repeatRule: rule.data }, rule.data, input.actor, now);
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

/** Stop a series: no further occurrences are made; the ones that exist stay (the bulk verbs remove them). */
export async function stopRepeat<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; eventId: string; now?: Date },
): Promise<void> {
  if (!canCreateEvent(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not change a series`);
  }
  const [source] = await db.select({ id: events.id }).from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!source) throw new DomainError("NOT_FOUND", "no such event");
  await db
    .update(events)
    .set({ repeatRule: null, updatedAt: input.now ?? new Date(), updatedByStaffUserId: input.actor.id })
    .where(eq(events.id, input.eventId));
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

  return db.transaction(async (tx) => {
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
}
