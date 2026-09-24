import Box from "@mui/material/Box";

/** One entry: where it goes, what it says, and whether it is the panel being shown. */
export type SubNavItem = { href: string; label: string; active?: boolean };

/**
 * The row the sub-navigation sits in: a thin rule under it like the backoffice's own tab bar,
 * and on a phone it scrolls sideways rather than wrapping (§360).
 *
 * The scrollbar is hidden, as MUI hides the main tab bar's: the entry cut off at the edge is what
 * says there is more, and a focused entry is scrolled into view by the browser. `overflow-y` is
 * stated because `overflow-x: auto` alone turns the other axis to `auto` as well, and a stray
 * pixel of the underline would then make the row scroll up and down.
 */
const ROW_SX = {
  borderBottom: 1,
  borderColor: "divider",
  overflowX: "auto",
  overflowY: "hidden",
  overscrollBehaviorX: "contain",
  scrollbarWidth: "none",
  "&::-webkit-scrollbar": { display: "none" },
} as const;

/** The list inside it: one line, never two, whatever the width. */
const LIST_SX = { display: "flex", flexWrap: "nowrap", m: 0, p: 0, listStyle: "none" } as const;

/**
 * One entry, drawn as a secondary tab (§360): the words and nothing else — no border box, no
 * fill, no shadow — a size smaller than the main tab bar and without its glyphs, so the two rows
 * read as a section and its parts rather than as two rows of the same thing.
 *
 * **The current entry is styled from `aria-current`, never from a second prop**, so what the eye
 * sees and what a screen reader hears cannot disagree: the primary colour, 600 weight and a 2-px
 * underline in the primary colour, sitting on the row's rule the way the main bar's indicator
 * does. Colour alone is not the signal (BR-REQ-041-01) — the weight and the underline are there
 * for whoever cannot tell the blue from the grey.
 *
 * Every entry keeps a 2-px transparent underline so the current one is not 2 pixels taller than
 * its neighbours, and the hit area is the full 44 pixels of the row (BR-REQ-041-01 criterion 6).
 * The focus ring is drawn inside the entry (`outline-offset: -2px`): the row is a scroll
 * container, which would clip a ring drawn outside it.
 */
const ENTRY_SX = {
  display: "flex",
  alignItems: "center",
  boxSizing: "border-box",
  minHeight: 44,
  px: { xs: 1, sm: 1.5 },
  borderBottom: 2,
  borderColor: "transparent",
  color: "text.secondary",
  typography: "body2",
  fontSize: "0.8125rem",
  fontWeight: 500,
  lineHeight: 1.25,
  whiteSpace: "nowrap",
  textDecoration: "none",
  "&:hover": { color: "text.primary", borderColor: "divider" },
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "-2px" },
  '&[aria-current="page"]': { color: "primary.main", fontWeight: 600, borderColor: "primary.main" },
} as const;

/**
 * A row of sub-tabs inside one backoffice section (`DECISIONS.md` §265), and the one look every
 * sub-navigation in the backoffice wears (§360).
 *
 * The owner: "partea de configurare ar trebui să aibă subtaburi, pt status, general, mailuri,
 * captcha, etc". Both configuration screens had grown to six or seven panels on one scroll —
 * `/devs` is six hundred lines of page — and "where do I turn the anti-bot check off" meant
 * scrolling past Neon's compute hours to find out.
 *
 * They were drawn as pill buttons, the current one filled blue with a shadow, and the owner, on
 * 2026-09-24: "I do not like the subtabs/buttons of the configs and todos". Buttons under a tab
 * bar read as things to do rather than as parts of the page, and at 320 pixels four of them
 * wrapped into a second row of buttons. They are tabs now, the main bar's smaller relative — see
 * `ENTRY_SX` — and the gallery's two halves and the email previews' language switch use this
 * component too, so there is one look for "which part of this page am I on".
 *
 * **Server Component, and the entries are plain anchors in a list**: `AdminTabs` is a client
 * island only because a layout cannot know which page wraps it, and a page always knows which
 * panel it is showing. So each link is real navigation, the panels are rendered on the server,
 * and the whole thing — the underline included — works with JavaScript off. Links rather than
 * `role="tab"`: every entry changes the address, and a tab widget promises arrow keys and a panel
 * in the same document that these do not have.
 *
 * No glyphs: the main tab bar carries the pictures, and a row of one-word labels under it is
 * lighter without them. (An icon element handed from a Server Component to a client one is the
 * defect `shared/ui/action-icons.ts` documents, so a glyph here would have to go by name.)
 *
 * The href is a string rather than a typed route because a panel is a query parameter, and
 * because one of these rows deliberately points at the neighbouring page: the anti-bot switch
 * belongs to the club's own to-do screen (§254) and is still one press from here.
 */
export default function SubNav({ items, label }: { items: readonly SubNavItem[]; label: string }) {
  return (
    <Box component="nav" aria-label={label} sx={ROW_SX}>
      <Box component="ul" sx={LIST_SX}>
        {items.map((item) => (
          <Box component="li" key={item.href} sx={{ flex: "none" }}>
            <Box component="a" href={item.href} aria-current={item.active ? "page" : undefined} sx={ENTRY_SX}>
              {item.label}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
