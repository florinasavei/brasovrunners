import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { emailOutbox, type EmailMessageType } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { newsletterSends } from "@/db/schema/newsletter";
import { registrationInterests } from "@/db/schema/registration-interests";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { readNewsletterWords } from "@/modules/newsletter/domain/message";
import { awaitingSettledNumber } from "@/modules/registrations/bibs";
import {
  AUTOMATIC_SEND_KEYS,
  bibsSettleAt,
  declarationLastCallDueAt,
  eventReminderDueAt,
  isDeclarationLastCallDue,
  isEventReminderDue,
  nextInLineOffers,
  nextInLineReleases,
  participationConfirmationDueAt,
  registrationOpenedDueAt,
} from "./domain/automatic-sends";
import { BULK_MESSAGE_TYPES } from "./domain/bulk";
import { CLUB_COPY_FLAG } from "./domain/club-notices";
import { selectDeclarationCandidates, selectReminderCandidates } from "./event-mail";

/**
 * "Următoarele emailuri automate" on `/admin/emails` (§383; the owner, 2026-09-24: "I need to know
 * each time a participant will be emailed!").
 *
 * The outbox panel shows what *was* queued and sent; this is the forward view: every message the
 * platform will send a participant **on its own** in the coming days, event by event, with the
 * moment it becomes due and how many people it would reach if it were due now.
 *
 * **One formula.** Each send is decided by the function the maintenance job itself asks
 * (`domain/automatic-sends.ts`), over the candidates the job itself selects (`event-mail.ts`,
 * `bibs.ts#awaitingSettledNumber`) — evaluated at the future instant instead of at `now`. A
 * registration whose key is already in the outbox is left out, as `enqueueEmail` would leave it.
 *
 * **What is listed:** the reminder before the start (the event's own lead or the club's, §377 —
 * nothing for an event that sends none), the participation confirmation when the window opens
 * (§104), the last call to sign at the reminder's lead (§160), the offer to the next in line when
 * a waiting-list offer or a declaration hold lapses with somebody waiting, before registration
 * closes (§160, AGENTS.md §10.5, §420),
 * "here is your race number" when registration closes (§214), and "registration is open" to the
 * addresses left on the event's page (§146).
 *
 * **And what already waits for the subscribers** (§NNN): a newsletter or a new-event alert that
 * is queued and not yet sent — the reserve (`domain/bulk.ts`) may hold it until the allowance
 * comes back, a day or a month — one line per send and release instant, with how many subscribers
 * it goes to. Listed whatever the horizon: it is in the outbox already, and a month's wait is
 * exactly what the club needs to see.
 *
 * **What is not:** anything a person triggers — the organizer's message, the update notice, the
 * cancellation and the thank-you, which is sent by an Administrator (§82, never automatic) — and
 * the answers to a runner's own click (the link, the confirmation, "you are on the list"): those
 * go the moment the click happens and cannot be foreseen. Nor the chain after a lapse: whether the
 * next person offered a place signs is not something a forecast knows.
 *
 * **Test registrations** are sent to exactly like real ones (§12.6), so the job's count includes
 * them; the club's count does not (§30), so they are counted apart and labelled on the screen.
 *
 * Reads only, on the page's own request; no job, no cache (§334: nothing here wakes the database).
 */

export type AutomaticSend =
  | "reminder"
  | "lastCall"
  | "participation"
  | "nextInLine"
  | "bibs"
  | "registrationOpened"
  // The subscribers' sends, already queued (§NNN).
  | "newsletter"
  | "newEventAlert";

export type ForecastRow = {
  /** When the job will send it: the instant it becomes due (its next run after that), never before `now`. */
  at: Date;
  /** Already due and not yet queued: it goes at the job's next run. */
  overdue: boolean;
  /** The event it is about; null for a newsletter, which is about none. */
  eventId: string | null;
  /** The event's title in each language it has; null for a language without a translation. */
  eventTitle: { ro: string | null; en: string | null };
  /** The event's own zone, in which the moment is read (§349). */
  zone: string;
  type: EmailMessageType;
  send: AutomaticSend;
  /** How many real runners (or, for "registration is open", addresses) it reaches as things stand now. */
  recipients: number;
  /** And how many test registrations besides (§12.6, §30): sent to, never counted with the real ones. */
  testRecipients: number;
  /** The registrations it would go to, real and test, when it goes to registrations. */
  registrationIds: string[];
  /** A subscribers' send (§NNN): its id, a newsletter's subject, and whether the reserve holds it until `at`. */
  sendId?: string;
  subject?: { ro: string; en: string } | null;
  held?: boolean;
};

