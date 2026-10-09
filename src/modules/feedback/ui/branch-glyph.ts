import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import LocalFloristOutlinedIcon from "@mui/icons-material/LocalFloristOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import type { FeedbackBranch } from "../domain/branches";

/**
 * «Spune-ne ceva»'s one glyph per branch (§676, §678, §679), looked up by the branch's name: step 1 draws
 * it on each card and step 2 beside the branch's title, so the picture a visitor chose is the one above
 * the form they fill. Decoration only — the word is the label, and the tile is `aria-hidden`. One file
 * per glyph, never the barrel (§90).
 *
 * The metaphors, written down: how it was is a runner, a suggestion the light bulb, a complaint the
 * triangle that says something is wrong, and «Girl Zone», the women's safety form, a flower (§679, the
 * owner's ask; §678's heart before it) — never a shield: the owner asked the form to stop reading as if
 * something had already gone wrong.
 */
export const FEEDBACK_BRANCH_GLYPH: Readonly<Record<FeedbackBranch, ComponentType<SvgIconProps>>> = {
  howItWent: DirectionsRunIcon,
  suggestion: LightbulbOutlinedIcon,
  complaint: ReportProblemOutlinedIcon,
  safety: LocalFloristOutlinedIcon,
};

/**
 * The palette colour each branch's tile is tinted with — the tile alone; a chosen card is outlined in
 * the primary colour whichever it is. The women's form takes the secondary colour, so it reads as a
 * place of its own rather than a fourth kind of complaint.
 */
export const FEEDBACK_BRANCH_TINT: Readonly<Record<FeedbackBranch, "primary" | "secondary">> = {
  howItWent: "primary",
  suggestion: "primary",
  complaint: "primary",
  safety: "secondary",
};

/**
 * The language a branch's name is written in, where it is a name in one language whatever the page's
 * (§679): «Girl Zone» is English on the Romanian page too, so the step-1 card and the step-2 heading
 * carry `lang="en"` there and a screen reader says it as English. A branch absent here is written in
 * the page's own language.
 */
export const FEEDBACK_BRANCH_LABEL_LANG: Readonly<Partial<Record<FeedbackBranch, string>>> = {
  safety: "en",
};

/** The `lang` a branch's name needs on a page in `locale` — none when it is the page's own language. */
export function branchLabelLang(branch: FeedbackBranch, locale: string): string | undefined {
  const lang = FEEDBACK_BRANCH_LABEL_LANG[branch];
  return lang && lang !== locale ? lang : undefined;
}

/** A wash of a palette colour, through its CSS variable so it follows the colour scheme (`theme/surfaces.ts`'s way). */
export const paletteWash = (colour: "primary" | "secondary", percent: number) => `color-mix(in srgb, var(--mui-palette-${colour}-main) ${percent}%, transparent)`;
