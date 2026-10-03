import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events } from "@/db/schema/events";
import { jobRuns } from "@/db/schema/job-runs";
import { registrations } from "@/db/schema/registrations";
import { type UnreachableWindow, unreachableWindows } from "@/db/schema/unreachable-windows";
import type { Database } from "@/db/types";
import { type NameReadingSlot, readNameReading } from "./schedule-cache";

/**
 * The windows the platform could not be reached, as `/devs`, «Sarcini» and the deep health read them
 * (§NNN): newest first, the open one among them, never a `dns` suspicion (one probe so far is no
 * window). A read of a handful of rows by their index; the writes are the maintenance job's alone
 * (`registrations/outage-grace.ts`).
 */
export async function readUnreachableWindows<T extends Record<string, unknown>>(db: Database<T>, limit = 5): Promise<UnreachableWindow[]> {
  return db
    .select()
    .from(unreachableWindows)
    .where(isNotNull(unreachableWindows.confirmedAt))
    .orderBy(desc(unreachableWindows.startedAt))
    .limit(limit);
}

/**
 * How many claims the newest closed window did not revive still wait for an Administrator (§NNN):
 * on a scheduled event that has not started, a registration that has no place since — lapsed,
 * back on the waiting list, or a family's address still unconfirmed with no reservation running — or
 * an invitation neither accepted nor withdrawn, and not followed by a newer one to the same address.
 * A family's held place is nobody's registration: there is nobody to seat, and it is not counted.
 * Ids only are read; «Sarcini» shows a count.
 */
export async function countNotRevivedWaiting<T extends Record<string, unknown>>(
  db: Database<T>,
  windows: readonly UnreachableWindow[],
  now: Date,
): Promise<number> {
  const newest = windows
    .filter((window) => window.endedAt !== null)
    .reduce<UnreachableWindow | null>((latest, window) => (!latest || (window.endedAt as Date) > (latest.endedAt as Date) ? window : latest), null);
  if (!newest || newest.notRevived.length === 0) return 0;
  const ahead = and(eq(events.eventStatus, "SCHEDULED"), gt(events.startsAt, now));
  const registrationIds = [...new Set(newest.notRevived.filter((claim) => claim.kind !== "invitation" && claim.kind !== "placeHold").map((claim) => claim.id))];
  const invitationIds = newest.notRevived.filter((claim) => claim.kind === "invitation").map((claim) => claim.id);
  let waiting = 0;
  if (registrationIds.length > 0) {
    const rows = await db
      .select({ id: registrations.id })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(
        and(
          inArray(registrations.id, registrationIds),
          ahead,
          or(
            inArray(registrations.status, ["EXPIRED", "WAITLISTED"]),
            and(
              eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"),
              or(isNull(registrations.holdExpiresAt), lte(registrations.holdExpiresAt, now)),
            ),
          ),
        ),
      );
    waiting += rows.length;
  }
  if (invitationIds.length > 0) {
    const rows = await db
      .select({ id: eventInvitations.id })
      .from(eventInvitations)
      .innerJoin(events, eq(events.id, eventInvitations.eventId))
      .where(
        and(
          inArray(eventInvitations.id, invitationIds),
          ahead,
          isNull(eventInvitations.acceptedAt),
          isNull(eventInvitations.withdrawnAt),
          lte(eventInvitations.expiresAt, now),
          sql`not exists (select 1 from ${eventInvitations} as later where later.event_id = ${eventInvitations.eventId} and later.canonical_email = ${eventInvitations.canonicalEmail} and later.created_at > ${eventInvitations.createdAt})`,
        ),
      );
    waiting += rows.length;
  }
  return waiting;
}

/**
 * What the site's name answered at the maintenance job's last real run (§NNN), as the run kept it
 * beside its ping: `/devs` shows it and never asks the name itself — the probe runs in the job and the
 * deep health only. Null when there was no run, or the cache no longer remembers it.
 */
export async function readLastNameReading<T extends Record<string, unknown>>(db: Database<T>): Promise<NameReadingSlot | null> {
  const [last] = await db
    .select({ startedAt: jobRuns.startedAt })
    .from(jobRuns)
    .where(eq(jobRuns.jobName, "registration-maintenance"))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1);
  return last ? readNameReading(last.startedAt) : null;
}
