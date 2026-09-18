/**
 * The theme playground (BR-REQ-090-06): try the site with bigger type, another face or
 * rounder corners, in one browser, without a deploy.
 *
 * Pure values and parsing only — no React, no cookie API — so the same rules serve the
 * `/devs/theme` form, the client boundary that applies a preview, and a unit test. The
 * preview lives in a cookie this browser alone reads (`AppTheme.tsx`): the server never
 * sees it, so every page stays exactly as cacheable as it was, and nobody else's page changes.
 *
 * Fonts are the ones the locale layout already self-hosts through `next/font` (their CSS
 * variables are always defined, and a browser only downloads a face a style actually uses),
 * plus two that need no file at all. The list is the whole allowlist: a cookie naming
 * anything else is ignored, never interpolated into CSS.
 */

export const THEME_PREVIEW_COOKIE = "br-theme-preview";

export const PREVIEW_FONTS = {
  roboto: { label: "Roboto", family: "var(--font-roboto)" },
  inter: { label: "Inter", family: "var(--font-inter)" },
  nunito: { label: "Nunito", family: "var(--font-nunito)" },
  system: { label: "System UI", family: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  serif: { label: "Georgia (serif)", family: "Georgia, 'Times New Roman', serif" },
} as const;
export type PreviewFont = keyof typeof PREVIEW_FONTS;

/** Percent of the browser's default text size; 100 is the site as shipped. */
export const PREVIEW_SCALES = [90, 100, 110, 125, 150] as const;
export const PREVIEW_RADII = [0, 4, 10, 16, 24] as const;

export type ThemePreview = {
  scale: (typeof PREVIEW_SCALES)[number];
  display: PreviewFont;
  body: PreviewFont;
  radius: (typeof PREVIEW_RADII)[number];
};

export const DEFAULT_PREVIEW: ThemePreview = { scale: 100, display: "roboto", body: "roboto", radius: 10 };

function isFont(value: string): value is PreviewFont {
  return Object.hasOwn(PREVIEW_FONTS, value);
}

/** `scale=125;display=inter;body=nunito;radius=16` → a preview, or null for anything else. */
export function parseThemePreview(raw: string | undefined | null): ThemePreview | null {
  if (!raw) return null;
  const fields = new Map(raw.split(";").map((part) => part.split("=") as [string, string]));
  const scale = Number(fields.get("scale"));
  const radius = Number(fields.get("radius"));
  const display = fields.get("display") ?? "";
  const body = fields.get("body") ?? "";
  if (!PREVIEW_SCALES.includes(scale as ThemePreview["scale"])) return null;
  if (!PREVIEW_RADII.includes(radius as ThemePreview["radius"])) return null;
  if (!isFont(display) || !isFont(body)) return null;
  const preview = { scale, display, body, radius } as ThemePreview;
  return isDefaultPreview(preview) ? null : preview;
}

export function serializeThemePreview(preview: ThemePreview): string {
  return `scale=${preview.scale};display=${preview.display};body=${preview.body};radius=${preview.radius}`;
}

export function isDefaultPreview(preview: ThemePreview): boolean {
  return (
    preview.scale === DEFAULT_PREVIEW.scale &&
    preview.display === DEFAULT_PREVIEW.display &&
    preview.body === DEFAULT_PREVIEW.body &&
    preview.radius === DEFAULT_PREVIEW.radius
  );
}
