import { z } from "zod";
import { homeTextSchema, type HomeText } from "./home-text";

/**
 * «Prima dată» — the home page's band for a newcomer (§714; `docs/REDESIGN.md` § What exists versus
 * what is new: «the words (a setting), five icons, a target page»): a heading, one sentence, five
 * numbered steps from the calendar to the start, and «Cum funcționează», which opens a club page
 * (decision 5: there is no sign-up for runners, so the band explains rather than registers).
 *
 * The five glyphs are fixed by position — the step's meaning is its place in the walk — and named,
 * never drawn, here: `ui/home-glyphs.ts` holds the icon files (§370, §694).
 */
export const STEP_GLYPHS = ["calendar", "place", "hello", "run", "coffee"] as const;
export type StepGlyph = (typeof STEP_GLYPHS)[number];

/** How many steps the band draws: one per glyph. */
export const STEP_COUNT = STEP_GLYPHS.length;

/**
 * What the club types for the band, every box optional (both languages or neither): an empty box
 * draws the platform's sentence. Each step is a short title and one sentence under it, as a reason
 * of «De ce» is. `targetPageId` is the custom page «Cum funcționează» opens (a
 * `pages` row's id; the wiring resolves its slug per language), or none, and then the button is
 * not drawn.
 */
export type StepContent = { title: HomeText | null; body: HomeText | null };

export type StepsContent = {
  title: HomeText | null;
  lead: HomeText | null;
  steps: readonly StepContent[];
  linkLabel: HomeText | null;
  targetPageId: string | null;
};

/** The band before the club has written a word: the platform's sentences, no target page. */
export const EMPTY_STEPS: StepsContent = {
  title: null,
  lead: null,
  steps: STEP_GLYPHS.map(() => ({ title: null, body: null })),
  linkLabel: null,
  targetPageId: null,
};

/** The stored value, as the setting's form posts it and the page reads it back. */
export const stepsContentSchema = z.object({
  title: homeTextSchema(80),
  lead: homeTextSchema(200),
  steps: z.array(z.object({ title: homeTextSchema(60), body: homeTextSchema(120) })).length(STEP_COUNT).readonly(),
  linkLabel: homeTextSchema(40),
  targetPageId: z.uuid().nullable().default(null),
});

/** A stored value that no longer parses (a hand-written row, an older shape) reads as the empty band, never a broken page. */
export function readStepsContent(value: unknown): StepsContent {
  const parsed = stepsContentSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_STEPS;
}
