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
 * 44px from `sm` (`footer-target.ts`), where §365 had two lines. The owner, 2026-09-25 (§378):
 * the glyph a question mark rather than a lock, the notice right after the fold, "GDPR" as its
 * word from `sm`, and a phone's items 6px apart. The owner, later that day (§NNN): "GDPR" on the
 * phone too, a rule before the languages, a condensed panel and the version in a chip — with the
 * phone's gap 4px below 360 and 6px from 360. The e2e suite measures the bar in a browser
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
      // The club's mailbox, so the panel's "Scrie-ne: <address>" line renders (§NNN).
      EMAIL_REPLY_TO: "contact@example.org",
    },
  };
});

const { NextIntlClientProvider } = await import("next-intl");
const messages = (await import("../../../messages/ro.json")).default;
const { default: SiteFooter } = await import("@/shared/ui/SiteFooter");
const { FOOTER_GAP } = await import("@/shared/ui/footer-target");

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
    // §378, the owner, 2026-09-25: the privacy notice "should be after the about accordion" —
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

  it("marks the privacy notice with the word GDPR at every width, named for the notice, no glyph (§NNN)", async () => {
    // §NNN, the owner, 2026-09-25: "It would fit to say GDPR instead of just a question mark
    // here." The word on a phone too, where §378 had the circled question mark and §372 a lock.
    const html = await renderFooter();
    const markup = markupOnly(html);
    const css = cssOnly(html);
    const link = /<a[^>]*aria-label="Nota de confidențialitate \(GDPR\)"[^>]*>([\s\S]*?)<\/a>/.exec(markup);
    expect(link, "the privacy link").not.toBeNull();
    expect(link![0]).toMatch(/href="\/ro\/legal\/privacy"/);
    expect(link![0]).toMatch(/title="Nota de confidențialitate \(GDPR\)"/);
    // No glyph at any width: the question mark and its test id are gone.
    expect(link![1]).not.toMatch(/<svg/);
    expect(markup).not.toContain('data-testid="footer-privacy-mark"');

    // The word, with no `display` rule of its own: shown at every width.
    const word = /<span([^>]*)>GDPR<\/span>/.exec(link![1]);
    expect(word, "the word GDPR inside the link").not.toBeNull();
    expect(word![1]).toContain('data-testid="footer-privacy-word"');
    const wordClass = /class="(?:[^"]*\s)?(css-[A-Za-z0-9-]+)/.exec(word![1]);
    if (wordClass) expect(rulesOf(css, wordClass[1]!)).not.toMatch(/display:none/);

    // The link: the bar's target tall and at least as wide, and on a phone as wide as the word
    // plus 2px a side (the room is measured in `SiteFooter.tsx`), 8px a side from `sm` as before.
    const wrapperClass = /<div[^>]*class="(?:[^"]*\s)?(css-[A-Za-z0-9-]+)"[^>]*>\s*<a[^>]*aria-label="Nota de confidențialitate \(GDPR\)"/.exec(markup);
    expect(wrapperClass, "the privacy link's own box").not.toBeNull();
    const wrapper = rulesOf(css, wrapperClass![1]!);
    expect(wrapper).toMatch(/padding-left:2px;padding-right:2px;/);
    expect(wrapper).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*padding-left:8px;padding-right:8px;/);
    expectBarTarget(wrapper, ["min-height", "min-width"], "the privacy link");
  });

  it("names the privacy link with a name that contains its visible word, in both languages (WCAG 2.5.3)", () => {
    // BR-REQ-041-01 criterion 21: the render above is Romanian only, so the English catalogue is
    // checked here — "Privacy notice" alone did not contain "GDPR" (review finding, §378).
    for (const locale of ["ro", "en"] as const) {
      const legal = (JSON.parse(read(`messages/${locale}.json`)) as { Legal: Record<string, string> }).Legal;
      expect(legal.privacyLinkShort, locale).toBe("GDPR");
      expect(legal.privacyLinkName, locale).toContain(legal.privacyLinkShort);
    }
  });

  it("spaces a phone's bar items 4px apart below 360 and 6px from 360 — the row, the marks, the rule and the flags — and leaves `sm` as it was", async () => {
    // §378 measured 6px as the largest whole gap for the row it had; §NNN's word and rule take
    // 14.6px more at 320 and 10.6px more at 360, so below 360 the gap is 4px — the largest at
    // which "About the club" is still whole at 320 — and 6px from 360 (`footer-target.ts`,
    // measured in `SiteFooter.tsx`).
    expect(FOOTER_GAP).toEqual({ xs: 4, phoneWide: 6 });
    const html = await renderFooter();
    const markup = markupOnly(html);
    const css = cssOnly(html);
    const expectGap = (rules: string, property: string, what: string) => {
      expect(rules, `${what}: ${property} 4px below 360`).toMatch(new RegExp(`(^|[;{])${property}:4px;`));
      expect(rules, `${what}: ${property} 6px from 360`).toMatch(
        new RegExp(`@media \\(min-width:360px\\) and \\(max-width:599\\.95px\\)\\{[^{]*\\{[^}]*${property}:6px;`),
      );
      expect(rules, `${what}: no open-ended 360 rule`).not.toMatch(/@media \(min-width:360px\)\{/);
      // The 360 band comes after the 4px rule, so it wins inside the band (`footerGapSx`).
      const narrow = rules.search(new RegExp(`[;{]${property}:4px;`));
      const wide = rules.search(new RegExp(`@media \\(min-width:360px\\) and \\(max-width:599\\.95px\\)\\{[^{]*\\{[^}]*${property}:6px;`));
      expect(wide, `${what}: the 360 band after the 4px rule`).toBeGreaterThan(narrow);
    };
    const rowClass = /<footer[^>]*>\s*<div[^>]*class="(?:[^"]*\s)?(css-[A-Za-z0-9-]+)/.exec(markup);
    expect(rowClass, "the row, the footer's first child").not.toBeNull();
    const row = rulesOf(css, rowClass![1]!);
    expectGap(row, "column-gap", "the row");
    expect(row).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*column-gap:0(px)?;/);
    const marks = rulesOf(css, emotionClassOf(markup, 'aria-label="Clubul pe rețelele sociale"'));
    expectGap(marks, "column-gap", "the marks");
    expect(marks).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*column-gap:0(px)?;/);
    // …without replacing the marks' own `sm` margin (the first draft's `SM_UP` key did).
    expect(marks).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*margin-left:8px;/);
    const flags = rulesOf(css, emotionClassOf(markup, 'aria-label="Limbă"'));
    expectGap(flags, "gap", "the flags");
    // The box that holds the rule and the flags spaces them by the same gap.
    const languageBox = /<div[^>]*class="(?:[^"]*\s)?(css-[A-Za-z0-9-]+)"[^>]*>\s*<div[^>]*data-testid="footer-language-rule"/.exec(markup);
    expect(languageBox, "the rule's box").not.toBeNull();
    expectGap(rulesOf(css, languageBox![1]!), "column-gap", "the rule and the flags");
  });

  it("gives the summary 2px of padding a side on a phone so its words stay whole beside the word and the rule", async () => {
    // §NNN: four pixels the English summary needs at 320 and 360 (the table in `SiteFooter.tsx`).
    const html = await renderFooter();
    const summary = rulesOf(cssOnly(html), emotionClassOf(markupOnly(html), "<summary"));
    expect(summary).toMatch(/(^|[;{])padding-left:2px;padding-right:2px;/);
    expect(summary).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*padding-left:8px;padding-right:8px;/);
  });

  it("draws a 1px rule in the divider colour before the languages, hidden from assistive technology, on a phone only", async () => {
    // §NNN, the owner, 2026-09-25: "I need a separator before the language switchers."
    const html = await renderFooter();
    const markup = markupOnly(html);
    const css = cssOnly(html);
    const tag = /<div[^>]*data-testid="footer-language-rule"[^>]*>/.exec(markup);
    expect(tag, "the rule").not.toBeNull();
    expect(tag![0]).toContain('aria-hidden="true"');
    // After Strava, before the language navigation, in the phone-only box.
    const at = markup.indexOf('data-testid="footer-language-rule"');
    expect(at).toBeGreaterThan(markup.indexOf('aria-label="Strava"'));
    expect(at).toBeLessThan(markup.indexOf('aria-label="Limbă"'));
    const rule = rulesOf(css, emotionClassOf(markup, 'data-testid="footer-language-rule"'));
    expect(rule).toMatch(/(^|[;{])width:1px;/);
    expect(rule).toMatch(/(^|[;{])height:16px;/);
    expect(rule).toMatch(/@media \(min-width:360px\) and \(max-width:599\.95px\)\{[^{]*\{[^}]*height:18px;/);
    // The theme's `divider` colour (the default light palette's, in this render).
    expect(rule).toMatch(/background-color:rgba\(0, 0, 0, 0\.12\);/);
    // Its box is the phone's alone: from `sm` the languages are in the header.
    const box = rulesOf(css, /<div[^>]*class="(?:[^"]*\s)?(css-[A-Za-z0-9-]+)"[^>]*>\s*<div[^>]*data-testid="footer-language-rule"/.exec(markup)![1]!);
    expect(box).toMatch(/(^|[;{])display:flex;/);
    expect(box).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*display:none;/);
  });

  it("condenses the fold's panel: one wrapping row of 44px links, no margin between lines, 'Scrie-ne' once, the stamp last", async () => {
    // §NNN, the owner, 2026-09-25: "the info from the expanded footer must be more condensed."
    const html = await renderFooter();
    const markup = markupOnly(html);
    const css = cssOnly(html);
    const panelStart = markup.indexOf('data-testid="footer-about-panel"');
    const panel = markup.slice(panelStart, markup.indexOf("</details>"));

    // One container: every link and the stamp are its direct children, in this order.
    const order = ['href="/ro/legal/terms"', 'href="/ro/registrations/mine"', 'data-testid="footer-contact"', 'data-testid="footer-build-badge-panel"'];
    let last = -1;
    for (const needle of order) {
      const index = panel.indexOf(needle);
      expect(index, `${needle} is in the panel, in order`).toBeGreaterThan(last);
      last = index;
    }
    const containerClass = /data-testid="footer-about-panel"[^>]*>\s*<div[^>]*class="(?:[^"]*\s)?(css-[A-Za-z0-9-]+)/.exec(markup);
    expect(containerClass, "the panel's one container").not.toBeNull();
    const container = rulesOf(css, containerClass![1]!);
    expect(container).toMatch(/flex-wrap:wrap;/);
    expect(container, "no margin between two lines").toMatch(/row-gap:0(px)?;/);
    // The density scale's short step between two links on a phone (§380), 16px from `sm`.
    expect(container).toMatch(/(^|[;{])column-gap:8px;/);
    expect(container).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*column-gap:16px;/);
    // Every link in it a 44px target (BR-REQ-041-01 criterion 6).
    expect(container).toMatch(/ a\{[^}]*min-height:44px;/);
    // No stacked `spacing`, no paragraph of its own for the address.
    expect(panel).not.toMatch(/<p class="MuiTypography/);

    // "Scrie-ne" once: the form's link reads "Scrie-ne:" beside the mail link when the club's
    // address is configured, and "Scrie-ne" alone otherwise; never both.
    const contact = panel.slice(panel.indexOf('data-testid="footer-contact"'), panel.indexOf('data-testid="footer-build-badge-panel"'));
    const words = (contact.match(/Scrie-ne/g) ?? []).length;
    expect(words, "'Scrie-ne' once").toBe(1);
    expect(contact).toMatch(/<a href="\/ro\/contact"[^>]*>Scrie-ne:<\/a>/);
    expect(contact).toMatch(/<a[^>]*href="mailto:contact@example.org"[^>]*>contact@example.org<\/a>/);
    expect(markup.split("contact@example.org").length - 1, "the address once in the footer, as the mail link").toBe(2);
  });

  it("draws the build stamp as a small outlined chip in both places, the name and the title on its 44px box", async () => {
    // §NNN, the owner, 2026-09-25: "Version must be within a chip."
    const html = await renderFooter();
    const markup = markupOnly(html);
    const css = cssOnly(html);
    for (const testId of ["footer-build-badge-panel", "footer-build-badge-pinned"]) {
      const start = markup.indexOf(`data-testid="${testId}"`);
      const copy = markup.slice(start, markup.indexOf("</p>", start) + 4);
      // The staff entrance (dev-switcher in tests): a button with the build in its name and title.
      expect(copy, testId).toMatch(/role="button"/);
      expect(copy, testId).toMatch(/aria-label="Versiunea site-ului[^"]*—[^"]*"/);
      expect(copy, testId).toMatch(/title="(BR-V\d+\.\d+|dev)[^"]*"/);
      // The chip inside it: MUI's own small outlined chip, a span (it stands in a `<p>`), whose
      // label is the stamp's text.
      const chip = /<span[^>]*class="([^"]*MuiChip-root[^"]*)"[^>]*data-testid="build-badge-chip"[^>]*>|<span[^>]*data-testid="build-badge-chip"[^>]*class="([^"]*MuiChip-root[^"]*)"[^>]*>/.exec(copy);
      expect(chip, `${testId}: the chip`).not.toBeNull();
      const classes = chip![1] ?? chip![2]!;
      expect(classes).toMatch(/MuiChip-outlined/);
      expect(classes).toMatch(/MuiChip-sizeSmall/);
      expect(copy).toMatch(/<span class="MuiChip-label[^"]*">[^<]*app-ver[^<]*<\/span>/);
      const chipRules = rulesOf(css, /(css-[A-Za-z0-9-]+)/.exec(classes)![1]!);
      // Muted ink, and a label that wraps rather than being cut on a 320px panel.
      expect(chipRules).toMatch(/color:rgba\(0, 0, 0, 0\.6\);/);
      expect(chipRules).toMatch(/height:auto;/);
      expect(chipRules).toMatch(/\.MuiChip-label\{[^}]*white-space:normal;/);
      // The 44px box a long press is aimed at (BR-REQ-041-01 criterion 6).
      const box = rulesOf(css, emotionClassOf(copy, 'role="button"'));
      expect(box).toMatch(/min-height:44px;/);
    }
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
