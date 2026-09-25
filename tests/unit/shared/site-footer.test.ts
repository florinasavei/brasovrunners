import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-041-01 (§372) — the footer as the server sends it: one row on every width, the build
 * stamp inside the "Despre club" fold below `md` and pinned to the bar's own corner from `md`,
 * RO and EN side by side, and the privacy notice and the language on the always-visible bar.
 *
 * The owner, 2026-09-24: one row on a phone, every item kept but not every word — the privacy
 * notice a glyph, the languages flags, every item a square of 24px below 360, 28px from 360 and
 * 44px from `sm` (`footer-target.ts`), where §365 had two lines. The owner, 2026-09-25 (§NNN):
 * the glyph a question mark rather than a lock, the notice right after the fold, "GDPR" as its
 * word from `sm`, and a phone's items 6px apart. The e2e suite measures the bar in a browser
 * (`footer.spec.ts`, `build-badge.spec.ts`); pull requests run it on the desktop project only
 * (§209), and the phone is where the complaint was. This runs in `yarn check`, on every commit,
 * and pins the facts the phone depends on to the markup and the styles the server renders.
 *
 * The catalogue is the real Romanian one, through next-intl's own translator. Next's navigation
 * is stubbed: the footer's links need a path, not a router.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Site" }),
    getLocale: async () => "ro",
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/ro/evenimente",
  useRouter: () => ({ push: () => undefined }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href: `/ro${href}`, ...rest }, children),
  getPathname: ({ href }: { href: string }) => `/ro${href}`,
}));

// The three social marks render only when their URLs are configured (§372): stub them so the
// guarded assertions below actually run in `yarn check`, not skip past a footer with no marks.
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      CLUB_FACEBOOK_URL: "https://facebook.com/brasovrunners",
      CLUB_INSTAGRAM_URL: "https://instagram.com/brasovrunners",
      CLUB_STRAVA_URL: "https://strava.com/clubs/brasovrunners",
    },
  };
});

const { NextIntlClientProvider } = await import("next-intl");
const messages = (await import("../../../messages/ro.json")).default;
const { default: SiteFooter } = await import("@/shared/ui/SiteFooter");
const { FOOTER_GAP_PHONE } = await import("@/shared/ui/footer-target");

const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

/**
 * The footer rendered to HTML. A stream awaited to its end rather than `renderToStaticMarkup`:
 * the build stamp is an async Server Component of its own, and the synchronous renderer cannot
 * wait for one.
 */
