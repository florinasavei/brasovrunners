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
    expect(csv).toBe("Event,Name,First name,Last name,Identity document,Email,Status,Club member (declared),Medically fit (declared),Strava,Instagram,Guardian,Guardian identity document,Submitted,Confirmed,Race number (BIB),Number settled,Checked in,Email bounced,Terms version,Terms accepted");

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
      "Test,Ana,Ana,Pop,BV 123456,ana@example.ro,CONFIRMED,Yes,,https://www.strava.com/athletes/12345,ana.pop,,,2026-09-04T10:00:00.000Z,,17,Yes,2026-10-11T06:40:00.000Z,Yes,,",
    );

    // No number yet is an empty cell, never 0 (BR-REQ-038-01).
    const other = buildRegistrationsCsv([row]);
    expect(other.split("\r\n")[1]).toBe(
      "Test,Ana,Ana,Pop,BV 123456,ana@example.ro,CONFIRMED,,,,,,,2026-09-04T10:00:00.000Z,,,,,,,",
    );
    expect(other).not.toContain("No");
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
    expect(columns.slice(-2)).toEqual(["Terms version", "Terms accepted"]);
    expect(accepted.split(",").slice(-2)).toEqual(["3", "2026-09-25T10:00:00.000Z"]);
    expect(staff.split(",").slice(-2)).toEqual(["", ""]);
    expect(older.split(",").slice(-2)).toEqual(["", ""]);
  });
});
