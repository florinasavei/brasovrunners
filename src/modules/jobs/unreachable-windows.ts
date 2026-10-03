import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, not, or, type SQL, sql } from "drizzle-orm";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events } from "@/db/schema/events";
import { jobRuns } from "@/db/schema/job-runs";
import { registrations } from "@/db/schema/registrations";
import { type NotRevivedClaim, type UnreachableWindow, unreachableWindows } from "@/db/schema/unreachable-windows";
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
 * How many claims the newest closed window did not revive still wait for an Administrator (§NNN) —
 * only until the facts show them handled, so the row never stays red with nothing to press. On a
 * scheduled event that has not started:
 *
 * - a lapsed offer, declaration hold or address link waits while its registration is still lapsed
 *   (`EXPIRED`, or an offer put back and not swept yet) and the same person — the participant and the
 *   name — has no newer registration on the event: they register again (or the staff adds one), and
 *   from there «Trimite-i oferta» is the Administrator's verb;
 * - a cleared family reservation waits while the address is unconfirmed with no reservation running
 *   («Dă-i un loc acum»), confirmed but waiting for a place («Trimite-i oferta»), or lapsed with no
 *   newer registration; a place again, or the address confirmed and placed, is handled;
 * - an expired invitation waits while it is neither accepted nor withdrawn, was not sent again after the
 *   window, and no newer one went to the same address.
 *
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
  const idsOf = (kinds: readonly NotRevivedClaim["kind"][]) => [...new Set(newest.notRevived.filter((claim) => kinds.includes(claim.kind)).map((claim) => claim.id))];
  const lapsedIds = idsOf(["offer", "declarationHold", "emailLink"]);
  const familyIds = idsOf(["familyReservation"]);
  const invitationIds = idsOf(["invitation"]);
  // The same person registered again on the event: the address and the name, a row submitted after this one.
  const registeredAgain = sql`exists (select 1 from ${registrations} as later where later.event_id = ${registrations.eventId} and later.participant_id = ${registrations.participantId} and lower(later.registered_name) = lower(${registrations.registeredName}) and later.id <> ${registrations.id} and later.submitted_at > ${registrations.submittedAt})`;
  const stillLapsed = or(eq(registrations.status, "EXPIRED"), and(eq(registrations.status, "WAITLIST_OFFERED"), lte(registrations.holdExpiresAt, now)));
  let waiting = 0;
  const countRegistrations = async (ids: string[], state: SQL | undefined) => {
    if (ids.length === 0) return 0;
    const rows = await db
      .select({ id: registrations.id })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(and(inArray(registrations.id, ids), ahead, state, not(registeredAgain)));
    return rows.length;
  };
  waiting += await countRegistrations(lapsedIds, stillLapsed);
  waiting += await countRegistrations(
    familyIds,
    or(
      stillLapsed,
      eq(registrations.status, "WAITLISTED"),
      and(eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"), or(isNull(registrations.holdExpiresAt), lte(registrations.holdExpiresAt, now))),
    ),
  );
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
          or(isNotNull(eventInvitations.expiredAt), lte(eventInvitations.expiresAt, now)),
          // Sent again after the window: the Administrator acted.
          lte(eventInvitations.lastSentAt, newest.endedAt as Date),
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
