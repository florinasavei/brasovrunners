import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importsModule } from "../../helpers/module-imports";

/**
 * «Prezent» on a volunteer (§983, BR-REQ-060-01; the owner, 2026-11-18, three days before the race: «La voluntari trebuie să trec
 * prezent/absent ca să pot face tombola doar pentru cei prezenți») is the organizers' own mark: it reaches the «Voluntari» list's
 * column, its strip and its filter, the person's page, «Lista pentru tombolă» and its present-only twin (and the two lists' buttons
 * that take them), «Transformă în voluntar», and «Toate datele unei persoane» (art. 15) — and nothing else. Never a public page,
 * never an email, never a badge, never the desk, never the public volunteers' list, never the allocator — and, until a change of its
 * own says so, not «Planul voluntarilor», the event editor's volunteers card or the volunteers' Excel and CSV either.
 *
 * The structural half of that promise, as `decision-never-leaves.test.ts` holds the race-day decision's: no file outside the list
 * below so much as names the column, its press, its filter, the present-only file or its words, so a later join or a helpful new
 * column cannot quietly start carrying it. A new reader is a reviewed edit of this list. (What the verb writes and who may write it
 * is `tests/integration/volunteers/present.test.ts`; the file, `raffle-list.test.ts`.)
 *
 * The column's name is a common English word, so the words alone are the distinctive ones — the column as the schema and a query
 * spell it, the verb's kind, the press, the filter's reading, the file's option and address, the catalogue's own namespace. And
 * since every row the staff screens read now carries the field, the surfaces that read volunteers are held to more: none of them
 * reads any `present` at all. A reader is also found by what it imports — the «Voluntari» screen's actions, which hold the press —
 * by any spelling: the `@/` alias or a relative path, resolved from the importing file (`tests/helpers/module-imports.ts`).
 *
 * Since §984 the raffle's roster and «Ziua cursei» → «Tombolă» read it too: that tab is the organizers' (`canTakeRaffleList`),
 * not the desk, and shows who was there beside whether they take part. Since §NNN «Ziua cursei» → «Jurnal» and the «Voluntari»
 * list's «Org1, 08:20» read the trail of who ticked it: that tab is the organizers' too (`canReadRaceDayJournal`), never the desk's.
 * The desk's own pages stay held to reading none — and to importing none of the log's two modules, which the sweep exempts: the
 * scanned page's «Scanat înainte» reads its scans through the desk's own (`registrations/code-scans.ts`), held like the rest.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** The column as code and SQL, the verb's kind, the press with its toasts and test ids, the filter's reading, the file's option and its address, the words. */
const NAMES_THE_PRESENCE =
  /eventVolunteers\.present\b|event_volunteers\.present\b|boolean\("present"\)|\bsetPresent\b|VolunteerPresent|volunteerPresent|volunteer-(?:page-)?present|\bonlyPresent\b|presentFilterOf|volunteers\.presence\.|raffle\?present=/;

/**
 * A read of the field however the row was fetched — `row.present`, `{ present }`, `{ present: here } = row`, `row["present"]`, and a
 * raw query's `present FROM` — which the surfaces that read volunteers never make.
 */
