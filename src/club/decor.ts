import decor from "@club/decor.json";

/**
 * The club's drawing (§885): `club/decor.json`, the mountains the new look puts under the public pages and the
 * calendar picture draws across its empty days — Brașov's two ridges, as `shared/ui/MountainMark.tsx` wrote them.
 *
 * Its own file and its own door, apart from `club.json` and `config.ts`, because the theme carries `club.json`
 * whole into every client island and a drawing has no business there. The only importer of `decor.json`, and
 * imported in turn only by the drawing's readers — `MountainMark` (an inline SVG, a Server Component) and the
 * calendar picture's five canvas files, which the dialog loads when it is opened
 * (`tests/unit/club/import-surface.test.ts`).
 *
 * A layer is a path in the drawing's own box, `far` or `near`: each reader gives the two depths their own weight
 * (the far ridge lighter). A club with no mountains writes `"layers": []`, and nothing is drawn.
 */

/** A ridge of the drawing: how far it stands, and its path in the box. */
export type DecorLayer = { readonly depth: "far" | "near"; readonly d: string };

export type Decor = { readonly mountains: { readonly width: number; readonly height: number; readonly layers: readonly DecorLayer[] } };

const club: Decor = decor as Decor;

/** The drawing's box and its ridges, back to front. */
export const MOUNTAINS = club.mountains;

/**
 * The ridges filled on a canvas already translated and scaled to the drawing's box, each at its depth's alpha,
 * back to front — the calendar picture's one way of drawing them.
 */
export function fillMountains(ctx: CanvasRenderingContext2D, far: number, near: number): void {
  for (const layer of MOUNTAINS.layers) {
    ctx.globalAlpha = layer.depth === "far" ? far : near;
    ctx.fill(new Path2D(layer.d));
  }
}
