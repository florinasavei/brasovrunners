import {
  betterSample,
  CLOCK_STORAGE_KEY,
  type ClockSample,
  readStoredClockSample,
  type RoundTrip,
  sampleOfPage,
  sampleOfRoundTrip,
  serverNowAt,
  storedClockSample,
} from "../domain/finish-line";

/**
 * The server's clock on this phone, for «Cronometrare»'s two islands (§986): the finish line (`FinishLine.tsx`) stamps every press with
 * it and «Start» (`RaceGunPress.tsx`) the gun's tap. One sample for the page, in this module — both islands read the same — and on the
 * phone (`CLOCK_STORAGE_KEY`), so the next page starts from a measured one rather than from its own reading, late by the page's
 * delivery and old after a back navigation. Read through the **wall clock** (`Date.now()`), which keeps time while the screen is
 * locked; the arithmetic, and why, is `domain/finish-line.ts`'. Every access of the storage is in a `try`: without it the page measures
 * again on every load, nothing more.
 */
let sample: ClockSample | null = null;
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    sample = readStoredClockSample(window.localStorage.getItem(CLOCK_STORAGE_KEY), Date.now());
  } catch {
    sample = null;
  }
}

/** A new sample, kept when it is the better one — and on the phone when it was measured (the page's reading never is). */
function offer(candidate: ClockSample): void {
  load();
  const next = betterSample(sample, candidate);
  if (next === sample) return;
  sample = next;
  if (next.rttMs === null) return;
  try {
    window.localStorage.setItem(CLOCK_STORAGE_KEY, storedClockSample(next));
  } catch {
    // Not kept for the next page; this one goes on from memory.
  }
}

/** The server's clock now, to the millisecond. */
export function serverClockNow(): number {
  load();
  return serverNowAt(sample, Date.now());
}

/** The page's own reading of the server's clock, as the island wakes: used only while nothing better is known. */
export function seedServerClock(serverNowMs: number): void {
  offer(sampleOfPage(serverNowMs, Date.now()));
}

/** A round trip to the server — the clock's own question or any answer — measured and offered. */
export function measureServerClock(trip: RoundTrip): void {
  const measured = sampleOfRoundTrip(trip);
  if (measured) offer(measured);
}
