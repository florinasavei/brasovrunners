"use client";

import Button, { type ButtonProps } from "@mui/material/Button";
import type { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";

type Props = ButtonProps & Pick<ComponentProps<typeof Link>, "href">;

/**
 * A locale-aware MUI Button that renders as a link.
 *
 * This exists because `component={Link}` cannot be written in a Server Component: passing a
 * component across the server/client boundary fails at prerender with "Functions cannot be
 * passed directly to Client Components". Both halves are client-side in here, so it is fine.
 */
export default function ButtonLink({ href, children, ...props }: Props) {
  return (
    <Button component={Link} href={href} {...props}>
      {children}
    </Button>
  );
}
