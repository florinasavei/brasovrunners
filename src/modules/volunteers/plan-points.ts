import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { eventCheckpoints, PLAN_POINT_NOTE_MAX } from "@/db/schema/event-checkpoints";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { CHECKPOINT_NAME_MAX, type CheckpointKind, readKm } from "@/modules/event-checkpoints/domain/checkpoint";
import { COORDINATES_BOX, type Coordinates, parseCoordinates } from "@/modules/event-checkpoints/domain/coordinates";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isWrittenText, missingLanguage } from "@/shared/forms/both-languages";
import { isUuid } from "@/shared/ids";

/*
  «Punctele planului» (§961; the owner, 2026-11-17, a day after «Planul voluntarilor» got its picture and four days before
  the race: «După ce încarc acea poză cu harta de voluntari vreau să pot defini punctele de mână, să pun nume punct și la ce
  km e și coordonate punct» — and, minutes later: «Practic voluntarii sunt de 2 tipuri: start-finish și pe traseu»).

  The plan's picture is the organizers' map with the volunteers' points numbered on it. Until now the plan's points were only
  the event's public «Puncte pe traseu» (§757) — each on the event's page, the route's chart and the race number — and whoever
  works at the start and the finish stood under «Fără punct», among the people nobody had placed. So the plan has points of
  its own, typed on the plan's page:

  - **a point on the route** — a name, the kilometre it is at, and a number in the route's order;
  - **a point at the start–finish** — a name; no kilometre said anywhere, no number.

  The two kinds are kinds of POINT, not of person: a volunteer's kind is where they stand (`event_volunteers.checkpoint_id`,
  §949), so there is no second thing about a person to keep in step with their point. Any point — the editor's too — may also
  say where it is (`latitude`, `longitude`), which the plan's page and the volunteer's own email turn into a link to a map.

  **Two readers of one table, kept apart by construction.** The rows live in `event_checkpoints` beside the editor's points
  (`plan_only`, `start_finish`; migration `0211`). The public side — the event's page, the chart, the preview, the race
  number, the editor's card, the event's file, a copy — reads through `event-checkpoints/checkpoints.ts#listCheckpoints`,
  which leaves every plan-only row out and whose `Checkpoint` has no field for the kind or the coordinates. The volunteers'
  side reads through `listPlanPoints` here, and here only: this file is in `modules/volunteers/`, not beside
  `listCheckpoints`, so that the reader which sees everything can be held to the plan's own files by one list
  (`tests/unit/volunteers/plan-points-never-leave.test.ts`) and nothing under `event-checkpoints/` — which the public pages
  import — can hand a plan-only point or a coordinate to them.

  **One order, one number.** `listPlanPoints` is the plan's one order — the start–finish points first, then the route by
  kilometre — and gives each route point its number. The plan's page, the «Voluntari» list's «Punct» column and the «Punctul
  tău» email all read it, so the three cannot disagree about which point is «3».

  Nothing here emails anybody, moves a person's state or number, or expires a public cache tag: no public page reads these
  rows. Telling the volunteers stays one press of its own, «Trimite fiecăruia punctul lui» (§956).

  **«Notă pentru voluntari» (§1009; the owner, 2026-11-19: «si am nevoie de un nou field "noua pentru voluntari"»).** Every
  point — the editor's and the plan's own alike — may carry what everybody standing there has to know («Direcționați spre
  stânga la intersecție; vestă reflectorizantă»), in Romanian and in English, both or neither, at most `PLAN_POINT_NOTE_MAX`
  characters each, its line breaks kept (`volunteer_note_ro`, `volunteer_note_en`). It is the plan's side of
  a point as the coordinates are: written here, in the point's own «Salvează punctul», read through `listPlanPoints` by the
  plan's page and the point's email, and never by the public side — which has its own short note, `note_ro` / `note_en`, the
  event's page shows.
*/

type Actor = Pick<StaffUser, "id" | "role">;

