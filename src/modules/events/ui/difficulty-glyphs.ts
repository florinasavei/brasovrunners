import type { SvgIconProps } from "@mui/material/SvgIcon";
import { createElement, type ComponentType } from "react";
import { DIFFICULTY_BANDS, DIFFICULTY_STEPS, difficultyBandOf, difficultyStepOf, type DifficultyBand, type DifficultyStep } from "../domain/difficulty";
import DifficultyGaugeIcon from "./DifficultyGaugeIcon";

/** A level's registry key: its band and its step, `MODERATE-2` (§NNN). */
export type DifficultyLevelKey = `${DifficultyBand}-${DifficultyStep}`;

/** The registry name of a level's gauge — `difficulty:MODERATE-2` for level 8 (§NNN). */
export function difficultyLevelGlyph(level: number): `difficulty:${DifficultyLevelKey}` {
  return `difficulty:${difficultyBandOf(level)}-${difficultyStepOf(level)}`;
}

function gauge(name: string, band: number, step?: number): ComponentType<SvgIconProps> {
  function DifficultyGlyph(props: SvgIconProps) {
    return createElement(DifficultyGaugeIcon, { ...props, band, ...(step === undefined ? {} : { step }) });
  }
  DifficultyGlyph.displayName = `DifficultyGlyph(${name})`;
  return DifficultyGlyph;
}

/**
 * One registry glyph per band — the gauge's needle at the band's middle, no step dots (§412): what
 * a band stands for alone, in the listing's filter boxes and the editor's band select. A sixth band
 * is a sixth glyph and a sixth `difficulty:*` name with no edit anywhere else.
 *
 * Plain components in a module with no `"use client"` of its own, each rendering the client
 * `DifficultyGaugeIcon` with its band: the event page's facts (`EventFacts`, a Server Component)
 * read a glyph by name, and a record exported from a `"use client"` module would reach the server
 * as a client reference that cannot be dotted into. A number and the caller's own `sx`/`aria-hidden`
 * cross the boundary; the drawing, with its theme callback, stays on the client side.
 */
export const DIFFICULTY_ICONS = Object.fromEntries(DIFFICULTY_BANDS.map((name, index) => [name, gauge(name, index + 1)])) as Record<
  DifficultyBand,
  ComponentType<SvgIconProps>
>;

/**
 * One registry glyph per level of the club's scale of fifteen (§NNN) — `MODERATE-3`: the band's
 * segments lit, the needle at the step's third of the band, the step's dots lit. What an event's
 * own pill draws (`route-pills.ts`), by `difficultyLevelGlyph(level)`.
 */
export const DIFFICULTY_LEVEL_ICONS = Object.fromEntries(
  DIFFICULTY_BANDS.flatMap((band, index) =>
    DIFFICULTY_STEPS.map((step) => [`${band}-${step}`, gauge(`${band}-${step}`, index + 1, step)] as const),
  ),
) as Record<DifficultyLevelKey, ComponentType<SvgIconProps>>;
