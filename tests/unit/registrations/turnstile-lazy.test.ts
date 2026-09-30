import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  BOT_CHECK_ARMED_ATTRIBUTE,
  BOT_CHECK_ARMING_EVENTS,
  BOT_CHECK_ERROR_ATTRIBUTE,
  BOT_CHECK_SLOT_SX,
  TURNSTILE_SCRIPT_URL,
} from "@/modules/registrations/domain/turnstile-widget";
import TurnstileWidget, { type BotCheckWords } from "@/modules/registrations/ui/TurnstileWidget";

/**
 * BR-REQ-031-01, §577 amending §97 — Cloudflare Turnstile loads only on a page with a protected
 * form, and only once a person starts on that form: a focus, a press, a key, a typed character.
 * Never on page load, never on another page; the server's siteverify only on submit.
 *
 * The owner, 2026-09-29: «dacă site-ul stă în idle nu vreau să consum nimic! nici Turnstile, nici
 * nimic!». The widget's script is injected by the one island that draws it (`TurnstileWidget`), so
 * these hold the line where it can slip: in that island's arming, and in every other file that might
 * load Cloudflare's script by itself — as the event page's interest box did, in implicit mode, on
 * every view of a static page.
 */
const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry)) files.push(relative(ROOT, path).replace(/\\/g, "/"));
  }
  return files;
}

const words = Object.fromEntries(
  ["loading", "checking", "interactive", "passed", "expired", "timeout", "error", "unsupported", "blocked", "slow", "retry", "failed"].map((key) => [key, `«${key}»`]),
) as BotCheckWords;

describe("§577 the widget waits for a person to start on the form", () => {
  it("arms on a focus, a press, a key or a typed character — never on load, scroll or visibility", () => {
    expect([...BOT_CHECK_ARMING_EVENTS].sort()).toEqual(["focusin", "input", "keydown", "pointerdown"]);
    for (const passive of ["load", "DOMContentLoaded", "scroll", "visibilitychange", "mouseover"]) {
      expect(BOT_CHECK_ARMING_EVENTS as readonly string[]).not.toContain(passive);
    }
  });

  it("injects its script only from the armed effect", () => {
    const source = read("src/modules/registrations/ui/TurnstileWidget.tsx");
    const guard = source.indexOf("if (!armed) return;");
    const inject = source.indexOf('document.createElement("script")');
    expect(guard).toBeGreaterThan(0);
    expect(inject).toBeGreaterThan(guard);
    // The one effect that injects is the one that waits: nothing between the guard and the injection starts another.
    expect(source.slice(guard, inject)).not.toMatch(/useEffect\(/);
  });

  it("renders a holder and no script, no Cloudflare address and no status line", () => {
    const html = renderToStaticMarkup(createElement(TurnstileWidget, { siteKey: "1x00000000000000000000AA", locale: "ro", attempt: "a", words }));
    expect(html).toContain('data-bot-check="loading"');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("challenges.cloudflare.com");
    expect(html).not.toContain("«loading»");
  });

  it("draws no Cloudflare sentence and reserves no height until armed (§NNN)", () => {
    const html = renderToStaticMarkup(
      createElement(TurnstileWidget, { siteKey: "1x00000000000000000000AA", locale: "ro", attempt: "a", words: { ...words, notice: "«notice»" } }),
    );
    expect(html).not.toContain("«notice»");
    expect(html).not.toContain("min-height");
    expect(html).not.toContain(BOT_CHECK_ARMED_ATTRIBUTE);
  });

  it("hides the forms' slot for the check until the widget is armed or a refusal is said (§NNN)", () => {
    const [selector, rule] = Object.entries(BOT_CHECK_SLOT_SX)[0];
    expect(rule).toEqual({ display: "none" });
    expect(selector).toContain(`:not(:has([${BOT_CHECK_ARMED_ATTRIBUTE}]))`);
    expect(selector).toContain(`:not(:has([${BOT_CHECK_ERROR_ATTRIBUTE}]))`);
    for (const path of [
      "src/app/[locale]/contact/page.tsx",
      "src/app/[locale]/events/[slug]/register/page.tsx",
      "src/modules/registrations/ui/RegistrationInterestForm.tsx",
    ]) {
      const source = read(path);
      expect(source, path).toMatch(/sx=\{BOT_CHECK_SLOT_SX\}>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<BotCheck [^>]*\bnotice\b/);
      expect(source, path).not.toContain('legal("botCheckNotice")');
    }
  });
});

describe("§577 no other public file loads Cloudflare's script", () => {
  it("names the script's address only in the widget, its domain constants, and the backoffice's network probe", () => {
    const users = sourceFiles(join(ROOT, "src")).filter((path) => {
      const text = read(path);
      return text.includes("TURNSTILE_SCRIPT_URL") || text.includes("challenges.cloudflare.com/turnstile/v0/api.js");
    });
    expect(users.sort()).toEqual([
      "src/app/[locale]/admin/network/page.tsx",
      "src/modules/registrations/domain/turnstile-widget.ts",
      "src/modules/registrations/ui/TurnstileWidget.tsx",
    ]);
    expect(TURNSTILE_SCRIPT_URL).toMatch(/^https:\/\/challenges\.cloudflare\.com\//);
  });

  it("has no implicit widget (`cf-turnstile`) anywhere: every form draws the one explicit island", () => {
    const implicit = sourceFiles(join(ROOT, "src")).filter((path) => /className=["']cf-turnstile["']/.test(read(path)));
    expect(implicit).toEqual([]);
  });

  it("gives the event page's interest box the same lazy check as every other form", () => {
    const source = read("src/modules/registrations/ui/RegistrationInterestForm.tsx");
    expect(source).toMatch(/<BotCheck\b/);
    expect(source).not.toMatch(/next\/script/);
  });
});