/** Where a point of the plan stands: on the route (a kilometre, a number) or at the start–finish (neither). */
export const PLAN_POINT_PLACES = ["route", "startFinish"] as const;
export type PlanPointPlace = (typeof PLAN_POINT_PLACES)[number];

/** More points of the plan's own than this on one event is a list nobody reads; both kinds together. The forty-first is refused. */
export const PLAN_POINTS_MAX = 40;

/** One point as the volunteers' side has it: the editor's or the plan's own, with its kind, its place on a map and its number. */
export type PlanPoint = {
  id: string;
  /** The editor's point: its name in each language. The plan's own: the one name the organizers typed, in both. */
  nameRo: string;
  nameEn: string;
  /** Kilometres from the start. Not said for a start–finish point, whose column holds 0. */
  km: number;
  /** What an editor's point offers (§757), in the closed set's order; none on a point of the plan's own. */
  kinds: readonly CheckpointKind[];
  noteRo: string | null;
  noteEn: string | null;
  /** A point of the volunteers' plan alone, added on the plan's page: on no public page, chart, race number, file or copy. */
  planOnly: boolean;
  /** At the start–finish, not on the route: no kilometre, no number. Only a plan-only point is one. */
  startFinish: boolean;
  /** Where the point is, six decimals — both or neither. */
  latitude: number | null;
  longitude: number | null;
  /**
   * «Notă pentru voluntari» (§1009): what everybody standing here has to know, in each language — both or neither, line breaks
   * as `\n`. Any point may have one, the editor's too; null for none.
   */
  volunteerNoteRo: string | null;
  volunteerNoteEn: string | null;
  /** The point's place in the route's order, 1 for the first — the number the picture's points follow; null at the start–finish. */
  number: number | null;
};

/** A point's coordinates as one pair, or null: the shape `formatCoordinates` and `mapUrlOf` take. */
export function coordinatesOf(point: Pick<PlanPoint, "latitude" | "longitude">): Coordinates | null {
  return point.latitude === null || point.longitude === null ? null : { latitude: point.latitude, longitude: point.longitude };
}

/**
 * Every point of one event as the volunteers' side reads it — the editor's and the plan's own — in the plan's ONE order:
 *
 * 1. the start–finish points, in the order they were added — `number: null`;
 * 2. the points on the route by kilometre; at the same kilometre the editor's first, in their own order, then the plan's
 *    own in the order they were added — numbered from 1 in that order. The editor's points and the plan's own share the one
 *    count: it is the route's order, which is what the numbers on the organizers' picture follow.
 *
 * «The order they were added» is the row's `position`, which `changePlanPoint` counts up under the event's lock — never the
 * clock, so two points added in the same instant keep their order — with the row's time and id behind it.
 *
 * No role is asked here: the callers are the plan's read and the «Voluntari» list, which ask it themselves, and the outbox's
 * renderer, with nobody signed in (`point-mail.ts#volunteerPointAtSend`). Who may import this is held by the guard.
 */
export async function listPlanPoints<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<PlanPoint[]> {
  const rows = await db
    .select({
      id: eventCheckpoints.id,
      nameRo: eventCheckpoints.nameRo,
      nameEn: eventCheckpoints.nameEn,
      km: eventCheckpoints.km,
      kinds: eventCheckpoints.kinds,
      noteRo: eventCheckpoints.noteRo,
      noteEn: eventCheckpoints.noteEn,
      planOnly: eventCheckpoints.planOnly,
      startFinish: eventCheckpoints.startFinish,
      latitude: eventCheckpoints.latitude,
      longitude: eventCheckpoints.longitude,
      volunteerNoteRo: eventCheckpoints.volunteerNoteRo,
      volunteerNoteEn: eventCheckpoints.volunteerNoteEn,
    })
    .from(eventCheckpoints)
    .where(eq(eventCheckpoints.eventId, eventId))
    .orderBy(
      desc(eventCheckpoints.startFinish),
      // A start–finish point's kilometre is read by nobody, the order included.
      asc(sql`CASE WHEN ${eventCheckpoints.startFinish} THEN 0 ELSE ${eventCheckpoints.km} END`),
      asc(eventCheckpoints.planOnly),
      asc(eventCheckpoints.position),
      asc(eventCheckpoints.createdAt),
      asc(eventCheckpoints.id),
    );
  let onRoute = 0;
  return rows.map((row) => ({
    id: row.id,
    nameRo: row.nameRo,
    nameEn: row.nameEn,
    km: row.startFinish ? 0 : Number(row.km),
    kinds: row.kinds,
    noteRo: row.noteRo,
    noteEn: row.noteEn,
    planOnly: row.planOnly,
    startFinish: row.startFinish,
    latitude: row.latitude === null || row.longitude === null ? null : Number(row.latitude),
    longitude: row.latitude === null || row.longitude === null ? null : Number(row.longitude),
    volunteerNoteRo: row.volunteerNoteRo,
    volunteerNoteEn: row.volunteerNoteEn,
    number: row.startFinish ? null : (onRoute += 1),
  }));
}

