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

/**
 * A stand-in for Cloudflare's `api.js`, served in its place, so a spec decides *when* the check
 * answers — the one thing the real test widget cannot be asked (it answers at once).
 *
 * It does what the real script does to the page, and nothing more: `render` draws a wrapper into
 * the element and appends a hidden `cf-turnstile-response` input to it (light DOM, inside the
 * form); `reset` empties the field; `remove` takes the wrapper away. The answer comes only when the
 * spec calls `window.__answerTurnstile()`: the token is written with `.value =`, as Cloudflare
 * writes it, and the success callback is called, as Cloudflare calls it.
 */
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
      field.type = "hidden";
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
  window.__answerTurnstile = () => {
    for (const widget of widgets.values()) {
      widget.field.value = ${JSON.stringify(CLOUDFLARE_DUMMY_TOKEN)};
      if (typeof widget.options.callback === "function") widget.options.callback(widget.field.value);
    }
  };
})();
`;
