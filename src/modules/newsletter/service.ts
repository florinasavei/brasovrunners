import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { type NewsletterTopic, newsletterSends, newsletterSubscribers } from "@/db/schema/newsletter";
import type { StaffUser } from "@/db/schema/staff-users";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { findCurrentApprovedDocument, noticeDescribesNewsletter } from "@/modules/legal-documents/repository";
import { BULK_MESSAGE_TYPES } from "@/modules/notifications/domain/bulk";
import { drainOutboxAfterResponse } from "@/modules/notifications/drain";
import { enqueueBulkClubCopies, enqueueEmail } from "@/modules/notifications/outbox";
import { readCoHosts } from "@/modules/events/domain/co-hosts";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { looksLikeSpam } from "@/modules/registrations/service";
import { canManageRegistrations, canSendNewsletter } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { alertDayOf, eventAlertTopics, eventAlertWanted, EVENT_ALERT_WINDOW_DAYS } from "./domain/alerts";
import { checkNewsletterWords, type NewsletterIssue, readNewsletterWords } from "./domain/message";
import { isSendableTopic, NEWSLETTER_TOPICS, normalizeTopics, SENDABLE_TOPICS } from "./domain/topics";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { consumeNewsletterToken, issueNewsletterToken, readNewsletterToken } from "./tokens";

/**
 * The club's newsletter (§NNN; the owner, 2026-09-26: "the registration needs to be on the contact
 * page, a button for a pop-up and people can opt in on what to receive"), built as §80 said a
 * newsletter would have to be: a message type, a consent, a manage and unsubscribe link, a
 * privacy-notice paragraph — on the outbox, under the plan's allowance.
 *
 * The pop-up is a public form, so it takes the public forms' defences unchanged: the address
 * through the versioned canonicalizer (AGENTS.md §10.4) with the UNIQUE constraint on it; the
 * honeypot and the timing check (`looksLikeSpam`) and Turnstile at the action, answered with the
 * same silence; a throttle on the address; and one answer whatever it found (the resend-oracle
 * rule, BR-REQ-031-01 criterion 3), so the pop-up cannot be used to ask whether somebody reads the
 * club's newsletter. The answer to the *mailbox* is where the truth goes: a new or unconfirmed
 * address gets the confirmation link, an address already subscribed gets the link to its own page.
 *
 * Nothing is collected while the privacy notice in force does not describe it (`describesNewsletter`)
 * — the page shows no button then, and this service refuses whoever posts past the page.
 */

const subscribeSchema = z.object({
  email: z.string().trim().max(320).pipe(z.email()),
  locale: z.enum(["ro", "en"]),
  topics: z.array(z.string().max(40)).max(NEWSLETTER_TOPICS.length * 2),
  honeypot: z.string().max(2000).optional(),
  renderedAt: z.iso.datetime().optional(),
  /** The pop-up's one consent tick, naming the privacy notice (§NNN): the person's own act, required. */
  consent: z.literal(true),
});

export type SubscribeOutcome =
  /** Whatever it found — new, unconfirmed, subscribed, a bot's — the page says "check your inbox". */
  | "done"
  /** The address's hour is spent: said plainly, because a person is not a bot. */
  | "limited";

/**
 * Take an address from the pop-up: a confirmation link to a new or unconfirmed one, the link to its
 * own page to one already subscribed. Refuses a malformed address, no topic or no consent tick (the
 * person's own fix, `VALIDATION_ERROR` naming each box) and a notice that does not describe the newsletter
 * (`CONFLICT`: the page offers no pop-up then).
 */
