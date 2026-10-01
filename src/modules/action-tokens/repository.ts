import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { inReadOnlyTransaction } from "@/db/read-only";
import {
  type EmailActionTokenPurpose,
  emailActionTokens,
} from "@/db/schema/email-action-tokens";
import type { Database } from "@/db/types";
import { generateTokenSecret, hashTokenSecret, isWellFormedTokenSecret } from "./domain/token-secret";
import {
  evaluateActionToken,
  TOKEN_NOT_FOUND,
  type TokenRejection,
} from "./domain/token-state";

/**
 * Email action tokens (BR-REQ-036-02; AGENTS.md §12.8, §13.2). Priority-1 code (`docs/PRACTICES.md` §198).
 *
 * Which entry point a route uses is a security decision:
 *   issueActionToken       writes a token and kills the previous ones for that scope, marking
 *                          each as superseded by the new one (§619).
 *   readActionTokenContext what a GET may do. Runs in a read-only transaction.
 *   consumeActionToken     what a POST does. One statement, single use, no second winner.
 *
 * `now` is always injected: expiry is a business deadline. Generic over the caller's schema
 * because `notifications/render.ts` issues tokens inside the outbox's own transaction.
 */

/** What a caller may see about a token. Never the hash, and never the secret. */
export type ActionTokenContext = {
  id: string;
  participantId: string;
  registrationId: string | null;
  purpose: EmailActionTokenPurpose;
  expiresAt: Date;
};

export type ActionTokenResult = { ok: true; token: ActionTokenContext } | TokenRejection;

/**
 * `secret` is returned exactly once, to the code that emails it, and is unrecoverable afterwards.
 * Never log it, return it from a route or store it (§14.5).
 */
export type IssuedActionToken = { secret: string; token: ActionTokenContext };

export class ActionTokenError extends Error {
  readonly code = "VALIDATION_ERROR";

  constructor(reason: string) {
    super(`Cannot issue an email action token: ${reason}`);
    this.name = "ActionTokenError";
  }
}

const CONTEXT_COLUMNS = {
  id: emailActionTokens.id,
  participantId: emailActionTokens.participantId,
  registrationId: emailActionTokens.registrationId,
  purpose: emailActionTokens.purpose,
  expiresAt: emailActionTokens.expiresAt,
};

/**
 * Issue a token for one purpose and scope, invalidating the previous live ones in the same
 * transaction, so a resend never leaves two working links (BR-REQ-036-02 criterion 5). Each row it
 * invalidates is also marked superseded by the new one (§619) — so its page can say a newer email
 * exists — and only those rows: an invalidation from anywhere else is a revocation, and stays generic.
 *
 * `db` is normally the caller's open transaction (registration, token and outbox row together,
 * §15.1). The scope matched mirrors the partial unique indexes; if they drift, the insert fails.
 */
export async function issueActionToken<T extends Record<string, unknown>>(
  db: Database<T>,
  params: {
    participantId: string;
    registrationId: string | null;
    purpose: EmailActionTokenPurpose;
    expiresAt: Date;
    now: Date;
  },
): Promise<IssuedActionToken> {
  const { participantId, registrationId, purpose, expiresAt, now } = params;

  if (expiresAt.getTime() <= now.getTime()) {
    throw new ActionTokenError("the expiry must be in the future");
  }
  // Mirrors the CHECK constraint, as a named domain error.
  if ((purpose === "MANAGE_PROFILE") !== (registrationId === null)) {
    throw new ActionTokenError(
      "MANAGE_PROFILE is scoped to a participant and every other purpose to one registration",
    );
  }

  const secret = generateTokenSecret();
  const tokenHash = hashTokenSecret(secret);

  const token = await db.transaction(async (tx) => {
    /*
      The one purpose whose earlier links stay live (§420): each family link (§389) promises its
      own window. Each is single use and the address's limit is counted under the event's lock,
      so several live links cannot exceed it. The partial unique index excludes this purpose too.
    */
    const superseded =
      purpose === "REGISTER_ANOTHER_PERSON"
        ? []
        : await tx
            .update(emailActionTokens)
            .set({ invalidatedAt: now })
            .where(
              and(
                eq(emailActionTokens.purpose, purpose),
                isNull(emailActionTokens.usedAt),
                isNull(emailActionTokens.invalidatedAt),
                registrationId === null
                  ? and(
                      eq(emailActionTokens.participantId, participantId),
                      isNull(emailActionTokens.registrationId),
                    )
                  : eq(emailActionTokens.registrationId, registrationId),
              ),
            )
            .returning({ id: emailActionTokens.id });

    const [row] = await tx
      .insert(emailActionTokens)
      .values({
        participantId,
        registrationId,
        purpose,
        tokenHash,
        expiresAt,
        // Explicit, not `now()`: the CHECK compares it with `expires_at`, and mixing the
        // application's and the database's clocks would make short expiries depend on skew.
        createdAt: now,
      })
      .returning(CONTEXT_COLUMNS);

    /*
      Which rows a newer email replaced (§619): exactly the ones the UPDATE above invalidated, by id,
      after the insert because the column points at the new row. Two statements rather than one, so
      the reference is never to a row that does not exist yet; the transaction makes them one fact.
    */
    if (superseded.length > 0) {
      await tx
        .update(emailActionTokens)
        .set({ supersededByTokenId: row.id })
        .where(inArray(emailActionTokens.id, superseded.map((old) => old.id)));
    }

    return row;
  });

  return { secret, token };
}

