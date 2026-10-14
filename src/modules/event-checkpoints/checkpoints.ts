import { and, asc, eq } from "drizzle-orm";
import { eventCheckpoints, type EventCheckpointRow } from "@/db/schema/event-checkpoints";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { readRouteGpx } from "@/modules/events/domain/route-gpx";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import {
  canEditCheckpoints,
  type Checkpoint,
  type CheckpointContext,
  type CheckpointInput,
  checkpointContext,
  CheckpointRefusal,
  type PostedCheckpoint,
  prepareCheckpoints,
  sortedByKm,
} from "./domain/checkpoint";
import { offerableProposals } from "./domain/gpx-waypoints";
import { checkpointClock, checkpointStart } from "./domain/start";
import { splitDuration } from "@/modules/content/events/duration";
import { loadGpxWaypoints } from "./gpx-file";

/**
 * An event's checkpoints (§757): read by the editor's «Puncte de control» card, the event page's table
 * and the bib's profile strip; written by the card's two forms. The role is asserted here and not only
 * by the hidden buttons (BR-REQ-060-01); every change that changes something writes one audit row
 * naming who did it and the list before and after (`AGENTS.md` §12.12 allows what somebody typed about
 * the club's own work, and nothing here is about a participant).
 *
 * **A save never deletes what it was not told to.** The form lists the points the page was drawn
 * with; a colleague who added one in the meantime is not on it, and it must survive this save — so
 * the only rows removed are the ones the form marks «Scoate», the rest are updated or added, and
 * the rules (the cut-offs against each other, the count) are checked over the whole list that will
 * be there, not over the part of it this form knew.
 *
 * **Nothing is fetched under the event's lock** (§403): the GPX is read from the store before the
 * transaction opens, and the transaction refuses (CONFLICT) when the route's file or typed distance
 * moved in between — every registration for the event waits on that same row lock.
 */

const toCheckpoint = (row: EventCheckpointRow, clockOf: (minutes: number | null) => string | null): Checkpoint => ({
  id: row.id,
  nameRo: row.nameRo,
  nameEn: row.nameEn,
  km: Number(row.km),
  kinds: row.kinds,
  cutoffMinutes: row.cutoffMinutes,
  cutoffClock: clockOf(row.cutoffMinutes),
  noteRo: row.noteRo,
  noteEn: row.noteEn,
});

/**
 * An event's checkpoints by distance, ties in the order the club saw — each with the clock its time
 * limit closes at, derived from the start the event has now (§NNN): one more column of the one query,
 * so the bib, the export and the card say the same clock the page does, and a moved start moves it.
 */
export async function listCheckpoints<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<Checkpoint[]> {
  const rows = await db
    .select({ row: eventCheckpoints, startsAt: events.startsAt, raceStartsAt: events.raceStartsAt, timezone: events.timezone })
    .from(eventCheckpoints)
    .innerJoin(events, eq(events.id, eventCheckpoints.eventId))
    .where(eq(eventCheckpoints.eventId, eventId))
    .orderBy(asc(eventCheckpoints.km), asc(eventCheckpoints.position), asc(eventCheckpoints.createdAt), asc(eventCheckpoints.id));
  return rows.map(({ row, startsAt, raceStartsAt, timezone }) => toCheckpoint(row, checkpointClock({ startsAt, raceStartsAt, timezone })));
}

/** What the rules measure a checkpoint against: the event's own columns. */
export type CheckpointEvent = {
  distanceMeters: number | null;
  startsAt: Date;
  raceStartsAt: Date | null;
  endsAt: Date | null;
  timezone: string;
};

/** Whether the club typed a distance: then the GPX's own length is never needed. */
export const hasTypedDistance = (event: Pick<CheckpointEvent, "distanceMeters">): boolean => event.distanceMeters !== null && event.distanceMeters > 0;

/**
 * The event's start-and-length facts as the rules want them, with the GPX's length in metres when the
 * caller read it (`routeGpxMeters`, before any transaction) — used only when no distance was typed.
 */
export function eventCheckpointContext(event: CheckpointEvent, gpxMeters: number | null, saved: readonly Pick<Checkpoint, "id" | "cutoffMinutes">[] = []): CheckpointContext {
  const typed = hasTypedDistance(event) ? event.distanceMeters : null;
  return checkpointContext({
    distanceMeters: typed,
    gpxMeters: typed ? null : gpxMeters,
    start: checkpointStart(event),
    endsAt: event.endsAt,
    savedMinutes: new Map(saved.map((row) => [row.id, row.cutoffMinutes])),
  });
}

