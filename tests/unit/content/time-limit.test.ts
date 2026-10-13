import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ro from "../../../messages/ro.json";
import en from "../../../messages/en.json";
import { durationBase, eventDurationMinutes } from "@/modules/content/events/duration";
import DurationWords from "@/modules/content/events/ui/DurationWords";
import { gunOffsetMinutes } from "@/modules/content/events/ui/NightEventField";
import { checkpointFinish, raceTimeLimitMinutes } from "@/modules/event-checkpoints/domain/start";

/**
 * §NNN (amending §71, §433) — «Durata» becomes «Timp limită» for a race (the owner, 2026-10-13: «Aici nu
 * e clar „cât durează” ce? trebuie să pot pune timp limită»): the words by the event's type, the minutes
 * counted from the race's gun, the page's «Timp limită: 2 h 30 min» and the finish row's closing time.
 */

const at = (iso: string) => new Date(iso);
// 09:00 in Bucharest is 07:00 UTC in November.
const START = at("2026-11-21T07:00:00.000Z");
const GUN = at("2026-11-21T08:00:00.000Z");

describe("§NNN the box's words follow the type", () => {
  const words = (initialType: string) =>
    renderToStaticMarkup(createElement(DurationWords, { selectName: "event.type", initialType, race: ro.Admin.editor.durationRace, other: ro.Admin.editor.durationOther }));

  it("says «Timp limită» for a race and «Cât durează evenimentul» for any other event", () => {
    expect(words("RACE")).toContain("Timp limită");
    for (const type of ["GROUP_RUN", "HIKE", "COFFEE", "MEETUP"]) {
      expect(words(type)).toContain("Cât durează evenimentul");
      expect(words(type)).not.toContain("Timp limită");
    }
  });

  it("has both labels and both helps in both languages, in plain words with an example", () => {
    for (const editor of [ro.Admin.editor, en.Admin.editor]) {
      for (const key of ["durationRace", "durationRaceHelp", "durationOther", "durationOtherHelp"] as const) {
        expect(typeof editor[key]).toBe("string");
        expect(editor[key].length).toBeLessThanOrEqual(200);
      }
    }
    expect(ro.Admin.editor.durationRace).toBe("Timp limită");
    expect(ro.Admin.editor.durationRaceHelp).toBe("Cât au alergătorii de la start până se închide sosirea — de exemplu 2 ore și 30 de minute. Lasă gol dacă nu există.");
    expect(ro.Admin.editor.durationOther).toBe("Cât durează evenimentul");
    expect(ro.Admin.editor.durationOtherHelp).toBe("De la start până la final — de exemplu 1 oră și 45 de minute. Sfârșitul se calculează singur. Lasă gol dacă nu s-a anunțat.");
    expect(en.Admin.editor.durationRace).toBe("Time limit");
  });

  it("is drawn in «Când și unde» with a glyph before the words, for the label and for the help", () => {
    const box = readFileSync("src/modules/content/events/ui/boxes/WhenBox.tsx", "utf8");
    expect(box).toMatch(/<DurationGlyph aria-hidden[^>]*\/>\s*<DurationWords selectName="event\.type"[^>]*race=\{t\("editor\.durationRace"\)\}/);
    expect(box).toContain('race={t("editor.durationRaceHelp")} other={t("editor.durationOtherHelp")}');
  });
});

describe("§NNN a race's minutes count from the gun", () => {
  it("counts from the gun on a race that has one, else from the event's start", () => {
    expect(durationBase({ type: "RACE", startsAt: START, raceStartsAt: GUN })).toBe(GUN);
    expect(durationBase({ type: "RACE", startsAt: START, raceStartsAt: null })).toBe(START);
    // Only a race has a gun; any other type counts from its start whatever the column holds.
    expect(durationBase({ type: "GROUP_RUN", startsAt: START, raceStartsAt: GUN })).toBe(START);
  });

  it("reads the box back from the same instant the save added it to, so a save that changes nothing keeps the end", () => {
    const endsAt = at("2026-11-21T10:30:00.000Z"); // 12:30
    expect(eventDurationMinutes({ type: "RACE", startsAt: START, raceStartsAt: GUN, endsAt })).toBe(150);
    expect(eventDurationMinutes({ type: "GROUP_RUN", startsAt: START, raceStartsAt: null, endsAt })).toBe(210);
    expect(eventDurationMinutes({ type: "RACE", startsAt: START, raceStartsAt: GUN, endsAt: null })).toBeNull();
    expect(eventDurationMinutes(null)).toBeNull();
  });

  it("is what the save stores: the service adds the minutes to `durationBase`", () => {
    const service = readFileSync("src/modules/content/events/service.ts", "utf8");
    expect(service).toContain("durationBase({ type: fields.type, startsAt, raceStartsAt }).getTime() + fields.durationMinutes * 60_000");
  });

  it("makes the night line's span the gun's distance from the start plus the box, as the save does", () => {
    const form = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
    const start = { date: "2026-11-21", time: "09:00", timeZone: "Europe/Bucharest" };
    const race = { "event.type": "RACE", "event.raceStartsAtDate": "2026-11-21", "event.raceStartsAtTime": "10:00" };
    expect(gunOffsetMinutes(form(race), start)).toBe(60);
    expect(gunOffsetMinutes(form({ ...race, "event.raceStartNotSet": "on" }), start)).toBe(0);
    expect(gunOffsetMinutes(form({ ...race, "event.type": "GROUP_RUN" }), start)).toBe(0);
    expect(gunOffsetMinutes(form({ ...race, "event.raceStartsAtTime": "" }), start)).toBe(0);
    expect(gunOffsetMinutes(form(race), { ...start, time: "" })).toBe(0);
  });
});

describe("§NNN the page's «Timp limită» and the finish row", () => {
  const race = { type: "RACE", startsAt: START, raceStartsAt: GUN, endsAt: at("2026-11-21T10:30:00.000Z"), timezone: "Europe/Bucharest", distanceMeters: 21000 };

  it("says a race's time limit from the gun, and nothing for any other event", () => {
    expect(raceTimeLimitMinutes(race)).toBe(150);
    expect(raceTimeLimitMinutes({ ...race, raceStartsAt: null })).toBe(210);
    expect(raceTimeLimitMinutes({ ...race, endsAt: null })).toBeNull();
    expect(raceTimeLimitMinutes({ ...race, type: "GROUP_RUN" })).toBeNull();
    expect(raceTimeLimitMinutes({ ...race, endsAt: GUN })).toBeNull();
  });

  it("closes the finish at the event's end on its own clock, for a race only", () => {
    expect(checkpointFinish(race)).toEqual({ km: 21, limit: "12:30" });
    expect(checkpointFinish({ ...race, type: "GROUP_RUN" }).limit).toBeNull();
  });

  it("draws the page's row under «Când» with the stopwatch and «2 h 30 min»", () => {
    const facts = readFileSync("src/modules/events/ui/EventFacts.tsx", "utf8");
    expect(facts).toContain('rows.push({ key: "timeLimit", label: t("timeLimit"), icon: TimerIcon');
    expect(facts).toContain("durationShort(timeLimit)");
    expect(ro.Event.timeLimit).toBe("Timp limită");
    expect(en.Event.timeLimit).toBe("Time limit");
    expect(ro.Event.checkpoints.finishCloses).toBe("se închide la {time}");
  });
});
