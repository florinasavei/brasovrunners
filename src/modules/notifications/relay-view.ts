import { and, count, desc, gt, inArray, or } from "drizzle-orm";
import { type EmailOutboxStatus, emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import { RELAY_MESSAGE_TYPES, type RelayMessageType } from "./domain/relay";
import { readRoadFailures, type Road, type RoadFailure } from "./domain/road-failover";
import { readRoadLastSuccess, readRoadStates, type RoadState } from "./road-status";

/**
 * «Mesaje de pe site» on «Setări» → «Emailuri» (§NNN): the visitors' messages the outbox carries, each with the road
 * the club chose, the road it left by, how many tries, what each road answered and whether its words are still kept —
 * and the two roads' own state beside them. **No address and no word of any message:** the recipient is the club's or
 * Girl Zone's person (a confidential reader the Organizer must not learn from a list), and the words are gone the
 * moment a message leaves; what is shown is the trace, which is exactly what the owner could not see when a message
 * «was sent» and nobody could say by which road, or whether (`/devs`, `/admin/tasks` read the same).
 */
export type RelayRow = {
  id: string;
  type: RelayMessageType;
  status: EmailOutboxStatus;
  createdAt: Date;
  sentAt: Date | null;
  attempts: number;
  /** The road the club chose. */
  road: Road | null;
  /** The road it left by, once it has left. */
  via: Road | null;
  /** The words are gone (delivered, or given up on): never shown, never recoverable. */
  bodyDeleted: boolean;
  /** What each road answered when it failed this message. */
  failures: Partial<Record<Road, RoadFailure>>;
  lastError: string | null;
};

export type RelayView = {
  rows: RelayRow[];
  /** Rows of the last seven days, or still owed, however many are drawn. */
  total: number;
  /** Of them, the ones whose words are still kept: waiting to leave. */
  kept: number;
  states: Record<Road, RoadState>;
  lastSuccess: Record<Road, Date | null>;
};

/**
 * A week: what the panel draws. The rows themselves stay as long as any outbox row does (`retention.ts`: ninety days for a sent
 * one, a failed one with no registration likewise), with the recipient and the road and none of the words.
 */
export const RELAY_VIEW_WINDOW_MS = 7 * 24 * 3_600_000;
export const RELAY_VIEW_LIMIT = 30;

export async function readRelayView<T extends Record<string, unknown>>(db: Database<T>, now: Date, limit: number = RELAY_VIEW_LIMIT): Promise<RelayView> {
  const relay = inArray(emailOutbox.messageType, [...RELAY_MESSAGE_TYPES]);
  const recent = and(relay, or(gt(emailOutbox.createdAt, new Date(now.getTime() - RELAY_VIEW_WINDOW_MS)), inArray(emailOutbox.status, ["PENDING", "PROCESSING"])));
  const [rows, [counts], states, lastSuccess] = await Promise.all([
    db
      .select({
        id: emailOutbox.id,
        type: emailOutbox.messageType,
        status: emailOutbox.status,
        createdAt: emailOutbox.createdAt,
        sentAt: emailOutbox.sentAt,
        attempts: emailOutbox.attemptCount,
        road: emailOutbox.road,
        transport: emailOutbox.transport,
        bodyDeletedAt: emailOutbox.bodyDeletedAt,
        roadFailures: emailOutbox.roadFailures,
        lastError: emailOutbox.lastError,
      })
      .from(emailOutbox)
      .where(recent)
      .orderBy(desc(emailOutbox.createdAt))
      .limit(limit),
    db
      .select({ total: count(), kept: count(emailOutbox.bodyDeletedAt) })
      .from(emailOutbox)
      .where(recent),
    readRoadStates(db),
    readRoadLastSuccess(db),
  ]);
  const total = counts?.total ?? 0;
  return {
    rows: rows.map((row) => ({
      id: row.id,
      type: row.type as RelayMessageType,
      status: row.status,
      createdAt: row.createdAt,
      sentAt: row.sentAt,
      attempts: row.attempts,
      road: row.road,
      via: row.transport,
      bodyDeleted: row.bodyDeletedAt !== null,
      failures: readRoadFailures(row.roadFailures),
      lastError: row.lastError,
    })),
    total,
    // `count(column)` counts the non-null: the rows whose words were deleted; the rest are kept.
    kept: total - (counts?.kept ?? 0),
    states,
    lastSuccess,
  };
}

/** The visitors' messages that no road carried or whose address was refused, in the last seven days: «Sarcini»' `relayLost` (§NNN). */
export async function countLostRelayMessages<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(emailOutbox)
    .where(
      and(
        // A notice the platform could not deliver is not a visitor's message.
        inArray(emailOutbox.messageType, ["CONTACT_MESSAGE", "FEEDBACK_MESSAGE"]),
        inArray(emailOutbox.status, ["FAILED", "BOUNCED"]),
        gt(emailOutbox.createdAt, new Date(now.getTime() - RELAY_VIEW_WINDOW_MS)),
      ),
    );
  return row?.value ?? 0;
}