// ---------------------------------------------------------------------------------------------
// The verbs: «Adaugă punctul», «Salvează punctul», «Șterge punctul»
// ---------------------------------------------------------------------------------------------

/** The form's boxes, as a refusal names them — the two of «Notă pentru voluntari» (§1009) in «Modifică punctul» alone. */
export const PLAN_POINT_BOXES = {
  place: "place",
  name: "name",
  km: "km",
  coordinates: COORDINATES_BOX,
  volunteerNoteRo: "volunteerNoteRo",
  volunteerNoteEn: "volunteerNoteEn",
} as const;

/** The sentences a refused press of the plan's points is answered with: `Admin.errors.<reason>`. */
export const PLAN_POINT_REASONS = [
  "PLAN_POINT_PLACE_UNKNOWN",
  "PLAN_POINT_NAME_MISSING",
  "PLAN_POINT_KM_INVALID",
  "PLAN_POINT_TOO_MANY",
  "PLAN_POINT_IN_EDITOR",
  // «Notă pentru voluntari» (§1009): written in one language only, or longer than `PLAN_POINT_NOTE_MAX` in one of them.
  "PLAN_POINT_NOTE_ONE_LANGUAGE",
  "PLAN_POINT_NOTE_TOO_LONG",
] as const;
export type PlanPointReason = (typeof PLAN_POINT_REASONS)[number];

/** What a reason's sentence needs filled in (`{max}`): the longest name, the most points, the longest note. Words of the code, never of a person. */
export function planPointRefusalValues(reason: string): Record<string, string> {
  if (reason === "PLAN_POINT_NAME_MISSING") return { max: String(CHECKPOINT_NAME_MAX) };
  if (reason === "PLAN_POINT_TOO_MANY") return { max: String(PLAN_POINTS_MAX) };
  if (reason === "PLAN_POINT_NOTE_TOO_LONG") return { max: String(PLAN_POINT_NOTE_MAX) };
  return {};
}

/**
 * A press of the plan's points refused for what was typed: a validation error that knows which sentence of the catalogue
 * says it (`reason`) and the box it is about, as a `CheckpointRefusal` does for the editor's card. The coordinates' own
 * refusal is `CoordinatesRefusal` (`event-checkpoints/domain/coordinates.ts`), of the same shape.
 */
export class PlanPointRefusal extends DomainError {
  constructor(
    readonly reason: PlanPointReason,
    fields: readonly string[],
  ) {
    super("VALIDATION_ERROR", reason, fields);
    this.name = "PlanPointRefusal";
  }

  /** The placeholders of the reason's sentence. */
  get values(): Record<string, string> {
    return planPointRefusalValues(this.reason);
  }
}

/**
 * The point a press names is not on this event's plan: another event's, a value that is no id, or one deleted since the page
 * was drawn — by a colleague, or by the first tap of a «Șterge punctul» pressed twice on a slow connection. NOT_FOUND, as
 * the domain says it; `reason` is the page's own sentence for it (`Admin.errors.PLAN_POINT_GONE`: the point is no longer
 * on the plan), never the backoffice's «Înregistrarea nu mai există», which names a registration.
 */
