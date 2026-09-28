import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/**
 * The page the create form and the editor share (§350, §406): a main column of cards in the
 * public page's order, and a side column (Publicare, Recurență, the map) first on a phone and
 * pinned right from `md`. On the editor the columns are siblings, never nested: the save and
 * every verb are separate forms, and HTML has no nested forms. `below` holds operations, full
 * width.
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
 * A group's plain overline (§406) — "Pagina evenimentului, de sus în jos" or "Nu sunt secțiuni
 * ale paginii" — not a box: it says what the cards under it are.
 */
export function EditorGroup({ label }: { label: string }) {
  return (
    <Typography variant="overline" component="p" color="text.secondary" sx={{ lineHeight: 1.6, pt: 1 }} data-testid="editor-group">
      {label}
    </Typography>
  );
}

/**
 * A page section nobody writes (the share links, §406), named in its place as a dashed line so
 * the column reads like the page and nobody looks for a missing card.
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
