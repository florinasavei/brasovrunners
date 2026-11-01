/**
 * The mountain mark (§708; `docs/REDESIGN.md` § The visual system: «one inline mountain SVG under
 * 2 KB»): two ridges, the far one lighter, drawn in `currentColor` so the caller's text colour —
 * a theme token through `sx` — is its colour, and the dark scheme follows by itself.
 *
 * A drawing of the club's mountains, not the logo: the logo stays the supplied artwork
 * (`LOGO` in `brand.ts`, the header's lockup), and this is the small decoration the new look puts
 * where the plan puts it — the watermark under the public pages' content (`LookWatermark`) and the
 * design page. Inline, so it costs no request; a few hundred bytes of HTML.
 *
 * Decorative by default (`aria-hidden`). With `title` it is an image with that name, for the one
 * place a mark stands alone and means something.
 *
 * A Server Component with no state: it may be rendered from a client component's children too.
 */

import { MOUNTAINS } from "@/club/decor";

/**
 * The drawing's own box — Brașov's is 120 by 48, so a width of 120 draws it at its natural size — and its
 * ridges, the far one then the near one: the club's, in `club/decor.json` since §885 (`src/club/decor.ts`).
 */
export const MOUNTAIN_MARK_VIEWBOX = { width: MOUNTAINS.width, height: MOUNTAINS.height } as const;

type Props = {
  /** The drawn width in pixels; the height follows the 5:2 box. */
  width?: number;
  /** An accessible name, when the mark stands alone; decorative without one. */
  title?: string;
};

export default function MountainMark({ width = MOUNTAIN_MARK_VIEWBOX.width, title }: Props) {
  // A club with no mountains draws none: no empty box holding a place on the page.
  if (MOUNTAINS.layers.length === 0) return null;
  const height = Math.round((width * MOUNTAIN_MARK_VIEWBOX.height) / MOUNTAIN_MARK_VIEWBOX.width);
  return (
    <svg
      viewBox={`0 0 ${MOUNTAIN_MARK_VIEWBOX.width} ${MOUNTAIN_MARK_VIEWBOX.height}`}
      width={width}
      height={height}
      fill="currentColor"
      focusable="false"
      style={{ display: "block", flexShrink: 0 }}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
      data-testid="mountain-mark"
    >
      {title && <title>{title}</title>}
      {MOUNTAINS.layers.map((layer, index) => (
        <path key={index} d={layer.d} opacity={layer.depth === "far" ? 0.55 : undefined} />
      ))}
    </svg>
  );
}
