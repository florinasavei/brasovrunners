/**
 * The two facts of Cloudflare Turnstile (`DECISIONS.md` §97) that the browser needs as well as
 * the server: where the widget's script comes from, and the name of the field its token arrives in.
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
 * callback hands it a token (§502). A send button held for the
 * token (`SubmitButton`'s `awaitsBotCheck`) listens for it on its form, beside watching the hidden
 * field's `value` attribute: the callback is Cloudflare's documented answer, and the one signal
 * that does not depend on the field staying `type="hidden"` (whose `.value` is the attribute).
 */
export const TURNSTILE_TOKEN_EVENT = "br-turnstile-token";
