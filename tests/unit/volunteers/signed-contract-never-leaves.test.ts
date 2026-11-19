import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «Contract semnat» (§998, BR-REQ-060-01) — a volunteer's signed agreement carries a signature and personal data, so it reaches only
 * the surfaces that carry it: the volunteer's card (its facts, the authenticated download, attach, replace, delete), the «Voluntari»
 * list (whether it is attached, the count, «Încarcă contractele semnate») and «Toate datele unei persoane» (its facts, art. 15).
 * Never the public pages, an email, a badge or the media bucket. The structural half of that promise: no file outside the list
 * below so much as imports the table or the service, so a later join cannot quietly start carrying a file; the table's bytes are
 * selected in the service alone, and nothing writes them to the storage adapter. (The behavioural half — the routes and the
 * screens — is `tests/integration/volunteers/signed-contract*.test.ts`.) A new reader is a reviewed edit of this list.
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

const READERS = new Set(
  [
    // The service, the one reader and writer of the table — its bytes included.
    "src/modules/volunteers/signed-contract.ts",
    // Its pure half (the formats, the limits, the name match), which reads the schema for the limit and the formats' names.
    "src/modules/volunteers/domain/signed-contract.ts",
    // The «Voluntari» list's filter and strip ask the service whether a copy exists — never its rows.
    "src/modules/volunteers/admin-list.ts",
    // The card, its words and the island's limit: the facts the page read, the limit and the formats — never a row.
    "src/modules/volunteers/ui/SignedContractCard.tsx",
    "src/modules/volunteers/ui/signed-contract-words.ts",
    // The volunteer's page, its «Șterge», and the «Voluntari» list (the chip's one read, the bulk upload).
    "src/app/[locale]/admin/volunteers/[id]/page.tsx",
    "src/app/[locale]/admin/volunteers/[id]/contract-actions.ts",
    "src/app/[locale]/admin/volunteers/(list)/page.tsx",
    // The two routes: the volunteer's download and upload, the event's «Încarcă contractele semnate».
    "src/app/api/admin/events/[id]/volunteers/[volunteerId]/signed-contract/route.ts",
    "src/app/api/admin/events/[id]/volunteers/signed-contracts/route.ts",
    // «Toate datele unei persoane» (art. 15): each offer's copy, its facts.
    "src/modules/registrations/person-data.ts",
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

/** What names the table, the service or its pure half: their paths, or a relative `./signed-contract`. */
const NAMES_CONTRACT = /["'](?:@\/db\/schema\/event-volunteer-documents|@\/modules\/volunteers\/signed-contract|@\/modules\/volunteers\/domain\/signed-contract|\.{1,2}\/(?:domain\/)?signed-contract)["']/;
const SCHEMA_FILE = path.join(SRC, "db", "schema", "event-volunteer-documents.ts");
/** The table's names wherever they would be spelled. */
const NAMES_TABLE = /event[_-]volunteer[_-]document|eventVolunteerDocument|signed[_-]?contract|SignedContract/i;

describe("§998 «Contract semnat» — who reads a volunteer's signed agreement", () => {
  const files = sourceFiles(SRC);

  it("is imported by no file but the service, its pure half, the list's reads, the card, the two pages, the two routes and the person's record", () => {
    const importers = files.filter((file) => file !== SCHEMA_FILE && NAMES_CONTRACT.test(readFileSync(file, "utf8")));
    const unexpected = importers.filter((file) => !READERS.has(file)).map(relative);
    expect(unexpected, "a new surface that reads a volunteer's signed agreement must be a reviewed edit of this list").toEqual([]);
    expect(importers.length).toBe(READERS.size);
  });

  it("is named by none of the public pages and routes, the emails, the badges, the volunteers' public list or the media bucket's adapter", () => {
    const surfaces = files.filter((file) => {
      const at = relative(file);
      return (
        (at.startsWith("src/app/[locale]/") && !at.startsWith("src/app/[locale]/admin/")) ||
        (at.startsWith("src/app/api/") && !at.startsWith("src/app/api/admin/")) ||
        at === "src/modules/volunteers/public-list.ts" ||
        at === "src/modules/volunteers/domain/public-list.ts" ||
        at === "src/modules/volunteers/offer.ts" ||
        at.startsWith("src/modules/notifications/") ||
        at.startsWith("src/modules/volunteers/badges/") ||
        at.startsWith("src/modules/media/") ||
        at.startsWith("src/infrastructure/")
      );
    });
    expect(surfaces.length).toBeGreaterThan(20);
    for (const file of surfaces) expect(readFileSync(file, "utf8"), relative(file)).not.toMatch(NAMES_TABLE);
  });

  it("selects the file's bytes in the service alone, which never hands them to the storage adapter", () => {
    const service = readFileSync(path.join(SRC, "modules", "volunteers", "signed-contract.ts"), "utf8");
    expect(service).not.toMatch(/modules\/media\/storage|getStorage|publicUrl/);
    for (const file of [...READERS].filter((reader) => !reader.endsWith(path.join("volunteers", "signed-contract.ts")))) {
      expect(readFileSync(file, "utf8"), relative(file)).not.toMatch(/eventVolunteerDocuments\.bytes|eventVolunteerDocumentUploads\.received/);
    }
  });

  it("is served by an authenticated route only: the session, the volunteers' role, an attachment, private and no-store", () => {
    const route = readFileSync(path.join(SRC, "app", "api", "admin", "events", "[id]", "volunteers", "[volunteerId]", "signed-contract", "route.ts"), "utf8");
    expect(route).toMatch(/requireStaff\(\)/);
    expect(route).toMatch(/canManageVolunteers\(actor\.role\)/);
    expect(route).toMatch(/contentDisposition\("attachment"/);
    expect(route).toMatch(/"Cache-Control": "private, no-store"/);
    expect(route).toMatch(/"X-Content-Type-Options": "nosniff"/);
  });
});
