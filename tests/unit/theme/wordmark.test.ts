import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `DECISIONS.md`, 2026-09-22 — "the kit-face wordmark heads the calendar and the contact page
 * too", reversing the rule `BR-V1.32` set (the homepage and nowhere else) on the owner's word:
 * "trebuie sa vad acest scris frumos cu Brasov Runners si pe pagina de contact si pe cea de
 * calendar".
 *
 * Source-level, like `events/card-excerpt.test.ts`: the pages need a database to render, and
 * the rule is about which files carry one line. What it pins:
 *   - exactly three public pages render `<Wordmark />` — the listing, the calendar and the
 *     contact page. A fourth is a decision, not a copy-paste: the header stays the lockup alone
 *     (§58), and an event page or a legal text is the event's or the text's, not the club's;
 *   - the wordmark heads each page and is a paragraph that is an image to assistive technology,
 *     never a heading, so each page keeps exactly one `<h1>`;
 *   - it stays a Server Component: the locale layout loads Facón once for every page, so the two
 *     new pages pay no client island and no second request for it.
 */

const SRC = path.join(process.cwd(), "src");

/** The pages that head with the wordmark, as directories under `src/app/[locale]`. */
const WORDMARK_PAGES = ["events", "calendar", "contact"];

/** Every `.tsx` under `src/`, as `src`-relative POSIX paths, on Windows and Linux alike. */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => file.split(path.sep).join("/"));
}

function read(relative: string): string {
  return readFileSync(path.join(SRC, relative), "utf8");
}

describe("the kit-face wordmark heads the listing, the calendar and the contact page (2026-09-22)", () => {
  it("is rendered by exactly those three pages, and by nothing else under src/", () => {
    const rendering = sourceFiles().filter((file) => read(file).includes("<Wordmark"));
    const expected = WORDMARK_PAGES.map((dir) => `app/[locale]/${dir}/page.tsx`).sort();
    expect(rendering.sort()).toEqual(expected);
  });

  it.each(WORDMARK_PAGES)("%s: the wordmark comes before the page's one <h1>, and is not a second one", (dir) => {
    const source = read(`app/[locale]/${dir}/page.tsx`);
    const wordmark = source.indexOf("<Wordmark />");
    const h1 = source.indexOf('variant="h1"');
    expect(wordmark).toBeGreaterThan(-1);
    expect(h1).toBeGreaterThan(wordmark);
    // One heading of the first level per page; the wordmark must not become another.
    expect(source.match(/variant="h1"/g)).toHaveLength(1);
    expect(source).not.toMatch(/component="h1"/);
  });

  it("is a paragraph that is an image to assistive technology, rendered on the server", () => {
    const source = read("shared/ui/Wordmark.tsx");
    expect(source).not.toContain('"use client"');
    expect(source).toContain('component="p"');
    expect(source).toContain('role="img"');
    // The font is the layout's, loaded once for every page — the component brings none of its own.
    expect(source).not.toMatch(/next\/font|@font-face|\.ttf|\.woff/);
  });
});
