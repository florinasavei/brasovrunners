import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { eventRsvpAsks, eventRsvps, eventRsvpTokens, rsvpAskRefusals } from "@/db/schema/event-rsvps";
import { events } from "@/db/schema/events";
import { newsletterSubscribers } from "@/db/schema/newsletter";
import type { Database } from "@/db/types";
import { currentDeadlines } from "@/modules/deadlines/deadlines";
import { rsvpAskTimingOf } from "@/modules/deadlines/domain/deadlines";
import { findPublishedEventById } from "@/modules/events/repository";
import { findRunSeries } from "@/modules/group-run-declarations/repository";
import {
  findCurrentApprovedDocument,
  findFirstRsvpAskAnswerersNoticeVersion,
  findFirstRsvpAskNoticeVersion,
  noticeDescribesRsvpAsk,
  noticeDescribesRsvpAskAnswerers,
} from "@/modules/legal-documents/repository";
import { receives } from "@/modules/newsletter/domain/topics";
import { receivesSql } from "@/modules/newsletter/service";
import { drainOutboxAfterResponse } from "@/modules/notifications/drain";
import { enqueueEmail, OutboxMessageWithdrawn } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { readRsvpAskAudienceSetting } from "./ask-audience";
import { mintRefuseLink } from "./ask-refusal";
import { rsvpAskDaysAway, rsvpAskDue, rsvpAskLookAheadMs } from "./domain/ask";
import { asksAnswerers, asksSubscribers, mergeAskRecipients } from "./domain/ask-audience";
import { rsvpOffered } from "./domain/offered";
import { mintRsvpLinks } from "./rsvp";

