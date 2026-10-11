/**
 * The mountain mark (§NNN; `docs/REDESIGN.md` § The visual system: «one inline mountain SVG under
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

/** The drawing's own box: 120 by 48, so a width of 120 draws it at its natural size. */
export const MOUNTAIN_MARK_VIEWBOX = { width: 120, height: 48 } as const;

/** The far ridge, then the near one. */
const FAR = "M6 48 38 17l12 10 23-22 18 18 12-6 17 12v19Z";
const NEAR = "M0 48 22 26l8 6 18-20 12 14 8-6 18 18 8-6 26 16Z";

type Props = {
  /** The drawn width in pixels; the height follows the 5:2 box. */
  width?: number;
  /** An accessible name, when the mark stands alone; decorative without one. */
  title?: string;
};

export default function MountainMark({ width = MOUNTAIN_MARK_VIEWBOX.width, title }: Props) {
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
      <path d={FAR} opacity={0.55} />
      <path d={NEAR} />
    </svg>
  );
}
