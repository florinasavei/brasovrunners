import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «De la parteneri» (the decision «De la parteneri»; BR-REQ-060-01) — the partner's name is the organizers' own label, staff
 * only. It is read by the registrations list (its chip and its filter), the registration's page, the internal list, the
 * invitations, the registrations' Excel and CSV and «Toate datele unei persoane», and by nothing else: never a public page
 * (the participants' list, the results, «Cine vine»), never an email, never the race-day desk, never the file given to
 * sponsors («Descarcă lista pentru sponsori» — close words, another thing: that file holds people who agreed to offers), and
 * never the allocator or the capacity formula.
 *
 * The structural half of that promise, in the style of `notes-never-leave.test.ts`: the files that name the column — its
 * module, its three table columns, its words — are a reviewed list, and the surfaces above name none of it. (The behavioural
 * half — the email, the sponsors' file and the person's record — is `partner-mark.test.ts`.) The members' discount codes have
 * a `partnerName` of their own (`member-discount-codes.ts`), another column, shown in the members' zone; their files are the
 * other list below, and no surface checked here reads them either.
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

/** The label's own names: its module and form, its three columns, its words, and the bare property everywhere it travels. */
const NAMES_THE_LABEL = /[/.]partner-mark["']|PartnerMarkFields|\bpartnerName\b|partner_name|["'`]partner\.(?:tick|name|chip|filter|column)["'`]/;

/** The files that read or write it, each a reviewed edit. */
const READERS = new Set([
  // The schema (the three columns and their CHECK), the module, the form's fields.
  "src/db/schema/registrations.ts",
  "src/db/schema/event-reserve-entries.ts",
  "src/db/schema/event-invitations.ts",
  "src/modules/registrations/partner-mark.ts",
  "src/modules/registrations/ui/PartnerMarkFields.tsx",
  // The internal list: its add, its line's fold and the moves that carry it; the panel and the presses.
  "src/modules/registrations/reserve-list.ts",
  "src/modules/registrations/ui/ReserveListPanel.tsx",
  "src/app/[locale]/admin/registrations/reserve-actions.ts",
  // A line's moves write it through the vouched entry, in the move's transaction.
  "src/modules/registrations/admin-service.ts",
  // The invitations: the send stores it; the acceptance and the adoption write it; «Invitații» draws it.
  "src/modules/registrations/service.ts",
  "src/modules/registrations/invitations.ts",
  "src/modules/registrations/invitation-repository.ts",
  "src/modules/registrations/ui/InvitationsPanel.tsx",
  "src/modules/registrations/ui/InviteForm.tsx",
  "src/app/[locale]/admin/registrations/invitation-actions.ts",
  // The registrations list (the chip, the filter), its reader, the registration's page and its press.
  "src/modules/registrations/admin-repository.ts",
  "src/app/[locale]/admin/registrations/(list)/page.tsx",
  "src/app/[locale]/admin/registrations/[id]/page.tsx",
  "src/app/[locale]/admin/registrations/[id]/partner-actions.ts",
  // The registrations' Excel and CSV: the route and the two writers, handed the name, «Partener» before the notes.
  "src/app/api/admin/registrations/export/route.ts",
  "src/modules/registrations/csv.ts",
  "src/modules/registrations/workbook.ts",
  // «Toate datele unei persoane» (art. 15): the lines' and the invitations' names; the registrations carry every column.
  "src/modules/registrations/person-data.ts",
  "src/app/[locale]/admin/registrations/person/page.tsx",
]);

/** The members' discount codes' own `partnerName` (another column, the partner a code is from): not this label. */
const DISCOUNT_CODES = new Set([
  "src/db/schema/member-discount-codes.ts",
  "src/modules/content/member-codes/fields.ts",
  "src/modules/content/member-codes/repository.ts",
  "src/modules/content/member-codes/service.ts",
  "src/modules/content/member-codes/ui/MemberCodes.tsx",
  "src/app/[locale]/admin/pages/members/CodesCard.tsx",
  "src/app/[locale]/admin/pages/members/actions.ts",
  "src/app/[locale]/admin/pages/members/page.tsx",
]);

/** The surfaces the label never reaches. */
function isSurface(file: string): boolean {
  return (
    // Every public page and its routes: the participants' list, «Cine vine», the results, the members' zone, the forms.
    (file.startsWith("src/app/[locale]/") && !file.startsWith("src/app/[locale]/admin/") && !file.startsWith("src/app/[locale]/devs/")) ||
    (file.startsWith("src/app/api/") && file !== "src/app/api/admin/registrations/export/route.ts") ||
    file.startsWith("src/modules/results/") ||
    file.startsWith("src/modules/rsvp/") ||
    file.startsWith("src/modules/public-cache/") ||
    file.startsWith("src/modules/events/") ||
    file.startsWith("src/modules/home/") ||
    file.startsWith("src/modules/registrations/domain/") ||
    // Every email: the outbox, its templates, its render, the providers.
    file.startsWith("src/modules/notifications/") ||
    file.startsWith("src/infrastructure/email/") ||
    // The race-day desk.
    file.startsWith("src/app/[locale]/admin/checkin/") ||
    file === "src/modules/registrations/ui/DeskRow.tsx" ||
    // The file given to sponsors and its register: «Descarcă lista pentru sponsori».
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

describe("«De la parteneri» reaches only the backoffice's own screens and files", () => {
  const files = sourceFiles(SRC)
    .map(rel)
    .filter((file) => !file.startsWith("src/db/migrations/"));
  const naming = files.filter((file) => NAMES_THE_LABEL.test(readFileSync(path.join(ROOT, file), "utf8")));

  it("is named by no file but the reviewed readers (and the discount codes' own column of the same name)", () => {
    const unexpected = naming.filter((file) => !READERS.has(file) && !DISCOUNT_CODES.has(file));
    expect(unexpected, "a new surface that reads the partner's name must be a reviewed edit of this list").toEqual([]);
    // …and every reader on the list still reads it: the list does not outlive its readers.
    for (const reader of READERS) expect(naming, reader).toContain(reader);
  });

  it("is named by no public page, no email, no desk, no sponsors' file and no allocator file", () => {
    const surfaces = files.filter(isSurface);
    expect(surfaces.length).toBeGreaterThan(50);
    for (const file of surfaces) {
      expect(READERS.has(file), file).toBe(false);
      const source = readFileSync(path.join(ROOT, file), "utf8");
      // Not even the discount codes' column of the same name: a surface here reads no `partnerName` at all.
      if (!DISCOUNT_CODES.has(file)) expect(source, file).not.toMatch(NAMES_THE_LABEL);
    }
  });

  it("is read by none of the desk's queries in the registrations reader", () => {
    for (const name of ["deskQuery", "listDeskRegistrations", "countDesk", "findRegistrationByCheckinCode"]) {
      expect(functionText("src/modules/registrations/admin-repository.ts", name), name).not.toMatch(NAMES_THE_LABEL);
    }
  });

  it("is in no condition of the allocator or the capacity formula", () => {
    for (const name of ["allocateOrWaitlist", "fillAvailableSpots", "placeForNewcomer", "seatInvitedRegistration"]) {
      expect(functionText("src/modules/registrations/service.ts", name), name).not.toMatch(NAMES_THE_LABEL);
    }
    for (const file of ["src/modules/registrations/domain/capacity.ts", "src/modules/registrations/domain/family.ts", "src/modules/registrations/repository.ts", "src/modules/registrations/domain/state-machine.ts"]) {
      expect(readFileSync(path.join(ROOT, file), "utf8"), file).not.toMatch(NAMES_THE_LABEL);
    }
  });

  it("is in the export only as a column every role that gets the file gets, never behind the notes' rule", () => {
    const route = readFileSync(path.join(ROOT, "src/app/api/admin/registrations/export/route.ts"), "utf8");
    expect(route.match(/partnerName: row\.partnerName/g)).toHaveLength(2);
    expect(route).toMatch(/partnerHeader = \(await getTranslations\(\{ locale, namespace: "Admin" \}\)\)\("partner\.column"\)/);
  });
});
