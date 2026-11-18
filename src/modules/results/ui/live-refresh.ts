/**
 * The clock of `ResultsLiveRefresh` (§NNN), with no React and no DOM in it, so a test drives it with fake timers.
 *
 * While the page is visible it calls `refresh` every `everyMs`; while it is hidden it calls nothing, and once it is visible again it calls
 * at once if a refresh is due, then resumes the period from there. At `until` it stops for good — no call, no timer — and says so once
 * (`onEnd`), so the island takes its line away. A refresh is `router.refresh()`: the page's own server render again, through the public
 * cache — an unchanged page costs one request, and only a result written since (which expires the page, §333) a render and a read.
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
  /** The window's end, in milliseconds since the epoch (`live-window.ts#resultsLiveUntil`). */
  until: number;
  everyMs: number;
  /** Called once, when the window is found over. Never after `stop`. */
  onEnd?: () => void;
};

/**
 * Starts the period; returns what the island calls on `visibilitychange`, and what it calls to stop (its effect's clean-up). The first
 * refresh is a period after the start: the page was just rendered.
 */
export function startLiveRefresh(clock: LiveRefreshClock, options: LiveRefreshOptions): { onVisibilityChange: () => void; stop: () => void } {
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
  const schedule = () => {
    cancel();
    if (over()) return;
    // Never past the window's end: the last timer wakes at `until` and finds it over.
    const wait = Math.max(0, Math.min(options.everyMs - (clock.now() - last), options.until - clock.now()));
    timer = clock.setTimeout(tick, wait);
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
    if (clock.now() - last >= options.everyMs) refreshNow();
    schedule();
  }

  schedule();
  return {
    onVisibilityChange: () => {
      if (over() || !clock.visible()) return;
      if (clock.now() - last >= options.everyMs) refreshNow();
      schedule();
    },
    stop: () => {
      stopped = true;
      cancel();
    },
  };
}
