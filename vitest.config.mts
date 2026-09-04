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
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
