/**
 * Defer form-wide re-reads (the "missing" lists, a tab's mark) until after the next paint (§371),
 * so they never delay Interaction to Next Paint: a task queued from `requestAnimationFrame` runs
 * after that frame, where a bare `setTimeout(…, 0)` usually runs before it.
 *
 * `paintedScheduler` folds a burst of calls into one run. With no frame to wait for (a hidden tab,
 * Node), the callback runs as a plain task.
 */

/** Injectable for a test. */
export type PaintClock = {
  requestAnimationFrame?: (callback: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /** `document.hidden`: a hidden page does not paint. */
  hidden?: () => boolean;
};

/**
 * Built lazily and shared: the keystroke path allocates nothing, and the module also loads where
 * there is no window (server render, unit tests).
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

/** Run `callback` once, in a task after the next frame has been painted. Returns a cancel. */
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

/** `callback` once behind the next paint, however many `schedule()`s before then; `cancel()` for cleanup. */
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
