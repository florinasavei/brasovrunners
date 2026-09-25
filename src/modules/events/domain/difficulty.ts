import type { events } from "@/db/schema/events";

/**
 * The closed set's own levels, in ascending order — the index into this tuple *is* the level
 * (1-based), and the gauge's needle position (§NNN). Five since §NNN (the owner, 2026-09-25:
 * "vreau să fie foarte ușor, ușor, mediu, greu și foarte greu"), three before it (migration
 * `0018`); migration `0078` added `VERY_EASY` before `EASY` and `VERY_HARD` after `HARD`, so the
 * enum's own order is this one.
 *
 * Written here rather than read from `eventDifficulty.enumValues`, so a client bundle that draws a
 * pill or the editor's select does not pull in Drizzle; the `satisfies` below, with the reverse
 * check under it, is what keeps the two in step — a level added to the enum and not here, or here
 * and not there, fails the typecheck. The one list every caller reads: the editor's select, the
 * form's validation, the calendar entry's type, the registry's `difficulty:*` glyphs.
 */
export const DIFFICULTY_LEVELS = ["VERY_EASY", "EASY", "MODERATE", "HARD", "VERY_HARD"] as const satisfies readonly NonNullable<
  (typeof events.$inferSelect)["difficulty"]
>[];

export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

// The reverse direction: every enum value is a level here (a value the tuple forgot fails this line).
type EnumDifficulty = NonNullable<(typeof events.$inferSelect)["difficulty"]>;
export const DIFFICULTY_LEVELS_COVER_THE_ENUM: [EnumDifficulty] extends [DifficultyLevel] ? true : never = true;
