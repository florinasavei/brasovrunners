import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «Ambasador» (§NNN; BR-REQ-060-01, BR-REQ-039-01, BR-REQ-034-01) — the club's own label on a registration, staff only. It
 * is drawn by the backoffice — the registrations list, the registration's page, the «Ambasadori» panel, «Clasament» and
 * «Premii» — and read, for the two ticks it brings, by the public list's one condition and by the ranking. Nothing else
 * names it: never a public page or its data, never an email, never the race-day desk, never a bib, the registrations'
 * Excel or CSV, a list given to sponsors or the results' file, and never the allocator or the capacity formula. (The one
 * file that holds it names no column at all: the person's own data — the answer to an access request — carries every
 * column of their registration, this one with them; `ambassador-mark.test.ts`.)
 *
 * The structural half of that promise, in the style of `partner-never-leaves.test.ts`: the files that name the mark are a
 * reviewed list, and the surfaces above name none of it. The behavioural half — the public list, the published results,
 * the places and the outbox — is `ambassador-mark.test.ts` and `results/ambassador-hors-concours.test.ts`.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

const rel = (file: string) => path.relative(ROOT, file).replaceAll("\\", "/");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** The mark's own names: its column and property, its module, its panel, its action and its words. */
const NAMES_THE_MARK = /\bambassador\b|[/.]ambassador-mark["']|\bAmbassador[A-Z]\w*|\w+Ambassador\w*|["'`]registrations\.ambassador\./;

/** The files that read, write or draw it, each a reviewed edit. */
const READERS = new Set([
  // The column, the module that sets it and lists it, and the elite's ticks, which count under either mark.
  "src/db/schema/registrations.ts",
  "src/modules/registrations/ambassador-mark.ts",
  "src/modules/registrations/elite-mark.ts",
  // The backoffice's reads of a row and of a registration, the row's verbs, the press, the list, the page and the panel.
  "src/modules/registrations/admin-repository.ts",
  "src/modules/registrations/domain/row-verbs.ts",
  "src/app/[locale]/admin/registrations/actions.ts",
  "src/app/[locale]/admin/registrations/(list)/page.tsx",
  "src/app/[locale]/admin/registrations/[id]/page.tsx",
  "src/modules/registrations/ui/AmbassadorPanel.tsx",
  // The public list's one condition (`namedOnPublicList`, `unnamedOnPublicList`): the site tick counts under either mark.
  "src/modules/registrations/repository.ts",
  // The ranking — hors concours under either mark — and the backoffice's «Clasament» and «Premii», which say the mark.
  "src/modules/results/results.ts",
  "src/modules/results/domain/hors-concours.ts",
  "src/modules/results/ui/ResultRows.tsx",
  "src/app/[locale]/admin/events/[id]/results/page.tsx",
  // The mark's glyph, by name, in the three tables.
  "src/shared/ui/action-icons.ts",
  "src/shared/ui/status-glyphs.ts",
  "src/shared/ui/panel-glyphs.ts",
]);

/** The surfaces the mark never reaches. */
function isSurface(file: string): boolean {
  return (
    // Every public page and its routes: the participants' list, «Cine vine», the results, the members' zone, the forms.
    (file.startsWith("src/app/[locale]/") && !file.startsWith("src/app/[locale]/admin/") && !file.startsWith("src/app/[locale]/devs/")) ||
    // Every route handler: the public ones, and the backoffice's files — the registrations' Excel and CSV, the bibs, the results' file.
    file.startsWith("src/app/api/") ||
    // What a visitor's pages are drawn from.
    file.startsWith("src/modules/events/") ||
    file.startsWith("src/modules/home/") ||
    file.startsWith("src/modules/rsvp/") ||
    file.startsWith("src/modules/public-cache/") ||
    // Every email: the outbox, its templates, its render, the providers.
    file.startsWith("src/modules/notifications/") ||
    file.startsWith("src/infrastructure/email/") ||
    // The race-day desk.
    file.startsWith("src/app/[locale]/admin/checkin/") ||
    file === "src/modules/registrations/ui/DeskRow.tsx" ||
    // The bibs: an ambassador's prints as any other.
    /^src\/modules\/registrations\/bib[\w-]*\.tsx?$/.test(file) ||
    // The files the club downloads or gives away.
    file === "src/modules/registrations/csv.ts" ||
    file === "src/modules/registrations/workbook.ts" ||
    file === "src/modules/registrations/sponsor-list.ts" ||
    file === "src/modules/registrations/sponsor-sheet.ts" ||
    file === "src/modules/results/csv.ts" ||
    // The allocator, the capacity formula and the public form's door.
    file === "src/modules/registrations/service.ts" ||
    file === "src/modules/registrations/admin-service.ts" ||
    file === "src/modules/registrations/form-view.ts" ||
    file === "src/modules/registrations/fields.ts" ||
    (file.startsWith("src/modules/registrations/domain/") && file !== "src/modules/registrations/domain/row-verbs.ts")
  );
}

/** The source text of one top-level function of a file, from its declaration to the next top-level declaration. */
function functionText(file: string, name: string): string {
  const source = readFileSync(path.join(ROOT, file), "utf8");
  const start = source.search(new RegExp(`\\n(?:export )?(?:async )?function ${name}\\b`));
  expect(start, `${file} declares ${name}`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const end = rest.slice(1).search(/\n(?:export |async |function |const |type |\/\*\*)/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

describe("«Ambasador» reaches only the backoffice's own screens, the public list's condition and the ranking", () => {
  const naming = sourceFiles(SRC)
    .filter((file) => NAMES_THE_MARK.test(readFileSync(file, "utf8")))
    .map(rel)
    .sort();

  it("is named by the reviewed files and by no other — a new reader is a reviewed edit of this list", () => {
    expect(naming).toEqual([...READERS].sort());
  });

  it("is named by no public page, route, email, desk screen, bib, downloaded file, nor by the allocator", () => {
    expect(naming.filter(isSurface)).toEqual([]);
    // The list above is not vacuous: each kind of surface exists.
    const all = sourceFiles(SRC).map(rel);
    for (const probe of ["src/modules/registrations/service.ts", "src/modules/registrations/ui/DeskRow.tsx", "src/modules/registrations/workbook.ts", "src/modules/notifications/render.ts", "src/modules/registrations/bibs.ts"]) {
      expect(all, probe).toContain(probe);
      expect(isSurface(probe), probe).toBe(true);
    }
  });

  it("is read by the repository in the public list's one condition alone: the site tick, never a column a public row carries", () => {
    const file = "src/modules/registrations/repository.ts";
    const source = readFileSync(path.join(ROOT, file), "utf8");
    const inCondition = functionText(file, "namedOnPublicList") + functionText(file, "unnamedOnPublicList");
    const count = (text: string) => text.match(/registrations\.ambassador\b/g)?.length ?? 0;
    expect(count(inCondition)).toBe(2);
    // …and nowhere else in the file: no select hands the mark to a caller.
    expect(count(source)).toBe(2);
    expect(source.match(/\bambassador:/g)).toBeNull();
  });

  it("is selected by the published results for the site tick alone, and is on no published row's shape", () => {
    const file = "src/modules/results/results.ts";
    const source = readFileSync(path.join(ROOT, file), "utf8");
    // The published row's type names neither mark.
    const start = source.indexOf("export type PublicResultRow = {");
    expect(start).toBeGreaterThan(-1);
    const shape = source.slice(start, source.indexOf("\n};", start));
    expect(shape).not.toMatch(/ambassador|elite/i);
    // The public read mentions the column once — in its select, for `tickedForTheSite` — and never writes it onto a row.
    const read = functionText(file, "readPublicEventResults");
    expect(read.match(/ambassador/g)).toHaveLength(2);
    expect(read).toContain("ambassador: registrations.ambassador,");
    expect(read).not.toMatch(/\bambassador: (?!registrations\.ambassador)/);
  });
});
