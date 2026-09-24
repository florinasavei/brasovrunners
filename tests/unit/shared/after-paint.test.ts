import { describe, expect, it, vi } from "vitest";
import { afterPaint, type PaintClock, paintedScheduler } from "@/shared/forms/after-paint";

/**
 * `afterPaint` and `paintedScheduler` (§371) — the work a keystroke or a press starts but the
 * reader does not need in the same frame, queued behind the frame the interaction leads to so the
 * browser paints first (Interaction to Next Paint).
 *
 * The browser's two clocks are replaced by a hand-driven one: `frame()` is the browser reaching
 * its next animation frame (the paint follows it), `tick()` runs the tasks queued so far. What is
 * checked is the order — nothing runs before the frame, one run per frame however many asks — and
 * the fallbacks: no frame to wait for in Node or a hidden tab, and a cancel from an effect's
 * cleanup that leaves nothing behind.
 */
function handClock({ frames = true, hidden = false }: { frames?: boolean; hidden?: boolean } = {}) {
  let frameQueue: Array<{ id: number; callback: () => void }> = [];
  let taskQueue: Array<{ id: number; callback: () => void }> = [];
  let next = 1;
  const clock: PaintClock = {
    ...(frames
      ? {
          requestAnimationFrame: (callback: () => void) => {
            const id = next++;
            frameQueue.push({ id, callback });
            return id;
          },
          cancelAnimationFrame: (id: number) => {
            frameQueue = frameQueue.filter((entry) => entry.id !== id);
          },
        }
      : {}),
    setTimeout: (callback: () => void) => {
      const id = next++;
      taskQueue.push({ id, callback });
      return id;
    },
    clearTimeout: (id: unknown) => {
      taskQueue = taskQueue.filter((entry) => entry.id !== id);
    },
    hidden: () => hidden,
  };
  return {
    clock,
    frame: () => {
      const due = frameQueue;
      frameQueue = [];
      for (const entry of due) entry.callback();
    },
    tick: () => {
      const due = taskQueue;
      taskQueue = [];
      for (const entry of due) entry.callback();
    },
    pending: () => ({ frames: frameQueue.length, tasks: taskQueue.length }),
  };
}

describe("afterPaint runs its work after the next frame, never before it", () => {
  it("waits for the frame, then queues a task behind the paint", () => {
    const hand = handClock();
    const work = vi.fn();
    afterPaint(work, hand.clock);

    // A task that was already queued runs first: this is what a `setTimeout(…, 0)` from the
    // listener used to be — ahead of the paint.
    hand.tick();
    expect(work).not.toHaveBeenCalled();
    // The browser reaches its frame and paints; the work is queued behind it.
    hand.frame();
    expect(work).not.toHaveBeenCalled();
    hand.tick();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("is a plain task where nothing paints: in Node, and in a hidden tab", () => {
    for (const hand of [handClock({ frames: false }), handClock({ hidden: true })]) {
      const work = vi.fn();
      afterPaint(work, hand.clock);
      expect(hand.pending().frames).toBe(0);
      hand.tick();
      expect(work).toHaveBeenCalledTimes(1);
    }
  });

  it("runs with the real clocks too, where the environment has only timers", async () => {
    const work = vi.fn();
    afterPaint(work);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("does nothing once cancelled, whether before the frame or between the frame and the task", () => {
    const beforeFrame = handClock();
    const early = vi.fn();
    afterPaint(early, beforeFrame.clock)();
    beforeFrame.frame();
    beforeFrame.tick();
    expect(early).not.toHaveBeenCalled();
    expect(beforeFrame.pending()).toEqual({ frames: 0, tasks: 0 });

    const afterFrame = handClock();
    const late = vi.fn();
    const cancel = afterPaint(late, afterFrame.clock);
    afterFrame.frame();
    cancel();
    afterFrame.tick();
    expect(late).not.toHaveBeenCalled();
  });
});

describe("paintedScheduler folds a burst of asks into one run after the frame", () => {
  it("runs once for ten keystrokes between two frames, and again for the next burst", () => {
    const hand = handClock();
    const measure = vi.fn();
    const scheduler = paintedScheduler(measure, hand.clock);

    for (let key = 0; key < 10; key += 1) scheduler.schedule();
    expect(hand.pending()).toEqual({ frames: 1, tasks: 0 });
    hand.frame();
    hand.tick();
    expect(measure).toHaveBeenCalledTimes(1);

    // The next burst is a new run: a scheduler never goes quiet after its first.
    scheduler.schedule();
    scheduler.schedule();
    hand.frame();
    hand.tick();
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("asks again after a run are honoured, even from inside the run", () => {
    const hand = handClock();
    let runs = 0;
    const scheduler = paintedScheduler(() => {
      runs += 1;
      if (runs === 1) scheduler.schedule();
    }, hand.clock);
    scheduler.schedule();
    hand.frame();
    hand.tick();
    hand.frame();
    hand.tick();
    expect(runs).toBe(2);
  });

  it("drops a queued run on cancel — an effect's cleanup — and can be used again after", () => {
    const hand = handClock();
    const measure = vi.fn();
    const scheduler = paintedScheduler(measure, hand.clock);
    scheduler.schedule();
    scheduler.cancel();
    hand.frame();
    hand.tick();
    expect(measure).not.toHaveBeenCalled();

    scheduler.schedule();
    hand.frame();
    hand.tick();
    expect(measure).toHaveBeenCalledTimes(1);
  });
});
