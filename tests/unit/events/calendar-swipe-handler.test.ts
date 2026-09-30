import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §NNN (amending §475) — the swipe's handler itself, driven with a finger's events rather than read
 * as source: a sideways drag pushes the arrows' own address (a period's path since §NNN, never
 * `?month=`), a mouse or an up-and-down drag pushes nothing, and the calendar that mounts with the
 * next period slides in from the side the thumb pushed towards — each period is a page of its own
 * path now, so the step has to be handed across to a new instance.
 *
 * The tests run in Node without a DOM, so React's hooks are stood in for: a ref is a plain object,
 * a transition runs at once, and an effect is collected to be run by hand.
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

let refs: { current: unknown }[] = [];
let effects: (() => void | (() => void))[] = [];
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: (initial: unknown) => {
      const ref = { current: initial };
      refs.push(ref);
      return ref;
    },
    useTransition: () => [false, (run: () => void) => run()],
    useEffect: (effect: () => void | (() => void)) => {
      effects.push(effect);
    },
  };
});

const { default: CalendarSwipe } = await import("@/modules/events/ui/CalendarSwipe");

type Handlers = {
  onPointerDown: (event: object) => void;
  onPointerMove: (event: object) => void;
  onPointerUp: (event: object) => void;
  onPointerCancel: (event: object) => void;
};

const PREVIOUS = "/ro/calendar/2026-08";
const NEXT = "/ro/calendar/2026-10";

/** One calendar, as React would mount it: its element, its track (the ref the slide moves) and its effects. */
function mount() {
  refs = [];
  effects = [];
  const element = CalendarSwipe({ previousHref: PREVIOUS, nextHref: NEXT, children: null }) as ReactElement<Handlers>;
  // The refs in the order the component asks for them: the box, then the track.
  const track = { style: {} as Record<string, string> };
  refs[1].current = track;
  return { handlers: element.props, track, runEffects: () => effects.forEach((effect) => effect()) };
}

/** A drag from (x0, y0) to (x1, y1) with one pointer, taking `ms`. */
function drag(handlers: Handlers, { from, to, ms = 300, pointerType = "touch" }: { from: [number, number]; to: [number, number]; ms?: number; pointerType?: string }) {
  handlers.onPointerDown({ pointerType, isPrimary: true, pointerId: 1, clientX: from[0], clientY: from[1], timeStamp: 0 });
  handlers.onPointerMove({ pointerId: 1, clientX: to[0], clientY: to[1] });
  handlers.onPointerUp({ pointerId: 1, clientX: to[0], clientY: to[1], timeStamp: ms });
}

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe("the calendar's swipe handler (§475, §NNN)", () => {
  it("pushes the next period's path on a drag to the left, and the previous one's on a drag to the right", () => {
    const { handlers } = mount();
    drag(handlers, { from: [300, 100], to: [180, 104] });
    expect(push).toHaveBeenLastCalledWith(NEXT, { scroll: false });
    drag(handlers, { from: [60, 100], to: [200, 96] });
    expect(push).toHaveBeenLastCalledWith(PREVIOUS, { scroll: false });
    // Never a query: the address the router is asked for is a page of its own.
    for (const [address] of push.mock.calls) expect(address).not.toContain("?");
  });

  it("pushes nothing for a mouse, an up-and-down drag, a short one or a cancelled one", () => {
    const { handlers } = mount();
    drag(handlers, { from: [300, 100], to: [180, 100], pointerType: "mouse" });
    drag(handlers, { from: [200, 100], to: [190, 300] });
    drag(handlers, { from: [200, 100], to: [180, 100], ms: 1000 });
    handlers.onPointerDown({ pointerType: "touch", isPrimary: true, pointerId: 2, clientX: 300, clientY: 100, timeStamp: 0 });
    handlers.onPointerMove({ pointerId: 2, clientX: 150, clientY: 100 });
    handlers.onPointerCancel({ pointerId: 2, clientX: 150, clientY: 100, timeStamp: 200 });
    expect(push).not.toHaveBeenCalled();
  });

  it("hands the step to the calendar that mounts with the next period, which slides in from the right", () => {
    const leaving = mount();
    drag(leaving.handlers, { from: [300, 100], to: [180, 104] });
    // The next period is a new page, so a new calendar mounts and runs its effects.
    const arriving = mount();
    arriving.runEffects();
    expect(arriving.track.style.transform).toBe("translateX(24px)");
    // Read once: a calendar met later, with no swipe before it, simply stands.
    const later = mount();
    later.runEffects();
    expect(later.track.style.transform).toBe("");
  });

  it("slides the arriving calendar in from the left after a step back", () => {
    const leaving = mount();
    drag(leaving.handlers, { from: [60, 100], to: [200, 96] });
    const arriving = mount();
    arriving.runEffects();
    expect(arriving.track.style.transform).toBe("translateX(-24px)");
  });
});
