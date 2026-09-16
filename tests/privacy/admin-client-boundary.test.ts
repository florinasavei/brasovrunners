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

describe("AGENTS.md §14.5 the backoffice renders participant rows on the server", () => {
  it("has no Client Component anywhere in the admin route tree", async () => {
    const offenders: string[] = [];

    for (const file of await filesUnder(ADMIN_ROUTES)) {
      const source = await readFile(file, "utf8");
      // The directive is only a directive on the first line of the module.
      const firstLine = source.split("\n").find((line) => line.trim() !== "") ?? "";
      if (/^["']use client["']/.test(firstLine.trim())) {
        offenders.push(relative(ROOT, file).split(sep).join("/"));
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
