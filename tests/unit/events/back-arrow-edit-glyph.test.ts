import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-011-01 (§469) — the event page's «Înapoi la evenimente» link opens with a left arrow and
 * the staff «Editează» button carries Material's Edit pencil. The page is a Server Component that
 * reads the database, so — as `page-sections.test.ts` does — it is read as source: each glyph is a
 * child element inside its control, before the words, never a prop across the client boundary (§318).
 */
const ROOT = path.resolve(__dirname, "../../..");
const PAGE = readFileSync(path.join(ROOT, "src/app/[locale]/events/[slug]/page.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("BR-REQ-011-01 the event page's back arrow and edit pencil (§469)", () => {
  it("imports one file per glyph from @mui/icons-material", () => {
    expect(PAGE).toContain('import ArrowBackIcon from "@mui/icons-material/ArrowBack";');
    expect(PAGE).toContain('import EditIcon from "@mui/icons-material/Edit";');
  });

  it("puts the arrow inside the back link, before «backToEvents»", () => {
    const link = PAGE.match(/<Link href="\/events"[\s\S]*?<\/Link>/)?.[0] ?? "";
    expect(link).toMatch(/<ArrowBackIcon aria-hidden="true"[^>]*\/>\s*\{t\("backToEvents"\)\}/);
  });

  it("puts the pencil inside the staff edit button, before «editInBackoffice»", () => {
    const button = PAGE.match(/<Button component="a" href=\{editHref\}[\s\S]*?<\/Button>/)?.[0] ?? "";
    expect(button).toMatch(/<EditIcon aria-hidden="true"[^>]*\/>\s*\{t\("editInBackoffice"\)\}/);
    expect(button).not.toMatch(/(startIcon|endIcon)=/);
  });
});
