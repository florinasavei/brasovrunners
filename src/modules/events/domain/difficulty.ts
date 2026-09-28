import type { events } from "@/db/schema/events";

/**
 * The club's difficulty scale (§526; the owner, 2026-09-27: «ușor, mediu, greuț, greu, foarte
 * greu», each in three steps): five bands in ascending order, each holding three steps, so the scale
 * has fifteen levels and one column says the event's level (`events.difficulty_level`, 1 … 15).
 *
 * What the bands mean, in the owner's words (the backoffice guide says the same):
 * - «Ușor» — short and flat, for anyone;
 * - «Mediu» — 1 the run up Tâmpa, 2 a longer run, 3 long and technical;
 * - «Greuț» — from a half marathon up;
 * - «Greu» — marathons;
 * - «Foarte greu» — ultramarathons and beyond.
 *
 * The keys are this module's own, not the old `event_difficulty` enum's (§412's «foarte ușor …
 * foarte greu», which had no «greuț»): that column is no longer read, and is written only with a
 * best-effort value (`legacyDifficultyOf`) for the release before this one. The one list every
 * caller reads: the editor's band select, the form's validation, the listing's filter boxes, the
 * registry's `difficulty:*` glyphs.
 */
export const DIFFICULTY_BANDS = ["EASY", "MEDIUM", "FAIRLY_HARD", "HARD", "VERY_HARD"] as const;

export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number];

/**
 * The three steps inside a band (§526): 1 the easiest of the band, 3 the hardest. «Mediu 3» is
 * harder than «Mediu 1» and easier than «Greuț 1».
 */
export const DIFFICULTY_STEPS = [1, 2, 3] as const;

export type DifficultyStep = (typeof DIFFICULTY_STEPS)[number];

/** The step the editor offers when nobody chose one yet: the band's middle. */
export const DEFAULT_DIFFICULTY_STEP: DifficultyStep = 2;

/** How many levels the club's scale has: five bands × three steps. The database's CHECK says the same (`events_difficulty_level_in_scale`). */
export const DIFFICULTY_LEVEL_COUNT = DIFFICULTY_BANDS.length * DIFFICULTY_STEPS.length;

/** Whether a value is a level on the scale, 1 … 15. */
export function isDifficultyLevel(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= DIFFICULTY_LEVEL_COUNT;
}

function assertLevel(level: number): void {
  if (!isDifficultyLevel(level)) throw new RangeError(`difficulty level ${level} is outside 1..${DIFFICULTY_LEVEL_COUNT}`);
}

/** The level of a band and a step: «Ușor 1» is 1, «Mediu 2» is 5, «Foarte greu 3» is 15. */
export function difficultyLevel(band: DifficultyBand, step: DifficultyStep = DEFAULT_DIFFICULTY_STEP): number {
  return DIFFICULTY_BANDS.indexOf(band) * DIFFICULTY_STEPS.length + step;
}

/** The band a level is in — ceil(level / 3): the word a reader sees, and the value a filter box ticks. */
export function difficultyBandOf(level: number): DifficultyBand {
  assertLevel(level);
  return DIFFICULTY_BANDS[Math.ceil(level / DIFFICULTY_STEPS.length) - 1];
}

/** The first and the last level of a band: «Greuț» is 7–9 — what a band's filter box ticks, and what its tooltip names (§NNN). */
export function difficultyBandLevels(band: DifficultyBand): { from: number; to: number } {
  return { from: difficultyLevel(band, DIFFICULTY_STEPS[0]), to: difficultyLevel(band, DIFFICULTY_STEPS[DIFFICULTY_STEPS.length - 1]) };
}


/** The step a level is inside its band, 1 … 3. */
export function difficultyStepOf(level: number): DifficultyStep {
  assertLevel(level);
  return (((level - 1) % DIFFICULTY_STEPS.length) + 1) as DifficultyStep;
}

/**
 * What a row stores of the difficulty: the level alone (§526). Optional, not only nullable: a
 * public row the data cache kept from before this release (§333) has no such field, and reads as
 * "not stated" until the next write expires it.
 */
export type StoredDifficulty = { difficultyLevel?: number | null };

/** The event's level as the pages, the filters, the emails and the editor read it — the level column alone (§526). */
export function difficultyLevelOf(row: StoredDifficulty): number | null {
  return isDifficultyLevel(row.difficultyLevel) ? row.difficultyLevel : null;
}

/** The old `event_difficulty` enum, §412's five words: written, never read. */
type LegacyDifficulty = NonNullable<(typeof events.$inferSelect)["difficulty"]>;

/**
 * The old column's best-effort value for a level (§526), so the release before this one — which
 * reads only that column — still shows a word near the truth during the rollback window: the
 * inverse of migration `0104`'s backfill (1 → VERY_EASY, 2 → EASY, 5 → MODERATE, 11 → HARD,
 * 14 → VERY_HARD), the rest to the nearest old word. «Greuț», which the old scale lacked, is HARD.
 * Nothing in this release reads it back.
 */
export function legacyDifficultyOf(level: number): LegacyDifficulty {
  assertLevel(level);
  if (level === 1) return "VERY_EASY";
  if (level <= 3) return "EASY";
  if (level <= 6) return "MODERATE";
  if (level <= 12) return "HARD";
  return "VERY_HARD";
}

/** The two columns a save writes for a level (or for none): the level, and the old column's best-effort word beside it (§526). */
export function storedDifficulty(level: number | null): { difficulty: LegacyDifficulty | null; difficultyLevel: number | null } {
  if (level === null) return { difficulty: null, difficultyLevel: null };
  return { difficulty: legacyDifficultyOf(level), difficultyLevel: level };
}
