import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import Box from "@mui/material/Box";
import { runInPlace } from "@/theme/motion";

/**
 * The site's loading figure: a runner, on the spot (`DECISIONS.md` §166; the owner: "I need a
 * runner showing as a loader").
 *
 * It is the club's own glyph rather than a drawing: `DirectionsRunIcon` is already
 * `TYPE_GLYPH.GROUP_RUN`, so the figure that means "a run" on every card and every chip is the
 * figure that means "a run is being fetched". One file from `@mui/icons-material`, never the
 * barrel (`DECISIONS.md` §90); nothing is downloaded and no library is added.
 *
 * Not a "use client" file and not `async`: it renders from a Server Component (the skeletons)
 * and from a client one (`SubmitButton`) with the same import, and it holds no state. It never
 * receives an icon as a prop and never passes one — the glyph is imported here, on whichever
 * side of the boundary the caller is on, which is the rule `GlyphChip` exists to enforce.
 *
 * **Accessibility.** With a `label` it is the loading announcement: `role="img"` carrying the
 * already-translated name, the glyph itself hidden. Without one it is decoration beside text
 * that already says it — inside a skeleton whose wrapper is the `role="status"`, or inside a
 * button whose own label has just changed to "Se salvează…". Either way the movement is never
 * the only signal, and under `prefers-reduced-motion` the figure simply stands still.
 */
export default function RunnerLoader({
  label,
  size = 24,
  color = "primary.main",
}: {
  /** Already translated by the caller — a loader must not wait on a catalogue lookup. */
  label?: string;
  /** CSS pixels. 16 beside a button's label, 24 in a skeleton's header, 40 for a whole page. */
  size?: number;
  /** A palette path, never a colour: "primary.main", "text.secondary", "inherit". */
  color?: string;
}) {
  return (
    <Box
      component="span"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      sx={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color, lineHeight: 0 }}
    >
      <DirectionsRunIcon sx={{ fontSize: size, ...runInPlace }} />
    </Box>
  );
}

/**
 * The figure a press is about to show, drawn with the page and never displayed (§371), so the
 * press that shows it adds no style to the page.
 *
 * MUI writes a component's CSS the first time the component renders with those props: on the
 * server for everything the page is drawn with, in the browser for anything that appears later.
 * Here every rule sits in a cascade layer (`enableCssLayer`, `modularCssLayers`), and Chromium
 * answers a layered rule added to a live page by rebuilding the layer map and its font cache —
 * every element's style and every line's layout, the whole page again. The runner that replaces a
 * save button's glyph was that rule: two of them, written inside the press, and on the event
 * editor at a phone's speed the recalculation was most of the owner's "blocked UI updates for
 * 352ms" (`tests/e2e/perf/inp.spec.ts` counts the rules a press inserts; it is 0 now).
 *
 * Rendered beside the button with the very props the pending figure takes — the size and the
 * colour are what the class is made of — its CSS is in the server's HTML, and the figure the
 * press shows reuses it. `display: none` inline, never a class: nothing is added for the hiding
 * either, it takes no room and no gap in a flex column, and it is out of the accessibility tree.
 */
export function RunnerLoaderStyles({ size, color }: { size?: number; color?: string }) {
  return (
    <span style={{ display: "none" }} data-runner-styles="">
      <RunnerLoader size={size} color={color} />
    </span>
  );
}
