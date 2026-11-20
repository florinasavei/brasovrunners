import { describe, expect, it } from "vitest";
import { compareRaffleRows, raffleNumberText, type RaffleKind } from "@/modules/volunteers/domain/raffle";
import { formatVolunteerNumber, VOLUNTEER_NUMBER_DIGITS, VOLUNTEER_NUMBER_PREFIX, volunteerNumberFrom, volunteerNumberText } from "@/modules/volunteers/domain/volunteer-number";
import { buildRaffleRandomOrgText, raffleCsvFileName, raffleRandomOrgFileName, type RaffleRow, raffleWithoutNumber } from "@/modules/volunteers/raffle-list";

/**
 * §1023, amending §948 (the owner, 2026-11-20: «vreau sa le dai numar de voluntar V001 V002 la toti voluntarii automat!») — the V
 * number as people read and type it, the raffle's order with two series in it, and «Descarcă pentru random.org»'s text, pure.
 * BR-REQ-050-02 and BR-REQ-071-01.
 */
describe("§1023 BR-REQ-050-02 a volunteer's number is written «V» and three digits at least", () => {
  it.each([
    [1, "V001"],
    [7, "V007"],
    [10, "V010"],
    [12, "V012"],
    [99, "V099"],
    [123, "V123"],
    [999, "V999"],
    [1000, "V1000"],
    [12345, "V12345"],
  ])("%i is %s", (number, written) => {
    expect(formatVolunteerNumber(number)).toBe(written);
  });

  it("is the one letter and three digits, and says nothing for a person who has none", () => {
    expect(VOLUNTEER_NUMBER_PREFIX).toBe("V");
    expect(VOLUNTEER_NUMBER_DIGITS).toBe(3);
    expect(volunteerNumberText(null)).toBeNull();
    expect(volunteerNumberText(undefined)).toBeNull();
    expect(volunteerNumberText(42)).toBe("V042");
  });

  it("reads what somebody types for a volunteer's number — the «V» optional, any case, zeros in front — and nothing else", () => {
    for (const [typed, number] of [
      ["V007", 7],
      ["v7", 7],
      [" V 7 ", 7],
      ["007", 7],
      ["7", 7],
      ["V1000", 1000],
      ["V99999", 99_999],
    ] as const) {
      expect(volunteerNumberFrom(typed), typed).toBe(number);
    }
    for (const refused of ["", "V", "V0", "0", "000", "VV7", "X7", "7V", "-7", "+7", "7.5", "V-7", "123456", "V 1 2", "١٢"]) expect(volunteerNumberFrom(refused), refused).toBeNull();
  });
});

describe("§1023 BR-REQ-071-01 the raffle with two series: the race numbers, then the V numbers", () => {
  const row = (number: number | null, name: string, kind: RaffleKind) => ({ number, name, kind });

  it("orders runners and elites together by their race number, then the volunteers by their V number, then whoever has none, by name", () => {
    const rows = [
      row(2, "Oana", "VOLUNTEER"),
      row(null, "Zoe Elita", "ELITE"),
      row(150, "Radu", "RUNNER"),
      row(1, "Ion", "VOLUNTEER"),
      row(7, "Eliud", "ELITE"),
      row(1, "Ana", "RUNNER"),
      row(10, "Dan", "VOLUNTEER"),
      row(null, "Ana Elita", "ELITE"),
    ];
    expect([...rows].sort(compareRaffleRows).map((one) => raffleNumberText(one, "plain") ?? `— ${one.name}`)).toEqual(["1", "7", "150", "V001", "V002", "V010", "— Ana Elita", "— Zoe Elita"]);
  });

  it("writes a race number as the event writes it (§735) and a V number always the same way", () => {
    expect(raffleNumberText(row(7, "Ana", "RUNNER"), "plain")).toBe("7");
    expect(raffleNumberText(row(7, "Ana", "RUNNER"), "pad3")).toBe("007");
    expect(raffleNumberText(row(7, "Eliud", "ELITE"), "pad4")).toBe("0007");
    expect(raffleNumberText(row(7, "Ion", "VOLUNTEER"), "pad4")).toBe("V007");
    expect(raffleNumberText(row(7, "Ion", "VOLUNTEER"), null)).toBe("V007");
    expect(raffleNumberText(row(null, "Zoe Elita", "ELITE"), "pad3")).toBeNull();
  });
});

describe("§1023 BR-REQ-071-01 «Descarcă pentru random.org»: one person per line, the number and the name, nothing else", () => {
  const raffleRow = (number: number | null, label: string | null, name: string, kind: RaffleKind, present = false): RaffleRow => ({ number, label, name, kind, present });

  it("is one line per participant, each the number as the raffle writes it, a space, the name and CRLF — no header, no blank line, no BOM", () => {
    const rows = [raffleRow(1, "1", "Ana Pop", "RUNNER"), raffleRow(7, "7", "Eliud K.", "ELITE"), raffleRow(1, "V001", "Ion Lupu", "VOLUNTEER", true), raffleRow(2, "V002", "Oana", "VOLUNTEER")];
    const text = buildRaffleRandomOrgText(rows);
    expect(text).toBe("1 Ana Pop\r\n7 Eliud K.\r\nV001 Ion Lupu\r\nV002 Oana\r\n");
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text).not.toMatch(/\r\n\r\n|^\r\n/);
    // A name on one line, its spaces folded: a stray line break would make two entries.
    expect(buildRaffleRandomOrgText([raffleRow(4, "4", " Maria\n  Pop ", "RUNNER")])).toBe("4 Maria Pop\r\n");
    // The order is the rows' own: the caller hands them in the raffle's order.
    expect(buildRaffleRandomOrgText([...rows].reverse())).toBe("V002 Oana\r\nV001 Ion Lupu\r\n7 Eliud K.\r\n1 Ana Pop\r\n");
  });

  it("leaves out a participant who has no number to write, and is empty — not one blank line — for nobody", () => {
    const rows = [raffleRow(null, null, "Ingrid Pop", "ELITE"), raffleRow(3, "003", "Ana Pop", "RUNNER"), raffleRow(null, "", "Nobody", "ELITE")];
    expect(buildRaffleRandomOrgText(rows)).toBe("003 Ana Pop\r\n");
    expect(raffleWithoutNumber(rows)).toBe(2);
    expect(buildRaffleRandomOrgText([])).toBe("");
    expect(raffleWithoutNumber([])).toBe(0);
  });

  it("names the files for both scopes, the CSV's as before", () => {
    expect(raffleCsvFileName("2026-11-21")).toBe("tombola-2026-11-21.csv");
    expect(raffleCsvFileName("2026-11-21", { onlyPresent: true })).toBe("tombola-prezenti-2026-11-21.csv");
    expect(raffleRandomOrgFileName("2026-11-21")).toBe("tombola-2026-11-21-random-org.txt");
    expect(raffleRandomOrgFileName("2026-11-21", { onlyPresent: true })).toBe("tombola-prezenti-2026-11-21-random-org.txt");
  });
});
