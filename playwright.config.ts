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
/**
 * `E2E_DEV=1` runs the suite against `next dev` rather than a production build (§370) — for
 * `tests/e2e/dev-routes.spec.ts`, which exists because a page can work built and fail under
 * `yarn dev`. It gets a port of its own, 4784, so it never reuses a production server a routine
 * run left on 4783 and reports that server's answers as the development one's.
 */
const DEV = process.env.E2E_DEV === "1";
const PORT = Number(process.env.E2E_PORT ?? (DEV ? 4784 : 4783));
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
   *
   * The wall clock is bought back across machines instead (§NNN): CI splits the suite with
   * `--shard=i/n` over several runners, each with its own PostgreSQL seeded from nothing, and
   * this one worker is per shard — the isolation this comment is about holds inside each.
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
    // dev-only behaviour has hidden real bugs before. `E2E_DEV=1` is the one exception, and it
    // exists for the reverse case — a bug only `next dev` shows (§370).
    command: DEV ? `yarn next dev --port ${PORT}` : `yarn build && yarn start --port ${PORT}`,
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
      /**
       * A developer's own `.env.local` legitimately carries a real `NEON_API_KEY` and
       * `NEON_PROJECT_ID` — this same file backs `yarn build && yarn start` above — but the
       * suite must never call the real Neon API. `env.ts`'s `E2E_DISABLE_NEON` blanks both, the
       * same way `CLUB_*` above wins over `.env.local`: set here, before Next loads that file.
       */
      E2E_DISABLE_NEON: "true",
      /**
       * The weather forecast (§402) the same way: the suite's server answers every forecast with
       * one fixed hour (`weather/source.ts`, `stubForecast`) and never reaches Open-Meteo, so a
       * spec can read the row's words and a run does not depend on somebody else's API.
       */
      E2E_WEATHER_STUB: "true",
      /**
       * A save that carries a YouTube film fetches its poster from `i.ytimg.com`
       * (`modules/media/video-poster.ts`) — a real third party this suite's CI runner may have
       * no route to. `env.ts`'s `E2E_STUB_YOUTUBE_POSTER` swaps that one fetch for an
       * in-process fixture, the same shape as `E2E_DISABLE_NEON` above.
       */
      E2E_STUB_YOUTUBE_POSTER: "true",
      /**
       * Under CI's `APP_ENV=test` the server's store is a Map the specs cannot reach; this lets a
       * miss there read `.media/` on the disk, where `older-pictures.spec.ts` writes a picture as
       * the site stored one before §414 (`env.ts`, `E2E_FAKE_MEDIA_FROM_DISK`, §430).
       */
      E2E_FAKE_MEDIA_FROM_DISK: "true",
    },
  },
});
