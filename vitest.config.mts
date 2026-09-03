import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node, not jsdom: these are pure-rule and database tests. Component tests arrive with
    // their own environment when there are components worth testing.
    environment: "node",
    include: ["tests/**/*.test.ts"],
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