export async function subscribeToNewsletter<T extends Record<string, unknown>>(
  db: Database<T>,
  rawInput: unknown,
  now: Date,
): Promise<SubscribeOutcome> {
  const parsed = subscribeSchema.safeParse(rawInput);
  // The ticks are read whatever else is wrong, so a refusal names each box that needs fixing once.
  const rawTopics = (rawInput as { topics?: unknown } | null)?.topics;
  const topics = normalizeTopics(Array.isArray(rawTopics) ? rawTopics : []);
  const consented = (rawInput as { consent?: unknown } | null)?.consent === true;
  if (!parsed.success || topics.length === 0 || !consented) {
    const fields = [
      ...(!parsed.success && parsed.error.issues.some((issue) => issue.path[0] === "email") ? ["email"] : []),
      ...(topics.length === 0 ? ["topics"] : []),
      ...(!consented ? ["consent"] : []),
    ];
    throw new DomainError("VALIDATION_ERROR", "the newsletter form is malformed", fields.length > 0 ? fields : ["email"]);
  }
  const input = parsed.data;
  if (looksLikeSpam(input, now)) return "done";

  if (!(await noticeDescribesNewsletter(db, now))) {
    throw new DomainError("CONFLICT", "the privacy notice in force does not describe the newsletter; the pop-up is closed");
  }
  const notice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", input.locale, now);
  if (!notice) throw new DomainError("CONFLICT", "no approved privacy notice in this language");

  let identity;
  try {
    identity = canonicalizeEmail(input.email);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "the address is not valid", ["email"]);
  }

  const verdict = await consumeRateLimit(db, "newsletter-subscribe", emailBucketKey("newsletter-subscribe", identity.canonicalEmail), now);
  if (!verdict.allowed) return "limited";

  await db.transaction(async (tx) => {
    const lockExisting = () =>
      tx
        .select()
        .from(newsletterSubscribers)
        .where(eq(newsletterSubscribers.canonicalEmail, identity.canonicalEmail))
        .for("update")
        .limit(1);
    let [existing] = await lockExisting();

    let subscriberId: string | null = null;
    let subscribed = false;
    if (!existing) {
      /*
        Two first posts of one address at the same moment both find no row to lock. The UNIQUE
        constraint decides between them: the loser inserts nothing, waits on the winner's row and
        reads it as the existing one below — the same "check your inbox", never a 500.
      */
      const [row] = await tx
        .insert(newsletterSubscribers)
        .values({
          deliveryEmail: identity.deliveryEmail,
          canonicalEmail: identity.canonicalEmail,
          canonicalizationVersion: identity.canonicalizationVersion,
          locale: input.locale,
          topics,
          privacyNoticeVersion: notice.version,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: newsletterSubscribers.canonicalEmail })
        .returning({ id: newsletterSubscribers.id });
      if (row) subscriberId = row.id;
      else [existing] = await lockExisting();
    }
    if (subscriberId !== null) {
      // Written just now.
    } else if (!existing) {
      throw new Error("newsletter: the address's row is neither new nor readable");
    } else if (existing.confirmedAt === null) {
      // Still unconfirmed: the latest choice is the one the new link confirms.
      await tx
        .update(newsletterSubscribers)
        .set({ deliveryEmail: identity.deliveryEmail, locale: input.locale, topics, privacyNoticeVersion: notice.version, updatedAt: now })
        .where(eq(newsletterSubscribers.id, existing.id));
      subscriberId = existing.id;
    } else {
      /*
        Already subscribed: nothing the form says changes the subscription — whoever typed the
        address may not be its owner. The mailbox gets the link to its own page, where the owner
        changes the topics.
      */
      subscriberId = existing.id;
      subscribed = true;
    }

    await enqueueEmail(tx, {
      participantId: null,
      registrationId: null,
      messageType: "NEWSLETTER_CONFIRM",
      locale: subscribed ? (existing?.locale ?? input.locale) : input.locale,
      recipientEmail: subscribed ? (existing?.deliveryEmail ?? identity.deliveryEmail) : identity.deliveryEmail,
      payload: { subscriberId },
      idempotencyKey: `newsletter:${subscriberId}:confirm:${now.getTime()}`,
      now,
    });
  });
  return "done";
}

/**
 * What the confirmation page shows before the press (GET: nothing changes): the address and the
 * topics the link would confirm, or null for a link that is not live. Throttled per presented link,
 * as every token page is (§19.4, `tokenAttemptAllowed`).
 */
export async function readNewsletterConfirmation<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  now: Date,
): Promise<NewsletterSubscription | null> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return null;
  const subscriber = await readNewsletterToken(db, { secret, purpose: "CONFIRM", now });
  if (!subscriber) return null;
  return { email: subscriber.deliveryEmail, topics: normalizeTopics(subscriber.topics), locale: subscriber.locale as Locale };
}

/** The confirmation's POST: the link spent, the subscription on. `false` for a link that was not live. */
export async function confirmNewsletter<T extends Record<string, unknown>>(db: Database<T>, secret: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const spent = await consumeNewsletterToken(tx, { secret, purpose: "CONFIRM", now });
    if (!spent) return false;
    const subscriberId = spent.subscriberId;
    await tx
      .update(newsletterSubscribers)
      .set({ confirmedAt: now, updatedAt: now })
      .where(and(eq(newsletterSubscribers.id, subscriberId), isNull(newsletterSubscribers.confirmedAt)));
    return true;
  });
}

