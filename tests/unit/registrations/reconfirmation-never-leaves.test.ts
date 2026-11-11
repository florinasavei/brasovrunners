import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «Cere reconfirmarea» (the decision «Cere reconfirmarea»; BR-REQ-036-01, BR-REQ-060-01) — who said «Vin» is the
 * organizers' information, never a disclosure and never a rule. It is written by the send and by the person's own manage
 * page, and read by the backoffice: the registrations list (its chip and its filter), the registration's page,
 * «Mesaje trimise», the registrations' Excel and CSV and «Toate datele unei persoane». Never by another public page (the
 * participants' list, the results, «Cine vine»), never by the email's renderer (which reads only the send's flag), never
 * by the race-day desk, never by the file given to sponsors, and never by the allocator or the capacity formula —
 * answering is optional, so nothing may decide by the answer.
 *
 * The structural half of that promise, in the style of `partner-never-leaves.test.ts`: the files that name the table,
 * its columns or its module are a reviewed list, and the surfaces below name none of it. (The behavioural half is
 * `tests/integration/registrations/reconfirmation.test.ts`.) `askReconfirm` and `reconfirmUrl` — the send's flag and
 * the email's link — are not the answer, and the pattern matches neither.
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

/** The answer's own names: its table and columns, the bare property everywhere it travels, its module. */
const NAMES_THE_ANSWER = /registration_reconfirmations|registrationReconfirmations|\breconfirmedAt\b|reconfirmed_at|[/.]reconfirmation["']/;

/** The files that read or write it, each a reviewed edit. */
const READERS = new Set([
  // The table, the module that records the answer, and the send that writes the asks and reads the history's numbers.
  "src/db/schema/registration-reconfirmations.ts",
  "src/modules/registrations/reconfirmation.ts",
  "src/modules/notifications/participant-messages.ts",
  // The person's own manage page: its people, the question, and the press.
  "src/modules/registrations/manage-family.ts",
  "src/app/[locale]/registrations/manage/[token]/page.tsx",
  "src/app/[locale]/registrations/manage/[token]/actions.ts",
  // The registrations list (the chip, the filter), its reader, and the registration's page.
  "src/modules/registrations/admin-repository.ts",
  "src/app/[locale]/admin/registrations/(list)/page.tsx",
  "src/app/[locale]/admin/registrations/[id]/page.tsx",
  // The registrations' Excel and CSV: the route and the two writers, «Reconfirmat» after «Partener».
  "src/app/api/admin/registrations/export/route.ts",
  "src/modules/registrations/csv.ts",
  "src/modules/registrations/workbook.ts",
  // «Toate datele unei persoane» (art. 15).
  "src/modules/registrations/person-data.ts",
  "src/app/[locale]/admin/registrations/person/page.tsx",
]);

/** The surfaces the answer never reaches. */
function isSurface(file: string): boolean {
  return (
    // Every public page and its routes, but the person's own manage page: the participants' list, «Cine vine», the results.
    (file.startsWith("src/app/[locale]/") &&
      !file.startsWith("src/app/[locale]/admin/") &&
      !file.startsWith("src/app/[locale]/devs/") &&
      !file.startsWith("src/app/[locale]/registrations/manage/")) ||
    (file.startsWith("src/app/api/") && file !== "src/app/api/admin/registrations/export/route.ts") ||
    file.startsWith("src/modules/results/") ||
    file.startsWith("src/modules/rsvp/") ||
    file.startsWith("src/modules/public-cache/") ||
    file.startsWith("src/modules/events/") ||
    file.startsWith("src/modules/home/") ||
    file.startsWith("src/modules/registrations/domain/") ||
    // Every email: the outbox, its templates, its render, the providers — the send itself is a reader above.
    (file.startsWith("src/modules/notifications/") && file !== "src/modules/notifications/participant-messages.ts") ||
    file.startsWith("src/infrastructure/email/") ||
    // The race-day desk.
    file.startsWith("src/app/[locale]/admin/checkin/") ||
    file === "src/modules/registrations/ui/DeskRow.tsx" ||
    // The file given to sponsors and its register.
    file === "src/modules/registrations/sponsor-list.ts" ||
    file === "src/modules/registrations/sponsor-sheet.ts" ||
    file === "src/modules/registrations/sponsor-register.ts" ||
    file === "src/modules/registrations/ui/SponsorListButton.tsx" ||
    // The allocator's own reads and writes, and the public form's door.
    file === "src/modules/registrations/repository.ts" ||
    file === "src/modules/registrations/form-view.ts" ||
    file === "src/modules/registrations/fields.ts"
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

describe("«Cere reconfirmarea»'s answer reaches only the backoffice and the person's own page", () => {
  const files = sourceFiles(SRC)
    .map(rel)
    .filter((file) => !file.startsWith("src/db/migrations/"));
  const naming = files.filter((file) => NAMES_THE_ANSWER.test(readFileSync(path.join(ROOT, file), "utf8")));

  it("is named by no file but the reviewed readers", () => {
    const unexpected = naming.filter((file) => !READERS.has(file));
    expect(unexpected, "a new surface that reads who said «Vin» must be a reviewed edit of this list").toEqual([]);
    // …and every reader on the list still reads it: the list does not outlive its readers.
    for (const reader of READERS) expect(naming, reader).toContain(reader);
  });

  it("is named by no public page, no email, no desk, no sponsors' file and no allocator file", () => {
    const surfaces = files.filter(isSurface);
    expect(surfaces.length).toBeGreaterThan(50);
    for (const file of surfaces) {
      expect(READERS.has(file), file).toBe(false);
      expect(readFileSync(path.join(ROOT, file), "utf8"), file).not.toMatch(NAMES_THE_ANSWER);
    }
  });

  it("is read by none of the desk's queries in the registrations reader", () => {
    for (const name of ["deskQuery", "listDeskRegistrations", "countDesk", "findRegistrationByCheckinCode"]) {
      expect(functionText("src/modules/registrations/admin-repository.ts", name), name).not.toMatch(NAMES_THE_ANSWER);
    }
  });

  it("is in no condition of the allocator, the capacity formula, a deadline or a state", () => {
    for (const name of ["allocateOrWaitlist", "fillAvailableSpots", "placeForNewcomer", "seatInvitedRegistration"]) {
      expect(functionText("src/modules/registrations/service.ts", name), name).not.toMatch(NAMES_THE_ANSWER);
    }
    for (const file of [
      "src/modules/registrations/service.ts",
      "src/modules/registrations/maintenance.ts",
      "src/modules/registrations/domain/capacity.ts",
      "src/modules/registrations/domain/family.ts",
      "src/modules/registrations/repository.ts",
      "src/modules/registrations/domain/state-machine.ts",
    ]) {
      expect(readFileSync(path.join(ROOT, file), "utf8"), file).not.toMatch(NAMES_THE_ANSWER);
    }
  });

  it("is in the export only as a column every role that gets the file gets, never behind the notes' rule", () => {
    const route = readFileSync(path.join(ROOT, "src/app/api/admin/registrations/export/route.ts"), "utf8");
    expect(route.match(/reconfirmedAt: row\.reconfirmedAt/g)).toHaveLength(2);
    expect(route).toMatch(/reconfirmedHeader = \(await getTranslations\(\{ locale, namespace: "Admin" \}\)\)\("reconfirm\.column"\)/);
  });

  it("reaches the email only as the send's flag and the link, never the answer", () => {
    for (const file of ["src/modules/notifications/render.ts", "src/modules/notifications/templates.ts"]) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source, file).toMatch(/reconfirmUrl/);
      expect(source, file).not.toMatch(NAMES_THE_ANSWER);
    }
  });
});