const READS_A_PRESENT_FIELD = /\.present\b|[{,]\s*present\s*[,}:]|\[\s*["'`]present["'`]\s*\]|\bpresent\s+FROM\b/;

/** The «Voluntari» screen's actions, whose file name says nothing of a presence: the module a leak would be imported from. */
const ACTIONS_MODULE = path.join(SRC, "app", "[locale]", "admin", "volunteers", "actions");

/**
 * «Ziua cursei» → «Jurnal»'s two modules (§NNN), the organizers' log, which reads a volunteer's ticks and so is exempt from the
 * sweep below: a surface that imported them would read through the exemption, so none may.
 */
const JOURNAL_MODULES = [path.join(SRC, "modules", "race-day", "journal"), path.join(SRC, "modules", "race-day", "domain", "journal")];

/** Whether a file's text names the presence. (The import of the screen's actions is asked apart, of the surfaces: every staff screen may import them.) */
const namesThePresence = (source: string): boolean => NAMES_THE_PRESENCE.test(source);

const READERS = new Set(
  [
    // The column itself.
    "src/db/schema/event-volunteers.ts",
    // The one writer (`changeVolunteer`, kind `setPresent`) and the row's item, which the staff screens read.
    "src/modules/volunteers/volunteers.ts",
    // The press of the list's row and of the person's page.
    "src/app/[locale]/admin/volunteers/actions.ts",
    // The «Voluntari» list: the column «Prezent», the strip's «Prezenți» and «Absenți», the filter, the raffle's two buttons.
    "src/app/[locale]/admin/volunteers/(list)/page.tsx",
    // The list's reads: the filter `present=yes|no` and the strip's two figures.
    "src/modules/volunteers/admin-list.ts",
    // The person's page: the tick beside the name, and the chip among the person's own.
    "src/app/[locale]/admin/volunteers/[id]/page.tsx",
    "src/modules/volunteers/ui/VolunteerPerson.tsx",
    // «Lista pentru tombolă»: the volunteer's «Prezent» cell, the present-only file, its download and its button on the registrations list.
    "src/modules/volunteers/raffle-list.ts",
    "src/app/api/admin/events/[id]/raffle/route.ts",
    "src/app/[locale]/admin/registrations/(list)/page.tsx",
    // «Transformă în voluntar»: a runner the desk checked in is ticked present, by the volunteers' own tick.
    "src/modules/volunteers/transform.ts",
    // «Toate datele unei persoane» (art. 15): the offer's own row, and the line that draws it.
    "src/modules/registrations/person-data.ts",
    "src/modules/volunteers/ui/VolunteerAnswers.tsx",
    // §984: the raffle's roster reads it beside each volunteer, for the files and «Ziua cursei» → «Tombolă» — the organizers' tab
    // (`canTakeRaffleList`), whose «Doar prezenții», «Prezent» column and present-only download are the raffle's, not the desk's.
    "src/modules/volunteers/raffle-roster.ts",
    "src/app/[locale]/admin/checkin/tombola/page.tsx",
    // §984: a line of the race's elite list's own «Prezent» (`event_elite_entries.present`), named alike — the organizers' tick on that tab.
    "src/db/schema/event-elite-entries.ts",
    // §NNN: who ticked it and when — the trail's `volunteer.edited` rows of `setPresent` — under the tick on the «Voluntari» list and
    // the person's page, and the ticks on and off as lines of «Ziua cursei» → «Jurnal», the organizers' tab (`canReadRaceDayJournal`).
    "src/modules/volunteers/present-by.ts",
    "src/modules/race-day/journal.ts",
    "src/modules/race-day/domain/journal.ts",
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

/** The surfaces that read volunteers or a race's people, where no `present` of any kind is read: a leak there would be the field itself. */
function readsVolunteers(at: string): boolean {
  // «Ziua cursei» → «Tombolă» (§984) is the organizers' raffle tab, not the desk: who was there is what its «Doar prezenții» filters by.
  if (at.startsWith("src/app/[locale]/admin/checkin/tombola/")) return false;
  // «Ziua cursei» → «Jurnal» (§NNN) is the organizers' log, not the desk: a volunteer's «Prezent» ticked and unticked is its lines.
  if (at.startsWith("src/app/[locale]/admin/checkin/jurnal/") || at === "src/modules/race-day/journal.ts" || at === "src/modules/race-day/domain/journal.ts") return false;
  return (
    // The event's pages, its volunteers' page and its public form; the event page's own module and the public cache that feeds it.
    at.startsWith("src/app/[locale]/events/") ||
    at.startsWith("src/app/[locale]/volunteers/") ||
    at.startsWith("src/modules/events/") ||
    at.startsWith("src/modules/public-cache/") ||
    // The volunteers' public list, its view, the public form's own module and the public volunteer screens beside it.
    at === "src/modules/volunteers/public-list.ts" ||
    at === "src/modules/volunteers/domain/public-list.ts" ||
    at === "src/modules/volunteers/offer.ts" ||
    at === "src/modules/volunteers/ui/VolunteersList.tsx" ||
    at === "src/modules/volunteers/ui/VolunteerBox.tsx" ||
    at === "src/modules/volunteers/ui/VolunteerCallout.tsx" ||
    at === "src/modules/volunteers/ui/VolunteerDone.tsx" ||
    // The volunteer's agreement, its PDF, the guardian's agreement and the invitation link: what a volunteer reads and signs.
    at === "src/modules/volunteers/agreement.ts" ||
    at === "src/modules/volunteers/agreement-pdf.ts" ||
    at === "src/modules/volunteers/guardian.ts" ||
    at === "src/modules/volunteers/invitation-link.ts" ||
    // Every email, and the point's email that reads the plan.
    at.startsWith("src/modules/notifications/") ||
    at === "src/modules/volunteers/point-mail.ts" ||
    // The badges: their designer, their query, their PDF and their download.
    at.startsWith("src/modules/volunteers/badges/") ||
    at.startsWith("src/app/[locale]/admin/events/[id]/badges/") ||
    at.startsWith("src/app/api/admin/events/[id]/badges/") ||
    // The race-day desk: «Ziua cursei» and its «Prezența», the desk's rows, and the scanned page's «Scanat înainte» (§NNN).
    at.startsWith("src/app/[locale]/admin/checkin/") ||
    at.startsWith("src/modules/race-day/") ||
    /^src\/modules\/registrations\/ui\/Desk[^/]*\.tsx$/.test(at) ||
    at === "src/modules/registrations/code-scans.ts" ||
    at === "src/modules/registrations/domain/code-scans.ts" ||
    // The allocator and the capacity formula.
    at === "src/modules/registrations/domain/capacity.ts" ||
    at === "src/modules/registrations/domain/state-machine.ts" ||
    at === "src/modules/registrations/service.ts" ||
    at === "src/modules/registrations/admin-service.ts" ||
    // «Planul voluntarilor», the event editor's volunteers card and the volunteers' files: a «Prezent» there is a change of its own.
    at === "src/modules/volunteers/plan.ts" ||
    at.startsWith("src/app/[locale]/admin/events/[id]/plan-voluntari/") ||
    at === "src/modules/volunteers/ui/VolunteersCard.tsx" ||
    at === "src/modules/volunteers/csv.ts" ||
    at === "src/modules/volunteers/workbook.ts" ||
    at === "src/modules/volunteers/export.ts" ||
    at.startsWith("src/app/api/admin/events/[id]/volunteers/") ||
    at.startsWith("src/app/api/admin/volunteers/")
  );
}

describe("§983 a volunteer's «Prezent» stays with the organizers", () => {
  const files = sourceFiles(SRC);
  const naming = files.filter((file) => namesThePresence(readFileSync(file, "utf8")));

  it("is named only by the files reviewed to read it", () => {
    const strangers = naming.filter((file) => !READERS.has(file)).map(relative);
    expect(strangers, "a new surface that reads a volunteer's «Prezent» must be a reviewed edit of this list").toEqual([]);
  });

  it("keeps the list honest: every reader still names it", () => {
    const silent = [...READERS].filter((file) => !naming.includes(file)).map(relative);
    expect(silent).toEqual([]);
  });

  it("is on no public page or route, in no email, on no badge, not at the desk, not on the public list and never read by the allocator", () => {
    const surfaces = files.filter((file) => {
      const at = relative(file);
      // Every public page and public route — the site outside the backoffice — and every surface that reads volunteers.
      return (at.startsWith("src/app/[locale]/") && !at.startsWith("src/app/[locale]/admin/")) || (at.startsWith("src/app/api/") && !at.startsWith("src/app/api/admin/")) || readsVolunteers(at);
    });
    // The sweep found the surfaces it is about, each kind of them.
    expect(surfaces.length).toBeGreaterThan(60);
    for (const kind of [
      "src/app/[locale]/events/",
      "src/modules/events/ui/EventPageView.tsx",
      "src/modules/volunteers/ui/VolunteersList.tsx",
      "src/app/api/",
      "src/modules/notifications/",
      "src/modules/volunteers/badges/",
      "src/app/[locale]/admin/checkin/",
      "src/modules/race-day/",
      "src/modules/registrations/ui/Desk",
      "src/modules/registrations/code-scans.ts",
      "src/modules/registrations/domain/capacity.ts",
      "src/modules/registrations/service.ts",
      "src/modules/volunteers/public-list.ts",
      "src/modules/volunteers/plan.ts",
      "src/modules/volunteers/ui/VolunteersCard.tsx",
      "src/modules/volunteers/csv.ts",
      "src/app/api/admin/volunteers/",
    ]) {
      expect(surfaces.some((file) => relative(file).startsWith(kind)), kind).toBe(true);
    }
    for (const file of surfaces) {
      const source = readFileSync(file, "utf8");
      expect(namesThePresence(source), relative(file)).toBe(false);
      // Nor may one reach the press: the screen's actions are the staff's, by whatever path they are imported.
      expect(importsModule(file, source, ACTIONS_MODULE, SRC), relative(file)).toBe(false);
      // Nor read through the organizers' log, which the sweep exempts (§NNN): the desk's scans are its own module's.
      for (const journal of JOURNAL_MODULES) expect(importsModule(file, source, journal, SRC), `${relative(file)} imports ${relative(journal)}`).toBe(false);
    }
  });

  it("is read as a field by none of the surfaces that read volunteers — whatever the row was fetched by", () => {
    const volunteerSurfaces = files.filter((file) => readsVolunteers(relative(file)));
    expect(volunteerSurfaces.length).toBeGreaterThan(40);
    for (const file of volunteerSurfaces) {
      expect(READS_A_PRESENT_FIELD.test(readFileSync(file, "utf8")), relative(file)).toBe(false);
    }
  });

  it("catches a reader by its names, by a field read and by its import — by the alias or by a relative path — and raises no false alarm", () => {
    const at = (...parts: string[]) => path.join(SRC, ...parts);
    // The screen's actions, imported from a public page by a relative path under another name: not a word of a presence in the source.
    const borrowed = `import * as staffPresses from "../../admin/volunteers/actions";\n\nexport const press = staffPresses;\n`;
    expect(NAMES_THE_PRESENCE.test(borrowed)).toBe(false);
    expect(importsModule(at("app", "[locale]", "events", "[slug]", "page.tsx"), borrowed, ACTIONS_MODULE, SRC)).toBe(true);
    expect(importsModule(at("app", "[locale]", "events", "[slug]", "page.tsx"), `import { setVolunteerPresentAction } from "@/app/[locale]/admin/volunteers/actions";`, ACTIONS_MODULE, SRC)).toBe(true);
    expect(importsModule(at("app", "[locale]", "admin", "events", "[id]", "page.tsx"), `import { x } from "./actions";`, ACTIONS_MODULE, SRC)).toBe(false);
    // The organizers' log, imported by a desk page — the alias or a relative path — and the desk's own scans, which are not it (§NNN).
    const scanned = at("app", "[locale]", "admin", "checkin", "[code]", "page.tsx");
    expect(importsModule(scanned, `import { listCodeScans } from "@/modules/race-day/journal";`, JOURNAL_MODULES[0], SRC)).toBe(true);
    expect(importsModule(at("modules", "race-day", "ui", "RaceDayTabs.tsx"), `import { JOURNAL_KINDS } from "../domain/journal";`, JOURNAL_MODULES[1], SRC)).toBe(true);
    expect(importsModule(scanned, `import { listCodeScans } from "@/modules/registrations/code-scans";`, JOURNAL_MODULES[0], SRC)).toBe(false);
    // The names, as the source writes them.
    for (const named of [
      "eventVolunteers.present",
      `present: boolean("present").notNull()`,
      "SELECT 1 FROM event_volunteers WHERE event_volunteers.present",
      `{ kind: "setPresent", eventId, id, present: true }`,
      "setVolunteerPresentAction",
      `saved: "volunteerPresentOn"`,
      `data-testid="volunteer-present-tick"`,
      `data-testid="volunteer-page-present-form"`,
      "exportRaffleList(db, actor, id, now, { onlyPresent })",
      "presentFilterOf(present)",
      `t("volunteers.presence.summaryAbsent", { count })`,
      "/api/admin/events/${id}/raffle?present=1&lang=ro",
    ]) {
      expect(NAMES_THE_PRESENCE.test(named), named).toBe(true);
    }
    // A field read, on a surface that reads volunteers: the row's field, a destructured one — renamed too —, a shorthand object, the
    // field by its quoted name, and a raw query's column.
    for (const read of [
      "if (row.present) count += 1;",
      "const { name, present } = volunteer;",
      "rows.map(({ present }) => present)",
      "return { id, present };",
      "const { present: here } = row;",
      "const { name, present: wasThere, kit } = volunteer;",
      'if (row["present"]) count += 1;',
      "const ticked = row['present'];",
      "sql`SELECT name, present FROM event_volunteers WHERE event_id = ${id}`",
    ]) {
      expect(READS_A_PRESENT_FIELD.test(read), read).toBe(true);
    }
    // What only looks like one: the word in prose, a local of that name, the desk's own words, the registrations' raffle cell words.
    for (const other of ["// present only when the club ticked it", "const present = new Set(kinds);", "present.has(group)", "checkedIn", "registrations.raffle.present.yes", "the present-day rules"]) {
      expect(NAMES_THE_PRESENCE.test(other), other).toBe(false);
    }
    for (const other of ["// present only when the club ticked it", "const present = new Set(kinds);", "present.has(group)", "// shown from the start, present from the first finisher", "presentWords"]) {
      expect(READS_A_PRESENT_FIELD.test(other), other).toBe(false);
    }
  });
});
