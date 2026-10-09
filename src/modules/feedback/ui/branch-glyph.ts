import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import type { FeedbackBranch } from "../domain/branches";

/**
 * «Spune-ne ceva»'s one glyph per branch (§676, and the cards that followed it), looked up by the
 * branch's name: step 1 draws it on each card and step 2 beside the branch's title, so the picture a
 * visitor chose is the one above the form they fill. Decoration only — the word is the label, and the
 * tile is `aria-hidden`. One file per glyph, never the barrel (§90).
 *
 * The metaphors, written down: how it was is a runner, a suggestion the light bulb, a complaint the
 * triangle that says something is wrong, and the women's safety form a heart outline — care, not a
 * shield: the owner asked the form to stop reading as if something had already gone wrong.
 */
export const FEEDBACK_BRANCH_GLYPH: Readonly<Record<FeedbackBranch, ComponentType<SvgIconProps>>> = {
  howItWent: DirectionsRunIcon,
  suggestion: LightbulbOutlinedIcon,
  complaint: ReportProblemOutlinedIcon,
  safety: FavoriteBorderIcon,
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

/** A wash of a palette colour, through its CSS variable so it follows the colour scheme (`theme/surfaces.ts`'s way). */
export const paletteWash = (colour: "primary" | "secondary", percent: number) => `color-mix(in srgb, var(--mui-palette-${colour}-main) ${percent}%, transparent)`;
