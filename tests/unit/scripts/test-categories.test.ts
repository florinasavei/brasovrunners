import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { directTestsOf, listing, vitestArgs } from "../../../scripts/test-categories.mjs";
import { CATEGORIES, categorize, listed, signalsOf, testFiles } from "../../categories.mjs";

/**
 * BR-REQ-090-02 — the test categories (§867; the owner, 2026-10-28: «vreau să categorisești testele și să putem ignora
 * unele dintre ele»). Every vitest file is in exactly one category and each category is a Vitest project, so a
 * category can be run alone or left out; «trust», the tests of the rules that cannot be broken, never is; and
 * `yarn test`, which CI runs, still runs every file.
 */
const ROOT = process.cwd();
const NAMES = CATEGORIES.map((category) => category.name);
const KEPT_BY_FAST = CATEGORIES.filter((category) => category.fast).map((category) => `--project=${category.name}`);

describe("BR-REQ-090-02 the test categories (§867)", () => {
  it("puts every vitest file in exactly one category", () => {
    const byCategory = categorize(ROOT);
    const all = [...byCategory.values()].flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(testFiles(ROOT));
    expect(all.length).toBeGreaterThan(1000);
  });

  it("lists only files that exist, each once, under a category that exists", () => {
    const list = listed(ROOT);
    expect(Object.keys(list)).toEqual(NAMES);
    const files = new Set(testFiles(ROOT));
    const named = Object.values(list).flat();
    // A deleted or renamed test leaves its line behind: move or remove the line in tests/categories.json.
    expect(named.filter((file) => !files.has(file))).toEqual([]);
    expect(new Set(named).size).toBe(named.length);
  });

  it("is one Vitest project per category, with no root include that would put every file in every project", async () => {
    // A variable path: TypeScript refuses a literal `.mts` import without `allowImportingTsExtensions`.
    const configPath = "../../../vitest.config.mts";
    const { default: config } = (await import(/* @vite-ignore */ configPath)) as { default: { test?: { include?: unknown; projects?: unknown[] } } };
    const test = config.test ?? {};
    // Measured 2026-10-28: under `extends: true` a project's include is added to the root's.
    expect(test.include).toBeUndefined();
    const byCategory = categorize(ROOT);
    const projects = (test.projects ?? []) as { extends?: boolean; test?: { name?: string; include?: string[] } }[];
    expect(projects.map((project) => project.test?.name)).toEqual(NAMES);
    for (const project of projects) {
      expect(project.extends).toBe(true);
      expect(project.test?.include).toEqual(byCategory.get(project.test?.name ?? ""));
    }
  });

  it("never leaves «trust» out: not test:fast, not test:skip, not the pre-commit hook", () => {
    const trust = CATEGORIES.find((category) => category.name === "trust");
    expect(trust).toMatchObject({ skippable: false, fast: true });
    expect(vitestArgs([])).toContain("--project=trust");
    expect(() => vitestArgs(["--skip", "trust"])).toThrow(/never left out/);
    expect(() => vitestArgs(["--skip", "drawn", "trust"])).toThrow(/never left out/);
    const hook = readFileSync(".githooks/pre-commit", "utf8");
    // The tests that import a staged file directly, in the fast categories (§871): «trust» among them.
    expect(hook).toMatch(/node scripts\/test-categories\.mjs direct \$staged/);
    expect(hook).not.toMatch(/--project=!|test:skip/);
  });

  it("leaves no category out of what CI runs", () => {
    const workflow = readFileSync(".github/workflows/docs-check.yml", "utf8");
    expect(workflow).toMatch(/run: yarn test --shard=/);
    expect(workflow).not.toMatch(/--project|test:fast|test:skip/);
  });

  it("turns the names and vitest's own arguments into one command line", () => {
    expect(vitestArgs([])).toEqual(["run", ...KEPT_BY_FAST]);
    expect(vitestArgs(["related", "--run", "--passWithNoTests", "src/a.ts"])).toEqual(["related", ...KEPT_BY_FAST, "--run", "--passWithNoTests", "src/a.ts"]);
    expect(vitestArgs(["--skip", "drawn", "pages"])).toEqual(["run", "--project=trust", "--project=database", "--project=guards", "--project=logic"]);
    expect(vitestArgs(["--skip", "database", "tests/unit"])).toEqual(["run", "--project=trust", "--project=drawn", "--project=pages", "--project=guards", "--project=logic", "tests/unit"]);
    // A vitest name filter after `--`, never read as a category.
    expect(vitestArgs(["--", "calendar"])).toEqual(["run", ...KEPT_BY_FAST, "calendar"]);
    expect(() => vitestArgs(["--skip"])).toThrow(/name the categories/);
    expect(() => vitestArgs(["--skip", "nope"])).toThrow(/no test category «nope»/);
  });

  it("picks the tests that import a staged file directly, not every test that reaches it (§871)", () => {
    const files = ["tests/unit/a.test.ts", "tests/unit/b.test.ts", "tests/unit/i18n/messages.test.ts", "tests/unit/scripts/c.test.ts", "tests/integration/d.test.ts"];
    const text: Record<string, string> = {
      "tests/unit/a.test.ts": 'import { words } from "@/modules/weather/words";',
      "tests/unit/b.test.ts": 'import { page } from "@/modules/weather/ui/Page"; // which imports words',
      "tests/unit/i18n/messages.test.ts": 'import ro from "../../../messages/ro.json";',
      "tests/unit/scripts/c.test.ts": 'import { x } from "../../../scripts/ship-checks.mjs";',
      "tests/integration/d.test.ts": 'import { createTestDatabase } from "../helpers/db";\nimport { y } from \'@/modules/x\';',
    };
    const read = (file: string) => text[file] ?? "";
    expect(directTestsOf(["src/modules/weather/words.ts"], files, read)).toEqual(["tests/unit/a.test.ts"]);
    expect(directTestsOf(["src/modules/x/index.ts", "tests/unit/b.test.ts"], files, read)).toEqual(["tests/integration/d.test.ts", "tests/unit/b.test.ts"]);
    expect(directTestsOf(["messages/ro.json"], files, read)).toEqual(["tests/unit/i18n/messages.test.ts"]);
    expect(directTestsOf(["scripts/ship-checks.mjs", "tests/helpers/db.ts"], files, read)).toEqual(["tests/integration/d.test.ts", "tests/unit/scripts/c.test.ts"]);
    expect(directTestsOf(["src/app/layout.tsx", "docs/README.md"], files, read)).toEqual([]);
  });

  it("gives a new, unlisted test its category from its own text, «trust» first", () => {
    expect(signalsOf("tests/unit/x/a.test.ts", "// BR-REQ-034-01 criterion 2: no overbooking")).toBe("trust");
    expect(signalsOf("tests/integration/x/a.test.ts", 'await expect(save(organizer)).rejects.toMatchObject({ code: "FORBIDDEN" });')).toBe("trust");
    expect(signalsOf("tests/unit/x/a.test.ts", 'import sharp from "sharp";')).toBe("drawn");
    expect(signalsOf("tests/unit/x/a.test.ts", "const html = await renderToReadableStream(page);")).toBe("pages");
    expect(signalsOf("tests/unit/x/a.test.ts", "({ db, close } = await createTestDatabase());")).toBe("database");
    expect(signalsOf("tests/integration/x/a.test.ts", "plain")).toBe("database");
    expect(signalsOf("tests/unit/scripts/a.test.ts", "plain")).toBe("guards");
    expect(signalsOf("tests/unit/x/a.test.ts", 'readdirSync("src/app")')).toBe("guards");
    expect(signalsOf("tests/unit/x/a.test.ts", "expect(add(1, 2)).toBe(3);")).toBe("logic");
  });

  it("lists each category with its files and what test:fast does with it", () => {
    const text = listing(categorize(ROOT));
    for (const name of NAMES) expect(text).toMatch(new RegExp(`^${name} +\\d+ files`, "m"));
    expect(text).toMatch(/^trust +\d+ files +never left out$/m);
  });
});
