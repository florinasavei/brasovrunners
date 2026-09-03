"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

/**
 * The site logo as a locale-aware link home.
 *
 * Client-side for the same reason as ButtonLink and CardLink: `component={Link}` cannot be
 * written in a Server Component, because passing a component across the boundary fails at
 * prerender with "Functions cannot be passed directly to Client Components".
 *
 * No `aria-label`. The link contains the club's name as visible text, so a label would either
 * duplicate it or — worse — override it with something a sighted user cannot see. The 44px
 * minimum height is BR-REQ-041-01 criterion 6: a logo is a tap target on a phone.
 */
export default function LogoLink({ children }: { children: ReactNode }) {
  return (
    <Box
      component={Link}
      href="/"
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
