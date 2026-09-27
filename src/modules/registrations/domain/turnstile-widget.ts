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
 * way out: «Reîncearcă verificarea», and a send button that never waits for a check that gave up.
 *
 * - `loading` — Cloudflare's script is on its way; nothing is drawn yet.
 * - `checking` — the widget is drawn and thinking (the usual half-second, or a retry after a tick).
 * - `interactive` — Cloudflare wants a tick (`before-interactive-callback`).
 * - `passed` — the token is in the form (`callback`).
 * - `expired` — the token outlived its five minutes (`expired-callback`); Cloudflare refreshes it.
 * - `timeout` — the box to tick waited too long (`timeout-callback`); Cloudflare draws it again.
 * - `error` — the widget failed (`error-callback`, or `render` threw); Cloudflare retries by itself,
 *   and the second failure gives up (`BOT_CHECK_FAILURES_BEFORE_GIVING_UP`).
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
 * The attribute the widget's element carries once the check has given up (`botCheckGaveUp`), for
 * the send button: present, the press goes without a token; absent, the state table decides.
 */
export const BOT_CHECK_GAVE_UP_ATTRIBUTE = "data-bot-check-gave-up";

/**
 * How many failures (`error-callback`, or `render` throwing) the widget takes before it gives up.
 * The first is Cloudflare's to retry — it does so by itself — and the person is offered
 * «Reîncearcă verificarea»; the second is the end of it: the form goes without the check (§NNN).
 */
export const BOT_CHECK_FAILURES_BEFORE_GIVING_UP = 2;

/**
 * A check that will not answer by itself: waiting for its token is waiting for nothing, so a press
 * goes straight through without one, and a press already held is sent at once (§NNN). The server
 * takes a missing token for the check not running, never for a robot (§216) — the same path §285's
 * valve takes eight seconds later, without the eight seconds.
 *
 * A script that refused or never came (`blocked`) and a browser that cannot run it (`unsupported`)
 * give up at once: nothing retries them by themselves. A failure (`error`) gives up only at the
 * second one — the first is still Cloudflare's to retry, and usually passes.
 */
export function botCheckGaveUp(state: string | null | undefined, failures: number): boolean {
  if (state === "unsupported" || state === "blocked") return true;
  return state === "error" && failures >= BOT_CHECK_FAILURES_BEFORE_GIVING_UP;
}

/**
 * Whether the check has yet to answer, for a press on the send button, from what the form shows
 * (§285, §NNN) — the widget's state, whether it gave up, and the token field's value:
 *
 * - gave up → answered: the press goes without a token (§216);
 * - `passed` → answered only with a token in the field (a reset empties it before it says so);
 * - `interactive`, `expired`, `timeout`, `error` before giving up → unanswered, **whatever the field
 *   holds**: a lapsed token may still sit there, and sending it buys the refusal the hold exists to
 *   spare (Cloudflare's documentation does not promise the field is emptied on expiry);
 * - `loading`, `checking` → by the field. A token written there is the answer even before the
 *   success callback says so: the field is the button's second signal (§NNN, held-press), proved
 *   alone by the end-to-end suite. A reset — ours on every attempt, Cloudflare's on a refresh —
 *   empties it before the state is `checking`, so no spent token is read here.
 * - no widget state at all (`null`) → by the field, as §285 did.
 *
 * `field` is `null` when no token field is drawn.
 */
export function botCheckUnansweredFrom(state: string | null, gaveUp: boolean, field: string | null): boolean {
  if (gaveUp) return false;
  switch (state) {
    case "passed":
      return field === null ? false : field === "";
    case "interactive":
    case "expired":
    case "timeout":
    case "error":
      return true;
    default:
      return field === null ? true : field === "";
  }
}

/**
 * Which of the held press's sentences the send button says, per the widget's state (§NNN): the
 * button carries the check's state in words, not only the widget's line. `valve` is not here — it
 * is said when the eight seconds are up, whatever the state.
 */
export type HeldHint = "checking" | "tick" | "expired";
export function botCheckHeldHint(state: string | null): HeldHint {
  if (state === "interactive" || state === "timeout") return "tick";
  if (state === "expired") return "expired";
  return "checking";
}

/**
 * Whether «Reîncearcă verificarea» is offered: every state a person can be left looking at — a
 * failure, a lapse, a check that is taking too long. Never while it merely works, and never for a
 * browser that cannot run it (a second try would fail the same way; the form goes without it).
 */
export function botCheckOffersRetry(state: BotCheckState, slow: boolean): boolean {
  if (state === "error" || state === "blocked" || state === "timeout" || state === "expired") return true;
  return slow && (state === "loading" || state === "checking");
}

/** What the person is asked to do, if anything: the states whose sentence is written to be noticed. */
export function botCheckAsksAttention(state: BotCheckState, slow: boolean): boolean {
  return state !== "passed" && (slow || !(state === "loading" || state === "checking"));
}

/**
 * The two things `/api/health` counts about the check over the last day (§NNN), level-only: no
 * address, no IP, no page — a word, counted per hour in the throttle's own table.
 *
 * - `held-press-valve` — a held press the eight-second valve sent, because the check never answered;
 * - `widget-failed` — a widget that reached `error` or `blocked` (once per widget and kind).
 */
export const BOT_CHECK_SIGNALS = ["held-press-valve", "widget-failed"] as const;
export type BotCheckSignal = (typeof BOT_CHECK_SIGNALS)[number];

/** Where the browser reports a signal; a path on this site, never an absolute URL (§8). */
export const BOT_CHECK_SIGNAL_PATH = "/api/bot-check-signal";

/**
 * Report one signal, fire-and-forget: a beacon (it survives the navigation a valve's send starts),
 * or a `keepalive` fetch where there is none. Never throws, never waits, never retries — a lost
 * count is a smaller figure on the health page, not a problem for the person sending the form.
 */
export function reportBotCheckSignal(signal: BotCheckSignal): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(BOT_CHECK_SIGNAL_PATH, signal)) return;
    if (typeof fetch === "function") void fetch(BOT_CHECK_SIGNAL_PATH, { method: "POST", body: signal, keepalive: true }).catch(() => {});
  } catch {
    // Nothing to do: see above.
  }
}