export class PlanPointGone extends DomainError {
  readonly reason = "PLAN_POINT_GONE" as const;
  constructor() {
    super("NOT_FOUND", "the point is not there");
    this.name = "PlanPointGone";
  }
}

/** What a form posts, before it is a change: this service validates, the action only reads boxes. */
export type PlanPointRequest =
  /** «Adaugă punctul»: a new point of the plan's own. */
  | { kind: "add"; eventId: string; place: unknown; name: unknown; km: unknown; coordinates: unknown }
  /**
   * «Salvează punctul»: all of a plan's own point, the kind included — or the coordinates alone of an editor's point —, and of
   * either its «Notă pentru voluntari» (§1009). A request that names neither of the note's boxes (`undefined`, a form drawn
   * before them) keeps the note as it is.
   */
  | { kind: "edit"; eventId: string; id: unknown; place: unknown; name: unknown; km: unknown; coordinates: unknown; volunteerNoteRo?: unknown; volunteerNoteEn?: unknown }
  /** «Șterge punctul»: a plan's own point; its people stand at no point again. */
  | { kind: "remove"; eventId: string; id: unknown };

export type PlanPointResult =
  /** The press changed nothing: nothing was written and nothing audited. */
  | { changed: false; id: string }
  | { changed: true; outcome: "added" | "edited"; id: string }
  /** `freed`: how many people — not cancelled — stood at the point and stand at none now. */
  | { changed: true; outcome: "removed"; id: string; freed: number };

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The words of a point as they are stored and audited: where it stands, its name, its kilometre (none at the start–finish), where it is. */
type PointWords = { place: PlanPointPlace; name: string; km: number | null; latitude: number | null; longitude: number | null };

/** What was posted for a plan's own point, held to the rules — or the first thing wrong with it, in the order of the form's boxes. */
function wordsOf(request: { place: unknown; name: unknown; km: unknown; coordinates: unknown }): PointWords {
  const place = PLAN_POINT_PLACES.find((known) => known === request.place);
  if (!place) throw new PlanPointRefusal("PLAN_POINT_PLACE_UNKNOWN", [PLAN_POINT_BOXES.place]);
  // One line, no run of spaces: a name is a word or two on a row.
  const name = text(request.name).replace(/\s+/g, " ").trim();
  if (name === "" || name.length > CHECKPOINT_NAME_MAX) throw new PlanPointRefusal("PLAN_POINT_NAME_MISSING", [PLAN_POINT_BOXES.name]);
  // A point on the route is at a kilometre, read as the editor reads one (a comma or a point, two decimals) — and held to no
  // route's length: the plan is the organizers' own, and no file is read for it. At the start–finish no kilometre is asked:
  // whatever the box posted is not read.
  const km = place === "route" ? readKm(text(request.km)) : null;
  if (place === "route" && km === null) throw new PlanPointRefusal("PLAN_POINT_KM_INVALID", [PLAN_POINT_BOXES.km]);
  const coordinates = parseCoordinates(text(request.coordinates), PLAN_POINT_BOXES.coordinates);
  return { place, name, km, latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null };
}

/** The columns a plan's own point is written with: the one name in both columns, 0 for a kilometre nobody reads. */
function columnsOf(words: PointWords) {
  return {
    nameRo: words.name,
    nameEn: words.name,
    km: (words.km ?? 0).toFixed(2),
    startFinish: words.place === "startFinish",
    latitude: words.latitude === null ? null : words.latitude.toFixed(6),
    longitude: words.longitude === null ? null : words.longitude.toFixed(6),
  };
}

const sameWords = (a: PointWords, b: PointWords): boolean => a.place === b.place && a.name === b.name && a.km === b.km && a.latitude === b.latitude && a.longitude === b.longitude;

/** «Notă pentru voluntari» as it is stored (§1009): both languages, or null in both. */
type VolunteerNote = { ro: string | null; en: string | null };

