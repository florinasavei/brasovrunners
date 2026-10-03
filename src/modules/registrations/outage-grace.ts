import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events } from "@/db/schema/events";
import { familyPlaceHolds, familySittings, pendingFamilyEntries } from "@/db/schema/family-entries";
import { jobRuns } from "@/db/schema/job-runs";
import { registrations } from "@/db/schema/registrations";
import { type UnreachableWindow, unreachableWindows } from "@/db/schema/unreachable-windows";
import type { Database, Transaction } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { readPingHistory } from "@/modules/jobs/schedule-cache";
import { INVITATION_LINK_GRACE_DAYS } from "@/modules/notifications/invitation-render";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import type { NameProbeStatus } from "@/modules/resilience/domain/name-probe";
import { type NameProbe, probePublicName } from "@/modules/resilience/name-probe";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { listStaffUsers } from "@/modules/staff-identity/repository";
import { env } from "@/shared/config/env";
import { computeOccupied } from "./domain/capacity";
import {
  findPingGaps,
  grantedMsFor,
  type KnownWindow,
  movedDeadline,
  OUTAGE_MIN_MS,
  outageGraceMaxMs,
  PENDING_HOLD_MS,
  planOutage,
} from "./domain/outage-grace";
import { invitationOpen } from "./invitation-repository";
import { countOccupied, emailLinkLapseSql, lockEventForCapacity } from "./repository";

/**
 * The clock stops while the door is shut (§NNN) — the outage grace, the first step of every real
 * maintenance run, before anything lapses (`maintenance.ts`). The rules are `domain/outage-grace.ts`'s;
 * this reads, writes and tells the Administrators.
 *
 * **What moves, and how.** Every participant deadline still running when the window started, later by
 * what the window gives back (`granted_ms`: its length, capped by «Termene», decided when it closed):
 *
 * - per event, under its lock (`lockEventForCapacity`, the allocator's serialization point — AGENTS.md
 *   §10.6), one transaction each: a declaration hold, a waiting-list offer, a family's reservation
 *   (`registrations.hold_expires_at`), a family sitting's held place (`family_place_holds`), an
 *   invitation (`event_invitations.expires_at`) — each capped as the allocator caps it, compare-and-set
 *   on the value read, with one audit row each;
 * - event-blind, in one transaction: an address link (`registrations.email_link_expires_at`), a
 *   family's kept form and its sitting's link (`pending_family_entries`, `family_sittings.expires_at`),
 *   compare-and-set on the value read, never capped by the event.
 *
 * Each link's live token (`email_action_tokens`) moves with its row, in the same transaction and only
 * when its `expires_at` still equals the row's old deadline (an invitation's: the deadline plus the
 * link's grace): a token whose row did not move — a lost compare-and-set, a cancelled event, a move
 * capped away — keeps its instant.
 *
 * **No overbooking, ever.** A deadline that passed while the door was shut is revived by the move —
 * and an offer, a reservation, a held place or an invitation occupies its place again only once its
 * deadline is ahead. The place may have been given meanwhile: every read treats a lapsed offer as free
 * (§10.6), and the name may have answered a visitor before this run. So under the same lock, after the
 * moves of what never lapsed, each revived claim is moved alone and the event's places counted again
 * (`countOccupied`, the allocator's own count); an offer or an invitation that would take the count
 * past the capacity is seated «În afara locurilor» (`outside_capacity`, §643 — audited, no actor)
 * rather than left lapsed, so nobody loses a place to the outage and no counted place is given twice.
 * A family's reservation and a family's held place are left to lapse instead, as they would have: a
 * reservation seated outside would keep a seat above the advertised places long after its own deadline.
 * Only rows this run moved are ever marked.
 *
 * **Idempotent and resumable.** A window remembers the events it finished (`events_moved`) and its
 * links (`links_moved_at`); a retried run does neither twice. The window row is locked inside each of
 * those transactions, so two runs at once serialize on it.
 */

const MINUTE = 60_000;
const INVITATION_LINK_GRACE_MS = INVITATION_LINK_GRACE_DAYS * 24 * 60 * MINUTE;

