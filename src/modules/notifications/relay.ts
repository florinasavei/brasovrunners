import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { type EmailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import type { EmailLocale, OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canWriteLegalTexts } from "@/modules/staff-identity/domain/roles";
import { listStaffUsers } from "@/modules/staff-identity/repository";
import { env } from "@/shared/config/env";
import { rejectionCause } from "./domain/rejection-cause";
import { DELETED_RELAY_PAYLOAD, RELAY_GIVE_UP_MS, RELAY_MESSAGE_TYPES, type RelayMessageType } from "./domain/relay";
import {
  otherRoad,
  planRoad,
  readRoadFailures,
  readRoadOutcome,
  type Road,
  type RoadFailures,
  withFailure,
} from "./domain/road-failover";
import { nextAttemptAt, PROCESSING_LOCK_TIMEOUT_MS, sanitizeProviderError } from "./domain/retry";
import { type RelayNoticeFacts, type RelayNoticeKind, relayNoticeContent } from "./relay-notice-words";

/**
 * The worker for a visitor's message (§778, amending §149, §676, §772 and §622): `CONTACT_MESSAGE`,
 * `FEEDBACK_MESSAGE` and the platform's own `RELAY_NOTICE` — rows of the same outbox the notifications use, claimed
 * apart from them (`claimOutboxBatch` leaves these types alone) because they have no template, no participant and
 * a road of their own. See `domain/relay.ts` for the three differences and `domain/road-failover.ts` for the rule.
 *
 * - **Queued** by the form's action: one row, the words in `payload_json`, the road the club chose in `road`.
 * - **Sent** at once, after the response (`drainRelayAfterResponse`), by that road; the outbox job takes what is left.
 * - **A failure of the service** is counted against the road; after `RELAY_FAILOVER_AFTER` the other road gets its
 *   turn when the message may take it, and the row says it left by it (`transport` is not `road`). A failure that may
 *   have come after the service took the message pins the message to that road: never two roads for one message.
 * - **A refusal of the address** ends it BOUNCED, and no other road is tried.
 * - **Delivered**, the words are deleted: `payload_json` becomes `{ "deleted": true }` and `body_deleted_at` is set. The
 *   row stays as the record — the road, the time, the provider's id — which is what the owner could not see before.
 * - **Not delivered in a day**, the Administrators are told (`RELAY_NOTICE`), the words are deleted, the row is FAILED.
 */
type Db = Database<{ emailOutbox: typeof emailOutbox }>;

export type OutboxRow = typeof emailOutbox.$inferSelect;

/** What a relay row carries until it is delivered — the composed message, never stored once it has left. */
export type RelayPayload = {
  subject: string;
  text: string;
  html: string;
  cc?: string[];
  bcc?: string[];
  /** The address a reply goes to, and the name typed beside it (§678). */
  replyTo?: string;
  replyToName?: string;
  /** No Reply-To at all (§676): an anonymous message answers nobody. */
  noReplyTo?: true;
  /** The other road may carry it: every form by default; Girl Zone only with the club’s tick and the notice’s words (§772). */
  fallbackAllowed: boolean;
  /** Which form it came from, for the notice (§149, §676). */
  form?: "contact" | "feedback";
  /** The platform’s own notice: when it is lost, no notice about it is queued. */
  notice?: true;
};

/** A row's payload as a message, or `null` when its words are already deleted (or it was never one). */
export function readRelayPayload(value: unknown): RelayPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (typeof payload.subject !== "string" || typeof payload.text !== "string" || typeof payload.html !== "string") return null;
  const list = (name: string): string[] | undefined => {
    const stored = payload[name];
    return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === "string") : undefined;
  };
  return {
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    ...(list("cc")?.length ? { cc: list("cc") } : {}),
    ...(list("bcc")?.length ? { bcc: list("bcc") } : {}),
    ...(typeof payload.replyTo === "string" && payload.replyTo !== "" ? { replyTo: payload.replyTo } : {}),
    ...(typeof payload.replyToName === "string" && payload.replyToName !== "" ? { replyToName: payload.replyToName } : {}),
    ...(payload.noReplyTo === true ? { noReplyTo: true as const } : {}),
    fallbackAllowed: payload.fallbackAllowed === true,
    ...(payload.form === "contact" || payload.form === "feedback" ? { form: payload.form } : {}),
    ...(payload.notice === true ? { notice: true as const } : {}),
  };
}

