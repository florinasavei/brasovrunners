import { and, eq, gt, isNull } from "drizzle-orm";
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
 * Issuing, reading and consuming email action tokens (BR-REQ-036-02; AGENTS.md §12.8, §13.2).
 *
 * Priority-1 code — `docs/PRACTICES.md` §198. Read every line.
 *
 * Three entry points, and which one a route uses is a security decision, not a convenience:
 *
 *   issueActionToken       writes a token and kills the previous ones for that scope.
 *   readActionTokenContext what a GET may do. Runs in a read-only transaction.
 *   consumeActionToken     what a POST does. One statement, single use, no second winner.
 *
 * `now` is always a parameter and never `new Date()` inside a rule. Expiry is a business
 * deadline (`docs/PRACTICES.md`: time-dependent logic takes an injected clock), and a test
 * that has to sleep to observe expiry is a test nobody runs.
 *
 * Every function is generic over the caller's schema, like `modules/content/events/repository.ts`:
 * `notifications/render.ts` issues a token from inside the outbox's own transaction, which has
 * no reason to know this module's schema shape ahead of time, and a fixed one here would not
 * structurally match a caller's differently-scoped fixed schema.
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
 * The secret and the row it belongs to.
 *
 * `secret` is returned exactly once, to the code that puts it in an email, and is
 * unrecoverable afterwards — nothing stored can produce it again. It must not be logged, must
 * not be returned from a route handler, and must not be written to any table (§14.5).
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
 * Issue a token for one purpose and one scope, invalidating the previous active ones.
 *
 * BR-REQ-036-02 criterion 5. A participant who asks for a second confirmation email must not
 * end up with two working links: they will click whichever email their client shows first,
 * and staff resending a link expect the old one to stop working. The invalidation and the
 * insert are one transaction, so there is no instant in which both are live.
 *
 * `db` may be an open transaction — and normally is. The registration workflow (§15.1) writes
 * the registration, this token and the outbox row together or not at all, so this function
 * joining the caller's transaction is the ordinary case; Drizzle opens a savepoint when it is
 * already inside one.
 *
 * The scope matched here is exactly the predicate of the partial unique indexes on the table.
 * If the two ever drift, the insert below fails loudly rather than leaving a second live
 * token behind.
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
  // Mirrors the CHECK constraint, so the caller gets a named domain error instead of a
  // driver error, and so the rule is stated where a reader of this module can see it.
  if ((purpose === "MANAGE_PROFILE") !== (registrationId === null)) {
    throw new ActionTokenError(
      "MANAGE_PROFILE is scoped to a participant and every other purpose to one registration",
    );
  }

  const secret = generateTokenSecret();
  const tokenHash = hashTokenSecret(secret);

  const token = await db.transaction(async (tx) => {
    await tx
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
      );

    const [row] = await tx
      .insert(emailActionTokens)
      .values({
        participantId,
        registrationId,
        purpose,
        tokenHash,
        expiresAt,
        // Written explicitly rather than left to `now()`: the CHECK compares this column with
        // `expires_at`, and comparing an application clock with a database clock would make
        // a token issued with a one-minute expiry depend on clock skew between two hosts.
        createdAt: now,
      })
      .returning(CONTEXT_COLUMNS);

    return row;
  });

  return { secret, token };
}

/**
 * What a GET handler may know, without changing anything (BR-REQ-036-02 criterion 4).
 *
 * The page behind an email link shows the participant what they are about to do and a button
 * that POSTs. It must reach this function and nothing else, because mail providers fetch
 * links before a human sees them: Gmail, Outlook and corporate link scanners all do. A GET
 * that confirmed a registration would be confirmed by a scanner, for a participant who never
 * clicked, and a single-use token would be spent before it was ever seen.
 *
 * The read-only transaction is what makes that structural rather than a promise — PostgreSQL
 * refuses any write inside it. See `src/db/read-only.ts`.
 *
 * Not implemented here, and required by §13.2 before this is reachable from a route:
 * rate-limited validation attempts. The token space is not guessable, but an unbounded
 * endpoint that hashes and queries per request is still a free amplifier.
 */
export async function readActionTokenContext<T extends Record<string, unknown>>(
  db: Database<T>,
  params: { secret: string; purpose: EmailActionTokenPurpose; now: Date },
): Promise<ActionTokenResult> {
  const { secret, purpose, now } = params;

  // A malformed value is answered exactly like a wrong one: the response must not tell a
  // stranger whether their guess had the right shape.
  if (!isWellFormedTokenSecret(secret)) return TOKEN_NOT_FOUND;

  const tokenHash = hashTokenSecret(secret);

  return inReadOnlyTransaction(db, async (tx) => {
    const [row] = await tx
      .select({
        ...CONTEXT_COLUMNS,
        usedAt: emailActionTokens.usedAt,
        invalidatedAt: emailActionTokens.invalidatedAt,
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
 * Spend a token. One statement, one winner (BR-REQ-036-02 criteria 2, 3 and the single-use
 * half of criterion 1's purpose).
 *
 * Every condition — the hash, the purpose, not used, not invalidated, not expired — is in the
 * WHERE clause of one UPDATE. That is deliberate and it is the whole design: a read followed
 * by a write would let two requests both read "unused" and both proceed, which for a
 * waiting-list offer means two people accept one place. PostgreSQL evaluates the predicate
 * against the row it locks, so the second UPDATE matches nothing and returns no row. This
 * holds for concurrent requests on separate connections, which is what production has.
 *
 * The classification query afterwards runs only when nothing was updated. It exists to give
 * the log a reason; the caller still shows the participant one generic message (§13.2).
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
    })
    .from(emailActionTokens)
    .where(eq(emailActionTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row) return TOKEN_NOT_FOUND;

  const evaluation = evaluateActionToken(row, purpose, now);
  // The UPDATE refused it, so an `ok` here would mean the two rule statements disagree —
  // report the row as invalid rather than telling the caller something the write did not do.
  return evaluation.ok ? { ok: false, code: "TOKEN_INVALID", reason: "NOT_FOUND" } : evaluation;
}
