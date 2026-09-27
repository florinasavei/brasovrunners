/**
 * The facts of Cloudflare Turnstile (`DECISIONS.md` §97) that the browser needs as well as the
 * server: where the widget's script comes from, the name of the field its token arrives in — and,
 * since §NNN, the states the widget says under itself, which the send button reads as well.
 *
 * A module of its own, importing nothing, because `TurnstileWidget` is a client island (§185) and
 * every module a client island imports is shipped to the browser with everything *it* imports.
 * These two lines lived in `../turnstile.ts`, whose first import is the server's configuration
 * (`shared/config/env.ts`), and with it the whole of Zod: 83 KB gzipped of JavaScript on the
 * contact page, the registration form and the group-run declaration, to read one URL (§489,
 * measured on a production build). The server's half — the site key, siteverify, the health
 * probe — stays in `../turnstile.ts`.
 */

/** Cloudflare's script, from its own fixed host — the one script the public site loads from anybody else. */
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/** The hidden field the widget writes its single-use token into, and the form posts. */
export const TURNSTILE_FIELD = "cf-turnstile-response";

/**
 * The event `TurnstileWidget` dispatches, bubbling, from its own element when Cloudflare's success
 * callback hands it a token (§NNN). A send button held for the
 * token (`SubmitButton`'s `awaitsBotCheck`) listens for it on its form, beside watching the hidden
 * field's `value` attribute: the callback is Cloudflare's documented answer, and the one signal
 * that does not depend on the field staying `type="hidden"` (whose `.value` is the attribute).
 */
export const TURNSTILE_TOKEN_EVENT = "br-turnstile-token";

/**
 * Every state the widget can be in, as the person reads it under the widget (§NNN). Each is said
 * in words (`BotCheck.<state>` in both catalogues), and each one a person can be stuck in offers a
 * way out: «Încearcă din nou», and a send button that never waits for a check that gave up.
 *
 * - `loading` — Cloudflare's script is on its way; nothing is drawn yet.
 * - `checking` — the widget is drawn and thinking (the usual half-second, or a retry after a tick).
 * - `interactive` — Cloudflare wants a tick (`before-interactive-callback`).
 * - `passed` — the token is in the form (`callback`).
 * - `expired` — the token outlived its five minutes (`expired-callback`); Cloudflare refreshes it.
 * - `timeout` — the box to tick waited too long (`timeout-callback`); Cloudflare draws it again.
 * - `error` — the widget failed (`error-callback`, or `render` threw); Cloudflare retries by itself.
 * - `unsupported` — this browser cannot run it (`unsupported-callback`).
 * - `blocked` — the script never arrived: a failed load, or nothing after `BOT_CHECK_BLOCKED_AFTER_MS`.
 */
export const BOT_CHECK_STATES = [
  "loading",
  "checking",
  "interactive",
  "passed",
  "expired",
  "timeout",
  "error",
  "unsupported",
  "blocked",
] as const;
export type BotCheckState = (typeof BOT_CHECK_STATES)[number];

/**
 * The attribute the widget's own element carries its state in, for the send button to read from
 * the form as it reads the token (§285) — the DOM, not a React context across two islands.
 */
export const BOT_CHECK_STATE_ATTRIBUTE = "data-bot-check";

/** How long the script may take before the widget says it did not load (a blocker, a proxy, offline). */
export const BOT_CHECK_BLOCKED_AFTER_MS = 10_000;

/** How long `loading` or `checking` may last before the widget offers to start it again. */
export const BOT_CHECK_SLOW_AFTER_MS = 12_000;

/**
 * A check that will not answer by itself: waiting for its token is waiting for nothing, so a press
 * goes straight through without one, and a press already held is sent at once (§NNN). The server
 * takes a missing token for the check not running, never for a robot (§216) — the same path §285's
 * valve takes eight seconds later, without the eight seconds.
 */
export function botCheckGaveUp(state: string | null | undefined): boolean {
  return state === "error" || state === "unsupported" || state === "blocked";
}

/**
 * Whether «Încearcă din nou» is offered: every state a person can be left looking at — a failure, a
 * lapse, a check that is taking too long. Never while it merely works, and never for a browser that
 * cannot run it (a second try would fail the same way; the form goes without it).
 */
export function botCheckOffersRetry(state: BotCheckState, slow: boolean): boolean {
  if (state === "error" || state === "blocked" || state === "timeout" || state === "expired") return true;
  return slow && (state === "loading" || state === "checking");
}

/** What the person is asked to do, if anything: the states whose sentence is written to be noticed. */
export function botCheckAsksAttention(state: BotCheckState, slow: boolean): boolean {
  return state !== "passed" && (slow || !(state === "loading" || state === "checking"));
}
