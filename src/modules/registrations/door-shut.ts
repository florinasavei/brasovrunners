import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { type DoorShutWindow, doorShutWindows } from "@/db/schema/door-shut-windows";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events } from "@/db/schema/events";
import { familyPlaceHolds, familySittings, pendingFamilyEntries } from "@/db/schema/family-entries";
import { jobRuns } from "@/db/schema/job-runs";
import { registrations } from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import {
  DOOR_SHUT_MIN_MS,
  doorShutMaxMs,
  findPingGaps,
  type KnownWindow,
  movedDeadline,
  type NameProbeStatus,
  planDoor,
  stoppedMs,
} from "@/modules/jobs/domain/door-shut";
import { readPingHistory } from "@/modules/jobs/schedule-cache";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { type NameProbe, probePublicName } from "@/modules/resilience/name-probe";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { listStaffUsers } from "@/modules/staff-identity/repository";
import { env } from "@/shared/config/env";
import { computeOccupied } from "./domain/capacity";
import { invitationOpen } from "./invitation-repository";
import { countOccupied, emailLinkLapseSql, lockEventForCapacity } from "./repository";

/**
 * The clock stops while the door is shut (§NNN) — the first step of every real maintenance run,
 * before anything lapses (`maintenance.ts`). The rules are `jobs/domain/door-shut.ts`'s; this reads,
 * writes and tells the Administrators.
 *
 * **What moves, and how.** Every participant deadline still running when the window started, later by
 * the window's stop (its length, capped by «Termene»):
 *
 * - per event, under its lock (`lockEventForCapacity`, the allocator's serialization point — AGENTS.md
 *   §10.6), one transaction each: a declaration hold, a waiting-list offer, a family's reservation
 *   (`registrations.hold_expires_at`), a family sitting's held place (`family_place_holds`), an
 *   invitation (`event_invitations.expires_at`) — each capped as the allocator caps it, compare-and-set
 *   on the value read, with one audit row each;
 * - event-blind, in one transaction: an address link (`registrations.email_link_expires_at`), a
 *   family's kept form and its sitting's link (`pending_family_entries`, `family_sittings.expires_at`),
 *   and the live links' tokens that end with them (`email_action_tokens`), never capped by the event.
 *
 * **No overbooking, ever.** A deadline that passed while the door was shut is revived by the move —
 * and an offer, a reservation, a held place or an invitation occupies its place again only once its
 * deadline is ahead. The place may have been given meanwhile: every read treats a lapsed offer as free
 * (§10.6), and the name may have answered a visitor before this run. So under the same lock, after the
 * moves of what never lapsed, each revived claim is moved alone and the event's places counted again
 * (`countOccupied`, the allocator's own count); one that would take the count past the capacity is
 * seated «În afara locurilor» (`outside_capacity`, §643 — a registration or an invitation, audited,
 * no actor) rather than left lapsed, so nobody loses a place to the outage and no counted place is
 * given twice. A family's held place, which has no row to seat, is left to lapse instead. Only rows this
 * run moved are ever marked.
 *
 * **Idempotent and resumable.** A window remembers the events it finished (`events_moved`) and its
 * links (`links_moved_at`); a retried run does neither twice. The window row is locked inside each of
 * those transactions, so two runs at once serialize on it.
 */

const MINUTE = 60_000;

/** The deployments that have a pinger to fall silent (§513's rule: QA and production). Elsewhere the pings say nothing. */
function hasPinger(appEnv: string): boolean {
  return appEnv === "qa" || appEnv === "production";
}

/** How far back a silence is looked for: past this, the health check has paged for a day already. */
function lookbackMs(maxMs: number): number {
  return maxMs + 26 * 60 * MINUTE;
}

/**
 * A window closed this long ago and still not moved stops holding the sweeps: a step that fails on
 * every run must not freeze every deadline for good (the failure is counted on every run meanwhile).
 */
const PENDING_HOLD_MS = 2 * 60 * MINUTE;

