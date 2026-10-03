import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events } from "@/db/schema/events";
import { familyPlaceHolds, familySittings, pendingFamilyEntries } from "@/db/schema/family-entries";
import { jobRuns } from "@/db/schema/job-runs";
import { registrations } from "@/db/schema/registrations";
import { type NotRevivedClaim, type UnreachableWindow, unreachableWindows } from "@/db/schema/unreachable-windows";
import type { Database, Transaction } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { JOB_NAMES, type JobName } from "@/modules/jobs/schedule";
import { type NameReadingSlot, readPingHistory, recordNameReading } from "@/modules/jobs/schedule-cache";
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
  grownGrant,
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
 * **What moves, and how.** A window gives back time (`granted_ms`, within «Termene»'s cap) and moves the
 * deadlines in steps: a `pings` window, seen once it is over, in one step from its start; a `dns`
 * window on every real run while it is open — by the time since the run before, so a running deadline
 * never reads as lapsed and never frees its place while the name is gone — and once more when it
 * closes. A step from `since` (the start plus what earlier steps gave) moves every deadline still
 * running at `since`:
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
 * link's grace; a link written before its column existed: every live token still running at `since`):
 * a token whose row did not move — a lost compare-and-set, a cancelled event, a move capped away —
 * keeps its instant.
 *
 * **No overbooking, ever, and the job seats nobody.** A move revives a deadline that passed while the
 * door was shut — and an offer, a reservation, a held place or an invitation occupies its place again
 * only once its deadline is ahead. The place may have been given meanwhile: every read treats a lapsed
 * claim as free (§10.6), and the name may have answered a visitor before this run. So under the same
 * lock, after the moves of what never lapsed, each revived claim is moved alone and the event's places
 * counted again (`countOccupied`, the allocator's own count); a claim that would take the count past
 * the capacity is not revived: its deadline is put back as it was, the run's own sweep lapses it as it
 * would have lapsed, and the window names it to the Administrators (`not_revived`). Neither house
 * mechanism that seats a person beyond the counted places is the job's to use: a supplementary place
 * needs an Administrator's confirmed press (§642), and a row that consumes no place an Administrator's
 * verb while the event's own switch is on (§643, §648) — a job has neither a person to confirm nor a
 * switch to honour. The Administrator presses, if anybody does.
 *
 * **Idempotent and resumable.** A step remembers its links (`links_moved_at`) and the events it
 * finished (`events_moved`); a retried run finishes the same step by the same amount before another
 * starts. The window row is locked inside each of those transactions, so two runs at once serialize
 * on it.
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
  /** The remembered pings since the anchor, by job, or null when the cache cannot say; the cache by default. */
  readPings?: (anchor: { job: "registration-maintenance"; at: Date }, now: Date) => Promise<Partial<Record<JobName, Date[]>> | null>;
  /** Where the probe's answer is kept for `/devs`, which never asks the name itself; the cache by default. */
  recordReading?: (reading: NameReadingSlot) => Promise<void>;
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
  /** Claims this run did not revive: their counted place had been given meanwhile. */
  notRevived: number;
  /** Administrators' emails queued this run. */
  noticesQueued: number;
  /** Windows whose moves failed this run. */
  failures: number;
  /** Of them, those the next ping may still repair (open, or closed less than `PENDING_HOLD_MS` ago); the rest are «Sarcini»'s. */
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
  // The answer, kept beside the run's ping for `/devs` (§NNN): the page shows it and asks nobody.
  await (deps.recordReading ?? recordNameReading)({ at: now.toISOString(), status: probe.status, host: probe.host }).catch(() => undefined);

  // The silences of the pings since the last real run, when the deployment has a pinger and the cache remembers — whatever the cap: 0 switches the moving off, never the seeing.
  const gaps =
    (deps.pinger ?? hasPinger(env.APP_ENV))
      ? await pingSilences(db, now, maxMs, deps.readPings ?? readPingHistory, deps.dayCadence ?? env.PINGER_CADENCE_MINUTES)
      : [];

  const since = new Date(Math.min(now.getTime() - lookbackMs(maxMs), ...gaps.map((gap) => gap.startedAt.getTime())));
  const known: (KnownWindow & { grantedMs: number })[] = await db
    .select({
      id: unreachableWindows.id,
      source: unreachableWindows.source,
      startedAt: unreachableWindows.startedAt,
      endedAt: unreachableWindows.endedAt,
      confirmedAt: unreachableWindows.confirmedAt,
      grantedMs: unreachableWindows.grantedMs,
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
    // What it gives back is decided now, from its whole length within the cap — never less than it already gave while open.
    const grantedMs = open ? grownGrant(open, plan.close.endedAt, maxMs) : 0;
    await db
      .update(unreachableWindows)
      .set({ endedAt: plan.close.endedAt, grantedMs: sql`greatest(${unreachableWindows.grantedMs}, ${grantedMs})`, appliedAt: null, updatedAt: now })
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
  const [openWindow] = await db
    .select()
    .from(unreachableWindows)
    .where(and(isNull(unreachableWindows.endedAt), isNotNull(unreachableWindows.confirmedAt)))
    .limit(1);
  if (openWindow) {
    // The Administrators are told a `dns` window opened, once — a suspicion tells nobody.
    if (openWindow.openedAnnouncedAt === null) noticesQueued += await tellTheAdministrators(db, openWindow, "UNREACHABLE_WINDOW_OPENED", now, maxMs);
    /*
      Still open: the time since the last run is given back now, within the cap, so the step below
      moves every running deadline past this run — nothing reads as lapsed, no place is freed, while
      nobody can reach the page that would act on it (the sweeps are held as well, belt and braces).
    */
    const grown = grownGrant(openWindow, now, maxMs);
    if (grown - openWindow.grantedMs >= OUTAGE_MIN_MS) {
      await db
        .update(unreachableWindows)
        .set({ grantedMs: sql`greatest(${unreachableWindows.grantedMs}, ${grown})`, appliedAt: null, updatedAt: now })
        .where(and(eq(unreachableWindows.id, openWindow.id), isNull(unreachableWindows.endedAt)));
    }
  }

  // Every window with something left to move (or, over, to announce), oldest first.
  const pending = await db
    .select()
    .from(unreachableWindows)
    .where(and(isNotNull(unreachableWindows.confirmedAt), isNull(unreachableWindows.appliedAt)))
    .orderBy(asc(unreachableWindows.startedAt));
  let moved = 0;
  let notRevived = 0;
  let failures = 0;
  let retryableFailures = 0;
  let holdingForFailure = false;
  for (const window of pending) {
    try {
      const result = await moveTheDeadlines(db, window, now, settings);
      moved += result.moved;
      notRevived += result.notRevived;
      const [done] = await db.select().from(unreachableWindows).where(eq(unreachableWindows.id, window.id)).limit(1);
      if (done && done.endedAt && done.appliedAt && done.closedAnnouncedAt === null) {
        noticesQueued += await tellTheAdministrators(db, done, "UNREACHABLE_WINDOW_CLOSED", now, maxMs);
      }
    } catch (error) {
      console.error("[outage-grace] the deadlines of a window could not be moved", window.id, error instanceof Error ? error.name : "error");
      failures += 1;
      // Until it is moved, nothing it was meant to save may lapse — for a while (`PENDING_HOLD_MS`); then «Sarcini» says so.
      if (!window.endedAt || now.getTime() - window.endedAt.getTime() < PENDING_HOLD_MS) {
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
    notRevived,
    noticesQueued,
    failures,
    retryableFailures,
  };
}

/**
 * The silences since the last real run of this job (`findPingGaps`). The anchor is that run — a real
 * run writes its own ping slot, so a cache that cannot show it remembers nothing worth reading — and
 * the evidence is, by job, every remembered ping since and every real run since (a run is a call that
 * arrived, whoever made it), the maintenance's anchor and this run among its own.
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
    .select({ jobName: jobRuns.jobName, startedAt: jobRuns.startedAt })
    .from(jobRuns)
    .where(and(gt(jobRuns.startedAt, anchor), lt(jobRuns.startedAt, now)));
  const byJob = JOB_NAMES.map((job) => [
    ...(pings[job] ?? []),
    ...runs.filter((run) => run.jobName === job).map((run) => run.startedAt),
    ...(job === "registration-maintenance" ? [anchor, now] : []),
  ]);
  return findPingGaps(byJob, dayCadence);
}

type Moved = { moved: number; notRevived: number };

/**
 * A window's moves: the step in progress finished, then one step for whatever it gives back beyond
 * what is applied — at most two steps a run. Once nothing is left, `applied_at` says so. With nothing
 * given back (the cap at 0), nothing moves and the window is done.
 */
async function moveTheDeadlines<T extends Record<string, unknown>>(
  db: Database<T>,
  window: UnreachableWindow,
  now: Date,
  settings: Deadlines,
): Promise<Moved> {
  const total: Moved = { moved: 0, notRevived: 0 };
  let current: UnreachableWindow | undefined = window;
  for (let pass = 0; pass < 2 && current; pass += 1) {
    if (current.stepMs === null) {
      if (current.appliedMs >= current.grantedMs) break;
      // A step's amount is fixed when it starts: a retry moves by the same, whatever the window gives back by then.
      const [started]: UnreachableWindow[] = await db
        .update(unreachableWindows)
        .set({ stepMs: current.grantedMs, linksMovedAt: null, eventsMoved: [], updatedAt: now })
        .where(and(eq(unreachableWindows.id, current.id), isNull(unreachableWindows.stepMs), eq(unreachableWindows.appliedMs, current.appliedMs)))
        .returning();
      if (!started) break;
      current = started;
    }
    const step = current.stepMs as number;
    const amount = step - current.appliedMs;
    if (amount >= OUTAGE_MIN_MS) {
      const since = new Date(current.startedAt.getTime() + current.appliedMs);
      if (current.linksMovedAt === null) total.moved += await moveTheLinks(db, current, step, since, amount, now, settings);
      const done = new Set(current.eventsMoved);
      for (const eventId of await eventsToMove(db, since)) {
        if (done.has(eventId)) continue;
        const result = await moveOneEvent(db, current, step, eventId, since, amount, now);
        total.moved += result.moved;
        total.notRevived += result.notRevived;
      }
    }
    [current] = await db
      .update(unreachableWindows)
      .set({ appliedMs: step, stepMs: null, linksMovedAt: null, eventsMoved: [], updatedAt: now })
      .where(and(eq(unreachableWindows.id, current.id), eq(unreachableWindows.stepMs, step)))
      .returning();
  }
  await db
    .update(unreachableWindows)
    .set({ appliedAt: now, updatedAt: now })
    .where(
      and(
        eq(unreachableWindows.id, window.id),
        isNull(unreachableWindows.stepMs),
        sql`${unreachableWindows.appliedMs} = ${unreachableWindows.grantedMs}`,
      ),
    );
  return total;
}

/** The window's row, locked in the caller's transaction: two runs at once wait on each other here. */
async function lockWindow<T extends Record<string, unknown>>(tx: Transaction<T>, id: string): Promise<UnreachableWindow | undefined> {
  const [row] = await tx.select().from(unreachableWindows).where(eq(unreachableWindows.id, id)).for("update");
  return row;
}

/** The deadlines a transaction moved, each counted once per window however many steps moved it. */
function countedKeys(locked: UnreachableWindow, keys: readonly string[]) {
  const all = [...new Set([...locked.movedKeys, ...keys])];
  return { movedKeys: all, rowsMoved: all.length };
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
  step: number,
  since: Date,
  amount: number,
  now: Date,
  settings: Deadlines,
): Promise<number> {
  return db.transaction(async (tx) => {
    const locked = await lockWindow(tx, window.id);
    if (!locked || locked.stepMs !== step || locked.linksMovedAt !== null) return 0;
    const keys: string[] = [];

    // The address links still waiting for a click — a row written before the column (null) by its lapse, materialised by the move.
    const lapse = emailLinkLapseSql(settings.confirmationHours);
    const waiting = await tx
      .select({ id: registrations.id, participantId: registrations.participantId, written: registrations.emailLinkExpiresAt, lapse })
      .from(registrations)
      .where(and(eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"), sql`${lapse} > ${since.toISOString()}::timestamptz`));
    for (const row of waiting) {
      const stored = new Date(row.lapse);
      const to = movedDeadline({ stored, since, grantedMs: amount, now });
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
      keys.push(`r:${row.id}:link`);
      const verify = and(eq(emailActionTokens.purpose, "VERIFY_REGISTRATION_EMAIL"), eq(emailActionTokens.registrationId, row.id)) as SQL;
      if (row.written) {
        await moveTokenWith(tx, verify, stored, to);
      } else {
        /*
          A row written before the column: its deadline was the submission plus the club's hours, its
          token's the send plus the same — never the same instant. Every live token of it still running
          at `since` moves by the same amount, so the button keeps opening what the move kept.
        */
        await tx
          .update(emailActionTokens)
          .set({ expiresAt: sql`${emailActionTokens.expiresAt} + make_interval(secs => ${amount / 1000})` })
          .where(
            and(
              verify,
              isNull(emailActionTokens.usedAt),
              isNull(emailActionTokens.invalidatedAt),
              gt(emailActionTokens.expiresAt, since),
            ),
          );
      }
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
      .where(gt(pendingFamilyEntries.expiresAt, since))) {
      const to = movedDeadline({ stored: entry.expiresAt, since, grantedMs: amount, now });
      if (!to) continue;
      const written = await tx
        .update(pendingFamilyEntries)
        .set({ expiresAt: to })
        .where(and(eq(pendingFamilyEntries.id, entry.id), eq(pendingFamilyEntries.expiresAt, entry.expiresAt)))
        .returning({ id: pendingFamilyEntries.id });
      if (written.length === 0) continue;
      keys.push(`f:${entry.id}`);
      if (entry.tokenId) await moveTokenWith(tx, eq(emailActionTokens.id, entry.tokenId), entry.expiresAt, to);
    }
    for (const sitting of await tx
      .select({ id: familySittings.id, expiresAt: familySittings.expiresAt, tokenId: familySittings.actionTokenId })
      .from(familySittings)
      .where(and(gt(familySittings.expiresAt, since), isNull(familySittings.confirmedAt), isNull(familySittings.releasedAt)))) {
      const to = movedDeadline({ stored: sitting.expiresAt, since, grantedMs: amount, now });
      if (!to) continue;
      const written = await tx
        .update(familySittings)
        .set({ expiresAt: to })
        .where(and(eq(familySittings.id, sitting.id), eq(familySittings.expiresAt, sitting.expiresAt)))
        .returning({ id: familySittings.id });
      if (written.length === 0) continue;
      keys.push(`s:${sitting.id}`);
      if (sitting.tokenId) await moveTokenWith(tx, eq(emailActionTokens.id, sitting.tokenId), sitting.expiresAt, to);
    }

    await tx
      .update(unreachableWindows)
      .set({ linksMovedAt: now, ...countedKeys(locked, keys), updatedAt: now })
      .where(eq(unreachableWindows.id, window.id));
    return keys.length;
  });
}

/** The scheduled events, not started at `since`, with a hold, an offer, a reservation, a held place or an invitation running then. */
async function eventsToMove<T extends Record<string, unknown>>(db: Database<T>, since: Date): Promise<string[]> {
  const live = and(sql`${events.eventStatus} = 'SCHEDULED'`, gt(events.startsAt, since));
  const held = await db
    .selectDistinct({ eventId: registrations.eventId })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(
        live,
        inArray(registrations.status, ["PENDING_DECLARATION", "WAITLIST_OFFERED", "PENDING_EMAIL_CONFIRMATION"]),
        gt(registrations.holdExpiresAt, since),
      ),
    );
  const places = await db
    .selectDistinct({ eventId: familyPlaceHolds.eventId })
    .from(familyPlaceHolds)
    .innerJoin(events, eq(events.id, familyPlaceHolds.eventId))
    .where(and(live, gt(familyPlaceHolds.expiresAt, since)));
  const invited = await db
    .selectDistinct({ eventId: eventInvitations.eventId })
    .from(eventInvitations)
    .innerJoin(events, eq(events.id, eventInvitations.eventId))
    .where(and(live, invitationOpen(), gt(eventInvitations.expiresAt, since)));
  return [...new Set([...held, ...places, ...invited].map((row) => row.eventId))];
}

type RegistrationStatusMoved = "PENDING_DECLARATION" | "WAITLIST_OFFERED" | "PENDING_EMAIL_CONFIRMATION";

type Claim =
  | { kind: "registration"; id: string; participantId: string; status: RegistrationStatusMoved; stored: Date; to: Date; updatedAt: Date }
  | { kind: "placeHold"; id: string; stored: Date; to: Date; holdsPlace: boolean }
  | { kind: "invitation"; id: string; stored: Date; to: Date };

const REGISTRATION_DEADLINE_KIND: Record<RegistrationStatusMoved, string> = {
  PENDING_DECLARATION: "declarationHold",
  WAITLIST_OFFERED: "offer",
  PENDING_EMAIL_CONFIRMATION: "familyReservation",
};

const keyOf = (claim: Claim) => (claim.kind === "registration" ? `r:${claim.id}:hold` : claim.kind === "invitation" ? `i:${claim.id}` : `p:${claim.id}`);

/** One event's holds, offers, reservations, held places and invitations, under its lock. */
async function moveOneEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  window: UnreachableWindow,
  step: number,
  eventId: string,
  since: Date,
  amount: number,
  now: Date,
): Promise<Moved> {
  const windowId = window.id;
  return db.transaction(async (tx) => {
    const event = await lockEventForCapacity(tx, eventId);
    const locked = await lockWindow(tx, windowId);
    if (!locked || locked.stepMs !== step || locked.eventsMoved.includes(eventId)) return { moved: 0, notRevived: 0 };
    const keys: string[] = [];
    const left: NotRevivedClaim[] = [];
    const finish = async () => {
      const notRevived = [...locked.notRevived, ...left.filter((claim) => !locked.notRevived.some((known) => known.kind === claim.kind && known.id === claim.id))];
      await tx
        .update(unreachableWindows)
        .set({
          eventsMoved: sql`${unreachableWindows.eventsMoved} || ${JSON.stringify([eventId])}::jsonb`,
          ...countedKeys(locked, keys),
          notRevived,
          claimsNotRevived: notRevived.length,
          updatedAt: now,
        })
        .where(eq(unreachableWindows.id, windowId));
      return { moved: keys.length, notRevived: left.length };
    };
    // A cancelled event stays as it was cancelled (§331), a completed one as it finished (§82).
    if (!event || event.eventStatus !== "SCHEDULED") return finish();
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
        updatedAt: registrations.updatedAt,
      })
      .from(registrations)
      .where(
        and(
          eq(registrations.eventId, eventId),
          inArray(registrations.status, ["PENDING_DECLARATION", "WAITLIST_OFFERED", "PENDING_EMAIL_CONFIRMATION"]),
          gt(registrations.holdExpiresAt, since),
        ),
      )) {
      if (!row.holdExpiresAt) continue;
      const to = movedDeadline({ stored: row.holdExpiresAt, since, grantedMs: amount, now, cap: holdCap });
      if (to) {
        claims.push({
          kind: "registration",
          id: row.id,
          participantId: row.participantId,
          status: row.status as RegistrationStatusMoved,
          stored: row.holdExpiresAt,
          to,
          updatedAt: row.updatedAt,
        });
      }
    }
    for (const row of await tx
      .select({ id: familyPlaceHolds.id, expiresAt: familyPlaceHolds.expiresAt, holdsPlace: familyPlaceHolds.holdsPlace })
      .from(familyPlaceHolds)
      .where(and(eq(familyPlaceHolds.eventId, eventId), gt(familyPlaceHolds.expiresAt, since)))) {
      const to = movedDeadline({ stored: row.expiresAt, since, grantedMs: amount, now, cap: holdCap });
      if (to) claims.push({ kind: "placeHold", id: row.id, stored: row.expiresAt, to, holdsPlace: row.holdsPlace });
    }
    for (const row of await tx
      .select({ id: eventInvitations.id, expiresAt: eventInvitations.expiresAt })
      .from(eventInvitations)
      .where(and(eq(eventInvitations.eventId, eventId), invitationOpen(), gt(eventInvitations.expiresAt, since)))) {
      const to = movedDeadline({ stored: row.expiresAt, since, grantedMs: amount, now, cap: invitationCap });
      if (to) claims.push({ kind: "invitation", id: row.id, stored: row.expiresAt, to });
    }

    /*
      A claim that comes back to a counted place: past its deadline now, so counted nowhere, and once
      moved counted again. A declaration hold is counted by its state whatever its deadline (§160), and
      a held place sent while none was free holds none: neither changes a count.
    */
    const revives = (claim: Claim) =>
      claim.stored.getTime() <= now.getTime() &&
      (claim.kind === "placeHold" ? claim.holdsPlace : claim.kind === "invitation" || claim.status !== "PENDING_DECLARATION");

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
    const moved = async (claim: Claim) => {
      keys.push(keyOf(claim));
      await moveToken(claim);
      if (claim.kind === "registration") {
        await recordAuditEvent(tx, {
          actorStaffUserId: null,
          participantId: claim.participantId,
          action: "registration.deadline_moved_for_outage",
          entityType: "registration",
          entityId: claim.id,
          metadata: { kind: REGISTRATION_DEADLINE_KIND[claim.status], from: claim.stored.toISOString(), to: claim.to.toISOString(), windowId, source: window.source },
          now,
        });
      } else if (claim.kind === "invitation") {
        await recordAuditEvent(tx, {
          actorStaffUserId: null,
          participantId: null,
          action: "event.invitation_deadline_moved_for_outage",
          entityType: "event",
          entityId: eventId,
          metadata: { invitationId: claim.id, from: claim.stored.toISOString(), to: claim.to.toISOString(), windowId, source: window.source },
          now,
        });
      }
    };
    /*
      Not revived: put back exactly as it was — its deadline, and a registration's `updated_at` — so the
      run's own sweep lapses it as it would have, its token keeps its instant, and the window names it.
    */
    const putBack = async (claim: Claim) => {
      if (claim.kind === "registration") {
        await tx.update(registrations).set({ holdExpiresAt: claim.stored, updatedAt: claim.updatedAt }).where(eq(registrations.id, claim.id));
        await recordAuditEvent(tx, {
          actorStaffUserId: null,
          participantId: claim.participantId,
          action: "registration.not_revived_for_outage",
          entityType: "registration",
          entityId: claim.id,
          metadata: { kind: REGISTRATION_DEADLINE_KIND[claim.status], windowId, deadline: claim.stored.toISOString() },
          now,
        });
      } else if (claim.kind === "placeHold") {
        await tx.update(familyPlaceHolds).set({ expiresAt: claim.stored }).where(eq(familyPlaceHolds.id, claim.id));
      } else {
        await tx.update(eventInvitations).set({ expiresAt: claim.stored }).where(eq(eventInvitations.id, claim.id));
        await recordAuditEvent(tx, {
          actorStaffUserId: null,
          participantId: null,
          action: "event.invitation_not_revived_for_outage",
          entityType: "event",
          entityId: eventId,
          metadata: { invitationId: claim.id, windowId, deadline: claim.stored.toISOString() },
          now,
        });
      }
      left.push({ kind: claim.kind === "registration" ? (claim.status === "WAITLIST_OFFERED" ? "offer" : "familyReservation") : claim.kind, id: claim.id, eventId });
    };

    // First what never lapsed, or changes no count: moving it later takes no place from anybody.
    for (const claim of claims.filter((item) => !revives(item))) {
      if (await write(claim, claim.to)) await moved(claim);
    }

    /*
      Then each revived claim alone, oldest deadline first, counted again under the lock. The lock is the
      allocator's own (§10.6): every path that gives a place takes it first, so between this count and
      this write no other transaction can give the place this claim takes back. A claim that would take
      the count past the capacity is put back and lapses: the job seats nobody beyond the counted places.
    */
    const counted = async () => computeOccupied(await countOccupied(tx, eventId, now));
    let before = event.capacity === null ? 0 : await counted();
    for (const claim of claims.filter(revives).sort((a, b) => a.stored.getTime() - b.stored.getTime())) {
      if (!(await write(claim, claim.to))) continue;
      if (event.capacity === null) {
        await moved(claim);
        continue;
      }
      const after = await counted();
      if (after <= event.capacity || after <= before) {
        before = after;
        await moved(claim);
        continue;
      }
      await putBack(claim);
    }
    return finish();
  });
}

/**
 * One email per Administrator and Superadministrator with an address, in their own language, once per
 * window and message (its idempotency key, `unreachable:<window>:opened|closed:<staff id>`), and the
 * window remembers it was sent. On the club's road: when the club's own domain is what is gone,
 * Mailgun's sending subdomain may be gone with it. The claims not revived travel as ids: the email
 * names each person and event at its send, for the staff alone (`render.ts`).
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
          notRevived: locked.claimsNotRevived,
          claims: opened ? [] : locked.notRevived,
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
