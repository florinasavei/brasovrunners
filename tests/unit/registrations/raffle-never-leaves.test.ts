import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importsModule } from "../../helpers/module-imports";

/**
 * «Avem tombolă» and «Participă la tombolă» (§949, BR-REQ-060-01) — the event's switch and the two ticks are the organizers' own:
 * they reach the editor's box, the registrations' and the volunteers' lists, the raffle's file and «Toate datele unei persoane»
 * (art. 15), and nothing else. Never a public page, an email, the desk, a count — and never the allocator or the capacity
 * formula: a tick takes a number off one file and moves nothing of a registration. The structural half of that promise, as
 * `partner-never-leaves.test.ts` holds the partner's label: no file outside the list below so much as names the columns or the
 * mark's module. (What the ticks do and who may press them is `tests/integration/registrations/raffle-mark.test.ts`.) A new
 * reader is a reviewed edit of this list.
 *
 * A reader is found by what it names — the columns — or by what it imports (§953): the mark's module by any spelling, the
 * `@/` alias or a relative path. The words alone missed `./raffle-mark`, the import a file beside the module would write —
 * the allocator's own file among them.
 *
 * Since §984 (the owner, 2026-11-18: «tombolă din oficiu vs tombolă cu înscriere separată», «vreau să văd în dreptul fiecărei
 * persoane dacă participă la tombolă»): the raffle's settings beside the switch, a line of the elite list's own tick, the one
 * answer that reads them all (`volunteers/domain/raffle.ts#raffleParticipation`), the reads that put it beside each person
 * (`volunteers/raffle-roster.ts`) and «Ziua cursei» → «Tombolă» are readers too. The desk's view of a person shows that answer in
 * words — «Participă la tombolă» or why not — through `readRaffleLine`, and names no tick; no desk query reads one. The one public
 * read of the settings is the sign-up's gate (`public-cache/reads.ts#cachedRaffleEvent`, through `readRaffleEvent`), which names
 * no column either.
 *
 * Since §1020 (the owner, 2026-11-20: «ar trebui să pot să-l scot de la tombolă ca și voluntar dar să fie cu extra confirmare și cu
 * logarea în aplicație cu ce voluntar a decis că X nu participă la tombolă») the desk's line has a press of its own — «Scoate de
 * la tombolă» / «Pune înapoi la tombolă», asked first —: the line that posts the state it wants (`ui/RaffleLines.tsx`) and the
 * press (`checkin/raffle-actions.ts`) are readers, through the mark's own writer for the desk's door
 * (`raffle-mark.ts#setRegistrationInRaffleAtDesk`), which writes the mark and its one audit row and nothing else. The desk's pages
 * and queries still name no tick, and nothing the press reaches emails anybody or expires a public page.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** The three columns, as code and as SQL, and the mark's module as the alias writes it. */
const NAMES_THE_RAFFLE_MARKS = /inRaffle|in_raffle|hasRaffle|has_raffle|registrations\/raffle-mark/;
/** The mark's module, wherever it is imported from and however the import spells it. */
const MARK_MODULE = path.join(SRC, "modules", "registrations", "raffle-mark");

/** Whether the file at `file`, whose text is `source`, reads the raffle's marks: it names a column, or imports the mark's module. */
const namesTheRaffleMarks = (file: string, source: string): boolean => NAMES_THE_RAFFLE_MARKS.test(source) || importsModule(file, source, MARK_MODULE, SRC);

