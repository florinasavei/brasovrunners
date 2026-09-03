import { z } from "zod";

// AGENTS.md §7.1: APP_ENV is the environment identity; NODE_ENV is not.
// AGENTS.md §8: APP_BASE_URL is the single source of every absolute URL the app emits.
const schema = z.object({
  APP_ENV: z.enum(["local", "test", "qa", "production"]).default("local"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  // Optional only until WEEKEND.md step 2 lands the first table; then it is required.
  DATABASE_URL: z.url().optional(),
});

export const env = schema.parse(process.env);