/** A note's words as they are stored: line breaks as `\n` — a browser posts a textarea's as `\r\n` —, the ends trimmed. */
const noteWords = (value: unknown): string => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "");

/**
 * What «Notă pentru voluntari» (§1009) was posted as, held to the rules: each language at most `PLAN_POINT_NOTE_MAX` characters —
 * counted as the table's check counts them (`char_length`: an emoji is one) — and both written or neither (§352: the house's rule
 * for every text the club types, `shared/forms/both-languages.ts`); both empty is no note. The first thing wrong, in the order of
 * the form's boxes, is refused naming its box: a language too long, then the language left empty.
 */
function volunteerNoteOf(request: { volunteerNoteRo?: unknown; volunteerNoteEn?: unknown }): VolunteerNote {
  const pair = { ro: noteWords(request.volunteerNoteRo), en: noteWords(request.volunteerNoteEn) };
  if ([...pair.ro].length > PLAN_POINT_NOTE_MAX) throw new PlanPointRefusal("PLAN_POINT_NOTE_TOO_LONG", [PLAN_POINT_BOXES.volunteerNoteRo]);
  if ([...pair.en].length > PLAN_POINT_NOTE_MAX) throw new PlanPointRefusal("PLAN_POINT_NOTE_TOO_LONG", [PLAN_POINT_BOXES.volunteerNoteEn]);
  const missing = missingLanguage(pair, isWrittenText);
  if (missing) throw new PlanPointRefusal("PLAN_POINT_NOTE_ONE_LANGUAGE", [missing === "ro" ? PLAN_POINT_BOXES.volunteerNoteRo : PLAN_POINT_BOXES.volunteerNoteEn]);
  return pair.ro === "" ? { ro: null, en: null } : pair;
}

/** Whether a request names the note at all: a form drawn before its boxes posts neither, and keeps the note it had. */
const namesTheNote = (request: { volunteerNoteRo?: unknown; volunteerNoteEn?: unknown }): boolean => request.volunteerNoteRo !== undefined || request.volunteerNoteEn !== undefined;

const sameNote = (a: VolunteerNote, b: VolunteerNote): boolean => a.ro === b.ro && a.en === b.en;

/**
 * What the trail says of a note that changed (§1009): only whether there was one before and is one after — never its words, which
 * may well name a person («Ana aduce steagurile»). Nothing for a note that did not change.
 */
const noteTrail = (before: VolunteerNote, after: VolunteerNote): Record<string, unknown> =>
  sameNote(before, after) ? {} : { volunteerNote: { from: before.ro !== null, to: after.ro !== null } };

/**
 * One change to the points of one event's volunteers' plan, by one staff member (§961).
 *
 * - **Who:** whoever works the volunteers (`canManageVolunteers`: the Organizer and the Administrators), asked here whatever
 *   the action asked (BR-REQ-060-01) and before anything is read; the Tehnic role, the Redactor, a desk Volunteer and a
 *   member are refused with nothing written.
 * - **`add`:** a new point of the plan's own. The place is `route` or `startFinish`, anything else refused; the name trimmed,
 *   its inner spaces folded, 1 to 60 characters; on the route the kilometre is required — a comma or a point, two decimals,
 *   0 to 9999.99, not held to the route's length — and at the start–finish it is not read and 0 is stored; the coordinates
 *   optional for both (`parseCoordinates`). At most `PLAN_POINTS_MAX` of the plan's own on an event, both kinds together,
 *   counted under the event row's lock.
 * - **`edit`:** of a plan's own point, all of it, the kind included: moved to the start–finish it loses its kilometre, moved
 *   to the route it needs one. Of an editor's point, ONLY the coordinates: a posted name, kilometre or place for it is never
 *   read and never written — those are changed in the event's editor, where they are public. A point of another event, or
 *   one that is not there, is NOT_FOUND (`PlanPointGone`, said on the page as a point no longer on the plan).
 * - **«Notă pentru voluntari» (§1009), on `edit` of either kind:** both languages or neither, each at most
 *   `PLAN_POINT_NOTE_MAX` characters, line breaks kept (`volunteerNoteOf`), read after the point's other boxes; both empty
 *   takes the note off. A request that names neither box keeps the note as it is.
 * - **`remove`:** a plan's own point only; an editor's is refused (it is deleted in the editor). The people who stood there
 *   stand at no point again — the reference's own `ON DELETE SET NULL` — and the result says how many.
 * - **How:** in one transaction under the event row's lock (`FOR NO KEY UPDATE`, as the presses of «Poze și hărți» (`plan.ts`) and «Pune
 *   aici» take it), so a point being deleted and a person being placed at it wait in a line, as do two presses that count
 *   the plan's points. A press that changes nothing writes nothing and audits nothing.
 * - **The trail:** one row a change — `volunteer_plan.point_added`, `.point_changed`, `.point_removed` — with the point's id,
 *   whether it is the plan's own, and its place, name, kilometre and coordinates before and after; a removal also says how
 *   many people it freed, and a change of the note whether there was one before and is one after (`volunteerNote`), never its
 *   words. A count, never a person.
 *
 * Nobody is emailed, no state or number of a person moves, and no public cache tag is expired: no public page reads these rows.
 */
