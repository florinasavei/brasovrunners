import type { MonthCostId } from "@/modules/diagnostics/domain/month-costs";
import type { ServiceId, ServiceSeverity } from "@/modules/diagnostics/platform-plans";
import type { PanelGlyphName } from "@/shared/ui/panel-glyphs";
import type { StatusGlyphName } from "@/shared/ui/status-glyphs";

/**
 * The two lists of «Setări» → «Costuri» — the month per provider (`MonthCostsPanel`) and the services
 * one by one — as the house's row folds (`shared/ui/row-fold.ts`, §842): the line in words (the
 * provider's glyph and name, a chip with its month's figure or its plan's price, a chip with its
 * state), and the figures and the sentences inside, a press away. Both lists are read here and changed
 * nowhere, so the line ends in a caret that turns rather than the editors' pencil: a pencil on a row
 * nothing on it can change would be a control that lies.
 */

/**
 * Each provider's picture before its name (§521: a glyph on every fold header), from the cards'
 * table by name: the domain a link, the email an envelope, the hosting the globe the site is served
 * to, the database its drum, the translation its sign, the pictures a picture.
 */
export const MONTH_GLYPH: Record<MonthCostId, PanelGlyphName> = {
  domain: "links",
  mailgun: "email",
  vercel: "publication",
  neon: "database",
  deepl: "translation",
  r2: "pictures",
};

/** The same for the services one by one; the staff's sign-in a shield, the pingers the jobs' clock. */
export const SERVICE_GLYPH: Record<ServiceId, PanelGlyphName> = {
  domain: "links",
  mailgun: "email",
  vercel: "publication",
  neon: "database",
  zitadel: "antiBot",
  scheduler: "jobs",
};

/** A severity as a chip: grey and outlined for "nothing measures it" — never green — then green, amber, red. */
export const SEVERITY_CHIP: Record<ServiceSeverity, { glyph: StatusGlyphName; color: "success" | "default" | "warning" | "error"; variant: "filled" | "outlined" }> = {
  ok: { glyph: "done", color: "success", variant: "filled" },
  unknown: { glyph: "open", color: "default", variant: "outlined" },
  watch: { glyph: "priorityHigh", color: "warning", variant: "filled" },
  act: { glyph: "priorityUrgent", color: "error", variant: "filled" },
};

/**
 * The caret in the pencil's column (`PENCIL_SX`'s place): a CSS triangle in the secondary ink, the
 * shape `disclosure.ts` draws for the public folds, a quarter turn when the row is open. No glyph
 * import (§318): it is a border, not an icon.
 */
export const CARET_SX = {
  gridArea: "pen",
  justifySelf: "end",
  mr: 1,
  width: 0,
  height: 0,
  color: "text.secondary",
  borderStyle: "solid",
  borderWidth: "0.32em 0 0.32em 0.5em",
  borderColor: "transparent transparent transparent currentColor",
  transition: "transform 120ms ease",
  "details[open] > summary > &": { transform: "rotate(90deg)" },
} as const;

/** The body under an open row: the figures, then the sentences, clear of the next row's line. */
export const ROW_BODY_SX = { pb: 1.5, pt: 0.5 } as const;
