import { and, asc, eq } from "drizzle-orm";
import { eventCheckpoints, type EventCheckpointRow } from "@/db/schema/event-checkpoints";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { readRouteGpx } from "@/modules/events/domain/route-gpx";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import {
  canEditCheckpoints,
  type Checkpoint,
  type CheckpointContext,
  type CheckpointInput,
  checkpointContext,
  clockMinutes,
  type PostedCheckpoint,
  prepareCheckpoints,
  readClockTime,
  sortedByKm,
} from "./domain/checkpoint";
import { type GpxProposal } from "./domain/gpx-waypoints";
import { checkpointStart } from "./domain/start";
import { loadGpxWaypoints } from "./gpx-file";

/**
 * An event's checkpoints (§NNN): read by the editor's «Puncte de control» card, the event page's table
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
 */

const toCheckpoint = (row: EventCheckpointRow): Checkpoint => ({
  id: row.id,
  nameRo: row.nameRo,
  nameEn: row.nameEn,
  km: Number(row.km),
  kinds: row.kinds,
  cutoff: row.cutoffTime ? readClockTime(row.cutoffTime) : null,
  noteRo: row.noteRo,
  noteEn: row.noteEn,
});

/** An event's checkpoints by distance, ties in the order the club saw. */
export async function listCheckpoints<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<Checkpoint[]> {
  const rows = await db
    .select()
    .from(eventCheckpoints)
    .where(eq(eventCheckpoints.eventId, eventId))
    .orderBy(asc(eventCheckpoints.km), asc(eventCheckpoints.position), asc(eventCheckpoints.createdAt), asc(eventCheckpoints.id));
  return rows.map(toCheckpoint);
}

/** What the rules measure a checkpoint against: the event's own columns. */
export type CheckpointEvent = {
  distanceMeters: number | null;
  routeGpx: unknown;
  startsAt: Date;
  raceStartsAt: Date | null;
  endsAt: Date | null;
  timezone: string;
};

/** The event's start-and-length facts as the rules want them; the GPX is read only when no distance was typed. */
export async function eventCheckpointContext(event: CheckpointEvent): Promise<CheckpointContext> {
  const typed = event.distanceMeters && event.distanceMeters > 0 ? event.distanceMeters : null;
  const gpxMeters = typed ? null : ((await loadGpxWaypoints(readRouteGpx(event.routeGpx)?.key))?.trackMeters ?? null);
  return checkpointContext({
    distanceMeters: typed,
    gpxMeters,
    start: checkpointStart(event),
    endsAt: event.endsAt,
    wallMinutesOf: (instant) => clockMinutes(toWallTimeInput(instant, event.timezone).slice(11, 16)),
  });
}

/** What a form posts, before it is an operation: this service validates, the action only reads fields. */
export type CheckpointRequest =
  | { kind: "save"; eventId: string; rows: readonly PostedCheckpoint[] }
  /** «Adaugă punctele alese» on the GPX's preview: the file the preview was made from, and which of its proposals to add. */
  | { kind: "addFromGpx"; eventId: string; gpxKey: string; picked: readonly number[] };

export type CheckpointResult = { changed: boolean; added: number; edited: number; removed: number };

const toPosted = (row: Checkpoint, index: number): PostedCheckpoint => ({
  id: row.id,
  nameRo: row.nameRo,
  nameEn: row.nameEn,
  km: String(row.km),
  kinds: row.kinds,
  cutoff: row.cutoff ?? "",
  noteRo: row.noteRo ?? "",
  noteEn: row.noteEn ?? "",
  remove: false,
  index,
});

/** One line of the audit trail: where, what and by when — never a participant. */
const summary = (rows: readonly Pick<Checkpoint, "km" | "nameRo" | "cutoff">[]) => rows.map((row) => ({ km: row.km, name: row.nameRo, cutoff: row.cutoff }));

/** Whether two rows say the same thing, whatever their id and place in the list. */
function sameWords(a: Omit<CheckpointInput, "id">, b: Omit<Checkpoint, "id">): boolean {
  return (
    a.nameRo === b.nameRo &&
    a.nameEn === b.nameEn &&
    a.km === b.km &&
    a.cutoff === b.cutoff &&
    a.noteRo === b.noteRo &&
    a.noteEn === b.noteEn &&
    a.kinds.join() === b.kinds.join()
  );
}

/** The proposals the editor may offer: placed within reach of the track, in the order along it. */
export const offerable = (proposals: readonly GpxProposal[]): GpxProposal[] => proposals.filter((proposal) => !proposal.tooFar);

/**
 * An event's whole list replaced by `rows` — already held to the rules (`prepareCheckpoints`) by the
 * caller — for the event's JSON file (§751, §NNN): an import as a new event writes the file's list, an
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
        cutoffTime: row.cutoff,
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
 * one the preview was made from (CONFLICT). A press that changes nothing writes nothing and records
 * nothing: the trail records changes, not presses.
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

    const current = await listCheckpoints(tx, event.id);
    const known = new Set(current.map((row) => row.id));

    // The list that will be there: what the form posted, and every saved point it did not name.
    let wanted: PostedCheckpoint[];
    if (request.kind === "save") {
      const named = new Set(request.rows.map((row) => row.id).filter((id) => id !== ""));
      wanted = [...request.rows, ...current.filter((row) => !named.has(row.id)).map((row, at) => toPosted(row, 1000 + at))];
    } else {
      const key = readRouteGpx(event.routeGpx)?.key ?? null;
      if (!key || key !== request.gpxKey) throw new DomainError("CONFLICT", "the route's GPX changed since the preview was made");
      const proposals = offerable((await loadGpxWaypoints(key))?.proposals ?? []);
      const picked = [...new Set(request.picked)].filter((at) => Number.isInteger(at) && at >= 0 && at < proposals.length);
      if (picked.length === 0) return { changed: false, added: 0, edited: 0, removed: 0 };
      const added: PostedCheckpoint[] = picked
        .map((at) => proposals[at])
        // A waypoint already on the list — the same words at the same kilometre — is not added twice.
        .filter((proposal) => !current.some((row) => row.km === proposal.km && (row.nameRo === proposal.name || row.nameEn === proposal.name)))
        .map((proposal, at) => ({
          id: "",
          nameRo: proposal.name,
          nameEn: proposal.name,
          km: String(proposal.km),
          kinds: proposal.kinds,
          cutoff: "",
          noteRo: "",
          noteEn: "",
          remove: false,
          index: 2000 + at,
        }));
      if (added.length === 0) return { changed: false, added: 0, edited: 0, removed: 0 };
      wanted = [...current.map(toPosted), ...added];
    }

    const context = await eventCheckpointContext(event);
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
        cutoffTime: row.cutoff,
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