/**
 * «Vii mâine la …?» (§818; the owner, 2026-10-18: «I need this "Going" to be via email or something … super easy») — the day before an
 * event the club ticked «Vin!» on, the newsletter's subscribers who chose the topic «Întrebarea «Vii?» înaintea alergărilor» get ONE
 * email with two personal links: **«Vin»** counts them at once (the link is the proof of the address, and it is theirs alone), **«Nu vin»**
 * counts nobody. Nobody opens the site to say «Vin»; the email asks and one tap answers. It builds on «Vin!» (§812) and changes none of
 * its rules: an answer is still not a registration (no place, no declaration, no participant), the count and the names still follow
 * the gate `rsvpOffered`, a name is still public only by the person's own tick.
 *
 * **The club sets how it is sent** (§823; the owner, 2026-10-19: «I need to set how these emails are sent»), in three places:
 *   - **when** — «Termene» → «Înainte de start»: how many days before the start (0–7, one by default; 0 asks nobody) and from which hour
 *     of the club's clock (eight by default); `domain/ask.ts` holds the window, the queue and the send both read it;
 *   - **who** — «Emailuri» → «Cui îi trimitem întrebarea „Vii?"»: the subscribers of the topic (the default), the people who answered
 *     «Vin!» at an earlier date of the same series, or both (`ask-audience.ts`);
 *   - **which events** — the tick «Trimite întrebarea „Vii?" înainte de acest eveniment» in the editor's «Vin!» block (\`events.rsvp_ask_enabled\`,
 *     on by default, carried by a series, «Duplică» and the JSON file); an event with it off is never asked.
 *
 * **Who is asked.** *Subscribers* (audience `SUBSCRIBERS` or `BOTH`): the confirmed ones whose topics include `RSVP_ASK` or `ALL`
 * (`receivesSql`, the one rule the newsletter's sends and alerts use) **and whose consent was given under a notice that names the question**
 * (`privacy_notice_version` at or above `findFirstRsvpAskNoticeVersion`: «Toate noutățile» ticked earlier agreed to less). *Answerers*
 * (`ANSWERERS` or `BOTH`): the addresses with a COUNTED answer «Vin!» at an earlier date of the same series (`findRunSeries`: the type and the
 * default-language title, §113) — the rows live thirty days after each date, so «earlier» means about the last month — **whose answer was given
 * under a notice that names this use** (`findFirstRsvpAskAnswerersNoticeVersion`: `{{rsvpAskAnswerers}}`; an answer given before agreed to be
 * counted, not to be asked again) **and only while the notice in force names it too**. Each is less anyone whose address already has a confirmed
 * answer to this event, less every address that REFUSED the series («Nu mă mai întreba la seria aceasta»: `rsvp_ask_refusals`, which holds for
 * both lists), and an address on both lists is asked once, as a subscriber (`mergeAskRecipients`). Not a new-event topic: «Alergările
 * săptămânale» promises «o dată pe serie, nu la fiecare alergare» (`Newsletter.topicHints`), and a question before every run would break
 * what those subscribers were told — so the question is a topic of its own, off until a subscriber ticks it (or has «Toate noutățile»).
 * Never an event for the members alone (§552): its page is not the public's, nor its newsletter's.
 *
 * **When, once.** `queueRsvpAsks`, a step of the maintenance job beside `queueNewEventAlerts`: for each event where `rsvpOffered`
 * holds and `rsvpAskDue` says the window is open (the club's hour on the day N days before, until midnight — `domain/ask.ts`), it writes the
 * event's `event_rsvp_asks` row — UNIQUE on the event, the "once" — and one `RSVP_ASK` per person, in one transaction. An event with
 * nobody to ask still gets its row. A cancelled or unticked event is never asked, and its row, if one exists, stays.
 *
 * **The links are an answer's, not a new kind.** The message is queued with the person's id (the subscriber's, or the earlier answer's) and
 * the event's, and nothing secret.
 * When it is SENT (`checkRsvpAsk` first and `makeRsvpAsk` last, called by the renderer, AGENTS.md §14.5) the person's «Vin!» row is made — unconfirmed, with
 * no name and no tick, `asked_at` set — and the links of the existing machinery are minted for it: `RSVP_CONFIRM` (the «Vin» button)
 * and `RSVP_WITHDRAW` (the «Nu vin» button) — and, to an earlier answerer, a refusal link of its own table (§823, «Nu mă mai întreba la seria
 * aceasta», `rsvp_refuse_tokens`: it has no key to the answer, so it outlives «Nu vin» and the event's start; its press records the refusal in
 * `ask-refusal.ts`). The «Vin» link lives until the event's start (the question may go a week ahead); a «Vin» pressed in a SUBSCRIBER's question
 * is an earlier answer only while that address still receives the topic (`asked_basis`). The page `/vin/<link>` (§812) does the rest: the GET changes nothing, the press is a
 * POST that spends the link. «Vin» confirms the row (`confirmRsvp`, counted at once, the browser remembered); «Nu vin» deletes it
 * (`withdrawRsvp`), so the person is simply not on the list. Nothing in the allocator, the registrations or the capacity formula
 * meets any of it.
 */

/** The topic the question is a message of; the subscribers of `ALL` receive it too (`receivesSql`). */
const ASK_TOPICS = ["RSVP_ASK"] as const;

/**
 * Which of these addresses are, today, subscribers who receive the question's topic under a notice that named it (§823). A «Vin» pressed in
 * a SUBSCRIBER's question (`asked_basis`) is an earlier answer only while this holds: whoever unticked «Întrebarea „Vii?”» or unsubscribed
 * withdrew from exactly this email, and is not asked again through the back door of the answerers' list.
 */
async function stillOnTopic<T extends Record<string, unknown>>(db: Database<T>, canonicals: string[], firstAskNotice: number | null): Promise<Set<string>> {
  if (canonicals.length === 0 || firstAskNotice === null) return new Set();
  const rows = await db
    .select({ canonicalEmail: newsletterSubscribers.canonicalEmail })
    .from(newsletterSubscribers)
    .where(
      and(
        isNotNull(newsletterSubscribers.confirmedAt),
        receivesSql(ASK_TOPICS),
        gte(newsletterSubscribers.privacyNoticeVersion, firstAskNotice),
        inArray(newsletterSubscribers.canonicalEmail, canonicals),
      ),
    );
  return new Set(rows.map((row) => row.canonicalEmail));
}

