import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importsModule } from "../../helpers/module-imports";

/**
 * «Înscrierea la tombolă» (§984, BR-REQ-070-01, BR-REQ-060-01; the owner, 2026-11-18: «pentru tombolă trebuie să am o înscriere
 * separată»): who signed up for an event's raffle, the name they typed, their acceptance of «Regulamentul tombolei» with its trace
 * or its recorder — kept for the organizers alone. It reaches the doors that write it (the person's own link, the public form,
 * the desk, the organizers), the «Tombolă» tab, the lists' «Tombolă» column, the person's pages, the raffle's files, the sweep
 * that deletes it, the legal list's count of acceptances and «Toate datele unei persoane» (art. 15) — and nothing else. Never an
 * email, a public list, a badge, the public cache or a public page but the person's own «Gestionează înscrierea».
 *
 * The structural half of that promise, as `raffle-never-leaves.test.ts` holds the raffle's ticks: no file outside the list below
 * so much as names the table — as code or as the schema's SQL name — or its methods' enum, or imports the one writer
 * (`volunteers/raffle-entries.ts`) by any spelling (`tests/helpers/module-imports.ts`); and no surface that must never show a
 * sign-up calls one of the reads that return one. A new reader is a reviewed edit of this list. (What the doors write and who may
 * press them is `tests/integration/volunteers/raffle-sign-up.test.ts`; that no email leaves, the same file, on the outbox.)
 */
const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

/** The table as code and as the schema's SQL name, and its methods' enum. */
const NAMES_THE_ENTRIES = /\beventRaffleEntries\b|"event_raffle_entries"|\braffleEntryMethod\b|\bRaffleEntryMethod\b|"raffle_entry_method"/;
/** The one writer: every door's sign-up and withdrawal. */
const WRITER = path.join(SRC, "modules", "volunteers", "raffle-entries");
/** The roster's reads that return a sign-up — whether a person signed up, how and when. */
const ENTRY_READS = /\b(readRaffleRosterRows|readRaffleRoster|findRaffleEntry|readRaffleManageView|readRaffleManageCards|raffleReasonsFor|readRaffleLine|readRaffleDeskLines|signUpForRaffleBy\w+|signUpForRaffleAtDesk|withdrawFromRaffleByLink|deleteRaffleEntry|moveRaffleEntry)\b/;

const namesTheEntries = (file: string, source: string): boolean => NAMES_THE_ENTRIES.test(source) || importsModule(file, source, WRITER, SRC);

