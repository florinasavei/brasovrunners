import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Read the developer's local connection string, the same way drizzle.config.ts does. In CI
// DATABASE_URL is already in the environment and there is no .env.local, so this is a no-op.
config({ path: ".env.local", quiet: true });

/**
 * The concurrency suite, which needs a real PostgreSQL server.
 *
 * A second configuration rather than a flag on the first, because the two have opposite
 * requirements: `yarn test` must run on a bare machine with no database, since it gates every
 * commit, and this one cannot run without two genuine connections. Run it with
 * `yarn test:concurrency` after `docker compose up -d db && yarn db:migrate`.
 *
 * Tests are serial: they contend for the same rows on purpose, and running files in parallel
 * would make one suite's lock another suite's timeout.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/concurrency/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