/** Whether anyone ever refused a series (§823): while nobody has, a subscribers-only question never needs to read the series at all. */
async function anyRefusal<T extends Record<string, unknown>>(db: Database<T>): Promise<boolean> {
  const [row] = await db.select({ id: rsvpAskRefusals.id }).from(rsvpAskRefusals).limit(1);
  return row !== undefined;
}

/**
 * The maintenance job's step: ask, for every event whose window is open and that has not been asked, the club's audience — once. Returns how
 * many messages it queued. Reads one indexed query while no event is due, and nothing else; the notice and the audience are asked only when
 * one is.
 */
export async function queueRsvpAsks<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  // The club's two numbers (§823): zero days is «not at all», and the look-ahead follows the days.
  const timing = rsvpAskTimingOf(await currentDeadlines(db));
  if (timing.daysBefore <= 0) return 0;
  const candidates = await db
    .select({ id: events.id, startsAt: events.startsAt })
    .from(events)
    .leftJoin(eventRsvpAsks, eq(eventRsvpAsks.eventId, events.id))
    .where(
      and(
        isNull(eventRsvpAsks.id),
        eq(events.rsvpEnabled, true),
        // The per-event tick (§823): the club may keep «Vin!» on a date and not ask about it.
        eq(events.rsvpAskEnabled, true),
        eq(events.registrationMode, "NONE"),
        eq(events.eventStatus, "SCHEDULED"),
        eq(events.editorialStatus, "PUBLISHED"),
        // The members' events are not the public's (§552): no subscriber hears of them.
        eq(events.membersOnly, false),
        eq(events.dateToBeAnnounced, false),
        eq(events.timeToBeAnnounced, false),
        gt(events.startsAt, now),
        lt(events.startsAt, new Date(now.getTime() + rsvpAskLookAheadMs(timing))),
      ),
    )
    .orderBy(asc(events.startsAt), asc(events.id));
  const due = candidates.filter((event) => rsvpAskDue(event.startsAt, now, timing));
  if (due.length === 0) return 0;
  /*
    The notice in force must describe «Vin!» AND this question, in every language (`noticeDescribesRsvpAsk`): the question writes a
    «Vin!» row from the person's address, which neither the newsletter's paragraph nor «Vin!»'s alone says. The club's approval of
    `{{rsvpAsk}}` is the switch. The same answer is `rsvpOffered`'s notice flag.
  */
  const described = await noticeDescribesRsvpAsk(db, now);
  if (!described) return 0;
  const { audience } = await readRsvpAskAudienceSetting(db);
  /*
    Whose consent covers it: a subscriber is asked only if the notice they consented under (`privacy_notice_version`) already named the
    question — «Toate noutățile» given before did not say it (§818; the §421 line, as for the names on the list). An earlier answerer
    is asked only under the same line drawn on their ANSWER's version, for the marker of their own (`{{rsvpAskAnswerers}}`), and only
    while the notice in force names it: the club's choice of the audience is half of the switch, the notice the other (§823).
  */
  const firstAskNotice = asksSubscribers(audience) ? await findFirstRsvpAskNoticeVersion(db) : null;
  const subscribersOn = asksSubscribers(audience) && firstAskNotice !== null;
  const firstAnswerersNotice = asksAnswerers(audience) && (await noticeDescribesRsvpAskAnswerers(db, now)) ? await findFirstRsvpAskAnswerersNoticeVersion(db) : null;
  const answerersOn = asksAnswerers(audience) && firstAnswerersNotice !== null;
  if (!subscribersOn && !answerersOn) return 0;

  const withRefusals = await anyRefusal(db);
  let queued = 0;
  for (const event of due) {
    // The gate itself, as the page draws it: published in a language, scheduled, ahead, ticked, the notice describing it.
    const published = await findPublishedEventById(db, "ro", event.id);
    if (!published || !rsvpOffered(published, now, described)) continue;
    // The series, for the answerers' dates and the refusals (§113's grouping, the one the declarations use): read before the transaction.
    const series = answerersOn || withRefusals ? await findRunSeries(db, event.id) : { key: null, dates: [] };
    const earlierDates = series.dates.filter((date) => date.id !== event.id && date.startsAt.getTime() < event.startsAt.getTime()).map((date) => date.id);
    const inserted = await db.transaction(async (tx) => {
      // The "once": the first run to insert the event's row asks; any other — overlapping, or tomorrow's — finds it and does nothing.
      const [ask] = await tx
        .insert(eventRsvpAsks)
        .values({ eventId: event.id, queuedAt: now, recipients: 0 })
        .onConflictDoNothing({ target: eventRsvpAsks.eventId })
        .returning({ id: eventRsvpAsks.id });
      if (!ask) return 0;
      // Already counted: asking the person who said «Vin» would be noise (a confirmed answer of the same canonical address).
      const answered = new Set(
        (await tx.select({ canonicalEmail: eventRsvps.canonicalEmail }).from(eventRsvps).where(and(eq(eventRsvps.eventId, event.id), isNotNull(eventRsvps.confirmedAt)))).map((row) => row.canonicalEmail),
      );
      // Refused for good, for this series (§823) — by an answerer's press; it holds for the subscribers' list too.
      const refused = new Set(
        series.key === null
          ? []
          : (await tx.select({ canonicalEmail: rsvpAskRefusals.canonicalEmail }).from(rsvpAskRefusals).where(eq(rsvpAskRefusals.seriesKey, series.key))).map((row) => row.canonicalEmail),
      );
      const subscribers = subscribersOn
        ? await tx
            .select({ id: newsletterSubscribers.id, locale: newsletterSubscribers.locale, email: newsletterSubscribers.deliveryEmail, canonicalEmail: newsletterSubscribers.canonicalEmail })
            .from(newsletterSubscribers)
            .where(and(isNotNull(newsletterSubscribers.confirmedAt), receivesSql(ASK_TOPICS), gte(newsletterSubscribers.privacyNoticeVersion, firstAskNotice)))
            .orderBy(asc(newsletterSubscribers.createdAt), asc(newsletterSubscribers.id))
        : [];
      // The most recent counted answer of each address at an earlier date, under a notice that named this use; one per address (the merge keeps the first).
      const answererRows =
        answerersOn && series.key !== null && earlierDates.length > 0
          ? await tx
              .select({ id: eventRsvps.id, locale: eventRsvps.locale, email: eventRsvps.deliveryEmail, canonicalEmail: eventRsvps.canonicalEmail, askedBasis: eventRsvps.askedBasis })
              .from(eventRsvps)
              .where(and(inArray(eventRsvps.eventId, earlierDates), isNotNull(eventRsvps.confirmedAt), gte(eventRsvps.privacyNoticeVersion, firstAnswerersNotice)))
              .orderBy(desc(eventRsvps.confirmedAt), asc(eventRsvps.id))
          : [];
      // An answer the question made for a subscriber counts only while that address still receives the topic (a withdrawal from this email holds).
      const subscribed = await stillOnTopic(
        tx,
        answererRows.filter((row) => row.askedBasis === "SUBSCRIBER").map((row) => row.canonicalEmail),
        await findFirstRsvpAskNoticeVersion(tx),
      );
      const answerers = answererRows.filter((row) => row.askedBasis !== "SUBSCRIBER" || subscribed.has(row.canonicalEmail));
      const asked = mergeAskRecipients({ audience, subscribers, answerers, refused, answered });
      let count = 0;
      for (const subscriber of asked.subscribers) {
        const row = await enqueueEmail(tx, {
          participantId: null,
          registrationId: null,
          messageType: "RSVP_ASK",
          locale: subscriber.locale,
          recipientEmail: subscriber.email,
          payload: { eventId: event.id, subscriberId: subscriber.id },
          idempotencyKey: `rsvp-ask:${event.id}:${subscriber.id}`,
          now,
          drainAfter: false,
        });
        if (row) count += 1;
      }
      for (const answerer of asked.answerers) {
        const row = await enqueueEmail(tx, {
          participantId: null,
          registrationId: null,
          messageType: "RSVP_ASK",
          locale: answerer.locale,
          recipientEmail: answerer.email,
          // The earlier answer, by id: the send reads the address, the series and the refusals again (`checkRsvpAsk`); nothing secret rides.
          payload: { eventId: event.id, answererRsvpId: answerer.id },
          idempotencyKey: `rsvp-ask:${event.id}:r:${answerer.id}`,
          now,
          drainAfter: false,
        });
        if (row) count += 1;
      }
      if (count > 0) await tx.update(eventRsvpAsks).set({ recipients: count }).where(eq(eventRsvpAsks.id, ask.id));
      return count;
    });
    queued += inserted;
  }
  if (queued > 0) drainOutboxAfterResponse();
  return queued;
}

