import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «Decizie pentru ziua cursei» (§954, BR-REQ-060-01) — what the organizers decided for a volunteer on race day is their own
 * line: it reaches the «Voluntari» list's column, the person's page, the event card's row of the person and «Toate datele unei
 * persoane» (art. 15), and nothing else. Never a public page, never an email, never a badge, never the desk, never the public
 * volunteers' list, never the raffle's file — and, until a change of its own says so, not the volunteers' files either.
 *
 * The structural half of that promise, as `plan-never-leaves.test.ts` holds the point's and `volunteer-notes-never-leave.test.ts`
 * the notes': no file outside the list below so much as names the column, its reading, its press, its card or its words, so a
 * later join or a helpful new column cannot quietly start carrying it. A new reader is a reviewed edit of this list. (What the
 * verb writes and who may write it is `tests/integration/volunteers/race-day-decision.test.ts`.)
 *
 * A reader is found by what it names, or by what it imports — the card's module or the «Voluntari» screen's actions, whose
 * file name says nothing of a decision — by any spelling: the `@/` alias or a relative path, resolved from the importing file.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** The column and the field, the reading of the box and its limit, the verb's kind, the press, the card and its anchor, the catalogue's words. */
const NAMES_THE_DECISION = /raceDayDecision|race_day_decision|RaceDayDecision|\bsetDecision\b|VolunteerDecision|VOLUNTEER_DECISION_MAX|DECISION_ANCHOR|volunteers\.decision\./;

/** The decision's own card, and the screen's actions that hold its press: the two modules a leak would be imported from. */
const CARD_MODULE = path.join(SRC, "modules", "volunteers", "ui", "VolunteerDecisionCard");
const ACTIONS_MODULE = path.join(SRC, "app", "[locale]", "admin", "volunteers", "actions");

