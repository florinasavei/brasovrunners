import { inArray } from "drizzle-orm";
import { participants } from "@/db/schema/participants";
import type { Transaction } from "@/db/types";
import { enqueueEmail } from "@/modules/notifications/outbox";

/** One declaration hold `expireStaleHolds` has just released, as its `returning` gives it. */
export type ReleasedHold = {
  id: string;
  participantId: string;
  locale: "ro" | "en";
  /** The deadline that passed: the hold's own, as the row carried it at the release (it stays on the row). */
  holdExpiresAt: Date | null;
};

/**
 * The outbox's key for the one message a released hold is owed (§638): one per lapsed hold. It names
 * the hold by its deadline, not the registration alone — a restarted registration (the email's own
 * buttons lead back to the form, which restarts the same row, `domain/family.ts`) gets a new hold with
 * a new deadline, and if that one lapses too the person is told again. The release itself
 * (`PENDING_DECLARATION -> EXPIRED`) happens once per hold, so a second sweep still queues nothing.
 */
export function holdLapsedIdempotencyKey(registrationId: string, holdExpiresAt: Date): string {
  return `registration:${registrationId}:hold-lapsed:${holdExpiresAt.toISOString()}`;
}

/**
 * «Locul tău la {event} a expirat» (§638; the owner, 2026-10-02: «Da, fă emailul pentru cel care pierde
 * locul»): one `DECLARATION_HOLD_EXPIRED` per declaration hold `expireStaleHolds` released to somebody
 * who wanted the place (§160), queued in the transaction that released it, under the same event lock.
 *
 * - **Every path.** `expireStaleHolds` is the one place a declaration hold is released — a newcomer's
 *   confirmation (`placeForNewcomer`, `allocateOrWaitlist`'s `wanting`), a cancellation's refill, a late
 *   signature's sweep, «Trimite-i oferta», the desk's «Dă-i un loc», the editor's capacity raise and the
 *   maintenance job (`fillAvailableSpots`) — so each of them now tells the person, and none needs a line
 *   of its own.
 * - **Once per lapsed hold.** The key names the registration and the hold's deadline
 *   (`holdLapsedIdempotencyKey`), so a second sweep, a retried request or a second path finds the row
 *   already queued (`onConflictDoNothing`), while a restarted registration whose new hold lapses as well
 *   is told again.
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
      // A hold with no deadline is never released as lapsed (`lapsedDeclarationHoldsToRelease`); the
      // instant of the release stands in, which is as unique, since a hold is released once.
      idempotencyKey: holdLapsedIdempotencyKey(hold.id, hold.holdExpiresAt ?? now),
      now,
    });
  }
}
