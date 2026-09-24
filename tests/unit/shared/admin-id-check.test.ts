import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every admin `/…/[id]/…` route reads `params.id` and hands it to a repository function that
 * runs `WHERE id = $1` against a `uuid` column. A malformed id — `/admin/events/nope`, a typed
 * address, a truncated one — used to reach PostgreSQL and come back as a 500 (found during the
 * dev-SSR investigation, §NNN); `isUuid` (`shared/ids.ts`) is the one shared check, and this
 * suite reads every `page.tsx` under a `[id]` segment of `src/app/[locale]/admin/` and asserts
 * it imports and calls it, rather than trusting each route to remember.
 *
 * `checkin/[code]` is not a `[id]` segment and takes a check-in code, not a database id — it is
 * normalised and validated on its own terms (`isCheckinCode`) and is out of scope here.
 *
 * Source-level, like `pickers-backoffice-only.test.ts`: the suite runs in Node with no DOM, and
 * the rule is about what is written, not about what one render happens to produce.
 */
const ROOT = path.resolve(__dirname, "../../..");
const ADMIN_ROOT = path.join(ROOT, "src/app/[locale]/admin");

function pageFilesUnderIdSegment(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return pageFilesUnderIdSegment(full);
    return entry === "page.tsx" ? [full] : [];
  });
}

const ID_ROUTE_PAGES = pageFilesUnderIdSegment(ADMIN_ROOT)
  .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
  // Only a route that actually carries a `[id]` segment — a plain admin page (the list pages, the
  // create pages) has nothing to check.
  .filter((file) => file.split("/").includes("[id]"));

describe("every admin [id] route checks its id's shape before reading it", () => {
  it("finds at least one such route — the walk itself would fail silently on none", () => {
    expect(ID_ROUTE_PAGES.length).toBeGreaterThan(0);
  });

  it.each(ID_ROUTE_PAGES)("%s imports isUuid from shared/ids", (file) => {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    expect(text).toMatch(/import\s*\{\s*isUuid\s*\}\s*from\s*"@\/shared\/ids"/);
  });

  it.each(ID_ROUTE_PAGES)("%s calls isUuid(id) before its lookup", (file) => {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    expect(text).toMatch(/isUuid\(id\)/);
  });
});