/** What the renderer needs to write the buttons: the answer's row, the event's start, and the secrets (in this email alone). */
export type PreparedRsvpAsk = {
  rsvpId: string;
  startsAt: Date;
  confirm: string;
  withdraw: string;
  /** «Nu mă mai întreba la seria aceasta» (§823): only in the question an earlier answerer receives; null for a subscriber. */
  refuse: string | null;
  locale: "ro" | "en";
};

/** Who the question is for: the address it goes to, as the platform compares addresses (AGENTS.md §10.4). */
type AskRecipientRow = { deliveryEmail: string; canonicalEmail: string; canonicalizationVersion: number };

/** What `checkRsvpAsk` found true, and `makeRsvpAsk` writes from: nothing is written yet. */
export type CheckedRsvpAsk = {
  eventId: string;
  /** `SUBSCRIBER`: a newsletter subscriber of the topic. `ANSWERER` (§823): an address with a counted «Vin!» at an earlier date of the series. */
  kind: "SUBSCRIBER" | "ANSWERER";
  recipient: AskRecipientRow;
  locale: "ro" | "en";
  noticeVersion: number;
  startsAt: Date;
  /** Calendar days from the send's day to the start's: the email says «mâine», «poimâine» or «peste N zile» from it. */
  daysAway: number;
  now: Date;
};

