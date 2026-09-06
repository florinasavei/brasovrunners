import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node, not jsdom: these are pure-rule and database tests. Component tests arrive with
    // their own environment when there are components worth testing.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The concurrency suite needs two real connections to a PostgreSQL server, which this
    // command must never require: `yarn check` runs on every commit and in CI without a
    // database. It has its own configuration and its own command — see
    // vitest.concurrency.config.mts.
    exclude: ["tests/concurrency/**", "node_modules/**", "dist/**", ".next/**"],
    // PGlite instances are per-file and hold WebAssembly memory; serialising files keeps
    // peak memory sane and makes failures easier to read.
    fileParallelism: false,
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
