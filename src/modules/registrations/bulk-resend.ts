import { and, asc, eq, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { participants } from "@/db/schema/participants";
import { type Registration, registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { RATE_LIMITS, readRateLimitCounts } from "@/modules/rate-limit/service";
import { type BulkResendCounts, canResendDeclarationToAll, RECENT_DECLARATION_EMAIL_MS } from "./domain/resend";
import { findEventForAllocation } from "./repository";

/**
 * «Retrimite declarația tuturor care nu au semnat» (§606) — the read half: who the press reaches and
 * who it leaves out, read by the event page for its question and by the press itself, one query for
 * both, so the dialog's numbers are the press's. Nothing here writes; the press is
 * `resendDeclarationToAllPending` in `admin-service.ts`.
 */

/** A registration still waiting for its signature, with what decides whether the press sends to it. */
export type DeclarationResendCandidate = {
  registration: Registration;
  deliveryEmail: string;
  /** Its declaration email is still in the outbox, or left within the last hour. */
  recent: boolean;
};

/**
 * Every `PENDING_DECLARATION` registration of the event, oldest first, whatever its kind (§12.6:
 * a test row is resent exactly as a real one). `recent` reads the participant's own
 * `COMPLETE_DECLARATION` rows — not the club's copies, which carry no participant — PENDING or
 * PROCESSING (queued, deferred, or being sent), or with a `sent_at` inside the hour.
 */
export async function listDeclarationResendCandidates<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  now: Date,
): Promise<DeclarationResendCandidate[]> {
  const since = new Date(now.getTime() - RECENT_DECLARATION_EMAIL_MS).toISOString();
  return db
    .select({
      registration: registrations,
      deliveryEmail: participants.deliveryEmail,
      recent: sql<boolean>`exists (
        select 1 from ${emailOutbox}
        where ${emailOutbox.registrationId} = ${registrations.id}
          and ${emailOutbox.participantId} is not null
          and ${emailOutbox.messageType} = 'COMPLETE_DECLARATION'
          and (${emailOutbox.status} in ('PENDING', 'PROCESSING') or ${emailOutbox.sentAt} >= ${since}::timestamptz)
      )`,
    })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, "PENDING_DECLARATION")))
    .orderBy(asc(registrations.submittedAt), asc(registrations.id));
}

/** Whether the `admin-resend` hour of each registration is already spent (§606): a spent limit is a spent limit. */
export async function spentResendLimits<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationIds: readonly string[],
  now: Date,
): Promise<Set<string>> {
  const counts = await readRateLimitCounts(db, "admin-resend", registrationIds, now);
  const { limit } = RATE_LIMITS["admin-resend"];
  return new Set(registrationIds.filter((id) => (counts.get(id) ?? 0) >= limit));
}

/** Why a press would be refused before it reached anybody (§606), as the page says it ahead (§592). */
export type DeclarationResendRefusal = "closed" | "limited";

export type DeclarationResendPreview = {
  /** Real registrations (§12.6): waiting to sign, and how the press would sort them. */
  pending: number;
  counts: BulkResendCounts;
  /** Test registrations, apart: they are sent to exactly like the real ones and counted nowhere. */
  testPending: number;
  testCounts: BulkResendCounts;
  refusal: DeclarationResendRefusal | null;
};

/** Sorts candidates as the press does: recent first, then a spent limit, else queued. */
export function sortCandidates(candidates: readonly DeclarationResendCandidate[], spent: ReadonlySet<string>) {
  const send: DeclarationResendCandidate[] = [];
  const recent: DeclarationResendCandidate[] = [];
  const limited: DeclarationResendCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.recent) recent.push(candidate);
    else if (spent.has(candidate.registration.id)) limited.push(candidate);
    else send.push(candidate);
  }
  return { send, recent, limited };
}

/**
 * The question's numbers, read live with the press's own query (§606, §384): how many wait to sign,
 * how many the press would skip and why, and whether the press would be refused — the event no longer
 * signable, or the event's three presses of the hour spent — so the page can say so before the press
 * (§592). Null for an unknown event. Reads only: GET mutates nothing.
 */
export async function previewDeclarationResend<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  now: Date,
): Promise<DeclarationResendPreview | null> {
  const event = await findEventForAllocation(db, eventId);
  if (!event) return null;
  const candidates = await listDeclarationResendCandidates(db, eventId, now);
  const spent = await spentResendLimits(
    db,
    candidates.map((candidate) => candidate.registration.id),
    now,
  );
  const { send, recent, limited } = sortCandidates(candidates, spent);
  const real = (rows: DeclarationResendCandidate[]) => rows.filter((row) => row.registration.kind === "REAL").length;
  const test = (rows: DeclarationResendCandidate[]) => rows.length - real(rows);
  const presses = (await readRateLimitCounts(db, "admin-bulk-resend", [eventId], now)).get(eventId) ?? 0;
  const refusal: DeclarationResendRefusal | null = !canResendDeclarationToAll(event.eventStatus, event.startsAt, now)
    ? "closed"
    : presses >= RATE_LIMITS["admin-bulk-resend"].limit
      ? "limited"
      : null;
  return {
    pending: real(candidates),
    counts: { queued: real(send), skippedRecent: real(recent), skippedLimited: real(limited) },
    testPending: test(candidates),
    testCounts: { queued: test(send), skippedRecent: test(recent), skippedLimited: test(limited) },
    refusal,
  };
}