export type RsvpAskParams = {
  eventId: string;
  /** The subscriber the message names (a subscriber's question). */
  subscriberId?: string;
  /** The earlier answer the message names (an answerer's question, §823). */
  answererRsvpId?: string;
  recipientEmail: string;
  now: Date;
};

/**
 * At the send, the read-only half (AGENTS.md §14.5; the renderer calls it FIRST, `makeRsvpAsk` LAST, so a failure of the words and the
 * calendar file in between leaves nothing written): every reason to drop the message. Throws `OutboxMessageWithdrawn` — dropped, not
 * failed (§331) — when there is nothing to ask any more: the subscriber unsubscribed, never confirmed or unticked the topic, consented
 * under a notice that did not describe the question (`findFirstRsvpAskNoticeVersion`), the address on the row is not theirs, the event was
 * cancelled, unticked, handed a registration, made the members' or moved out of its window (or started), or the notice stopped
 * describing «Vin!» or the question — and the club's settings since the queue (§823): the question switched off (zero days), the event's tick
 * unticked, the audience changed away from this person's list.
 *
 * An earlier answerer's question (§823) is dropped too when the answer it names is gone, was not counted, is not at this address or was
 * given under a notice that did not name this use, when the series no longer holds that date, when the notice in force stopped naming
 * `{{rsvpAskAnswerers}}`, or when the address has refused the series meanwhile.
 */
