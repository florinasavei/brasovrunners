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
    expect(csv).toBe("Event,Name,First name,Last name,Identity document,Email,Status,Club member (declared),Medically fit (declared),Strava,Instagram,Guardian,Submitted,Confirmed,Race number (BIB),Number settled,Checked in,Email bounced");

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
      "Test,Ana,Ana,Pop,BV 123456,ana@example.ro,CONFIRMED,Yes,,https://www.strava.com/athletes/12345,ana.pop,,2026-09-04T10:00:00.000Z,,17,Yes,2026-10-11T06:40:00.000Z,Yes",
    );

    // No number yet is an empty cell, never 0 (BR-REQ-038-01).
    const other = buildRegistrationsCsv([row]);
    expect(other.split("\r\n")[1]).toBe(
      "Test,Ana,Ana,Pop,BV 123456,ana@example.ro,CONFIRMED,,,,,,2026-09-04T10:00:00.000Z,,,,,",
    );
    expect(other).not.toContain("No");
  });
});