/** The deployments that have a pinger to fall silent (§513's rule: QA and production). Elsewhere the pings say nothing. */
function hasPinger(appEnv: string): boolean {
  return appEnv === "qa" || appEnv === "production";
}

/** How far back a silence is looked for: past this, the health check has paged for a day already. */
function lookbackMs(maxMs: number): number {
  return maxMs + 26 * 60 * MINUTE;
}

export type OutageGraceDeps = {
  /** Whether the site's name resolves; the real lookup by default. */
  probe?: () => Promise<NameProbe>;
  /** The remembered pings since the anchor, or null when the cache cannot say; the cache by default. */
  readPings?: (anchor: { job: "registration-maintenance"; at: Date }, now: Date) => Promise<Date[] | null>;
  /** The pinger's day cadence (`PINGER_CADENCE_MINUTES`). */
  dayCadence?: number;
  /** Whether this deployment has a pinger; QA and production by default. */
  pinger?: boolean;
};

export type OutageGraceRun = {
  /** What the name answered this run. */
  domain: NameProbeStatus;
  /** Whether this run holds every lapse: a `dns` window is open (within the cap), or a window's moves failed a moment ago. */
  holding: boolean;
  /** Windows written this run (opened, or past silences recorded) — never a suspicion. */
  windowsOpened: number;
  /** Whether an open window was closed this run. */
  windowClosed: boolean;
  /** Deadlines moved this run. */
  moved: number;
  /** Of them, revived claims seated outside the places. */
  outside: number;
  /** Administrators' emails queued this run. */
  noticesQueued: number;
  /** Windows whose moves failed this run. */
  failures: number;
  /** Of them, those the next ping may still repair (closed less than `PENDING_HOLD_MS` ago); the rest are «Sarcini»'s. */
  retryableFailures: number;
};

