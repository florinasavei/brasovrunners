/**
 * Whether an error means "the database is not there" — as opposed to "this query is wrong" (§NNN).
 *
 * The difference decides what the public site does next. A database that is away — Neon suspended
 * for the month, a compute that cannot start, a network that does not reach it — is the same for
 * every read for a while, so asking again on the next request only adds a failed connection to
 * every page view (`breaker.ts`). A query that is wrong is wrong for one read, and hiding it
 * behind a breaker would turn one broken page into a broken site.
 *
 * Read off the error and every `cause` beneath it: Drizzle wraps the driver's error in its own
 * (`DrizzleQueryError`, carrying the SQL, never printed here), and the driver's code or message is
 * what says which kind it is. Pure and total: anything unrecognised is not "away".
 */

/** Node's socket errors: nothing answered at the address, or the network did not reach it. */
const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"]);

/**
 * PostgreSQL's SQLSTATEs for "no server to talk to": class 08 (connection exception), 57P01–57P03
 * (the server is shutting down, crashed, or cannot take connections now) and 53300 (too many
 * connections).
 */
const SERVER_GONE_STATES = new Set(["08000", "08001", "08003", "08004", "08006", "57P01", "57P02", "57P03", "53300"]);

/**
 * What the driver and Neon's proxy say in words when there is no code to read: `pg`'s own
 * connection failures, and Neon's refusals for a project whose compute cannot run — the monthly
 * quota spent ("exceeded the compute time quota") or the endpoint switched off.
 */
const AWAY_MESSAGES = [
  /connection terminated/i,
  /timeout exceeded when trying to connect/i,
  /connection timeout/i,
  /compute time quota/i,
  /endpoint (?:is )?disabled/i,
  /couldn't connect to compute node/i,
  /the database is resting/i,
];

export function isDatabaseAwayError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const { code, message } = current as { code?: unknown; message?: unknown };
    if (typeof code === "string" && (NETWORK_CODES.has(code) || SERVER_GONE_STATES.has(code))) return true;
    if (typeof message === "string" && AWAY_MESSAGES.some((pattern) => pattern.test(message))) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
