import { vi } from "vitest";

/**
 * `work`, with the real clock reading `instant` while it runs (§NNN).
 *
 * For a path that reads `new Date()` although the test gave its own `now` — a link page's read
 * (`readRegistrationTokenContext`), the sign-in's allowlist, the drain — so that the read happens
 * on the fixture's calendar, not on the day the suite runs. Without it the test passes until the
 * real clock walks past one of the fixture's dates, then fails in somebody's pre-commit hook
 * (`docs/DEVELOPMENT.md` § Tests that the calendar breaks). Only `Date` is faked, and it stands
 * still at `instant` until `work` settles; timers stay real, so PGlite and every `await` run as
 * usual, and PGlite's own `now()` reads the same instant.
 */
export async function atTheClock<T>(instant: Date, work: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instant);
  try {
    return await work();
  } finally {
    vi.useRealTimers();
  }
}