export type EnqueueRelayParams = {
  type: RelayMessageType;
  /** The road the club chose for this form. */
  road: Road;
  /** The first recipient; the rest ride as `cc` (visible, as the contact form always showed them) and `bcc`. */
  to: string;
  locale: EmailLocale;
  content: Omit<RelayPayload, "cc" | "bcc"> & { cc?: readonly string[]; bcc?: readonly string[] };
  /** A trigger that must queue once (the platform’s notices); absent, a fresh key — every visitor’s message is its own. */
  idempotencyKey?: string;
  now: Date;
};

/** One message queued. Returns the row, or `null` when its key was queued already. */
export async function enqueueRelay<T extends Record<string, unknown>>(db: Database<T>, params: EnqueueRelayParams): Promise<OutboxRow | null> {
  const { cc, bcc, ...rest } = params.content;
  const payload: RelayPayload = { ...rest, ...(cc && cc.length > 0 ? { cc: [...cc] } : {}), ...(bcc && bcc.length > 0 ? { bcc: [...bcc] } : {}) };
  const [row] = await db
    .insert(emailOutbox)
    .values({
      participantId: null,
      registrationId: null,
      messageType: params.type,
      locale: params.locale,
      recipientEmail: params.to,
      payloadJson: payload,
      idempotencyKey: params.idempotencyKey ?? `relay:${randomUUID()}`,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: null,
      road: params.road,
      createdAt: params.now,
    })
    .onConflictDoNothing({ target: emailOutbox.idempotencyKey })
    .returning();
  return row ?? null;
}

/** What the worker needs of the two roads: which exist now, and one message sent by one of them. */
export type RelayRoads = {
  /** Gmail configured (or the laptop’s capture); Mailgun transmitting and not stopped. Read once per batch. */
  available(now: Date): Promise<Record<Road, boolean>>;
  /** One message by exactly this road — never the other, whatever it answers. */
  send(road: Road, message: OutgoingEmail): Promise<SendResult>;
  close?(): void;
};

export type RelaySummary = {
  claimed: number;
  sent: number;
  /** Failed on a road and due again. */
  retrying: number;
  /** Not tried: the road it is pinned to is down, or none exists. */
  waiting: number;
  bounced: number;
  lost: number;
  /** Of `sent`, the ones that left by the other road. */
  failedOver: number;
};

export const EMPTY_RELAY_SUMMARY: RelaySummary = { claimed: 0, sent: 0, retrying: 0, waiting: 0, bounced: 0, lost: 0, failedOver: 0 };

/** The first two retries of a message are seconds, not minutes: a person’s message, and the after-response drain waits for them. */
const QUICK_RETRY_MS = [3_000, 5_000] as const;

function retryAt(now: Date, attemptCount: number): Date {
  const quick = QUICK_RETRY_MS[attemptCount - 1];
  return quick !== undefined ? new Date(now.getTime() + quick) : nextAttemptAt(now, attemptCount - QUICK_RETRY_MS.length);
}

/** How long a message waits when no road can carry it now (a pinned road that is down): a few minutes, then again. */
const NO_ROAD_WAIT_MS = 5 * 60_000;

