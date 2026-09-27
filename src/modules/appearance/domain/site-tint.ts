import { z } from "zod";
import { SITE_TINT } from "@/theme/brand";

/**
 * «Fundalul site-ului» — the public pages' background tint (§NNN; the owner: a setting for the
 * site's light background, presets from the club's colours).
 *
 * Pure: no database, no environment. The club picks one of the presets in `SITE_TINT`
 * (`theme/brand.ts`, the only file allowed a colour); nothing is typed, so nothing the club saves
 * can be anything but one of the colours `brand.test.ts` holds to AA.
 *
 * How it reaches the page: the locale layout draws one small stylesheet (`siteTintStyle`) that
 * sets MUI's own page-colour variable, `--mui-palette-background-default`, and its channel twin,
 * on `<body>` — the variable `CssBaseline` paints the page with. One variable, set on the server,
 * so the first paint is already tinted and no client code runs for it.
 *
 * - **Light only.** The selector names `:root:not([data-dark])`: the dark scheme (§93) keeps its
 *   own page colour, and with JavaScript off (no `data-light` yet) the light default still takes
 *   the tint.
 * - **Public pages only.** `body:not(:has([data-backoffice]))`: the backoffice shell carries the
 *   marker, so staff always work on the platform's neutral paper, whatever the club chose.
 * - **Unlayered.** MUI's styles live in a CSS layer (`modularCssLayers`), so this plain rule wins
 *   over `CssBaseline`'s without a specificity contest.
 * - **The default draws nothing.** `paper` is the theme's own colour; a database without a row
 *   renders byte for byte what it rendered before this setting existed.
 */

export const SITE_TINTS = ["paper", "blue", "sky", "sand"] as const satisfies readonly (keyof typeof SITE_TINT)[];
export type SiteTint = (typeof SITE_TINTS)[number];

export const DEFAULT_SITE_TINT: SiteTint = "paper";

export const siteTintSchema = z.object({ tint: z.enum(SITE_TINTS) });
export type SiteTintSetting = z.infer<typeof siteTintSchema>;

/** Where the tint applies: the light scheme, and never inside the backoffice (see above). */
export const SITE_TINT_SELECTOR = ":root:not([data-dark]) body:not(:has([data-backoffice]))";

/** MUI's page colour, as `theme.vars.palette.background.default` names it (pinned by a test). */
export const PAGE_COLOR_VARIABLE = "--mui-palette-background-default";

/** `#rrggbb` → `"r g b"`, the form MUI keeps its `…Channel` variables in (`alpha()` reads it). */
export function hexChannel(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb colour: ${hex}`);
  return match
    .slice(1)
    .map((pair) => Number.parseInt(pair, 16))
    .join(" ");
}

/** The colour a tint paints the page with. */
export function siteTintColor(tint: SiteTint): string {
  return SITE_TINT[tint];
}

/**
 * The stylesheet the layout draws for a tint, or `null` for the default — which is the theme's
 * own colour and needs no rule at all.
 */
export function siteTintStyle(tint: SiteTint): string | null {
  if (tint === DEFAULT_SITE_TINT) return null;
  const hex = siteTintColor(tint);
  return `${SITE_TINT_SELECTOR}{${PAGE_COLOR_VARIABLE}:${hex};${PAGE_COLOR_VARIABLE}Channel:${hexChannel(hex)}}`;
}

/** A stored value this code can read, or the default — never a throw over a page colour. */
export function parseSiteTint(value: unknown): SiteTint {
  const parsed = siteTintSchema.safeParse(value);
  return parsed.success ? parsed.data.tint : DEFAULT_SITE_TINT;
}
