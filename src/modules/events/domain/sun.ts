import { toWallTimeInput } from "./zoned-time";

/**
 * When the sun sets over a place — the event's own since §NNN, the club's when it names none — and
 * whether a start is in the dark (§394; the owner, 2026-09-25: "«Necesită frontală» ar trebui să
 * fie cumva «eveniment de noapte» setat automat în funcție de ora de start și când apune soarele").
 *
 * **The algorithm** is NOAA's solar position calculator (the Global Monitoring Laboratory's
 * spreadsheet and web calculator, after Jean Meeus, *Astronomical Algorithms*): the sun's
 * declination and the equation of time from the Julian century, then the hour angle at which its
 * centre stands at a given zenith. 90.833° is sunrise and sunset — the upper limb on the horizon,
 * with the atmosphere's refraction — and 96° is civil dawn and civil dusk, the sun six degrees
 * under, the moment a runner can no longer see the path without a light. Each instant is solved
 * twice, the second time with the sun's position at the first answer's instant, which takes the
 * spreadsheet's own error (under a minute at mid-latitudes) down to seconds — checked against the
 * US Naval Observatory's published times (`tests/unit/events/sun-reference.test.ts`, §NNN): every
 * instant within five seconds of theirs, and printed to the nearest minute. No dependency: forty
 * lines of arithmetic, pure, so a client island (the editor's line) runs the very same code as the
 * server that draws the pill.
 *
 * **Dates are the event's own.** "The sunset of that day" means the calendar day on the wall clock
 * in the event's zone — `Europe/Bucharest` for everything the club holds — read through `Intl`
 * (`zoned-time.ts`), never a fixed offset: the same 19:00 is UTC+3 in October and UTC+2 in
 * November. The instants returned are plain `Date`s; the printed times go through the same zone.
 */

export type Coordinates = { latitude: number; longitude: number };

/** Brașov's centre (Piața Sfatului), the club's default place when `CLUB_COORDINATES` is unset. */
export const DEFAULT_CLUB_COORDINATES: Coordinates = { latitude: 45.6427, longitude: 25.5887 };

/** The sun's centre at the horizon, with refraction and the solar radius: sunrise and sunset. */
const ZENITH_SUNSET = 90.833;
/** The sun six degrees under the horizon: civil dawn and civil dusk. */
const ZENITH_CIVIL = 96;

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;

/** "45.6427,25.5887" → coordinates, or null for anything that is not two numbers in range. */
export function parseCoordinates(text: string): Coordinates | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) return null;
  return { latitude, longitude };
}

/** The sun's declination (degrees) and the equation of time (minutes) at a Julian day. */
function solarPosition(julianDay: number): { declination: number; equationOfTime: number } {
  const t = (julianDay - 2451545) / 36525;
  const meanLongitude = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center =
    Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomaly * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + center - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD)) / RAD;
  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const l0 = meanLongitude * RAD;
  const m = meanAnomaly * RAD;
  const equationOfTime =
    (4 / RAD) *
    (y * Math.sin(2 * l0) -
      2 * eccentricity * Math.sin(m) +
      4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * m));
  return { declination, equationOfTime };
}

/**
 * The instant the sun's centre crosses `zenith` on the UTC day that starts at `dayStartMs`,
 * rising (morning) or setting (evening) — or, when it never does that day, "above" (it stays
 * higher all day, a white night) or "below" (it never gets that high, a polar night).
 */
function crossing(dayStartMs: number, place: Coordinates, zenith: number, rising: boolean): Date | "above" | "below" {
  const julianDay0 = dayStartMs / DAY_MS + 2440587.5;
  // First guess: local solar noon; then the answer, then the answer again at its own instant.
  let minutes = 720 - 4 * place.longitude;
  for (let pass = 0; pass < 2; pass++) {
    const { declination, equationOfTime } = solarPosition(julianDay0 + minutes / 1440);
    const cosHourAngle =
      Math.cos(zenith * RAD) / (Math.cos(place.latitude * RAD) * Math.cos(declination * RAD)) -
      Math.tan(place.latitude * RAD) * Math.tan(declination * RAD);
    if (cosHourAngle < -1) return "above";
    if (cosHourAngle > 1) return "below";
    const hourAngle = Math.acos(cosHourAngle) / RAD;
    minutes = 720 - 4 * (place.longitude + (rising ? hourAngle : -hourAngle)) - equationOfTime;
  }
  return new Date(dayStartMs + Math.round(minutes * 60_000));
}

