import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Typography from "@mui/material/Typography";
import { ThemeProvider } from "@mui/material/styles";
import Wordmark from "@/shared/ui/Wordmark";
import { DENSITY } from "@/theme/density";
import { headingRule } from "@/theme/surfaces";
import { theme } from "@/theme/theme";

/**
 * §569 (amending §292) — the compact page head. The owner, 2026-09-29, on `/ro/calendar`:
 * «Textul ăsta de „Evenimente” e mult prea mare, pe mobil ia prea mult spațiu, la fel și la
 * „Calendar”».
 *
 * Rendered to HTML the way the server sends it, with the styles Emotion writes beside each
 * element, because the rule is a pair of media queries rather than anything the markup says:
 *   - below `sm` the kit-face wordmark is not drawn (`display: none`), and from `sm` it is drawn
 *     at 1rem, half its old 2rem cap;
 *   - the theme's H1 is 1.5rem (24px) below `sm` and 1.75rem (28px) from `sm`, where it was 2rem
 *     at every width — and it is still an `<h1>` with its words;
 *   - the room above the title and under its words (the gradient rule) is halved on a phone.
 *
 * `tests/e2e/compact-page-head.spec.ts` measures the built pages at 320 and 360 pixels.
 */

const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

async function render(element: ReturnType<typeof createElement>): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

/** The markup without the `<style>` elements Emotion writes beside each element on the server. */
const markupOnly = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
/** Only the CSS Emotion wrote. */
const cssOnly = (html: string) => [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");

const withTheme = (child: ReturnType<typeof createElement>) =>
  createElement(ThemeProvider, { theme } as unknown as ComponentProps<typeof ThemeProvider>, child);

describe("§569 the page head is compact on a phone", () => {
  it("does not draw the wordmark below sm, and draws it at 1rem from sm", async () => {
    const html = await render(withTheme(createElement(Wordmark)));
    const css = cssOnly(html);
    // Mobile-first: the base rule is the phone's, the `sm` query brings it back.
    expect(css).toMatch(/(^|[;{])display:none;/);
    expect(css).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*display:block;/);
    expect(css).toMatch(/font-size:1rem;/);
    // Still an image to assistive technology where it is drawn, and never a heading.
    const markup = markupOnly(html);
    expect(markup).toMatch(/^<p[^>]*role="img"/);
    expect(markup).not.toContain("<h1");
  });

  it("keeps the H1 an <h1> with its words, 24px below sm and 28px from sm", async () => {
    const html = await render(withTheme(createElement(Typography, { variant: "h1" }, "Calendar")));
    const markup = markupOnly(html);
    expect(markup).toMatch(/^<h1[^>]*>Calendar<\/h1>$/);
    const css = cssOnly(html);
    expect(css).toMatch(/(^|[;{])font-size:1\.5rem;/);
    expect(css).toMatch(/@media \(min-width:600px\)\{[^{]*\{[^}]*font-size:1\.75rem;/);
    expect(css).not.toMatch(/font-size:2rem;/);
  });

  it("halves the room above the title and above its rule on a phone, and keeps sm's", () => {
    // 4px above the H1 on a phone (was 8), 8px from sm as before.
    expect(DENSITY.headGap).toBe(0.5);
    for (const page of ["events", "calendar", "contact"]) {
      expect(read(`src/app/[locale]/${page}/page.tsx`), page).toContain("mt: { xs: DENSITY.headGap, sm: 1 }");
    }
    // The rule stays at every width (the title's identity); only its gap is halved below sm.
    expect(headingRule["&::after"].marginTop).toBe("0.5rem");
    expect(headingRule["@media (max-width:599.95px)"]["&::after"].marginTop).toBe("0.25rem");
  });

  it("changes no words: each page's H1 still reads its own key", () => {
    expect(read("src/app/[locale]/events/page.tsx")).toMatch(/variant="h1"[^>]*>\s*\{t\("title"\)\}/);
    expect(read("src/app/[locale]/calendar/page.tsx")).toMatch(/variant="h1"[^>]*>\s*\{t\("calendar\.pageTitle"\)\}/);
    expect(read("src/app/[locale]/contact/page.tsx")).toMatch(/variant="h1"[^>]*>\s*\{t\("title"\)\}/);
  });
});
