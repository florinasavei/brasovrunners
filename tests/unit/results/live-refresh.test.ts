import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogueOf } from "@/i18n/catalogue";
import { resultsPublishState, resultsShownSince } from "@/modules/results/domain/from-start";
import {
  RESULTS_LIVE_HOURS_WITHOUT_END,
  RESULTS_REFRESH_MS,
  resultsLiveAt,
  resultsLiveInstants,
  resultsLiveRefreshUntil,
  resultsLiveUntil,
} from "@/modules/results/domain/live-window";
import { startLiveRefresh } from "@/modules/results/ui/live-refresh";

/**
 * §NNN, BR-REQ-039-01 — a race's public «Clasament» from the start and live while it runs (the owner, 2026-11-18: «pe site live trebuie
 * sa vad lista de finish»): the window in which the open page refreshes itself (the start until the end, or six hours for a race saved
 * without one), the clock that refreshes it every 30 seconds while the page is visible and stops at the window's end, and the two words
 * of «Public de la start» — what «Clasament» says of the tick and the moment the public line names.
 */
const STARTS = new Date("2026-11-21T07:00:00.000Z");
const ENDS = new Date("2026-11-21T11:00:00.000Z");
const HOUR = 3_600_000;

describe("§NNN the live window", () => {
  it("runs from the start until the end", () => {
    const race = { startsAt: STARTS, endsAt: ENDS };
    expect(resultsLiveUntil(race)).toEqual(ENDS);
    expect(resultsLiveAt(race, new Date(STARTS.getTime() - 1))).toBe(false);
    expect(resultsLiveAt(race, STARTS)).toBe(true);
    expect(resultsLiveAt(race, new Date(ENDS.getTime() - 1))).toBe(true);
    expect(resultsLiveAt(race, ENDS)).toBe(false);
  });

  it("runs six hours from the start for a race saved without an end — or with an end at or before its start", () => {
    expect(RESULTS_LIVE_HOURS_WITHOUT_END).toBe(6);
    const sixHours = new Date(STARTS.getTime() + 6 * HOUR);
    expect(resultsLiveUntil({ startsAt: STARTS, endsAt: null })).toEqual(sixHours);
    expect(resultsLiveUntil({ startsAt: STARTS, endsAt: STARTS })).toEqual(sixHours);
    expect(resultsLiveUntil({ startsAt: STARTS, endsAt: new Date(STARTS.getTime() - HOUR) })).toEqual(sixHours);
    expect(resultsLiveAt({ startsAt: STARTS, endsAt: null }, new Date(sixHours.getTime() - 1))).toBe(true);
    expect(resultsLiveAt({ startsAt: STARTS, endsAt: null }, sixHours)).toBe(false);
  });

  it("has no window for an event whose date is to be announced", () => {
    expect(resultsLiveUntil({ startsAt: null, endsAt: null })).toBeNull();
    expect(resultsLiveAt({ startsAt: null, endsAt: ENDS }, ENDS)).toBe(false);
  });

  it("refreshes every 30 seconds, and the public line says the same number", () => {
    expect(RESULTS_REFRESH_MS).toBe(30_000);
    expect(catalogueOf("ro").Event.results.live).toContain(`${RESULTS_REFRESH_MS / 1000} de secunde`);
    expect(catalogueOf("en").Event.results.live).toContain(`${RESULTS_REFRESH_MS / 1000} seconds`);
  });
});

describe("§NNN the island from the event's row alone: the tick as saved, a race, the window — never whether a result is stored", () => {
  /** `resultsTicked` is the Administrator's tick as saved; `resultsPublished` on the page's row also needs a stored result, and is not read here. */
  const race = { type: "RACE", resultsTicked: true, startsAt: STARTS, endsAt: ENDS };
  const BEFORE = new Date(STARTS.getTime() - 2 * 24 * HOUR);

  it("refreshes inside the window of a race whose results are ticked — an empty sheet included — and stops at its end", () => {
    expect(resultsLiveRefreshUntil(race, STARTS)).toEqual(ENDS);
    expect(resultsLiveRefreshUntil(race, new Date(ENDS.getTime() - 1))).toEqual(ENDS);
    expect(resultsLiveRefreshUntil(race, new Date(STARTS.getTime() - 1))).toBeNull();
    expect(resultsLiveRefreshUntil(race, ENDS)).toBeNull();
    // Saved without an end: six hours from the start.
    expect(resultsLiveRefreshUntil({ ...race, endsAt: null }, STARTS)).toEqual(new Date(STARTS.getTime() + 6 * HOUR));
  });

  it("never refreshes a race whose results are not ticked, an event that takes none, or an event whose date is to be announced", () => {
    expect(resultsLiveRefreshUntil({ ...race, resultsTicked: false }, STARTS)).toBeNull();
    expect(resultsLiveRefreshUntil({ ...race, type: "GROUP_RUN" }, STARTS)).toBeNull();
    expect(resultsLiveRefreshUntil({ ...race, startsAt: null }, STARTS)).toBeNull();
  });

  it("holds the page to the window's start and end still ahead, so a copy made before the race is made again with the island", () => {
    expect(resultsLiveInstants(race, BEFORE)).toEqual([STARTS, ENDS]);
    expect(resultsLiveInstants(race, STARTS)).toEqual([ENDS]);
    expect(resultsLiveInstants(race, ENDS)).toEqual([]);
    expect(resultsLiveInstants({ ...race, endsAt: null }, BEFORE)).toEqual([STARTS, new Date(STARTS.getTime() + 6 * HOUR)]);
    // Nothing to hold for: not ticked, not a race, no date.
    expect(resultsLiveInstants({ ...race, resultsTicked: false }, BEFORE)).toEqual([]);
    expect(resultsLiveInstants({ ...race, type: "GROUP_RUN" }, BEFORE)).toEqual([]);
    expect(resultsLiveInstants({ ...race, startsAt: null }, BEFORE)).toEqual([]);
  });
});

