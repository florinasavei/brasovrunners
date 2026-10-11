// The real clock, moved forward — the calendar-proof check (§712, `docs/DEVELOPMENT.md` § Tests that
// the calendar breaks).
//
// A test that pins its fixture to a date ("the race starts 2026-10-11T07:00Z") and then reaches code
// that reads `new Date()` passes until the real clock walks past that date, and then fails one
// morning in the pre-commit hook of a release that changed nothing near it. `yarn test:clock` finds
// those tests before the calendar does: it runs the suite with this file loaded first and the clock
// moved, so every argument-less `new Date()`, `Date()` and `Date.now()` — in the test, in `src/`, in
// PGlite's own `now()` — answers "the moved date, plus the time that has passed since". A date the
// test writes is left exactly as written, which is the whole point: a test that pins its own `now`
// is unaffected, and one that leans on the real clock fails here, today, instead of on the day.
//
// Plain JavaScript so that it loads three ways: as Vitest's setup file (`vitest.config.mts`, only
// while `TEST_CLOCK_AT` is set), and through `NODE_OPTIONS=--import` in every Node process the run
// starts — Vitest's workers and a script a test spawns, which must read the same moved clock as the
// test that compares with it. The move is carried as one offset (`TEST_CLOCK_OFFSET_MS`), fixed by
// the first process to load this file, so a process started minutes later is not minutes behind.
// Vitest's own fake timers (`vi.useFakeTimers`, `vi.setSystemTime`) build on whatever `Date` is
// global when they install, so a test that sets its own time still gets exactly that time.

const MOVED = Symbol.for("shifted clock: the unmoved Date");

if (!globalThis[MOVED] && (process.env.TEST_CLOCK_OFFSET_MS || process.env.TEST_CLOCK_AT)) {
  const RealDate = Date;
  let offset = Number(process.env.TEST_CLOCK_OFFSET_MS);
  if (!process.env.TEST_CLOCK_OFFSET_MS) {
    const at = RealDate.parse(process.env.TEST_CLOCK_AT ?? "");
    if (Number.isNaN(at)) throw new Error(`TEST_CLOCK_AT is not a date: ${process.env.TEST_CLOCK_AT}`);
    offset = at - RealDate.now();
    process.env.TEST_CLOCK_OFFSET_MS = String(offset);
  }
  if (!Number.isFinite(offset)) throw new Error(`TEST_CLOCK_OFFSET_MS is not a number: ${process.env.TEST_CLOCK_OFFSET_MS}`);

  // Every Node process started from here on loads this file first, with the same offset.
  const self = `--import=${import.meta.url}`;
  if (!(process.env.NODE_OPTIONS ?? "").includes(self)) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} ${self}`.trim();

  const shiftedNow = () => RealDate.now() + offset;
  globalThis.Date = new Proxy(RealDate, {
    construct(date, args, newTarget) {
      return Reflect.construct(date, args.length === 0 ? [shiftedNow()] : args, newTarget);
    },
    apply() {
      return new RealDate(shiftedNow()).toString();
    },
    get(date, property, receiver) {
      if (property === "now") return shiftedNow;
      return Reflect.get(date, property, receiver);
    },
  });
  // The unmoved constructor, for the one test of this file that must start from it.
  globalThis[MOVED] = RealDate;
}
