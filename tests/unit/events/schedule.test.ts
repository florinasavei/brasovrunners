import { describe, expect, it } from "vitest";
import { localizedSchedule, programmeLines, readScheduleItems, shiftScheduleItems } from "@/modules/events/domain/schedule";

/** BR-REQ-020-01 criterion 11 (`DECISIONS.md` §117) — the programme as data. */
const ZONE = "Europe/Bucharest";

const ROWS = [
  { startsAt: "2026-10-11T07:00:00.000Z", endsAt: null, label: { ro: "Start", en: "Start" }, place: null },
  { startsAt: "2026-10-10T13:00:00.000Z", endsAt: "2026-10-10T16:00:00.000Z", label: { ro: "Ridicarea kiturilor", en: "Kit pickup" }, place: "Cortul de start" },
  { startsAt: "2026-10-11T06:30:00.000Z", endsAt: null, label: { ro: "Briefing", en: "Briefing" }, place: null },
];

describe("the programme's rows", () => {
  it("reads the stored rows soonest first, and nothing from a shape that is not a row", () => {
    expect(readScheduleItems(ROWS).map((row) => row.label.en)).toEqual(["Kit pickup", "Briefing", "Start"]);
    expect(readScheduleItems(null)).toEqual([]);
    expect(readScheduleItems([{ startsAt: "yesterday", label: { ro: "x", en: "y" } }])).toEqual([]);
    expect(readScheduleItems("[]")).toEqual([]);
  });

  it("speaks one language at a time", () => {
    const rows = localizedSchedule(readScheduleItems(ROWS), "ro");
    expect(rows[0]).toEqual({ startsAt: new Date("2026-10-10T13:00:00.000Z"), endsAt: new Date("2026-10-10T16:00:00.000Z"), label: "Ridicarea kiturilor", place: "Cortul de start" });
    expect(localizedSchedule(readScheduleItems(ROWS), "en")[2].label).toBe("Start");
  });

  it("shifts on the wall clock, so a briefing at 09:30 stays at 09:30 across the clock change", () => {
    // 11 October 09:30 EEST → 8 November 09:30 EET is 27 hours short of four weeks of instants.
    const shifted = shiftScheduleItems(readScheduleItems(ROWS), ZONE, { days: 28 });
    expect(shifted.find((row) => row.label.en === "Briefing")?.startsAt).toBe("2026-11-08T07:30:00.000Z");
    // 19:00 EEST on 10 October is 16:00Z; 19:00 EET on 7 November is 17:00Z.
    expect(shifted.find((row) => row.label.en === "Kit pickup")?.endsAt).toBe("2026-11-07T17:00:00.000Z");
  });

  it("writes one line per row, with the day only when the programme spans days", () => {
    const rows = localizedSchedule(readScheduleItems(ROWS), "en");
    expect(programmeLines(rows, ZONE, "en")).toEqual([
      "Sat 10 Oct 16:00–19:00 — Kit pickup (Cortul de start)",
      "Sun 11 Oct 09:30 — Briefing",
      "Sun 11 Oct 10:00 — Start",
    ]);
    expect(programmeLines(rows.slice(1), ZONE, "ro")).toEqual(["09:30 — Briefing", "10:00 — Start"]);
    expect(programmeLines([], ZONE, "ro")).toEqual([]);
  });
});
