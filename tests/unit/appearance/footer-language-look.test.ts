import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LOOK_PREVIEW, LOOK_ROOT } from "@/theme/look";

/**
 * BR-REQ-041-01 (§724, amending §722) — under «Aspectul nou» the language is the footer's own
 * switcher, both languages on the bar at every width: the owner, 2026-10-11, «și language switcher-ul
 * trebuie să fie în footer, să văd ambele limbi, ca înainte!» §722's floating round button, which
 * offered only the other language, is gone. Off, the bar is what it was: the flags on a phone only,
 * the header's copy from `sm`. The catalogues are the real ones; Next's navigation is stubbed, and
 * the footer's reads with it.
 */
const locale = vi.hoisted(() => ({ current: "ro" as "ro" | "en" }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: locale.current, messages: catalogues[locale.current], namespace: namespace as "Site" }),
    getLocale: async () => locale.current,
  };
});
let pathname = "/ro/evenimente";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: () => undefined }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactElement }) => createElement("a", { href: `/ro${href}`, ...rest }, children),
  getPathname: ({ href }: { href: string }) => `/ro${href}`,
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedShownContactAddresses: async () => [],
  cachedPublicPhone: async () => null,
}));

const { NextIntlClientProvider } = await import("next-intl");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;
const { default: SiteFooter } = await import("@/shared/ui/SiteFooter");

async function footer(language: "ro" | "en"): Promise<string> {
  locale.current = language;
  const element = (await SiteFooter()) as ReactElement;
  const stream = await renderToReadableStream(
    createElement(
      NextIntlClientProvider,
      { locale: language, messages: language === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>,
      element,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const markupOnly = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const cssOnly = (html: string) => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
/** Emotion's class on the element carrying `marker`. */
function classOf(markup: string, marker: string): string {
  const at = markup.indexOf(marker);
  const tag = markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at));
  return /class="(?:[^"]*\s)?(css-[A-Za-z0-9-]+)/.exec(tag)?.[1] ?? "";
}

describe("§724 both languages on the footer's bar under «Aspectul nou»", () => {
  it("draws the bar's language box on a phone, hides it from `sm` outside the scope, and shows it at every width inside", async () => {
    const html = await footer("ro");
    const markup = markupOnly(html);
    const css = cssOnly(html);
    const box = classOf(markup, 'data-testid="footer-language"');
    expect(box, "the language box is a styled box").not.toBe("");
    expect(css).toMatch(new RegExp(`\\.${box}\\{[^}]*display:flex;`));
    expect(css).toMatch(new RegExp(`@media \\(min-width:600px\\)\\{\\.${box}\\{[^}]*display:none;`));
    // The look's scope, outside the backoffice and in a preview box: flex at every width, so it beats the `sm` rule by specificity.
    const scoped = css.slice(css.indexOf(`${LOOK_ROOT} .${box},${LOOK_PREVIEW} .${box}{`));
    expect(css, "a rule under the look's scope").toContain(`${LOOK_ROOT} .${box},${LOOK_PREVIEW} .${box}{`);
    const rule = scoped.slice(0, scoped.indexOf("}"));
    expect(rule).toMatch(/display:flex;/);
    // At the bar's right end from `sm`, where the fold is only as wide as its words.
    expect(rule).toMatch(/margin-left:auto;$/);
    // The rule, then the «Limbă» navigation, inside it.
    const at = markup.indexOf('data-testid="footer-language"');
    const inside = markup.slice(at);
    expect(inside.indexOf('data-testid="footer-language-rule"')).toBeGreaterThan(-1);
    expect(inside.indexOf('aria-label="Limbă"')).toBeGreaterThan(inside.indexOf('data-testid="footer-language-rule"'));
  });

  it.each([
    ["ro", "/ro/evenimente/tura-pe-tampa", "Limbă", "Română", "en", "English", "%2Fro%2Fevenimente%2Ftura-pe-tampa"],
    ["en", "/en/events", "Language", "English", "ro", "Română", "%2Fen%2Fevents"],
  ] as const)("shows both languages on a %s page: the current one stated, the other a link through /api/locale", async (language, path_, nav, current, other, otherName, from) => {
    pathname = path_;
    const markup = markupOnly(await footer(language));
    const at = markup.indexOf(`aria-label="${nav}"`);
    expect(at).toBeGreaterThan(-1);
    const switcher = markup.slice(at, markup.indexOf("</nav>", at));
    // Both flags and both codes: RO and EN, side by side.
    expect(switcher).toContain("/flags/ro.svg");
    expect(switcher).toContain("/flags/gb.svg");
    expect(switcher).toMatch(/>RO</);
    expect(switcher).toMatch(/>EN</);
    expect(switcher).toMatch(new RegExp(`<span[^>]*(aria-current="true"[^>]*title="${current}"|title="${current}"[^>]*aria-current="true")`));
    expect(switcher).toContain(`href="/api/locale?to=${other}&amp;from=${from}"`);
    expect(switcher).toContain(`aria-label="${otherName}"`);
    // §722's floating button is gone: one «Limbă» navigation in the footer.
    expect(markup).not.toContain('data-testid="floating-language"');
    expect(markup.match(new RegExp(`aria-label="${nav}"`, "g"))).toHaveLength(1);
  });

  it("reads no setting: the layout renders the footer without the look's prop, and nothing draws a floating language button", () => {
    const ROOT = path.resolve(__dirname, "../../..");
    const layout = readFileSync(path.join(ROOT, "src/app/[locale]/layout.tsx"), "utf8");
    expect(layout).toContain("<SiteFooter />");
    const source = readFileSync(path.join(ROOT, "src/shared/ui/SiteFooter.tsx"), "utf8");
    expect(source).not.toContain("FloatingLocaleSwitch");
    expect(source).toContain("export default async function SiteFooter() {");
  });
});
