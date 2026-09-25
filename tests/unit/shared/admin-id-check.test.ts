import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every admin `/…/[id]/…` route reads `params.id` and hands it to a repository function that
 * runs `WHERE id = $1` against a `uuid` column. A malformed id — `/admin/events/nope`, a typed
 * address, a truncated one — used to reach PostgreSQL and come back as a 500 (found during the
 * dev-SSR investigation, §376); `isUuid` (`shared/ids.ts`) is the one shared check, and this
 * suite reads every `page.tsx` and `route.ts` under a `[id]` segment of `src/app/[locale]/admin`,
 * `src/app/[locale]/preview` and `src/app/api/admin`, and asserts each one imports it, calls it,
 * and calls it *before* it opens a database connection to look the id up — rather than trusting
 * each route to remember, in either order.
 *
 * `checkin/[code]` is not a `[id]` segment and takes a check-in code, not a database id — it is
 * normalised and validated on its own terms (`isCheckinCode`) and is out of scope here.
 *
 * Source-level, like `pickers-backoffice-only.test.ts`: the suite runs in Node with no DOM, and
 * the rule is about what is written, not about what one render happens to produce.
 */
const ROOT = path.resolve(__dirname, "../../..");
const ROUTE_ROOTS = [
  { root: path.join(ROOT, "src/app/[locale]/admin"), fileName: "page.tsx" },
  { root: path.join(ROOT, "src/app/[locale]/preview"), fileName: "page.tsx" },
  { root: path.join(ROOT, "src/app/api/admin"), fileName: "route.ts" },
];

function filesNamed(directory: string, fileName: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return filesNamed(full, fileName);
    return entry === fileName ? [full] : [];
  });
}

const ID_ROUTE_FILES = ROUTE_ROOTS.flatMap(({ root, fileName }) => filesNamed(root, fileName))
  .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
  // Only a route that actually carries a `[id]` segment — a plain admin page (the list pages, the
  // create pages) has nothing to check.
  .filter((file) => file.split("/").includes("[id]"));

describe("every admin [id] route checks its id's shape before reading it", () => {
  it("finds at least one such route — the walk itself would fail silently on none", () => {
    expect(ID_ROUTE_FILES.length).toBeGreaterThan(0);
  });

  it.each(ID_ROUTE_FILES)("%s imports isUuid from shared/ids", (file) => {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    expect(text).toMatch(/import\s*\{\s*isUuid\s*\}\s*from\s*"@\/shared\/ids"/);
  });

  it.each(ID_ROUTE_FILES)("%s calls isUuid(id) before its lookup", (file) => {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    expect(text).toMatch(/isUuid\(id\)/);

    // Order, not just presence: a call placed after the database lookup would still match the
    // assertion above. Every route here opens its one connection with `getDb()` right beside the
    // query the id feeds, so the first `getDb()` call is the id's first use — and it must come
    // after the shape check, not before it.
    const checkIndex = text.indexOf("isUuid(id)");
    const lookupIndex = text.indexOf("getDb()");
    expect(lookupIndex).toBeGreaterThan(-1);
    expect(checkIndex).toBeLessThan(lookupIndex);
  });
});
