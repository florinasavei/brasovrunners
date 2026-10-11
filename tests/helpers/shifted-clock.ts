/**
 * The real clock, moved forward — the calendar-proof check (§NNN, `docs/DEVELOPMENT.md` § Tests
 * that the calendar breaks).
 *
 * A test that pins its fixture to a date ("the race starts 2026-10-11T07:00Z") and then reaches
 * code that reads `new Date()` passes until the real clock walks past that date, and then fails
 * one morning in the pre-commit hook of a release that changed nothing near it. `yarn test:clock`
 * finds those tests before the calendar does: it runs the suite with this file loaded first and
 * `TEST_CLOCK_AT` set to a date ahead, so every argument-less `new Date()`, `Date()` and
 * `Date.now()` — in the test, in `src/`, and in PGlite's own `now()` — answers "that date, plus
 * the time that has passed since the file started". A date the test passes explicitly is left
 * exactly as written, which is the whole point: a test that pins its own `now` is unaffected, and
 * one that leans on the real clock fails here, today, instead of on the day.
 *
 * Loaded only when `TEST_CLOCK_AT` is set (`vitest.config.mts`); `yarn test` never sees it.
 * Vitest's own fake timers (`vi.useFakeTimers`, `vi.setSystemTime`) build on whatever `Date` is
 * global when they install, so a test that sets its own time still gets exactly that time.
 */
const target = process.env.TEST_CLOCK_AT;
if (target) {
  const at = Date.parse(target);
  if (Number.isNaN(at)) throw new Error(`TEST_CLOCK_AT is not a date: ${target}`);

  const RealDate = Date;
  const offset = at - RealDate.now();
  const shiftedNow = () => RealDate.now() + offset;

  globalThis.Date = new Proxy(RealDate, {
    construct(date, args: unknown[], newTarget) {
      return Reflect.construct(date, args.length === 0 ? [shiftedNow()] : args, newTarget) as object;
    },
    apply() {
      return new RealDate(shiftedNow()).toString();
    },
    get(date, property, receiver) {
      if (property === "now") return shiftedNow;
      return Reflect.get(date, property, receiver) as unknown;
    },
  });
}

export {};
