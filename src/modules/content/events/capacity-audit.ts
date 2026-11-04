import type { Database, Transaction } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";

/**
 * «Istoric capacitate»'s writes (§914; the owner, 2026-11-04: he wants to see when and why the number of places
 * changed). Every save that moves an event's capacity or its «Locuri păstrate pentru club» leaves one audit row per
 * value that moved, in the save's own transaction — the editor, a series save on each date it reaches, an import,
 * a create, a duplicate, the dates a series makes by itself. The supplementary places an offer, «Dă-i un loc acum» or
 * an invitation adds keep their own rows (`registrations/service.ts#addOneSupplementaryPlace`), in the same shape.
 *
 * The rows are compared from the row before and the row after the save, never from what the form posted: a switch of
 * the registration mode or the type that nulls the capacity is a change too, and is recorded rather than refused.
 * Nothing about a person: numbers, the save that did it, and the reason typed under the places.
 */

/** Which save moved the places: the history says it beside the numbers. */
export type PlacesVia = "editor" | "series" | "import" | "create" | "duplicate" | "series_generated";

/** The reason typed under the places, as stored: trimmed, at most this long, never empty. */
export const PLACES_REASON_MAX = 200;

/** The reason as stored (§914): trimmed and cut to `PLACES_REASON_MAX`, or null when nothing was typed. */
export function placesChangeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed === "" ? null : trimmed.slice(0, PLACES_REASON_MAX);
}

/** The places of a row, as the comparison reads them. */
type Places = { capacity: number | null; placesKeptForClub: number };

/** Whether a save moves the capacity or the places kept for the club. */
export function placesMoved(before: Places | null, after: Places): boolean {
  return (before?.capacity ?? null) !== after.capacity || (before?.placesKeptForClub ?? 0) !== after.placesKeptForClub;
}

/**
 * The rows themselves (§914): `event.capacity_changed` when the capacity moved —
 * `{from, to, occupied, offered, via, reason?, version}` — and `event.places_kept_changed` when the places kept for
 * the club did — `{from, to, via, reason?, version}`. `before` is null for an event the save created (from null, and
 * from 0 kept). `occupied` is the count the save took under the event lock (0 for a new event); `offered`, the
 * offers its raise made to the waiting list. `version` is the row's after the save. The actor is the staff member, or
 * null for the dates a series makes by itself.
 */
export async function auditPlacesChange<T extends Record<string, unknown>>(
  tx: Database<T> | Transaction<T>,
  input: {
    actorStaffUserId: string | null;
    before: Places | null;
    after: Places & { id: string; version: number };
    via: PlacesVia;
    occupied: number;
    offered: number;
    reason?: string | null;
    now: Date;
  },
): Promise<void> {
  const reason = placesChangeReason(input.reason);
  const said = reason ? { reason } : {};
  const fromCapacity = input.before?.capacity ?? null;
  if (fromCapacity !== input.after.capacity) {
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actorStaffUserId,
      action: "event.capacity_changed",
      entityType: "event",
      entityId: input.after.id,
      metadata: {
        from: fromCapacity,
        to: input.after.capacity,
        occupied: input.occupied,
        offered: input.offered,
        via: input.via,
        ...said,
        version: input.after.version,
      },
      now: input.now,
    });
  }
  const fromKept = input.before?.placesKeptForClub ?? 0;
  if (fromKept !== input.after.placesKeptForClub) {
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actorStaffUserId,
      action: "event.places_kept_changed",
      entityType: "event",
      entityId: input.after.id,
      metadata: { from: fromKept, to: input.after.placesKeptForClub, via: input.via, ...said, version: input.after.version },
      now: input.now,
    });
  }
}