export type DoorShutDeps = {
  /** Whether the site's name resolves; the real lookup by default. */
  probe?: () => Promise<NameProbe>;
  /** The remembered pings since the anchor, or null when the cache cannot say; the cache by default. */
  readPings?: (anchor: { job: "registration-maintenance"; at: Date }, now: Date) => Promise<Date[] | null>;
  /** The pinger's day cadence (`PINGER_CADENCE_MINUTES`). */
  dayCadence?: number;
  /** Whether this deployment has a pinger; QA and production by default. */
  pinger?: boolean;
};

export type DoorShutRun = {
  /** What the name answered this run. */
  name: NameProbeStatus;
  /** Whether the door is shut now: the run lapses nothing. */
  shut: boolean;
  /** Windows written this run (opened, or past silences recorded). */
  windowsOpened: number;
  /** Whether an open window was closed this run. */
  windowClosed: boolean;
  /** Deadlines moved this run. */
  moved: number;
  /** Of them, revived claims seated outside the places. */
  outside: number;
  /** Administrators' emails queued this run. */
  noticesQueued: number;
  /** Windows whose moves failed this run (each counted as a retryable error by the caller). */
  failures: number;
};

export async function stopTheClockWhileTheDoorIsShut<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  settings: Deadlines,
  deps: DoorShutDeps = {},
): Promise<DoorShutRun> {
  const maxMs = doorShutMaxMs(settings);
  const probe = await (deps.probe ?? (() => probePublicName({ now })))();

  // The silences of the pings since the last real run, when the deployment has a pinger and the cache remembers.
  const gaps =
    maxMs > 0 && (deps.pinger ?? hasPinger(env.APP_ENV))
      ? await pingSilences(db, now, maxMs, deps.readPings ?? readPingHistory, deps.dayCadence ?? env.PINGER_CADENCE_MINUTES)
      : [];

  const since = new Date(Math.min(now.getTime() - lookbackMs(maxMs), ...gaps.map((gap) => gap.startedAt.getTime())));
  const known: KnownWindow[] = await db
    .select({ id: doorShutWindows.id, startedAt: doorShutWindows.startedAt, endedAt: doorShutWindows.endedAt })
    .from(doorShutWindows)
    .where(or(isNull(doorShutWindows.endedAt), gt(doorShutWindows.endedAt, since)));

  const plan = planDoor({ now, probe: probe.status, windows: known, gaps, maxMs });
  let windowsOpened = 0;
  if (plan.close) {
    await db
      .update(doorShutWindows)
      .set({ endedAt: plan.close.endedAt, updatedAt: now })
      .where(and(eq(doorShutWindows.id, plan.close.id), isNull(doorShutWindows.endedAt)));
  }
  if (plan.open) {
    const inserted = await db
      .insert(doorShutWindows)
      .values({ startedAt: plan.open.startedAt, source: plan.open.source, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning({ id: doorShutWindows.id });
    windowsOpened += inserted.length;
  }
  for (const gap of plan.record) {
    await db.insert(doorShutWindows).values({ startedAt: gap.startedAt, endedAt: gap.endedAt, source: "pings", createdAt: now, updatedAt: now });
    windowsOpened += 1;
  }

  let noticesQueued = 0;
  // The Administrators are told the door is shut, once per window that the name opened.
  const [openWindow] = await db.select().from(doorShutWindows).where(isNull(doorShutWindows.endedAt)).limit(1);
  if (openWindow && openWindow.openedNoticeAt === null && maxMs > 0) {
    noticesQueued += await tellTheAdministrators(db, openWindow, "DOOR_SHUT", now, maxMs);
  }

  // Every window over and not yet moved, oldest first.
  const pending = await db
    .select()
    .from(doorShutWindows)
    .where(and(isNotNull(doorShutWindows.endedAt), isNull(doorShutWindows.appliedAt)))
    .orderBy(asc(doorShutWindows.startedAt));
  let moved = 0;
  let outside = 0;
  let failures = 0;
  let holding = false;
  for (const window of pending) {
    try {
      const result = await moveTheDeadlines(db, window, now, maxMs, settings);
      moved += result.moved;
      outside += result.outside;
      const [done] = await db.select().from(doorShutWindows).where(eq(doorShutWindows.id, window.id)).limit(1);
      if (done && done.closedNoticeAt === null) noticesQueued += await tellTheAdministrators(db, done, "DOOR_SHUT_DEADLINES_MOVED", now, maxMs);
    } catch (error) {
      console.error("[door-shut] the deadlines of a window could not be moved", window.id, error instanceof Error ? error.name : "error");
      failures += 1;
      // Until it is moved, nothing it was meant to save may lapse — for a while (`PENDING_HOLD_MS`).
      if (window.endedAt && now.getTime() - window.endedAt.getTime() < PENDING_HOLD_MS) holding = true;
    }
  }
  if (moved > 0) revalidatePublicContent("places");

  return {
    name: probe.status,
    shut: plan.shut || holding,
    windowsOpened,
    windowClosed: plan.close !== null,
    moved,
    outside,
    noticesQueued,
    failures,
  };
}

/**
 * The silences since the last real run of this job (`findPingGaps`). The anchor is that run — a real
 * run writes its own ping slot, so a cache that cannot show it remembers nothing worth reading — and
 * the evidence is every remembered ping of both jobs since, every real run of either since (a run is
 * a call that arrived, whoever made it), the anchor and this run.
 */
async function pingSilences<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  maxMs: number,
  readPings: NonNullable<DoorShutDeps["readPings"]>,
  dayCadence: number,
) {
  const [last] = await db
    .select({ startedAt: jobRuns.startedAt })
    .from(jobRuns)
    .where(and(eq(jobRuns.jobName, "registration-maintenance"), lt(jobRuns.startedAt, now)))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1);
  // No run before this one, or one so old that the health check has paged for a day: nothing to read here.
  if (!last || now.getTime() - last.startedAt.getTime() > lookbackMs(maxMs)) return [];
  const anchor = last.startedAt;
  const pings = await readPings({ job: "registration-maintenance", at: anchor }, now);
  if (pings === null) return [];
  const runs = await db
    .select({ startedAt: jobRuns.startedAt })
    .from(jobRuns)
    .where(and(gt(jobRuns.startedAt, anchor), lt(jobRuns.startedAt, now)));
  return findPingGaps([anchor, now, ...pings, ...runs.map((run) => run.startedAt)], dayCadence);
}