/** `YYYY-MM-DD` → the instant 00:00 UTC of that day, or null for anything that is not a day. */
function utcDayStart(ymd: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== ymd ? null : ms;
}

export type SunTimes = {
  /** Null when the sun does not cross that line that day (a polar day or night). */
  civilDawn: Date | null;
  sunrise: Date | null;
  sunset: Date | null;
  civilDusk: Date | null;
  /** The sun never sinks six degrees under that day: no instant of it is dark. */
  alwaysLight: boolean;
  /** The sun never rises to six degrees under that day: every instant of it is dark. */
  alwaysDark: boolean;
};

/**
 * Sunrise, sunset, civil dawn and civil dusk of a calendar day (`YYYY-MM-DD`) at a place — the
 * day as the event's wall clock names it. Null for a string that is not a day.
 *
 * **To the nearest minute** (§NNN), as every published table prints it — unless `precision` is
 * `"exact"`, which only the reference test asks for. The wall clock (`wallClockTime`) prints
 * "HH:MM" by cutting the seconds off, so an instant left at 19:07:51 printed "19:07" where the US
 * Naval Observatory, NOAA's calculator and meteogram.org all say 19:08: every time whose seconds
 * were 30 or more read a minute early — about half of them. Rounding the instant itself, not only
 * its print, keeps the verdict and the words on one minute: a start "at or after civil dusk" is at
 * or after the very dusk the sentence names.
 */
export function sunTimes(ymd: string, place: Coordinates, precision: "minute" | "exact" = "minute"): SunTimes | null {
  const start = utcDayStart(ymd);
  if (start === null) return null;
  const at = (value: Date | "above" | "below") =>
    value instanceof Date ? (precision === "exact" ? value : new Date(Math.round(value.getTime() / 60_000) * 60_000)) : null;
  const dawn = crossing(start, place, ZENITH_CIVIL, true);
  const dusk = crossing(start, place, ZENITH_CIVIL, false);
  return {
    civilDawn: at(dawn),
    sunrise: at(crossing(start, place, ZENITH_SUNSET, true)),
    sunset: at(crossing(start, place, ZENITH_SUNSET, false)),
    civilDusk: at(dusk),
    alwaysLight: dusk === "above",
    alwaysDark: dusk === "below",
  };
}

/** The calendar day an instant falls on, on the wall clock in `timeZone`: `YYYY-MM-DD`. */
export function localDay(instant: Date, timeZone: string): string {
  return toWallTimeInput(instant, timeZone).slice(0, 10);
}

/** "16:36": the instant on the wall clock in `timeZone`, always 24-hour, in no language's words. */
export function wallClockTime(instant: Date, timeZone: string): string {
  return toWallTimeInput(instant, timeZone).slice(11, 16);
}

/**
 * Whether a start is in the dark: at or after civil dusk, or before civil dawn, of its own day on
 * the event's wall clock. A start with no time — the editor before the time is typed — is never a
 * night event: a day alone says nothing about the dark.
 */
export function isNightEvent(startsAt: Date | null, place: Coordinates, timeZone: string): boolean {
  if (!startsAt || Number.isNaN(startsAt.getTime())) return false;
  const sun = sunTimes(localDay(startsAt, timeZone), place);
  if (!sun) return false;
  if (sun.alwaysDark) return true;
  if (sun.alwaysLight) return false;
  const at = startsAt.getTime();
  return (sun.civilDusk !== null && at >= sun.civilDusk.getTime()) || (sun.civilDawn !== null && at < sun.civilDawn.getTime());
}