const READERS = new Set(
  [
    // The table.
    "src/db/schema/event-raffle-entries.ts",
    // The one writer — the four doors' sign-ups, the withdrawals, «Șterge înscrierea» — and the reads: the roster, a person's line, the manage card.
    "src/modules/volunteers/raffle-entries.ts",
    "src/modules/volunteers/raffle-roster.ts",
    // The doors' presses: the public form (FORM), the person's own link (LINK), the desk and the organizers (DESK, STAFF).
    "src/app/[locale]/events/[slug]/tombola/actions.ts",
    "src/app/[locale]/registrations/manage/[token]/actions.ts",
    "src/app/[locale]/admin/checkin/tombola/actions.ts",
    // «Transformă în voluntar» / «în alergător»: the person's sign-up moves to the row they become, in the transform's transaction.
    "src/modules/volunteers/transform.ts",
    // §NNN «Confirmă pentru tombolă»: «Cu înscriere separată» the volunteer is signed up by the organizers' own door (STAFF), in the
    // confirmation's transaction, through the one writer.
    "src/modules/volunteers/raffle-confirmation.ts",
    // The sweep: thirty days after the event's start.
    "src/modules/jobs/retention.ts",
    // «Toate datele unei persoane» (art. 15).
    "src/modules/registrations/person-data.ts",
    // `/admin/legal`'s count of the acceptances that rely on a version (a version somebody accepted is never deleted).
    "src/modules/legal-documents/repository.ts",
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

/** The surfaces that must never show a sign-up: every email, the public lists, the badges, the public cache and the public pages. */
function mustNeverShow(at: string): boolean {
  // The person's own «Gestionează înscrierea» is the LINK door: it reads that person's own sign-up, and nobody else's.
  if (at.startsWith("src/app/[locale]/registrations/manage/[token]/")) return false;
  // The public form's press writes a sign-up (FORM): its words are the form's, and it reads none back.
  if (at === "src/app/[locale]/events/[slug]/tombola/actions.ts") return false;
  return (
    (at.startsWith("src/app/[locale]/") && !at.startsWith("src/app/[locale]/admin/")) ||
    (at.startsWith("src/app/api/") && !at.startsWith("src/app/api/admin/")) ||
    at.startsWith("src/modules/notifications/") ||
    at.startsWith("src/modules/public-cache/") ||
    at.startsWith("src/modules/events/") ||
    at === "src/modules/volunteers/public-list.ts" ||
    at === "src/modules/volunteers/domain/public-list.ts" ||
    at.startsWith("src/modules/volunteers/badges/") ||
    at.startsWith("src/app/[locale]/admin/events/[id]/badges/") ||
    at.startsWith("src/app/api/admin/events/[id]/badges/")
  );
}

describe("§984 BR-REQ-070-01 the raffle's sign-ups stay with the organizers", () => {
  const files = sourceFiles(SRC);
  const naming = files.filter((file) => namesTheEntries(file, readFileSync(file, "utf8")));

  it("are named only by the files reviewed to read them", () => {
    const strangers = naming.filter((file) => !READERS.has(file)).map(relative);
    expect(strangers, "a new reader of the raffle's sign-ups must be a reviewed edit of this list").toEqual([]);
  });

  it("keep the list honest: every reader still names them", () => {
    const silent = [...READERS].filter((file) => !naming.includes(file)).map(relative);
    expect(silent).toEqual([]);
  });

  it("are in no email, on no public page or list, on no badge and in no public cache — not even through the roster's reads", () => {
    const surfaces = files.filter((file) => mustNeverShow(relative(file)));
    // The sweep found the surfaces it is about, each kind of them.
    expect(surfaces.length).toBeGreaterThan(60);
    for (const kind of [
      "src/app/[locale]/events/",
      "src/app/api/",
      "src/modules/notifications/",
      "src/modules/public-cache/",
      "src/modules/volunteers/public-list.ts",
      "src/modules/volunteers/badges/",
    ]) {
      expect(surfaces.some((file) => relative(file).startsWith(kind)), kind).toBe(true);
    }
    for (const file of surfaces) {
      const source = readFileSync(file, "utf8");
      expect(namesTheEntries(file, source), relative(file)).toBe(false);
      expect(ENTRY_READS.test(source), relative(file)).toBe(false);
    }
  });

  it("catches a reader by its names and by an import of the writer — by the alias or a relative path — and raises no false alarm", () => {
    const at = (...parts: string[]) => path.join(SRC, ...parts);
    for (const named of [`import { eventRaffleEntries } from "@/db/schema/event-raffle-entries";`, `pgTable("event_raffle_entries", {`, "method: RaffleEntryMethod", `pgEnum("raffle_entry_method", [])`]) {
      expect(NAMES_THE_ENTRIES.test(named), named).toBe(true);
    }
    // The writer, imported from an email's module by a relative path under another name: not a word of the table in the source.
    const borrowed = `import * as doors from "../volunteers/raffle-entries";\n\nexport const door = doors;\n`;
    expect(NAMES_THE_ENTRIES.test(borrowed)).toBe(false);
    expect(namesTheEntries(at("modules", "notifications", "render.ts"), borrowed)).toBe(true);
    expect(namesTheEntries(at("modules", "volunteers", "public-list.ts"), `import { deleteRaffleEntry } from "./raffle-entries";`)).toBe(true);
    expect(namesTheEntries(at("app", "[locale]", "page.tsx"), `import { signUpForRaffleByForm } from "@/modules/volunteers/raffle-entries";`)).toBe(true);
    // The roster's reads, by name.
    for (const read of ["await readRaffleRosterRows(db, id, now)", "raffleReasonsFor(db, id, {})", "readRaffleLine(db, ref, now)", "signUpForRaffleByStaff(db, actor, input, now)"]) {
      expect(ENTRY_READS.test(read), read).toBe(true);
    }
    // What only looks like one: the table in prose, a neighbour with a longer name, the rules' read, the settings' read.
    for (const other of ["// the `event_raffle_entries` rows", "eventRaffleEntriesCount", "readRaffleRules(db, id, settings, locale, now)", "cachedRaffleSignUpOpen(id, now)"]) {
      expect(NAMES_THE_ENTRIES.test(other) || ENTRY_READS.test(other), other).toBe(false);
    }
    expect(namesTheEntries(at("modules", "volunteers", "public-list.ts"), `import { x } from "./raffle-entries-words";`)).toBe(false);
  });
});