export type NewsletterSubscription = { email: string; topics: NewsletterTopic[]; locale: Locale };

/** The subscriber's own page, read by its link (GET: nothing changes). Null for a link that is not live. */
export async function readNewsletterSubscription<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  now: Date,
): Promise<NewsletterSubscription | null> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return null;
  const subscriber = await readNewsletterToken(db, { secret, purpose: "MANAGE", now });
  if (!subscriber || subscriber.confirmedAt === null) return null;
  return { email: subscriber.deliveryEmail, topics: normalizeTopics(subscriber.topics), locale: subscriber.locale as Locale };
}

/**
 * New topics from the subscriber's own page. The link is spent (AGENTS.md §12.8: single use, and
 * a POST is what spends it) and its successor minted in the same transaction, with the spent
 * one's expiry — never a longer life — so the page moves to the new link and the person can
 * choose again on the same visit, while the link they pressed works no more. Returns the
 * successor's secret, or null for a link that was not live. No topic at all is refused before
 * anything is spent: that is "unsubscribe", its own button.
 */
export async function updateNewsletterTopics<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  rawTopics: readonly unknown[],
  now: Date,
): Promise<string | null> {
  const topics = normalizeTopics(rawTopics);
  if (topics.length === 0) throw new DomainError("VALIDATION_ERROR", "choose at least one topic, or unsubscribe", ["topics"]);
  return db.transaction(async (tx) => {
    const spent = await consumeNewsletterToken(tx, { secret, purpose: "MANAGE", now });
    if (!spent) return null;
    const [updated] = await tx
      .update(newsletterSubscribers)
      .set({ topics, updatedAt: now })
      .where(and(eq(newsletterSubscribers.id, spent.subscriberId), isNotNull(newsletterSubscribers.confirmedAt)))
      .returning({ id: newsletterSubscribers.id });
    if (!updated) return null;
    return issueNewsletterToken(tx, { subscriberId: updated.id, purpose: "MANAGE", expiresAt: spent.expiresAt, now });
  });
}

/**
 * "Unsubscribe from everything": the link spent, the subscriber deleted, every link of theirs with
 * it (cascade), and every newsletter still waiting for them in the outbox — a newsletter held back
 * by the reserve (`domain/bulk.ts`) must not reach somebody who has since said no. Nothing is kept
 * about them. One transaction: of two presses, one unsubscribes and the other finds no live link.
 */
export async function unsubscribeNewsletter<T extends Record<string, unknown>>(db: Database<T>, secret: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const spent = await consumeNewsletterToken(tx, { secret, purpose: "MANAGE", now });
    if (!spent) return false;
    await deleteSubscriberIn(tx, spent.subscriberId);
    return true;
  });
}

async function deleteSubscriber<T extends Record<string, unknown>>(db: Database<T>, subscriberId: string): Promise<void> {
  await db.transaction(async (tx) => deleteSubscriberIn(tx, subscriberId));
}

async function deleteSubscriberIn<T extends Record<string, unknown>>(tx: Database<T>, subscriberId: string): Promise<void> {
  await tx
    .delete(emailOutbox)
    .where(
      and(
        eq(emailOutbox.status, "PENDING"),
        inArray(emailOutbox.messageType, ["NEWSLETTER_CONFIRM", ...BULK_MESSAGE_TYPES]),
        sql`${emailOutbox.payloadJson}->>'subscriberId' = ${subscriberId}`,
      ),
    );
  await tx.delete(newsletterSubscribers).where(eq(newsletterSubscribers.id, subscriberId));
}

/**
 * Withdrawal by writing to the club (the notice: "or by writing to us"): an Administrator types the
 * address and the subscription goes, found by the canonical identity. Says whether one went — the
 * person asking is staff. The audit row names who and when, never the address.
 */