/**
 * The length of the route's GPX in metres, read from the store — **never inside a transaction**
 * (§403) — and only when the event has no typed distance; null when there is no file or it cannot be read.
 */
export async function routeGpxMeters(event: Pick<CheckpointEvent, "distanceMeters"> & { routeGpx: unknown }): Promise<number | null> {
  if (hasTypedDistance(event)) return null;
  return (await loadGpxWaypoints(readRouteGpx(event.routeGpx)?.key))?.trackMeters ?? null;
}

/** One proposal picked in the GPX's preview, with the names the club gave it there in both languages. */
export type PickedProposal = { at: number; nameRo: string; nameEn: string };

/** What a form posts, before it is an operation: this service validates, the action only reads fields. */
export type CheckpointRequest =
  | { kind: "save"; eventId: string; rows: readonly PostedCheckpoint[] }
  /** «Adaugă punctele alese» on the GPX's preview: the file the preview was made from, and which of its proposals to add, named. */
  | { kind: "addFromGpx"; eventId: string; gpxKey: string; picked: readonly PickedProposal[] };

export type CheckpointResult = { changed: boolean; added: number; edited: number; removed: number };

/** A saved row as the form would post it, numbered past every box a form draws (so a refusal names no box of the form). */
const toPosted = (row: Checkpoint, index: number): PostedCheckpoint => {
  const limit = splitDuration(row.cutoffMinutes);
  return {
    id: row.id,
    nameRo: row.nameRo,
    nameEn: row.nameEn,
    km: String(row.km),
    kinds: row.kinds,
    cutoffHours: limit.hours,
    cutoffMinutes: limit.minutes,
    noteRo: row.noteRo ?? "",
    noteEn: row.noteEn ?? "",
    remove: false,
    index,
  };
};

/** One line of the audit trail: where, what and by when (the time limit in minutes) — never a participant. */
const summary = (rows: readonly Pick<Checkpoint, "km" | "nameRo" | "cutoffMinutes">[]) => rows.map((row) => ({ km: row.km, name: row.nameRo, cutoffMinutes: row.cutoffMinutes }));

/** Whether two rows say the same thing, whatever their id and place in the list. */
function sameWords(a: Omit<CheckpointInput, "id">, b: Pick<Checkpoint, "nameRo" | "nameEn" | "km" | "cutoffMinutes" | "noteRo" | "noteEn" | "kinds">): boolean {
  return (
    a.nameRo === b.nameRo &&
    a.nameEn === b.nameEn &&
    a.km === b.km &&
    a.cutoffMinutes === b.cutoffMinutes &&
    a.noteRo === b.noteRo &&
    a.noteEn === b.noteEn &&
    a.kinds.join() === b.kinds.join()
  );
}

/**
 * The event's saved list no longer holds against the event as a save leaves it (§757): a moved start
 * or gun, a shorter «Timp limită», a shorter route. The event save is refused naming «Puncte de
 * control» and the rule's own sentence (`refusal`), so the page and the bib never publish a cut-off
 * before the start or after the finish, nor a point past the route. `date` names another date of a
 * series the save reached.
 */
export class SavedCheckpointsRefusal extends DomainError {
  constructor(
    readonly refusal: CheckpointRefusal,
    readonly date: string | null,
  ) {
    super("VALIDATION_ERROR", `checkpoints: the event's saved checkpoints would break ${refusal.reason}`, ["checkpoints"]);
    this.name = "SavedCheckpointsRefusal";
  }
}

/**
 * The event's saved checkpoints held to the card's rules against `event` — the row as a save or an
 * import leaves it, read inside that save's transaction — or a `SavedCheckpointsRefusal`. Reads the
 * list only; the GPX's length is the caller's, read before the transaction (`routeGpxMeters`).
 */
export async function assertSavedCheckpointsHold<T extends Record<string, unknown>>(
  db: Database<T>,
  event: CheckpointEvent & { id: string },
  gpxMeters: number | null,
  date: string | null = null,
): Promise<void> {
  const saved = await listCheckpoints(db, event.id);
  if (saved.length === 0) return;
  try {
    prepareCheckpoints(
      saved.map((row, at) => toPosted(row, 1000 + at)),
      // A saved limit keeps holding while the start's hour is unsaid: only its length against the event's is asked.
      { ...eventCheckpointContext(event, gpxMeters, saved), startKnown: true },
    );
  } catch (error) {
    if (error instanceof CheckpointRefusal) throw new SavedCheckpointsRefusal(error, date);
    throw error;
  }
}

/**
 * Every checkpoint of one event copied onto another (§757) — «Duplică» and a series' new dates: the
 * cut-offs are times of the day, so they follow the new date. Run in the caller's transaction; no
 * audit row of its own, the copy's own row («event.duplicated», a series' date) says it.
 */
