import { describe, expect, it } from "vitest";
import { nightEvent } from "@/modules/events/domain/night";
import { type Coordinates, DEFAULT_CLUB_COORDINATES, sunTimes, wallClockTime } from "@/modules/events/domain/sun";
import { fromWallTimeInput } from "@/modules/events/domain/zoned-time";
import { nightPlace } from "@/modules/events/night-event";

/**
 * BR-REQ-020-01 (`DECISIONS.md` §394, §428) — the sun, to the minute.
 *
 * The owner, 2026-09-26: "Sunset is now at 19:07 actually, do make sure this data is accurate".
 *
 * The reference is the US Naval Observatory's own one-day table (`aa.usno.navy.mil/api/rstt/oneday`,
 * read 2026-09-26 with the coordinates below and the zone's offset of that date): civil dawn,
 * sunrise, sunset and civil dusk, each printed to the nearest minute. The same definitions as
 * `sun.ts`: the sun's centre 0.833° under the horizon for rise and set, 6° for civil twilight.
 *
 * Two claims, both measured:
 * - **the instant** (`precision: "exact"`) is within five seconds of the table's, beyond the table's
 *   own half-minute of rounding — so the algorithm is right to the second, not "within five
 *   minutes" as §394 first checked;
 * - **the printed minute** is the table's. Two independent calculators a few seconds apart can
 *   only disagree on a time that falls within those seconds of a half minute (07:32:29 and
 *   07:32:31 round apart); such a time may differ by the one minute, and nothing else may.
 *
 * Before §428 the printed minute cut the seconds off, so every time with 30 seconds or more read a
 * minute early — 19:07 for 19:07:51 on 26 September, where the table says 19:08.
 */

const BRASOV = DEFAULT_CLUB_COORDINATES;
const BUCHAREST = { latitude: 44.4268, longitude: 26.1025 };
const CLUJ = { latitude: 46.7712, longitude: 23.6236 };
const CONSTANTA = { latitude: 44.1598, longitude: 28.6348 };
const LONDON = { latitude: 51.5074, longitude: -0.1278 };
const TROMSO = { latitude: 69.6492, longitude: 18.9553 };
const ZONE = "Europe/Bucharest";

type Row = [name: string, place: Coordinates, zone: string, day: string, dawn: string | null, rise: string | null, set: string | null, dusk: string | null];

