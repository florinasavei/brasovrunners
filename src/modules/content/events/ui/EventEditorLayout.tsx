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
 * Where each part of the editor's main column stands on the screen (§NNN), by `order` in one flex
 * column: the card that has forms of its own and stands **under «Traseul»** — «Puncte de control»
 * (§757) — cannot sit inside the save form, because HTML forms cannot nest, so it is drawn beside
 * the form in the document and moved between the cards on the screen. The save form takes no box of
 * its own (`display: contents`): its two runs of cards, up to «Traseul» and from card 6 on, are this
 * column's items, and «Puncte de control» goes between them. What has no place here keeps the
 * column's start (the to-do card, a refusal's summary), in the document's order; the bib card's small
 * forms are `hidden` and take no place at all.
 *
 * Only the screen moves: a keyboard and a screen reader meet «Puncte de control» where the document
 * has it, after the to-do card and before the save form's first card, as before §NNN.
 */
export const EDITOR_MAIN_ORDER = { top: 0, upToCourse: 1, underCourse: 2, fromRegistration: 3 } as const;

/** The style the save form takes on the editor so its runs of cards are the column's items (§NNN). */
export const FORM_WITHOUT_BOX = { display: "contents" } as const;

/** The editor's main column (§NNN): one flex column, 16 pixels between its items, ordered by `EDITOR_MAIN_ORDER`. */
export function EditorMainColumn({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }} data-testid="editor-main">
      {children}
    </Box>
  );
}

/** A run of the save form's cards, at its place in the column (§NNN). */
export function EditorCardRun({ place, children, testId }: { place: "upToCourse" | "fromRegistration"; children: ReactNode; testId?: string }) {
  return (
    <Stack spacing={2} sx={{ order: EDITOR_MAIN_ORDER[place], minWidth: 0 }} data-testid={testId}>
      {children}
    </Stack>
  );
}

/**
 * A card that belongs to «Traseul» but posts forms of its own (§NNN; «Puncte de control», §757):
 * drawn right under «Traseul» and joined to it — half the column's gap above, set in by a step on the
 * left, with a rule down that side, the way a named card sits inside its card — while in the document
 * it stays beside the save form. Its own heading is a level-3 heading, a card of «Traseul».
 */
export function UnderCourse({ children }: { children: ReactNode }) {
  return (
    <Box
      data-testid="under-course"
      sx={{
        order: EDITOR_MAIN_ORDER.underCourse,
        mt: -1,
        ml: { xs: 1, sm: 2 },
        pl: { xs: 1, sm: 1.5 },
        borderLeft: 2,
        borderColor: "divider",
        minWidth: 0,
      }}
    >
      {children}
    </Box>
  );
}

/**
 * A group's plain overline — "Pagina evenimentului, de sus în jos" over the cards in the page's
 * order (§406; it was three groups by subject, §350, §358). The second group, "Nu sunt secțiuni ale
 * paginii", is gone since §NNN: its three cards are named cards of the page's own («Evidențiere pe
 * site» in «Ce fel de eveniment», «Copertă» and the page's address in «Titlu și rezumat»). Not a box:
 * it says what the boxes under it are about.
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
