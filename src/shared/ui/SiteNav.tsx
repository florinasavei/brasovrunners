"use client";

import Box from "@mui/material/Box";
import { useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
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
 * Because it is honest. Events is the only public section that exists; the legal pages live in
 * the footer, where legal links belong. Articles, galleries and the club's own pages are M5,
 * and a nav item pointing at a route that 404s is worse than one that is missing. Adding a
 * section later is one entry below.
 */
const SECTIONS = [{ segment: "events", href: "/events" }] as const;

export default function SiteNav() {
  const t = useTranslations("Site.nav");
  const selected = useSelectedLayoutSegment();

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
    </Box>
  );
}
