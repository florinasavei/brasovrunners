import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";

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

type LabelProps = {
  /** Already translated by the caller — a skeleton must not wait on a catalogue lookup. */
  label: string;
};

/** The header block every backoffice page opens with: a title and its primary action. */
function HeaderSkeleton() {
  return (
    <Stack
      direction="row"
      sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}
    >
      <Skeleton variant="text" width={180} sx={{ fontSize: "1.25rem" }} />
      <Skeleton variant="rounded" width={140} height={44} />
    </Stack>
  );
}

/** A list route: filters, then a table of rows. */
export function AdminListSkeleton({ label, rows = 8 }: LabelProps & { rows?: number }) {
  return (
    <Stack spacing={3} role="status" aria-live="polite" aria-label={label}>
      <HeaderSkeleton />

      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        <Skeleton variant="rounded" width={220} height={44} />
        <Skeleton variant="rounded" width={180} height={44} />
        <Skeleton variant="rounded" width={180} height={44} />
      </Stack>

      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
        <Skeleton variant="rectangular" height={48} sx={{ bgcolor: "action.hover" }} />
        <Stack divider={<Box sx={{ borderBottom: 1, borderColor: "divider" }} />}>
          {Array.from({ length: rows }, (_, index) => (
            <Box key={index} sx={{ px: 2, py: 1.5 }}>
              <Skeleton variant="text" width={`${70 - ((index * 7) % 30)}%`} />
            </Box>
          ))}
        </Stack>
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
            <Skeleton variant="text" width={120} />
            <Skeleton variant="rounded" height={56} />
          </Box>
        ))}
      </Stack>
      <Skeleton variant="rounded" width={160} height={44} />
    </Stack>
  );
}
