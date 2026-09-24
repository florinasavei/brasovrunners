import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/**
 * The one page the create form and the editor share (§350): a main column of boxes in three
 * labelled groups, and a narrow side column — Publicare and Recurență — that comes **first on a
 * phone** (it is what you came to check, and forty fields above it are a scroll nobody makes) and
 * stays pinned on the right from `md` up.
 *
 * The two columns are siblings, never nested, on the editor: the save is one `<form>` and every
 * publication and recurrence verb is a form of its own, and a form inside a form is not a thing
 * HTML has. On the create page the whole grid sits inside the create form, because nothing else
 * posts there. `below` holds what is operations, not settings — the registrations received and
 * the copy and delete verbs — under the grid, full width.
 */
export default function EventEditorLayout({ side, main, below }: { side: ReactNode; main: ReactNode; below?: ReactNode }) {
  return (
    <Stack spacing={4}>
      <Box
        sx={{
          display: "grid",
          gap: { xs: 3, md: 4 },
          gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) minmax(260px, 340px)" },
          alignItems: "start",
        }}
      >
        {/* First in the document as on a phone; the grid's `order` moves it right from `md` up. */}
        <Stack spacing={2} sx={{ order: { xs: 1, md: 2 }, minWidth: 0, position: { md: "sticky" }, top: { md: 16 } }} data-testid="editor-side">
          {side}
        </Stack>
        <Box sx={{ order: { xs: 2, md: 1 }, minWidth: 0 }}>{main}</Box>
      </Box>
      {below}
    </Stack>
  );
}

/**
 * A group's plain overline — "Evenimentul", "Ziua evenimentului și participanții", "Traseu,
 * legături și prezentare" — not a box: it says what the boxes under it are about.
 */
export function EditorGroup({ label }: { label: string }) {
  return (
    <Typography variant="overline" component="p" color="text.secondary" sx={{ lineHeight: 1.6, pt: 1 }} data-testid="editor-group">
      {label}
    </Typography>
  );
}