/** Every module a source names: `… from "x"`, `import "x"`, `import("x")`, `require("x")` — single or double quotes. */
function specifiersOf(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(["'])([^"'\n]+)\1/g)].map((match) => match[2]);
}

/** The file a specifier means, without its extension: `@/` is `src/`, a relative one is read from the importing file's folder, a package's is none. */
function moduleOf(file: string, specifier: string): string | null {
  const target = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
  return target === null ? null : target.replace(/\.(tsx?|mjs|js)$/, "").replace(/[\\/]index$/, "");
}

/** Whether the file at `file`, whose text is `source`, imports `module` — by the alias or by a relative path. */
const importsModule = (file: string, source: string, module: string): boolean => specifiersOf(source).some((specifier) => moduleOf(file, specifier) === module);

/** Whether a file reads the decision: it names it, or it imports the card. */
const namesTheDecision = (file: string, source: string): boolean => NAMES_THE_DECISION.test(source) || importsModule(file, source, CARD_MODULE);

const READERS = new Set(
  [
    // The column itself, and its CHECK.
    "src/db/schema/event-volunteers.ts",
    // The limit, and the one reading of the box.
    "src/modules/volunteers/domain/volunteer.ts",
    // The one writer (`changeVolunteer`, kind `setDecision`) and the row's item, which the staff screens read.
    "src/modules/volunteers/volunteers.ts",
    // The press of the list's dialog and of the person's page.
    "src/app/[locale]/admin/volunteers/actions.ts",
    // The «Voluntari» list: the column «Decizie ziua cursei» and its dialog.
    "src/app/[locale]/admin/volunteers/(list)/page.tsx",
    // The person's page and the card it draws in the organizers' part.
    "src/app/[locale]/admin/volunteers/[id]/page.tsx",
    "src/modules/volunteers/ui/VolunteerDecisionCard.tsx",
    // The event card's row of the person: the line, read.
    "src/modules/volunteers/ui/VolunteerPerson.tsx",
    // «Toate datele unei persoane» (art. 15): the offer's own row, and the line that draws it.
    "src/modules/registrations/person-data.ts",
    "src/modules/volunteers/ui/VolunteerAnswers.tsx",
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

const relative = (file: string) => path.relative(ROOT, file).replaceAll("\\", "/");

describe("§954 a volunteer's race-day decision stays with the organizers", () => {
  const files = sourceFiles(SRC);
  const naming = files.filter((file) => namesTheDecision(file, readFileSync(file, "utf8")));

  it("is named only by the files reviewed to read it", () => {
    const strangers = naming.filter((file) => !READERS.has(file)).map(relative);
    expect(strangers, "a new surface that reads a volunteer's race-day decision must be a reviewed edit of this list").toEqual([]);
  });

  it("keeps the list honest: every reader still names it", () => {
    const silent = [...READERS].filter((file) => !naming.includes(file)).map(relative);
    expect(silent).toEqual([]);
  });

  it("is on no public page or route, in no email, on no badge, not at the desk, not on the public list and in no file the club hands out", () => {
    const surfaces = files.filter((file) => {
      const at = relative(file);
      return (
        // Every public page and public route: the site outside the backoffice.
        (at.startsWith("src/app/[locale]/") && !at.startsWith("src/app/[locale]/admin/")) ||
        (at.startsWith("src/app/api/") && !at.startsWith("src/app/api/admin/")) ||
        // The volunteers' public list, its view and the public form's own module.
        at === "src/modules/volunteers/public-list.ts" ||
        at === "src/modules/volunteers/domain/public-list.ts" ||
        at === "src/modules/volunteers/offer.ts" ||
        // Every email.
        at.startsWith("src/modules/notifications/") ||
        // The badges: their designer, their query, their PDF and their download.
        at.startsWith("src/modules/volunteers/badges/") ||
        at.startsWith("src/app/[locale]/admin/events/[id]/badges/") ||
        at.startsWith("src/app/api/admin/events/[id]/badges/") ||
        // The race-day desk.
        at.startsWith("src/app/[locale]/admin/checkin/") ||
        // The raffle's file and its download.
        at === "src/modules/volunteers/raffle-list.ts" ||
        at.startsWith("src/app/api/admin/events/[id]/raffle/") ||
        // The volunteers' files — the CSV, the spreadsheets and their downloads: a column there is a change of its own (§954).
        at === "src/modules/volunteers/csv.ts" ||
        at === "src/modules/volunteers/workbook.ts" ||
        at === "src/modules/volunteers/export.ts" ||
        at.startsWith("src/app/api/admin/events/[id]/volunteers/") ||
        at.startsWith("src/app/api/admin/volunteers/")
      );
    });
    // The sweep found the surfaces it is about, each kind of them.
    expect(surfaces.length).toBeGreaterThan(60);
    for (const kind of ["src/app/[locale]/events/", "src/app/api/", "src/modules/notifications/", "src/modules/volunteers/badges/", "src/app/[locale]/admin/checkin/", "src/modules/volunteers/raffle-list.ts", "src/modules/volunteers/csv.ts", "src/app/api/admin/volunteers/"]) {
      expect(surfaces.some((file) => relative(file).startsWith(kind)), kind).toBe(true);
    }
    for (const file of surfaces) {
      const source = readFileSync(file, "utf8");
      expect(namesTheDecision(file, source), relative(file)).toBe(false);
      // Nor may one reach the press: the screen's actions are the staff's, by whatever path they are imported.
      expect(importsModule(file, source, ACTIONS_MODULE), relative(file)).toBe(false);
    }
  });

  it("catches a reader by its import, by the alias or by a relative path, where the names alone would miss it", () => {
    const at = (...parts: string[]) => path.join(SRC, ...parts);
    // The screen's actions, imported from a public page by a relative path under another name: not a word of a decision in the source.
    const borrowed = `import * as staffPresses from "../../admin/volunteers/actions";\n\nexport const press = staffPresses;\n`;
    expect(NAMES_THE_DECISION.test(borrowed)).toBe(false);
    expect(importsModule(at("app", "[locale]", "events", "[slug]", "page.tsx"), borrowed, ACTIONS_MODULE)).toBe(true);
    expect(importsModule(at("app", "[locale]", "events", "[slug]", "page.tsx"), `import { x } from "@/app/[locale]/admin/volunteers/actions";`, ACTIONS_MODULE)).toBe(true);
    // The card: beside it, one folder up, from another module, loaded lazily, re-exported, with the extension or single quotes written.
    expect(namesTheDecision(at("modules", "volunteers", "ui", "VolunteerBox.tsx"), `import Card from "./VolunteerDecisionCard";`)).toBe(true);
    expect(importsModule(at("modules", "volunteers", "ui", "VolunteerBox.tsx"), `import Card from "./VolunteerDecisionCard";`, CARD_MODULE)).toBe(true);
    expect(importsModule(at("modules", "volunteers", "public-list.ts"), `import {\n  DECISION,\n} from './ui/VolunteerDecisionCard.tsx';`, CARD_MODULE)).toBe(true);
    expect(importsModule(at("modules", "notifications", "render.ts"), `const card = await import("../volunteers/ui/VolunteerDecisionCard");`, CARD_MODULE)).toBe(true);
    expect(importsModule(at("modules", "volunteers", "export.ts"), `export * from "./ui/VolunteerDecisionCard";`, CARD_MODULE)).toBe(true);
    expect(importsModule(at("modules", "events", "repository.ts"), `import Card from "@/modules/volunteers/ui/VolunteerDecisionCard";`, CARD_MODULE)).toBe(true);
    // The same spelling from a folder where it is another file is not the card, nor is a neighbour with a longer name, nor a package: no false alarm.
    expect(importsModule(at("modules", "registrations", "ui", "NotesCard.tsx"), `import Card from "./VolunteerDecisionCard";`, CARD_MODULE)).toBe(false);
    expect(importsModule(at("modules", "volunteers", "ui", "VolunteerBox.tsx"), `import Cards from "./VolunteerDecisionCards";`, CARD_MODULE)).toBe(false);
    expect(importsModule(at("modules", "volunteers", "ui", "VolunteerBox.tsx"), `import Card from "VolunteerDecisionCard";`, CARD_MODULE)).toBe(false);
    expect(importsModule(at("app", "[locale]", "admin", "events", "[id]", "page.tsx"), `import { x } from "./actions";`, ACTIONS_MODULE)).toBe(false);
    // The names, as the source writes them — and a word that only looks like one is not one.
    for (const named of ["row.raceDayDecision", `"race_day_decision"`, "raceDayDecisionFrom(typed)", `{ kind: "setDecision" }`, "setVolunteerDecisionAction", "VOLUNTEER_DECISION_MAX", `t("volunteers.decision.column")`]) {
      expect(NAMES_THE_DECISION.test(named), named).toBe(true);
    }
    for (const other of ["the club's decision", "setDecisions(list)", "decisionsSection", "volunteers.plan.column", "raceDay"]) {
      expect(NAMES_THE_DECISION.test(other), other).toBe(false);
    }
  });
});