/** The rows this batch may take: relay types, due; or claimed long ago by a worker that died. */
async function claimRelayRows(db: Db, now: Date, batchSize: number, ids?: readonly string[]): Promise<OutboxRow[]> {
  if (ids && ids.length === 0) return [];
  const staleBefore = new Date(now.getTime() - PROCESSING_LOCK_TIMEOUT_MS);
  const due = and(
    inArray(emailOutbox.messageType, [...RELAY_MESSAGE_TYPES] as EmailMessageType[]),
    or(
      and(eq(emailOutbox.status, "PENDING"), or(isNull(emailOutbox.nextAttemptAt), lte(emailOutbox.nextAttemptAt, now))),
      and(eq(emailOutbox.status, "PROCESSING"), lte(emailOutbox.lockedAt, staleBefore)),
    ),
    ids ? inArray(emailOutbox.id, [...ids]) : undefined,
  );
  return db.transaction(async (tx) => {
    // Two statements, as the main claim (§644): a select that locks, then an update of exactly those.
    const picked = await tx
      .select({ id: emailOutbox.id })
      .from(emailOutbox)
      .where(due)
      .orderBy(asc(emailOutbox.createdAt))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (picked.length === 0) return [];
    const claimed = await tx
      .update(emailOutbox)
      .set({ status: "PROCESSING", lockedAt: now, attemptCount: sql`${emailOutbox.attemptCount} + 1` })
      .where(inArray(emailOutbox.id, picked.map((row) => row.id)))
      .returning();
    return claimed.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  });
}

function outgoing(row: OutboxRow, payload: RelayPayload): OutgoingEmail {
  return {
    to: row.recipientEmail,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    ...(payload.cc?.length ? { cc: payload.cc } : {}),
    ...(payload.bcc?.length ? { bcc: payload.bcc } : {}),
    locale: row.locale,
    // One key for the message, whichever road carries it: Mailgun’s webhook and Gmail’s `X-Outbox-Key` say the same.
    idempotencyKey: row.idempotencyKey,
    ...(payload.noReplyTo ? { noReplyTo: true as const } : {}),
    ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
    ...(payload.replyTo && payload.replyToName ? { replyToName: payload.replyToName } : {}),
  };
}

/**
 * Sends the relay rows that are due (or exactly `ids`), one at a time, each outcome written as it happens — a crash
 * halfway leaves the earlier rows right, as `processOutboxBatch` does. The provider call has no transaction open.
 */