export async function copyCheckpoints<T extends Record<string, unknown>>(db: Database<T>, fromEventId: string, toEventId: string, now: Date): Promise<number> {
  const rows = await listCheckpoints(db, fromEventId);
  for (const [position, row] of rows.entries()) {
    await db.insert(eventCheckpoints).values({
      eventId: toEventId,
      position,
      nameRo: row.nameRo,
      nameEn: row.nameEn,
      km: row.km.toFixed(2),
      kinds: [...row.kinds],
      cutoffMinutes: row.cutoffMinutes,
      noteRo: row.noteRo,
      noteEn: row.noteEn,
      createdAt: now,
    });
  }
  return rows.length;
}

/**
 * An event's whole list replaced by `rows` — already held to the rules (`prepareCheckpoints`) by the
 * caller — for the event's JSON file (§751, §757): an import as a new event writes the file's list, an
 * import over an event writes it where the diff showed the list as changed. The role is asserted here
 * too; one audit row names the list before and after, `source: "import"`. Nothing written, nothing
 * recorded, when the list is already the same.
 */
export async function replaceCheckpoints<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  eventId: string,
  rows: readonly Omit<CheckpointInput, "id">[],
  now: Date,
): Promise<{ changed: boolean }> {
  if (!canEditCheckpoints(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may read an event's checkpoints but not change them`);
  }
  return db.transaction(async (tx) => {
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).for("update");
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    const current = await listCheckpoints(tx, event.id);
    const wanted = sortedByKm(rows);
    if (current.length === wanted.length && wanted.every((row, at) => sameWords(row, current[at]))) return { changed: false };
    await tx.delete(eventCheckpoints).where(eq(eventCheckpoints.eventId, event.id));
    for (const [position, row] of wanted.entries()) {
      await tx.insert(eventCheckpoints).values({
        eventId: event.id,
        position,
        nameRo: row.nameRo,
        nameEn: row.nameEn,
        km: row.km.toFixed(2),
        kinds: [...row.kinds],
        cutoffMinutes: row.cutoffMinutes,
        noteRo: row.noteRo,
        noteEn: row.noteEn,
        createdAt: now,
      });
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event_checkpoints.changed" satisfies AuditAction,
      entityType: "event",
      entityId: event.id,
      metadata: { added: wanted.length, edited: 0, removed: current.length, from: summary(sortedByKm(current)), to: summary(wanted), source: "import" },
      now,
    });
    return { changed: true };
  });
}

/**
 * One change to one event's checkpoints, by one staff member. Refuses a role that may only read the
 * list (FORBIDDEN), a row typed wrong (a `CheckpointRefusal`, a VALIDATION_ERROR naming the box and
 * carrying the sentence's own code), an event that is not there (NOT_FOUND) and a GPX that is not the
 * one the preview was made from — or a route that changed while the file was read (CONFLICT). A press
 * that changes nothing writes nothing and records nothing: the trail records changes, not presses.
 */
