"use client";

import CardActionArea from "@mui/material/CardActionArea";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "@/i18n/navigation";

type Props = Pick<ComponentProps<typeof Link>, "href"> & { children: ReactNode };

/**
 * A whole card that is one locale-aware link.
 *
 * Same reason as ButtonLink: `component={Link}` cannot be written in a Server Component,
 * because passing a component across the server/client boundary fails at render with
 * "Functions cannot be passed directly to Client Components". Both halves are client-side
 * here, so the composition is legal.
 *
 * One link wrapping the whole card, rather than a link on the title, keeps the tap target
 * large on a phone (BR-REQ-041-01 criterion 6).
 */
export default function CardLink({ href, children }: Props) {
  return (
    <CardActionArea component={Link} href={href} sx={{ display: "block" }}>
      {children}
    </CardActionArea>
  );
}
