import { and, eq } from "drizzle-orm";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import type { Database } from "@/db/types";
import { DEFAULT_TOKEN_HOURS } from "@/modules/notifications/domain/token-lifetime";
import { isUuid } from "@/shared/ids";

/**
 * A volunteer agreement link that never left (§758). The link is minted while its email renders
 * (`mintVolunteerAgreementLink`, at the batch's clock), before the provider is asked; when the provider then
 * refuses the message for good (FAILED or BOUNCED), nobody holds the secret, yet the row would keep a live hash
 * and the card would say «Link trimis» for fourteen days. This clears it — only the hash minted at this batch's
 * clock (its expiry is that clock plus the house's lifetime), so a newer link another batch minted for the same
 * person is never touched. A transient refusal keeps it: the retry renders again and mints a newer one.
 *
 * Its own module, beside the outbox rather than in `agreement.ts`, which queues emails through the outbox: the
 * outbox reads this, and nothing here reads the outbox.
 */
export async function forgetUnsentVolunteerAgreementLink<T extends Record<string, unknown>>(
  db: Database<T>,
  row: { messageType: string; payloadJson: unknown },
  batchNow: Date,
): Promise<void> {
  if (row.messageType !== "VOLUNTEER_AGREEMENT_REQUEST" && row.messageType !== "VOLUNTEER_GUARDIAN_REQUEST") return;
  const volunteerId = (row.payloadJson as { volunteerId?: unknown } | null)?.volunteerId;
  if (typeof volunteerId !== "string" || !isUuid(volunteerId)) return;
  const mintedExpiry = new Date(batchNow.getTime() + DEFAULT_TOKEN_HOURS * 60 * 60_000);
  // The guardian's link (§NNN) is the same pattern on its own two columns.
  if (row.messageType === "VOLUNTEER_GUARDIAN_REQUEST") {
    await db
      .update(eventVolunteers)
      .set({ guardianTokenHash: null, guardianTokenExpiresAt: null })
      .where(and(eq(eventVolunteers.id, volunteerId), eq(eventVolunteers.guardianTokenExpiresAt, mintedExpiry)));
    return;
  }
  await db
    .update(eventVolunteers)
    .set({ agreementTokenHash: null, agreementTokenExpiresAt: null })
    .where(and(eq(eventVolunteers.id, volunteerId), eq(eventVolunteers.agreementTokenExpiresAt, mintedExpiry)));
}