// prettier-ignore
const USNO: Row[] = [
  ["Brașov, today",                        BRASOV,    ZONE, "2026-09-26", "06:40", "07:09", "19:08", "19:37"],
  ["Brașov, the Wednesday run's date",     BRASOV,    ZONE, "2026-09-30", "06:45", "07:14", "19:00", "19:30"],
  ["Brașov, mid-October",                  BRASOV,    ZONE, "2026-10-14", "07:03", "07:33", "18:34", "19:04"],
  ["Brașov, 17 October",                   BRASOV,    ZONE, "2026-10-17", "07:06", "07:37", "18:29", "18:59"],
  ["Brașov, the last day of summer time",  BRASOV,    ZONE, "2026-10-24", "07:16", "07:46", "18:17", "18:47"],
  ["Brașov, the first day of winter time", BRASOV,    ZONE, "2026-10-25", "06:17", "06:47", "17:15", "17:46"],
  ["Brașov, a November Wednesday",         BRASOV,    ZONE, "2026-11-18", "06:49", "07:21", "16:44", "17:17"],
  ["Brașov, the December solstice",        BRASOV,    ZONE, "2026-12-21", "07:21", "07:55", "16:36", "17:11"],
  ["Brașov, a January Wednesday",          BRASOV,    ZONE, "2027-01-13", "07:22", "07:56", "16:57", "17:30"],
  ["Brașov, the March equinox",            BRASOV,    ZONE, "2027-03-20", "05:52", "06:22", "18:30", "18:59"],
  ["Brașov, the day after it",             BRASOV,    ZONE, "2027-03-21", "05:50", "06:20", "18:31", "19:01"],
  ["Brașov, the first day of summer time", BRASOV,    ZONE, "2027-03-28", "06:37", "07:06", "19:40", "20:10"],
  ["Brașov, the June solstice",            BRASOV,    ZONE, "2027-06-21", "04:50", "05:28", "21:11", "21:49"],
  ["Brașov, mid-August",                   BRASOV,    ZONE, "2027-08-15", "05:45", "06:17", "20:26", "20:58"],
  ["Bucharest, the June solstice",         BUCHAREST, ZONE, "2026-06-21", "04:54", "05:31", "21:04", "21:41"],
  ["Bucharest, the December solstice",     BUCHAREST, ZONE, "2026-12-21", "07:15", "07:49", "16:39", "17:12"],
  ["Brașov, the race's date",              BRASOV,    ZONE, "2026-11-21", "06:52", "07:25", "16:42", "17:14"],
  ["Cluj, the race's date",                CLUJ,      ZONE, "2026-11-21", "07:03", "07:36", "16:46", "17:19"],
  ["Cluj, a November Wednesday",           CLUJ,      ZONE, "2026-11-18", "06:59", "07:32", "16:49", "17:22"],
  ["Constanța, the race's date",           CONSTANTA, ZONE, "2026-11-21", "06:37", "07:08", "16:34", "17:06"],
  ["London, the June solstice",            LONDON,    "Europe/London", "2026-06-21", "03:55", "04:43", "21:22", "22:09"],
  // The polar night: no sunrise or sunset at all, only a civil twilight around noon.
  ["Tromsø, the polar night",              TROMSO,    "Europe/Oslo",   "2026-12-21", "09:31", null,    null,    "13:53"],
];

const HALF_MINUTE = 30_000;
const TOLERANCE = 5_000;
const EVENTS = ["civilDawn", "sunrise", "sunset", "civilDusk"] as const;

/** The table's "HH:MM" of that day, as the instant it names. */
const tableInstant = (day: string, time: string, zone: string) => fromWallTimeInput(`${day}T${time}`, zone)!.getTime();
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

describe("§428 the sun against the US Naval Observatory's tables", () => {
  it.each(USNO)("%s — the instant within five seconds of the table's", (_name, place, zone, day, ...table) => {
    const exact = sunTimes(day, place, "exact")!;
    EVENTS.forEach((key, index) => {
      const reference = table[index];
      if (reference === null) {
        expect(exact[key], key).toBeNull();
        return;
      }
      const drift = Math.abs(exact[key]!.getTime() - tableInstant(day, reference, zone));
      expect(drift, `${key}: ${exact[key]!.toISOString()} against ${reference}`).toBeLessThanOrEqual(HALF_MINUTE + TOLERANCE);
    });
  });

  it.each(USNO)("%s — the printed minute is the table's", (_name, place, zone, day, ...table) => {
    const exact = sunTimes(day, place, "exact")!;
    const printed = sunTimes(day, place)!;
    EVENTS.forEach((key, index) => {
      const reference = table[index];
      if (reference === null) {
        expect(printed[key], key).toBeNull();
        return;
      }
      const shown = wallClockTime(printed[key]!, zone);
      // Only a time within the tolerance of a half minute may round the other way.
      const seconds = exact[key]!.getTime() % 60_000;
      const onTheEdge = Math.abs(seconds - HALF_MINUTE) <= TOLERANCE;
      if (onTheEdge) expect(Math.abs(minutesOf(shown) - minutesOf(reference)), key).toBeLessThanOrEqual(1);
      else expect(shown, key).toBe(reference);
    });
  });

  it("prints 81 of the 86 times exactly as the table does; the other five are seconds from a half minute", () => {
    const differ: string[] = [];
    let total = 0;
    for (const [name, place, zone, day, ...table] of USNO) {
      const exact = sunTimes(day, place, "exact")!;
      const printed = sunTimes(day, place)!;
      EVENTS.forEach((key, index) => {
        const reference = table[index];
        if (reference === null) return;
        total += 1;
        if (wallClockTime(printed[key]!, zone) !== reference) differ.push(`${name} ${key} ${wallClockTime(exact[key]!, zone)}:${String(exact[key]!.getUTCSeconds()).padStart(2, "0")}`);
      });
    }
    expect(total).toBe(86);
    // Each lands within four seconds of a half minute, where the table's own seconds round the other way.
    expect(differ).toEqual([
      "Brașov, mid-October sunrise 07:32:29",
      "Brașov, 17 October sunrise 07:36:28",
      "Brașov, a November Wednesday civilDawn 06:48:26",
      "Brașov, a January Wednesday civilDusk 17:30:30",
      "Brașov, the first day of summer time civilDawn 06:36:28",
    ]);
  });

  it("the polar day: no sunset and no dusk, never dark", () => {
    const tromso = sunTimes("2026-06-21", TROMSO)!;
    expect(tromso).toMatchObject({ civilDawn: null, sunrise: null, sunset: null, civilDusk: null, alwaysLight: true, alwaysDark: false });
  });
});

