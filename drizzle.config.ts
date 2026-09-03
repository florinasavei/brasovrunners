import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    // Migrations run against the direct (non-pooled) URL where the provider offers one.
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
