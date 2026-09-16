import { eq } from "drizzle-orm";
import { type Participant, participants } from "@/db/schema/participants";
import type { Database } from "@/db/types";
import type { CanonicalEmail } from "./domain/canonical-email";

/**
 * Reading and writing `participants` (AGENTS.md §10.3, §10.4, §12.2).
 *
 * The canonical email is immutable in V1 (§10.3): there is no function here that changes one,
 * only `findOrCreateByCanonicalEmail`, which never overwrites an existing row's identity —
 * it may update the mutable display fields (name, locale), and only when the participant has
 * not yet verified, so a typo cannot silently rewrite a verified identity's delivery address.
 *
 * Generic over the caller's schema, like `modules/content/events/repository.ts`: registration
 * (`modules/registrations/service.ts`) calls these from inside a transaction that also touches
 * `registrations` and `events`, so one shared type parameter is what lets that single open
 * transaction satisfy this module's requirements too.
 */

export async function findParticipantByCanonicalEmail<T extends Record<string, unknown>>(
  db: Database<T>,
  canonicalEmail: string,
): Promise<Participant | undefined> {
  const [row] = await db
    .select()
    .from(participants)
    .where(eq(participants.canonicalEmail, canonicalEmail))
    .limit(1);
  return row;
}

/**
 * Find the participant this canonical email already identifies, or create one.
 *
 * AGENTS.md §15.1 step 6: "upsert/find participant by canonical email without overwriting
 * verified identity silently." An existing, verified participant is returned exactly as
 * stored — a second registration under a slightly different display name does not rename
 * them. An existing, unverified participant may have its default name refreshed: nothing has
 * proven that identity yet, so there is nothing established to protect.
 */
export async function findOrCreateParticipant<T extends Record<string, unknown>>(
  db: Database<T>,
  identity: CanonicalEmail,
  defaultName: string,
  preferredLocale: "ro" | "en",
  now: Date,
): Promise<Participant> {
  const existing = await findParticipantByCanonicalEmail(db, identity.canonicalEmail);
  if (existing) {
    if (existing.emailVerifiedAt) return existing;

    const [updated] = await db
      .update(participants)
      .set({ defaultName, preferredLocale, updatedAt: now })
      .where(eq(participants.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(participants)
    .values({
      deliveryEmail: identity.deliveryEmail,
      normalizedEmail: identity.normalizedEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      defaultName,
      preferredLocale,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created;
}

export async function markEmailVerified<T extends Record<string, unknown>>(
  db: Database<T>,
  participantId: string,
  now: Date,
): Promise<void> {
  await db
    .update(participants)
    .set({ emailVerifiedAt: now, updatedAt: now })
    .where(eq(participants.id, participantId));
}
