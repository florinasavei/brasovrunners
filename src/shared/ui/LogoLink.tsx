"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { prefetchFor } from "@/i18n/prefetch";

/**
 * The site logo as a locale-aware link home.
 *
 * Client-side for the same reason as ButtonLink and CardLink: `component={Link}` cannot be
 * written in a Server Component, because passing a component across the boundary fails at
 * prerender with "Functions cannot be passed directly to Client Components".
 *
 * `label` is the club's name as it is actually spelled. The visible wordmark is the kit's
 * logotype, BRASOV RUNNERS, which drops the ș because the kit's typeface has no Romanian
 * characters. Announcing that to a screen reader would spell the club's name wrong, so the
 * accessible name is set from the message catalogue instead. The two still match closely
 * enough for voice control to work: "Brasov Runners" is what a speaker says either way.
 *
 * The 44px minimum height is BR-REQ-041-01 criterion 6: a logo is a tap target on a phone.
 *
 * `href` is the listing while the root redirects there (§342: a nav link goes straight to where it
 * lands, one hop fewer and one less "page with redirect" for a crawler), and the root itself while
 * «Pagina principală» is on (§714, `docs/REDESIGN.md` decision 3: the home page is reached from the
 * logo, never from a menu entry). The header reads the setting and says which; both are static pages.
 */
export default function LogoLink({ children, label, href = "/events" }: { children: ReactNode; label: string; href?: "/" | "/events" }) {
  return (
    <Box
      component={Link}
      href={href}
      prefetch={prefetchFor(href)}
      aria-label={label}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 1.25,
        minHeight: 44,
        color: "inherit",
        textDecoration: "none",
      }}
    >
      {children}
    </Box>
  );
}