export async function withdrawNewsletterAddress<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  email: string,
  now: Date,
): Promise<boolean> {
  if (!canManageRegistrations(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not remove a newsletter address`);
  let identity;
  try {
    identity = canonicalizeEmail(email);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "the address is not valid", ["email"]);
  }
  const [subscriber] = await db
    .select({ id: newsletterSubscribers.id })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.canonicalEmail, identity.canonicalEmail))
    .limit(1);
  if (!subscriber) return false;
  await deleteSubscriber(db, subscriber.id);
  await recordAuditEvent(db, { actorStaffUserId: actor.id, action: "newsletter.address_withdrawn", entityType: "newsletter", entityId: null, now });
  return true;
}

/** `receives` (`domain/topics.ts`) as SQL: the subscriber asked for everything, or for one of these topics. */
function receivesSql(topics: readonly NewsletterTopic[]) {
  const wanted = ["ALL", ...topics];
  return sql`${newsletterSubscribers.topics} && ARRAY[${sql.join(
    wanted.map((topic) => sql`${topic}`),
    sql`, `,
  )}]::newsletter_topic[]`;
}

export type NewsletterAudience = {
  /** Confirmed subscribers, all topics. */
  confirmed: number;
  /** Addresses left and not yet confirmed — written to once, never again. */
  unconfirmed: number;
  /** Per topic a message may be written for: who would receive it (the topic's own and "everything"). */
  byTopic: Readonly<Record<Exclude<NewsletterTopic, "ALL">, number>>;
};

/** The counts `/admin/newsletter` shows — numbers only, never an address. */
export async function countNewsletterAudience<T extends Record<string, unknown>>(db: Database<T>): Promise<NewsletterAudience> {
  const [totals] = await db
    .select({
      confirmed: count(sql`CASE WHEN ${newsletterSubscribers.confirmedAt} IS NOT NULL THEN 1 END`),
      unconfirmed: count(sql`CASE WHEN ${newsletterSubscribers.confirmedAt} IS NULL THEN 1 END`),
    })
    .from(newsletterSubscribers);
  const byTopic = {} as Record<Exclude<NewsletterTopic, "ALL">, number>;
  const rows = await db
    .select({ topics: newsletterSubscribers.topics })
    .from(newsletterSubscribers)
    .where(isNotNull(newsletterSubscribers.confirmedAt));
  for (const topic of SENDABLE_TOPICS) {
    byTopic[topic] = rows.filter((row) => row.topics.includes("ALL") || row.topics.includes(topic)).length;
  }
  return { confirmed: totals?.confirmed ?? 0, unconfirmed: totals?.unconfirmed ?? 0, byTopic };
}

export type SendNewsletterInput = {
  topic: string;
  subject: { ro?: string | null; en?: string | null };
  body: { ro?: string | null; en?: string | null };
  /** The composer's own id, minted when the page is drawn: a second press of the same form queues nothing. */
  sendId: string;
};

export type SendNewsletterResult = { kind: "queued"; recipients: number } | { kind: "duplicate" } | { kind: "nobody" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The boxes a refused newsletter names, in the order the form shows them (§47). */
export function refusedNewsletterBoxes(issues: readonly NewsletterIssue[]): string[] {
  return issues.map((issue) => issue.box);
}

/**
 * Queue a newsletter to every confirmed subscriber of one topic (and of "everything").
 *
 * Asserted on the server (BR-REQ-060-01): `canSendNewsletter`. One transaction: the send's row —
 * whose id is the form's, so a second press finds it and queues nothing — the outbox rows, one per
 * subscriber in their language, carrying only the send's and the subscriber's ids (the words are
 * the send's, read at render time), and the audit row with the topic, the count and the subject,
 * never an address or the body (§12.12). The outbox gives them the reserve's share of the
 * allowance (`domain/bulk.ts`), so a newsletter larger than today's room goes over the next days
 * rather than eating a registration's mail. One drain after, not one per row.
 *
 * The club gets **one** copy of the send per address on its copy list (§320's spirit, §419's
 * shape): the words and how many subscribers it went to, with no token, no manage link and no
 * address — the record of what went out in the club's name.
 */
export async function sendNewsletter<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  input: SendNewsletterInput,
  now: Date,
): Promise<SendNewsletterResult> {
  if (!canSendNewsletter(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not send the newsletter`);
  if (!isSendableTopic(input.topic)) throw new DomainError("VALIDATION_ERROR", "topic: choose what the newsletter is about", ["topic"]);
  if (!UUID.test(input.sendId)) throw new DomainError("VALIDATION_ERROR", "sendId: the form carries no id of its own; reload the page");
  const checked = checkNewsletterWords({ subject: input.subject, body: input.body });
  if (!checked.words) {
    throw new DomainError(
      "VALIDATION_ERROR",
      checked.issues.map((issue) => `${issue.box}: ${issue.problem}`).join("; "),
      refusedNewsletterBoxes(checked.issues),
    );
  }
  const words = checked.words;
  const topic = input.topic;

  const result = await db.transaction(async (tx) => {
    const [already] = await tx.select({ id: newsletterSends.id }).from(newsletterSends).where(eq(newsletterSends.id, input.sendId)).limit(1);
    if (already) return { kind: "duplicate" } as const;

    const recipients = await tx
      .select({ id: newsletterSubscribers.id, locale: newsletterSubscribers.locale, email: newsletterSubscribers.deliveryEmail })
      .from(newsletterSubscribers)
      .where(and(isNotNull(newsletterSubscribers.confirmedAt), receivesSql([topic])));
    if (recipients.length === 0) return { kind: "nobody" } as const;

    await tx.insert(newsletterSends).values({
      id: input.sendId,
      kind: "MESSAGE",
      topics: [topic],
      subject: words.subject,
      body: words.body,
      recipients: recipients.length,
      sentByStaffUserId: actor.id,
      createdAt: now,
    });
    for (const recipient of recipients) {
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "NEWSLETTER",
        locale: recipient.locale,
        recipientEmail: recipient.email,
        payload: { sendId: input.sendId, subscriberId: recipient.id },
        idempotencyKey: `newsletter:${input.sendId}:subscriber:${recipient.id}`,
        requestedByStaffUserId: actor.id,
        now,
        drainAfter: false,
      });
    }
    await enqueueBulkClubCopies(tx, {
      messageType: "NEWSLETTER",
      eventId: null,
      payload: { sendId: input.sendId },
      sendKey: `newsletter:${input.sendId}`,
      realRecipients: recipients.length,
      requestedByStaffUserId: actor.id,
      now,
    });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "newsletter.sent",
      entityType: "newsletter",
      entityId: input.sendId,
      metadata: { topic, recipients: recipients.length, subject: words.subject },
      now,
    });
    return { kind: "queued", recipients: recipients.length } as const;
  });
  if (result.kind === "queued") drainOutboxAfterResponse();
  return result;
}

