"use client";

import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import { readingTimeMs, TOOLTIP_TEXT_SX } from "@/shared/ui/tooltip-text";
import { usePathname } from "next/navigation";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { activeAdminTabHref } from "../domain/admin-tab-match";
import type { AdminSection } from "../domain/roles";
import { useEffect, useRef } from "react";
import ArticleIcon from "@mui/icons-material/Article";
import ChecklistIcon from "@mui/icons-material/Checklist";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import EventIcon from "@mui/icons-material/Event";
import GavelIcon from "@mui/icons-material/Gavel";
import GroupIcon from "@mui/icons-material/Group";
import ListAltIcon from "@mui/icons-material/ListAlt";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import NewspaperIcon from "@mui/icons-material/Newspaper";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import TuneIcon from "@mui/icons-material/Tune";

export type AdminTab = {
  href: string;
  label: string;
  section: AdminSection;
  /** A figure beside the label — how many are signed up, on "Înscrieri" (§255). */
  count?: number | null;
  /** What that figure counts, as the tab's tooltip (§277). */
  countHint?: string;
  /**
   * The groups still in progress, each a smaller outlined pill beside the figure, only above zero (§626,
   * §NNN): drawn in `COUNT_PILL_ORDER` whatever order they arrive in.
   */
  countPills?: readonly CountPill[];
  /**
   * Other addresses this tab stands for — «Setări» on `/devs`, the row's «Configurație» tab that
   * lives outside `/admin/settings` (§520) — so the bar still says where the reader is.
   */
  alsoActiveOn?: readonly string[];
};

/**
 * Which group a small pill beside the «Înscrieri» figure stands for (§626, §NNN; the owner, 2026-10-02,
 * verbatim: «Tot pe acest pull [sic] trebuie să afișăm și pe cei care aștept [sic] confirmarea mailului sau
 * semnarea declarației», read as this tab's pill — an interpretation his screenshot of the tab backs):
 * those completing their registration with a place — a declaration to sign, an open offer,
 * a family's hold, a part OF the figure — those awaiting the email confirmation, and the waiting list,
 * both outside it.
 */
export type CountPillKind = "inProgress" | "awaitingEmail" | "waiting";

/** One pill: its group, how many, and what a screen reader says for it — «16 în curs de confirmare». */
export type CountPill = { kind: CountPillKind; count: number; label: string };

/** The pills' order: the part of the figure first, then the two outside it, nearest a place first. */
const COUNT_PILL_ORDER: readonly CountPillKind[] = ["inProgress", "awaitingEmail", "waiting"];

/**
 * Each group's glyph, the one the participant's own steps wear for that step (`RegistrationSteps`: the
 * pen for the declaration, the envelope with the tick for the address) and the waiting list's hourglass.
 * Named in the registry, never imported here (§318).
 */
const COUNT_PILL_GLYPH = {
  inProgress: ACTION_ICONS.declaration,
  awaitingEmail: ACTION_ICONS.emailConfirmation,
  waiting: ACTION_ICONS.waiting,
} satisfies Record<CountPillKind, unknown>;

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
  // «Setări» (§516): the sliders — «Configurație» (/devs) is one of its tabs, with no gear of its own in the bar since §520.
  settings: TuneIcon,
  // The club's news to the people who asked for it (§445): a paper, not an envelope.
  newsletter: NewspaperIcon,
  staff: GroupIcon,
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

  // The longest matching href wins (`activeAdminTabHref`), so every part of a section — «Pagini» →
  // «Contact» included, `/admin/pages/contact` — keeps its section lit.
  const activeHref = activeAdminTabHref(items, pathname);
  const active = items.find((item) => item.href === activeHref);

  /**
   * The current tab, in view, on a phone (`DECISIONS.md` §79). MUI scrolls the selected tab
   * into view once, when it mounts; with nine tabs and a slow phone the fonts and the
   * hydration land later than that, and "Ziua cursei" sat off the right edge. This does it
   * again after hydration, and centres it, so a volunteer sees where they are.
   *
   * Only when the tab is not already wholly in view. Centring one that is moved the whole bar
   * after hydration — on a desktop too, once the Administrator's eleven tabs (§445's «Newsletter»)
   * overflowed it by a hundred pixels — and a click that landed mid-hydration pressed on one tab
   * and released on its neighbour, which navigates nowhere.
   */
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = root.current?.querySelector<HTMLElement>(".MuiTabs-scroller");
    const selected = root.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!scroller || !selected) return;
    const bar = scroller.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    if (tab.left >= bar.left - 1 && tab.right <= bar.right + 1) return;
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
                  <CountBadge count={item.count} hint={item.countHint} pills={item.countPills} />
                </>
              ) : (
                item.label
              )
            }
            icon={Icon ? <Icon fontSize="small" /> : undefined}
            iconPosition="start"
            component="a"
            href={item.href}
            sx={{ minHeight: 44, textTransform: "none" }}
          />
        );
      })}
    </Tabs>
  );
}

/**
 * The figure's pill, and what it counts in the backoffice tooltip (§341, §277): the rule, then
 * one line per upcoming event. The pill is focusable and MUI's `describeChild`
 * makes the text its one description, so a keyboard or a screen reader reaches it; a tap opens
 * it on a phone.
 *
 * On «Înscrieri» the figure is everyone with a place (§NNN, amending §626's confirmed alone), and the
 * groups still in progress follow it as smaller pills — «Înscrieri [150] [✍ 16] [✉ 7] [⏳ 10]». They
 * are not links: the tab is already an anchor, and a link inside one is invalid HTML; the summary
 * strip's pills on the list page are the filters (§626).
 */
function CountBadge({ count, hint, pills = [] }: { count: number; hint?: string; pills?: readonly CountPill[] }) {
  const drawn = COUNT_PILL_ORDER.flatMap((kind) => pills.filter((pill) => pill.kind === kind && pill.count > 0));
  const pill = (
    <>
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
        {count}
      </Box>
      {/*
        The groups in progress (§626, §NNN; the owner: «pune pilluri cu iconițe și cu numerele»): the same
        pill's shape, outlined so each reads as a lesser figure, its glyph before the number. Each is one more
        word-wide chunk inside the tab, and the tab bar scrolls (`variant="scrollable"`), so at 320 pixels
        they lengthen the row and never the page — glyph and number only, the words are the name. Drawn
        only above zero.
      */}
      {drawn.map(({ kind, count: groupCount, label }) => {
        const Glyph = COUNT_PILL_GLYPH[kind];
        return (
          <Box
            key={kind}
            component="span"
            role="img"
            aria-label={label}
            data-testid={`registered-${kind}-pill`}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.25,
              border: 1,
              borderColor: "secondary.main",
              color: "text.primary",
              borderRadius: 5,
              px: 0.5,
              ml: 0.5,
              fontWeight: 700,
              fontSize: "0.75rem",
              lineHeight: 1.5,
              verticalAlign: "middle",
            }}
          >
            <Glyph aria-hidden="true" sx={{ fontSize: "0.875rem" }} />
            {groupCount}
          </Box>
        );
      })}
    </>
  );
  if (!hint) return pill;
  return (
    <Tooltip
      title={hint}
      // The pill keeps the number as its name; the text is its description.
      describeChild
      enterTouchDelay={0}
      leaveTouchDelay={readingTimeMs(hint)}
      arrow
      slotProps={{ tooltip: { sx: TOOLTIP_TEXT_SX } }}
    >
      <Box component="span" tabIndex={0} sx={{ display: "inline-flex" }}>
        {pill}
      </Box>
    </Tooltip>
  );
}
