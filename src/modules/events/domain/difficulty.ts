import type { events } from "@/db/schema/events";

/**
 * The difficulty's five bands, in ascending order (§412: "foarte ușor, ușor, mediu, greu și foarte
 * greu"; three before it, migration `0018`) — the `event_difficulty` enum, whose own order is this
 * one since migration `0078`. Since §NNN a band is not the whole answer: each holds three steps, so
 * the club's scale has fifteen levels (`difficultyLevel`), and the band is the word a reader sees.
 *
 * Written here rather than read from `eventDifficulty.enumValues`, so a client bundle that draws a
 * pill or the editor's select does not pull in Drizzle; the `satisfies` below, with the reverse
 * check under it, is what keeps the two in step — a band added to the enum and not here, or here
 * and not there, fails the typecheck. The one list every caller reads: the editor's band select,
 * the form's validation, the listing's filter boxes, the registry's `difficulty:*` glyphs.
 */
export const DIFFICULTY_BANDS = ["VERY_EASY", "EASY", "MODERATE", "HARD", "VERY_HARD"] as const satisfies readonly NonNullable<
  (typeof events.$inferSelect)["difficulty"]
>[];

export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number];

// The reverse direction: every enum value is a band here (a value the tuple forgot fails this line).
type EnumDifficulty = NonNullable<(typeof events.$inferSelect)["difficulty"]>;
export const DIFFICULTY_BANDS_COVER_THE_ENUM: [EnumDifficulty] extends [DifficultyBand] ? true : never = true;

/**
 * The three steps inside a band (§NNN): 1 the band's easier end, 2 its middle, 3 its harder end.
 * «Mediu, treapta 3» is harder than «Mediu, treapta 1» and easier than «Greu, treapta 1».
 */
export const DIFFICULTY_STEPS = [1, 2, 3] as const;

export type DifficultyStep = (typeof DIFFICULTY_STEPS)[number];

/** The step a band stands at when nobody chose one: its middle — what migration `0101` gave every stated band. */
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

/** The level of a band and a step: «Foarte ușor, treapta 1» is 1, «Mediu, treapta 2» is 8, «Foarte greu, treapta 3» is 15. */
export function difficultyLevel(band: DifficultyBand, step: DifficultyStep = DEFAULT_DIFFICULTY_STEP): number {
  return DIFFICULTY_BANDS.indexOf(band) * DIFFICULTY_STEPS.length + step;
}

/** The band a level is in — the word a reader sees, and the value a filter box ticks. */
export function difficultyBandOf(level: number): DifficultyBand {
  assertLevel(level);
  return DIFFICULTY_BANDS[Math.floor((level - 1) / DIFFICULTY_STEPS.length)];
}

/** The step a level is inside its band, 1 … 3. */
export function difficultyStepOf(level: number): DifficultyStep {
  assertLevel(level);
  return (((level - 1) % DIFFICULTY_STEPS.length) + 1) as DifficultyStep;
}

/**
 * What a row stores of the difficulty while the band column still stands beside the level (§NNN).
 * The level may be missing altogether, not only null: a public row the data cache kept from before
 * this release (§333) has no such field, and reads as its band's middle step.
 */
export type StoredDifficulty = {
  difficulty: DifficultyBand | null;
  difficultyLevel?: number | null;
};

/**
 * The event's level as the pages, the filters, the emails and the editor read it — the one reader
 * of the two columns (§NNN).
 *
 * Every save of this release writes the level and its band together, so for its own rows this is
 * the level. The band is read too because the release before this one writes only the band: while
 * migration `0101` runs, and after a rollback, a save there can change the band (or clear it) and
 * leave the level as it was. The band is therefore what says whether there is a difficulty and in
 * which band; the level refines it only when it agrees, and a band the level disagrees with stands
 * at its middle step — the reading `0101` gave every band. When the band column leaves the schema,
 * this becomes the level alone.
 */
export function difficultyLevelOf(row: StoredDifficulty): number | null {
  if (row.difficulty === null) return null;
  if (isDifficultyLevel(row.difficultyLevel) && difficultyBandOf(row.difficultyLevel) === row.difficulty) {
    return row.difficultyLevel;
  }
  return difficultyLevel(row.difficulty);
}

/** The two columns a save writes for a level (or for none): the level, and its band beside it (§NNN). */
export function storedDifficulty(level: number | null): { difficulty: DifficultyBand | null; difficultyLevel: number | null } {
  if (level === null) return { difficulty: null, difficultyLevel: null };
  return { difficulty: difficultyBandOf(level), difficultyLevel: level };
}
