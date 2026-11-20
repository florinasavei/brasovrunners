import { describe, expect, it } from "vitest";
import { registrationStatus } from "@/db/schema/registrations";
import {
  compareDeclarationRows,
  countRealDeclarations,
  DECLARATION_SECTION_KEYS,
  declarationNumberOf,
  declarationSearchOf,
  declarationSectionOf,
  declarationSections,
  matchesDeclarationSearch,
  type RaceDayDeclarationRow,
  signedByTwo,
} from "@/modules/race-day/domain/declarations";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — «Ziua cursei» → «Declarații», the pure half (`race-day/domain/declarations.ts`): the folds by state, confirmed first and
 * open; the order inside each — race numbers rising, then the rows without one by name, then by id —; the number as the desk shows
 * it; the search by a name blind to case and diacritics or by a race number; the counts, a test registration never in them; and who
 * signed — one hand, or a minor's two.
 */
let serial = 0;
function row(over: Partial<RaceDayDeclarationRow> = {}): RaceDayDeclarationRow {
  serial += 1;
  return {
    registrationId: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    status: "CONFIRMED",
    kind: "REAL",
    registeredName: `Runner ${serial}`,
    guardianName: null,
    bibNumber: null,
    acceptedAt: new Date("2026-11-14T16:00:00.000Z"),
    method: "EMAIL_LINK",
    typedName: `Runner ${serial}`,
    minorTypedName: null,
    declarationVersion: 3,
    textHash: null,
    recordedByName: null,
    ...over,
  };
}

describe("§NNN the folds by state", () => {
  it("puts the confirmed first, every live state not confirmed second, the cancelled and expired last", () => {
    expect([...DECLARATION_SECTION_KEYS]).toEqual(["confirmed", "unconfirmed", "voided"]);
    expect(Object.fromEntries(registrationStatus.enumValues.map((status) => [status, declarationSectionOf(status)]))).toEqual({
      PENDING_EMAIL_CONFIRMATION: "unconfirmed",
      PENDING_DECLARATION: "unconfirmed",
      WAITLISTED: "unconfirmed",
      WAITLIST_OFFERED: "unconfirmed",
      CONFIRMED: "confirmed",
      CANCELLED: "voided",
      EXPIRED: "voided",
    });
  });

  it("draws only the folds that hold somebody, the confirmed open on every arrival, the others closed — every one open under a search", () => {
    const rows = [row({ status: "CANCELLED", bibNumber: 9 }), row({ status: "CONFIRMED", bibNumber: 3 }), row({ status: "CONFIRMED", bibNumber: 1 })];
    const sections = declarationSections(rows, { searching: false });
    expect(sections.map((section) => [section.key, section.count, section.openWhen])).toEqual([
      ["confirmed", 2, { primary: true }],
      ["voided", 1, {}],
    ]);
    expect(declarationSections(rows, { searching: true }).map((section) => [section.key, section.openWhen])).toEqual([
      ["confirmed", { primary: true, inUse: true }],
      ["voided", { inUse: true }],
    ]);
    expect(declarationSections([], { searching: false })).toEqual([]);
  });

  it("counts the real registrations only: a test one is drawn in its fold and left out of its number and of the page's (§30)", () => {
    const rows = [row({ bibNumber: 1 }), row({ bibNumber: 2, kind: "TEST" }), row({ status: "WAITLISTED", kind: "TEST" })];
    const sections = declarationSections(rows, { searching: false });
    expect(sections.map((section) => [section.key, section.rows.length, section.count])).toEqual([
      ["confirmed", 2, 1],
      ["unconfirmed", 1, 0],
    ]);
    expect(countRealDeclarations(rows)).toBe(1);
  });

  it("names every fold in both catalogues, with its count", () => {
    for (const catalogue of [ro, en]) {
      for (const key of DECLARATION_SECTION_KEYS) expect(catalogue.Admin.raceDay.declarations.sections[key]).toMatch(/\{n\}/);
    }
  });
});

