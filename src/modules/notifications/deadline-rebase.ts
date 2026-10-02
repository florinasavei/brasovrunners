import { and, eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { pendingFamilyEntries } from "@/db/schema/family-entries";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import { wakeJobs } from "@/modules/jobs/schedule-cache";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { findFamilyEntryById } from "@/modules/registrations/family-entries";
import { lockEventForCapacity } from "@/modules/registrations/repository";
import { isClubCopy } from "./domain/club-notices";
import { DEADLINE_KIND_BY_MESSAGE, offerLastsUntilStart, REBASE_MIN_WAIT_MS, rebasedDeadline, startsItsDeadline } from "./domain/deadline-rebase";
import type { OutboxRow } from "./outbox";

/**
 * «Termenul curge de când pleacă emailul» (§513, `domain/deadline-rebase.ts`): the reads before a
 * message renders, and the guarded write after it is SENT.
 *
 * `processOutboxBatch` plans before it renders — so the words and the link the message carries
 * already say the deadline it will have — and applies only once the provider has taken the
 * message: a message that failed, bounced, was deferred for the allowance or put back for Gmail's
 * pace moves nothing, and moves it when it finally leaves.
 */

/** The registration deadlines, and the status the registration must still be in for each. */
const REGISTRATION_KINDS = {
  emailLink: "PENDING_EMAIL_CONFIRMATION",
  declarationHold: "PENDING_DECLARATION",
  offer: "WAITLIST_OFFERED",
} as const satisfies Record<string, RegistrationStatus>;

type RegistrationKind = keyof typeof REGISTRATION_KINDS;

export type DeadlineRebase =
  | {
      kind: RegistrationKind;
      registrationId: string;
      eventId: string;
      /** The deadline as stored when the plan was made: the write is refused if it has moved since. */
      from: Date;
      to: Date;
      /** How long the message waited in the queue: an offer's stated length is counted from its start plus this. */
      waitMs: number;
    }
  | { kind: "familyLink"; entryId: string; from: Date; to: Date; waitMs: number };

/**
 * What sending this row now would do to the deadline it carries, or null. Only the message that
 * started that deadline (`STARTS_DEADLINE` in its payload, written by the enqueue that wrote the
 * deadline): a resend, a reminder or a club copy carries no mark and moves nothing, so a deadline
 * is re-based once, on its first send, never again (§513). A message that has waited less than a
 * minute costs no read at all — every message under the `immediate` timing.
 */
export async function planDeadlineRebase<T extends Record<string, unknown>>(
  db: Database<T>,
  row: OutboxRow,
  sentAt: Date,
): Promise<DeadlineRebase | null> {
  const kind = DEADLINE_KIND_BY_MESSAGE[row.messageType];
  if (!kind || !row.participantId || isClubCopy(row.payloadJson) || !startsItsDeadline(row.payloadJson)) return null;
  const waitMs = sentAt.getTime() - row.createdAt.getTime();
  if (waitMs < REBASE_MIN_WAIT_MS) return null;

  if (kind === "familyLink") {
    const payload = (row.payloadJson ?? {}) as { atCap?: unknown; familyEntryId?: unknown };
    if (payload.atCap === true || typeof payload.familyEntryId !== "string") return null;
    const entry = await findFamilyEntryById(db, payload.familyEntryId);
    if (!entry) return null;
    const to = rebasedDeadline({ kind, stored: entry.expiresAt, queuedAt: row.createdAt, sentAt });
    return to ? { kind, entryId: entry.id, from: entry.expiresAt, to, waitMs } : null;
  }

  if (!row.registrationId) return null;
  const [found] = await db
    .select({
      status: registrations.status,
      eventId: registrations.eventId,
      holdExpiresAt: registrations.holdExpiresAt,
      emailLinkExpiresAt: registrations.emailLinkExpiresAt,
      registrationClosesAt: events.registrationClosesAt,
      startsAt: events.startsAt,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(eq(registrations.id, row.registrationId))
    .limit(1);
  if (!found || found.status !== REGISTRATION_KINDS[kind]) return null;
  const stored = kind === "emailLink" ? found.emailLinkExpiresAt : found.holdExpiresAt;
  if (!stored) return null;
  const to = rebasedDeadline({
    kind,
    stored,
    queuedAt: row.createdAt,
    sentAt,
    event: { registrationClosesAt: found.registrationClosesAt, startsAt: found.startsAt },
    // «Trimite-i oferta»'s offer (§NNN): the start is its one cap, at the send as when it was made.
    capByClose: !(kind === "offer" && offerLastsUntilStart(row.payloadJson)),
  });
  return to ? { kind, registrationId: row.registrationId, eventId: found.eventId, from: stored, to, waitMs } : null;
}

/**
 * The write, once the message is SENT. Each one is compare-and-set on the value the plan read, so
 * a deadline something else moved in between — a confirmation, a cancellation, the sweep, a second
 * send — is left as that left it.
 *
 * A hold or an offer is written under the event's lock (`lockEventForCapacity`), the allocator's
 * own serialization point (AGENTS.md §10.6), so no allocation decides between the read and the
 * write. An offer past its stored deadline is moved too (§520): while its message was queued it was
 * never lapsed (`awaitingItsFirstEmail`). The moment the message is marked SENT that guard is gone,
 * so the caller hands the SENT write in as `inTheLock`: it runs inside the same locked transaction
 * as the move, and no count taken under the lock — a capacity lowered, a place given — can see the
 * offer as free between the two. The public count is told (§333): an offer's deadline is one of the
 * instants its cache is keyed by.
 *
 * Returns whether a deadline moved.
 */
export async function applyDeadlineRebase<T extends Record<string, unknown>>(
  db: Database<T>,
  plan: DeadlineRebase,
  clock: () => Date,
  /** A hold's or an offer's: a write that must commit with the move, under the same lock (the SENT mark). */
  inTheLock?: (tx: Transaction<T>) => Promise<unknown>,
): Promise<boolean> {
  if (plan.kind === "familyLink") {
    const moved = await db
      .update(pendingFamilyEntries)
      .set({ expiresAt: plan.to })
      .where(and(eq(pendingFamilyEntries.id, plan.entryId), eq(pendingFamilyEntries.expiresAt, plan.from)))
      .returning({ id: pendingFamilyEntries.id });
    return moved.length > 0;
  }

  if (plan.kind === "emailLink") {
    const moved = await db
      .update(registrations)
      .set({ emailLinkExpiresAt: plan.to })
      .where(
        and(
          eq(registrations.id, plan.registrationId),
          eq(registrations.status, REGISTRATION_KINDS.emailLink),
          eq(registrations.emailLinkExpiresAt, plan.from),
        ),
      )
      .returning({ id: registrations.id });
    return moved.length > 0;
  }

  const moved = await db.transaction(async (tx) => {
    await lockEventForCapacity(tx, plan.eventId);
    if (inTheLock) await inTheLock(tx);
    return tx
      .update(registrations)
      .set({ holdExpiresAt: plan.to })
      .where(
        and(
          eq(registrations.id, plan.registrationId),
          eq(registrations.status, REGISTRATION_KINDS[plan.kind]),
          eq(registrations.holdExpiresAt, plan.from),
        ),
      )
      .returning({ id: registrations.id });
  });
  if (moved.length > 0) {
    revalidatePublicContent("places");
    // The job planned its quiet on the old deadline; the new one is what it must wake for (§334).
    wakeJobs("registration-maintenance", plan.to, clock());
  }
  return moved.length > 0;
}