type Moved = { moved: number; outside: number };

/** Every deadline of one window that is over, moved — the links once, then each event once. */
async function moveTheDeadlines<T extends Record<string, unknown>>(
  db: Database<T>,
  window: DoorShutWindow,
  now: Date,
  maxMs: number,
  settings: Deadlines,
): Promise<Moved> {
  const endedAt = window.endedAt ?? now;
  const stopMs = stoppedMs({ startedAt: window.startedAt, endedAt }, maxMs);
  if (window.stoppedMinutes === null) {
    await db
      .update(doorShutWindows)
      .set({ stoppedMinutes: Math.round(stopMs / MINUTE), updatedAt: now })
      .where(eq(doorShutWindows.id, window.id));
  }
  const total: Moved = { moved: 0, outside: 0 };
  // Switched off, or a window too short to say in minutes: nothing to move, and nobody to tell.
  if (stopMs < DOOR_SHUT_MIN_MS) {
    await db
      .update(doorShutWindows)
      .set({ appliedAt: now, ...(window.closedNoticeAt === null ? { closedNoticeAt: now } : {}), updatedAt: now })
      .where(eq(doorShutWindows.id, window.id));
    return total;
  }
  if (window.linksMovedAt === null) {
    total.moved += await moveTheLinks(db, window, stopMs, now, settings);
  }
  const done = new Set(window.eventsMoved);
  for (const eventId of await eventsToMove(db, window.startedAt)) {
    if (done.has(eventId)) continue;
    const result = await moveOneEvent(db, window.id, eventId, window.startedAt, stopMs, now);
    total.moved += result.moved;
    total.outside += result.outside;
  }
  await db.update(doorShutWindows).set({ appliedAt: now, updatedAt: now }).where(eq(doorShutWindows.id, window.id));
  return total;
}

/** The window's row, locked in the caller's transaction: two runs at once wait on each other here. */
async function lockWindow<T extends Record<string, unknown>>(tx: Transaction<T>, id: string): Promise<DoorShutWindow | undefined> {
  const [row] = await tx.select().from(doorShutWindows).where(eq(doorShutWindows.id, id)).for("update");
  return row;
}