const READERS = new Set(
  [
    // The three columns.
    "src/db/schema/events.ts",
    "src/db/schema/registrations.ts",
    "src/db/schema/event-volunteers.ts",
    // «Avem tombolă»: the editor's box and the closed bar of its «Tombolă» fold (`raffleSummary`, §NNN), the form's reader, the
    // fields' schema and the save.
    "src/modules/content/events/ui/boxes/RegistrationBox.tsx",
    "src/modules/content/events/ui/box-summaries.ts",
    "src/app/[locale]/admin/actions.ts",
    "src/modules/content/events/fields.ts",
    "src/modules/content/events/service.ts",
    // A registration's tick: the one writer, its trail's actions, the list's row and column, the row's press.
    "src/modules/registrations/raffle-mark.ts",
    "src/modules/audit/repository.ts",
    "src/modules/registrations/admin-repository.ts",
    "src/app/[locale]/admin/registrations/(list)/page.tsx",
    "src/app/[locale]/admin/registrations/actions.ts",
    // A volunteer's tick: the one writer and the row's item, the list's column, the row's press.
    "src/modules/volunteers/volunteers.ts",
    "src/app/[locale]/admin/volunteers/(list)/page.tsx",
    "src/app/[locale]/admin/volunteers/actions.ts",
    // «Lista pentru tombolă»: nobody an organizer took out.
    "src/modules/volunteers/raffle-list.ts",
    // «Transformă în voluntar» / «Transformă în alergător» (§953): the tick travels with the person, through the two writers above.
    "src/modules/volunteers/transform.ts",
    // «Toate datele unei persoane» (art. 15): the volunteer's tick, and the line that says it.
    "src/modules/registrations/person-data.ts",
    "src/modules/volunteers/ui/VolunteerAnswers.tsx",
    // §984: a line of the race's elite list takes part like a person — its own tick, and its one writer.
    "src/db/schema/event-elite-entries.ts",
    "src/modules/volunteers/raffle-entries.ts",
    // §984: the one answer (the switch, the groups, the mode and every tick), and the reads that put it beside each person.
    "src/modules/volunteers/domain/raffle.ts",
    "src/modules/volunteers/raffle-roster.ts",
    // §984: «Ziua cursei» → «Tombolă» — everybody with the answer, and «Scoate» / «Pune înapoi» through each kind's own writer.
    "src/app/[locale]/admin/checkin/tombola/page.tsx",
    "src/app/[locale]/admin/checkin/tombola/actions.ts",
    // §1020: the desk's own «Scoate de la tombolă» / «Pune înapoi la tombolă» — the line posting the state it wants, and its press.
    "src/modules/volunteers/ui/RaffleLines.tsx",
    "src/app/[locale]/admin/checkin/raffle-actions.ts",
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

describe("§949 the raffle's switch and ticks stay with the organizers", () => {
  const naming = sourceFiles(SRC).filter((file) => namesTheRaffleMarks(file, readFileSync(file, "utf8")));
  /** A file of `src/`, read and asked whether it reads the marks. */
  const reads = (file: string) => namesTheRaffleMarks(path.join(ROOT, file), readFileSync(path.join(ROOT, file), "utf8"));

  it("are named only by the files reviewed to read them", () => {
    const strangers = naming.filter((file) => !READERS.has(file)).map((file) => path.relative(ROOT, file));
    expect(strangers).toEqual([]);
  });

  it("keep the list honest: every reader still names them", () => {
    const silent = [...READERS].filter((file) => !naming.includes(file)).map((file) => path.relative(ROOT, file));
    expect(silent).toEqual([]);
  });

  it("are read by no public query, no email, no desk query and no count", () => {
    for (const file of [
      "src/modules/events/repository.ts",
      "src/modules/registrations/repository.ts",
      "src/modules/registrations/form-view.ts",
      "src/modules/notifications/render.ts",
      "src/modules/notifications/templates.ts",
      "src/modules/volunteers/public-list.ts",
      "src/modules/volunteers/csv.ts",
      "src/modules/volunteers/workbook.ts",
      "src/modules/registrations/csv.ts",
      "src/modules/registrations/workbook.ts",
      // §984: the desk's view of a person says the answer in words and names no tick; the tabs ask whether the event holds a
      // raffle through the roster; the public cache and the raffle's public page read the gate, never a column.
      "src/app/[locale]/admin/checkin/[code]/page.tsx",
      "src/modules/race-day/ui/RaceDayTabs.tsx",
      "src/modules/public-cache/reads.ts",
      "src/app/[locale]/events/[slug]/tombola/page.tsx",
      "src/app/[locale]/events/[slug]/page.tsx",
    ]) {
      expect(reads(file), file).toBe(false);
    }
    // The desk's queries and the counts of the same file that holds the list's row.
    for (const name of ["listDeskRegistrations", "countDesk", "findRegistrationByCheckinCode", "countKits", "summariseRegistrationsForAdmin"]) {
      expect(NAMES_THE_RAFFLE_MARKS.test(functionSource("src/modules/registrations/admin-repository.ts", name)), name).toBe(false);
    }
  });

  it("are moved at the desk by one press that writes the mark and its trail row, and nothing else (§1020)", () => {
    const press = readFileSync(path.join(ROOT, "src/app/[locale]/admin/checkin/raffle-actions.ts"), "utf8");
    // The desk's door, through the desk's own writer — never the organizers' tick, the tab's presses or another writer.
    expect(press).toMatch(/import \{ setRegistrationInRaffleAtDesk \} from "@\/modules\/registrations\/raffle-mark";/);
    expect(press).not.toMatch(/\bsetRegistrationInRaffle\b|changeVolunteer|setEliteLineRaffleTick/);
    // Nobody is told and no public page reads the mark: no email press, no outbox, no public cache, no other module's write.
    expect(press).not.toMatch(/inEmailPress|enqueueEmail|modules\/notifications|public-cache|revalidateTag|admin-service/);
    // The writer: one update of the mark alone — the moment beside it — and the one trail row; no other table is written.
    const writer = functionSource("src/modules/registrations/raffle-mark.ts", "setRegistrationInRaffleAtDesk");
    expect([...writer.matchAll(/\.set\(([^)]*)\)/g)].map((match) => match[1])).toEqual(["{ inRaffle, updatedAt: now }"]);
    expect([...writer.matchAll(/\.(update|insert|delete)\(/g)].map((match) => match[1])).toEqual(["update"]);
    expect([...writer.matchAll(/recordAuditEvent\(/g)]).toHaveLength(1);
    // The desk's pages hand the press to the line and still name no tick themselves (the list above holds them to it).
    for (const page of ["src/app/[locale]/admin/checkin/page.tsx", "src/app/[locale]/admin/checkin/[code]/page.tsx"]) {
      expect(reads(page), page).toBe(false);
      expect(readFileSync(path.join(ROOT, page), "utf8"), page).toContain("exclusionAction: raffleDeskExclusionAction");
    }
  });

  it("are never read by the allocator or the capacity formula", () => {
    for (const file of ["src/modules/registrations/domain/capacity.ts", "src/modules/registrations/domain/state-machine.ts", "src/modules/registrations/service.ts", "src/modules/registrations/admin-service.ts"]) {
      expect(reads(file), file).toBe(false);
    }
  });

  it("catches a reader that imports the mark's module by a relative path, which the words alone would miss (§953)", () => {
    const at = (...parts: string[]) => path.join(SRC, ...parts);
    // The allocator's own file, beside the mark, starting to ask whether an event holds a raffle: no column named, no alias path.
    const beside = `import { eventHoldsRaffle } from "./raffle-mark";\n\nexport const drawsARaffle = eventHoldsRaffle;\n`;
    expect(NAMES_THE_RAFFLE_MARKS.test(beside)).toBe(false);
    expect(namesTheRaffleMarks(at("modules", "registrations", "service.ts"), beside)).toBe(true);
    // One folder down, from the capacity formula's folder, loaded lazily, re-exported, and with the extension or single quotes written.
    expect(namesTheRaffleMarks(at("modules", "registrations", "ui", "PlaceOutlook.tsx"), `import { eventHoldsRaffle } from "../raffle-mark";`)).toBe(true);
    expect(namesTheRaffleMarks(at("modules", "registrations", "domain", "capacity.ts"), `const mark = await import("../raffle-mark");`)).toBe(true);
    expect(namesTheRaffleMarks(at("modules", "registrations", "csv.ts"), `export * from './raffle-mark.ts';`)).toBe(true);
    // The alias, as before.
    expect(namesTheRaffleMarks(at("modules", "notifications", "render.ts"), `import { eventHoldsRaffle } from "@/modules/registrations/raffle-mark";`)).toBe(true);
    // The same spelling from a folder where it is another file is not the mark, nor is a neighbour with a longer name: no false alarm.
    expect(namesTheRaffleMarks(at("modules", "volunteers", "csv.ts"), beside)).toBe(false);
    expect(namesTheRaffleMarks(at("modules", "registrations", "service.ts"), `import { markOf } from "./raffle-marks";`)).toBe(false);
    expect(namesTheRaffleMarks(at("modules", "registrations", "service.ts"), `import mark from "raffle-mark";`)).toBe(false);
  });
});
