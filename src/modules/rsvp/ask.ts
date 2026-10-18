import { and, asc, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { eventRsvpAsks, eventRsvps } from "@/db/schema/event-rsvps";
import { events } from "@/db/schema/events";
import { newsletterSubscribers } from "@/db/schema/newsletter";
import type { Database } from "@/db/types";
import { findPublishedEventById } from "@/modules/events/repository";
import { findCurrentApprovedDocument, noticeDescribesRsvp } from "@/modules/legal-documents/repository";
import { receivesSql } from "@/modules/newsletter/service";
import { drainOutboxAfterResponse } from "@/modules/notifications/drain";
import { enqueueEmail, OutboxMessageWithdrawn } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { rsvpAskDue } from "./domain/ask";
import { rsvpOffered } from "./domain/offered";
import { mintRsvpLinks } from "./rsvp";

/**
 * «Vii mâine la …?» (§NNN; the owner, 2026-10-18: «I need this "Going" to be via email or something … super easy») — the day before an
 * event the club ticked «Vin!» on, the newsletter's subscribers who chose the topic «Întrebarea „Vii?” înaintea alergărilor» get ONE
 * email with two personal links: **«Vin»** counts them at once (the link is the proof of the address, and it is theirs alone), **«Nu vin»**
 * counts nobody. Nobody opens the site to say «Vin»; the email asks and one tap answers. It builds on «Vin!» (§812) and changes none of
 * its rules: an answer is still not a registration (no place, no declaration, no participant), the count and the names still follow
 * the gate `rsvpOffered`, a name is still public only by the person's own tick.
 *
 * **Who is asked.** The confirmed subscribers whose topics include `RSVP_ASK` or `ALL` (`receivesSql`, the one rule the newsletter's
 * sends and alerts use), less anyone whose address already has a confirmed answer to this event. Not a new-event topic: «Alergările
 * săptămânale» promises «o dată pe serie, nu la fiecare alergare» (`Newsletter.topicHints`), and a question before every run would break
 * what those subscribers were told — so the question is a topic of its own, off until a subscriber ticks it (or has «Toate noutățile»).
 * Never an event for the members alone (§552): its page is not the public's, nor its newsletter's.
 *
 * **When, once.** `queueRsvpAsks`, a step of the maintenance job beside `queueNewEventAlerts`: for each event where `rsvpOffered`
 * holds and `rsvpAskDue` says the window is open (08:00 club time on the day before, until midnight — `domain/ask.ts`), it writes the
 * event's `event_rsvp_asks` row — UNIQUE on the event, the "once" — and one `RSVP_ASK` per subscriber, in one transaction. An event with
 * nobody to ask still gets its row. A cancelled or unticked event is never asked, and its row, if one exists, stays.
 *
 * **The links are an answer's, not a new kind.** The message is queued with the subscriber's id and the event's, and nothing secret.
 * When it is SENT (`prepareRsvpAsk`, called by the renderer, AGENTS.md §14.5) the subscriber's «Vin!» row is made — unconfirmed, with
 * no name and no tick, `asked_at` set — and the two links of the existing machinery are minted for it: `RSVP_CONFIRM` (the «Vin» button)
 * and `RSVP_WITHDRAW` (the «Nu vin» button). The page `/vin/<link>` (§812) does the rest: the GET changes nothing, the press is a
 * POST that spends the link. «Vin» confirms the row (`confirmRsvp`, counted at once, the browser remembered); «Nu vin» deletes it
 * (`withdrawRsvp`), so the person is simply not on the list. Nothing in the allocator, the registrations or the capacity formula
 * meets any of it.
 */

/** The longest wait from `now` to a start that can still be "tomorrow": 08:00 on the day before to 23:59 on the day itself, with room. */
const LOOK_AHEAD_MS = 48 * 3_600_000;

/** The topic the question is a message of; the subscribers of `ALL` receive it too (`receivesSql`). */
const ASK_TOPICS = ["RSVP_ASK"] as const;

/**
 * The maintenance job's step: ask, for every event whose window is open and that has not been asked, the subscribers of the topic —
 * once. Returns how many messages it queued. Reads one indexed query while no event is due, and nothing else; the notice is asked only
 * when one is.
 */
export async function queueRsvpAsks<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const candidates = await db
    .select({ id: events.id, startsAt: events.startsAt })
    .from(events)
    .leftJoin(eventRsvpAsks, eq(eventRsvpAsks.eventId, events.id))
    .where(
      and(
        isNull(eventRsvpAsks.id),
        eq(events.rsvpEnabled, true),
        eq(events.registrationMode, "NONE"),
        eq(events.eventStatus, "SCHEDULED"),
        eq(events.editorialStatus, "PUBLISHED"),
        // The members' events are not the public's (§552): no subscriber hears of them.
        eq(events.membersOnly, false),
        eq(events.dateToBeAnnounced, false),
        eq(events.timeToBeAnnounced, false),
        gt(events.startsAt, now),
        lt(events.startsAt, new Date(now.getTime() + LOOK_AHEAD_MS)),
      ),
    )
    .orderBy(asc(events.startsAt), asc(events.id));
  const due = candidates.filter((event) => rsvpAskDue(event.startsAt, now));
  if (due.length === 0) return 0;
  // The notice in force must describe «Vin!» in every language — the one rule of the page and the service (`rsvpOffered`).
  const described = await noticeDescribesRsvp(db, now);
  if (!described) return 0;

  let queued = 0;
  for (const event of due) {
    // The gate itself, as the page draws it: published in a language, scheduled, ahead, ticked, the notice describing it.
    const published = await findPublishedEventById(db, "ro", event.id);
    if (!published || !rsvpOffered(published, now, described)) continue;
    const inserted = await db.transaction(async (tx) => {
      // The "once": the first run to insert the event's row asks; any other — overlapping, or tomorrow's — finds it and does nothing.
      const [ask] = await tx
        .insert(eventRsvpAsks)
        .values({ eventId: event.id, queuedAt: now, recipients: 0 })
        .onConflictDoNothing({ target: eventRsvpAsks.eventId })
        .returning({ id: eventRsvpAsks.id });
      if (!ask) return 0;
      const subscribers = await tx
        .select({ id: newsletterSubscribers.id, locale: newsletterSubscribers.locale, email: newsletterSubscribers.deliveryEmail })
        .from(newsletterSubscribers)
        .where(
          and(
            isNotNull(newsletterSubscribers.confirmedAt),
            receivesSql(ASK_TOPICS),
            // Already counted: asking the person who said «Vin» would be noise (a confirmed answer of the same canonical address).
            sql`NOT EXISTS (
              SELECT 1 FROM ${eventRsvps}
              WHERE ${eventRsvps.eventId} = ${event.id}
                AND ${eventRsvps.canonicalEmail} = ${newsletterSubscribers.canonicalEmail}
                AND ${eventRsvps.confirmedAt} IS NOT NULL
            )`,
          ),
        )
        .orderBy(asc(newsletterSubscribers.createdAt), asc(newsletterSubscribers.id));
      let count = 0;
      for (const subscriber of subscribers) {
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
      if (count > 0) await tx.update(eventRsvpAsks).set({ recipients: count }).where(eq(eventRsvpAsks.id, ask.id));
      return count;
    });
    queued += inserted;
  }
  if (queued > 0) drainOutboxAfterResponse();
  return queued;
}

/** What the renderer needs to write the two buttons: the answer's row, the event's start, and the two secrets (in this email alone). */
export type PreparedRsvpAsk = { rsvpId: string; startsAt: Date; confirm: string; withdraw: string; locale: "ro" | "en" };

/**
 * At the send (AGENTS.md §14.5: the secrets exist in the email alone): make the subscriber's «Vin!» row for this event, unconfirmed,
 * with no name and no tick, and mint its two links. Throws `OutboxMessageWithdrawn` — the message is dropped, not failed (§331) —
 * when there is nothing to ask any more: the subscriber unsubscribed or never confirmed, the address on the row is not theirs, the
 * event was cancelled, unticked, handed a registration, made the members' or started, the notice stopped describing «Vin!», or the
 * address already has a counted answer.
 *
 * A row that already exists UNCONFIRMED (the address was typed on the page and its own message not yet used) is taken over: the
 * name and the tick on it were typed by whoever typed the address, and this link's press is the subscriber's own, so they are cleared —
 * the press replaces them (§812: an unconfirmed row never lends a stranger's name to a verified press) — and the older confirm link
 * dies with the new one (`mintRsvpLinks`). Its age restarts, so the seven days an unanswered row lives count from this email.
 */
export async function prepareRsvpAsk<T extends Record<string, unknown>>(
  db: Database<T>,
  params: { eventId: string; subscriberId: string; recipientEmail: string; now: Date },
): Promise<PreparedRsvpAsk> {
  const { eventId, subscriberId, now } = params;
  const [subscriber] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, subscriberId)).limit(1);
  if (!subscriber || subscriber.confirmedAt === null) throw new OutboxMessageWithdrawn("rsvp ask: the subscriber is no longer on the list");
  let canonical: string;
  try {
    canonical = canonicalizeEmail(params.recipientEmail).canonicalEmail;
  } catch {
    throw new OutboxMessageWithdrawn("rsvp ask: the address is not valid");
  }
  if (canonical !== subscriber.canonicalEmail) throw new OutboxMessageWithdrawn("rsvp ask: the address is not the subscriber's");

  const locale = subscriber.locale;
  const [stored] = await db.select({ membersOnly: events.membersOnly }).from(events).where(eq(events.id, eventId)).limit(1);
  const event = await findPublishedEventById(db, locale, eventId);
  if (!stored || stored.membersOnly || !event || !rsvpOffered(event, now, await noticeDescribesRsvp(db, now)) || event.startsAt === null) {
    throw new OutboxMessageWithdrawn("rsvp ask: the event no longer takes «Vin!» answers");
  }
  const notice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", locale, now);
  if (!notice) throw new OutboxMessageWithdrawn("rsvp ask: no approved privacy notice");
  const startsAt = event.startsAt;

  const rsvpId = await db.transaction(async (tx) => {
    const values = {
      eventId,
      deliveryEmail: subscriber.deliveryEmail,
      canonicalEmail: subscriber.canonicalEmail,
      canonicalizationVersion: subscriber.canonicalizationVersion,
      displayName: null,
      showName: false,
      locale,
      privacyNoticeVersion: notice.version,
      confirmedAt: null,
      askedAt: now,
      createdAt: now,
    };
    const [inserted] = await tx.insert(eventRsvps).values(values).onConflictDoNothing({ target: [eventRsvps.eventId, eventRsvps.canonicalEmail] }).returning({ id: eventRsvps.id });
    if (inserted) return inserted.id;
    const [existing] = await tx
      .select()
      .from(eventRsvps)
      .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.canonicalEmail, subscriber.canonicalEmail)))
      .for("update");
    if (!existing) throw new OutboxMessageWithdrawn("rsvp ask: the answer could not be written");
    // Counted already (a press of a page's link, a remembered browser): nothing left to ask.
    if (existing.confirmedAt !== null) return null;
    await tx
      .update(eventRsvps)
      .set({ deliveryEmail: subscriber.deliveryEmail, displayName: null, showName: false, locale, privacyNoticeVersion: notice.version, askedAt: now, createdAt: now })
      .where(eq(eventRsvps.id, existing.id));
    return existing.id;
  });
  if (rsvpId === null) throw new OutboxMessageWithdrawn("rsvp ask: the address is already counted");

  const links = await mintRsvpLinks(db, { rsvpId, startsAt, confirm: true, now });
  if (!links || links.confirm === null) throw new OutboxMessageWithdrawn("rsvp ask: the event has started");
  return { rsvpId, startsAt, confirm: links.confirm, withdraw: links.withdraw, locale };
}
