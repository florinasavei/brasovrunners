import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/**
 * The one page the create form and the editor share (§350): a main column of boxes — the page's
 * sections in the page's order, then the ones that are not on the page (§406) — and a narrow side
 * column — Publicare, Recurență and the page's map — that comes **first on a phone** (it is what you came to check, and forty fields above it are a scroll nobody makes) and
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
 * A group's plain overline — "Pagina evenimentului, de sus în jos" over the cards in the page's
 * order, "Nu sunt secțiuni ale paginii" over the rest (§406; it was three groups by subject,
 * §350, §358) — two of the three under it (the special-edition chip, a cancelled or finished
 * notice) still draw on the page, just never as a numbered section of it —
 * not a box: it says what the boxes under it are about.
 */
export function EditorGroup({ label }: { label: string }) {
  return (
    <Typography variant="overline" component="p" color="text.secondary" sx={{ lineHeight: 1.6, pt: 1 }} data-testid="editor-group">
      {label}
    </Typography>
  );
}

/**
 * Where the page draws a section nobody writes (§406): the share links, after the partners — named
 * in its place among the cards, a dashed line and not a card, so the column reads as the page does
 * from top to bottom and nobody looks for a box that cannot exist.
 */
export function AutomaticSection({ children, testId }: { children: string; testId?: string }) {
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      data-testid={testId}
      sx={{ border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: 1, px: 2, py: 1.25 }}
    >
      {children}
    </Typography>
  );
}
