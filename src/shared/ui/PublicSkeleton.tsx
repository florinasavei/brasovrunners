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
 * a month grid would be a novelty act.
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

/**
 * The month grid, cell for cell.
 *
 * Same seven columns, same `minHeight` per cell and the same border and radius as
 * `EventCalendar`'s own grid, so the grid that replaces it occupies exactly the same box —
 * which is the reason the calendar stopped flickering rather than merely stopped being blank.
 *
 * The number of week rows is **handed in**, never assumed (§167). `monthGrid` emits as many
 * weeks as the month spans — four, five or six — so a fixed six was taller than the real grid
 * in ten months of twelve, and the swap pushed everything under the calendar up by a row or
 * two. The caller computes it with `monthGrid(month).length`, which is pure arithmetic on the
 * address and costs no query.
 */
function MonthGridSkeleton({ weeks }: { weeks: number }) {
  return (
    <Box
      aria-hidden="true"
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      {Array.from({ length: 7 }, (_, index) => (
        <Box
          key={`head-${index}`}
          sx={{ px: 1, py: 0.75, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider" }}
        >
          <Skeleton variant="text" animation="wave" sx={{ ...WAVE, fontSize: "0.75rem" }} />
        </Box>
      ))}
      {Array.from({ length: weeks * 7 }, (_, index) => (
        <Box
          key={`cell-${index}`}
          sx={{
            minHeight: { xs: 56, sm: 80 },
            p: { xs: 0.25, sm: 0.5 },
            borderBottom: 1,
            borderRight: 1,
            borderColor: "divider",
            "&:nth-of-type(7n)": { borderRight: 0 },
          }}
        >
          <Skeleton variant="circular" width={26} height={26} animation="wave" sx={WAVE} />
        </Box>
      ))}
    </Box>
  );
}

/** The agenda: the same `56px 1fr` rows the month list and each year box are built from. */
function AgendaSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Stack spacing={1.5} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Box key={index} sx={{ display: "grid", gridTemplateColumns: "56px 1fr", columnGap: 1 }}>
          <Skeleton variant="rounded" height={36} animation="wave" sx={WAVE} />
          <Skeleton variant="rounded" height={36} animation="wave" sx={WAVE} />
        </Box>
      ))}
    </Stack>
  );
}

/**
 * The calendar's body, in whichever shape the address asked for: the month as a grid, the
 * month as an agenda, or the year as its shelf of month boxes. The header above it — the
 * title, the two selects, the arrows and the pills — is never part of this: it depends on the
 * address and not on the query, so it stays on screen and stays pressable while this shows.
 */
export function CalendarBodySkeleton({
  label,
  kind,
  layout,
  weeks = 6,
}: LabelProps & {
  kind: "month" | "year";
  layout: "grid" | "list";
  /** How many week rows the month on view spans — `monthGrid(month).length` (§167). */
  weeks?: number;
}) {
  return (
    <Box role="status" aria-live="polite" aria-label={label}>
      <LoadingBand label={label} />
      {kind === "year" ? (
        <Box
          aria-hidden="true"
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" },
            gap: 2,
            alignItems: "start",
          }}
        >
          {Array.from({ length: 3 }, (_, index) => (
            <Box key={index} sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
              <Skeleton variant="rectangular" height={44} animation="wave" sx={{ ...WAVE, bgcolor: "action.hover" }} />
              <Box sx={{ p: 1.5 }}>
                <AgendaSkeleton rows={2} />
              </Box>
            </Box>
          ))}
        </Box>
      ) : layout === "list" ? (
        <AgendaSkeleton />
      ) : (
        <MonthGridSkeleton weeks={weeks} />
      )}
    </Box>
  );
}

/** One event card, the same outlined box with the same bands inside it. */
export function EventCardSkeleton() {
  return (
    <Card component="li" variant="outlined" aria-hidden="true">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <Skeleton variant="rounded" width={96} height={24} animation="wave" sx={WAVE} />
          <Skeleton variant="rounded" width={72} height={24} animation="wave" sx={WAVE} />
        </Stack>
        <Skeleton variant="text" width="70%" animation="wave" sx={{ ...WAVE, fontSize: "1.25rem" }} />
        <Skeleton variant="text" width="45%" animation="wave" sx={WAVE} />
        <Skeleton variant="text" width="55%" animation="wave" sx={WAVE} />
      </CardContent>
    </Card>
  );
}

/**
 * The list of cards under the lead event.
 *
 * **One card by default, not three** (§167). A skeleton may only reserve what the real region
 * is certain to need: the list can come back as a single card, as one "nothing scheduled"
 * alert, or — under a hero with nothing else to show — as nothing at all. Three cards is
 * ~350px that then vanishes, which is the reflow the skeleton exists to prevent. Growing
 * downwards when the real list is longer is the harmless direction; collapsing is not.
 */
export function EventListSkeleton({ label, cards = 1 }: LabelProps & { cards?: number }) {
  return (
    <Box role="status" aria-live="polite" aria-label={label}>
      <LoadingBand label={label} />
      <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
        {Array.from({ length: cards }, (_, index) => (
          <EventCardSkeleton key={index} />
        ))}
      </Stack>
    </Box>
  );
}

/**
 * The lead event and the filter chips under it.
 *
 * Deliberately **smaller than the smallest real case** (§167), and that is the opposite of
 * what this fallback first did. It drew the hero's own two-pixel box, and the hero is the one
 * region of the listing that may not exist at all: at most one event can be featured, none is
 * by default, and between seasons there is none by rule. A club without one saw a ~230px box
 * appear and then collapse, dragging the calendar and everything below it up — a full-page
 * shift on the page every visitor lands on.
 *
 * So: the band and a row of chip-sized shapes, which is the least the region can be. The real
 * lead is taller, and the page grows downwards into it once — which nobody reads as a fault,
 * where a collapse is read as the page breaking.
 */
export function ListingLeadSkeleton({ label }: LabelProps) {
  return (
    <Box role="status" aria-live="polite" aria-label={label} sx={{ mb: 3 }}>
      <LoadingBand label={label} />
      <Stack direction="row" spacing={0.5} aria-hidden="true" sx={{ flexWrap: "wrap", gap: 0.5 }}>
        <Skeleton variant="rounded" width={72} height={24} animation="wave" sx={WAVE} />
        <Skeleton variant="rounded" width={96} height={24} animation="wave" sx={WAVE} />
        <Skeleton variant="rounded" width={84} height={24} animation="wave" sx={WAVE} />
      </Stack>
    </Box>
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