describe("§NNN the order inside a fold", () => {
  it("rises by race number, then the rows without one by name, then by id", () => {
    const ana = row({ registeredName: "Ana Pop", bibNumber: 27 });
    const bogdan = row({ registeredName: "Bogdan Ilie", bibNumber: 4 });
    const stefan = row({ registeredName: "Ștefan Vlad" });
    const sorin = row({ registeredName: "Sorin Matei" });
    const twin = row({ registeredName: "Sorin Matei" });
    const ordered = [ana, stefan, twin, bogdan, sorin].sort(compareDeclarationRows);
    expect(ordered.map((entry) => entry.registeredName)).toEqual(["Bogdan Ilie", "Ana Pop", "Sorin Matei", "Sorin Matei", "Ștefan Vlad"]);
    // The two of one name stand by their ids, whatever order they came in.
    expect(ordered.slice(2, 4).map((entry) => entry.registrationId)).toEqual([sorin.registrationId, twin.registrationId].sort());
    expect([twin, sorin].sort(compareDeclarationRows).map((entry) => entry.registrationId)).toEqual([sorin.registrationId, twin.registrationId].sort());
  });

  it("orders by the number the row shows, as the desk does: none before the confirmation, kept retired on a row that is over", () => {
    expect(declarationNumberOf({ status: "CONFIRMED", bibNumber: 12 })).toBe(12);
    expect(declarationNumberOf({ status: "CANCELLED", bibNumber: 12 })).toBe(12);
    expect(declarationNumberOf({ status: "EXPIRED", bibNumber: 12 })).toBe(12);
    // A restarted registration that kept its number from before shows none until it is confirmed again (§548).
    expect(declarationNumberOf({ status: "PENDING_DECLARATION", bibNumber: 12 })).toBeNull();
    const restarted = row({ status: "PENDING_DECLARATION", bibNumber: 2, registeredName: "Ana" });
    const waiting = row({ status: "WAITLISTED", registeredName: "Zoe" });
    const offered = row({ status: "WAITLIST_OFFERED", bibNumber: 1, registeredName: "Mara" });
    expect([waiting, restarted, offered].sort(compareDeclarationRows).map((entry) => entry.registeredName)).toEqual(["Ana", "Mara", "Zoe"]);
    const sections = declarationSections([row({ bibNumber: 30 }), row({ bibNumber: 5 }), row({ registeredName: "Aaron" })], { searching: false });
    expect(sections[0].rows.map((entry) => entry.bibNumber ?? entry.registeredName)).toEqual([5, 30, "Aaron"]);
  });
});

describe("§NNN the search", () => {
  it("reads one to five digits as a race number, anything else as part of a name, nothing as everybody", () => {
    expect(declarationSearchOf(undefined)).toEqual({ kind: "none" });
    expect(declarationSearchOf("")).toEqual({ kind: "none" });
    expect(declarationSearchOf("   ")).toEqual({ kind: "none" });
    expect(declarationSearchOf(["27"])).toEqual({ kind: "none" });
    expect(declarationSearchOf(" 27 ")).toEqual({ kind: "number", number: 27 });
    // «007» as the bib prints it (§735) is the number 7.
    expect(declarationSearchOf("007")).toEqual({ kind: "number", number: 7 });
    expect(declarationSearchOf("123456")).toEqual({ kind: "name", term: "123456" });
    expect(declarationSearchOf("Ștefan")).toEqual({ kind: "name", term: "stefan" });
  });

  it("finds a name blind to case and diacritics, and a number by the number the row shows", () => {
    const stefan = row({ registeredName: "Ștefan Tănase", bibNumber: 7 });
    const restarted = row({ registeredName: "Ion Pop", status: "PENDING_DECLARATION", bibNumber: 27 });
    const cancelled = row({ registeredName: "Eva Stan", status: "CANCELLED", bibNumber: 31 });
    const found = (q: string) => [stefan, restarted, cancelled].filter((entry) => matchesDeclarationSearch(entry, declarationSearchOf(q))).map((entry) => entry.registeredName);
    expect(found("stefan tanase")).toEqual(["Ștefan Tănase"]);
    expect(found("TĂNASE")).toEqual(["Ștefan Tănase"]);
    expect(found("pop")).toEqual(["Ion Pop"]);
    expect(found("7")).toEqual(["Ștefan Tănase"]);
    expect(found("007")).toEqual(["Ștefan Tănase"]);
    // The number a row does not show is not searched; a retired number is.
    expect(found("27")).toEqual([]);
    expect(found("31")).toEqual(["Eva Stan"]);
    expect(found("")).toEqual(["Ștefan Tănase", "Ion Pop", "Eva Stan"]);
    expect(found("nimeni")).toEqual([]);
  });
});

describe("§NNN who signed", () => {
  it("names two signers on a minor's declaration that carries the minor's own signature, one otherwise", () => {
    expect(signedByTwo({ guardianName: "Maria Pop", minorTypedName: "Ion Pop" })).toBe(true);
    // A minor's declaration from before two signatures were asked: the parent's alone.
    expect(signedByTwo({ guardianName: "Maria Pop", minorTypedName: null })).toBe(false);
    expect(signedByTwo({ guardianName: null, minorTypedName: null })).toBe(false);
  });
});