export type NewsletterSendRow = {
  at: Date;
  kind: "MESSAGE" | "EVENT_ALERT";
  topics: NewsletterTopic[];
  /** The subject as written, both languages; an alert's is null — its words are the event's. */
  subject: { ro: string; en: string } | null;
  eventId: string | null;
  recipients: number;
  senderName: string | null;
};

/** "Trimise": the last sends, newest first — date, subject or event, topics, how many, who. Never a recipient. */
export async function listNewsletterSends<T extends Record<string, unknown>>(db: Database<T>, limit = 20): Promise<NewsletterSendRow[]> {
  const rows = await db
    .select({
      at: newsletterSends.createdAt,
      kind: newsletterSends.kind,
      topics: newsletterSends.topics,
      subject: newsletterSends.subject,
      body: newsletterSends.body,
      eventId: newsletterSends.eventId,
      recipients: newsletterSends.recipients,
      senderName: staffUsers.displayName,
    })
    .from(newsletterSends)
    .leftJoin(staffUsers, eq(staffUsers.id, newsletterSends.sentByStaffUserId))
    // An alert that reached nobody is the marker that the event was seen, not a send worth listing.
    .where(sql`${newsletterSends.kind} = 'MESSAGE' OR ${newsletterSends.recipients} > 0`)
    .orderBy(desc(newsletterSends.createdAt))
    .limit(limit);
  return rows.map((row) => {
    const words = readNewsletterWords(row.subject, row.body);
    return {
      at: row.at,
      kind: row.kind,
      topics: row.topics,
      subject: words ? { ro: words.subject.ro, en: words.subject.en } : null,
      eventId: row.eventId,
      recipients: row.recipients,
      senderName: row.senderName ?? null,
    };
  });
}

/**
 * The maintenance job's step (AGENTS.md §16.2): every event first published within the window
 * (`eventAlertWanted`) and not yet announced gets its one `EVENT_ALERT` send — the row is the
 * "once", by its UNIQUE event — and one `NEW_EVENT_ALERT` per confirmed subscriber of its topics.
 * An event with nobody to tell still gets its row: it has been seen, and a subscriber who joins
 * tomorrow is not told about last week's event as if it were new.
 *
 * **Never twice in a day** (`alertDayOf`): once an alert that reached somebody was queued on this
 * club day, the rest wait for tomorrow's first run — oldest publication first — and an event with
 * nobody to tell is marked seen without spending the day's one.
 */
