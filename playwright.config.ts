import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * Deliberately NOT part of `yarn check`. These need a running server and a real database;
 * `check` runs on every commit and in CI without either, and coupling them would mean no
 * commit is possible on a machine with no Docker. Run them with `yarn test:e2e`.
 *
 * AGENTS.md §20.4 and BR-REQ-041-01 criterion 8 require every journey to run under a mobile
 * viewport as well as desktop, so both projects below are mandatory rather than a nicety —
 * the phone is the design target (BR-BUS-041).
 */
/**
 * Below 32768 on purpose. The port was 47830, which sits inside Linux's ephemeral range
 * (32768–60999): on 2026-09-18 a CI run failed with `EADDRINUSE :::47830` before a single test
 * ran, because some outgoing connection in the same job — the database client, a package
 * fetch — had been handed 47830 as its local port, and `next start` could not bind it. A
 * port under the range cannot be handed out that way. Windows's range starts at 49152, which
 * is why it never happened on a laptop.
 */
const PORT = Number(process.env.E2E_PORT ?? 4783);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,

  /**
   * **One worker in CI, and the reason is the fixture rather than the machine (§212.)**
   *
   * Several suites drive the *same* featured event — `ensureRegistrationIsOpen` sets its mode,
   * its window and its fifty places, and then a spec registers somebody against it. Run in
   * parallel against one database, two workers interleave: one opens registration while another
   * is submitting, or fills the last place another is counting. The symptom is a handful of
   * specs that pass alone and fail together, which is the most expensive kind of red.
   *
   * The honest fix is a fixture per worker — an event of its own, created and torn down — and
   * that is a change to every backoffice spec's setup rather than a line here. Until then CI
   * runs them one at a time and says so, because a suite nobody trusts is worse than a slow one.
   *
   * It costs less than it used to: since §209 a pull request runs one viewport rather than two,
   * so serial-desktop is roughly what parallel-both-projects cost before.
   */
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The HTML report is what the failure artifact uploads; "github" alone writes nothing to
  // disk, which is why the first failing runs had "no valid artifacts" and no trace to read.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL,
    trace: "on-first-retry",
  },

  projects: [
    {
      // 320px is the narrowest viewport BR-REQ-041-01 criterion 1 names. Pixel 5 is 393px,
      // so the width is overridden rather than trusting a device preset to be narrow enough.
      name: "mobile",
      use: { ...devices["Pixel 5"], viewport: { width: 320, height: 720 } },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // The production server, not `next dev`: this is the artefact that gets deployed, and
    // dev-only behaviour has hidden real bugs before.
    command: `yarn build && yarn start --port ${PORT}`,
    url: `${baseURL}/ro`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      APP_BASE_URL: baseURL,
      /**
       * The footer's social marks render only when the club's addresses are configured, and
       * CI configures none — so the specs that measure the marks (`footer.spec.ts`: three 44px
       * targets, none over another, each taking its tap) had nothing to measure there. These
       * are placeholders on the networks' own hosts, never the club's handles; a value already
       * in the environment wins, since Next reads `.env.local` under what is set.
       */
      CLUB_FACEBOOK_URL: process.env.CLUB_FACEBOOK_URL || "https://www.facebook.com/e2e-club",
      CLUB_INSTAGRAM_URL: process.env.CLUB_INSTAGRAM_URL || "https://www.instagram.com/e2e-club",
      CLUB_STRAVA_URL: process.env.CLUB_STRAVA_URL || "https://www.strava.com/clubs/e2e-club",
    },
  },
});
