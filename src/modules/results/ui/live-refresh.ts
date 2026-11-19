/**
 * The clock of `ResultsLiveRefresh` (§985), with no React and no DOM in it, so a test drives it with fake timers.
 *
 * Nothing before `from`, the window's start: a page drawn before the race arms one timer to it and asks nothing — not on the timer, not
 * on becoming visible — waking at most once a day to arm again (`LIVE_REFRESH_MAX_WAIT_MS`), since a race may be ticked weeks ahead and
 * a browser fires at once a timer set past 2^31 − 1 milliseconds (about 24.8 days). From `from`, while the page is visible it calls
 * `refresh` every `everyMs` — at the start itself when the page was drawn a period or more before it; while it is hidden it calls
 * nothing, and once it is visible again it calls at once if a refresh is due, then resumes the period from there. At `until` it stops
 * for good — no call, no timer — and says so once (`onEnd`), so the island takes its line away. A refresh is `router.refresh()`: the
 * page's own server render again — for an anonymous visitor the static page, one request the CDN answers while nothing changed, and a
 * render once a save expired it (§333, §549); for a signed-in tab, or an address with a query the page reads, the live twin, a server
 * render every time (§577).
 */
export type LiveRefreshClock = {
  /** Milliseconds since the epoch: `Date.now`. */
  now: () => number;
  /** `document.visibilityState === "visible"`. */
  visible: () => boolean;
  /** `router.refresh()`. */
  refresh: () => void;
  /** The browser's timers. */
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type LiveRefreshOptions = {
  /**
   * The window's start, in milliseconds since the epoch (the event's start, `live-window.ts#resultsLiveRefreshWindow`): nothing is asked
   * before it. Past — or absent — once the race runs.
   */
  from?: number;
  /** The window's end, in milliseconds since the epoch (`live-window.ts#resultsLiveUntil`). */
  until: number;
  everyMs: number;
  /** Called once, when the window is found over. Never after `stop`. */
  onEnd?: () => void;
};

/**
 * The longest one timer sleeps: a day, far below the 2^31 − 1 milliseconds past which a browser fires a timer at once. A page drawn weeks
 * before the race wakes once a day, finds the start still ahead and arms again — asking nothing.
 */
export const LIVE_REFRESH_MAX_WAIT_MS = 86_400_000;

/**
 * Starts the period; returns what the island calls on `visibilitychange`, and what it calls to stop (its effect's clean-up). The first
 * refresh is a period after the page was drawn — it was just rendered — and never before `from`.
 */
export function startLiveRefresh(clock: LiveRefreshClock, options: LiveRefreshOptions): { onVisibilityChange: () => void; stop: () => void } {
  const from = options.from ?? Number.NEGATIVE_INFINITY;
  let last = clock.now();
  let timer: unknown = null;
  let stopped = false;
  let ended = false;

  const cancel = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };
  /** Whether the window is over — and, the first time it is found so, the end said. */
  const over = () => {
    if (stopped) return true;
    if (clock.now() < options.until) return false;
    cancel();
    if (!ended) {
      ended = true;
      options.onEnd?.();
    }
    return true;
  };
  /** A refresh is due: the window has begun, and a period has passed since the page was drawn or last refreshed. */
  const due = () => clock.now() >= from && clock.now() - last >= options.everyMs;
  const schedule = () => {
    cancel();
    if (over()) return;
    const now = clock.now();
    // The next refresh: a period after the last, never before the window's start. The timer never sleeps past the window's end (it
    // wakes at `until` and finds it over), nor longer than a day (it wakes, finds the start still ahead, and arms again).
    const next = Math.max(from, last + options.everyMs);
    const wait = Math.min(next - now, options.until - now, LIVE_REFRESH_MAX_WAIT_MS);
    timer = clock.setTimeout(tick, Math.max(0, wait));
  };
  const refreshNow = () => {
    last = clock.now();
    clock.refresh();
  };
  function tick() {
    timer = null;
    if (over()) return;
    // Hidden: nothing now, and no timer — becoming visible again decides.
    if (!clock.visible()) return;
    if (due()) refreshNow();
    schedule();
  }

  schedule();
  return {
    onVisibilityChange: () => {
      if (over() || !clock.visible()) return;
      if (due()) refreshNow();
      schedule();
    },
    stop: () => {
      stopped = true;
      cancel();
    },
  };
}
