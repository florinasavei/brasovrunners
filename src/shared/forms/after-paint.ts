/**
 * Work that answers a keystroke or a press but that the reader does not need in the same frame
 * (§371): the "fill in first" sentence under a button, the "missing for publication" list, a
 * tab's "· incomplet" mark. Each re-reads the whole form, and on the event editor — a few hundred
 * boxes — a re-read is milliseconds a phone does not have while it owes the reader the letter
 * just typed or the "Se salvează…" just pressed. Interaction to Next Paint counts every task that
 * runs before the frame the interaction leads to, and a `setTimeout(…, 0)` queued by a listener
 * usually runs before it; so the work is queued *behind* that frame instead: the next animation
 * frame is the one the browser is about to paint, and a task queued from it runs after the paint.
 *
 * `afterPaint` runs a callback once, after the next paint; `paintedScheduler` is the listener's
 * shape — many calls between two frames (a burst of keystrokes, a dozen mutations from one React
 * commit) are one run, after the frame, reading the form as it stands then.
 *
 * Where there is no frame to wait for — a hidden tab does not paint, and the unit tests run in
 * Node — the callback is queued as a plain task, so it still runs, only without the wait.
 */

/** The two browser clocks this needs, injectable for a test. */
export type PaintClock = {
  requestAnimationFrame?: (callback: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /** Whether the page is hidden and will not paint (`document.hidden`). */
  hidden?: () => boolean;
};

/**
 * The page's own clocks, built once on first use and shared: `afterPaint` runs once per burst of
 * every keystroke, the path this module exists to keep light, so it allocates no clock of its own.
 * Lazily, because the module is also imported where there is no window (the server's render, the
 * unit tests), and there the frame half is simply absent.
 */
let pageClock: PaintClock | undefined;

function browserClock(): PaintClock {
  if (pageClock) return pageClock;
  const scope = globalThis as typeof globalThis & { document?: { hidden?: boolean } };
  pageClock = {
    requestAnimationFrame: typeof scope.requestAnimationFrame === "function" ? (callback) => scope.requestAnimationFrame(callback) : undefined,
    cancelAnimationFrame: typeof scope.cancelAnimationFrame === "function" ? (handle) => scope.cancelAnimationFrame(handle) : undefined,
    setTimeout: (callback, delay) => scope.setTimeout(callback, delay),
    clearTimeout: (handle) => scope.clearTimeout(handle as ReturnType<typeof setTimeout>),
    hidden: () => scope.document?.hidden === true,
  };
  return pageClock;
}

/**
 * Run `callback` once, in a task after the next frame has been painted. Returns a cancel.
 */
export function afterPaint(callback: () => void, clock: PaintClock = browserClock()): () => void {
  let frame: number | undefined;
  let timer: unknown;
  let cancelled = false;
  const later = () => {
    frame = undefined;
    if (!cancelled) timer = clock.setTimeout(callback, 0);
  };
  if (clock.requestAnimationFrame && !clock.hidden?.()) frame = clock.requestAnimationFrame(later);
  else timer = clock.setTimeout(callback, 0);
  return () => {
    cancelled = true;
    if (frame !== undefined) clock.cancelAnimationFrame?.(frame);
    if (timer !== undefined) clock.clearTimeout(timer);
  };
}

/**
 * `callback` behind the next paint, however many times it is asked for before then: the first
 * `schedule()` queues it, the ones after it until it runs are the same run. `cancel()` drops a
 * queued run — an effect's cleanup, so a component gone from the page is never measured.
 */
export function paintedScheduler(callback: () => void, clock?: PaintClock): { schedule: () => void; cancel: () => void } {
  let cancel: (() => void) | null = null;
  return {
    schedule: () => {
      if (cancel) return;
      cancel = afterPaint(() => {
        cancel = null;
        callback();
      }, clock);
    },
    cancel: () => {
      cancel?.();
      cancel = null;
    },
  };
}
