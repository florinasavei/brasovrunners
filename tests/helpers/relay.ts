import { eq, inArray } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import { RELAY_MESSAGE_TYPES } from "@/modules/notifications/domain/relay";
import type { Road } from "@/modules/notifications/domain/road-failover";
import { processRelayBatch, type RelayRoads, type RelaySummary } from "@/modules/notifications/relay";
import type { TestDatabase } from "./db";

/**
 * Two roads that answer what a test says, and remember what they were handed — the relay's seam
 * (`notifications/relay.ts`, §778) for every test of a visitor's message: the contact form's and
 * «Spune-ne ceva»'s service queue a row, and this is where the row leaves.
 */
export type RoadCall = { road: Road; message: OutgoingEmail };

export type FakeRoads = RelayRoads & {
  calls: RoadCall[];
  closed: number;
  /** The messages one road was handed, oldest first. */
  by(road: Road): OutgoingEmail[];
};

export type RoadAnswer = SendResult | ((message: OutgoingEmail, nth: number) => SendResult | Promise<SendResult>);

export function sent(road: Road, providerMessageId = `${road}:ok`): SendResult {
  return { outcome: "sent", providerMessageId, transport: road, recipients: 1 };
}

export function fakeRoads(
  options: {
    available?: Partial<Record<Road, boolean>>;
    gmail?: RoadAnswer;
    mailgun?: RoadAnswer;
  } = {},
): FakeRoads {
  const calls: RoadCall[] = [];
  const counts: Record<Road, number> = { gmail: 0, mailgun: 0 };
  const answers: Record<Road, RoadAnswer> = { gmail: options.gmail ?? sent("gmail"), mailgun: options.mailgun ?? sent("mailgun") };
  const roads: FakeRoads = {
    calls,
    closed: 0,
    by: (road) => calls.filter((call) => call.road === road).map((call) => call.message),
    async available() {
      return { gmail: options.available?.gmail ?? true, mailgun: options.available?.mailgun ?? true };
    },
    async send(road, message) {
      calls.push({ road, message });
      counts[road] += 1;
      const answer = answers[road];
      return typeof answer === "function" ? await answer(message, counts[road]) : answer;
    },
    close() {
      roads.closed += 1;
    },
  };
  return roads;
}

/** Sends every relay row that is due, once, through these roads. */
export async function deliverRelay(db: TestDatabase, roads: RelayRoads, now: Date, ids?: readonly string[]): Promise<RelaySummary> {
  return processRelayBatch(db, { roads, now, ...(ids ? { ids } : {}) });
}

/** The relay rows of an outbox, oldest first, with what the page and the tests read of them. */
export async function relayRows(db: TestDatabase) {
  const rows = await db
    .select()
    .from(emailOutbox)
    .where(inArray(emailOutbox.messageType, [...RELAY_MESSAGE_TYPES]));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

export async function relayRow(db: TestDatabase, id: string) {
  const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id));
  return row;
}

/** What the club's Gmail was handed, in the shape the contact form's own transport once recorded it. */
export type CapturedSmtp = {
  from: { name: string; address: string };
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: { name: string; address: string };
  subject: string;
  text: string;
  html: string;
};

export type SmtpCapture = {
  messages: CapturedSmtp[];
  /** One pass of the relay with Gmail answering into `messages` — the drain that follows a post in production. */
  deliver(db: TestDatabase, now: Date): Promise<RelaySummary>;
};

/**
 * The Gmail road as a recording: every message the relay hands it is kept the way the contact form's transport kept it,
 * so a test can read what the club's mailbox would have received. §778: the form queues, this is where the row leaves.
 */
export function smtpCapture(from = { name: "Brașov Runners", address: "club@example.com" }, mailgun?: RoadAnswer): SmtpCapture {
  const messages: CapturedSmtp[] = [];
  return {
    messages,
    deliver: (db, now) =>
      deliverRelay(
        db,
        fakeRoads({
          ...(mailgun ? { mailgun } : {}),
          gmail: (message) => {
            messages.push({
              from,
              to: [message.to],
              ...(message.cc ? { cc: [...message.cc] } : {}),
              ...(message.bcc ? { bcc: [...message.bcc] } : {}),
              ...(message.replyTo ? { replyTo: { name: message.replyToName ?? message.replyTo, address: message.replyTo } } : {}),
              subject: message.subject,
              text: message.text,
              html: message.html,
            });
            return sent("gmail");
          },
        }),
        now,
      ),
  };
}