describe("§428 what the owner saw", () => {
  it("today, Saturday 26 September 2026, the sun sets at 19:08 over Brașov's centre — 19:07:51, no longer printed «19:07»", () => {
    // 16:07:51 UTC is 19:07:51 in Brașov's summer time: cutting the seconds off printed "19:07".
    expect(sunTimes("2026-09-26", BRASOV, "exact")!.sunset!.toISOString().slice(0, 19)).toBe("2026-09-26T16:07:51");
    expect(wallClockTime(sunTimes("2026-09-26", BRASOV)!.sunset!, ZONE)).toBe("19:08");
  });

  it("the Wednesday 19:00 run of 30 September: that date's sunset is 19:00 — about two minutes earlier every day", () => {
    const sunsets = ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"].map((day) => wallClockTime(sunTimes(day, BRASOV)!.sunset!, ZONE));
    expect(sunsets).toEqual(["19:08", "19:06", "19:04", "19:02", "19:00"]);
  });

  it("the verdict and the words share one minute: a start at the printed civil dusk is a night start", () => {
    const facts = nightEvent({ nightOverride: null, timezone: ZONE }, fromWallTimeInput("2026-09-30T19:30", ZONE), BRASOV);
    // Civil dusk is 19:29:41, printed 19:30 — and a 19:30 start is dark by it.
    expect(facts.night).toBe(true);
    expect(nightEvent({ nightOverride: null, timezone: ZONE }, fromWallTimeInput("2026-09-30T19:29", ZONE), BRASOV).night).toBe(false);
  });
});

describe("§428 the event's own place, by §416's rule", () => {
  it("reads the map link's pin, then the typed pair, then the club's place — the club's while the place is to be announced", () => {
    const club = DEFAULT_CLUB_COORDINATES;
    expect(nightPlace({})).toEqual(club);
    expect(nightPlace({ latitude: CLUJ.latitude, longitude: CLUJ.longitude })).toEqual(CLUJ);
    expect(nightPlace({ mapUrl: "https://maps.example.test/?q=44.1598,28.6348", latitude: CLUJ.latitude, longitude: CLUJ.longitude })).toEqual(CONSTANTA);
    expect(nightPlace({ latitude: CLUJ.latitude, longitude: CLUJ.longitude, locationToBeAnnounced: true })).toEqual(club);
  });

  it("a race in Cluj or Constanța on 21 November reads its own sunset, not Brașov's", () => {
    const sunset = (place: Coordinates) => wallClockTime(sunTimes("2026-11-21", place)!.sunset!, ZONE);
    // All three are the table's own (above): Brașov eight minutes after Constanța, Cluj four after Brașov.
    expect([sunset(CONSTANTA), sunset(BRASOV), sunset(CLUJ)]).toEqual(["16:34", "16:42", "16:46"]);
  });
});
