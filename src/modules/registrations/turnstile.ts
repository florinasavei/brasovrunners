import { env } from "@/shared/config/env";

/**
 * Cloudflare Turnstile on the public registration form (`DECISIONS.md` §97; the owner: "I
 * need a captcha, I need to be safe from bots"). Behind two keys: with `TURNSTILE_SITE_KEY`
 * and `TURNSTILE_SECRET_KEY` set the form shows the widget and the server refuses a
 * submission whose token Cloudflare does not confirm; with neither set nothing changes — the
 * honeypot and the timing check stay in front of the form either way (AGENTS.md §19.4).
 *
 * The widget is Cloudflare's script from its own fixed host — the one script the public site
 * loads from anybody else — and the token it puts in `cf-turnstile-response` is verified
 * server-side with the secret, once, against Cloudflare's siteverify. The visitor's address
 * goes to Cloudflare with the challenge, which is why the privacy notice names Turnstile.
 */
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_FIELD = "cf-turnstile-response";

/**
 * Siteverify's error codes that say the *server's* side is wrong — a missing or invalid secret, or
 * Cloudflare's own internal error — and nothing about the visitor's token (§NNN). Every other
 * code (`invalid-input-response`, `timeout-or-duplicate`, …) is about the token, and stays a refusal.
 */
const SERVER_SIDE_ERROR_CODES: ReadonlySet<string> = new Set(["missing-input-secret", "invalid-input-secret", "internal-error"]);

/**
 * Of those, the codes that say the *secret* is wrong (§NNN). `internal-error` is Cloudflare's own
 * fault — transient, like a 5xx — and says nothing about the secret, so the health probe reads it
 * as `unreachable`, never `misconfigured`: a passing fault must not show a wrong secret for the
 * probe's cache window.
 */
const SECRET_ERROR_CODES: ReadonlySet<string> = new Set(["missing-input-secret", "invalid-input-secret"]);

export function turnstileSiteKey(): string | undefined {
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : undefined;
}

/**
 * What the check concluded (`DECISIONS.md` §216).
 *
 * `unavailable` is the one that matters, and it is separate from `failed` because the two are
 * not the same event and must not have the same consequence:
 *
 * - **`failed`** is a token Cloudflare looked at and rejected. That is evidence.
 * - **`unavailable`** is no token at all, or Cloudflare not answering. That is the *absence*
 *   of evidence, and it happens to real people constantly: a content blocker or a privacy
 *   browser that refuses `challenges.cloudflare.com`, a corporate proxy, a phone on a bad
 *   connection, JavaScript switched off, or Cloudflare itself having a bad five seconds.
 */
export type TurnstileVerdict = "passed" | "failed" | "unavailable" | "not_configured";

