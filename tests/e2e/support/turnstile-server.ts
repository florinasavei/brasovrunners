/**
 * The suite's second server, the one that runs the anti-bot check (§NNN), and what a spec needs to
 * drive its widget. Imports nothing: `playwright.config.ts` reads the port and the keys from here.
 *
 * The keys are Cloudflare's own published test values
 * (developers.cloudflare.com/turnstile/troubleshooting/testing): a site key whose visible widget
 * always passes, and a secret that accepts only the dummy token such a widget produces. They are
 * the same for everybody and open nothing — never the club's keys, which live in its environments.
 */
export const TURNSTILE_E2E_PORT = Number(process.env.E2E_TURNSTILE_PORT ?? 4785);
export const TURNSTILE_E2E_URL = `http://localhost:${TURNSTILE_E2E_PORT}`;
export const CLOUDFLARE_TEST_SITE_KEY = "1x00000000000000000000AA";
export const CLOUDFLARE_TEST_SECRET = "1x0000000000000000000000000000000AA";
/** What Cloudflare's test widget answers, and the one token its test secret accepts. */
export const CLOUDFLARE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** Where the widget's script is fetched from — `TURNSTILE_SCRIPT_URL`, whatever its query. */
export const TURNSTILE_SCRIPT_PATTERN = /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js(\?|$)/;

/** The window flag that makes the stand-in draw a field the held button's observer cannot see. */
export const BLIND_FIELD_FLAG = "__e2eTurnstileBlindField";

/**
 * A stand-in for Cloudflare's `api.js`, served in its place, so a spec decides *when* the check
 * answers — the one thing the real test widget cannot be asked (it answers at once).
 *
 * It does what the real script does to the page, and nothing more: `render` draws a wrapper into
 * the element and appends a hidden `cf-turnstile-response` input to it (light DOM, inside the
 * form); `reset` empties the field; `remove` takes the wrapper away. The answer comes only when the
 * spec calls `window.__answerTurnstile(order)`: the token is written with `.value =`, as Cloudflare
 * writes it, and the success callback is called, as Cloudflare calls it. `order` says how:
 *
 * - `"write-then-call"` (the default): the field, then the callback.
 * - `"call-then-write"`: the callback before the field, so a button that read the field inside the
 *   callback would find it empty.
 * - `"write-only"`: the field and no callback.
 *
 * `window.__failTurnstile()` calls every widget's `error-callback`, and `window.__askTurnstile()` its
 * `before-interactive-callback` — the states the widget says under itself (§NNN). And
 * `window.__expireTurnstile()` its `expired-callback`, leaving the lapsed token in the field, and
 * `window.__timeoutTurnstile()` its `timeout-callback`, with the field emptied.
 *
 * On a `type="hidden"` field, as Cloudflare draws it, `.value =` sets the `value` attribute (the
 * HTML standard's "default" value mode), which the held button's MutationObserver sees — so the
 * default field shows the two signals together. With `window.__e2eTurnstileBlindField = true`
 * before the script runs (`addInitScript`), `render` draws the field as an unseen `type="text"` box,
 * whose `.value` is a property no observer and no event sees: there the success callback is the
 * only fast signal, and a spec can prove it works on its own.
 */
export type TurnstileAnswerOrder = "write-then-call" | "call-then-write" | "write-only";

export const FAKE_TURNSTILE_SCRIPT = `
(() => {
  const widgets = new Map();
  let next = 0;
  window.turnstile = {
    render(element, options) {
      const id = "cf-e2e-widget-" + next++;
      const wrapper = document.createElement("div");
      wrapper.dataset.e2eTurnstile = "true";
      const field = document.createElement("input");
      if (window.${BLIND_FIELD_FLAG} === true) {
        field.type = "text";
        field.style.display = "none";
      } else {
        field.type = "hidden";
      }
      field.name = "cf-turnstile-response";
      field.id = id + "_response";
      wrapper.appendChild(field);
      element.appendChild(wrapper);
      widgets.set(id, { wrapper, field, options });
      return id;
    },
    reset(id) {
      const widget = widgets.get(id);
      if (widget) widget.field.value = "";
    },
    remove(id) {
      const widget = widgets.get(id);
      if (widget) widget.wrapper.remove();
      widgets.delete(id);
    },
  };
  window.__answerTurnstile = (order = "write-then-call") => {
    const token = ${JSON.stringify(CLOUDFLARE_DUMMY_TOKEN)};
    for (const widget of widgets.values()) {
      const call = () => {
        if (order !== "write-only" && typeof widget.options.callback === "function") widget.options.callback(token);
      };
      if (order === "call-then-write") call();
      widget.field.value = token;
      if (order !== "call-then-write") call();
    }
  };
  window.__failTurnstile = () => {
    for (const widget of widgets.values()) {
      if (typeof widget.options["error-callback"] === "function") widget.options["error-callback"]("300010");
    }
  };
  // The token lapsed: Cloudflare calls the expired callback, and nothing promises the field is
  // emptied — the stale token stays in it here on purpose, so a spec proves it is never sent.
  window.__expireTurnstile = () => {
    for (const widget of widgets.values()) {
      if (typeof widget.options["expired-callback"] === "function") widget.options["expired-callback"]();
    }
  };
  // The box to tick waited too long: the timeout callback, with no token in the field.
  window.__timeoutTurnstile = () => {
    for (const widget of widgets.values()) {
      widget.field.value = "";
      if (typeof widget.options["timeout-callback"] === "function") widget.options["timeout-callback"]();
    }
  };
  window.__askTurnstile = () => {
    for (const widget of widgets.values()) {
      if (typeof widget.options["before-interactive-callback"] === "function") widget.options["before-interactive-callback"]();
    }
  };
})();
`;