export async function applyOutageGrace<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
  settings: Deadlines,
  deps: OutageGraceDeps = {},
): Promise<OutageGraceRun> {
  const maxMs = outageGraceMaxMs(settings);
  const probe = await (deps.probe ?? (() => probePublicName({ now })))();

  // The silences of the pings since the last real run, when the deployment has a pinger and the cache remembers — whatever the cap: 0 switches the moving off, never the seeing.
  const gaps =
    (deps.pinger ?? hasPinger(env.APP_ENV))
      ? await pingSilences(db, now, maxMs, deps.readPings ?? readPingHistory, deps.dayCadence ?? env.PINGER_CADENCE_MINUTES)
      : [];

  const since = new Date(Math.min(now.getTime() - lookbackMs(maxMs), ...gaps.map((gap) => gap.startedAt.getTime())));
  const known: KnownWindow[] = await db
    .select({
      id: unreachableWindows.id,
      source: unreachableWindows.source,
      startedAt: unreachableWindows.startedAt,
      endedAt: unreachableWindows.endedAt,
      confirmedAt: unreachableWindows.confirmedAt,
    })
    .from(unreachableWindows)
    .where(or(isNull(unreachableWindows.endedAt), gt(unreachableWindows.endedAt, since)));

  const plan = planOutage({ now, probe: probe.status, windows: known, gaps, maxMs });
  let windowsOpened = 0;
  if (plan.clear) {
    // One «no such name», then an answer: it never happened.
    await db
      .delete(unreachableWindows)
      .where(and(eq(unreachableWindows.id, plan.clear.id), isNull(unreachableWindows.confirmedAt), isNull(unreachableWindows.endedAt)));
  }
  if (plan.close) {
    const open = known.find((window) => window.id === plan.close?.id);
    const grantedMs = open ? grantedMsFor({ startedAt: open.startedAt, endedAt: plan.close.endedAt }, maxMs) : 0;
    await db
      .update(unreachableWindows)
      .set({ endedAt: plan.close.endedAt, grantedMs, updatedAt: now })
      .where(and(eq(unreachableWindows.id, plan.close.id), isNull(unreachableWindows.endedAt)));
  }
  if (plan.suspect) {
    await db
      .insert(unreachableWindows)
      .values({ source: "dns", startedAt: plan.suspect.startedAt, createdAt: now, updatedAt: now })
      .onConflictDoNothing();
  }
  if (plan.confirm) {
    const confirmed = await db
      .update(unreachableWindows)
      .set({ confirmedAt: now, startedAt: plan.confirm.startedAt, updatedAt: now })
      .where(and(eq(unreachableWindows.id, plan.confirm.id), isNull(unreachableWindows.confirmedAt), isNull(unreachableWindows.endedAt)))
      .returning({ id: unreachableWindows.id });
    windowsOpened += confirmed.length;
  }
  for (const gap of plan.record) {
    await db.insert(unreachableWindows).values({
      source: "pings",
      startedAt: gap.startedAt,
      endedAt: gap.endedAt,
      confirmedAt: now,
      grantedMs: grantedMsFor(gap, maxMs),
      createdAt: now,
      updatedAt: now,
    });
    windowsOpened += 1;
  }

  let noticesQueued = 0;
  // The Administrators are told a `dns` window opened, once — a suspicion tells nobody.
  const [openWindow] = await db
    .select()
    .from(unreachableWindows)
    .where(and(isNull(unreachableWindows.endedAt), isNotNull(unreachableWindows.confirmedAt)))
    .limit(1);
  if (openWindow && openWindow.openedAnnouncedAt === null) {
    noticesQueued += await tellTheAdministrators(db, openWindow, "UNREACHABLE_WINDOW_OPENED", now, maxMs);
  }

  // Every window over and not yet applied, oldest first.
  const pending = await db
    .select()
    .from(unreachableWindows)
    .where(and(isNotNull(unreachableWindows.endedAt), isNull(unreachableWindows.appliedAt)))
    .orderBy(asc(unreachableWindows.startedAt));
  let moved = 0;
  let outside = 0;
  let failures = 0;
  let retryableFailures = 0;
  let holdingForFailure = false;
  for (const window of pending) {
    try {
      const result = await moveTheDeadlines(db, window, now, settings);
      moved += result.moved;
      outside += result.outside;
      const [done] = await db.select().from(unreachableWindows).where(eq(unreachableWindows.id, window.id)).limit(1);
      if (done && done.closedAnnouncedAt === null) noticesQueued += await tellTheAdministrators(db, done, "UNREACHABLE_WINDOW_CLOSED", now, maxMs);
    } catch (error) {
      console.error("[outage-grace] the deadlines of a window could not be moved", window.id, error instanceof Error ? error.name : "error");
      failures += 1;
      // Until it is moved, nothing it was meant to save may lapse — for a while (`PENDING_HOLD_MS`); then «Sarcini» says so.
      if (window.endedAt && now.getTime() - window.endedAt.getTime() < PENDING_HOLD_MS) {
        holdingForFailure = maxMs > 0;
        retryableFailures += 1;
      }
    }
  }
  if (moved > 0) revalidatePublicContent("places");

  return {
    domain: probe.status,
    holding: plan.holding || holdingForFailure,
    windowsOpened,
    windowClosed: plan.close !== null,
    moved,
    outside,
    noticesQueued,
    failures,
    retryableFailures,
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
  readPings: NonNullable<OutageGraceDeps["readPings"]>,
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

/** Every deadline of one window that is over, moved — the links once, then each event once. With nothing given back (the cap at 0), nothing moves and the window is done. */
async function moveTheDeadlines<T extends Record<string, unknown>>(
  db: Database<T>,
  window: UnreachableWindow,
  now: Date,
  settings: Deadlines,
): Promise<Moved> {
  // What this window gives back was decided when it closed: a retry moves by the same amount, whatever «Termene» says by then.
  const grantedMs = window.grantedMs;
  const total: Moved = { moved: 0, outside: 0 };
  if (grantedMs >= OUTAGE_MIN_MS) {
    if (window.linksMovedAt === null) {
      total.moved += await moveTheLinks(db, window, grantedMs, now, settings);
    }
    const done = new Set(window.eventsMoved);
    for (const eventId of await eventsToMove(db, window.startedAt)) {
      if (done.has(eventId)) continue;
      const result = await moveOneEvent(db, window.id, eventId, window.startedAt, grantedMs, now);
      total.moved += result.moved;
      total.outside += result.outside;
    }
  }
  await db.update(unreachableWindows).set({ appliedAt: now, updatedAt: now }).where(eq(unreachableWindows.id, window.id));
  return total;
}

/** The window's row, locked in the caller's transaction: two runs at once wait on each other here. */
async function lockWindow<T extends Record<string, unknown>>(tx: Transaction<T>, id: string): Promise<UnreachableWindow | undefined> {
  const [row] = await tx.select().from(unreachableWindows).where(eq(unreachableWindows.id, id)).for("update");
  return row;
}

/**
 * A link's live token, in lockstep with the deadline it ends with: only a token unused, not replaced,
 * whose `expires_at` is still the old instant (plus `offsetMs`: an invitation's link lives a grace past
 * its deadline), moved to the new one (plus the same). Called in the transaction of its row's move,
 * after that move was written — a token whose row did not move keeps its instant.
 */
async function moveTokenWith<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  scope: SQL,
  from: Date,
  to: Date,
  offsetMs = 0,
): Promise<void> {
  await tx
    .update(emailActionTokens)
    .set({ expiresAt: new Date(to.getTime() + offsetMs) })
    .where(
      and(
        scope,
        isNull(emailActionTokens.usedAt),
        isNull(emailActionTokens.invalidatedAt),
        eq(emailActionTokens.expiresAt, new Date(from.getTime() + offsetMs)),
      ),
    );
}

async function moveTheLinks<T extends Record<string, unknown>>(
  db: Database<T>,
  window: UnreachableWindow,
  grantedMs: number,
  now: Date,
  settings: Deadlines,
): Promise<number> {
  return db.transaction(async (tx) => {
    const locked = await lockWindow(tx, window.id);
    if (!locked || locked.linksMovedAt !== null) return 0;
    let moved = 0;

    // The address links still waiting for a click — a row written before the column (null) by its lapse, materialised by the move.
    const lapse = emailLinkLapseSql(settings.confirmationHours);
    const waiting = await tx
      .select({ id: registrations.id, participantId: registrations.participantId, written: registrations.emailLinkExpiresAt, lapse })
      .from(registrations)
      .where(and(eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"), sql`${lapse} > ${window.startedAt.toISOString()}::timestamptz`));
    for (const row of waiting) {
      const stored = new Date(row.lapse);
      const to = movedDeadline({ stored, windowStartedAt: window.startedAt, grantedMs, now });
      if (!to) continue;
      // Compare-and-set on the value read: a link a resend or a restart wrote meanwhile is left as that left it.
      const written = await tx
        .update(registrations)
        .set({ emailLinkExpiresAt: to, updatedAt: now })
        .where(
          and(
            eq(registrations.id, row.id),
            eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"),
            row.written ? eq(registrations.emailLinkExpiresAt, row.written) : isNull(registrations.emailLinkExpiresAt),
          ),
        )
        .returning({ id: registrations.id });
      if (written.length === 0) continue;
      moved += 1;
      await moveTokenWith(tx, and(eq(emailActionTokens.purpose, "VERIFY_REGISTRATION_EMAIL"), eq(emailActionTokens.registrationId, row.id)) as SQL, stored, to);
      await recordAuditEvent(tx, {
        actorStaffUserId: null,
        participantId: row.participantId,
        action: "registration.deadline_moved_for_outage",
        entityType: "registration",
        entityId: row.id,
        metadata: { kind: "emailLink", from: stored.toISOString(), to: to.toISOString(), windowId: window.id, source: window.source },
        now,
      });
    }

    // A family's kept forms and its sittings' links: no place behind them, no person's row to audit; each one's own token with it.
    for (const entry of await tx
      .select({ id: pendingFamilyEntries.id, expiresAt: pendingFamilyEntries.expiresAt, tokenId: pendingFamilyEntries.actionTokenId })
      .from(pendingFamilyEntries)
      .where(gt(pendingFamilyEntries.expiresAt, window.startedAt))) {
      const to = movedDeadline({ stored: entry.expiresAt, windowStartedAt: window.startedAt, grantedMs, now });
      if (!to) continue;
      const written = await tx
        .update(pendingFamilyEntries)
        .set({ expiresAt: to })
        .where(and(eq(pendingFamilyEntries.id, entry.id), eq(pendingFamilyEntries.expiresAt, entry.expiresAt)))
        .returning({ id: pendingFamilyEntries.id });
      if (written.length === 0) continue;
      moved += 1;
      if (entry.tokenId) await moveTokenWith(tx, eq(emailActionTokens.id, entry.tokenId), entry.expiresAt, to);
    }
    for (const sitting of await tx
      .select({ id: familySittings.id, expiresAt: familySittings.expiresAt, tokenId: familySittings.actionTokenId })
      .from(familySittings)
      .where(and(gt(familySittings.expiresAt, window.startedAt), isNull(familySittings.confirmedAt), isNull(familySittings.releasedAt)))) {
      const to = movedDeadline({ stored: sitting.expiresAt, windowStartedAt: window.startedAt, grantedMs, now });
      if (!to) continue;
      const written = await tx
        .update(familySittings)
        .set({ expiresAt: to })
        .where(and(eq(familySittings.id, sitting.id), eq(familySittings.expiresAt, sitting.expiresAt)))
        .returning({ id: familySittings.id });
      if (written.length === 0) continue;
      moved += 1;
      if (sitting.tokenId) await moveTokenWith(tx, eq(emailActionTokens.id, sitting.tokenId), sitting.expiresAt, to);
    }

    await tx
      .update(unreachableWindows)
      .set({ linksMovedAt: now, rowsMoved: sql`${unreachableWindows.rowsMoved} + ${moved}`, updatedAt: now })
      .where(eq(unreachableWindows.id, window.id));
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

type RegistrationStatusMoved = "PENDING_DECLARATION" | "WAITLIST_OFFERED" | "PENDING_EMAIL_CONFIRMATION";

type Claim =
  | { kind: "registration"; id: string; participantId: string; status: RegistrationStatusMoved; stored: Date; to: Date; outside: boolean }
  | { kind: "placeHold"; id: string; stored: Date; to: Date; holdsPlace: boolean }
  | { kind: "invitation"; id: string; stored: Date; to: Date; outside: boolean };

const REGISTRATION_DEADLINE_KIND: Record<RegistrationStatusMoved, string> = {
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
  grantedMs: number,
  now: Date,
): Promise<Moved> {
  return db.transaction(async (tx) => {
    const event = await lockEventForCapacity(tx, eventId);
    const window = await lockWindow(tx, windowId);
    if (!window || window.eventsMoved.includes(eventId)) return { moved: 0, outside: 0 };
    const finish = async (result: Moved) => {
      await tx
        .update(unreachableWindows)
        .set({
          eventsMoved: sql`${unreachableWindows.eventsMoved} || ${JSON.stringify([eventId])}::jsonb`,
          rowsMoved: sql`${unreachableWindows.rowsMoved} + ${result.moved}`,
          placesOutside: sql`${unreachableWindows.placesOutside} + ${result.outside}`,
          updatedAt: now,
        })
        .where(eq(unreachableWindows.id, windowId));
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
      const to = movedDeadline({ stored: row.holdExpiresAt, windowStartedAt: startedAt, grantedMs, now, cap: holdCap });
      if (to) {
        claims.push({
          kind: "registration",
          id: row.id,
          participantId: row.participantId,
          status: row.status as RegistrationStatusMoved,
          stored: row.holdExpiresAt,
          to,
          outside: row.outside,
        });
      }
    }
    for (const row of await tx
      .select({ id: familyPlaceHolds.id, expiresAt: familyPlaceHolds.expiresAt, holdsPlace: familyPlaceHolds.holdsPlace })
      .from(familyPlaceHolds)
      .where(and(eq(familyPlaceHolds.eventId, eventId), gt(familyPlaceHolds.expiresAt, startedAt)))) {
      const to = movedDeadline({ stored: row.expiresAt, windowStartedAt: startedAt, grantedMs, now, cap: holdCap });
      if (to) claims.push({ kind: "placeHold", id: row.id, stored: row.expiresAt, to, holdsPlace: row.holdsPlace });
    }
    for (const row of await tx
      .select({ id: eventInvitations.id, expiresAt: eventInvitations.expiresAt, outside: eventInvitations.outsideCapacity })
      .from(eventInvitations)
      .where(and(eq(eventInvitations.eventId, eventId), invitationOpen(), gt(eventInvitations.expiresAt, startedAt)))) {
      const to = movedDeadline({ stored: row.expiresAt, windowStartedAt: startedAt, grantedMs, now, cap: invitationCap });
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
    /** A claim with no room is seated outside the places — an offer or an invitation — or left to lapse: a family's reservation or held place. */
    const seatable = (claim: Claim) => claim.kind === "invitation" || (claim.kind === "registration" && claim.status === "WAITLIST_OFFERED");

    let moved = 0;
    let outside = 0;
    const write = async (claim: Claim, to: Date): Promise<boolean> => {
      if (claim.kind === "registration") {
        const written = await tx
          .update(registrations)
          .set({ holdExpiresAt: to, updatedAt: now })
          .where(and(eq(registrations.id, claim.id), eq(registrations.holdExpiresAt, claim.stored), eq(registrations.status, claim.status)))
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
    /** Its link's token with it: an offer's (`WAITLIST_OFFER`) and an invitation's (`ACCEPT_INVITATION`, a grace past the deadline). */
    const moveToken = async (claim: Claim) => {
      if (claim.kind === "registration" && claim.status === "WAITLIST_OFFERED") {
        await moveTokenWith(tx, and(eq(emailActionTokens.purpose, "WAITLIST_OFFER"), eq(emailActionTokens.registrationId, claim.id)) as SQL, claim.stored, claim.to);
      } else if (claim.kind === "invitation") {
        await moveTokenWith(
          tx,
          and(eq(emailActionTokens.purpose, "ACCEPT_INVITATION"), eq(emailActionTokens.invitationId, claim.id)) as SQL,
          claim.stored,
          claim.to,
          INVITATION_LINK_GRACE_MS,
        );
      }
    };
    const audit = async (claim: Claim, seatedOutside: boolean) => {
      if (claim.kind === "registration") {
        await recordAuditEvent(tx, {
          actorStaffUserId: null,
          participantId: claim.participantId,
          action: "registration.deadline_moved_for_outage",
          entityType: "registration",
          entityId: claim.id,
          metadata: {
            kind: REGISTRATION_DEADLINE_KIND[claim.status],
            from: claim.stored.toISOString(),
            to: claim.to.toISOString(),
            windowId,
            source: window.source,
            ...(seatedOutside ? { outsideCapacity: true } : {}),
          },
          now,
        });
        if (seatedOutside) {
          // The mark's own trail row, as an Administrator's would be (§643) — by nobody: the job, for the outage.
          await recordAuditEvent(tx, {
            actorStaffUserId: null,
            participantId: claim.participantId,
            action: "registration.seated_outside_for_outage_grace",
            entityType: "registration",
            entityId: claim.id,
            metadata: { from: false, to: true, status: claim.status, windowId },
            now,
          });
        }
      } else if (claim.kind === "invitation") {
        await recordAuditEvent(tx, {
          actorStaffUserId: null,
          participantId: null,
          action: "event.invitation_deadline_moved_for_outage",
          entityType: "event",
          entityId: eventId,
          metadata: {
            invitationId: claim.id,
            from: claim.stored.toISOString(),
            to: claim.to.toISOString(),
            windowId,
            source: window.source,
            outsideCapacity: claim.outside || seatedOutside,
          },
          now,
        });
      }
    };

    // First what never lapsed, or changes no count: moving it later takes no place from anybody.
    for (const claim of claims.filter((item) => !revives(item))) {
      if (await write(claim, claim.to)) {
        moved += 1;
        await moveToken(claim);
        await audit(claim, false);
      }
    }

    /*
      Then each revived claim alone, oldest deadline first, counted again under the lock. The lock is the
      allocator's own (§10.6): every path that gives a place takes it first, so between this count and
      this write no other transaction can give the place this claim takes back.
    */
    const counted = async () => computeOccupied(await countOccupied(tx, eventId, now));
    let before = event.capacity === null ? 0 : await counted();
    for (const claim of claims.filter(revives).sort((a, b) => a.stored.getTime() - b.stored.getTime())) {
      if (!(await write(claim, claim.to))) continue;
      if (event.capacity === null) {
        moved += 1;
        await moveToken(claim);
        await audit(claim, false);
        continue;
      }
      const after = await counted();
      if (after <= event.capacity || after <= before) {
        before = after;
        moved += 1;
        await moveToken(claim);
        await audit(claim, false);
        continue;
      }
      if (!seatable(claim)) {
        /*
          Its place went to somebody else meanwhile, and a family's reservation or held place is never
          seated outside: put back as it was, it lapses as it would have, and the reservation's address,
          once confirmed, is allocated like any other (§543) — never above the advertised places.
        */
        if (claim.kind === "placeHold") {
          await tx.update(familyPlaceHolds).set({ expiresAt: claim.stored }).where(eq(familyPlaceHolds.id, claim.id));
        } else if (claim.kind === "registration") {
          await tx.update(registrations).set({ holdExpiresAt: claim.stored }).where(eq(registrations.id, claim.id));
        }
        continue;
      }
      /*
        Seated «În afara locurilor» (§643, §648) — whatever the event's «Folosește lista de invitați
        speciali»: that switch governs the Administrators' own verb, and this mark is the platform's,
        given only to a claim the outage revived. An outside offer lapses at its moved deadline like any
        other and ends `EXPIRED`; an outside invitation, accepted, seats its registration outside (§647).
      */
      if (claim.kind === "registration") {
        await tx.update(registrations).set({ outsideCapacity: true, updatedAt: now }).where(eq(registrations.id, claim.id));
      } else {
        await tx.update(eventInvitations).set({ outsideCapacity: true }).where(eq(eventInvitations.id, claim.id));
      }
      moved += 1;
      outside += 1;
      await moveToken(claim);
      await audit(claim, true);
      before = await counted();
    }
    return finish({ moved, outside });
  });
}

/**
 * One email per Administrator and Superadministrator with an address, in their own language, once per
 * window and message (its idempotency key, `unreachable:<window>:opened|closed:<staff id>`), and the
 * window remembers it was sent. On the club's road: when the club's own domain is what is gone,
 * Mailgun's sending subdomain may be gone with it.
 */
async function tellTheAdministrators<T extends Record<string, unknown>>(
  db: Database<T>,
  window: UnreachableWindow,
  messageType: "UNREACHABLE_WINDOW_OPENED" | "UNREACHABLE_WINDOW_CLOSED",
  now: Date,
  maxMs: number,
): Promise<number> {
  const opened = messageType === "UNREACHABLE_WINDOW_OPENED";
  const recipients = (await listStaffUsers(db)).filter((member) => canManageClubSettings(member.role) && member.email.trim() !== "");
  return db.transaction(async (tx) => {
    const locked = await lockWindow(tx, window.id);
    if (!locked) return 0;
    if (opened ? locked.openedAnnouncedAt !== null : locked.closedAnnouncedAt !== null) return 0;
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
          grantedMinutes: Math.round(locked.grantedMs / MINUTE),
          maxHours: Math.round(maxMs / (60 * MINUTE)),
          moved: locked.rowsMoved,
          outside: locked.placesOutside,
        },
        idempotencyKey: `unreachable:${locked.id}:${opened ? "opened" : "closed"}:${member.id}`,
        now,
      });
      if (row) queued += 1;
    }
    await tx
      .update(unreachableWindows)
      .set(opened ? { openedAnnouncedAt: now, updatedAt: now } : { closedAnnouncedAt: now, updatedAt: now })
      .where(eq(unreachableWindows.id, locked.id));
    return queued;
  });
}
