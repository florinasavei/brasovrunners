import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «Note interne» for volunteers (BR-REQ-060-01) — a volunteer's internal note reaches only the screens and files that carry it: the
 * volunteer's own page (the card), the «Voluntari» list and the event card's rows (the marker: a count and, in its tooltip, the words), the volunteers' files (the
 * «Notă» column, handed as words) and «Toate datele unei persoane» (art. 15). Never the public volunteers' list, never an email,
 * never a badge. The twin of `tests/unit/registrations/notes-never-leave.test.ts`: the structural half of that promise — no file
 * outside the list below so much as imports the table or the service, so a later join or a helpful new column cannot quietly start
 * carrying one. (The behavioural half — the reads hand no words to anyone else — is `tests/integration/volunteers/volunteer-notes.test.ts`.)
 * A new reader is a reviewed edit of this list.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

const READERS = new Set(
  [
    // The service, the one writer and reader of the table.
    "src/modules/volunteers/volunteer-notes.ts",
    // «Adaugă un voluntar de mână»: the box's words written as the person's first note, in the add's own transaction.
    "src/modules/volunteers/volunteers.ts",
    // The add form's box: its length alone (`VOLUNTEER_NOTE_MAX`); and the event card's rows draw the marker from the notes the page hands them.
    "src/modules/volunteers/ui/VolunteerPerson.tsx",
    // «Toate datele unei persoane» (art. 15): each offer's live notes, the author as a role.
    "src/modules/registrations/person-data.ts",
    // The volunteer's page and its presses; the «Voluntari» list (one grouped read for the marker and its tooltip, the row's «Adaugă o notă»); the
    // event card's one grouped read for the same marker.
    "src/app/[locale]/admin/volunteers/[id]/page.tsx",
    "src/app/[locale]/admin/volunteers/[id]/note-actions.ts",
    "src/app/[locale]/admin/volunteers/(list)/page.tsx",
    "src/app/[locale]/admin/events/[id]/page.tsx",
    // The volunteers' files: one event's CSV and spreadsheet, and every event's spreadsheet — one grouped read each.
    "src/app/api/admin/events/[id]/volunteers/route.ts",
    "src/app/api/admin/volunteers/export/route.ts",
  ].map((file) => path.join(ROOT, file)),
);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const relative = (file: string) => path.relative(ROOT, file).replaceAll("\\", "/");

/** What names the table or the service: the schema file's path, the module's, or a relative `./volunteer-notes`. */
const NAMES_NOTES = /["'](?:@\/db\/schema\/event-volunteer-notes|@\/modules\/volunteers\/volunteer-notes|\.{1,2}\/volunteer-notes)["']/;
const SCHEMA_FILE = path.join(SRC, "db", "schema", "event-volunteer-notes.ts");
/** The table's names and the service's readers, wherever they would be spelled. */
const NAMES_TABLE = /event[_-]volunteer[_-]notes|eventVolunteerNotes|\b(?:list|count|add|delete|insert)VolunteerNotes?(?:ForExport)?\b|VolunteerNoteRow/;

describe("«Note interne» for volunteers — who reads the notes", () => {
  const files = sourceFiles(SRC);

  it("is imported by no file but the service, the add, the person's page and its presses, the lists, the person's record and the files", () => {
    const importers = files.filter((file) => file !== SCHEMA_FILE && NAMES_NOTES.test(readFileSync(file, "utf8")));
    const unexpected = importers.filter((file) => !READERS.has(file)).map(relative);
    expect(unexpected, "a new surface that reads a volunteer's notes must be a reviewed edit of this list").toEqual([]);
    // …and every reader on the list still reads them: the list does not outlive its readers.
    expect(importers.length).toBe(READERS.size);
  });

  it("is named by none of the public pages, the emails, the badges or the files' own writers", () => {
    const surfaces = files.filter((file) => {
      const path = relative(file);
      return (
        // Every public page and public route: the site outside the backoffice.
        (path.startsWith("src/app/[locale]/") && !path.startsWith("src/app/[locale]/admin/")) ||
        (path.startsWith("src/app/api/") && !path.startsWith("src/app/api/admin/")) ||
        // The volunteers' public list, its view and the public form's own module.
        path === "src/modules/volunteers/public-list.ts" ||
        path === "src/modules/volunteers/domain/public-list.ts" ||
        path === "src/modules/volunteers/offer.ts" ||
        // Every email.
        path.startsWith("src/modules/notifications/") ||
        // The badges, their designer and their PDF.
        path.startsWith("src/modules/volunteers/badges/") ||
        path.startsWith("src/app/[locale]/admin/events/[id]/badges/") ||
        // The files' writers are handed words — the cell — never the table.
        path === "src/modules/volunteers/csv.ts" ||
        path === "src/modules/volunteers/workbook.ts" ||
        path === "src/modules/volunteers/export.ts"
      );
    });
    expect(surfaces.length).toBeGreaterThan(20);
    for (const file of surfaces) expect(readFileSync(file, "utf8"), relative(file)).not.toMatch(NAMES_TABLE);
  });

  it("is read by each file's route after the volunteers' own gate, in ONE grouped read", () => {
    for (const route of ["src/app/api/admin/events/[id]/volunteers/route.ts", "src/app/api/admin/volunteers/export/route.ts"]) {
      const source = readFileSync(path.join(ROOT, route), "utf8");
      expect(source, route).toMatch(/canManageVolunteers\(actor\.role\)/);
      expect(source.match(/listVolunteerNotesForExport\(/g), route).toHaveLength(1);
      expect(source, route).not.toMatch(/event[_-]volunteer[_-]notes|eventVolunteerNotes/);
    }
  });

  it("shares only the pure words with the registrations' notes: no volunteers' file imports their module or their table", () => {
    const volunteers = files.filter((file) => relative(file).startsWith("src/modules/volunteers/"));
    for (const file of volunteers) {
      expect(readFileSync(file, "utf8"), relative(file)).not.toMatch(/["'](?:@\/modules\/registrations\/notes|@\/db\/schema\/registration-notes|\.{1,2}\/notes)["']/);
    }
  });
});