export async function checkRsvpAsk<T extends Record<string, unknown>>(db: Database<T>, params: RsvpAskParams): Promise<CheckedRsvpAsk> {
  const { eventId, now } = params;
  let canonical: string;
  try {
    canonical = canonicalizeEmail(params.recipientEmail).canonicalEmail;
  } catch {
    throw new OutboxMessageWithdrawn("rsvp ask: the address is not valid");
  }
  const { audience } = await readRsvpAskAudienceSetting(db);

  let kind: CheckedRsvpAsk["kind"];
  let recipient: AskRecipientRow;
  let locale: "ro" | "en";
  let seriesKey: string | null = null;
  if (params.answererRsvpId) {
    kind = "ANSWERER";
    if (!asksAnswerers(audience)) throw new OutboxMessageWithdrawn("rsvp ask: the club no longer asks the earlier answerers");
    if (!(await noticeDescribesRsvpAskAnswerers(db, now))) throw new OutboxMessageWithdrawn("rsvp ask: the notice in force stopped describing the question for earlier answerers");
    const firstAnswerersNotice = await findFirstRsvpAskAnswerersNoticeVersion(db);
    const [source] = await db.select().from(eventRsvps).where(eq(eventRsvps.id, params.answererRsvpId)).limit(1);
    if (!source || source.confirmedAt === null) throw new OutboxMessageWithdrawn("rsvp ask: the earlier answer is gone or was never counted");
    if (canonical !== source.canonicalEmail) throw new OutboxMessageWithdrawn("rsvp ask: the address is not the answer's");
    // The §421 line on the ANSWER's version: an answer given under a notice that did not name this use agreed to be counted, not to be asked again.
    if (firstAnswerersNotice === null || source.privacyNoticeVersion < firstAnswerersNotice) {
      throw new OutboxMessageWithdrawn("rsvp ask: the answer was given under a notice that did not describe the question for earlier answerers");
    }
    const series = await findRunSeries(db, eventId);
    const sourceDate = series.dates.find((date) => date.id === source.eventId);
    const thisDate = series.dates.find((date) => date.id === eventId);
    if (series.key === null || !sourceDate || !thisDate || sourceDate.startsAt.getTime() >= thisDate.startsAt.getTime()) {
      throw new OutboxMessageWithdrawn("rsvp ask: the answer is not from an earlier date of this event's series");
    }
    // A «Vin» pressed in a subscriber's question counts only while the address still receives the topic (the queue's rule again).
    if (source.askedBasis === "SUBSCRIBER" && !(await stillOnTopic(db, [source.canonicalEmail], await findFirstRsvpAskNoticeVersion(db))).has(source.canonicalEmail)) {
      throw new OutboxMessageWithdrawn("rsvp ask: the earlier answer came from a subscriber's question and the address no longer receives the topic");
    }
    seriesKey = series.key;
    recipient = { deliveryEmail: source.deliveryEmail, canonicalEmail: source.canonicalEmail, canonicalizationVersion: source.canonicalizationVersion };
    locale = source.locale;
  } else {
    kind = "SUBSCRIBER";
    if (!params.subscriberId) throw new OutboxMessageWithdrawn("rsvp ask: the message names no one to ask");
    if (!asksSubscribers(audience)) throw new OutboxMessageWithdrawn("rsvp ask: the club no longer asks the newsletter's subscribers");
    const [subscriber] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, params.subscriberId)).limit(1);
    if (!subscriber || subscriber.confirmedAt === null) throw new OutboxMessageWithdrawn("rsvp ask: the subscriber is no longer on the list");
    if (canonical !== subscriber.canonicalEmail) throw new OutboxMessageWithdrawn("rsvp ask: the address is not the subscriber's");

    // Still on the topic: unticking «Întrebarea «Vii?» …» (or «Toate noutățile») after the morning's queue stops the question, and no row is written.
    if (!receives(subscriber.topics, ASK_TOPICS)) throw new OutboxMessageWithdrawn("rsvp ask: the subscriber no longer receives the topic");

    // ...and consented under a notice that named the question (the queue's rule again: a version recorded earlier is a consent to less).
    const firstAskNotice = await findFirstRsvpAskNoticeVersion(db);
    if (firstAskNotice === null || subscriber.privacyNoticeVersion < firstAskNotice) {
      throw new OutboxMessageWithdrawn("rsvp ask: the subscriber consented under a notice that did not describe the question");
    }
    recipient = { deliveryEmail: subscriber.deliveryEmail, canonicalEmail: subscriber.canonicalEmail, canonicalizationVersion: subscriber.canonicalizationVersion };
    locale = subscriber.locale;
    // A refusal for the series holds for the topic's subscribers too (§823): «never» means never, whichever list the address is on.
    seriesKey = (await anyRefusal(db)) ? (await findRunSeries(db, eventId)).key : null;
  }

  // Refused for good, for this series: the one press that outlives every list (`ask-refusal.ts`).
  if (seriesKey !== null) {
    const [refusal] = await db
      .select({ id: rsvpAskRefusals.id })
      .from(rsvpAskRefusals)
      .where(and(eq(rsvpAskRefusals.canonicalEmail, canonical), eq(rsvpAskRefusals.seriesKey, seriesKey)))
      .limit(1);
    if (refusal) throw new OutboxMessageWithdrawn("rsvp ask: the address refused the question for this series");
  }

  const [stored] = await db.select({ membersOnly: events.membersOnly, askEnabled: events.rsvpAskEnabled }).from(events).where(eq(events.id, eventId)).limit(1);
  const event = await findPublishedEventById(db, locale, eventId);
  if (!stored || stored.membersOnly || !event || !rsvpOffered(event, now, await noticeDescribesRsvpAsk(db, now)) || event.startsAt === null) {
    throw new OutboxMessageWithdrawn("rsvp ask: the event no longer takes «Vin!» answers, or the notice stopped describing the question");
  }
  // The per-event tick (§823): unticked after the queue, the question for this date is not sent.
  if (!stored.askEnabled) throw new OutboxMessageWithdrawn("rsvp ask: the club switched the question off for this event");
  /*
    The window as it is at the SEND, not only at the queue: a send held past midnight (a failure, the hourly pace, a pause), or an
    event moved a day later since, would still say «mâine». The question is then dropped; the page's «Vin!» and the calendar still take
    the answer. (An event moved after its question was queued is not asked again for its new day: the queue is once per event.) With the
    club's numbers as they are now (§823): zero days since the queue drops it.
  */
  const timing = rsvpAskTimingOf(await currentDeadlines(db));
  if (!rsvpAskDue(event.startsAt, now, timing)) throw new OutboxMessageWithdrawn("rsvp ask: the window of the question is closed");
  const notice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", locale, now);
  if (!notice) throw new OutboxMessageWithdrawn("rsvp ask: no approved privacy notice");
  return { eventId, kind, recipient, locale, noticeVersion: notice.version, startsAt: event.startsAt, daysAway: rsvpAskDaysAway(event.startsAt, now), now };
}

