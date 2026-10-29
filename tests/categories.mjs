// The test categories (§867; the owner, 2026-10-28: «vreau să categorisești testele și să putem ignora unele dintre ele»).
//
// Every vitest file is in exactly one category, and each category is a Vitest project of the same name
// (`vitest.config.mts`), so `yarn test --project=drawn` runs one and `yarn test:skip drawn pages` all but those
// (`scripts/test-categories.mjs`). `yarn test` and CI run every category; «trust» is never left out.
//
// Where a file's category comes from: `tests/categories.json`, the classification read file by file on 2026-10-28
// (each file opened, the rules' guards found several ways and every disagreement settled by two readers); a file
// it does not list — a new test — takes the first category whose signals it shows (`signalsOf` below), «trust»
// first, so a new test of a rule that cannot be broken is never skippable by accident. Move a file by moving its
// line in the JSON; a listed file that no longer exists fails `tests/unit/scripts/test-categories.test.ts`.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * In the order a new file is matched. `skippable: false` — never left out by `test:fast`, `test:skip` or the
 * pre-commit hook. `fast: true` — run by `yarn test:fast` and by the hook on the staged files' tests.
 */
export const CATEGORIES = [
  {
    name: "trust",
    skippable: false,
    fast: true,
    description:
      "the rules that cannot be broken (CLAUDE.md): places and the one allocator, approved legal texts, publication in both languages, test registrations, the public list, staff powers and server-side authorization, staff-only sign-in, email action links, APP_BASE_URL, the email canonicalizer",
  },
  { name: "drawn", skippable: true, fast: false, description: "pictures, PDFs, spreadsheets and QR codes the code draws — the slowest files" },
  { name: "pages", skippable: true, fast: false, description: "a page, a component or an email rendered to HTML, read as markup" },
  { name: "database", skippable: true, fast: false, description: "a real PostgreSQL in memory (PGlite): the services and the rows they write" },
  { name: "guards", skippable: true, fast: true, description: "the repository's conventions read from disk, and the repository's own scripts" },
  { name: "logic", skippable: true, fast: true, description: "pure functions and modules with fakes — milliseconds" },
];

/** The requirements of CLAUDE.md's «Rules that cannot be broken»: a new test naming one is «trust». */
const TRUST_REQUIREMENTS = /BR-REQ-(034-0[12]|053-01|040-02|037-0[3-8]|039-01|036-02|101-02|032-\d\d|060-01)/;
/** A staff refusal asserted (server-side authorization): «trust» too. */
const REFUSAL = /["'`](FORBIDDEN|UNAUTHENTICATED)["'`]/;
const DRAWN = /from ["'](sharp|pdfkit|qrcode|write-excel-file)["']|calendar-image|share-image|stub-canvas|bib-picture|badges?-(pdf|image)|agreement-pdf|declaration-pdf|video-poster|modules\/media\/images|helpers\/(pdf-drawn|xlsx)/i;
const PAGES = /renderToReadableStream|renderToString|renderToStaticMarkup/;
const DATABASE = /createTestDatabase|migratedPglite|helpers\/db["']/;
const REPO_SCAN = /readdirSync|readFileSync\([^)]*(src|messages|docs|scripts|\.github|README|SETUP|AGENTS|CLAUDE|SPECS|DECISIONS)/;

/** The category a file not listed in the JSON takes from its own text. */
export function signalsOf(file, text) {
  if (TRUST_REQUIREMENTS.test(text) || REFUSAL.test(text)) return "trust";
  if (DRAWN.test(file) || DRAWN.test(text)) return "drawn";
  if (PAGES.test(text)) return "pages";
  if (DATABASE.test(text) || file.startsWith("tests/integration/")) return "database";
  if (/^tests\/unit\/(scripts|i18n)\//.test(file) || REPO_SCAN.test(text)) return "guards";
  return "logic";
}

/** Every file `yarn test` runs, repository-relative with forward slashes: `*.test.ts` under tests/, never the two-connection suite. */
export function testFiles(root) {
  const walk = (dir) =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return relative === "tests/concurrency" || entry.name === "node_modules" ? [] : walk(relative);
      return entry.name.endsWith(".test.ts") ? [relative] : [];
    });
  return walk("tests").sort();
}

/** The classification as listed: `tests/categories.json`, category → files. */
export function listed(root) {
  return JSON.parse(readFileSync(path.join(root, "tests/categories.json"), "utf8"));
}

/**
 * Category → files, every test file in exactly one: the listed category, else the signals'. A file name carrying
 * a glob's special character is refused, because each project's `include` is the list itself.
 */
export function categorize(root) {
  const list = listed(root);
  const categoryOf = new Map(Object.entries(list).flatMap(([name, files]) => files.map((file) => [file, name])));
  const byCategory = new Map(CATEGORIES.map((category) => [category.name, []]));
  for (const file of testFiles(root)) {
    if (/[[\]{}()*?!]/.test(file)) throw new Error(`a test file's name carries a glob character, which a project's include would misread: ${file}`);
    const name = categoryOf.get(file) ?? signalsOf(file, readFileSync(path.join(root, file), "utf8"));
    byCategory.get(name).push(file);
  }
  return byCategory;
}
