/**
 * Whether an error means "the database is not there" — as opposed to "this query is wrong" (§447).
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

/**
 * Neon's own refusal of a project whose monthly compute quota is spent ("exceeded the compute time
 * quota") — the one away-error that says how long it lasts: until the billing period ends.
 *
 * It is read off the error on its own, whatever the governor's level says, because the level can
 * lag the refusal: with a project-scoped key the level comes from the operations log, which counts
 * only the compute's floor and stops growing once Neon suspends the project (no further
 * `start_compute` succeeds), so a project Neon has cut off may still read 98–99%. The error in
 * hand is the better witness.
 */
const QUOTA_MESSAGE = /compute time quota/i;

export function isQuotaRefusalError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const { message } = current as { message?: unknown };
    if (typeof message === "string" && QUOTA_MESSAGE.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * When a quota refusal ends if nothing better says: the start of the next calendar month in UTC,
 * which is where Neon's billing periods turn (the project row's `consumption_period_end`), and in
 * any case no further than `QUOTA_REST_MAX_DAYS` away — a bound, so a clock or a period that
 * changed shape can never leave the site serving copies for longer than a month.
 */
export const QUOTA_REST_MAX_DAYS = 31;

export function defaultRestingUntil(now: Date): Date {
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const bound = new Date(now.getTime() + QUOTA_REST_MAX_DAYS * 86_400_000);
  return nextMonth < bound ? nextMonth : bound;
}
