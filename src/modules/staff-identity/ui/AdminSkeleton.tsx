import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import RunnerLoader from "@/shared/ui/RunnerLoader";
import { shimmerOffForReducedMotion } from "@/theme/motion";

/**
 * What a backoffice route shows between the click and the server answering.
 *
 * There was nothing here before: every `/admin` navigation is a dynamic server render — the
 * layout reads the session cookie, every list queries the database — so a click left the old
 * page on screen, unchanged and unmarked, until the new one arrived. On a phone on the club's
 * connection that is long enough to be read as a dead control, and the reaction is to press
 * again.
 *
 * These are Server Components rendered by `loading.tsx`, which costs no JavaScript at all:
 * Next renders the skeleton into the streamed response and swaps it for the page. That is why
 * the shapes are approximations of the real layout rather than a spinner — a spinner says
 * "something is happening", a shape says "the table you asked for is coming", and the second
 * one stops the page jumping when the rows land.
 *
 * `role="status"` with `aria-live="polite"` so the wait is announced rather than being a silent
 * gap for anybody who cannot see the shapes move.
 */

/**
 * The wave MUI draws across a skeleton, with the reduced-motion guard the site requires on
 * top of it (§166) — the pseudo-element that carries the shimmer is MUI's, so the guard
 * cannot be written the opt-in way `theme/motion.ts` writes its own rules.
 */
const WAVE = shimmerOffForReducedMotion;

/**
 * The rule between the table's rows, drawn by CSS on the row after each row — never
 * `<Stack divider={<Box … />}>` (§370).
 *
 * That is what it was, and under `next dev` it answered **500 on every backoffice list** — the
 * events, registrations, legal texts, pages, gallery, team and to-do screen, every route whose
 * `loading.tsx` renders this skeleton — with React's "Element type is invalid … got: undefined",
 * while the production build served them all. No import was undefined. This file is a Server
 * Component and `Stack` is a client one, so the divider element crossed the boundary **as a
 * prop**. In development every element in the payload also carries its owner and its stack, and
 * when one of those rows is still waiting on another React's Flight client hands the element over
 * as a lazy wrapper rather than an element (`react-server-dom-turbopack`, the `0 < deps` branch). A
 * lazy child renders fine, but `Stack` does not render its divider — it calls
 * `React.cloneElement(divider, { key })` between each pair of rows, and cloning a lazy wrapper
 * yields an element with neither props nor a type. Production payloads carry no owners or
 * stacks, so the divider always arrived whole there, and whether it arrived whole in development
 * depended on the order the rows streamed in: the first render after a compile usually passed,
 * the next ones failed.
 *
 * It is the defect `CheckboxField` and `GlyphChip` document, in a third prop. The rule is the
 * same — nothing but strings, numbers, plain objects and children crosses into a client
 * component — and `tests/unit/shared/server-element-props.test.ts` now holds every Server
 * Component to it. A selector needs no element at all: the same one-pixel line, under every row
 * but the first, which is where `joinChildren` put the separators.
 */
const ROW_RULES = { "& > * + *": { borderTop: 1, borderColor: "divider" } } as const;

type LabelProps = {
  /** Already translated by the caller — a skeleton must not wait on a catalogue lookup. */
  label: string;
};

/**
 * The header block every backoffice page opens with: a title and its primary action, with the
 * site's runner in front of it (§166) so a wait looks the same here as it does on the public
 * calendar.
 */
function HeaderSkeleton() {
  return (
    <Stack
      direction="row"
      sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flex: 1, minWidth: 0 }}>
        <RunnerLoader size={20} />
        <Skeleton variant="text" width={180} animation="wave" sx={{ ...WAVE, fontSize: "1.25rem" }} />
      </Stack>
      <Skeleton variant="rounded" width={140} height={44} animation="wave" sx={WAVE} />
    </Stack>
  );
}

/** A list route: filters, then a table of rows. */
export function AdminListSkeleton({ label, rows = 8 }: LabelProps & { rows?: number }) {
  return (
    <Stack spacing={3} role="status" aria-live="polite" aria-label={label}>
      <HeaderSkeleton />

      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        <Skeleton variant="rounded" width={220} height={44} animation="wave" sx={WAVE} />
        <Skeleton variant="rounded" width={180} height={44} animation="wave" sx={WAVE} />
        <Skeleton variant="rounded" width={180} height={44} animation="wave" sx={WAVE} />
      </Stack>

      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
        <Skeleton variant="rectangular" height={48} animation="wave" sx={{ ...WAVE, bgcolor: "action.hover" }} />
        <Box sx={ROW_RULES}>
          {Array.from({ length: rows }, (_, index) => (
            <Box key={index} sx={{ px: 2, py: 1.5 }}>
              <Skeleton variant="text" width={`${70 - ((index * 7) % 30)}%`} animation="wave" sx={WAVE} />
            </Box>
          ))}
        </Box>
      </Box>
    </Stack>
  );
}

/** An editor route: a header, then stacked fields. */
export function AdminFormSkeleton({ label, fields = 6 }: LabelProps & { fields?: number }) {
  return (
    <Stack spacing={3} role="status" aria-live="polite" aria-label={label}>
      <HeaderSkeleton />
      <Stack spacing={2}>
        {Array.from({ length: fields }, (_, index) => (
          <Box key={index}>
            <Skeleton variant="text" width={120} animation="wave" sx={WAVE} />
            <Skeleton variant="rounded" height={56} animation="wave" sx={WAVE} />
          </Box>
        ))}
      </Stack>
      <Skeleton variant="rounded" width={160} height={44} animation="wave" sx={WAVE} />
    </Stack>
  );
}
