import { and, eq, or, sql } from "drizzle-orm";
import { type EmailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { DomainError } from "@/shared/errors/domain-error";
import { readClubNotices } from "./club-notices";
import { clubCopyRecipients, isCopiedPerMessage, participantMessageBcc } from "./domain/club-notices";
import { roomToSendNow, SENT_NOW_FLAG } from "./domain/send-at-once";
import { preferredTransport, roadsByMessageType } from "./domain/email-transport";
import { gmailIsConfigured, readEmailTransport } from "./email-transport";
import { fallbackSwitchOn, routeWhileStopped, type StopRoute, type StopWaitReason } from "./domain/mailgun-stop";
import { readEmailVolumeToday } from "./volume";

/**
 * The server half of «Trimite acum, fără să aștepte trecerea programată» (§540, amending §513, §80
 * and §68): the press's own rows, and only those, sent right after its response, inside the day's
 * allowance and through the road the message's group is set to (§443). What a press sends:
 *
 * - **its own rows** — the message it queued and the club's copies that ride on it (§320, §419),
 *   found by the idempotency key the press wrote (`outboxIdsForKey`), never the rest of the queue:
 *   everything automatic keeps «Când pleacă emailurile»;
 * - **inside the allowance** (§80): checked before anything is queued (`assertRoomToSendNow`). A
 *   press over it is refused with a sentence and queues nothing — never a silent defer; «Pune la
 *   coadă» is the answer that waits for the reset;
 * - **through the same worker** (`processOutboxBatch`, §16.2): claimed under `FOR UPDATE SKIP
 *   LOCKED`, rendered, retried and deferred as at 03:00. A row already sent, bounced or failed is
 *   not claimed (§39: a resend is a new row, and the same message is never sent twice).
 */

/** The refusal's code, a sentence in `Admin.errors` (§540). */
export const SEND_NOW_ALLOWANCE_SPENT = "SEND_NOW_ALLOWANCE_SPENT";
/** The hour's refusal (§605): Mailgun's hourly pace has no room for the press; a sentence in `Admin.errors`. */
export const SEND_NOW_HOUR_SPENT = "SEND_NOW_HOUR_SPENT";

/**
 * Mailgun said stop and Gmail cannot carry the press (§NNN): one sentence per remedy, in
 * `Admin.errors` — turn the switch on, configure Gmail, approve the notice that names the fallback,
 * raise Gmail's cap — each saying that waiting for Mailgun's return is the other answer. Never
 * «0 trimise» in silence.
 */
export const SEND_NOW_STOPPED_REFUSALS = {
  fallbackOff: "SEND_NOW_MAILGUN_STOPPED_FALLBACK_OFF",
  gmailUnconfigured: "SEND_NOW_MAILGUN_STOPPED_NO_GMAIL",
  noticeMissing: "SEND_NOW_MAILGUN_STOPPED_NOTICE",
  gmailCapSpent: "SEND_NOW_MAILGUN_STOPPED_GMAIL_FULL",
} as const satisfies Record<StopWaitReason, string>;

type SendNowRefusalReason =
  | typeof SEND_NOW_ALLOWANCE_SPENT
  | typeof SEND_NOW_HOUR_SPENT
  | (typeof SEND_NOW_STOPPED_REFUSALS)[StopWaitReason];

/**
 * A press that asked to send now past what Mailgun still holds (§80, §540): the day's allowance, or
 * since §605 the hour's pace, or since §NNN Mailgun's stop with nothing to carry for it. `reason`
 * names which, and is the sentence's key; `until` is when Mailgun's road opens again, for the page
 * that can say it.
 */
export class SendNowRefused extends DomainError {
  readonly reason: SendNowRefusalReason;
  readonly until: Date | null;
  constructor(message: string, reason: SendNowRefusalReason = SEND_NOW_ALLOWANCE_SPENT, until: Date | null = null) {
    super("VALIDATION_ERROR", message);
    this.name = "SendNowRefused";
    this.reason = reason;
    this.until = until;
  }
}

/** The refusal of a press while Mailgun is stopped and Gmail cannot carry it (§NNN). */
export function stoppedRefusal(route: Extract<StopRoute, { road: "wait" }>): SendNowRefused {
  return new SendNowRefused(
    `Mailgun is stopped (${route.stop.kind}) until ${route.stop.until.toISOString()} and Gmail cannot carry the press: ${route.reason}`,
    SEND_NOW_STOPPED_REFUSALS[route.reason],
    route.stop.until,
  );
}

/** The code a backoffice action lands on: the allowance's own sentence, or the domain code. */
export function sendNowRefusalCode(error: DomainError): string {
  return error instanceof SendNowRefused ? error.reason : error.code;
}

/**
 * Refuses a press whose Mailgun messages the day's allowance cannot hold — the participants' and the
 * club's copies that ride on them (`clubCopyTypes`), each on its own group's road. Gmail's road costs
 * the allowance nothing (§443); a road that is Gmail's where Gmail is not configured is Mailgun's.
 *
 * And, since §605, the hour: a press whose Mailgun messages the hourly pace has no room for is
 * refused the same way, with its own sentence — the claim would hold them back anyway, and a «now»
 * that leaves in forty minutes is not what the person pressed. «Pune la coadă» is the answer.
 */
export async function assertRoomToSendNow<T extends Record<string, unknown>>(
  db: Database<T>,
  messageTypes: readonly EmailMessageType[],
  now: Date,
  clubCopyTypes: readonly EmailMessageType[] = [],
): Promise<void> {
  if (messageTypes.length === 0 && clubCopyTypes.length === 0) return;
  const [setting, volume] = await Promise.all([readEmailTransport(db), readEmailVolumeToday(db, now)]);
  const gmail = gmailIsConfigured();
  const roads = roadsByMessageType(setting, gmail);
  const copyRoad = (type: EmailMessageType) => (gmail ? preferredTransport(setting, type, true) : "mailgun");
  const mailgunMessages =
    messageTypes.filter((type) => roads[type] === "mailgun").length + clubCopyTypes.filter((type) => copyRoad(type) === "mailgun").length;
  if (mailgunMessages === 0) return;
  /*
    Mailgun said stop (§NNN): the claim reads the same facts. With «Gmail preia când Mailgun se oprește»
    on and room in Gmail's day for every message of the press, Gmail carries it — the day's and the
    hour's Mailgun figures are not asked, nothing of the press goes to Mailgun. Otherwise refused with
    the sentence that names the remedy, and the moment Mailgun's road opens again.
  */
  const total = messageTypes.length + clubCopyTypes.length;
  const whileStopped = routeWhileStopped({
    stop: volume.mailgunStop,
    fallbackToGmail: fallbackSwitchOn(setting),
    noticeNamesFallback: volume.fallbackDisclosed,
    gmailConfigured: volume.gmailConfigured,
    gmailRoom: volume.gmailRoom,
    needed: total,
  });
  if (whileStopped.road === "gmail") return;
  if (whileStopped.road === "wait") throw stoppedRefusal(whileStopped);
  /*
    The day's counter spent but Mailgun has not said so yet: refused, as §100 has it. A press that went
    to Mailgun on a paid plan would be billed as overage rather than refused, so nothing here assumes
    Gmail will catch it; the scheduled drain does that, and Mailgun's own refusal records the stop.
  */
  if (!roomToSendNow({ remaining: volume.remaining, mailgunMessages })) {
    throw new SendNowRefused(`the day's Mailgun allowance has ${volume.remaining} left; ${mailgunMessages} would be sent now`);
  }
  if (!roomToSendNow({ remaining: volume.hourRemaining, mailgunMessages })) {
    throw new SendNowRefused(`Mailgun's hourly pace has ${volume.hourRemaining} left this hour; ${mailgunMessages} would be sent now`, SEND_NOW_HOUR_SPENT);
  }
}

/**
 * The club's copies a press's message brings with it, one message type per copy (§320, §419): per
 * message for a real registration's own message (`enqueueClubCopies`), one per address for a send to
 * many (`perSend`, `enqueueBulkClubCopies`). What the allowance check counts beside the message.
 */
export async function clubCopyTypesFor<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { messageType: EmailMessageType; recipientEmail: string; real: boolean; perSend?: boolean },
): Promise<EmailMessageType[]> {
  if (!input.real || (!input.perSend && !isCopiedPerMessage(input.messageType))) return [];
  const recipients = clubCopyRecipients(input.perSend ? "" : input.recipientEmail, participantMessageBcc(await readClubNotices(db)));
  return recipients.map(() => input.messageType);
}

