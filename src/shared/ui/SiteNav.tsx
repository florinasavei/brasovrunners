"use client";

import Box from "@mui/material/Box";
import { useTranslations } from "next-intl";
import { useSelectedLayoutSegments } from "next/navigation";
import { Link } from "@/i18n/navigation";

/**
 * The site's sections, in the header, on every page.
 *
 * Until this existed the only way out of an event page was the logo — a convention people know
 * rather than a signpost people read. Somebody who landed on `/ro/evenimente/tura-pe-tampa`
 * from a search had nothing telling them the site has a list of events at all.
 *
 * ## Why this is a Client Component
 *
 * For `aria-current`, and nothing else. Marking the section you are in is what separates
 * navigation from a row of links, and it needs to know where you are.
 * `useSelectedLayoutSegment` runs during the server render too, so the anchors carry real
 * `href`s in the HTML and every link works with JavaScript switched off — the same reasoning
 * `LocaleSwitcher` already documents.
 *
 * The segment is the *folder* under `[locale]`, so it is `events` whether the visitor is on
 * `/ro/evenimente` or `/en/events`. That is why the comparison here needs no localized path
 * and cannot drift when a slug is translated (`AGENTS.md` §9.2).
 *
 * ## Why the list is so short
 *
 * Because it is honest. Events is the section this site is built around; the legal pages live in
 * the footer, where legal links belong. Articles and galleries are still M5, and a nav item
 * pointing at a route that 404s is worse than one that is missing.
 *
 * The club's own standing pages are no longer among the missing (BR-REQ-050-03): they are
 * created by an organizer rather than by a developer, so they arrive as a prop from
 * `SiteHeader` — which is a Server Component and can read them — rather than as a constant
 * somebody has to remember to edit.
 */
const SECTIONS = [{ segment: "events", href: "/events" }] as const;

export type NavPage = { slug: string; title: string };

export default function SiteNav({ pages = [] }: { pages?: readonly NavPage[] }) {
  const t = useTranslations("Site.nav");
  /*
    Segments rather than one segment: a standing page is two deep (`pages` then its slug), and
    comparing only the first would mark every page as the current one.
  */
  const segments = useSelectedLayoutSegments();
  const selected = segments[0];

  return (
    <Box
      component="nav"
      aria-label={t("label")}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: { xs: 1, sm: 2 },
        /**
         * One row, always, however many pages the club publishes.
         *
         * This wrapped, and the header it sits in is `position: sticky`. Every published
         * standing page adds an entry (BR-REQ-050-03), so at 320px a club with a dozen of them
         * pushed the navigation onto row after row and the sticky header grew until it covered
         * the page beneath it. That is not hypothetical: it broke an end-to-end test by
         * intercepting a click on the button underneath, which reads as a flaky test and is
         * really the header eating the page.
         *
         * Wrapping is what made the height unbounded, so the height is bounded here instead.
         * The overflow scrolls sideways — the pattern every mobile tab bar already uses, and
         * one the browser implements natively: no client island, no JavaScript, and it holds
         * for three pages or thirty. The alternative, an overflow menu, needs state, a popup
         * and a client boundary to hide links that fit fine on a laptop.
         *
         * `minWidth: 0` because this is a flex child, and a flex child refuses to shrink below
         * its content without it — the scroll would never engage and the row would overflow the
         * page sideways instead, which is the defect this replaces (BR-REQ-041-01 criterion 1).
         */
        flexWrap: "nowrap",
        minWidth: 0,
        overflowX: "auto",
        // The current section is marked with a 2px underline; without room for it the scroll
        // container clips it away exactly on the entry it is meant to identify.
        pb: "2px",
        scrollbarWidth: "thin",
        // A scrollable row of links is still a row of links to a keyboard: nothing here is
        // reachable only by dragging.
        "& > *": { flexShrink: 0 },
      }}
    >
      {SECTIONS.map((section) => {
        const current = selected === section.segment;

        return (
          <Link key={section.segment} href={section.href} style={{ textDecoration: "none" }}>
            <Box
              component="span"
              aria-current={current ? "page" : undefined}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                // BR-REQ-041-01 criterion 6: a target a thumb can hit, on the phone this site
                // is mostly read on.
                minHeight: 44,
                px: 0.5,
                color: current ? "text.primary" : "text.secondary",
                fontWeight: current ? 700 : 500,
                // An underline under the current section, not colour alone: colour is not
                // available to every reader, and weight alone is easy to miss.
                borderBottom: 2,
                borderColor: current ? "primary.main" : "transparent",
                "&:hover": { color: "text.primary" },
              }}
            >
              {t(section.segment)}
            </Box>
          </Link>
        );
      })}

      {/* One entry per published page, in the order the club put them in. */}
      {pages.map((page) => {
        const current = selected === "pages" && segments[1] === page.slug;

        return (
          <Link
            key={page.slug}
            href={{ pathname: "/pages/[slug]", params: { slug: page.slug } }}
            style={{ textDecoration: "none" }}
          >
            <Box
              component="span"
              aria-current={current ? "page" : undefined}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 44,
                px: 0.5,
                color: current ? "text.primary" : "text.secondary",
                fontWeight: current ? 700 : 500,
                borderBottom: 2,
                borderColor: current ? "primary.main" : "transparent",
                "&:hover": { color: "text.primary" },
              }}
            >
              {page.title}
            </Box>
          </Link>
        );
      })}
    </Box>
  );
}