/**
 * What a GET handler may know, without changing anything (BR-REQ-036-02 criterion 4). Mail
 * providers and link scanners fetch links before a human does, so a GET must never spend or act
 * on a token. The read-only transaction makes that structural (`src/db/read-only.ts`).
 */
export async function readActionTokenContext<T extends Record<string, unknown>>(
  db: Database<T>,
  params: { secret: string; purpose: EmailActionTokenPurpose; now: Date },
): Promise<ActionTokenResult> {
  const { secret, purpose, now } = params;

  // A malformed value is answered like a wrong one: no hint about the shape.
  if (!isWellFormedTokenSecret(secret)) return TOKEN_NOT_FOUND;

  const tokenHash = hashTokenSecret(secret);

  return inReadOnlyTransaction(db, async (tx) => {
    const [row] = await tx
      .select({
        ...CONTEXT_COLUMNS,
        usedAt: emailActionTokens.usedAt,
        invalidatedAt: emailActionTokens.invalidatedAt,
        supersededByTokenId: emailActionTokens.supersededByTokenId,
      })
      .from(emailActionTokens)
      .where(eq(emailActionTokens.tokenHash, tokenHash))
      .limit(1);

    if (!row) return TOKEN_NOT_FOUND;

    const evaluation = evaluateActionToken(row, purpose, now);
    if (!evaluation.ok) return evaluation;

    return {
      ok: true,
      token: {
        id: row.id,
        participantId: row.participantId,
        registrationId: row.registrationId,
        purpose: row.purpose,
        expiresAt: row.expiresAt,
      },
    };
  });
}

/**
 * The scope of an *already spent* token, so a status page can say where the person is
 * (`registrations/domain/link-status.ts`). Separate from `readActionTokenContext`, whose
 * contract is "may be acted on".
 *
 * - Answers only for `ALREADY_USED`, re-evaluated here; anything else (a purpose mismatch
 *   included, which must look like a missing token) returns null.
 * - Still a read-only transaction.
 * - Reveals only the scope the holder's secret was issued for — no address, no name.
 */
export type SpentActionTokenScope = {
  participantId: string;
  registrationId: string | null;
  purpose: EmailActionTokenPurpose;
};

export async function readSpentActionTokenScope<T extends Record<string, unknown>>(
  db: Database<T>,
  params: { secret: string; purpose: EmailActionTokenPurpose; now: Date },
): Promise<SpentActionTokenScope | null> {
  const { secret, purpose, now } = params;

  if (!isWellFormedTokenSecret(secret)) return null;

  const tokenHash = hashTokenSecret(secret);

  return inReadOnlyTransaction(db, async (tx) => {
    const [row] = await tx
      .select({
        participantId: emailActionTokens.participantId,
        registrationId: emailActionTokens.registrationId,
        purpose: emailActionTokens.purpose,
        expiresAt: emailActionTokens.expiresAt,
        usedAt: emailActionTokens.usedAt,
        invalidatedAt: emailActionTokens.invalidatedAt,
        supersededByTokenId: emailActionTokens.supersededByTokenId,
      })
      .from(emailActionTokens)
      .where(eq(emailActionTokens.tokenHash, tokenHash))
      .limit(1);

    if (!row) return null;

    const evaluation = evaluateActionToken(row, purpose, now);
    if (evaluation.ok || evaluation.reason !== "ALREADY_USED") return null;

    return {
      participantId: row.participantId,
      registrationId: row.registrationId,
      purpose: row.purpose,
    };
  });
}