/**
 * The rows one press queued: the key it wrote, and every row keyed under it — the club's copies
 * (`<key>:club-copy:<address>`) and, for a send to many, each recipient's (`<key>:registration:<id>`).
 *
 * Only waiting rows (`PENDING`): the press has just queued them and nothing else may send them but
 * this drain or the outbox job — and only a waiting row can be claimed anyway. The status is the
 * claim index's first column (`email_outbox_status_next_attempt_created_idx`), so the prefix is
 * compared over the queue, never over every message the club ever sent (§540 review).
 */
export async function outboxIdsForKey<T extends Record<string, unknown>>(
  db: Database<T>,
  key: string,
  options: { markedOnly?: boolean } = {},
): Promise<string[]> {
  const under = `${key}:`;
  const rows = await db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.status, "PENDING"),
        or(eq(emailOutbox.idempotencyKey, key), sql`left(${emailOutbox.idempotencyKey}, ${under.length}) = ${under}`),
        // A send to many past `SEND_NOW_ROW_LIMIT` (§540): only the rows the press marked leave now.
        options.markedOnly ? sql`(${emailOutbox.payloadJson} ->> ${SENT_NOW_FLAG}::text) = 'true'` : undefined,
      ),
    )
    .orderBy(emailOutbox.createdAt);
  return rows.map((row) => row.id);
}