export async function changeCheckpoints<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  request: CheckpointRequest,
  now: Date,
): Promise<CheckpointResult> {
  if (!canEditCheckpoints(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may read an event's checkpoints but not change them`);
  }
  // A forged form's malformed id is the refusal an unknown one gets, not a database error.
  if (!isUuid(request.eventId)) throw new DomainError("NOT_FOUND", "the event is not there");

  // The route as it is now, and its GPX read from the store — before any lock is taken (§403).
  const [seen] = await db.select({ distanceMeters: events.distanceMeters, routeGpx: events.routeGpx }).from(events).where(eq(events.id, request.eventId));
  if (!seen) throw new DomainError("NOT_FOUND", "the event is not there");
  const seenKey = readRouteGpx(seen.routeGpx)?.key ?? null;
  if (request.kind === "addFromGpx" && (!seenKey || seenKey !== request.gpxKey)) {
    throw new DomainError("CONFLICT", "the route's GPX changed since the preview was made");
  }
  const waypoints = request.kind === "addFromGpx" || !hasTypedDistance(seen) ? await loadGpxWaypoints(seenKey) : null;

  return db.transaction(async (tx) => {
    // The event row is locked for the change: two saves on one event take turns, each seeing the other's list.
    const [event] = await tx
      .select({
        id: events.id,
        distanceMeters: events.distanceMeters,
        routeGpx: events.routeGpx,
        startsAt: events.startsAt,
        raceStartsAt: events.raceStartsAt,
        endsAt: events.endsAt,
        timezone: events.timezone,
      })
      .from(events)
      .where(eq(events.id, request.eventId))
      .for("update");
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    // The file read above is the one the event still names, and the length it was read for still applies.
    if ((readRouteGpx(event.routeGpx)?.key ?? null) !== seenKey || event.distanceMeters !== seen.distanceMeters) {
      throw new DomainError("CONFLICT", "the route changed while this save was being prepared");
    }
    const current = await listCheckpoints(tx, event.id);
    const context = eventCheckpointContext(event, waypoints?.trackMeters ?? null, current);
    const known = new Set(current.map((row) => row.id));

    // The list that will be there: what the form posted, and every saved point it did not name.
    let wanted: PostedCheckpoint[];
    if (request.kind === "save") {
      /*
        A posted id that is not among this event's rows any more — a colleague removed the point while
        this form was open, or the id is another event's — is dropped, never written as a new point:
        a stale form must not bring back what somebody took off the page and the bib.
      */
      const posted = request.rows.filter((row) => row.id === "" || known.has(row.id));
      const named = new Set(posted.map((row) => row.id).filter((id) => id !== ""));
      wanted = [...posted, ...current.filter((row) => !named.has(row.id)).map((row, at) => toPosted(row, 1000 + at))];
    } else {
      const proposals = offerableProposals(waypoints?.proposals ?? [], context.routeKm).offered;
      const seenAt = new Set<number>();
      const picked = request.picked.filter((pick) => {
        const fresh = Number.isInteger(pick.at) && pick.at >= 0 && pick.at < proposals.length && !seenAt.has(pick.at);
        seenAt.add(pick.at);
        return fresh;
      });
      if (picked.length === 0) return { changed: false, added: 0, edited: 0, removed: 0 };
      const added: PostedCheckpoint[] = picked
        .map((pick) => ({ pick, proposal: proposals[pick.at] }))
        // A waypoint already on the list — the same words at the same kilometre — is not added twice.
        .filter(({ proposal }) => !current.some((row) => row.km === proposal.km && (row.nameRo === proposal.name || row.nameEn === proposal.name)))
        // The names the club gave in the preview, one box per language: never the file's one name copied into both (§757).
        .map(({ pick, proposal }) => ({
          id: "",
          nameRo: pick.nameRo,
          nameEn: pick.nameEn,
          km: String(proposal.km),
          kinds: proposal.kinds,
          cutoffHours: "",
          cutoffMinutes: "",
          noteRo: "",
          noteEn: "",
          remove: false,
          index: pick.at,
        }));
      if (added.length === 0) return { changed: false, added: 0, edited: 0, removed: 0 };
      wanted = [...current.map((row, at) => toPosted(row, 1000 + at)), ...added];
    }

    const prepared = prepareCheckpoints(wanted, context);

    const keptIds = new Set(prepared.map((row) => row.id).filter((id): id is string => id !== null && known.has(id)));
    const toDelete = current.filter((row) => !keptIds.has(row.id));
    let added = 0;
    let edited = 0;
    for (const [position, row] of prepared.entries()) {
      const existing = row.id !== null && known.has(row.id) ? current.find((saved) => saved.id === row.id) : undefined;
      const values = {
        nameRo: row.nameRo,
        nameEn: row.nameEn,
        km: row.km.toFixed(2),
        kinds: [...row.kinds],
        cutoffMinutes: row.cutoffMinutes,
        noteRo: row.noteRo,
        noteEn: row.noteEn,
        position,
      };
      if (!existing) {
        await tx.insert(eventCheckpoints).values({ ...values, eventId: event.id, createdAt: now });
        added += 1;
        continue;
      }
      const words = !sameWords(row, existing);
      // The place in the list is renumbered silently: a point moved only by its neighbours' distances is no change of its own.
      await tx.update(eventCheckpoints).set(values).where(and(eq(eventCheckpoints.id, existing.id), eq(eventCheckpoints.eventId, event.id)));
      if (words) edited += 1;
    }
    for (const row of toDelete) await tx.delete(eventCheckpoints).where(and(eq(eventCheckpoints.id, row.id), eq(eventCheckpoints.eventId, event.id)));

    const removed = toDelete.length;
    const changed = added + edited + removed > 0;
    if (changed) {
      const after = await listCheckpoints(tx, event.id);
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        action: "event_checkpoints.changed" satisfies AuditAction,
        entityType: "event",
        entityId: event.id,
        metadata: { added, edited, removed, from: summary(sortedByKm(current)), to: summary(after), source: request.kind === "addFromGpx" ? "gpx" : "form" },
        now,
      });
    }
    return { changed, added, edited, removed };
  });
}