export async function processRelayBatch(
  db: Db,
  params: { /** Or a factory, called only when a row was claimed: a ping with nothing to send reads nothing about the roads. */ roads: RelayRoads | (() => Promise<RelayRoads>); now: Date; batchSize?: number; ids?: readonly string[]; /** Notices queued by this batch are sent by the batch’s own second pass, and raise none of their own. */ passingNotices?: boolean },
): Promise<RelaySummary> {
  const { now, batchSize = 20, ids } = params;
  const summary: RelaySummary = { ...EMPTY_RELAY_SUMMARY };
  const startedAtMs = Date.now();
  const clock = () => new Date(now.getTime() + (Date.now() - startedAtMs));

  const rows = await claimRelayRows(db, now, batchSize, ids);
  summary.claimed = rows.length;
  if (rows.length === 0) return summary;
  const noticeIds: string[] = [];
  const roads = typeof params.roads === "function" ? await params.roads() : params.roads;

  try {
    const available = await roads.available(clock());
    for (const row of rows) {
      const payload = readRelayPayload(row.payloadJson);
      if (!payload) {
        // The words are gone (a row that was delivered and then claimed stale): nothing to send, nothing to say.
        await db
          .update(emailOutbox)
          .set({ status: "FAILED", lockedAt: null, nextAttemptAt: null, lastError: "the words of this message were already deleted", payloadJson: DELETED_RELAY_PAYLOAD, bodyDeletedAt: row.bodyDeletedAt ?? clock() })
          .where(eq(emailOutbox.id, row.id));
        summary.lost += 1;
        continue;
      }
      const chosen: Road = row.road ?? "mailgun";
      const failures = readRoadFailures(row.roadFailures);
      const plan = planRoad({ chosen, failures, available, fallbackAllowed: payload.fallbackAllowed });
      const aged = () => clock().getTime() - row.createdAt.getTime() >= RELAY_GIVE_UP_MS;

      if (plan.road === null) {
        if (aged()) {
          noticeIds.push(...(await giveUp(db, row, payload, failures, `no road could carry it (${plan.why})`, clock())));
          summary.lost += 1;
        } else {
          await db
            .update(emailOutbox)
            .set({ status: "PENDING", lockedAt: null, attemptCount: Math.max(0, row.attemptCount - 1), nextAttemptAt: new Date(clock().getTime() + NO_ROAD_WAIT_MS) })
            .where(eq(emailOutbox.id, row.id));
          summary.waiting += 1;
        }
        continue;
      }

      const road = plan.road;
      let result: SendResult;
      try {
        result = await roads.send(road, outgoing(row, payload));
      } catch (error) {
        // An adapter that throws says nothing about whether the service has the message: ambiguous, so it stays on its road.
        result = { outcome: "transient_failure", error: sanitizeProviderError(error), mayHaveBeenAccepted: true };
      }
      const outcome = readRoadOutcome(result);

      if (result.outcome === "sent") {
        const at = clock();
        await db
          .update(emailOutbox)
          .set({
            status: "SENT",
            sentAt: result.acceptedAt ?? at,
            providerMessageId: result.providerMessageId,
            // The road that carried it, which is not always the one chosen: that difference is the failover.
            transport: road,
            recipientCount: result.recipients ?? null,
            lockedAt: null,
            nextAttemptAt: null,
            lastError: null,
            payloadJson: DELETED_RELAY_PAYLOAD,
            bodyDeletedAt: at,
          })
          .where(eq(emailOutbox.id, row.id));
        summary.sent += 1;
        if (plan.failedOver) {
          summary.failedOver += 1;
          noticeIds.push(...(await noteFailover(db, row, payload, chosen, road, failures, at, params.passingNotices === true)));
        }
        continue;
      }

      if (outcome.kind === "recipient") {
        const at = clock();
        const error = sanitizeProviderError(outcome.error);
        await db
          .update(emailOutbox)
          .set({
            status: "BOUNCED",
            lockedAt: null,
            nextAttemptAt: null,
            lastError: error,
            rejectedAt: at,
            rejectionCause: rejectionCause({ status: "BOUNCED", sent: false, reason: error }),
            payloadJson: DELETED_RELAY_PAYLOAD,
            bodyDeletedAt: at,
          })
          .where(eq(emailOutbox.id, row.id));
        console.error(`[email-relay] ${row.messageType} refused for its address by ${road}: ${error}`);
        summary.bounced += 1;
        if (!payload.notice && !params.passingNotices) {
          noticeIds.push(...(await queueNotice(db, "lost", { road: chosen, ...(payload.form ? { form: payload.form } : {}), errors: { [road]: error } }, payload, at)));
        }
        continue;
      }

      if (outcome.kind === "paced") {
        // Held back by Gmail’s pace: nothing was tried, so the attempt the claim counted is given back.
        await db
          .update(emailOutbox)
          .set({ status: "PENDING", lockedAt: null, attemptCount: Math.max(0, row.attemptCount - 1), nextAttemptAt: outcome.until ?? new Date(clock().getTime() + 5_000) })
          .where(eq(emailOutbox.id, row.id));
        summary.waiting += 1;
        continue;
      }

      // Unreachable: a sent result was handled above. It narrows the union for what follows.
      if (outcome.kind === "sent") continue;

      // The service’s failure, or an ambiguous one: counted against the road, the message due again.
      const error = sanitizeProviderError(outcome.error);
      const next: RoadFailures = withFailure(failures, road, { error, ambiguous: outcome.kind === "ambiguous", immediate: outcome.kind === "service" && outcome.immediate });
      if (outcome.kind === "service" && outcome.immediate && road === "mailgun") available.mailgun = false;
      if (aged()) {
        noticeIds.push(...(await giveUp(db, row, payload, next, error, clock())));
        summary.lost += 1;
        continue;
      }
      await db
        .update(emailOutbox)
        .set({ status: "PENDING", lockedAt: null, nextAttemptAt: retryAt(clock(), row.attemptCount), lastError: error, roadFailures: next })
        .where(eq(emailOutbox.id, row.id));
      summary.retrying += 1;
    }
  } finally {
    roads.close?.();
  }

  // The notices this batch queued go out now, by the road that works, in a pass of their own (and raise none).
  if (noticeIds.length > 0 && !params.passingNotices) {
    const second = await processRelayBatch(db, { ...params, ids: noticeIds, passingNotices: true });
    summary.claimed += second.claimed;
  }
  return summary;
}

