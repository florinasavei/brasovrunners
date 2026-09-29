import { eq } from "drizzle-orm";
import { type Participant, participants } from "@/db/schema/participants";
import type { Database } from "@/db/types";
import type { CanonicalEmail } from "./domain/canonical-email";

/**
 * Reading and writing `participants` (AGENTS.md §10.3, §10.4, §12.2). The canonical email is
 * immutable (§10.3): nothing here changes one. Generic over the caller's schema so registration
 * can call these inside its own transaction.
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

/** The participant a token or a registration names (§389). */
export async function findParticipantById<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
): Promise<Participant | undefined> {
  const [row] = await db.select().from(participants).where(eq(participants.id, id)).limit(1);
  return row;
}

/**
 * Find or create the participant for a canonical email (AGENTS.md §15.1 step 6). A verified
 * participant is returned as stored; an unverified one may have its name and locale refreshed,
 * since nothing has proven that identity yet.
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
