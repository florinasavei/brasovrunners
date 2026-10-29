import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { CATEGORIES, categorize } from "./tests/categories.mjs";

const byCategory = categorize(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  test: {
    // Node, not jsdom: these are pure-rule and database tests. Component tests arrive with
    // their own environment when there are components worth testing.
    environment: "node",
    /**
     * The test environment, as `SETUP.md` §10 defines it: the same switcher and capture
     * mode as local, and photo storage in memory (`STORAGE_MODE=fake`) rather than under
     * `.media/` on the developer's disk. Nothing in `env.ts` behaves differently between
     * `local` and `test` except that.
     */
    env: { APP_ENV: "test" },
    /**
     * The calendar-proof check (§712): `yarn test:clock` sets `TEST_CLOCK_AT` and the real clock
     * of every test file reads that date instead of today, so a fixture the calendar will reach
     * fails now rather than on the morning it is reached. Unset — every ordinary run — nothing
     * is loaded.
     */
    setupFiles: process.env.TEST_CLOCK_AT || process.env.TEST_CLOCK_OFFSET_MS ? ["./tests/helpers/shifted-clock.mjs"] : [],
    /**
     * The test categories (§NNN, `tests/categories.mjs`): one project each, every `tests/**\/*.test.ts` in exactly
     * one, so `yarn test --project=<name>` runs a category alone and `yarn test:skip` leaves some out. No `include`
     * at the root: under `extends: true` a project's include is added to the root's, and every project ran every
     * file (measured 2026-10-28). The concurrency suite is in no category: it needs two real connections to a
     * PostgreSQL server, which this command must never require — `yarn check` runs on every commit and in CI
     * without a database. It has its own configuration and its own command — see vitest.concurrency.config.mts.
     */
    projects: CATEGORIES.map((category) => ({ extends: true, test: { name: category.name, include: byCategory.get(category.name) } })),
    // PGlite instances are per-file and hold WebAssembly memory, so the worker count is
    // capped rather than left to the core count; serialising the files entirely (the setting
    // until 2026-09-18) made the suite take five minutes on a 32-core machine, which the
    // owner called out. CI's four cores get four.
    //
    // Twelve, measured rather than guessed (§171): on the owner's 32-core machine the whole
    // suite takes 58.6s at eight and 44.9s at twelve. Sixteen saves a further 1.5s for a third
    // more CPU and a third more memory — twelve is where the curve flattens, and the memory
    // ceiling is what caps it at all: twelve PGlite instances are about half a gigabyte.
    //
    // …and never more than the machine has (2026-10-20): twelve workers on CI's four cores, or on a cloud session's
    // four, thrashed — every PGlite start competed for the same cores and `beforeAll` hooks ran past their thirty
    // seconds. The cap is the core count, twelve at most.
    fileParallelism: true,
    maxWorkers: Math.min(12, availableParallelism()),
    /**
     * The migrated database is dumped once, before the workers start, and every test file loads it instead of running
     * the migrations itself (`tests/helpers/pglite-snapshot.ts`): about three seconds saved per database-backed file.
     */
    globalSetup: ["./tests/helpers/pglite-global-setup.ts"],
    testTimeout: 30_000,
    /**
     * The same budget for a hook as for a test, because `beforeAll` here does strictly more
     * work than most tests do: `createTestDatabase()` starts a PostgreSQL compiled to
     * WebAssembly and applies every migration to it.
     *
     * Vitest's default is 10s, and it silently applied only to hooks — a file with three
     * `describe` blocks builds three of these instances, and on a machine with anything else
     * running the second and third exceeded it. The failure then reads as "Hook timed out",
     * which looks like a broken test and is really a budget set for a cheaper kind of work.
     */
    hookTimeout: 30_000,
    server: {
      deps: {
        // next-intl's navigation helpers import `next/navigation`, which Node cannot resolve
        // on its own when the package is left external. Letting Vite transform next-intl makes
        // it resolve the same way the application does — which is the point: a test that
        // stubbed the route helpers would prove nothing about the URLs they build.
        inline: ["next-intl"],
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
