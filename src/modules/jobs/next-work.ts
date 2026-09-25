import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { registrationInterests } from "@/db/schema/registration-interests";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { PROCESSING_LOCK_TIMEOUT_MS } from "@/modules/notifications/domain/retry";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import { declarationLastCallDueAt, eventReminderDueAt } from "@/modules/notifications/domain/automatic-sends";
import { confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";
import { PLACE_HOLDING_STATUSES } from "@/modules/registrations/domain/state-machine";
import { emailLinkLapseSql } from "@/modules/registrations/repository";
import type { JobName } from "./schedule";

/**
 * The earliest instant each job will next have something to do, read from the database by the
 * run that has it awake (§334) — the other half of `schedule.ts`.
 *
 * Each duty below mirrors the query of the job that performs it, and names it. A duty missing
 * here is not a wrong answer, it is a late one: the cap in `planQuiet` looks for real within the
 * hour whatever this says. The sweeps measured in days — the retention windows (`retention.ts`,
 * `DECISIONS.md` §45, §95), the orphaned pictures (§73), the standing series to the club's series horizon (§377)
 * (§122) — are left to the cap on purpose: an hour late on a seven-day window is nothing, and a
 * query to say so would be one more thing to keep in step.
 */

type AnyDb = Database<Record<string, unknown>>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A nullable integer column as the driver hands it back: a number, a numeric string, or null. */
function toCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}

function earliest(instants: (Date | null)[]): Date | null {
  let best: Date | null = null;
  for (const instant of instants) if (instant && (!best || instant.getTime() < best.getTime())) best = instant;
  return best;
}

/**
 * Registration maintenance: strictly after `now`, the run's own instant.
 *
 * Only what is still ahead. Whatever was due at or before `now` is what the run that calls this
 * has just done; a run that could not finish says so (`failed` in `planQuiet`) and promises no
 * quiet at all. Looking only forward is also what keeps a row the job leaves alone by design — a
 * lapsed declaration hold nobody waits for (§160), a reminder already sent — from reading as
 * "due" on every run and keeping the database awake for nothing.
 */
