import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  BOT_CHECK_BLOCKED_AFTER_MS,
  BOT_CHECK_SLOW_AFTER_MS,
  BOT_CHECK_FAILURES_BEFORE_GIVING_UP,
  BOT_CHECK_WIDGET_STATES,
  botCheckAsksAttention,
  botCheckCallbacks,
  botCheckGaveUp,
  botCheckHeldHint,
  botCheckOffersRetry,
  botCheckUnansweredFrom,
  type BotCheckRelay,
  type BotCheckWidgetState,
  drawBotCheck,
  type TurnstileRenderOptions,
} from "@/modules/registrations/domain/turnstile-widget";

/**
 * BR-REQ-041-01 — the anti-bot check on the registration form, every state visible and
 * recoverable; `DECISIONS.md` §185, §216, §285 and §NNN.
 *
 * Cloudflare's frame says «Success!» or draws a box, and says nothing when its script is blocked,
 * when it fails, when its token lapses or when the box waited too long; the send button guessed
 * from an empty field and held a press for eight seconds for a check that had already given up.
 * The widget now names each state under itself, in both languages, offers «Încearcă din nou»
 * wherever a person can be stuck, and writes the state where the button reads it.
 *
 * The vocabulary is pure and tested as such; the wiring is a handful of lines in two client
 * islands, pinned at source level like `held-press-is-sent.test.ts` (the unit suite has no DOM).
 * The browser side is `registration-turnstile.spec.ts`.
 */
const ROOT = path.resolve(__dirname, "../../..");
/** The sentences a form without a held press says in place of the registration form's (§NNN). */
const PLAIN_KEYS = ["unsupported", "blocked", "slow", "failed"] as const;
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

