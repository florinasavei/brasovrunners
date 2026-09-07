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
      sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: { xs: 1, sm: 2 } }}
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