export async function queueNewEventAlerts<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const since = new Date(now.getTime() - EVENT_ALERT_WINDOW_DAYS * 24 * 60 * 60_000);
  const candidates = await db
    .select({
      id: events.id,
      type: events.type,
      isSpecial: events.isSpecial,
      editorialStatus: events.editorialStatus,
      eventStatus: events.eventStatus,
      startsAt: events.startsAt,
      publishedAt: events.publishedAt,
      repeatOf: events.repeatOf,
      coHosts: events.coHosts,
      coHostName: events.coHostName,
      coHostUrl: events.coHostUrl,
    })
    .from(events)
    .leftJoin(newsletterSends, eq(newsletterSends.eventId, events.id))
    .where(
      and(
        isNull(newsletterSends.id),
        eq(events.editorialStatus, "PUBLISHED"),
        eq(events.eventStatus, "SCHEDULED"),
        sql`${events.publishedAt} >= ${since.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(events.publishedAt), asc(events.id));

  // Whether today's one announcement already went (`alertDayOf`): the sends of the last day and a bit, read in the club's zone.
  const today = alertDayOf(now, CLUB_TIME_ZONE);
  const recent = await db
    .select({ at: newsletterSends.createdAt })
    .from(newsletterSends)
    .where(
      and(
        eq(newsletterSends.kind, "EVENT_ALERT"),
        sql`${newsletterSends.recipients} > 0`,
        sql`${newsletterSends.createdAt} >= ${new Date(now.getTime() - 26 * 60 * 60_000).toISOString()}::timestamptz`,
      ),
    );
  let announcedToday = recent.some((row) => alertDayOf(row.at, CLUB_TIME_ZONE) === today);

  let queued = 0;
  let drain = false;
  for (const row of candidates) {
    const event = { ...row, partnered: readCoHosts(row).length > 0 };
    if (!eventAlertWanted(event, now)) continue;
    const topics = eventAlertTopics(event);
    // Somebody would be told: that waits for tomorrow once today's one went. Nobody: marked seen now.
    const [{ audience }] = await db
      .select({ audience: count() })
      .from(newsletterSubscribers)
      .where(and(isNotNull(newsletterSubscribers.confirmedAt), receivesSql(topics)));
    if (audience > 0 && announcedToday) continue;
    await db.transaction(async (tx) => {
      const [send] = await tx
        .insert(newsletterSends)
        .values({ kind: "EVENT_ALERT", topics, eventId: event.id, createdAt: now })
        .onConflictDoNothing({ target: newsletterSends.eventId })
        .returning({ id: newsletterSends.id });
      if (!send) return;
      const recipients = await tx
        .select({ id: newsletterSubscribers.id, locale: newsletterSubscribers.locale, email: newsletterSubscribers.deliveryEmail })
        .from(newsletterSubscribers)
        .where(and(isNotNull(newsletterSubscribers.confirmedAt), receivesSql(topics)));
      for (const recipient of recipients) {
        const inserted = await enqueueEmail(tx, {
          participantId: null,
          registrationId: null,
          messageType: "NEW_EVENT_ALERT",
          locale: recipient.locale,
          recipientEmail: recipient.email,
          payload: { sendId: send.id, eventId: event.id, subscriberId: recipient.id },
          idempotencyKey: `newsletter:${send.id}:subscriber:${recipient.id}`,
          now,
          drainAfter: false,
        });
        if (inserted) queued += 1;
      }
      if (recipients.length > 0) {
        await tx.update(newsletterSends).set({ recipients: recipients.length }).where(eq(newsletterSends.id, send.id));
        // The club's one copy of the announcement, with the count (§NNN, as for a newsletter above).
        await enqueueBulkClubCopies(tx, {
          messageType: "NEW_EVENT_ALERT",
          eventId: event.id,
          payload: { sendId: send.id, eventId: event.id },
          sendKey: `newsletter:${send.id}`,
          realRecipients: recipients.length,
          now,
        });
        drain = true;
        announcedToday = true;
      }
    });
  }
  if (drain) drainOutboxAfterResponse();
  return queued;
}