export const FORECAST_HORIZON_DAYS = 14;

const DAY = 24 * 60 * 60_000;

const TYPE_OF: Record<AutomaticSend, EmailMessageType> = {
  reminder: "EVENT_REMINDER",
  lastCall: "COMPLETE_DECLARATION",
  participation: "COMPLETE_DECLARATION",
  nextInLine: "WAITLIST_SPOT_OFFER",
  bibs: "BIB_ASSIGNED",
  registrationOpened: "REGISTRATION_OPENED",
  newsletter: "NEWSLETTER",
  newEventAlert: "NEW_EVENT_ALERT",
};

/** The order of sends due at one instant: the order a run of the job queues them in — the subscribers' last (`domain/bulk.ts`). */
const RUN_ORDER: AutomaticSend[] = [
  "nextInLine",
  "bibs",
  "reminder",
  "lastCall",
  "participation",
  "registrationOpened",
  "newEventAlert",
  "newsletter",
];

type Kind = "REAL" | "TEST";
type Due = { at: Date; eventId: string; send: AutomaticSend; registrationId?: string; kind?: Kind; count?: number };

export async function forecastAutomaticEmails<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { now: Date; horizonDays?: number; deadlines: Pick<Deadlines, "reminderHours"> },
): Promise<ForecastRow[]> {
  const { now, deadlines } = input;
  const until = new Date(now.getTime() + (input.horizonDays ?? FORECAST_HORIZON_DAYS) * DAY);
  const inHorizon = (at: Date | null): at is Date => at !== null && at.getTime() <= until.getTime();
  /** A due instant in the past is the job's next run: now. */
  const notBeforeNow = (at: Date) => (at.getTime() < now.getTime() ? now : at);

  const keyed: Due[] = [];

  // The reminder (§81, §126, §377).
  for (const row of await selectReminderCandidates(db, { from: now, until })) {
    const natural = eventReminderDueAt(row, deadlines);
    if (!natural) continue;
    const at = notBeforeNow(natural);
    if (inHorizon(at) && isEventReminderDue(row, at, deadlines)) {
      keyed.push({ at, eventId: row.eventId, send: "reminder", registrationId: row.registrationId, kind: row.kind });
    }
  }

  // The offer to the next in line (§160, AGENTS.md §10.5): a hold lapses while somebody waits.
  // Computed *before* the declaration emails below, because a declaration hold the maintenance
  // job's `expireStaleHolds` would release to the queue is never owed a last call — it is
  // `EXPIRED` before `queueEventReminders` looks at it (`maintenance.ts`). Without this, a
  // capped event with a waiting list forecasts a sign-reminder the job can never send.
  const holds = await db
    .select({
      eventId: events.id,
      startsAt: events.startsAt,
      registrationClosesAt: events.registrationClosesAt,
      holdExpiresAt: registrations.holdExpiresAt,
      registrationId: registrations.id,
      kind: registrations.kind,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(
        eq(events.eventStatus, "SCHEDULED"),
        isNotNull(events.capacity),
        inArray(registrations.status, ["WAITLIST_OFFERED", "PENDING_DECLARATION"]),
        lte(registrations.holdExpiresAt, until),
      ),
    );
  const nextInLinePending: Due[] = [];
  // A declaration hold consumed by an offer to the next in line: released (`EXPIRED`) at its own
  // lapse instant. It must not also produce a "lastCall" row, but only when that lapse actually
  // comes first — `expireStaleHolds` runs before `queueEventReminders` in one job run (§160), so a
  // lapse at the very same instant as the last call still wins, but a last call *earlier* than the
  // lapse is still sent: the job reaches it first. Keyed by registration id to its lapse instant
  // (`max(holdExpiresAt, now)`, never before the job's next run).
  const consumedByNextInLine = new Map<string, Date>();
  if (holds.length > 0) {
    const eventIds = [...new Set(holds.map((row) => row.eventId))];
    // The line in the allocator's own order (`lockOldestWaitlisted`): who is offered first.
    const line = await db
      .select({ id: registrations.id, eventId: registrations.eventId, kind: registrations.kind })
      .from(registrations)
      .where(and(inArray(registrations.eventId, eventIds), eq(registrations.status, "WAITLISTED")))
      .orderBy(asc(registrations.waitlistedAt), asc(registrations.id));
    for (const eventId of eventIds) {
      const rows = holds
        .filter((row) => row.eventId === eventId)
        .sort((a, b) => (a.holdExpiresAt?.getTime() ?? 0) - (b.holdExpiresAt?.getTime() ?? 0));
      const waiting = line.filter((row) => row.eventId === eventId);
      const lapsing = {
        lapses: rows.flatMap((row) => (row.holdExpiresAt ? [row.holdExpiresAt] : [])),
        waiting: waiting.length,
        startsAt: rows[0].startsAt,
        registrationClosesAt: rows[0].registrationClosesAt,
        now,
      };
      // Every release spends a hold, offer or not: after the close (§420) the job still releases a
      // lapsed hold to the queue — the desk gives that place — but emails nobody an offer for it.
      const consumed = nextInLineReleases(lapsing).reduce((sum, release) => sum + release.count, 0);
      const offers = nextInLineOffers(lapsing);
      for (const row of rows.slice(0, consumed)) {
        if (row.holdExpiresAt) consumedByNextInLine.set(row.registrationId, notBeforeNow(row.holdExpiresAt));
      }
      let next = 0;
      for (const offer of offers) {
        for (const person of waiting.slice(next, next + offer.count)) {
          nextInLinePending.push({ at: offer.at, eventId, send: "nextInLine", registrationId: person.id, kind: person.kind });
        }
        next += offer.count;
      }
    }
  }

  // The two declaration emails: the participation confirmation (§104) and the last call (§160).
  for (const row of await selectDeclarationCandidates(db, { from: now })) {
    const confirmAt = participationConfirmationDueAt(row, now);
    if (inHorizon(confirmAt)) {
      keyed.push({ at: confirmAt, eventId: row.eventId, send: "participation", registrationId: row.registrationId, kind: row.kind });
    }
    const natural = declarationLastCallDueAt(row, deadlines);
    if (natural) {
      const at = notBeforeNow(natural);
      // The lapse wins only when it is at or before the last call's own instant (the job runs
      // `expireStaleHolds` before it ever reaches this registration for a last call); a last call
      // due *before* the lapse is still sent.
      const lapseAt = consumedByNextInLine.get(row.registrationId);
      const releasedFirst = lapseAt !== undefined && lapseAt.getTime() <= at.getTime();
      if (!releasedFirst && inHorizon(at) && isDeclarationLastCallDue(row, at, deadlines)) {
        keyed.push({ at, eventId: row.eventId, send: "lastCall", registrationId: row.registrationId, kind: row.kind });
      }
    }
  }

  // Leave out what is already in the outbox: `enqueueEmail` would insert nothing for it.
  const keyOf = (item: Due): string => {
    const send = item.send as "reminder" | "lastCall" | "participation";
    return AUTOMATIC_SEND_KEYS[send](item.registrationId as string);
  };
  const keys = keyed.map(keyOf);
  const queued = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    const rows = await db
      .select({ key: emailOutbox.idempotencyKey })
      .from(emailOutbox)
      .where(inArray(emailOutbox.idempotencyKey, keys.slice(i, i + 500)));
    for (const row of rows) queued.add(row.key);
  }
  const pending: Due[] = keyed.filter((item) => !queued.has(keyOf(item)));
  pending.push(...nextInLinePending);

  // "Here is your race number" (§214): at the close, to everybody a close numbers — real only.
  const settling = await db
    .select({
      eventId: events.id,
      startsAt: events.startsAt,
      registrationClosesAt: events.registrationClosesAt,
      registrationId: registrations.id,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(
        eq(events.eventStatus, "SCHEDULED"),
        isNull(events.bibsSettledAt),
        sql`coalesce(${events.registrationClosesAt}, ${events.startsAt}) <= ${until.toISOString()}::timestamptz`,
        awaitingSettledNumber(),
      ),
    );
  for (const row of settling) {
    pending.push({ at: notBeforeNow(bibsSettleAt(row)), eventId: row.eventId, send: "bibs", registrationId: row.registrationId, kind: "REAL" });
  }

  // "Registration is open" (§146), to the addresses left on the event's page — no registration yet.
  const interested = await db
    .select({
      eventId: events.id,
      registrationMode: events.registrationMode,
      eventStatus: events.eventStatus,
      editorialStatus: events.editorialStatus,
      startsAt: events.startsAt,
      registrationOpensAt: events.registrationOpensAt,
      registrationClosesAt: events.registrationClosesAt,
      publishedAt: events.publishedAt,
      addresses: sql<number>`count(*)::int`,
    })
    .from(registrationInterests)
    .innerJoin(events, eq(events.id, registrationInterests.eventId))
    .groupBy(
      events.id,
      events.registrationMode,
      events.eventStatus,
      events.editorialStatus,
      events.startsAt,
      events.registrationOpensAt,
      events.registrationClosesAt,
      events.publishedAt,
    );
  for (const row of interested) {
    const at = registrationOpenedDueAt(row, now);
    if (inHorizon(at)) pending.push({ at, eventId: row.eventId, send: "registrationOpened", count: Number(row.addresses) });
  }

  const bulk = await waitingSubscriberSends(db, now);
  if (pending.length === 0 && bulk.length === 0) return [];

  // One row per event, send and instant.
  type Group = { at: Date; eventId: string; send: AutomaticSend; recipients: number; testRecipients: number; registrationIds: string[] };
  const grouped = new Map<string, Group>();
  for (const item of pending) {
    const key = `${item.eventId}|${item.send}|${item.at.getTime()}`;
    const row = grouped.get(key) ?? { at: item.at, eventId: item.eventId, send: item.send, recipients: 0, testRecipients: 0, registrationIds: [] };
    if (item.registrationId) {
      row.registrationIds.push(item.registrationId);
      if (item.kind === "TEST") row.testRecipients += 1;
      else row.recipients += 1;
    } else {
      row.recipients += item.count ?? 0;
    }
    grouped.set(key, row);
  }

  const eventIds = [
    ...new Set([...[...grouped.values()].map((row) => row.eventId), ...bulk.flatMap((row) => (row.eventId ? [row.eventId] : []))]),
  ];
  const [zones, titles] = eventIds.length === 0 ? [[], []] : await Promise.all([
    db.select({ id: events.id, timezone: events.timezone }).from(events).where(inArray(events.id, eventIds)),
    db
      .select({ eventId: eventTranslations.eventId, locale: eventTranslations.locale, title: eventTranslations.title })
      .from(eventTranslations)
      .where(inArray(eventTranslations.eventId, eventIds)),
  ]);
  const zoneOf = new Map(zones.map((row) => [row.id, row.timezone]));
  const titleOf = new Map<string, { ro: string | null; en: string | null }>();
  for (const row of titles) {
    const entry = titleOf.get(row.eventId) ?? { ro: null, en: null };
    entry[row.locale] = row.title;
    titleOf.set(row.eventId, entry);
  }

  const automatic: ForecastRow[] = [...grouped.values()]
    .filter((row) => row.recipients + row.testRecipients > 0)
    .map((row) => ({
      at: row.at,
      overdue: row.at.getTime() <= now.getTime(),
      eventId: row.eventId,
      eventTitle: titleOf.get(row.eventId) ?? { ro: null, en: null },
      zone: zoneOf.get(row.eventId) ?? CLUB_TIME_ZONE,
      type: TYPE_OF[row.send],
      send: row.send,
      recipients: row.recipients,
      testRecipients: row.testRecipients,
      registrationIds: row.registrationIds.sort(),
    }));
  const subscribers: ForecastRow[] = bulk.map((row) => ({
    at: row.at,
    overdue: row.at.getTime() <= now.getTime(),
    eventId: row.eventId,
    eventTitle: row.eventId ? (titleOf.get(row.eventId) ?? { ro: null, en: null }) : { ro: null, en: null },
    zone: row.eventId ? (zoneOf.get(row.eventId) ?? CLUB_TIME_ZONE) : CLUB_TIME_ZONE,
    type: TYPE_OF[row.send],
    send: row.send,
    recipients: row.recipients,
    testRecipients: 0,
    registrationIds: [],
    sendId: row.sendId,
    subject: row.subject,
    held: row.held,
  }));

  return [...automatic, ...subscribers].sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      RUN_ORDER.indexOf(a.send) - RUN_ORDER.indexOf(b.send) ||
      (a.eventId ?? "").localeCompare(b.eventId ?? "") ||
      (a.sendId ?? "").localeCompare(b.sendId ?? ""),
  );
}

