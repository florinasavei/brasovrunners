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

export function turnstileSiteKey(): string | undefined {
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : undefined;
}

export type TurnstileVerdict = "passed" | "failed" | "not_configured";

/** Ask Cloudflare whether the token is genuine. A network failure counts as a failure: a bot's token is not waved through on a bad day. */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileVerdict> {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) return "not_configured";
  if (!token || token.length > 2048) return "failed";
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return "failed";
    const result = (await response.json()) as { success?: boolean };
    return result.success === true ? "passed" : "failed";
  } catch {
    return "failed";
  }
}
