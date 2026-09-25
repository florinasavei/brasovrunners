import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { emailOutbox, type EmailMessageType } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { registrationInterests } from "@/db/schema/registration-interests";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import { awaitingSettledNumber } from "@/modules/registrations/bibs";
import {
  AUTOMATIC_SEND_KEYS,
  bibsSettleAt,
  declarationLastCallDueAt,
  eventReminderDueAt,
  isDeclarationLastCallDue,
  isEventReminderDue,
  nextInLineOffers,
  participationConfirmationDueAt,
  registrationOpenedDueAt,
} from "./domain/automatic-sends";
import { selectDeclarationCandidates, selectReminderCandidates } from "./event-mail";

/**
 * "Următoarele emailuri automate" on `/admin/emails` (§NNN; the owner, 2026-09-24: "I need to know
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
 * a waiting-list offer or a declaration hold lapses with somebody waiting (§160, AGENTS.md §10.5),
 * "here is your race number" when registration closes (§214), and "registration is open" to the
 * addresses left on the event's page (§146).
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

export type AutomaticSend = "reminder" | "lastCall" | "participation" | "nextInLine" | "bibs" | "registrationOpened";

export type ForecastRow = {
  /** When the job will send it: the instant it becomes due (its next run after that), never before `now`. */
  at: Date;
  /** Already due and not yet queued: it goes at the job's next run. */
  overdue: boolean;
  eventId: string;
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
};

/** The order of sends due at one instant: the order a run of the job queues them in. */
const RUN_ORDER: AutomaticSend[] = ["nextInLine", "bibs", "reminder", "lastCall", "participation", "registrationOpened"];

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

  // The two declaration emails: the participation confirmation (§104) and the last call (§160).
  for (const row of await selectDeclarationCandidates(db, { from: now })) {
    const confirmAt = participationConfirmationDueAt(row, now);
    if (inHorizon(confirmAt)) {
      keyed.push({ at: confirmAt, eventId: row.eventId, send: "participation", registrationId: row.registrationId, kind: row.kind });
    }
    const natural = declarationLastCallDueAt(row, deadlines);
    if (natural) {
      const at = notBeforeNow(natural);
      if (inHorizon(at) && isDeclarationLastCallDue(row, at, deadlines)) {
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

  // The offer to the next in line (§160, AGENTS.md §10.5): a hold lapses while somebody waits.
  const holds = await db
    .select({ eventId: events.id, startsAt: events.startsAt, holdExpiresAt: registrations.holdExpiresAt })
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
  if (holds.length > 0) {
    const eventIds = [...new Set(holds.map((row) => row.eventId))];
    // The line in the allocator's own order (`lockOldestWaitlisted`): who is offered first.
    const line = await db
      .select({ id: registrations.id, eventId: registrations.eventId, kind: registrations.kind })
      .from(registrations)
      .where(and(inArray(registrations.eventId, eventIds), eq(registrations.status, "WAITLISTED")))
      .orderBy(asc(registrations.waitlistedAt), asc(registrations.id));
    for (const eventId of eventIds) {
      const rows = holds.filter((row) => row.eventId === eventId);
      const waiting = line.filter((row) => row.eventId === eventId);
      const offers = nextInLineOffers({
        lapses: rows.flatMap((row) => (row.holdExpiresAt ? [row.holdExpiresAt] : [])),
        waiting: waiting.length,
        startsAt: rows[0].startsAt,
        now,
      });
      let next = 0;
      for (const offer of offers) {
        for (const person of waiting.slice(next, next + offer.count)) {
          pending.push({ at: offer.at, eventId, send: "nextInLine", registrationId: person.id, kind: person.kind });
        }
        next += offer.count;
      }
    }
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

  if (pending.length === 0) return [];

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

  const eventIds = [...new Set([...grouped.values()].map((row) => row.eventId))];
  const [zones, titles] = await Promise.all([
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

  return [...grouped.values()]
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
    }))
    .sort(
      (a, b) =>
        a.at.getTime() - b.at.getTime() || RUN_ORDER.indexOf(a.send) - RUN_ORDER.indexOf(b.send) || a.eventId.localeCompare(b.eventId),
    );
}
