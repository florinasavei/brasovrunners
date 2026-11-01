import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The fork check (§882): the platform built from another club's folder.
 *
 * `@club` points at `tests/fixtures/fork-club/` — a made-up club with its own name, short mark, slug, city, county,
 * zone and hashtag — instead of `club/`, and `tests/fork/` renders what carries the club's identity (the page
 * title, the calendar, the structured data, the From line, the translation glossary, the place matcher, the public
 * list's matcher, a test registration, the export file, a blank draft, a seeded date) and finds the made-up club's
 * words there and none of Brașov's. A literal of this club's left in the code shows up here as a fork would ship it.
 *
 * Its own configuration because the alias is the whole point: under `vitest.config.mts` the same files would read
 * the real club. `tests/categories.mjs` leaves `tests/fork/` out of `yarn test` for the same reason. `yarn test:fork`
 * runs it, and CI runs it as a step of the `checks` job (`.github/workflows/docs-check.yml`).
 */
export default defineConfig({
  test: {
    environment: "node",
    // The same environment as `yarn test` (`vitest.config.mts`).
    env: { APP_ENV: "test" },
    include: ["tests/fork/**/*.test.ts"],
    // The test registration goes through the real allocator, on PGlite like every database test.
    globalSetup: ["./tests/helpers/pglite-global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    server: { deps: { inline: ["next-intl"] } },
  },
  resolve: {
    alias: {
      "@club": fileURLToPath(new URL("./tests/fixtures/fork-club", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
