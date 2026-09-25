import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import RunnerLoader from "./RunnerLoader";
import { shimmerOffForReducedMotion } from "@/theme/motion";

/**
 * What the public site shows in the box a server render has not filled yet
 * (`DECISIONS.md` §166; the owner: "there is flickering when changing calendars! I need
 * skeletons and loading screens").
 *
 * Shapes, not a spinner, for the reason `AdminSkeleton.tsx` gives at length: a spinner says
 * something is happening, a shape says *the calendar you asked for* is coming, and only the
 * shape keeps the page from jumping when the real thing lands. Every skeleton here is built
 * out of the same boxes, the same grid and the same cell heights as the component it stands
 * in for, so the swap moves nothing.
 *
 * The runner appears once per boundary rather than once per shape — forty bobbing figures in
 * a grid would be a novelty act.
 *
 * The listing's and the calendar's shapes are gone (§413): those pages await one cached read
 * before they render, so the filter panel — a GET form that has to work with scripts off — and
 * what it narrows are in the first HTML rather than behind a boundary a script reveals.
 *
 * These are Server Components: a `<Suspense fallback>` is rendered on the server and streamed
 * with the page, so none of this costs the visitor a byte of JavaScript.
 */

/** MUI draws the shimmer; this is the reduced-motion guard the site requires on top of it. */
const WAVE = shimmerOffForReducedMotion;

type LabelProps = {
  /** Already translated by the caller — a skeleton must not wait on a catalogue lookup. */
  label: string;
};

/**
 * The band that says a region is loading: the runner, then the words, quietly.
 *
 * The region around it is the `role="status"`, so the wait is announced once rather than
 * being a silent gap for a reader who cannot see the shapes.
 */
function LoadingBand({ label }: LabelProps) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
      <RunnerLoader size={20} />
      <Box component="span" sx={{ fontSize: "0.8125rem", color: "text.secondary" }}>
        {label}
      </Box>
    </Stack>
  );
}

/** The album grid: the same one/two/three columns and the same 4:3 covers. */
export function GalleryGridSkeleton({ label, cards = 3 }: LabelProps & { cards?: number }) {
  return (
    <Box role="status" aria-live="polite" aria-label={label}>
      <LoadingBand label={label} />
      <Box
        aria-hidden="true"
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" },
          gap: 2,
        }}
      >
        {Array.from({ length: cards }, (_, index) => (
          <Card key={index} variant="outlined">
            <Skeleton variant="rectangular" animation="wave" sx={{ ...WAVE, width: "100%", aspectRatio: "4 / 3" }} />
            <CardContent>
              <Skeleton variant="text" width="70%" animation="wave" sx={{ ...WAVE, fontSize: "1.125rem" }} />
              <Skeleton variant="text" width="50%" animation="wave" sx={WAVE} />
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
}
