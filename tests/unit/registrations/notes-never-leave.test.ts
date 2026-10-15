import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §777, BR-REQ-060-01 — an internal note reaches only the screens that draw it.
 *
 * The owner: notes «doar pentru organizatori și administratori». A note is read by the registration's own page
 * (the card), counted by the registrations list (the marker) and listed in «Toate datele unei persoane»; it is
 * on no other surface — not the race-day desk (§67: a name, a state and a number), not the CSV or the
 * spreadsheet, not the public list, not an email. This is the structural half of that promise: no file outside
 * the short list below so much as imports the table or the service, so a later join or a helpful new column in
 * the desk's query, an export or a public page cannot quietly start carrying one. (The behavioural half — the
 * queries return no words — is `registration-notes.test.ts`.) A new reader is a reviewed edit of the list.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

const READERS = new Set(
  [
    // The table, the service and the one card that draws the notes.
    "src/modules/registrations/notes.ts",
    "src/modules/registrations/ui/NotesCard.tsx",
    // «Toate datele unei persoane» (art. 15).
    "src/modules/registrations/person-data.ts",
    // The registration's page, its two presses, and the list's marker.
    "src/app/[locale]/admin/registrations/[id]/page.tsx",
    "src/app/[locale]/admin/registrations/[id]/note-actions.ts",
    "src/app/[locale]/admin/registrations/(list)/page.tsx",
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

/** What names the table or the service: the module's path, the schema file's, or a relative `./notes`. */
const NAMES_NOTES = /["'](?:@\/db\/schema\/registration-notes|@\/modules\/registrations\/notes|\.{1,2}\/notes)["']/;
const SCHEMA_FILE = path.join(SRC, "db", "schema", "registration-notes.ts");

describe("§777 who reads the notes", () => {
  const files = sourceFiles(SRC);

  it("is imported by no file but the card, the page, its presses, the list and the person's record", () => {
    const importers = files.filter((file) => file !== SCHEMA_FILE && NAMES_NOTES.test(readFileSync(file, "utf8")));
    const unexpected = importers.filter((file) => !READERS.has(file)).map((file) => path.relative(ROOT, file).replaceAll("\\", "/"));
    expect(unexpected, "a new surface that reads the notes must be a reviewed edit of this list").toEqual([]);
    // …and every reader on the list still reads them: the list does not outlive its readers.
    expect(importers.length).toBe(READERS.size);
  });

  it("is named by none of the desk, the exports or the public pages", () => {
    const surfaces = files.filter((file) => {
      const relative = path.relative(ROOT, file).replaceAll("\\", "/");
      return (
        relative.startsWith("src/app/[locale]/admin/checkin/") ||
        relative.startsWith("src/app/api/admin/registrations/export/") ||
        relative === "src/modules/registrations/csv.ts" ||
        relative === "src/modules/registrations/workbook.ts" ||
        relative === "src/modules/registrations/ui/DeskRow.tsx" ||
        relative === "src/modules/registrations/repository.ts" ||
        relative.startsWith("src/modules/notifications/")
      );
    });
    expect(surfaces.length).toBeGreaterThan(5);
    for (const file of surfaces) {
      const source = readFileSync(file, "utf8");
      expect(source, path.relative(ROOT, file)).not.toMatch(/registration[_-]notes|registrationNotes|listRegistrationNotes|RegistrationNote\b/);
    }
  });
});