describe("§NNN «Public de la start»", () => {
  it("says the tick is off, on and waiting for the start, or on and showing", () => {
    expect(resultsPublishState({ resultsPublished: false, startsAt: STARTS }, new Date(STARTS.getTime() - HOUR))).toBe("off");
    expect(resultsPublishState({ resultsPublished: false, startsAt: STARTS }, ENDS)).toBe("off");
    expect(resultsPublishState({ resultsPublished: true, startsAt: STARTS }, new Date(STARTS.getTime() - 1))).toBe("fromStart");
    expect(resultsPublishState({ resultsPublished: true, startsAt: STARTS }, STARTS)).toBe("on");
  });

  it("names the start as the moment the results have been on the page since, when the tick came before it", () => {
    const before = new Date(STARTS.getTime() - 2 * 24 * HOUR);
    const after = new Date(ENDS.getTime() + HOUR);
    expect(resultsShownSince(before, STARTS)).toEqual(STARTS);
    expect(resultsShownSince(after, STARTS)).toEqual(after);
    expect(resultsShownSince(STARTS, STARTS)).toEqual(STARTS);
    expect(resultsShownSince(null, STARTS)).toBeNull();
    expect(resultsShownSince(after, null)).toEqual(after);
  });
});

describe("§NNN the refresh clock", () => {
  let visible = true;
  let refreshes = 0;
  let ended = 0;
  const clock = () => ({
    now: () => Date.now(),
    visible: () => visible,
    refresh: () => {
      refreshes += 1;
    },
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(STARTS);
    visible = true;
    refreshes = 0;
    ended = 0;
  });
  afterEach(() => vi.useRealTimers());

  const start = (until = ENDS.getTime()) => startLiveRefresh(clock(), { until, everyMs: RESULTS_REFRESH_MS, onEnd: () => (ended += 1) });

  it("refreshes every 30 seconds while the page is visible — not before the first period", () => {
    start();
    vi.advanceTimersByTime(29_999);
    expect(refreshes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(refreshes).toBe(1);
    vi.advanceTimersByTime(30_000 * 4);
    expect(refreshes).toBe(5);
  });

  it("refreshes nothing while the page is hidden, then at once on becoming visible again with a refresh due — and the period from there", () => {
    const live = start();
    vi.advanceTimersByTime(30_000);
    expect(refreshes).toBe(1);
    visible = false;
    vi.advanceTimersByTime(5 * 60_000);
    expect(refreshes).toBe(1);
    visible = true;
    live.onVisibilityChange();
    expect(refreshes).toBe(2);
    vi.advanceTimersByTime(29_999);
    expect(refreshes).toBe(2);
    vi.advanceTimersByTime(1);
    expect(refreshes).toBe(3);
  });

  it("waits for the rest of the period when the page comes back before a refresh is due", () => {
    const live = start();
    vi.advanceTimersByTime(10_000);
    visible = false;
    live.onVisibilityChange();
    vi.advanceTimersByTime(5_000);
    visible = true;
    live.onVisibilityChange();
    expect(refreshes).toBe(0);
    vi.advanceTimersByTime(14_999);
    expect(refreshes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(refreshes).toBe(1);
  });

  it("stops at the window's end — no refresh, no timer, the end said once — and becoming visible after it does nothing", () => {
    const until = STARTS.getTime() + 75_000;
    const live = start(until);
    vi.advanceTimersByTime(60_000);
    expect(refreshes).toBe(2);
    expect(ended).toBe(0);
    vi.advanceTimersByTime(15_000);
    expect(ended).toBe(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(refreshes).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
    live.onVisibilityChange();
    expect(refreshes).toBe(2);
    expect(ended).toBe(1);
  });

  it("does nothing at all when started after the window — and stops for good when the island goes", () => {
    start(STARTS.getTime() - 1);
    expect(ended).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(refreshes).toBe(0);

    ended = 0;
    const live = start();
    live.stop();
    vi.advanceTimersByTime(10 * 60_000);
    live.onVisibilityChange();
    expect(refreshes).toBe(0);
    expect(ended).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
