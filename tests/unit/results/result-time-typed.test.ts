import { describe, expect, it } from "vitest";
import { clockOfResultTime, formatResultTime, normalizeTypedResultTime, parseResultTime, resultTimeOfClock } from "@/modules/results/domain/result-time";

/**
 * §999, BR-REQ-050-02 — «Clasament»'s «Timp» and «Timp cip», typed in any shape a stopwatch, a phone's decimal keypad or a
 * timing sheet gives, read on leaving the box as the server reads them (`normalizeTypedResultTime`, beside `parseResultTime`);
 * and the clock picker beside them: where it opens for what a box holds (`clockOfResultTime`) and what «OK» writes
 * (`resultTimeOfClock`). The server's parser is not changed: everything the box writes is one of the shapes it already reads.
 */
const sec = (n: number) => n * 1000;
const hms = (h: number, m: number, s: number) => sec(h * 3600 + m * 60 + s);

/** Typed → what the box holds after it is left, and the milliseconds the server reads from that. */
const READ: ReadonlyArray<[string, string, number]> = [
  // Digits alone, from the right: seconds, minutes, then the hours, their leading zero dropped.
  ["945", "9:45", hms(0, 9, 45)],
  ["2345", "23:45", hms(0, 23, 45)],
  ["0945", "9:45", hms(0, 9, 45)],
  ["0045", "0:45", hms(0, 0, 45)],
  ["12345", "1:23:45", hms(1, 23, 45)],
  ["012345", "1:23:45", hms(1, 23, 45)],
  ["102345", "10:23:45", hms(10, 23, 45)],
  ["9959", "99:59", hms(1, 39, 59)],
  // …with a fraction of a second after a dot or a comma, written with a dot.
  ["2345.6", "23:45.6", hms(0, 23, 45) + 600],
  ["2345,6", "23:45.6", hms(0, 23, 45) + 600],
  ["12345.25", "1:23:45.25", hms(1, 23, 45) + 250],
  ["12345,125", "1:23:45.125", hms(1, 23, 45) + 125],
  // The usual separators between groups stand for colons: a dot, a comma, a space, a colon, spaces around them.
  ["1.23.45", "1:23:45", hms(1, 23, 45)],
  ["1 23 45", "1:23:45", hms(1, 23, 45)],
  ["1,23,45", "1:23:45", hms(1, 23, 45)],
  ["01.23.45", "1:23:45", hms(1, 23, 45)],
  ["1. 23. 45", "1:23:45", hms(1, 23, 45)],
  ["1:23 45", "1:23:45", hms(1, 23, 45)],
  ["0.45.12", "0:45:12", hms(0, 45, 12)],
  ["23.45", "23:45", hms(0, 23, 45)],
  ["9,05", "9:05", hms(0, 9, 5)],
  ["45 12", "45:12", hms(0, 45, 12)],
  // Three groups are h:mm:ss first — a stopwatch's «12.34.56» too, knowingly: read longer than meant, it puts the runner lower, never higher.
  ["12.34.56", "12:34:56", hms(12, 34, 56)],
  // Three groups that are no h:mm:ss are minutes, seconds and a fraction when the first is ten or more; four are h:mm:ss.t.
  ["23.45.6", "23:45.6", hms(0, 23, 45) + 600],
  ["23.45.67", "23:45.67", hms(0, 23, 45) + 670],
  ["10.23.4", "10:23.4", hms(0, 10, 23) + 400],
  ["123,45,6", "123:45.6", hms(2, 3, 45) + 600],
  ["1.23.45.6", "1:23:45.6", hms(1, 23, 45) + 600],
  ["1:23.45.6", "1:23:45.6", hms(1, 23, 45) + 600],
  // Spaces around what was typed are trimmed.
  ["  2345  ", "23:45", hms(0, 23, 45)],
];

/** What the server already reads is left exactly as typed (trimmed): the box keeps every shape it accepted. */
const KEPT: readonly string[] = ["1:23:45", "0:45:12", "45:12", "9:05", "125:30", "45:12.3", "45:12,25", "1:23:45,125", "48:00:00", "0:00:01", "12:34"];

/** What cannot be read stays as typed, for the server to refuse with its own sentence. */
const UNREAD: readonly string[] = [
  "45", // two digits: seconds or minutes — it cannot know
  "5",
  "1234567", // seven digits
  "1.5.30", // a one-digit minute after an hour, as the server refuses «1:5:30»
  "1.23.4", // an h:mm:ss with a digit missing — never 1:23.4, 83 seconds that would rank first
  "01.23.4", // the same, a leading zero on the hour
  "0.45.1", // the same under an hour — never 0:45.1
  "23.4", // a one-digit second
  "2375", // 75 seconds
  "1.60.00", // 60 minutes after an hour
  "25:61",
  "992345", // 99 hours: past two days
  "000000", // zero
  "0.00.00",
  "abc",
  "1h23m",
  "7pm",
  "12345,",
  "2345.6789", // four digits of a fraction
  "-1:00",
  "1..23",
];

