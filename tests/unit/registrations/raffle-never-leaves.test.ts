import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «Avem tombolă» and «Participă la tombolă» (§949, BR-REQ-060-01) — the event's switch and the two ticks are the organizers' own:
 * they reach the editor's box, the registrations' and the volunteers' lists, the raffle's file and «Toate datele unei persoane»
 * (art. 15), and nothing else. Never a public page, an email, the desk, a count — and never the allocator or the capacity
 * formula: a tick takes a number off one file and moves nothing of a registration. The structural half of that promise, as
 * `partner-never-leaves.test.ts` holds the partner's label: no file outside the list below so much as names the columns or the
 * mark's module. (What the ticks do and who may press them is `tests/integration/registrations/raffle-mark.test.ts`.) A new
 * reader is a reviewed edit of this list.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** The three columns, as code and as SQL, and the mark's module. */
const NAMES_THE_RAFFLE_MARKS = /inRaffle|in_raffle|hasRaffle|has_raffle|registrations\/raffle-mark/;

const READERS = new Set(
  [
    // The three columns.
    "src/db/schema/events.ts",
    "src/db/schema/registrations.ts",
    "src/db/schema/event-volunteers.ts",
    // «Avem tombolă»: the editor's box, the form's reader, the fields' schema and the save.
    "src/modules/content/events/ui/boxes/RegistrationBox.tsx",
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
    // «Toate datele unei persoane» (art. 15): the volunteer's tick, and the line that says it.
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
  const naming = sourceFiles(SRC).filter((file) => NAMES_THE_RAFFLE_MARKS.test(readFileSync(file, "utf8")));

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
    ]) {
      expect(NAMES_THE_RAFFLE_MARKS.test(readFileSync(path.join(ROOT, file), "utf8")), file).toBe(false);
    }
    // The desk's queries and the counts of the same file that holds the list's row.
    for (const name of ["listDeskRegistrations", "countDesk", "findRegistrationByCheckinCode", "countKits", "summariseRegistrationsForAdmin"]) {
      expect(NAMES_THE_RAFFLE_MARKS.test(functionSource("src/modules/registrations/admin-repository.ts", name)), name).toBe(false);
    }
  });

  it("are never read by the allocator or the capacity formula", () => {
    for (const file of ["src/modules/registrations/domain/capacity.ts", "src/modules/registrations/domain/state-machine.ts", "src/modules/registrations/service.ts", "src/modules/registrations/admin-service.ts"]) {
      expect(NAMES_THE_RAFFLE_MARKS.test(readFileSync(path.join(ROOT, file), "utf8")), file).toBe(false);
    }
  });
});
