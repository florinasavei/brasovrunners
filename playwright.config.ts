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
const PORT = Number(process.env.E2E_PORT ?? 47830);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",

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
    env: { PORT: String(PORT), APP_BASE_URL: baseURL },
  },
});