describe("§999 normalizeTypedResultTime: what a time box makes of what was typed", () => {
  it.each(READ)("reads «%s» as «%s»", (typed, shown, ms) => {
    expect(normalizeTypedResultTime(typed)).toBe(shown);
    expect(parseResultTime(normalizeTypedResultTime(typed))).toBe(ms);
  });

  it("leaves every shape the server already reads exactly as typed", () => {
    for (const typed of KEPT) {
      expect(parseResultTime(typed), typed).not.toBeNull();
      expect(normalizeTypedResultTime(typed), typed).toBe(typed);
      expect(normalizeTypedResultTime(`  ${typed} `), typed).toBe(typed);
    }
  });

  it("leaves what it cannot read as typed, trimmed, for the server to refuse", () => {
    for (const typed of UNREAD) {
      expect(normalizeTypedResultTime(typed), typed).toBe(typed.trim());
      expect(parseResultTime(normalizeTypedResultTime(typed)), typed).toBeNull();
    }
    expect(normalizeTypedResultTime("")).toBe("");
    expect(normalizeTypedResultTime("   ")).toBe("");
  });

  it("reads three groups as minutes, seconds and a fraction only from ten minutes: a first group under ten is an hour with a digit missing", () => {
    for (let first = 0; first <= 9; first += 1) {
      for (const typed of [`${first}.23.4`, `0${first}.23.4`, `00${first}.23.4`, `${first},05,9`, `${first} 59 1`]) {
        expect(normalizeTypedResultTime(typed), typed).toBe(typed);
      }
    }
    // From ten the same text is a time in minutes, never under ten of them.
    for (let first = 10; first <= 999; first += 1) {
      const written = normalizeTypedResultTime(`${first}.23.4`);
      expect(written, `${first}.23.4`).toBe(`${first}:23.4`);
      expect(parseResultTime(written)).toBeGreaterThanOrEqual(sec(10 * 60));
    }
  });

  it("writes nothing the server's parser would refuse, and never changes what a time the server read means", () => {
    // Every corpus entry, and every run of digits of up to six with and without a fraction: what is written is read.
    const corpus = [...READ.map(([typed]) => typed), ...KEPT, ...UNREAD];
    for (let digits = 1; digits <= 999_999; digits += 997) corpus.push(String(digits), String(digits).padStart(6, "0"), `${digits},5`, `${digits}.05`);
    for (const typed of corpus) {
      const written = normalizeTypedResultTime(typed);
      if (written !== typed.trim()) expect(parseResultTime(written), `${typed} → ${written}`).not.toBeNull();
      const before = parseResultTime(typed);
      if (before !== null) expect(parseResultTime(written), typed).toBe(before);
      // Leaving the box twice changes nothing more.
      expect(normalizeTypedResultTime(written), typed).toBe(written);
    }
  });

  it("reads what the page drew and what the import writes as themselves", () => {
    for (const ms of [hms(0, 45, 12), hms(1, 23, 45), hms(0, 45, 12) + 300, hms(10, 59, 59) + 999]) {
      const drawn = formatResultTime(ms);
      expect(normalizeTypedResultTime(drawn)).toBe(drawn);
    }
  });
});

describe("§999 the clock picker's readings of a box", () => {
  it("opens at the box's time, read as the box reads it, in whole seconds", () => {
    expect(clockOfResultTime("1:23:45")).toEqual({ hours: 1, minutes: 23, seconds: 45 });
    expect(clockOfResultTime("45:12")).toEqual({ hours: 0, minutes: 45, seconds: 12 });
    expect(clockOfResultTime("125:30")).toEqual({ hours: 2, minutes: 5, seconds: 30 });
    // Typed but not yet left: the picker reads it as leaving the box would.
    expect(clockOfResultTime("12345")).toEqual({ hours: 1, minutes: 23, seconds: 45 });
    expect(clockOfResultTime("1.23.45")).toEqual({ hours: 1, minutes: 23, seconds: 45 });
    // A box with tenths opens at its whole seconds.
    expect(clockOfResultTime("45:12.3")).toEqual({ hours: 0, minutes: 45, seconds: 12 });
    expect(clockOfResultTime("1:23:45,999")).toEqual({ hours: 1, minutes: 23, seconds: 45 });
    expect(clockOfResultTime("23:59:59")).toEqual({ hours: 23, minutes: 59, seconds: 59 });
  });

  it("opens at 0:00:00 (null) for an empty box, a text that is no time, or a day and more, which the clock cannot show", () => {
    for (const text of ["", "  ", "abc", "45", "25:61", "24:00:00", "30:15:00", "48:00:00"]) expect(clockOfResultTime(text), text).toBeNull();
  });

  it("writes h:mm:ss, the hour without a leading zero, which the server reads back as the time picked", () => {
    expect(resultTimeOfClock({ hours: 1, minutes: 23, seconds: 45 })).toBe("1:23:45");
    expect(resultTimeOfClock({ hours: 0, minutes: 45, seconds: 12 })).toBe("0:45:12");
    expect(resultTimeOfClock({ hours: 13, minutes: 5, seconds: 9 })).toBe("13:05:09");
    expect(resultTimeOfClock({ hours: 0, minutes: 0, seconds: 1 })).toBe("0:00:01");
    for (let hours = 0; hours < 24; hours += 1) {
      for (const [minutes, seconds] of [
        [0, 1],
        [7, 30],
        [59, 59],
      ]) {
        const written = resultTimeOfClock({ hours, minutes, seconds });
        expect(written).toMatch(/^([1-9]?\d):[0-5]\d:[0-5]\d$/);
        expect(written.startsWith("0") && hours > 0).toBe(false);
        expect(parseResultTime(written), written).toBe(hms(hours, minutes, seconds));
        expect(normalizeTypedResultTime(written)).toBe(written);
        expect(clockOfResultTime(written)).toEqual({ hours, minutes, seconds });
      }
    }
  });
});
