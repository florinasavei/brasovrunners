import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importsModule } from "../../helpers/module-imports";

/**
 * «Eticheta pe BIB» (§975; BR-REQ-060-01, BR-REQ-039-01) — a registration's label is the person's data and a list line's is the
 * club's typed text: both reach the elite card, the desk's row, the two bib renderers, the one writer and «Toate datele unei
 * persoane» (which lists every column of a registration), and nothing else — never a public query, an email, the event's file or
 * copy, the registrations' Excel or CSV (which carry no elite mark to stand beside). The structural half of that promise, as
 * `raffle-never-leaves.test.ts` holds the raffle's ticks: no file outside the list below so much as names the two columns or the
 * writer's module. A new reader is a reviewed edit of this list. (What the label does and who may write it is
 * `tests/integration/registrations/elite-bib-label.test.ts`.)
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** The two columns, as code and as SQL. A message key's last part (`….bibLabel`, preceded by a dot) is not one. */
const NAMES_THE_LABEL = /eliteBibLabel|elite_bib_label|\bbib_label\b|(?<![.\w])bibLabel\b|registrations\/elite-label/;
const WRITER = path.join(SRC, "modules", "registrations", "elite-label");

const reads = (file: string, source: string): boolean => NAMES_THE_LABEL.test(source) || importsModule(file, source, WRITER, SRC);

const READERS = new Set(
  [
    // The two columns.
    "src/db/schema/registrations.ts",
    "src/db/schema/event-elite-entries.ts",
    // The label in force, decided once; the one writer and its trail's actions.
    "src/modules/registrations/bib-elite.ts",
    "src/modules/registrations/elite-label.ts",
    "src/modules/audit/repository.ts",
    // The two renderers' rows: the sheet and the picture.
    "src/modules/registrations/bibs.ts",
    "src/modules/registrations/bibs-pdf.ts",
    "src/app/api/admin/events/[id]/bibs/route.ts",
    "src/app/api/admin/events/[id]/bibs/preview/route.ts",
    // The elite card: the list's lines, the marked registrations, the editor's page and its action.
    "src/modules/registrations/elite-list.ts",
    "src/modules/registrations/elite-mark.ts",
    "src/modules/content/events/ui/boxes/BibPrint.tsx",
    "src/app/[locale]/admin/events/[id]/page.tsx",
    "src/app/[locale]/admin/actions.ts",
    // The desk: its query, its row and its action.
    "src/modules/registrations/admin-repository.ts",
    "src/modules/registrations/ui/DeskRow.tsx",
    "src/app/[locale]/admin/registrations/actions.ts",
    // «Cronometrare» (§NNN): the elites' buttons and lines say an elite by the label on the bib, as the desk's row does — read by the
    // finish line's own query (`loadEliteLabels`), never by the public read of the results (below).
    "src/modules/results/results.ts",
  ].map((file) => path.join(ROOT, file)),
);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** One exported function's source, from its `export` to the next top-level `export`. */
function functionSource(file: string, name: string): string {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  const start = text.search(new RegExp(`export (async )?function ${name}\\b`));
  expect(start, `${name} in ${file}`).toBeGreaterThan(-1);
  const rest = text.slice(start + 10);
  const next = rest.search(/\nexport /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("§975 «Eticheta pe BIB» stays with the bib", () => {
  const naming = sourceFiles(SRC).filter((file) => reads(file, readFileSync(file, "utf8")));

  it("is named only by the files reviewed to read it", () => {
    expect(naming.filter((file) => !READERS.has(file)).map((file) => path.relative(ROOT, file))).toEqual([]);
  });

  it("keeps the list honest: every reader still names it", () => {
    expect([...READERS].filter((file) => !naming.includes(file)).map((file) => path.relative(ROOT, file))).toEqual([]);
  });

  it("is read by no public query, no email, no export of the event and no event file or copy", () => {
    for (const file of [
      "src/modules/events/repository.ts",
      "src/modules/registrations/repository.ts",
      "src/modules/public-cache/reads.ts",
      "src/modules/notifications/render.ts",
      "src/modules/notifications/templates.ts",
      "src/modules/registrations/csv.ts",
      "src/modules/registrations/workbook.ts",
      "src/modules/registrations/sponsor-sheet.ts",
    ]) {
      expect(reads(path.join(ROOT, file), readFileSync(path.join(ROOT, file), "utf8")), file).toBe(false);
    }
    for (const file of sourceFiles(path.join(SRC, "modules", "content", "events", "transfer"))) {
      expect(reads(file, readFileSync(file, "utf8")), path.relative(ROOT, file)).toBe(false);
    }
    // «Elitele cursei» on the event page: the name and the number, never the label.
    expect(NAMES_THE_LABEL.test(functionSource("src/modules/registrations/elite-list.ts", "listPublicEliteEntries"))).toBe(false);
    // The published results (§NNN): the results module reads the label for «Cronometrare» alone — its own loader, which the public
    // read never calls; the loaders every read shares name no label.
    const results = readFileSync(path.join(ROOT, "src/modules/results/results.ts"), "utf8");
    expect(NAMES_THE_LABEL.test(functionSource("src/modules/results/results.ts", "readPublicEventResults"))).toBe(false);
    expect(functionSource("src/modules/results/results.ts", "readPublicEventResults")).not.toContain("loadEliteLabels");
    for (const loader of ["loadRegisteredRunners", "loadOutOfRanking"]) {
      const start = results.indexOf(`async function ${loader}`);
      expect(start, loader).toBeGreaterThan(-1);
      const body = results.slice(start, results.indexOf("\n}\n", start));
      expect(NAMES_THE_LABEL.test(body), loader).toBe(false);
    }
  });
});