async function renderFooter(): Promise<string> {
  const footer = (await SiteFooter()) as ReactElement;
  const stream = await renderToReadableStream(
    createElement(
      NextIntlClientProvider,
      // The children go in as `createElement`'s third argument, which the props type cannot see
      // (the same cast as `pickers-js-off.test.ts`).
      { locale: "ro", messages } as unknown as ComponentProps<typeof NextIntlClientProvider>,
      footer,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

/** The markup without the `<style>` elements Emotion writes beside each element on the server. */
const markupOnly = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
/** Only the CSS, every rule Emotion wrote for the footer and what is in it. */
const cssOnly = (html: string) => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");

/** Emotion's class on the first element whose opening tag carries `attribute`. */
function emotionClassOf(markup: string, attribute: string): string {
  const tag = markup.slice(markup.lastIndexOf("<", markup.indexOf(attribute)), markup.indexOf(">", markup.indexOf(attribute)));
  // The whole token: a styled MUI component's is `css-<hash>-Mui<Name>-root`.
  const found = /class="(?:[^"]*\s)?(css-[A-Za-z0-9-]+)/.exec(tag);
  expect(found, `an Emotion class on the element with ${attribute}`).not.toBeNull();
  return found![1]!;
}

/** Every rule whose selector names `className`, media queries included, as one string. */
function rulesOf(css: string, className: string): string {
  const escaped = className.replace(/[-]/g, "\\-");
  return [...css.matchAll(new RegExp(`(@media[^{]*\\{)?[^{}]*\\.${escaped}(?![\\w-])[^{]*\\{[^}]*\\}\\}?`, "g"))].map((match) => match[0]).join("\n");
}

/** An element's class rules carry the bar's three sizes (`footer-target.ts`, §372). */
function expectBarTarget(rules: string, properties: readonly string[], what: string) {
  for (const property of properties) {
    // 24px, 28px from 360 up to `sm`, 44px from `sm`.
    expect(rules, `${what}: ${property} 24px on a narrow phone`).toMatch(new RegExp(`(^|[;{])${property}:24px;`));
    expect(rules, `${what}: ${property} 28px from 360px`).toMatch(
      new RegExp(`@media \\(min-width:360px\\) and \\(max-width:599\\.95px\\)\\{[^{]*\\{[^}]*${property}:28px;`),
    );
    expect(rules, `${what}: ${property} 44px from sm`).toMatch(new RegExp(`@media \\(min-width:600px\\)\\{[^{]*\\{[^}]*${property}:44px;`));
  }
  // MUI emits its own breakpoints' queries first, so an open-ended 360 rule would come after
  // `sm`'s and win on a desktop: the 360 band is closed below `sm`, and never open-ended.
  expect(rules, `${what}: no open-ended 360 rule`).not.toMatch(/@media \(min-width:360px\)\{/);
}

describe("BR-REQ-041-01 §372 the footer's one row and the build stamp's two doors", () => {
  it("renders the build stamp twice: once in the fold's panel, once pinned to the bar's corner", async () => {
    const html = markupOnly(await renderFooter());
    const label = 'aria-label="Versiunea site-ului';
    const stamps = html.split(label).length - 1;
    // One instance below `md`, one from `md` pinned to the bar's own corner — mutually
    // exclusive by `display`, both present in the markup so CSS alone decides which one shows.
    expect(stamps, "two build stamps in the footer's markup").toBe(2);

    // The panel is the fold's own content again (review finding 4): inside `<details>`, after
    // its `<summary>`. The pinned copy is outside it.
    const detailsStart = html.indexOf("<details");
    const summaryEnd = html.indexOf("</summary>");
    const detailsEnd = html.indexOf("</details>");
    const panelStart = html.indexOf('data-testid="footer-about-panel"');
    const pinnedStart = html.indexOf('data-testid="footer-build-badge-pinned"');
    expect(detailsStart).toBeGreaterThanOrEqual(0);
    expect(panelStart).toBeGreaterThan(summaryEnd);
    expect(panelStart).toBeLessThan(detailsEnd);
    expect(pinnedStart).toBeGreaterThan(detailsEnd);

    const first = html.indexOf(label);
    const second = html.indexOf(label, first + 1);
    // The first copy is inside the panel, inside the fold; the second is the pinned corner's.
    expect(first).toBeGreaterThan(panelStart);
    expect(first).toBeLessThan(detailsEnd);
    expect(second).toBeGreaterThan(pinnedStart);
    // Still the build and still the staff entrance (§34): the version in the title, the way in
    // named for a screen reader.
    expect(html).toMatch(/title="(BR-V\d+\.\d+|dev)[^"]*"/);
  });

  it("lays the open panel under the row without widening the fold: a zero-wide box, no `:has()`", async () => {
    // Review finding 4: the panel was a sibling of the row, shown by a `:has()` rule on the
    // footer, so the `<details>` no longer owned what it disclosed. It is inside again; its box
    // is zero wide, so it adds nothing to the fold's width on the row, and its content runs to
    // the bar's right edge under the marks.
    const html = await renderFooter();
    const markup = markupOnly(html);
    const css = cssOnly(html);

    const panel = rulesOf(css, emotionClassOf(markup, 'data-testid="footer-about-panel"'));
    expect(panel, "the panel's own box is zero wide").toMatch(/width:0;/);
    expect(panel).toMatch(/overflow:visible;/);
    expect(css, "no rule reads the fold's state from outside it").not.toMatch(/:has\(/);

    // One row that never wraps, aligned to the top so an open fold grows downward only.
    const row = rulesOf(css, emotionClassOf(markup, 'data-testid="footer-about-fold"'));
    expect(row).not.toMatch(/\[open\]/);
    // One DOM order at every width (review finding 7): no `order` anywhere in the footer.
    expect(css).not.toMatch(/(^|[;{])order:/);
  });

  it("is not rendered by the page's layout, beside the footer", () => {
    // Before §365 the layout rendered `<BuildBadge />` after `<SiteFooter />`: a fixed pill in
    // the corner from `md`, a third line under the bar on a phone.
    const layout = read("src/app/[locale]/layout.tsx");
    expect(layout).not.toMatch(/import BuildBadge/);
    expect(layout).not.toMatch(/<BuildBadge/);
  });

  it("keeps the whole bar on screen at every width, the privacy notice and the language with it", async () => {
    // BR-REQ-041-01 criterion 21 and §323: the privacy notice is on the always-visible bar, at
    // every width, one row. The bar sits on the screen's edge at every scroll position.
    const html = await renderFooter();
    const markup = markupOnly(html);
    const bar = rulesOf(cssOnly(html), emotionClassOf(markup, "<footer"));
    expect(bar).toMatch(/position:sticky;/);
    expect(bar).toMatch(/bottom:0;/);
    expect(bar).not.toMatch(/bottom:-/);

    // Both on the bar, outside the fold: after `</details>`, not inside it.
    const detailsEnd = markup.indexOf("</details>");
    const privacy = markup.indexOf('aria-label="Nota de confidențialitate (GDPR)"');
    const language = markup.indexOf('aria-label="Limbă"');
    expect(privacy).toBeGreaterThan(detailsEnd);
    expect(language).toBeGreaterThan(privacy);
  });

  it("puts the bar's items in one DOM order: switch, summary, privacy notice, the three marks, the languages", async () => {
    // §NNN, the owner, 2026-09-25: the privacy notice "should be after the about accordion" —
    // ahead of the marks now, where §372 had it after them. One order at every width, desktop
    // included, and no `order` in the CSS (asserted above) to rearrange it on screen.
    const markup = markupOnly(await renderFooter());
    const at = (needle: string) => {
      const index = markup.indexOf(needle);
      expect(index, `${needle} is in the footer`).toBeGreaterThanOrEqual(0);
      return index;
    };
    const sequence: Array<[string, number]> = [
      ["the switch", at('aria-label="Temă întunecată"')],
      ["the summary", at("<summary")],
      ["the privacy notice", at('aria-label="Nota de confidențialitate (GDPR)"')],
      ["Facebook", at('aria-label="Facebook"')],
      ["Instagram", at('aria-label="Instagram"')],
      ["Strava", at('aria-label="Strava"')],
      ["the languages", at('aria-label="Limbă"')],
    ];
    for (let i = 1; i < sequence.length; i++) {
      const [before, a] = sequence[i - 1]!;
      const [after, b] = sequence[i]!;
      expect(b, `${after} comes after ${before}`).toBeGreaterThan(a);
    }
    // Directly after the fold: no other named item of the row stands between them.
    const between = markup.slice(markup.indexOf("</details>"), markup.indexOf('aria-label="Nota de confidențialitate (GDPR)"'));
    expect(between).not.toMatch(/aria-label="/);
  });

  it("marks the privacy notice with a question mark on a phone and the word GDPR from sm, named for the notice", async () => {
    const html = await renderFooter();
    const markup = markupOnly(html);
    const css = cssOnly(html);
    const link = /<a[^>]*aria-label="Nota de confidențialitate \(GDPR\)"[^>]*>([\s\S]*?)<\/a>/.exec(markup);
    expect(link, "the privacy link").not.toBeNull();
    expect(link![0]).toMatch(/href="\/ro\/legal\/privacy"/);
    expect(link![0]).toMatch(/title="Nota de confidențialitate \(GDPR\)"/);
    // The question mark (`HelpOutlineOutlined`, the circled `help_outline`), decorative, shown
    // below `sm`: the glyph's own path, so a different icon under the same test id fails here.
    expect(link![1]).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="footer-privacy-mark"|<svg[^>]*data-testid="footer-privacy-mark"[^>]*aria-hidden="true"/);
    expect(link![1], "the help_outline glyph's own path").toContain('d="M11 18h2v-2h-2zm1-16C6.48');
    const mark = rulesOf(css, emotionClassOf(markup, 'data-testid="footer-privacy-mark"'));
    expect(mark).toMatch(/display:block;/);
    expect(mark).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*display:none;/);

    // From `sm` the word is "GDPR" (the owner: "Use GDPR for desktop as well"), hidden below it.
    const word = /<span([^>]*)>GDPR<\/span>/.exec(link![1]);
    expect(word, "the word GDPR inside the link").not.toBeNull();
    const wordRules = rulesOf(css, /class="(?:[^"]*\s)?(css-[A-Za-z0-9-]+)/.exec(word![1])![1]!);
    expect(wordRules).toMatch(/(^|[;{])display:none;/);
    expect(wordRules).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*display:inline;/);
  });

  it("spaces a phone's bar items 6px apart — the row, the marks and the flags — and leaves `sm` as it was", async () => {
    // §NNN: the largest whole gap at which the bar is still one row with every item at 320px in
    // both languages (`footer-target.ts`, measured in `SiteFooter.tsx`).
    expect(FOOTER_GAP_PHONE).toBe(6);
    const html = await renderFooter();
    const markup = markupOnly(html);
    const css = cssOnly(html);
    const rowClass = /<footer[^>]*>\s*<div[^>]*class="(?:[^"]*\s)?(css-[A-Za-z0-9-]+)/.exec(markup);
    expect(rowClass, "the row, the footer's first child").not.toBeNull();
    const row = rulesOf(css, rowClass![1]!);
    expect(row).toMatch(/(^|[;{])column-gap:6px;/);
    expect(row).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*column-gap:0(px)?;/);
    const marks = rulesOf(css, emotionClassOf(markup, 'aria-label="Clubul pe rețelele sociale"'));
    expect(marks).toMatch(/(^|[;{])column-gap:6px;/);
    expect(marks).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*column-gap:0(px)?;/);
    const flags = rulesOf(css, emotionClassOf(markup, 'aria-label="Limbă"'));
    expect(flags).toMatch(/(^|[;{])gap:6px;/);
  });

  it("reserves room for what the browser scrolls into view", () => {
    // BR-REQ-041-01 criterion 22: the one-row bar is at most 28px + its border on a phone, so the
    // reserve is 40px there (was 96 for two 44px lines); 52px from 600px, unchanged.
    const theme = read("src/theme/theme.ts");
    expect(theme).toMatch(/scrollPaddingBottom: 40,/);
    expect(theme).toMatch(/"@media \(min-width:600px\)": \{ scrollPaddingTop: 76, scrollPaddingBottom: 52 \}/);
  });

  it("puts RO and EN side by side as flags on a phone, each a square of the bar's target", async () => {
    const html = await renderFooter();
    const markup = markupOnly(html);
    const css = cssOnly(html);
    const nav = rulesOf(css, emotionClassOf(markup, 'aria-label="Limbă"'));
    expect(nav).toMatch(/flex-direction:row;/);
    expect(nav).not.toMatch(/column/);
    for (const attribute of ['aria-current="true"', 'aria-label="English"']) {
      const rules = rulesOf(css, emotionClassOf(markup, attribute));
      expectBarTarget(rules, ["min-height", "min-width"], attribute);
      expect(rules).not.toMatch(/::before/);
    }
    // The name and the tooltip are the language's own words, whatever shows.
    expect(markup).toMatch(/aria-label="English"[^>]*title="English"|title="English"[^>]*aria-label="English"/);
    expect(markup).toMatch(/aria-current="true"[^>]*title="Română"|title="Română"[^>]*aria-current="true"/);
  });

  it("sizes the scheme switch, the summary and the marks to the bar's target", async () => {
    const html = await renderFooter();
    const markup = markupOnly(html);
    const css = cssOnly(html);
    expectBarTarget(rulesOf(css, emotionClassOf(markup, 'aria-label="Temă întunecată"')), ["min-height", "min-width"], "the switch");
    expectBarTarget(rulesOf(css, emotionClassOf(markup, "<summary")), ["min-height", "line-height"], "the summary");
    // The three marks render because the social URLs are stubbed above; carry the bar's target.
    expectBarTarget(rulesOf(css, emotionClassOf(markup, 'target="_blank"')), ["width", "height"], "a mark");
  });
});
