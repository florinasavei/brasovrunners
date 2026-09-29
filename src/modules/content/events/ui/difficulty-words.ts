import {
  DIFFICULTY_BANDS,
  DIFFICULTY_LEVEL_COUNT,
  DIFFICULTY_STEPS,
  type DifficultyBand,
  type DifficultyStep,
  difficultyBandLevelList,
  difficultyBandLevels,
  difficultyLadder,
  difficultyLevel,
} from "@/modules/events/domain/difficulty";

/** A translator narrow enough for the difficulty's words: a plain key with an optional value map. */
type Words = (key: string, values?: Record<string, string | number>) => string;

/** A step's words, one per segment of «Nivelul». */
export type StepWords = Record<`step${DifficultyStep}`, string>;

/**
 * The editor's «?» beside «Dificultate» and «Nivelul» (§528, §563), one line each, in order:
 * «Ușor», «Mediu» per level, the other bands, what the levels of a band mean — the owner's words,
 * which «Ghid» points to. Each band's range and each «Mediu» level come from the domain, never
 * typed: «mediu 4: alergarea de pe Tâmpa», «greuț 7–9: de la semimaraton în sus». `t` is the
 * `Admin` catalogue. A newline is a line in the tooltip (§257).
 */
export function difficultyScaleText(t: Words): string {
  const medium = difficultyBandLevelList("MEDIUM");
  return [
    t("editor.difficultyScale.EASY", difficultyBandLevels("EASY")),
    t("editor.difficultyScale.MEDIUM1", { level: medium[0] }),
    t("editor.difficultyScale.MEDIUM2", { level: medium[1] }),
    t("editor.difficultyScale.MEDIUM3", { level: medium[2] }),
    t("editor.difficultyScale.FAIRLY_HARD", difficultyBandLevels("FAIRLY_HARD")),
    t("editor.difficultyScale.HARD", difficultyBandLevels("HARD")),
    t("editor.difficultyScale.VERY_HARD", difficultyBandLevels("VERY_HARD")),
    t("editor.difficultyScale.steps"),
  ].join("\n");
}

/**
 * «Nivelul»'s words (§563, amending §526 and §537): its label; the rule in one sentence under it —
 * «Nivelul e de la 1 (ușor) la 15 (foarte greu): fiecare bandă are trei niveluri — ușor 1–3, mediu
 * 4–6, …», every number from the domain; the whole scale behind its «?»; and each segment's
 * accessible name — per band the level of fifteen («Nivelul 5 din 15»), and a place in the band
 * while no band is chosen. `t` is the `Admin` catalogue, `tEvent` the `Event` one (the bands'
 * lower-case words).
 */
export function difficultyStepWords(
  t: Words,
  tEvent: Words,
  scale: string,
): { label: string; help: string; scale: string; choices: StepWords; levels: Record<DifficultyBand, StepWords> } {
  const first = DIFFICULTY_BANDS[0];
  const last = DIFFICULTY_BANDS[DIFFICULTY_BANDS.length - 1];
  // The same ladder the pill's tooltip says (`difficultyLadder`), here with commas.
  const ranges = difficultyLadder(tEvent).join(", ");
  const perStep = (word: (step: DifficultyStep) => string) =>
    Object.fromEntries(DIFFICULTY_STEPS.map((step) => [`step${step}`, word(step)])) as StepWords;
  return {
    label: t("editor.fields.difficultyStep"),
    help: t("editor.difficultyStepHelp", {
      // Not {first} / {last}: «la {…}» before a date is what §452's check refuses, and these are levels.
      lowest: difficultyBandLevels(first).from,
      lowestBand: tEvent(`difficultyBandWords.${first}`),
      highest: difficultyBandLevels(last).to,
      highestBand: tEvent(`difficultyBandWords.${last}`),
      ranges,
    }),
    scale,
    choices: perStep((step) => t(`editor.difficultySteps.step${step}`)),
    levels: Object.fromEntries(
      DIFFICULTY_BANDS.map((band) => [
        band,
        perStep((step) => t("editor.difficultyLevelChoice", { level: difficultyLevel(band, step), levels: DIFFICULTY_LEVEL_COUNT })),
      ]),
    ) as Record<DifficultyBand, StepWords>,
  };
}
