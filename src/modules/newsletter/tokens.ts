import { and, eq, gt, isNull } from "drizzle-orm";
import { inReadOnlyTransaction } from "@/db/read-only";
import { type NewsletterSubscriber, newsletterSubscribers, newsletterTokens } from "@/db/schema/newsletter";
import type { Database } from "@/db/types";
import { generateTokenSecret, hashTokenSecret, isWellFormedTokenSecret } from "@/modules/action-tokens/domain/token-secret";

/**
 * The newsletter's links (§445) — the same secret and the same stored hash as every email action
 * link (AGENTS.md §12.8, §13.2; `action-tokens/domain/token-secret.ts`), in a table of their own
 * because they belong to a subscriber, who is not a participant.
 *
 *   issueNewsletterToken    minted by the renderer, at send time (§14.5); a confirmation link
 *                           supersedes the previous one.
 *   readNewsletterToken     what a GET may do, in a read-only transaction.
 *   consumeNewsletterToken  what a POST does — the confirmation's button, and either button of
 *                           the subscriber's own page: one statement, one winner, single use
 *                           (AGENTS.md §12.8).
 */

/** How long the link in every newsletter opens the subscriber's own page: a year, so last spring's still unsubscribes. */
export const NEWSLETTER_MANAGE_LINK_DAYS = 365;

export type NewsletterTokenPurpose = (typeof newsletterTokens.$inferSelect)["purpose"];

export async function issueNewsletterToken<T extends Record<string, unknown>>(
  db: Database<T>,
  params: { subscriberId: string; purpose: NewsletterTokenPurpose; expiresAt: Date; now: Date },
): Promise<string> {
  const secret = generateTokenSecret();
  if (params.purpose === "CONFIRM") {
    // One live confirmation link: the newest message's (the partial unique index enforces it).
    await db
      .update(newsletterTokens)
      .set({ invalidatedAt: params.now })
      .where(
        and(
          eq(newsletterTokens.subscriberId, params.subscriberId),
          eq(newsletterTokens.purpose, "CONFIRM"),
          isNull(newsletterTokens.usedAt),
          isNull(newsletterTokens.invalidatedAt),
        ),
      );
  }
  await db.insert(newsletterTokens).values({
    subscriberId: params.subscriberId,
    purpose: params.purpose,
    tokenHash: hashTokenSecret(secret),
    expiresAt: params.expiresAt,
    createdAt: params.now,
  });
  return secret;
}

/** The live token's subscriber, or null: malformed, unknown, expired, spent or superseded all look the same. */
export async function readNewsletterToken<T extends Record<string, unknown>>(
  db: Database<T>,
  params: { secret: string; purpose: NewsletterTokenPurpose; now: Date },
): Promise<NewsletterSubscriber | null> {
  if (!isWellFormedTokenSecret(params.secret)) return null;
  const tokenHash = hashTokenSecret(params.secret);
  return inReadOnlyTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ subscriber: newsletterSubscribers })
      .from(newsletterTokens)
      .innerJoin(newsletterSubscribers, eq(newsletterSubscribers.id, newsletterTokens.subscriberId))
      .where(
        and(
          eq(newsletterTokens.tokenHash, tokenHash),
          eq(newsletterTokens.purpose, params.purpose),
          isNull(newsletterTokens.usedAt),
          isNull(newsletterTokens.invalidatedAt),
          gt(newsletterTokens.expiresAt, params.now),
        ),
      )
      .limit(1);
    return row?.subscriber ?? null;
  });
}

/**
 * Spend a link of `purpose`: the subscriber it named and when it would have expired, or null when
 * it was not live. One UPDATE, so of two presses of one link exactly one wins. Inside the caller's
 * transaction, so the spend and what it pays for commit together.
 */
export async function consumeNewsletterToken<T extends Record<string, unknown>>(
  db: Database<T>,
  params: { secret: string; purpose: NewsletterTokenPurpose; now: Date },
): Promise<{ subscriberId: string; expiresAt: Date } | null> {
  if (!isWellFormedTokenSecret(params.secret)) return null;
  const [spent] = await db
    .update(newsletterTokens)
    .set({ usedAt: params.now })
    .where(
      and(
        eq(newsletterTokens.tokenHash, hashTokenSecret(params.secret)),
        eq(newsletterTokens.purpose, params.purpose),
        isNull(newsletterTokens.usedAt),
        isNull(newsletterTokens.invalidatedAt),
        gt(newsletterTokens.expiresAt, params.now),
      ),
    )
    .returning({ subscriberId: newsletterTokens.subscriberId, expiresAt: newsletterTokens.expiresAt });
  return spent ?? null;
}