export async function changePlanPoint<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, request: PlanPointRequest, now: Date): Promise<PlanPointResult> {
  if (!canManageVolunteers(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not change the points of the volunteers' plan`);
  // A forged form's malformed id is the refusal an unknown one gets, not a database error (§376).
  if (!isUuid(request.eventId)) throw new DomainError("NOT_FOUND", "the event is not there");
  const pointId = request.kind === "add" ? null : text(request.id).trim().toLowerCase();
  if (pointId !== null && !isUuid(pointId)) throw new PlanPointGone();
  // What an «Adaugă punctul» typed is held to the rules before anything is locked: it needs no row to be read.
  const added = request.kind === "add" ? wordsOf(request) : null;

  return db.transaction(async (tx): Promise<PlanPointResult> => {
    // NO KEY UPDATE: a sign-up's foreign-key check is not made to wait, and the editor's save (FOR UPDATE) still takes its turn.
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, request.eventId)).for("no key update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    const audit = (action: "volunteer_plan.point_added" | "volunteer_plan.point_changed" | "volunteer_plan.point_removed", metadata: Record<string, unknown>) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: event.id, metadata, now });

    if (added) {
      const [own] = await tx
        .select({ count: sql<number>`count(*)::int`, last: sql<number | null>`max(${eventCheckpoints.position})` })
        .from(eventCheckpoints)
        .where(and(eq(eventCheckpoints.eventId, event.id), eq(eventCheckpoints.planOnly, true)));
      if (own.count >= PLAN_POINTS_MAX) throw new PlanPointRefusal("PLAN_POINT_TOO_MANY", []);
      const [row] = await tx
        .insert(eventCheckpoints)
        .values({
          ...columnsOf(added),
          eventId: event.id,
          planOnly: true,
          // The order the plan's own points were added in: one more than the last, counted under the lock.
          position: own.last === null ? 0 : Number(own.last) + 1,
          // Nothing of the public table: no kinds, no limit, no note, and never on the route's chart.
          kinds: [],
          cutoffMinutes: null,
          noteRo: null,
          noteEn: null,
          onProfile: false,
          createdAt: now,
        })
        .returning({ id: eventCheckpoints.id });
      await audit("volunteer_plan.point_added", { pointId: row.id, planOnly: true, from: null, to: added });
      return { changed: true, outcome: "added", id: row.id };
    }

    // `pointId` is an id here: only «add» has none, and it has returned.
    const id = pointId as string;
    const [current] = await tx
      .select({
        id: eventCheckpoints.id,
        nameRo: eventCheckpoints.nameRo,
        km: eventCheckpoints.km,
        planOnly: eventCheckpoints.planOnly,
        startFinish: eventCheckpoints.startFinish,
        latitude: eventCheckpoints.latitude,
        longitude: eventCheckpoints.longitude,
        volunteerNoteRo: eventCheckpoints.volunteerNoteRo,
        volunteerNoteEn: eventCheckpoints.volunteerNoteEn,
      })
      .from(eventCheckpoints)
      .where(and(eq(eventCheckpoints.id, id), eq(eventCheckpoints.eventId, event.id)))
      .limit(1);
    // Another event's point, or one deleted since the page was drawn: not there.
    if (!current) throw new PlanPointGone();
    const before: PointWords = {
      place: current.startFinish ? "startFinish" : "route",
      name: current.nameRo,
      km: current.startFinish ? null : Number(current.km),
      latitude: current.latitude === null || current.longitude === null ? null : Number(current.latitude),
      longitude: current.latitude === null || current.longitude === null ? null : Number(current.longitude),
    };

    if (request.kind === "remove") {
      // An editor's point is a public point of the route: it is deleted in the editor, where the page and the race number follow.
      if (!current.planOnly) throw new PlanPointRefusal("PLAN_POINT_IN_EDITOR", []);
      // Who stands there on the plan — a cancelled person is on no plan (§949); the reference frees every row either way.
      const [{ freed }] = await tx
        .select({ freed: sql<number>`count(*)::int` })
        .from(eventVolunteers)
        .where(and(eq(eventVolunteers.checkpointId, current.id), ne(eventVolunteers.state, "CANCELLED")));
      await tx.delete(eventCheckpoints).where(and(eq(eventCheckpoints.id, current.id), eq(eventCheckpoints.eventId, event.id), eq(eventCheckpoints.planOnly, true)));
      await audit("volunteer_plan.point_removed", { pointId: current.id, planOnly: true, from: before, to: null, freed });
      return { changed: true, outcome: "removed", id: current.id, freed };
    }

    // «Notă pentru voluntari» (§1009), of either kind of point: as it is, and as the press would leave it — read after the
    // point's other boxes, so the first thing wrong is refused first; a request that names neither box keeps it.
    const noteBefore: VolunteerNote = { ro: current.volunteerNoteRo, en: current.volunteerNoteEn };
    const noteAfter = (): VolunteerNote => (request.kind === "edit" && namesTheNote(request) ? volunteerNoteOf(request) : noteBefore);
    const noteColumns = (note: VolunteerNote) => ({ volunteerNoteRo: note.ro, volunteerNoteEn: note.en });

    if (current.planOnly) {
      const after = wordsOf(request);
      const note = noteAfter();
      if (sameWords(before, after) && sameNote(noteBefore, note)) return { changed: false, id: current.id };
      await tx
        .update(eventCheckpoints)
        .set({ ...columnsOf(after), ...noteColumns(note) })
        .where(and(eq(eventCheckpoints.id, current.id), eq(eventCheckpoints.eventId, event.id), eq(eventCheckpoints.planOnly, true)));
      await audit("volunteer_plan.point_changed", { pointId: current.id, planOnly: true, from: before, to: after, ...noteTrail(noteBefore, note) });
      return { changed: true, outcome: "edited", id: current.id };
    }

    // An editor's point: where it is and its note for the volunteers, and nothing else — its name, kilometre and place are the
    // editor's, and are not read here.
    const coordinates = parseCoordinates(text(request.coordinates), PLAN_POINT_BOXES.coordinates);
    const after: PointWords = { ...before, latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null };
    const note = noteAfter();
    if (sameWords(before, after) && sameNote(noteBefore, note)) return { changed: false, id: current.id };
    await tx
      .update(eventCheckpoints)
      .set({ latitude: after.latitude === null ? null : after.latitude.toFixed(6), longitude: after.longitude === null ? null : after.longitude.toFixed(6), ...noteColumns(note) })
      .where(and(eq(eventCheckpoints.id, current.id), eq(eventCheckpoints.eventId, event.id)));
    await audit("volunteer_plan.point_changed", { pointId: current.id, planOnly: false, from: before, to: after, ...noteTrail(noteBefore, note) });
    return { changed: true, outcome: "edited", id: current.id };
  });
}