/** The token purposes whose life is a participant's deadline: the address link, the offer, a family's link, an invitation. */
const DEADLINE_TOKEN_PURPOSES = ["VERIFY_REGISTRATION_EMAIL", "WAITLIST_OFFER", "REGISTER_ANOTHER_PERSON", "ACCEPT_INVITATION"] as const;

async function moveTheLinks<T extends Record<string, unknown>>(
  db: Database<T>,
  window: DoorShutWindow,
  stopMs: number,
  now: Date,
  settings: Deadlines,
): Promise<number> {
  return db.transaction(async (tx) => {
    const locked = await lockWindow(tx, window.id);
    if (!locked || locked.linksMovedAt !== null) return 0;
    let moved = 0;

    // The address links still waiting for a click.
    const lapse = emailLinkLapseSql(settings.confirmationHours);
    const waiting = await tx
      .select({ id: registrations.id, participantId: registrations.participantId, lapse })
      .from(registrations)
      .where(and(eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"), sql`${lapse} > ${window.startedAt.toISOString()}::timestamptz`));
    for (const row of waiting) {
      const stored = new Date(row.lapse);
      const to = movedDeadline({ stored, windowStartedAt: window.startedAt, stopMs, now });
      if (!to) continue;
      const written = await tx
        .update(registrations)
        .set({ emailLinkExpiresAt: to, updatedAt: now })
        .where(and(eq(registrations.id, row.id), eq(registrations.status, "PENDING_EMAIL_CONFIRMATION")))
        .returning({ id: registrations.id });
      if (written.length === 0) continue;
      moved += 1;
      await recordAuditEvent(tx, {
        actorStaffUserId: null,
        participantId: row.participantId,
        action: "registration.deadline_moved_while_shut",
        entityType: "registration",
        entityId: row.id,
        metadata: { kind: "emailLink", from: stored.toISOString(), to: to.toISOString(), windowId: window.id },
        now,
      });
    }

    // A family's kept forms and its sittings' links: no place behind them, no person's row to audit.
    for (const entry of await tx
      .select({ id: pendingFamilyEntries.id, expiresAt: pendingFamilyEntries.expiresAt })
      .from(pendingFamilyEntries)
      .where(gt(pendingFamilyEntries.expiresAt, window.startedAt))) {
      const to = movedDeadline({ stored: entry.expiresAt, windowStartedAt: window.startedAt, stopMs, now });
      if (!to) continue;
      const written = await tx
        .update(pendingFamilyEntries)
        .set({ expiresAt: to })
        .where(and(eq(pendingFamilyEntries.id, entry.id), eq(pendingFamilyEntries.expiresAt, entry.expiresAt)))
        .returning({ id: pendingFamilyEntries.id });
      moved += written.length;
    }
    for (const sitting of await tx
      .select({ id: familySittings.id, expiresAt: familySittings.expiresAt })
      .from(familySittings)
      .where(and(gt(familySittings.expiresAt, window.startedAt), isNull(familySittings.confirmedAt), isNull(familySittings.releasedAt)))) {
      const to = movedDeadline({ stored: sitting.expiresAt, windowStartedAt: window.startedAt, stopMs, now });
      if (!to) continue;
      const written = await tx
        .update(familySittings)
        .set({ expiresAt: to })
        .where(and(eq(familySittings.id, sitting.id), eq(familySittings.expiresAt, sitting.expiresAt)))
        .returning({ id: familySittings.id });
      moved += written.length;
    }

    // The live links that end with those deadlines: the click must still open what the move kept.
    const stopSeconds = Math.round(stopMs / 1000);
    await tx
      .update(emailActionTokens)
      .set({ expiresAt: sql`${emailActionTokens.expiresAt} + make_interval(secs => ${stopSeconds})` })
      .where(
        and(
          inArray(emailActionTokens.purpose, [...DEADLINE_TOKEN_PURPOSES]),
          isNull(emailActionTokens.usedAt),
          isNull(emailActionTokens.invalidatedAt),
          gt(emailActionTokens.expiresAt, window.startedAt),
          sql`${emailActionTokens.expiresAt} + make_interval(secs => ${stopSeconds}) > ${now.toISOString()}::timestamptz`,
        ),
      );

    await tx
      .update(doorShutWindows)
      .set({ linksMovedAt: now, movedCount: sql`${doorShutWindows.movedCount} + ${moved}`, updatedAt: now })
      .where(eq(doorShutWindows.id, window.id));
    return moved;
  });
}

/** The scheduled events, not started when the window did, with a hold, an offer, a reservation, a held place or an invitation running then. */
async function eventsToMove<T extends Record<string, unknown>>(db: Database<T>, startedAt: Date): Promise<string[]> {
  const live = and(sql`${events.eventStatus} = 'SCHEDULED'`, gt(events.startsAt, startedAt));
  const held = await db
    .selectDistinct({ eventId: registrations.eventId })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(
        live,
        inArray(registrations.status, ["PENDING_DECLARATION", "WAITLIST_OFFERED", "PENDING_EMAIL_CONFIRMATION"]),
        gt(registrations.holdExpiresAt, startedAt),
      ),
    );
  const places = await db
    .selectDistinct({ eventId: familyPlaceHolds.eventId })
    .from(familyPlaceHolds)
    .innerJoin(events, eq(events.id, familyPlaceHolds.eventId))
    .where(and(live, gt(familyPlaceHolds.expiresAt, startedAt)));
  const invited = await db
    .selectDistinct({ eventId: eventInvitations.eventId })
    .from(eventInvitations)
    .innerJoin(events, eq(events.id, eventInvitations.eventId))
    .where(and(live, invitationOpen(), gt(eventInvitations.expiresAt, startedAt)));
  return [...new Set([...held, ...places, ...invited].map((row) => row.eventId))];
}

type Claim =
  | { kind: "registration"; id: string; participantId: string; status: string; stored: Date; to: Date; outside: boolean }
  | { kind: "placeHold"; id: string; stored: Date; to: Date; holdsPlace: boolean }
  | { kind: "invitation"; id: string; stored: Date; to: Date; outside: boolean };

const REGISTRATION_DEADLINE_KIND: Record<string, string> = {
  PENDING_DECLARATION: "declarationHold",
  WAITLIST_OFFERED: "offer",
  PENDING_EMAIL_CONFIRMATION: "familyReservation",
};

/** One event's holds, offers, reservations, held places and invitations, under its lock. */
async function moveOneEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  windowId: string,
  eventId: string,
  startedAt: Date,
  stopMs: number,
  now: Date,
): Promise<Moved> {
  return db.transaction(async (tx) => {
    const event = await lockEventForCapacity(tx, eventId);
    const window = await lockWindow(tx, windowId);
    if (!window || window.eventsMoved.includes(eventId)) return { moved: 0, outside: 0 };
    const finish = async (result: Moved) => {
      await tx
        .update(doorShutWindows)
        .set({
          eventsMoved: sql`${doorShutWindows.eventsMoved} || ${JSON.stringify([eventId])}::jsonb`,
          movedCount: sql`${doorShutWindows.movedCount} + ${result.moved}`,
          outsideCount: sql`${doorShutWindows.outsideCount} + ${result.outside}`,
          updatedAt: now,
        })
        .where(eq(doorShutWindows.id, windowId));
      return result;
    };
    // A cancelled event stays as it was cancelled (§331), a completed one as it finished (§82).
    if (!event || event.eventStatus !== "SCHEDULED") return finish({ moved: 0, outside: 0 });
    const holdCap = { registrationClosesAt: event.registrationClosesAt, startsAt: event.startsAt };
    // An invitation is capped by the start alone, as it was given (§647).
    const invitationCap = { registrationClosesAt: null, startsAt: event.startsAt };

    const claims: Claim[] = [];
    for (const row of await tx
      .select({
        id: registrations.id,
        participantId: registrations.participantId,
        status: registrations.status,
        holdExpiresAt: registrations.holdExpiresAt,
        outside: registrations.outsideCapacity,
      })
      .from(registrations)
      .where(
        and(
          eq(registrations.eventId, eventId),
          inArray(registrations.status, ["PENDING_DECLARATION", "WAITLIST_OFFERED", "PENDING_EMAIL_CONFIRMATION"]),
          gt(registrations.holdExpiresAt, startedAt),
        ),
      )) {
      if (!row.holdExpiresAt) continue;
      const to = movedDeadline({ stored: row.holdExpiresAt, windowStartedAt: startedAt, stopMs, now, cap: holdCap });
      if (to) claims.push({ kind: "registration", id: row.id, participantId: row.participantId, status: row.status, stored: row.holdExpiresAt, to, outside: row.outside });
    }
    for (const row of await tx
      .select({ id: familyPlaceHolds.id, expiresAt: familyPlaceHolds.expiresAt, holdsPlace: familyPlaceHolds.holdsPlace })
      .from(familyPlaceHolds)
      .where(and(eq(familyPlaceHolds.eventId, eventId), gt(familyPlaceHolds.expiresAt, startedAt)))) {
      const to = movedDeadline({ stored: row.expiresAt, windowStartedAt: startedAt, stopMs, now, cap: holdCap });
      if (to) claims.push({ kind: "placeHold", id: row.id, stored: row.expiresAt, to, holdsPlace: row.holdsPlace });
    }
    for (const row of await tx
      .select({ id: eventInvitations.id, expiresAt: eventInvitations.expiresAt, outside: eventInvitations.outsideCapacity })
      .from(eventInvitations)
      .where(and(eq(eventInvitations.eventId, eventId), invitationOpen(), gt(eventInvitations.expiresAt, startedAt)))) {
      const to = movedDeadline({ stored: row.expiresAt, windowStartedAt: startedAt, stopMs, now, cap: invitationCap });
      if (to) claims.push({ kind: "invitation", id: row.id, stored: row.expiresAt, to, outside: row.outside });
    }

    /*
      A claim that comes back to a counted place: past its deadline now, so counted nowhere, and once
      moved counted again. A declaration hold is counted by its state whatever its deadline (§160), and
      a row or an invitation outside the places is counted nowhere either way: neither changes a count.
    */
    const revives = (claim: Claim) =>
      claim.stored.getTime() <= now.getTime() &&
      (claim.kind === "placeHold"
        ? claim.holdsPlace
        : claim.kind === "invitation"
          ? !claim.outside
          : !claim.outside && claim.status !== "PENDING_DECLARATION");

    let moved = 0;
    let outside = 0;
    const write = async (claim: Claim, to: Date): Promise<boolean> => {
      if (claim.kind === "registration") {
        const written = await tx
          .update(registrations)
          .set({ holdExpiresAt: to, updatedAt: now })
          .where(and(eq(registrations.id, claim.id), eq(registrations.holdExpiresAt, claim.stored), eq(registrations.status, claim.status as "PENDING_DECLARATION")))
          .returning({ id: registrations.id });
        return written.length > 0;
      }
      if (claim.kind === "placeHold") {
        const written = await tx
          .update(familyPlaceHolds)
          .set({ expiresAt: to })
          .where(and(eq(familyPlaceHolds.id, claim.id), eq(familyPlaceHolds.expiresAt, claim.stored)))
          .returning({ id: familyPlaceHolds.id });
        return written.length > 0;
      }
      const written = await tx
        .update(eventInvitations)
        .set({ expiresAt: to })
        .where(and(eq(eventInvitations.id, claim.id), eq(eventInvitations.expiresAt, claim.stored), invitationOpen()))
        .returning({ id: eventInvitations.id });
      return written.length > 0;
    };
    const audit = async (claim: Claim, seatedOutside: boolean) => {
      if (claim.kind === "registration") {
        await recordAuditEvent(tx, {
          actorStaffUserId: null,
          participantId: claim.participantId,
          action: "registration.deadline_moved_while_shut",
          entityType: "registration",
          entityId: claim.id,
          metadata: {
            kind: REGISTRATION_DEADLINE_KIND[claim.status] ?? claim.status,
            from: claim.stored.toISOString(),
            to: claim.to.toISOString(),
            windowId,
            ...(seatedOutside ? { outsideCapacity: true } : {}),
          },
          now,
        });
        if (seatedOutside) {
          // The mark's own trail row, as an Administrator's would be (§643) — by nobody: the job, for the outage.
          await recordAuditEvent(tx, {
            actorStaffUserId: null,
            participantId: claim.participantId,
            action: "registration.outside_capacity_changed",
            entityType: "registration",
            entityId: claim.id,
            metadata: { from: false, to: true, status: claim.status, doorShutWindowId: windowId },
            now,
          });
        }
      } else if (claim.kind === "invitation") {
        await recordAuditEvent(tx, {
          actorStaffUserId: null,
          participantId: null,
          action: "event.invitation_deadline_moved_while_shut",
          entityType: "event",
          entityId: eventId,
          metadata: { invitationId: claim.id, from: claim.stored.toISOString(), to: claim.to.toISOString(), windowId, outsideCapacity: claim.outside || seatedOutside },
          now,
        });
      }
    };

    // First what never lapsed, or changes no count: moving it later takes no place from anybody.
    for (const claim of claims.filter((item) => !revives(item))) {
      if (await write(claim, claim.to)) {
        moved += 1;
        await audit(claim, false);
      }
    }

    // Then each revived claim alone, oldest deadline first, counted again under the lock.
    const counted = async () => computeOccupied(await countOccupied(tx, eventId, now));
    let before = event.capacity === null ? 0 : await counted();
    for (const claim of claims.filter(revives).sort((a, b) => a.stored.getTime() - b.stored.getTime())) {
      if (!(await write(claim, claim.to))) continue;
      if (event.capacity === null) {
        moved += 1;
        await audit(claim, false);
        continue;
      }
      const after = await counted();
      if (after <= event.capacity || after <= before) {
        before = after;
        moved += 1;
        await audit(claim, false);
        continue;
      }
      // Its place went to somebody else meanwhile: seated outside the places, or — a family's held place, which has no row to seat — left lapsed.
      if (claim.kind === "placeHold") {
        await tx.update(familyPlaceHolds).set({ expiresAt: claim.stored }).where(eq(familyPlaceHolds.id, claim.id));
        continue;
      }
      if (claim.kind === "registration") {
        await tx.update(registrations).set({ outsideCapacity: true, updatedAt: now }).where(eq(registrations.id, claim.id));
      } else {
        await tx.update(eventInvitations).set({ outsideCapacity: true }).where(eq(eventInvitations.id, claim.id));
      }
      moved += 1;
      outside += 1;
      await audit(claim, true);
      before = await counted();
    }
    return finish({ moved, outside });
  });
}