describe("§NNN the widget's states", () => {
  it("gives up at a blocked script and an unsupported browser at once, and at the second failure — not the first", () => {
    expect(BOT_CHECK_FAILURES_BEFORE_GIVING_UP).toBe(2);
    expect(BOT_CHECK_WIDGET_STATES.filter((state) => botCheckGaveUp(state, 1))).toEqual(["unsupported", "blocked"]);
    expect(BOT_CHECK_WIDGET_STATES.filter((state) => botCheckGaveUp(state, 2))).toEqual(["error", "unsupported", "blocked"]);
    // A widget that has not said anything yet (no attribute) is not taken for one that gave up.
    expect(botCheckGaveUp(null, 5)).toBe(false);
    expect(botCheckGaveUp(undefined, 5)).toBe(false);
  });

  it("the state table: a lapsed or unticked check holds a press whatever its field still holds", () => {
    const STALE = "stale-token";
    // Gave up: never waited for, token or not.
    expect(botCheckUnansweredFrom("error", true, "")).toBe(false);
    expect(botCheckUnansweredFrom("blocked", true, null)).toBe(false);
    // A token that may have lapsed is never sent.
    for (const state of ["interactive", "expired", "timeout", "error"]) {
      expect(botCheckUnansweredFrom(state, false, STALE), state).toBe(true);
      expect(botCheckUnansweredFrom(state, false, ""), state).toBe(true);
      expect(botCheckUnansweredFrom(state, false, null), state).toBe(true);
    }
    // Passed: answered only with a token in the field.
    expect(botCheckUnansweredFrom("passed", false, "token")).toBe(false);
    expect(botCheckUnansweredFrom("passed", false, "")).toBe(true);
    // Thinking: the field is the second signal (a token there is the answer before the callback).
    for (const state of ["loading", "checking", null]) {
      expect(botCheckUnansweredFrom(state, false, "token"), String(state)).toBe(false);
      expect(botCheckUnansweredFrom(state, false, ""), String(state)).toBe(true);
      expect(botCheckUnansweredFrom(state, false, null), String(state)).toBe(true);
    }
  });

  it("the held press says the check's state: thinking, a box to tick, a lapsed token", () => {
    expect(botCheckHeldHint("loading")).toBe("checking");
    expect(botCheckHeldHint("checking")).toBe("checking");
    expect(botCheckHeldHint("error")).toBe("checking");
    expect(botCheckHeldHint(null)).toBe("checking");
    expect(botCheckHeldHint("interactive")).toBe("tick");
    expect(botCheckHeldHint("timeout")).toBe("tick");
    expect(botCheckHeldHint("expired")).toBe("expired");
  });

  it("the button's sentences are the owner's words, in both languages", () => {
    expect(ro.Registration.botCheckWait).toMatch(/^Se verifică…/);
    expect(ro.Registration.botCheckTick).toMatch(/^Bifează căsuța de mai sus/);
    expect(ro.Registration.botCheckExpired).toMatch(/^Verificarea a expirat — se reface/);
    expect(ro.Registration.botCheckValve).toBe("Trimitem fără verificare automată…");
    expect(en.Registration.botCheckValve).toBe("Sending without the automatic check…");
    // The three held sentences keep the promise the e2e suite tells a held press by; the valve's does not.
    for (const key of ["botCheckWait", "botCheckTick", "botCheckExpired"] as const) {
      expect(ro.Registration[key], key).toContain("trimitem noi înscrierea imediat ce răspunde");
      expect(en.Registration[key], key).toContain("we send the form ourselves");
    }
    // The owner's fail-open sentence, wherever the check gave up.
    for (const key of ["failed", "blocked", "unsupported"] as const) {
      expect(ro.BotCheck[key], key).toContain("Nu am putut verifica automat; trimitem oricum, iar clubul confirmă");
      expect(en.BotCheck[key], key).toContain("We could not check automatically; we send it anyway, and the club confirms");
    }
    expect(ro.BotCheck.retry).toBe("Reîncearcă verificarea");
  });

  it("offers «Încearcă din nou» wherever a person can be stuck, never while it works or cannot work", () => {
    const offered = BOT_CHECK_WIDGET_STATES.filter((state) => botCheckOffersRetry(state, false));
    expect(offered).toEqual(["expired", "timeout", "error", "blocked"]);
    // A check taking too long gets it as well; a passed one and an unsupported browser never do.
    expect(botCheckOffersRetry("loading", true)).toBe(true);
    expect(botCheckOffersRetry("checking", true)).toBe(true);
    expect(botCheckOffersRetry("passed", true)).toBe(false);
    expect(botCheckOffersRetry("unsupported", true)).toBe(false);
    expect(botCheckOffersRetry("interactive", true)).toBe(false);
  });

  it("asks for attention only where there is something to do or to know", () => {
    expect(botCheckAsksAttention("loading", false)).toBe(false);
    expect(botCheckAsksAttention("checking", false)).toBe(false);
    expect(botCheckAsksAttention("passed", false)).toBe(false);
    expect(botCheckAsksAttention("checking", true)).toBe(true);
    for (const state of ["interactive", "expired", "timeout", "error", "unsupported", "blocked"] as const) {
      expect(botCheckAsksAttention(state, false), state).toBe(true);
    }
  });

  it("says a script is blocked after the button's own grace, and a check is slow after that", () => {
    // `SubmitButton` waits eight seconds for a widget never drawn (§285); the widget says so after.
    expect(BOT_CHECK_BLOCKED_AFTER_MS).toBeGreaterThanOrEqual(8_000);
    expect(BOT_CHECK_SLOW_AFTER_MS).toBeGreaterThan(BOT_CHECK_BLOCKED_AFTER_MS);
  });

  it("says every state, the slow line and the retry in both languages, and promises nothing a missing token would break", () => {
    const keys = [...BOT_CHECK_WIDGET_STATES, "slow", "retry", "failed"];
    for (const [name, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const { plain, ...words } = (catalogue as unknown as { BotCheck: Record<string, string> & { plain: Record<string, string> } }).BotCheck;
      expect(Object.keys(words).sort(), name).toEqual([...keys].sort());
      expect(Object.keys(plain).sort(), name).toEqual([...PLAIN_KEYS].sort());
      for (const key of PLAIN_KEYS) expect(plain[key].trim(), `${name}.BotCheck.plain.${key}`).not.toBe("");
      for (const key of keys) expect(words[key].trim(), `${name}.BotCheck.${key}`).not.toBe("");
      // The held press's own sentence lives on the button; the widget never repeats it (the
      // e2e spec tells a held press by it).
      for (const key of keys) expect(words[key], `${name}.BotCheck.${key}`).not.toMatch(/trimitem noi înscrierea|we send the form ourselves/);
    }
    // The failure sentences name the retry by its own label, so the words and the button agree.
    for (const key of ["error", "blocked", "slow", "failed"] as const) {
      expect(ro.BotCheck[key]).toContain(`«${ro.BotCheck.retry}»`);
      expect(en.BotCheck[key]).toContain(`“${en.BotCheck.retry}”`);
    }
    for (const key of ["blocked", "slow", "failed"] as const) {
      expect(ro.BotCheck.plain[key]).toContain(`«${ro.BotCheck.retry}»`);
      expect(en.BotCheck.plain[key]).toContain(`“${en.BotCheck.retry}”`);
    }
  });

  it("a form with no held press never promises the valve or the club's confirmation (review nit, §NNN)", () => {
    for (const key of PLAIN_KEYS) {
      expect(ro.BotCheck.plain[key], key).not.toMatch(/clubul confirmă|pleacă și fără ea|trimitem/);
      expect(en.BotCheck.plain[key], key).not.toMatch(/club confirms|goes without it|we send/);
      expect(ro.BotCheck.plain[key], key).toMatch(/trimite oricum/);
      expect(en.BotCheck.plain[key], key).toMatch(/send anyway/);
    }
    expect(ro.BotCheck.plain.failed).toMatch(/^Verificarea a eșuat; poți trimite oricum/);
  });
});

describe("§NNN the wiring", () => {
  const widget = read("src/modules/registrations/ui/TurnstileWidget.tsx");
  const button = read("src/shared/ui/SubmitButton.tsx");

  it("draws through `drawBotCheck`, and hands every callback this run's `become` through the relay", () => {
    expect(widget).toMatch(/relay\.current = become;/);
    expect(widget).toMatch(/drawBotCheck\(window\.turnstile, element, widgetId, relay, \{/);
    // A cleanup forgets only its own `become`: the next run's is already in the relay.
    expect(widget.split("if (relay.current === become) relay.current = null;").length - 1).toBe(2);
    // Cloudflare's own retries stay on: nothing sets `retry` or the refresh options away from `auto`.
    const domain = read("src/modules/registrations/domain/turnstile-widget.ts");
    for (const source of [widget, domain]) {
      expect(source).not.toMatch(/\bretry: "never"|"refresh-expired": "(manual|never)"|"refresh-timeout": "(manual|never)"/);
    }
  });

  it("says a script that refused or never came, and draws it again on «Reîncearcă verificarea»", () => {
    expect(widget).toMatch(/script\.addEventListener\("error", refused\);/);
    expect(widget).toMatch(/if \(!window\.turnstile\) become\("blocked"\);/);
    // Only a tag that failed goes: one still on its way would run anyway, and twice is an error.
    expect(widget).toMatch(/script\.dataset\.turnstileFailed = "true";/);
    expect(widget).toMatch(/if \(!api\) document\.querySelector\(`\$\{SCRIPT_SELECTOR\}\[data-turnstile-failed\]`\)\?\.remove\(\);/);
    expect(widget).toMatch(/api\.reset\(widgetId\.current\);/);
    // A tag that already failed is replaced at once on a new mount, not waited for (nit 7).
    expect(widget).toMatch(/if \(found\?\.dataset\.turnstileFailed\) found\.remove\(\);/);
  });

  it("counts a failure, gives up at the second, and marks it for the button", () => {
    expect(widget).toMatch(/if \(next === "error"\) setFailures\(\(count\) => count \+ 1\);/);
    expect(widget).toMatch(/const gaveUp = botCheckGaveUp\(state, failures\);/);
    expect(widget).toMatch(/\[BOT_CHECK_GAVE_UP_ATTRIBUTE\]: "true"/);
    // A failure in this attempt rides with the form, for the register action to count (§NNN).
    expect(widget).toMatch(/if \(next === "error" \|\| next === "blocked"\) setFailedIn\(attempt\);/);
    expect(widget).toMatch(/\{failedIn === attempt && <input type="hidden" name=\{BOT_CHECK_SIGNAL_FIELD\} value="widget-failed" \/>\}/);
  });

  it("one live region while a press is held: the widget's line goes quiet, the button speaks", () => {
    expect(widget).toMatch(/aria-live=\{quiet \? "off" : "polite"\}/);
    expect(widget).toMatch(/setQuiet\(form \? isPressHeld\(form\) : false\);/);
  });

  it("writes its state on its own element, speaks only once running, and the retry is a thumb's target", () => {
    expect(widget).toMatch(/\[BOT_CHECK_STATE_ATTRIBUTE\]: state/);
    expect(widget).toMatch(/\{running && \(/);
    expect(widget).toMatch(/role="status"/);
    expect(widget).toMatch(/sx=\{TAP_TARGET\}/);
    expect(widget).toMatch(/type="button"/);
  });

  it("the send button holds no press for a check that gave up, and lets a held one go when it does", () => {
    expect(button).toMatch(/botCheckUnansweredFrom\(widget\.getAttribute\(BOT_CHECK_STATE_ATTRIBUTE\), widget\.hasAttribute\(BOT_CHECK_GAVE_UP_ATTRIBUTE\), value\)/);
    expect(button).toMatch(/attributeFilter: \["value", BOT_CHECK_STATE_ATTRIBUTE, BOT_CHECK_GAVE_UP_ATTRIBUTE\]/);
  });

  it("the send button says the check's state, is busy while held, and announces the valve before it sends", () => {
    expect(button).toMatch(/aria-busy=\{pending \|\| holding\}/);
    expect(button).toMatch(/heldHints\[botCheckHeldHint\(checkState\)\]/);
    expect(button).toMatch(/const notice = setTimeout\(\(\) => setValved\(true\), RELEASE_AFTER_MS - VALVE_NOTICE_MS\);/);
    expect(button).toMatch(/const valve = setTimeout\(\(\) => send\(true\), RELEASE_AFTER_MS\);/);
    // The valve's send names itself as the submitter's word, only around that one send (§NNN).
    expect(button).toMatch(/if \(byValve\) \{\s*button\.name = BOT_CHECK_SIGNAL_FIELD;\s*button\.value = "held-press-valve";\s*\}/);
    expect(button).toMatch(/finally \{\s*if \(byValve\) \{\s*button\.removeAttribute\("name"\);\s*button\.removeAttribute\("value"\);/);
    expect(button).not.toMatch(/sendBeacon|reportBotCheckSignal/);
    const page = read("src/app/[locale]/events/[slug]/register/page.tsx");
    for (const [prop, key] of [
      ["botCheckHint", "botCheckWait"],
      ["botCheckTickHint", "botCheckTick"],
      ["botCheckExpiredHint", "botCheckExpired"],
      ["botCheckValveHint", "botCheckValve"],
    ]) {
      // Both awaiting buttons of the form: the main one and «Retrimite».
      expect(page.split(`${prop}={t("${key}")}`).length - 1, prop).toBe(2);
    }
  });

  it("every form that runs the check places it with its words", () => {
    for (const page of [
      "src/app/[locale]/events/[slug]/register/page.tsx",
      "src/app/[locale]/contact/page.tsx",
      "src/app/[locale]/events/[slug]/declaration/page.tsx",
      "src/modules/newsletter/ui/NewsletterSignup.tsx",
    ]) {
      const source = read(page);
      expect(source, page).toContain('import BotCheck from "@/modules/registrations/ui/BotCheck";');
      expect(source, page).not.toContain("<TurnstileWidget ");
    }
    const place = read("src/modules/registrations/ui/BotCheck.tsx");
    for (const key of [...BOT_CHECK_WIDGET_STATES, "slow", "retry", "failed"]) expect(place, key).toMatch(new RegExp(`${key}: (heldPress \\? )?t\\("${key}"\\)`));
    for (const key of PLAIN_KEYS) expect(place, key).toContain(`${key}: heldPress ? t("${key}") : t("plain.${key}")`);
    // Only the registration form holds a press, so only it says the held-press sentences.
    expect(read("src/app/[locale]/events/[slug]/register/page.tsx")).toMatch(/<BotCheck [^>]*heldPress \/>/);
    for (const page of ["src/app/[locale]/contact/page.tsx", "src/app/[locale]/events/[slug]/declaration/page.tsx", "src/modules/newsletter/ui/NewsletterSignup.tsx"]) {
      expect(read(page), page).not.toMatch(/<BotCheck [^>]*heldPress/);
    }
  });
});

/**
 * The review's blocker (§NNN): after the form's first server re-render the widget stopped saying
 * its state. The callbacks Cloudflare keeps are the ones `render` got from the run that drew the
 * widget; the effect runs again on every attempt and `reset()`s the same widget, so a callback that
 * held the first run's `become` — cancelled by that re-render — said nothing ever again. Driven here
 * with a fake `window.turnstile` through the very functions the island calls, run by run as React
 * runs the effect: draw, re-render with a new attempt, and Cloudflare calling back.
 */
describe("§NNN the widget's callbacks outlive the effect run that drew it", () => {
  function fakeTurnstile() {
    const drawn: TurnstileRenderOptions[] = [];
    let resets = 0;
    const api = {
      render: (_element: object, options: TurnstileRenderOptions) => {
        drawn.push(options);
        return `cf-widget-${drawn.length}`;
      },
      reset: () => {
        resets += 1;
      },
    };
    return { api, drawn, resets: () => resets };
  }

  /** One effect run as `TurnstileWidget` runs it: its own `become`, cancelled by its cleanup. */
  function effectRun(relay: BotCheckRelay, said: BotCheckWidgetState[]) {
    let cancelled = false;
    const become = (state: BotCheckWidgetState) => {
      if (!cancelled) said.push(state);
    };
    relay.current = become;
    return () => {
      cancelled = true;
      if (relay.current === become) relay.current = null;
    };
  }

  it("render → server re-render (a new attempt) → the callback fires: the current run hears it", () => {
    const { api, drawn, resets } = fakeTurnstile();
    const relay: BotCheckRelay = { current: null };
    const widget = { current: null as string | null };
    let tokens = 0;
    const draw = () => drawBotCheck(api, {}, widget, relay, { sitekey: "k", language: "ro", onToken: () => (tokens += 1) });

    // First attempt: drawn once.
    const first: BotCheckWidgetState[] = [];
    const cleanupFirst = effectRun(relay, first);
    draw();
    expect(drawn).toHaveLength(1);
    expect(first).toEqual(["checking"]);

    // The server re-renders with a new `attempt`: the first run is cleaned up, the second resets
    // the same widget — no second widget, and the callbacks Cloudflare holds are still the first's.
    cleanupFirst();
    const second: BotCheckWidgetState[] = [];
    effectRun(relay, second);
    draw();
    expect(drawn).toHaveLength(1);
    expect(resets()).toBe(1);
    expect(second).toEqual(["checking"]);

    // Cloudflare calls back through the options it was given at the first draw.
    const options = drawn[0];
    options["before-interactive-callback"]();
    options.callback("token");
    expect(second).toEqual(["checking", "interactive", "passed"]);
    expect(tokens).toBe(1);
    // The cancelled run hears nothing after its cleanup.
    expect(first).toEqual(["checking"]);
  });

  it("every documented callback names its state, and the error callback leaves the retry to Cloudflare", () => {
    const said: BotCheckWidgetState[] = [];
    const callbacks = botCheckCallbacks({ current: (state) => said.push(state) }, () => {});
    expect(callbacks["error-callback"]("300010")).toBe(false);
    callbacks["expired-callback"]();
    callbacks["timeout-callback"]();
    callbacks["before-interactive-callback"]();
    callbacks["after-interactive-callback"]();
    callbacks["unsupported-callback"]();
    callbacks.callback("token");
    expect(said).toEqual(["error", "expired", "timeout", "interactive", "checking", "unsupported", "passed"]);
  });

  it("a callback after the island is gone says nothing and throws nothing", () => {
    const callbacks = botCheckCallbacks({ current: null }, () => {});
    expect(() => callbacks.callback("token")).not.toThrow();
    expect(callbacks["error-callback"]("300010")).toBe(false);
  });

  it("a widget Cloudflare refused to draw is a failure, said through the current run", () => {
    const said: BotCheckWidgetState[] = [];
    const widget = { current: null as string | null };
    const api = {
      render: () => {
        throw new Error("bad option");
      },
      reset: () => {},
    };
    drawBotCheck(api, {}, widget, { current: (state) => said.push(state) }, { sitekey: "k", language: "ro", onToken: () => {} });
    expect(said).toEqual(["checking", "error"]);
    expect(widget.current).toBeNull();
  });
});
