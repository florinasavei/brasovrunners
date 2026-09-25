import type { SvgIconProps } from "@mui/material/SvgIcon";
import { createElement, type ComponentType } from "react";
import { DIFFICULTY_LEVELS, type DifficultyLevel } from "../domain/difficulty";
import DifficultyGaugeIcon from "./DifficultyGaugeIcon";

/**
 * One registry glyph per level, mapped over `DIFFICULTY_LEVELS` — the gauge's needle at the
 * level's own position (§NNN). A sixth level is a sixth glyph and a sixth `difficulty:*` name
 * with no edit anywhere else.
 *
 * Plain components in a module with no `"use client"` of its own, each rendering the client
 * `DifficultyGaugeIcon` with its level: the event page's facts (`EventFacts`, a Server Component)
 * read `DIFFICULTY_GLYPH[level]` directly, and a record exported from a `"use client"` module
 * would reach the server as a client reference that cannot be dotted into. A number and the
 * caller's own `sx`/`aria-hidden` cross the boundary; the drawing, with its theme callback,
 * stays on the client side.
 */
export const DIFFICULTY_ICONS = Object.fromEntries(
  DIFFICULTY_LEVELS.map((name, index) => {
    function DifficultyGlyph(props: SvgIconProps) {
      return createElement(DifficultyGaugeIcon, { ...props, level: index + 1 });
    }
    DifficultyGlyph.displayName = `DifficultyGlyph(${name})`;
    return [name, DifficultyGlyph];
  }),
) as Record<DifficultyLevel, ComponentType<SvgIconProps>>;