/**
 * One email per Administrator and Superadministrator with an address, in their own language, once per
 * window and message (its idempotency key), and the window remembers it was sent. On the club's road:
 * when the club's own domain is what is gone, Mailgun's sending subdomain may be gone with it.
 */
async function tellTheAdministrators<T extends Record<string, unknown>>(
  db: Database<T>,
  window: DoorShutWindow,
  messageType: "DOOR_SHUT" | "DOOR_SHUT_DEADLINES_MOVED",
  now: Date,
  maxMs: number,
): Promise<number> {
  const recipients = (await listStaffUsers(db)).filter((member) => canManageClubSettings(member.role) && member.email.trim() !== "");
  return db.transaction(async (tx) => {
    const locked = await lockWindow(tx, window.id);
    if (!locked) return 0;
    if (messageType === "DOOR_SHUT" ? locked.openedNoticeAt !== null : locked.closedNoticeAt !== null) return 0;
    let queued = 0;
    for (const member of recipients) {
      const row = await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType,
        locale: member.preferredLocale,
        recipientEmail: member.email,
        payload: {
          displayName: member.displayName,
          startedAt: locked.startedAt.toISOString(),
          endedAt: locked.endedAt ? locked.endedAt.toISOString() : null,
          source: locked.source,
          stoppedMinutes: locked.stoppedMinutes,
          maxHours: Math.round(maxMs / (60 * MINUTE)),
          moved: locked.movedCount,
          outside: locked.outsideCount,
        },
        idempotencyKey: `door-shut:${locked.id}:${messageType === "DOOR_SHUT" ? "shut" : "moved"}:${member.id}`,
        now,
      });
      if (row) queued += 1;
    }
    await tx
      .update(doorShutWindows)
      .set(messageType === "DOOR_SHUT" ? { openedNoticeAt: now, updatedAt: now } : { closedNoticeAt: now, updatedAt: now })
      .where(eq(doorShutWindows.id, locked.id));
    return queued;
  });
}