export async function nextMaintenanceWork<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<Date | null> {
  const any = db as unknown as AnyDb;
  const nowIso = now.toISOString();
  /*
    The club's deadlines (§377): the ones the run that calls this has just read fresh at its start
    (`readDeadlinesForRun`), from the memo — the plan and the work agree on one value, and the
    setting costs no second query in the run.
  */
  const settings = await currentDeadlines(db);

  // `expireStalePendingEmailConfirmations`: the link lapses when the row says (§377), or the club's
  // hours after the submission for a row older than the column — the sweep's own expression.
  const lapse = emailLinkLapseSql(settings.confirmationHours);
  const [pendingEmail] = await any
    .select({ next: sql<unknown>`min(${lapse})` })
    .from(registrations)
    .where(and(eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"), sql`${lapse} > ${nowIso}::timestamptz`));
  const emailLapses = toDate(pendingEmail?.next);

  /*
    `expireStaleHolds`: an offer at its deadline, a declaration hold at its own. Every hold ahead,
    whether or not anybody waits yet — somebody who joins the queue later is a write path that
    wakes the job itself, and a deadline that passes with nobody waiting costs one short run.

    Scheduled events only, as the job itself (`findEventsNeedingMaintenance`): a cancelled event's
    queue is left as it stood (§331, event notices), holds and all, so its deadlines are no work of
    the job's, and waking the database at each of them would be a real run that does nothing
    (§334, jobs sleep when nothing is due). An event put back on is a save, and the save wakes the
    job itself.
  */
  const [holds] = await any
    .select({ next: sql<unknown>`min(${registrations.holdExpiresAt})` })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(
        inArray(registrations.status, ["WAITLIST_OFFERED", "PENDING_DECLARATION"]),
        eq(events.eventStatus, "SCHEDULED"),
        gt(registrations.holdExpiresAt, now),
      ),
    );

  /*
    The instants of each event still ahead that has anybody on it: its start (holds end, the
    waiting list closes — `closeWaitlistForStartedEvent`), its registration close (the numbers
    settle, §214), the reminder lead before the start — the event's own or the club's, none when
    it is zero (the reminders, §81, and the last call to sign, §160; §377) — and the participation
    window's opening (the confirmation asked again, §104).
  */
  const perEvent = await any
    .select({
      eventStatus: events.eventStatus,
      registrationMode: events.registrationMode,
      startsAt: events.startsAt,
      registrationClosesAt: events.registrationClosesAt,
      bibsSettledAt: events.bibsSettledAt,
      opensDays: events.confirmationOpensDaysBefore,
      deadlineDays: events.confirmationDeadlineDaysBefore,
      reminderHoursBefore: events.reminderHoursBefore,
      waitingOrPending: sql<boolean>`bool_or(${registrations.status} in ('PENDING_DECLARATION', 'WAITLISTED'))`,
      pendingDeclaration: sql<boolean>`bool_or(${registrations.status} = 'PENDING_DECLARATION')`,
      confirmed: sql<boolean>`bool_or(${registrations.status} = 'CONFIRMED')`,
      holdingPlace: sql<boolean>`bool_or(${inArray(registrations.status, [...PLACE_HOLDING_STATUSES])})`,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(
        // Scheduled only, for the reason above (§331): a cancelled race closes no list, settles
        // no number and reminds nobody.
        eq(events.eventStatus, "SCHEDULED"),
        inArray(registrations.status, [...PLACE_HOLDING_STATUSES, "WAITLISTED"]),
        or(gt(events.startsAt, now), gt(events.registrationClosesAt, now)),
      ),
    )
    .groupBy(
      events.id,
      events.eventStatus,
      events.registrationMode,
      events.startsAt,
      events.registrationClosesAt,
      events.bibsSettledAt,
      events.confirmationOpensDaysBefore,
      events.confirmationDeadlineDaysBefore,
      events.reminderHoursBefore,
    );

  const eventInstants: (Date | null)[] = [];
  const ahead = (at: number) => (at > now.getTime() ? new Date(at) : null);
  for (const event of perEvent) {
    const startsAt = toDate(event.startsAt);
    if (!startsAt) continue;
    const start = startsAt.getTime();
    if (event.waitingOrPending) eventInstants.push(ahead(start));
    if (event.holdingPlace && event.bibsSettledAt === null) {
      eventInstants.push(ahead((toDate(event.registrationClosesAt) ?? startsAt).getTime()));
    }
    const mailed = event.eventStatus === "SCHEDULED" && event.registrationMode === "INTERNAL";
    // The reminder's lead is the last call's too (`domain/automatic-sends.ts`, one formula with the job, §383).
    const reminderAt = declarationLastCallDueAt({ startsAt, reminderHoursBefore: toCount(event.reminderHoursBefore) }, settings);
    if (mailed && reminderAt && (event.confirmed || event.pendingDeclaration)) {
      eventInstants.push(ahead(reminderAt.getTime()));
    }
    const window = confirmationWindow({
      startsAt,
      confirmationOpensDaysBefore: toCount(event.opensDays),
      confirmationDeadlineDaysBefore: toCount(event.deadlineDays),
    });
    if (mailed && event.pendingDeclaration && window) {
      eventInstants.push(ahead(window.opensAt.getTime()));
    }
  }

  /*
    `queueEventReminders` skips somebody confirmed in the last day (§126) and reminds them once
    that day has passed, if the start is still ahead: the one reminder whose instant belongs to
    the registration rather than to the event.
  */
  const recentlyConfirmed = await any
    .select({ confirmedAt: registrations.confirmedAt, startsAt: events.startsAt, reminderHoursBefore: events.reminderHoursBefore })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(
        eq(registrations.status, "CONFIRMED"),
        eq(events.eventStatus, "SCHEDULED"),
        eq(events.registrationMode, "INTERNAL"),
        gt(events.startsAt, now),
        gt(registrations.confirmedAt, new Date(now.getTime() - DAY)),
      ),
    );
  const lateReminders = recentlyConfirmed.map((row) => {
    const confirmedAt = toDate(row.confirmedAt);
    const startsAt = toDate(row.startsAt);
    if (!confirmedAt || !startsAt) return null;
    // The job's own formula (`eventReminderDueAt`): none for an event that sends none (§377).
    const at = eventReminderDueAt({ startsAt, confirmedAt, reminderHoursBefore: toCount(row.reminderHoursBefore) }, settings);
    return at && at.getTime() > now.getTime() ? at : null;
  });

  /*
    `queueRegistrationOpenedMessages` (§146): the addresses left on an event's page are written
    to when its registration opens, and dropped when it can no longer open.
  */
  const interested = await any
    .selectDistinct({
      registrationOpensAt: events.registrationOpensAt,
      publishedAt: events.publishedAt,
      registrationClosesAt: events.registrationClosesAt,
      startsAt: events.startsAt,
    })
    .from(registrationInterests)
    .innerJoin(events, eq(events.id, registrationInterests.eventId))
    .where(sql`coalesce(${events.registrationClosesAt}, ${events.startsAt}) > ${nowIso}::timestamptz`);
  const interestInstants = interested.flatMap((event) => {
    const opensAt = toDate(event.registrationOpensAt) ?? toDate(event.publishedAt);
    const closesAt = toDate(event.registrationClosesAt) ?? toDate(event.startsAt);
    return [opensAt && opensAt > now ? opensAt : null, closesAt && closesAt > now ? closesAt : null];
  });

  return earliest([emailLapses, toDate(holds?.next), ...eventInstants, ...lateReminders, ...interestInstants]);
}

/**
 * The outbox: the soonest row it may claim, *including* the ones already claimable. Unlike the
 * maintenance job, the outbox leaves work behind by design — twenty rows a batch
 * (`processOutboxBatch`) — so a row whose turn has come is due now, and the next ping runs.
 */
export async function nextOutboxWork<T extends Record<string, unknown>>(db: Database<T>): Promise<Date | null> {
  const any = db as unknown as AnyDb;
  const [pending] = await any
    .select({ next: sql<unknown>`min(coalesce(${emailOutbox.nextAttemptAt}, ${emailOutbox.createdAt}))` })
    .from(emailOutbox)
    .where(eq(emailOutbox.status, "PENDING"));
  // A claimed row whose worker died is taken back once its lock is older than the timeout.
  const [claimed] = await any
    .select({ oldest: sql<unknown>`min(${emailOutbox.lockedAt})` })
    .from(emailOutbox)
    .where(eq(emailOutbox.status, "PROCESSING"));
  const lockedAt = toDate(claimed?.oldest);
  return earliest([toDate(pending?.next), lockedAt ? new Date(lockedAt.getTime() + PROCESSING_LOCK_TIMEOUT_MS) : null]);
}

export function nextWork<T extends Record<string, unknown>>(db: Database<T>, job: JobName, now: Date): Promise<Date | null> {
  return job === "email-outbox" ? nextOutboxWork(db) : nextMaintenanceWork(db, now);
}
