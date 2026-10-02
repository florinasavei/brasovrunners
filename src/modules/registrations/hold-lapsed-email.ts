import { inArray } from "drizzle-orm";
import { participants } from "@/db/schema/participants";
import type { Transaction } from "@/db/types";
import { enqueueEmail } from "@/modules/notifications/outbox";

/** One declaration hold `expireStaleHolds` has just released, as its `returning` gives it. */
export type ReleasedHold = {
  id: string;
  participantId: string;
  locale: "ro" | "en";
  /** The deadline that passed: the hold's own, as written on the row before the release. */
  holdExpiresAt: Date | null;
};

/** The outbox's key for the one message a released hold is owed (§NNN): one per registration, ever. */
export function holdLapsedIdempotencyKey(registrationId: string): string {
  return `registration:${registrationId}:hold-lapsed`;
}

/**
 * «Locul tău la {event} a expirat» (§NNN; the owner, 2026-10-02: «Da, fă emailul pentru cel care pierde
 * locul»): one `DECLARATION_HOLD_EXPIRED` per declaration hold `expireStaleHolds` released to somebody
 * who wanted the place (§160), queued in the transaction that released it, under the same event lock.
 *
 * - **Every path.** `expireStaleHolds` is the one place a declaration hold is released — a newcomer's
 *   confirmation (`placeForNewcomer`, `allocateOrWaitlist`'s `wanting`), a cancellation's refill, a late
 *   signature's sweep, «Trimite-i oferta», the desk's «Dă-i un loc», the editor's capacity raise and the
 *   maintenance job (`fillAvailableSpots`) — so each of them now tells the person, and none needs a line
 *   of its own.
 * - **Once.** The key names the registration and nothing else, so a second sweep, a retried request or
 *   a second path finds the row already queued (`onConflictDoNothing`): one email per registration,
 *   whatever released it and however often.
 * - **Never inline.** The outbox row commits with the release; the drain after the response sends it
 *   (§513), and a failed send never takes the release back (`AGENTS.md` §10.5 rule 10).
 * - **TEST rows** are told like real ones (`AGENTS.md` §12.6: `kind` is in no condition here); their
 *   `@test.invalid` address goes nowhere and `enqueueEmail` queues no club copy for them (§320).
 *
 * `toWaitlist` is a fact of the moment of release: somebody was on the waiting list, so the place went
 * to the line rather than simply becoming free (a newcomer the line had no room for, §348). The rest —
 * what the person can do now — is read when the message is rendered (`render.ts`), after the
 * transaction's own offer has been made.
 *
 * One read of the released people's delivery addresses, then one insert per message: no per-row read.
 */
export async function queueHoldLapsedEmails<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  params: { eventId: string; released: readonly ReleasedHold[]; toWaitlist: boolean; now: Date },
): Promise<void> {
  const { eventId, released, toWaitlist, now } = params;
  if (released.length === 0) return;
  const ids = [...new Set(released.map((row) => row.participantId))];
  const addresses = await tx
    .select({ id: participants.id, deliveryEmail: participants.deliveryEmail })
    .from(participants)
    .where(inArray(participants.id, ids));
  const addressOf = new Map(addresses.map((row) => [row.id, row.deliveryEmail]));
  for (const hold of released) {
    const recipientEmail = addressOf.get(hold.participantId);
    // An erased participant has no row and no registration either; nothing to tell.
    if (!recipientEmail) continue;
    await enqueueEmail(tx, {
      participantId: hold.participantId,
      registrationId: hold.id,
      messageType: "DECLARATION_HOLD_EXPIRED",
      locale: hold.locale,
      recipientEmail,
      payload: {
        eventId,
        // The deadline the message states (§377), as the row carried it at the release.
        ...(hold.holdExpiresAt ? { deadline: hold.holdExpiresAt.toISOString() } : {}),
        toWaitlist,
      },
      idempotencyKey: holdLapsedIdempotencyKey(hold.id),
      now,
    });
  }
}