/**
 * Ask Cloudflare whether the token is genuine.
 *
 * **This used to answer `failed` when there was no token and when Cloudflare could not be
 * reached**, with the reasoning that "a bot's token is not waved through on a bad day". The
 * reasoning was wrong about which failure costs more. A bot that omits the token still has to
 * get past the honeypot, the timing check and the per-identity throttle (`AGENTS.md` §19.4);
 * a *person* whose browser never loaded the widget was simply unable to register, with a
 * message telling them to tick a box that was not on their screen. It happened: Dani could not
 * register on 2026-09-21, on two different addresses, and the address was never the problem.
 *
 * The owner's standing rule decides it (§205): "trebuie să lăsăm oamenii să se înscrie cu orice
 * preț!!! Asta e scopul principal al site-ului." A challenge that cannot run is not a reason to
 * refuse a registration; a challenge that ran and said no is.
 *
 * An over-long token is still `failed` — nothing legitimate produces one, and it is a token
 * that *was* submitted rather than one that was not.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileVerdict> {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) return "not_configured";
  if (!token) return "unavailable";
  if (token.length > 2048) return "failed";
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5_000),
    });
    // Cloudflare answering 5xx is Cloudflare having a bad day, not this visitor failing one.
    if (!response.ok) return "unavailable";
    const result = (await response.json()) as { success?: boolean; "error-codes"?: unknown };
    if (result.success === true) return "passed";
    /*
      A refusal about *our* configuration is not a refusal of this visitor (§NNN). Cloudflare
      answers a mistyped, rotated or another widget's secret — and its own internal error — with
      HTTP 200 and `success: false`, the same shape as a token it rejected. Scored as `failed`,
      that refused every person whose widget loaded while only the people whose browser blocked it
      got through: §216's refusal of a real person, for a key nobody noticed was wrong. It is the
      check not running, so it is `unavailable`, and it is said loudly — the codes only, never the
      token or an address — because nothing else on the platform would notice.
    */
    const codes = Array.isArray(result["error-codes"]) ? result["error-codes"].map(String) : [];
    const ours = codes.filter((code) => SERVER_SIDE_ERROR_CODES.has(code));
    if (ours.length > 0) {
      console.error(`[turnstile] the check could not run on the server's side: ${ours.join(", ")}`);
      return "unavailable";
    }
    return "failed";
  } catch {
    // Timed out or could not be reached. The same reasoning as above.
    return "unavailable";
  }
}

/** How long `/api/health` and `/admin/tasks` trust one secret probe before asking Cloudflare again. */
const TURNSTILE_HEALTH_CACHE_SECONDS = 900;

/**
 * What the secret-health probe answered (§NNN, closing finding (10)'s health half).
 *
 * `verifyTurnstile` fails a misconfigured secret *open* on purpose (§205) — a wrong
 * `TURNSTILE_SECRET_KEY` must never refuse a real registration — but that meant nothing on the
 * platform ever noticed the secret was wrong; only `console.error` did, which nobody reads on a
 * deployed server. This probe is how something that *is* read — `/api/health`, `/admin/tasks` —
 * finds out.
 *
 * `misconfigured` and `unreachable` are kept apart the same way `verifyTurnstile` keeps `failed`
 * and `unavailable` apart: a timeout or a 5xx from Cloudflare is not evidence the secret is
 * wrong, so it must never turn the health check red on its own.
 */
export type TurnstileSecretHealth = "ok" | "misconfigured" | "unreachable" | "not_configured";

/**
 * Asks Cloudflare whether the configured secret is even the right shape of wrong.
 *
 * There is no way to prove a secret is *right* without a real widget token, so this proves the
 * cheaper half: it sends a token that is certainly not real. Cloudflare always rejects it — the
 * question is which reason it gives. A secret that matches the site key answers
 * `invalid-input-response` (the token, not the secret, is bad) or `timeout-or-duplicate`, and
 * that is `ok`. A secret that is missing, mistyped or belongs to another widget answers
 * `missing-input-secret` or `invalid-input-secret` regardless of the token (`SECRET_ERROR_CODES`),
 * and that alone is `misconfigured`. Cloudflare's `internal-error` is its own passing fault, read
 * like a 5xx or a timeout: `unreachable`.
 */
export async function probeTurnstileSecret(fetchImpl: typeof fetch = fetch): Promise<TurnstileSecretHealth> {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) return "not_configured";
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: "XXXX.DUMMY.TOKEN.health-probe-never-a-real-widget-response.XXXX",
  });
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5_000),
      next: { revalidate: TURNSTILE_HEALTH_CACHE_SECONDS },
    });
    if (!response.ok) return "unreachable";
    const result = (await response.json()) as { success?: boolean; "error-codes"?: unknown };
    if (result.success === true) return "ok";
    const codes = Array.isArray(result["error-codes"]) ? result["error-codes"].map(String) : [];
    if (codes.some((code) => SECRET_ERROR_CODES.has(code))) return "misconfigured";
    return codes.includes("internal-error") ? "unreachable" : "ok";
  } catch {
    return "unreachable";
  }
}
