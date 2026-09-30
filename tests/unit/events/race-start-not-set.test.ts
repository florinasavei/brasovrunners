import { describe, expect, it } from "vitest";
import { raceStartWallTime, RACE_START_NOT_SET } from "@/modules/content/events/race-start";
import { whenTimes } from "@/modules/events/domain/when-times";
import { eventFactsBlock } from "@/modules/notifications/domain/event-facts";
import { emailSampleEventFacts } from "@/modules/notifications/email-copy-fields";

/**
 * §590 — a race's start may be not set yet: «Startul cursei nu e stabilit» in the editor saves no
 * gun time, and «Când» then says the event's start alone, «08:30 (start eveniment)», with «Ora
 * startului cursei se anunță.» under it — never a gathering with no start after it.
 */
const startsAt = new Date("2026-11-21T06:30:00Z");
const gun = new Date("2026-11-21T08:00:00Z");

describe("§590 «Când»'s times (whenTimes)", () => {
  it("a race with its own gun time: the event start and the race start, each named (§597)", () => {
    expect(whenTimes({ type: "RACE", startsAt, raceStartsAt: gun })).toEqual({
      times: [
        { key: "eventStartAt", at: startsAt },
        { key: "raceStartAt", at: gun },
      ],
      raceStartLater: false,
    });
  });

  it("a race with no gun time: «start la» the event's start, and the start said to come later", () => {
    expect(whenTimes({ type: "RACE", startsAt, raceStartsAt: null })).toEqual({ times: [{ key: "eventStartAt", at: startsAt }], raceStartLater: true });
  });

  it("a gun time equal to the start is one time, «(start eveniment)», with nothing to announce", () => {
    expect(whenTimes({ type: "RACE", startsAt, raceStartsAt: new Date(startsAt) })).toEqual({ times: [{ key: "eventStartAt", at: startsAt }], raceStartLater: false });
  });

  it("the emails' «Când» with both times: «(start eveniment) · (start cursă)», words alone, in both languages (§597)", () => {
    const ro = eventFactsBlock({ ...emailSampleEventFacts("ro"), type: "RACE" as const, startsAt, raceStartsAt: gun }, "ro").text;
    expect(ro).toMatch(/Când: .* · 08:30 \(start eveniment\) · 10:00 \(start cursă\)/);
    expect(ro).not.toContain("🏁");
    const en = eventFactsBlock({ ...emailSampleEventFacts("en"), type: "RACE" as const, startsAt, raceStartsAt: gun }, "en").text;
    expect(en).toMatch(/When: .* · 08:30 \(event start\) · 10:00 \(race start\)/);
  });

  it("anything else: the one time, bare", () => {
    expect(whenTimes({ type: "GROUP_RUN", startsAt, raceStartsAt: null })).toEqual({ times: [{ key: null, at: startsAt }], raceStartLater: false });
  });

  it("the emails' «Când» follows, in both languages", () => {
    const race = { ...emailSampleEventFacts("ro"), type: "RACE" as const, raceStartsAt: null };
    const ro = eventFactsBlock(race, "ro").text;
    expect(ro).toMatch(/Când: .* · \d\d:\d\d \(start eveniment\)/);
    expect(ro).toContain("Ora startului cursei se anunță.");
    expect(ro).not.toContain("întâlnire");
    const en = eventFactsBlock({ ...emailSampleEventFacts("en"), type: "RACE" as const, raceStartsAt: null }, "en").text;
    expect(en).toMatch(/When: .* · \d\d:\d\d \(event start\)/);
    expect(en).toContain("The race start time is announced later.");
    expect(en).not.toContain("gather at");
  });
});

describe("§590 the editor's tick (raceStartWallTime)", () => {
  it("ticked, the gun time is saved empty whatever the boxes hold", () => {
    const form = new FormData();
    form.set(RACE_START_NOT_SET, "on");
    expect(raceStartWallTime(form, "2026-11-21T10:00")).toBe("");
  });

  it("unticked or absent, the boxes' value as before", () => {
    expect(raceStartWallTime(new FormData(), "2026-11-21T10:00")).toBe("2026-11-21T10:00");
    expect(raceStartWallTime(new FormData(), "")).toBe("");
  });
});
