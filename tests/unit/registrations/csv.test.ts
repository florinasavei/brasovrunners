import { describe, expect, it } from "vitest";
import { buildRegistrationsCsv, neutralizeCsvValue } from "@/modules/registrations/csv";

/** AGENTS.md §15.10 — CSV export neutralizes formula-triggering characters. */
describe("CSV formula neutralization", () => {
  it.each(["=SUM(A1:A9)", "+1+1", "-2+3", "@SUM(1,2)"])(
    "prefixes a value starting with %s so a spreadsheet reads it as text",
    (value) => {
      expect(neutralizeCsvValue(value)).toBe(`'${value}`);
    },
  );

  it("leaves an ordinary value untouched", () => {
    expect(neutralizeCsvValue("Ana Pop")).toBe("Ana Pop");
    expect(neutralizeCsvValue("ana@example.ro")).toBe("ana@example.ro");
  });

  it("quotes a cell containing a comma, quote, or newline", () => {
    const csv = buildRegistrationsCsv([
      {
        eventTitle: "Crosul, aniversar",
        registeredName: 'Ana "Speedy" Pop',
        firstName: "Ana",
        lastName: 'Pop',
        idDocument: "",
        email: "ana@example.ro",
        status: "CONFIRMED",
        clubMemberDeclared: false,
        fitnessDeclaredAt: null,
        stravaUrl: "",
        instagramHandle: "",
        guardianName: "",
        guardianIdDocument: "",
        submittedAt: "2026-09-04T10:00:00.000Z",
        confirmedAt: "",
        checkedInAt: "",
        emailBounced: false,
      },
    ]);

    expect(csv).toContain('"Crosul, aniversar"');
    expect(csv).toContain('"Ana ""Speedy"" Pop"');
  });

  it("neutralizes a formula-shaped registered name in the full CSV output", () => {
    const csv = buildRegistrationsCsv([
      {
        eventTitle: "Test",
        registeredName: "=cmd|'/c calc'!A1",
        firstName: "",
        lastName: "",
        idDocument: "",
        email: "ana@example.ro",
        status: "CONFIRMED",
        clubMemberDeclared: false,
        fitnessDeclaredAt: null,
        stravaUrl: "",
        instagramHandle: "",
        guardianName: "",
        guardianIdDocument: "",
        submittedAt: "2026-09-04T10:00:00.000Z",
        confirmedAt: "",
        checkedInAt: "",
        emailBounced: false,
      },
    ]);

    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/,=cmd/);
  });

  it("includes the header row and uses CRLF line endings", () => {
    const csv = buildRegistrationsCsv([]);
    expect(csv).toBe("Event,Name,First name,Last name,Identity document,Email,Status,Club member (declared),Medically fit (declared),Strava,Instagram,Socials on the public list,Public list & results,Guardian,Guardian identity document,Submitted,Confirmed,Race number (BIB),Checked in,Email bounced,Terms version,Terms accepted,Declaration version,Declaration signed,family,Cancellation reason,Offers and benefits,Hidden list");

    const withRow = buildRegistrationsCsv([
      {
        eventTitle: "Test",
        registeredName: "Ana",
        firstName: "",
        lastName: "",
        idDocument: "",
        email: "ana@example.ro",
        status: "CONFIRMED",
        clubMemberDeclared: false,
        fitnessDeclaredAt: null,
        stravaUrl: "",
        instagramHandle: "",
        guardianName: "",
        guardianIdDocument: "",
        submittedAt: "2026-09-04T10:00:00.000Z",
        confirmedAt: "",
        checkedInAt: "",
        emailBounced: false,
      },
    ]);
    expect(withRow.split("\r\n")).toHaveLength(2);
  });

  /**
   * BR-REQ-031-06. The column is a claim, so it prints "Yes" or nothing at all.
   *
   * Printing "No" would turn "never opened the optional section" into "said they are not a
   * member" — the same stored `false`, two different meanings, and the volunteer reading this
   * file at a start line cannot tell them apart. A blank cell is the honest rendering of both.
   */
  it("prints a declared membership as Yes and everything else as an empty cell", () => {
    const row = {
      eventTitle: "Test",
      registeredName: "Ana",
      firstName: "Ana",
      lastName: "Pop",
      idDocument: "BV 123456",
      email: "ana@example.ro",
      status: "CONFIRMED",
      clubMemberDeclared: false,
      fitnessDeclaredAt: null,
      stravaUrl: "",
      instagramHandle: "",
      guardianName: "",
      guardianIdDocument: "",
      submittedAt: "2026-09-04T10:00:00.000Z",
      confirmedAt: "",
      checkedInAt: "",
      emailBounced: false,
    };

    const member = buildRegistrationsCsv([
      { ...row, clubMemberDeclared: true, stravaUrl: "https://www.strava.com/athletes/12345", instagramHandle: "ana.pop", bibNumber: 17, checkedInAt: "2026-10-11T06:40:00.000Z", emailBounced: true },
    ]);
    // Race day and the provider's verdict as the last two columns (§83): a time, and Yes or empty.
    expect(member.split("\r\n")[1]).toBe(
      "Test,Ana,Ana,Pop,BV 123456,ana@example.ro,CONFIRMED,Yes,,https://www.strava.com/athletes/12345,ana.pop,,,,,2026-09-04T10:00:00.000Z,,17,2026-10-11T06:40:00.000Z,Yes,,,,,,,,",
    );

    // No number yet is an empty cell, never 0 (BR-REQ-038-01).
    const other = buildRegistrationsCsv([row]);
    expect(other.split("\r\n")[1]).toBe(
      "Test,Ana,Ana,Pop,BV 123456,ana@example.ro,CONFIRMED,,,,,,,,,2026-09-04T10:00:00.000Z,,,,,,,,,,,,",
    );
    expect(other).not.toContain("No");

    // Not confirmed yet: an empty cell, whatever the row holds (§548) — the number comes with the confirmation.
    const pending = buildRegistrationsCsv([{ ...row, status: "PENDING_DECLARATION", bibNumber: 17 }]);
    expect(pending.split("\r\n")[1]).toBe(
      "Test,Ana,Ana,Pop,BV 123456,ana@example.ro,PENDING_DECLARATION,,,,,,,,,2026-09-04T10:00:00.000Z,,,,,,,,,,,,",
    );
  });

  /**
   * §330 — a minor's declaration carries two identity documents: the minor's own in the
   * participant's column, and the parent's beside the parent's name, where the kit goes (§108).
   */
  it("carries a minor's document and the parent's, each in its own column", () => {
    const csv = buildRegistrationsCsv([
      {
        eventTitle: "Test",
        registeredName: "Maria Pop",
        firstName: "Maria",
        lastName: "Pop",
        idDocument: "Carte de identitate MP 654321",
        email: "maria@example.ro",
        status: "CONFIRMED",
        clubMemberDeclared: false,
        fitnessDeclaredAt: null,
        stravaUrl: "",
        instagramHandle: "",
        guardianName: "Ion Pop",
        guardianIdDocument: "Carte de identitate BV 123456",
        submittedAt: "2026-09-04T10:00:00.000Z",
        confirmedAt: "",
        checkedInAt: "",
        emailBounced: false,
      },
    ]);
    const [header, line] = csv.split("\r\n");
    const cells = line.split(",");
    const at = (name: string) => cells[header.split(",").indexOf(name)];
    expect(at("Identity document")).toBe("Carte de identitate MP 654321");
    expect(at("Guardian")).toBe("Ion Pop");
    expect(at("Guardian identity document")).toBe("Carte de identitate BV 123456");
  });

  /**
   * §425 — the club's terms accepted expressly on the form (§421): the version and the moment, as
   * the last two columns, so every earlier column keeps its position for a script. A staff or desk
   * entry, and a row sent before the version was recorded, carry two empty cells — never 0.
   */
  it("carries the accepted terms version and moment as the last two columns, blank when none was recorded", () => {
    const base = {
      eventTitle: "Test",
      registeredName: "Ana",
      firstName: "Ana",
      lastName: "Pop",
      idDocument: "",
      email: "ana@example.ro",
      status: "CONFIRMED",
      clubMemberDeclared: false,
      fitnessDeclaredAt: null,
      stravaUrl: "",
      instagramHandle: "",
      guardianName: "",
      guardianIdDocument: "",
      submittedAt: "2026-09-25T10:00:00.000Z",
      confirmedAt: "",
      checkedInAt: "",
      emailBounced: false,
    };
    const csv = buildRegistrationsCsv([
      { ...base, termsVersion: 3, termsAcceptedAt: "2026-09-25T10:00:00.000Z" },
      { ...base, termsVersion: null, termsAcceptedAt: "" },
      base,
    ]);
    const [header, accepted, staff, older] = csv.split("\r\n");
    const columns = header.split(",");
    // §425's two, now followed by the declaration's two (§499), the family column (§543), the cancellation reason (§558) and the offers and benefits (§562).
    expect(columns.slice(-8, -6)).toEqual(["Terms version", "Terms accepted"]);
    expect(accepted.split(",").slice(-8, -6)).toEqual(["3", "2026-09-25T10:00:00.000Z"]);
    expect(staff.split(",").slice(-8, -6)).toEqual(["", ""]);
    expect(older.split(",").slice(-8, -6)).toEqual(["", ""]);
  });

  /**
   * §499 — which declaration version the registration signed, and when, as the last two columns,
   * after the terms: blank while nothing is signed, never 0. A paper acceptance recorded at the
   * desk has a version too, so a staff entry's cells are filled like anybody's.
   */
  it("carries the signed declaration's version and moment as the last two columns, blank while none is signed", () => {
    const base = {
      eventTitle: "Test",
      registeredName: "Ana",
      firstName: "Ana",
      lastName: "Pop",
      idDocument: "",
      email: "ana@example.ro",
      status: "CONFIRMED",
      clubMemberDeclared: false,
      fitnessDeclaredAt: null,
      stravaUrl: "",
      instagramHandle: "",
      guardianName: "",
      guardianIdDocument: "",
      submittedAt: "2026-09-25T10:00:00.000Z",
      confirmedAt: "",
      checkedInAt: "",
      emailBounced: false,
    };
    const csv = buildRegistrationsCsv([
      { ...base, termsVersion: 3, termsAcceptedAt: "2026-09-25T10:00:00.000Z", declarationVersion: 2, declarationSignedAt: "2026-09-26T08:30:00.000Z" },
      { ...base, declarationVersion: null, declarationSignedAt: "" },
      base,
    ]);
    const [header, signed, unsigned, older] = csv.split("\r\n");
    // Before the family column (§543), the cancellation reason (§558) and the offers and benefits (§562), which is last.
    expect(header.split(",").slice(-6, -4)).toEqual(["Declaration version", "Declaration signed"]);
    expect(signed.split(",").slice(-8, -4)).toEqual(["3", "2026-09-25T10:00:00.000Z", "2", "2026-09-26T08:30:00.000Z"]);
    expect(unsigned.split(",").slice(-6, -4)).toEqual(["", ""]);
    expect(older.split(",").slice(-6, -4)).toEqual(["", ""]);
  });

  // §500 — whether the public list prints the socials: right after Instagram, as on the spreadsheet, "Yes" or empty.
  it("says beside Instagram whether the public list prints the socials, Yes or empty", () => {
    const base = {
      eventTitle: "Test",
      registeredName: "Ana Pop",
      firstName: "Ana",
      lastName: "Pop",
      idDocument: "",
      email: "ana@example.ro",
      status: "CONFIRMED",
      clubMemberDeclared: false,
      fitnessDeclaredAt: null,
      stravaUrl: "https://www.strava.com/athletes/12345",
      instagramHandle: "ana.pop",
      guardianName: "",
      guardianIdDocument: "",
      submittedAt: "2026-09-25T10:00:00.000Z",
      confirmedAt: "",
      checkedInAt: "",
      emailBounced: false,
    };
    const [header, shown, kept, older] = buildRegistrationsCsv([{ ...base, listSocials: true }, { ...base, listSocials: false }, base]).split("\r\n");
    const at = header.split(",").indexOf("Instagram") + 1;
    expect(header.split(",")[at]).toBe("Socials on the public list");
    expect(shown.split(",").slice(at - 1, at + 1)).toEqual(["ana.pop", "Yes"]);
    expect(kept.split(",")[at]).toBe("");
    expect(older.split(",")[at]).toBe("");
    // §581 — the public-list tick itself, right after the socials it governs: "Yes" or empty, like them.
    expect(header.split(",")[at + 1]).toBe("Public list & results");
    const [, listed, unlisted] = buildRegistrationsCsv([{ ...base, listPublic: true }, { ...base, listPublic: false }]).split("\r\n");
    expect(listed.split(",")[at + 1]).toBe("Yes");
    expect(unlisted.split(",")[at + 1]).toBe("");
    // The declaration's pair stays after the terms (§499), then the family column (§543), the cancellation reason (§558) and the offers and benefits, last (§562).
    expect(header.split(",").slice(-6)).toEqual(["Declaration version", "Declaration signed", "family", "Cancellation reason", "Offers and benefits", "Hidden list"]);
  });

  // §543 — the family marker in the export: the other people on the same address at the event, last, «; »-joined.
  it("ends with the family column: the other people on the address, or an empty cell", () => {
    const base = {
      eventTitle: "Test",
      registeredName: "Ana Pop",
      firstName: "Ana",
      lastName: "Pop",
      idDocument: "",
      email: "familia.pop@example.ro",
      status: "PENDING_EMAIL_CONFIRMATION",
      clubMemberDeclared: false,
      fitnessDeclaredAt: null,
      stravaUrl: "",
      instagramHandle: "",
      guardianName: "",
      guardianIdDocument: "",
      submittedAt: "2026-09-25T10:00:00.000Z",
      confirmedAt: "",
      checkedInAt: "",
      emailBounced: false,
    };
    const [header, family, alone] = buildRegistrationsCsv([{ ...base, family: "Mihai Pop; Ioana Pop" }, base]).split("\r\n");
    // Just before the cancellation reason (§558) and the offers and benefits, which came last with §562.
    expect(header.split(",").at(-4)).toBe("family");
    expect(family.split(",").at(-4)).toBe("Mihai Pop; Ioana Pop");
    expect(alone.split(",").at(-4)).toBe("");
  });
});
