import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";

/** One entry: where it goes, what it says, and whether it is the panel being shown. */
export type SubNavItem = { href: string; label: string; active?: boolean };

/**
 * A row of sub-tabs inside one backoffice section (`DECISIONS.md` §265).
 *
 * The owner: "partea de configurare ar trebui să aibă subtaburi, pt status, general, mailuri,
 * captcha, etc". Both configuration screens had grown to six or seven panels on one scroll —
 * `/devs` is six hundred lines of page — and "where do I turn the anti-bot check off" meant
 * scrolling past Neon's compute hours to find out.
 *
 * **Server Component, and the entries are plain anchors**, which is the same decision
 * `GallerySubNav` records: `AdminTabs` is a client island only because a layout cannot know
 * which page wraps it, and a page always knows which panel it is showing. So each link is real
 * navigation, the panels are rendered on the server, and the whole thing works with JavaScript
 * off. No icons — an icon element handed from a Server Component to a client one is the defect
 * `shared/ui/action-icons.ts` documents, and a one-word label needs no glyph.
 *
 * The href is a string rather than a typed route because a panel is a query parameter, and
 * because one of these rows deliberately points at the neighbouring page: the anti-bot switch
 * belongs to the club's own to-do screen (§254) and is still one press from here.
 */
export default function SubNav({ items }: { items: readonly SubNavItem[] }) {
  return (
    <Stack direction="row" component="nav" sx={{ flexWrap: "wrap", gap: 1 }}>
      {items.map((item) => (
        <Button
          key={item.href}
          component="a"
          href={item.href}
          variant={item.active ? "contained" : "outlined"}
          size="small"
          // The current panel is stated as well as filled: colour alone is not a signal
          // (BR-REQ-041-01), and this is what a screen reader reads as "current page".
          aria-current={item.active ? "page" : undefined}
          sx={{ minHeight: 44, textTransform: "none" }}
        >
          {item.label}
        </Button>
      ))}
    </Stack>
  );
}
