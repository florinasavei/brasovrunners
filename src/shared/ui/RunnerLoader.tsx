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