/**
 * The scope of a token a newer one *replaced*, and when the token that replaced it was issued, so a
 * page can say "a newer email has the working link" (§619; `registrations/domain/link-status.ts`).
 * The sibling of `readSpentActionTokenScope`, with the same three properties:
 *
 * - Answers only for `SUPERSEDED`, re-evaluated here; a purpose mismatch, a revoked row, an
 *   unknown secret all return null — the caller falls back to the one generic refusal (§13.2).
 * - A read-only transaction: reached from a GET.
 * - Reveals the scope the holder's secret was issued for and one instant — when the token
 *   `superseded_by_token_id` names, the one that actually replaced this link, was created, which
 *   is when its email was rendered (links are minted at send time, `notifications/render.ts`).
 *   Never the newer token's id, hash or secret.
 *
 * The named row, not the newest of the scope: a token minted for a redirect rather than an email
 * (the list switch's press, `list-consent.ts`) would otherwise be reported as an email «sent».
 */
export type SupersededActionTokenScope = SpentActionTokenScope & {
  /** When the token that replaced this one was issued; null when it cannot be read. */
  replacedAt: Date | null;
};

export async function readSupersededActionTokenScope<T extends Record<string, unknown>>(
  db: Database<T>,
  params: { secret: string; purpose: EmailActionTokenPurpose; now: Date },
): Promise<SupersededActionTokenScope | null> {
  const { secret, purpose, now } = params;

  if (!isWellFormedTokenSecret(secret)) return null;

  const tokenHash = hashTokenSecret(secret);

  return inReadOnlyTransaction(db, async (tx) => {
    const [row] = await tx
      .select({
        id: emailActionTokens.id,
        participantId: emailActionTokens.participantId,
        registrationId: emailActionTokens.registrationId,
        purpose: emailActionTokens.purpose,
        expiresAt: emailActionTokens.expiresAt,
        usedAt: emailActionTokens.usedAt,
        invalidatedAt: emailActionTokens.invalidatedAt,
        supersededByTokenId: emailActionTokens.supersededByTokenId,
      })
      .from(emailActionTokens)
      .where(eq(emailActionTokens.tokenHash, tokenHash))
      .limit(1);

    if (!row) return null;

    const evaluation = evaluateActionToken(row, purpose, now);
    if (evaluation.ok || evaluation.reason !== "SUPERSEDED") return null;

    const [replacement] = row.supersededByTokenId
      ? await tx
          .select({ createdAt: emailActionTokens.createdAt })
          .from(emailActionTokens)
          .where(eq(emailActionTokens.id, row.supersededByTokenId))
          .limit(1)
      : [];

    return {
      participantId: row.participantId,
      registrationId: row.registrationId,
      purpose: row.purpose,
      replacedAt: replacement?.createdAt ?? null,
    };
  });
}

/**
 * Spend a token: every condition in the WHERE of one UPDATE, so two concurrent requests cannot
 * both win — PostgreSQL re-evaluates the predicate on the locked row (BR-REQ-036-02 criteria
 * 2, 3). The follow-up query runs only on failure, to give the log a reason; the participant
 * still sees one generic message (§13.2).
 */
export async function consumeActionToken<T extends Record<string, unknown>>(
  db: Database<T>,
  params: { secret: string; purpose: EmailActionTokenPurpose; now: Date },
): Promise<ActionTokenResult> {
  const { secret, purpose, now } = params;

  if (!isWellFormedTokenSecret(secret)) return TOKEN_NOT_FOUND;

  const tokenHash = hashTokenSecret(secret);

  const [consumed] = await db
    .update(emailActionTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(emailActionTokens.tokenHash, tokenHash),
        eq(emailActionTokens.purpose, purpose),
        isNull(emailActionTokens.usedAt),
        isNull(emailActionTokens.invalidatedAt),
        gt(emailActionTokens.expiresAt, now),
      ),
    )
    .returning(CONTEXT_COLUMNS);

  if (consumed) return { ok: true, token: consumed };

  const [row] = await db
    .select({
      purpose: emailActionTokens.purpose,
      expiresAt: emailActionTokens.expiresAt,
      usedAt: emailActionTokens.usedAt,
      invalidatedAt: emailActionTokens.invalidatedAt,
      supersededByTokenId: emailActionTokens.supersededByTokenId,
    })
    .from(emailActionTokens)
    .where(eq(emailActionTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row) return TOKEN_NOT_FOUND;

  const evaluation = evaluateActionToken(row, purpose, now);
  // The UPDATE refused it, so `ok` here means the two rule statements disagree: report invalid.
  return evaluation.ok ? { ok: false, code: "TOKEN_INVALID", reason: "NOT_FOUND" } : evaluation;
}
