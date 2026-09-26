"use client";

import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { usePathname } from "next/navigation";
import type { AdminSection } from "../domain/roles";
import { useEffect, useRef } from "react";
import ArticleIcon from "@mui/icons-material/Article";
import ChecklistIcon from "@mui/icons-material/Checklist";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import EventIcon from "@mui/icons-material/Event";
import ForwardToInboxIcon from "@mui/icons-material/ForwardToInbox";
import GavelIcon from "@mui/icons-material/Gavel";
import GroupIcon from "@mui/icons-material/Group";
import ListAltIcon from "@mui/icons-material/ListAlt";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import NewspaperIcon from "@mui/icons-material/Newspaper";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import SettingsIcon from "@mui/icons-material/Settings";

export type AdminTab = {
  href: string;
  label: string;
  section: AdminSection;
  /** A figure beside the label — how many are signed up, on "Înscrieri" (§255). */
  count?: number | null;
  /** What that figure counts, as the tab's tooltip (§277). */
  countHint?: string;
};

/**
 * One icon per section (the owner, 2026-09-18: "icons for each tab"), from the icon package
 * MUI ships — imported one file each, so the bundle carries twelve glyphs and not the set.
 *
 * Every section in `AdminSection` needs a row here, and `emails` had none: a missing key is
 * not a type error, because the record is keyed by `string`, so the tab simply rendered as the
 * one bare word in a row of glyphs (the owner, 2026-09-22: "I am missing the icons for the
 * email"). Widening the key to `AdminSection` is what makes the next omission a build failure.
 */
const ICONS: Record<AdminSection, typeof EventIcon> = {
  events: EventIcon,
  checkin: EmojiEventsIcon,
  guide: MenuBookIcon,
  pages: ArticleIcon,
  gallery: PhotoLibraryIcon,
  // The list, not the person with the tick: that is checking a runner in, a verb the desk and
  // the registration's "⋮" wear, and a tab must not look like one of its own verbs (§318).
  registrations: ListAltIcon,
  tasks: ChecklistIcon,
  legal: GavelIcon,
  emails: ForwardToInboxIcon,
  // The club's news to the people who asked for it (§NNN): a paper, not an envelope — «Emailuri» is the envelope.
  newsletter: NewspaperIcon,
  staff: GroupIcon,
  devs: SettingsIcon,
};

/**
 * The backoffice navigation.
 *
 * Three bare text links used to be the whole of it, which on a phone is three words in a row
 * that nobody reads as navigation. This is a tab bar, and it is a Client Component for exactly
 * one reason: MUI's `Tabs` is one, and the active tab depends on the current path — which a
 * layout cannot know, because a layout in the App Router receives no pathname.
 *
 * The links are ordinary anchors with real `href`s, so this is full navigation rather than
 * client-side routing: the pages behind them are Server Components that read the session and the
 * database on every request, and a client-side transition would only add a router to keep in
 * step with them. It also means the backoffice still works with JavaScript disabled — the tabs
 * are anchors in the server HTML before any of this runs.
 *
 * The hrefs arrive already resolved for the active locale, because `getPathname` is a server
 * function and the caller is a Server Component.
 */
export default function AdminTabs({ items }: { items: readonly AdminTab[] }) {
  const pathname = usePathname();

  /**
   * The longest matching href wins.
   *
   * `/ro/admin` is a prefix of `/ro/admin/registrations`, so a first-match rule would light up
   * "Events" on every page in the backoffice. Comparing lengths picks the most specific tab,
   * which is the one whose section the visitor is actually in.
   */
  const active = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  /**
   * The current tab, in view, on a phone (`DECISIONS.md` §79). MUI scrolls the selected tab
   * into view once, when it mounts; with nine tabs and a slow phone the fonts and the
   * hydration land later than that, and "Ziua cursei" sat off the right edge. This does it
   * again after hydration, and centres it, so a volunteer sees where they are.
   */
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = root.current?.querySelector<HTMLElement>(".MuiTabs-scroller");
    const selected = root.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!scroller || !selected) return;
    // The scroller's own `scrollLeft`, never `scrollIntoView`: that also scrolls the *page*
    // to bring the bar into view, which on a phone yanks the viewport away from whatever the
    // volunteer was about to tap (the e2e walk-in test caught it on 2026-09-18).
    scroller.scrollLeft = selected.offsetLeft - (scroller.clientWidth - selected.offsetWidth) / 2;
  }, [active?.href]);

  return (
    <Tabs
      ref={root}
      // `false` rather than a guess when nothing matches — a page under /admin that is not one
      // of these sections should light up no tab, and MUI warns about a value it cannot find.
      value={active?.href ?? false}
      variant="scrollable"
      scrollButtons={false}
      // At 320px three tabs do not fit; scrolling them is right, and the divider makes it look
      // like the row it is rather than like clipped text.
      sx={{ mb: 3, borderBottom: 1, borderColor: "divider", minHeight: 44 }}
    >
      {items.map((item) => {
        const Icon = ICONS[item.section];
        return (
          <Tab
            key={item.href}
            value={item.href}
            /*
              The number is part of the label rather than a `<Badge>` (§255): a badge is
              absolutely positioned and would sit over the tab's own underline at 320 pixels,
              and this figure is read rather than noticed — "Înscrieri 42" is what somebody
              wants to see.
            */
            label={
              typeof item.count === "number" ? (
                <>
                  {item.label}{" "}
                  {/*
                    The figure in the club's secondary colour, as a filled pill: at a glance the
                    tab says how many are signed up without the number reading as part of the
                    word (the owner, 2026-09-22). Orange under dark ink is the one accent pair
                    `theme.ts` keeps identical in both schemes, so this needs no dark variant.
                  */}
                  <Box
                    component="span"
                    sx={{
                      bgcolor: "secondary.main",
                      color: "secondary.contrastText",
                      borderRadius: 5,
                      px: 0.75,
                      ml: 0.25,
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      lineHeight: 1.6,
                    }}
                  >
                    {item.count}
                  </Box>
                </>
              ) : (
                item.label
              )
            }
            icon={Icon ? <Icon fontSize="small" /> : undefined}
            iconPosition="start"
            component="a"
            href={item.href}
            // What the number means, for the reader who finds it disagreeing with a list (§277).
            title={typeof item.count === "number" ? item.countHint : undefined}
            sx={{ minHeight: 44, textTransform: "none" }}
          />
        );
      })}
    </Tabs>
  );
}