type SubscriberSend = {
  at: Date;
  held: boolean;
  send: "newsletter" | "newEventAlert";
  sendId: string;
  eventId: string | null;
  subject: { ro: string; en: string } | null;
  recipients: number;
};

/**
 * The newsletters and new-event alerts in the outbox and not yet sent (§NNN), one line per send and
 * release instant: when the reserve lets them go (`next_attempt_at`, the allowance's reset for a
 * held row; the job's next run for one never tried), and how many subscribers — the club's own copy
 * of the send is not a subscriber and is left out of the count.
 */
async function waitingSubscriberSends<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<SubscriberSend[]> {
  const sendId = sql<string | null>`${emailOutbox.payloadJson}->>'sendId'`;
  const eventId = sql<string | null>`${emailOutbox.payloadJson}->>'eventId'`;
  const rows = await db
    .select({
      type: emailOutbox.messageType,
      sendId,
      eventId,
      nextAttemptAt: emailOutbox.nextAttemptAt,
      subscribers: sql<number>`count(*) FILTER (WHERE ${emailOutbox.payloadJson}->>${CLUB_COPY_FLAG} IS DISTINCT FROM 'true')::int`,
    })
    .from(emailOutbox)
    .where(and(inArray(emailOutbox.status, ["PENDING", "PROCESSING"]), inArray(emailOutbox.messageType, [...BULK_MESSAGE_TYPES])))
    .groupBy(emailOutbox.messageType, sendId, eventId, emailOutbox.nextAttemptAt);

  const merged = new Map<string, SubscriberSend>();
  for (const row of rows) {
    if (!row.sendId || Number(row.subscribers) === 0) continue;
    const held = row.nextAttemptAt !== null && row.nextAttemptAt.getTime() > now.getTime();
    const at = held && row.nextAttemptAt ? row.nextAttemptAt : now;
    const key = `${row.sendId}|${at.getTime()}`;
    const entry = merged.get(key) ?? {
      at,
      held,
      send: row.type === "NEWSLETTER" ? ("newsletter" as const) : ("newEventAlert" as const),
      sendId: row.sendId,
      eventId: row.type === "NEW_EVENT_ALERT" ? row.eventId : null,
      subject: null,
      recipients: 0,
    };
    entry.recipients += Number(row.subscribers);
    merged.set(key, entry);
  }
  const entries = [...merged.values()];
  const newsletterIds = [...new Set(entries.filter((entry) => entry.send === "newsletter").map((entry) => entry.sendId))];
  if (newsletterIds.length > 0) {
    const sends = await db
      .select({ id: newsletterSends.id, subject: newsletterSends.subject, body: newsletterSends.body })
      .from(newsletterSends)
      .where(inArray(newsletterSends.id, newsletterIds));
    const subjectOf = new Map(sends.map((send) => [send.id, readNewsletterWords(send.subject, send.body)?.subject ?? null]));
    for (const entry of entries) if (entry.send === "newsletter") entry.subject = subjectOf.get(entry.sendId) ?? null;
  }
  return entries;
}
