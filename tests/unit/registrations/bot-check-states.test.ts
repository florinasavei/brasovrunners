import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  BOT_CHECK_BLOCKED_AFTER_MS,
  BOT_CHECK_SLOW_AFTER_MS,
  BOT_CHECK_STATES,
  botCheckAsksAttention,
  botCheckGaveUp,
  botCheckOffersRetry,
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
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

describe("§NNN the widget's states", () => {
  it("a check that gave up holds no press: failed, blocked, unsupported — and nothing else", () => {
    const gaveUp = BOT_CHECK_STATES.filter((state) => botCheckGaveUp(state));
    expect(gaveUp).toEqual(["error", "unsupported", "blocked"]);
    // A widget that has not said anything yet (no attribute) is not taken for one that gave up.
    expect(botCheckGaveUp(null)).toBe(false);
    expect(botCheckGaveUp(undefined)).toBe(false);
  });

  it("offers «Încearcă din nou» wherever a person can be stuck, never while it works or cannot work", () => {
    const offered = BOT_CHECK_STATES.filter((state) => botCheckOffersRetry(state, false));
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
    const keys = [...BOT_CHECK_STATES, "slow", "retry"];
    for (const [name, catalogue] of [
      ["ro", ro],
      ["en", en],
    ] as const) {
      const words = (catalogue as unknown as { BotCheck: Record<string, string> }).BotCheck;
      expect(Object.keys(words).sort(), name).toEqual([...keys].sort());
      for (const key of keys) expect(words[key].trim(), `${name}.BotCheck.${key}`).not.toBe("");
      // The held press's own sentence lives on the button; the widget never repeats it (the
      // e2e spec tells a held press by it).
      for (const key of keys) expect(words[key], `${name}.BotCheck.${key}`).not.toMatch(/trimitem noi înscrierea|we send the form ourselves/);
    }
    // The failure sentences name the retry by its own label, so the words and the button agree.
    for (const key of ["error", "blocked", "slow"]) {
      expect(ro.BotCheck[key as keyof typeof ro.BotCheck]).toContain(`«${ro.BotCheck.retry}»`);
      expect(en.BotCheck[key as keyof typeof en.BotCheck]).toContain(`“${en.BotCheck.retry}”`);
    }
  });
});

describe("§NNN the wiring", () => {
  const widget = read("src/modules/registrations/ui/TurnstileWidget.tsx");
  const button = read("src/shared/ui/SubmitButton.tsx");

  it("names a state for each of Cloudflare's documented callbacks", () => {
    for (const [callback, state] of [
      ["error-callback", "error"],
      ["expired-callback", "expired"],
      ["timeout-callback", "timeout"],
      ["before-interactive-callback", "interactive"],
      ["after-interactive-callback", "checking"],
      ["unsupported-callback", "unsupported"],
    ]) {
      expect(widget, callback).toMatch(new RegExp(`"${callback}": \\(\\) =>[\\s\\S]{0,40}become\\("${state}"\\)`));
    }
    expect(widget).toMatch(/callback: \(\) => \{\s*\r?\n\s*become\("passed"\);/);
    // Cloudflare's own retries stay on: nothing sets `retry` or the refresh options away from `auto`.
    expect(widget).not.toMatch(/\bretry: "never"|"refresh-expired": "(manual|never)"|"refresh-timeout": "(manual|never)"/);
  });

  it("says a script that refused or never came, and draws it again on «Încearcă din nou»", () => {
    expect(widget).toMatch(/script\.addEventListener\("error", refused\);/);
    expect(widget).toMatch(/if \(!window\.turnstile\) become\("blocked"\);/);
    // Only a tag that failed goes: one still on its way would run anyway, and twice is an error.
    expect(widget).toMatch(/script\.dataset\.turnstileFailed = "true";/);
    expect(widget).toMatch(/if \(!api\) document\.querySelector\(`\$\{SCRIPT_SELECTOR\}\[data-turnstile-failed\]`\)\?\.remove\(\);/);
    expect(widget).toMatch(/api\.reset\(widgetId\.current\);/);
  });

  it("writes its state on its own element, speaks only once running, and the retry is a thumb's target", () => {
    expect(widget).toMatch(/\[BOT_CHECK_STATE_ATTRIBUTE\]: state/);
    expect(widget).toMatch(/\{running && \(/);
    expect(widget).toMatch(/role="status"/);
    expect(widget).toMatch(/sx=\{TAP_TARGET\}/);
    expect(widget).toMatch(/type="button"/);
  });

  it("the send button holds no press for a check that gave up, and lets a held one go when it does", () => {
    expect(button).toMatch(/if \(widget && botCheckGaveUp\(widget\.getAttribute\(BOT_CHECK_STATE_ATTRIBUTE\)\)\) return false;/);
    expect(button).toMatch(/attributeFilter: \["value", BOT_CHECK_STATE_ATTRIBUTE\]/);
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
    for (const key of [...BOT_CHECK_STATES, "slow", "retry"]) expect(place, key).toContain(`${key}: t("${key}")`);
  });
});