/** The message no road carried in a day: words deleted, the Administrators told, the row FAILED as the record. */
async function giveUp(db: Db, row: OutboxRow, payload: RelayPayload, failures: RoadFailures, why: string, at: Date): Promise<string[]> {
  const chosen: Road = row.road ?? "mailgun";
  await db
    .update(emailOutbox)
    .set({
      status: "FAILED",
      lockedAt: null,
      nextAttemptAt: null,
      lastError: `gave up after a day: ${why}`.slice(0, 500),
      roadFailures: failures,
      payloadJson: DELETED_RELAY_PAYLOAD,
      bodyDeletedAt: at,
    })
    .where(eq(emailOutbox.id, row.id));
  console.error(`[email-relay] ${row.messageType} could not be delivered in a day and its words are deleted: ${why}`);
  await recordAuditEvent(db, { actorStaffUserId: null, action: "email_relay.lost", entityType: "email_outbox", entityId: row.id, metadata: { type: row.messageType, chosen, cause: "undelivered" }, now: at });
  if (payload.notice) return [];
  return queueNotice(
    db,
    "lost",
    {
      road: chosen,
      ...(payload.form ? { form: payload.form } : {}),
      errors: { ...(failures.gmail?.lastError ? { gmail: failures.gmail.lastError } : {}), ...(failures.mailgun?.lastError ? { mailgun: failures.mailgun.lastError } : {}) },
    },
    payload,
    at,
  );
}

/** A message left by the other road: the operations-log line, the audit row, and the day’s notice that the chosen road is down. */
async function noteFailover(db: Db, row: OutboxRow, payload: RelayPayload, chosen: Road, via: Road, failures: RoadFailures, at: Date, passingNotices: boolean): Promise<string[]> {
  const count = failures[chosen]?.count ?? 0;
  console.warn(`[email-relay] ${row.messageType} left by ${via}: ${chosen} ${count > 0 ? `failed it ${count} time(s)` : "was not available"}`);
  await recordAuditEvent(db, { actorStaffUserId: null, action: "email_road.failed_over", entityType: "email_outbox", entityId: row.id, metadata: { type: row.messageType, chosen, via, failures: count }, now: at });
  if (payload.notice || passingNotices) return [];
  const error = failures[chosen]?.lastError;
  return queueNotice(db, "roadDown", { road: chosen, carriedBy: via, ...(error ? { errors: { [chosen]: error } } : {}) }, payload, at, via);
}

/**
 * The platform’s notice to every Administrator and Superadministrator, in the language of their row — «a road is down»
 * once a road a club day (a message after message must not become an email after email), «a message could not be delivered»
 * once a form a club day. Carried by the working road, by this same worker. Returns the rows’ ids for the batch’s second pass.
 */
async function queueNotice(
  db: Db,
  kind: RelayNoticeKind,
  facts: Omit<RelayNoticeFacts, "pageUrl">,
  payload: RelayPayload,
  at: Date,
  via: Road = otherRoad(facts.road),
): Promise<string[]> {
  if (payload.notice) return [];
  // One notice per road per **club** day for «a road is down», and one per form per club day for «a message was lost»: a mistyped
  // recipient that bounces every message must not email every Administrator once per message (the list on the page has each one).
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const scope = kind === "roadDown" ? `${facts.road}:${day}` : `${facts.form ?? "contact"}:${day}`;
  const recipients = (await listStaffUsers(db)).filter((member) => canWriteLegalTexts(member.role) && member.email.trim() !== "");
  const queued: string[] = [];
  for (const member of recipients) {
    const locale: EmailLocale = member.preferredLocale;
    const pageUrl = `${env.APP_BASE_URL}${getPathname({ locale, href: "/admin/settings/emails" })}`;
    const content = relayNoticeContent(kind, locale, { ...facts, pageUrl });
    const row = await enqueueRelay(db, {
      type: "RELAY_NOTICE",
      road: via,
      to: member.email,
      locale,
      content: { ...content, noReplyTo: true, fallbackAllowed: true, notice: true },
      idempotencyKey: `relay-notice:${kind}:${scope}:${member.id}`,
      now: at,
    });
    if (row) queued.push(row.id);
  }
  return queued;
}
