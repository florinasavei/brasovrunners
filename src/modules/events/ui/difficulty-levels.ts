import type { events } from "@/db/schema/events";

/**
 * The closed set's own levels (migration `0018`), in ascending order — the index into this tuple
 * *is* the level (1-based). Written here rather than read from `eventDifficulty.enumValues`, so a
 * client bundle that draws a pill does not pull in Drizzle; the `satisfies` below is what keeps
 * the two in step — a level added to the enum and not here, or here and not there, fails the
 * typecheck.
 */
export const DIFFICULTY_LEVELS = ["EASY", "MODERATE", "HARD"] as const satisfies readonly NonNullable<
  (typeof events.$inferSelect)["difficulty"]
>[];

export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];
