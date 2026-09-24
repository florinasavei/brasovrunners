import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-041-01 (§NNN) — the footer as the server sends it: one row on every width, the build
 * stamp inside the "Despre club" fold on a phone and pinned to the bar's own corner from `md`,
 * RO and EN side by side, and the privacy notice and the language on the always-visible bar.
 *
 * The owner, 2026-09-24: "it should fit all in 1 row" — a phone's footer used to float two
 * lines (§365); this is the row it collapsed into, every item kept and shrunk (32px targets,
 * ~12px text) rather than any of them dropped. The e2e suite measures the bar in a browser
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

const { NextIntlClientProvider } = await import("next-intl");
const messages = (await import("../../../messages/ro.json")).default;
const { default: SiteFooter } = await import("@/shared/ui/SiteFooter");

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

describe("BR-REQ-041-01 §NNN the footer's one row and the build stamp's two doors", () => {
  it("renders the build stamp twice: once in the fold's panel, once pinned to the bar's corner", async () => {
    const html = markupOnly(await renderFooter());
    const label = 'aria-label="Versiunea site-ului';
    const stamps = html.split(label).length - 1;
    // One instance for a phone (inside the fold, shown from `md` down to `xs`... actually
    // hidden from `md`), one for `md` up, pinned outside the fold — mutually exclusive by
    // `display`, both present in the markup so CSS alone decides which one shows.
    expect(stamps, "two build stamps in the footer's markup").toBe(2);

    const details = html.indexOf("<details");
    const summaryEnd = html.indexOf("</summary>");
    const detailsEnd = html.indexOf("</details>");
    expect(details).toBeGreaterThanOrEqual(0);
    const first = html.indexOf(label);
    const second = html.indexOf(label, first + 1);
    // The first copy is inside the `<details>`, after its `<summary>`: in the panel, which a
    // closed fold does not show — so a phone shows it at no width until "Despre club" opens.
    expect(first).toBeGreaterThan(summaryEnd);
    expect(first).toBeLessThan(detailsEnd);
    // The second copy is outside the fold altogether, pinned to the bar's own corner.
    expect(second).toBeGreaterThan(detailsEnd);
    // Still the build and still the staff entrance (§34): the version in the title, the way in
    // named for a screen reader.
    expect(html).toMatch(/title="(BR-V\d+\.\d+|dev)[^"]*"/);
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
    expect(bar).not.toMatch(/:has\(/);

    // Both on the bar, outside the fold: after `</details>`, not inside it.
    const detailsEnd = markup.indexOf("</details>");
    expect(markup.indexOf('aria-label="Nota de confidențialitate (GDPR)"')).toBeGreaterThan(detailsEnd);
    expect(markup.indexOf('aria-label="Limbă"')).toBeGreaterThan(detailsEnd);
  });

  it("reserves room for what the browser scrolls into view", () => {
    // BR-REQ-041-01 criterion 22: unchanged by the one-row footer, which is shorter than the
    // two-line bar these values were sized for, so both reserves stay generous.
    const theme = read("src/theme/theme.ts");
    expect(theme).toMatch(/scrollPaddingBottom: 96,/);
    expect(theme).toMatch(/"@media \(min-width:600px\)": \{ scrollPaddingTop: 76, scrollPaddingBottom: 52 \}/);
  });

  it("puts RO and EN side by side, 32-pixel targets on a phone, 44 from `sm` up", async () => {
    const html = await renderFooter();
    const markup = markupOnly(html);
    const css = cssOnly(html);
    const nav = rulesOf(css, emotionClassOf(markup, 'aria-label="Limbă"'));
    expect(nav).toMatch(/flex-direction:row;/);
    expect(nav).not.toMatch(/column/);
    for (const attribute of ['aria-current="true"', 'aria-label="English"']) {
      const rules = rulesOf(css, emotionClassOf(markup, attribute));
      // The footer-only exception (BR-REQ-041-01 criterion 6, §NNN): 32px on a phone, 44 from `sm`.
      expect(rules, `${attribute} is a 32-pixel target on a phone`).toMatch(/min-height:32px;/);
      expect(rules, `${attribute} is a 44-pixel target from sm`).toMatch(/min-height:44px;/);
      expect(rules).not.toMatch(/::before/);
    }
  });

  it("shrinks the scheme switch to a 32-pixel target on a phone, 44 from `sm` up", async () => {
    const html = await renderFooter();
    const markup = markupOnly(html);
    const css = cssOnly(html);
    const toggle = rulesOf(css, emotionClassOf(markup, 'aria-label="Temă întunecată"'));
    expect(toggle, "the switch is 32px on a phone").toMatch(/min-height:32px;/);
    expect(toggle, "the switch is 44px from sm").toMatch(/min-height:44px;/);
  });
});
