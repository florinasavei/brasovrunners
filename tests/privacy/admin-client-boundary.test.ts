import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-060-01 and AGENTS.md §14.5 — no participant data crosses into a Client Component.
 *
 * The backoffice lists were rebuilt as tables, and the tempting way to build a table is a data
 * grid: a Client Component handed an array of rows. On the registrations list those rows are
 * participants — a registered name and a delivery address each — and handing them to the client
 * publishes them to anybody with the browser's developer tools open, whatever the component
 * chooses to render. `DECISIONS.md` §53 records the decision to render on the server instead.
 *
 * That decision is a convention until something checks it, and conventions do not survive the
 * next person in a hurry. This is the check: a property over the source tree rather than a test
 * of one behaviour, in the idiom of `cms/boundary.test.ts`.
 *
 * It is deliberately not a lint rule. The rule here is not "avoid `use client`" — the four
 * islands that exist are all justified in their own files — it is that the *backoffice route
 * tree*, which is where participant rows are read, stays server-rendered, and that no island
 * anywhere takes a participant field as a prop.
 */

const ROOT = process.cwd();
const ADMIN_ROUTES = join(ROOT, "src", "app", "[locale]", "admin");
const SRC = join(ROOT, "src");

async function filesUnder(directory: string, extensions = [".ts", ".tsx"]): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) return filesUnder(full, extensions);
      return extensions.some((extension) => entry.name.endsWith(extension)) ? [full] : [];
    }),
  );
  return found.flat();
}

/** The columns `RegistrationListRow` carries that describe a person rather than a registration. */
const PARTICIPANT_FIELDS = ["participantEmail", "registeredName", "deliveryEmail", "typedName"];

/*
  The one Client Component the tree may hold, because Next requires it to be one: the backoffice's
  error boundary (§436, §447), which handles a save a network refused and a database that is away, and
  throws every other error on to `[locale]/error.tsx`. It is handed an error and nothing else — no
  row, no participant — and the test below holds it to importing no data at all.
*/
const NEXT_REQUIRED_CLIENT_FILES = new Set(["src/app/[locale]/admin/error.tsx"]);

/** The module specifiers a source file imports from. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
}

describe("AGENTS.md §14.5 the backoffice renders participant rows on the server", () => {
  it("has no Client Component anywhere in the admin route tree", async () => {
    const offenders: string[] = [];

    for (const file of await filesUnder(ADMIN_ROUTES)) {
      const source = await readFile(file, "utf8");
      // The directive is only a directive on the first line of the module.
      const firstLine = source.split("\n").find((line) => line.trim() !== "") ?? "";
      const name = relative(ROOT, file).split(sep).join("/");
      if (/^["']use client["']/.test(firstLine.trim()) && !NEXT_REQUIRED_CLIENT_FILES.has(name)) {
        offenders.push(name);
      }
    }

    /*
      Every `/admin` page is a Server Component, so the set of columns rendered and the set of
      data sent are the same set: a column that is not rendered was never serialized. The
      interactive pieces these pages use — `SubmitButton`, `ConfirmSubmitButton`, `AdminTabs` —
      live outside this tree and take only already-translated strings.
    */
    expect(offenders).toEqual([]);
  });

  it("passes no participant field as a prop to any client island", async () => {
    const offenders: Array<{ file: string; field: string }> = [];

    for (const file of await filesUnder(SRC)) {
      const source = await readFile(file, "utf8");
      const firstLine = source.split("\n").find((line) => line.trim() !== "") ?? "";
      if (!/^["']use client["']/.test(firstLine.trim())) continue;

      for (const field of PARTICIPANT_FIELDS) {
        // A prop name, not a mention: `foo: string` in a Props type, or `foo={...}` at a call.
        if (new RegExp(`\\b${field}\\s*[:=?]`).test(source)) {
          offenders.push({ file: relative(ROOT, file).split(sep).join("/"), field });
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("lets the backoffice's error boundary be a Client Component only while it reads no data", async () => {
    for (const name of NEXT_REQUIRED_CLIENT_FILES) {
      const source = await readFile(join(ROOT, ...name.split("/")), "utf8");
      /*
        Nothing from `@/db`, and from `@/modules` only what cannot read a row (§436, §447, the merge of
        the save fallback with the budget governor, whose resting page the boundary also draws): a
        module's `domain/` — pure rules, AGENTS.md §5 — and a module's `ui/` Client
        Component that itself imports nothing from either tree.
      */
      const offenders: string[] = [];
      for (const specifier of importsOf(source)) {
        if (/^@\/db\//.test(specifier)) offenders.push(specifier);
        if (!/^@\/modules\//.test(specifier) || /^@\/modules\/[^/]+\/domain\//.test(specifier)) continue;
        if (!/^@\/modules\/[^/]+\/ui\//.test(specifier)) {
          offenders.push(specifier);
          continue;
        }
        const island = await readFile(join(SRC, `${specifier.slice(2)}.tsx`), "utf8");
        const islandFirstLine = island.split("\n").find((line) => line.trim() !== "") ?? "";
        if (!/^["']use client["']/.test(islandFirstLine.trim())) offenders.push(specifier);
        if (importsOf(island).some((inner) => /^@\/(db|modules)\//.test(inner))) offenders.push(specifier);
        for (const field of PARTICIPANT_FIELDS) expect(island, specifier).not.toContain(field);
      }
      expect(offenders, name).toEqual([]);
      for (const field of PARTICIPANT_FIELDS) expect(source, name).not.toContain(field);
    }
  });

  it("checks a source tree it actually found, so a wrong path cannot pass silently", async () => {
    // Without this the two assertions above are green when `ADMIN_ROUTES` is misspelled and the
    // listing is empty — the failure mode that makes property tests worthless.
    const adminFiles = await filesUnder(ADMIN_ROUTES);
    const islands: string[] = [];

    for (const file of await filesUnder(SRC)) {
      const source = await readFile(file, "utf8");
      const firstLine = source.split("\n").find((line) => line.trim() !== "") ?? "";
      if (/^["']use client["']/.test(firstLine.trim())) islands.push(file);
    }

    expect(adminFiles.length).toBeGreaterThan(20);
    expect(islands.length).toBeGreaterThan(0);
  });
});