/**
 * At the send, the writing half (AGENTS.md §14.5: the secrets exist in the email alone): make the person's «Vin!» row for this
 * event, unconfirmed, with no name and no tick, and mint its links. Throws `OutboxMessageWithdrawn` when the address already has a
 * counted answer, or an answer typed on the page whose own «Da, vin» link is still live.
 *
 * A row that already exists UNCONFIRMED and whose own link is spent or has run out (an old answer typed on the page, never pressed) is
 * taken over: the name and the tick on it were typed by whoever typed the address, and this link's press is the person's own, so they
 * are cleared — the press replaces them (§812: an unconfirmed row never lends a stranger's name to a verified press). Its age restarts,
 * so the seven days an unanswered row lives count from this email. One whose «Da, vin» link is still LIVE is left alone and the question
 * is dropped: that email is already a one-tap path, and minting here would kill its link (`mintRsvpLinks` supersedes the older of each
 * purpose). (The reverse — the page's message sent after this one — still supersedes these links, and leaves the person that one.)
 */
export async function makeRsvpAsk<T extends Record<string, unknown>>(db: Database<T>, checked: CheckedRsvpAsk): Promise<PreparedRsvpAsk> {
  const { eventId, recipient, locale, noticeVersion, startsAt, now } = checked;
  const written = await db.transaction(async (tx) => {
    const values = {
      eventId,
      deliveryEmail: recipient.deliveryEmail,
      canonicalEmail: recipient.canonicalEmail,
      canonicalizationVersion: recipient.canonicalizationVersion,
      displayName: null,
      showName: false,
      locale,
      privacyNoticeVersion: noticeVersion,
      confirmedAt: null,
      askedAt: now,
      askedBasis: checked.kind,
      createdAt: now,
    };
    const [inserted] = await tx.insert(eventRsvps).values(values).onConflictDoNothing({ target: [eventRsvps.eventId, eventRsvps.canonicalEmail] }).returning({ id: eventRsvps.id });
    if (inserted) return { id: inserted.id };
    const [existing] = await tx
      .select()
      .from(eventRsvps)
      .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.canonicalEmail, recipient.canonicalEmail)))
      .for("update");
    if (!existing) throw new OutboxMessageWithdrawn("rsvp ask: the answer could not be written");
    // Counted already (a press of a page's link, a remembered browser): nothing left to ask.
    if (existing.confirmedAt !== null) return { dropped: "counted" as const };
    // An answer typed on the page whose own «Da, vin» link is live: that email is the path already, and minting would kill its link.
    if (existing.askedAt === null) {
      const [live] = await tx
        .select({ id: eventRsvpTokens.id })
        .from(eventRsvpTokens)
        .where(
          and(
            eq(eventRsvpTokens.rsvpId, existing.id),
            eq(eventRsvpTokens.purpose, "RSVP_CONFIRM"),
            isNull(eventRsvpTokens.usedAt),
            isNull(eventRsvpTokens.invalidatedAt),
            gt(eventRsvpTokens.expiresAt, now),
          ),
        )
        .limit(1);
      if (live) return { dropped: "pending" as const };
    }
    await tx
      .update(eventRsvps)
      .set({ deliveryEmail: recipient.deliveryEmail, displayName: null, showName: false, locale, privacyNoticeVersion: noticeVersion, askedAt: now, askedBasis: checked.kind, createdAt: now })
      .where(eq(eventRsvps.id, existing.id));
    return { id: existing.id };
  });
  if ("dropped" in written) {
    throw new OutboxMessageWithdrawn(written.dropped === "counted" ? "rsvp ask: the address is already counted" : "rsvp ask: the address has a live «Da, vin» link already");
  }
  const rsvpId = written.id;

  // The question's «Vin» lives until the start: the club may send it a week ahead, and 48 hours would leave the last days with a dead button (§823).
  const links = await mintRsvpLinks(db, { rsvpId, startsAt, confirm: true, confirmUntilStart: true, now });
  if (!links || links.confirm === null) throw new OutboxMessageWithdrawn("rsvp ask: the event has started");
  // The refusal link has a table of its own, so it outlives the row «Nu vin» deletes (§823).
  const refuse =
    checked.kind === "ANSWERER"
      ? await mintRefuseLink(db, { eventId, locale, canonicalEmail: recipient.canonicalEmail, canonicalizationVersion: recipient.canonicalizationVersion, startsAt, now })
      : null;
  return { rsvpId, startsAt, confirm: links.confirm, withdraw: links.withdraw, refuse, locale };
}

/** Both halves, for a caller with nothing to do between them (the renderer calls them apart, so a failure in between leaves nothing written). */
export async function prepareRsvpAsk<T extends Record<string, unknown>>(db: Database<T>, params: RsvpAskParams): Promise<PreparedRsvpAsk> {
  return makeRsvpAsk(db, await checkRsvpAsk(db, params));
}
