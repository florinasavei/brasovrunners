"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { useBirthDateSaysMinor } from "./use-birth-date-minor";

/**
 * A block the family form offers only for a minor (§389, §421) — the mirror of `HiddenForMinor`.
 *
 * On the form for another person on the same address, the health note and its consent, the
 * public-list tick and the first-person fitness statement are the parent's to give for a child,
 * and nobody's to give for another adult: those are that adult's own consents. So they appear
 * once the birth date says under eighteen, and are gone otherwise.
 *
 * ## Hidden means out of the form
 *
 * The same `<fieldset disabled>` as `HiddenForMinor`: a disabled control is neither validated nor
 * posted, so a required box inside it (the fitness statement) cannot stop an adult's form, and
 * nothing hidden is sent. Hidden in the server's markup and with JavaScript off — the adult is the
 * case nothing typed can contradict there. Hiding is a courtesy, not the rule:
 * `withoutAnotherAdultsConsents` drops these answers for an adult whatever was posted, and a minor
 * whose parent could not see the statement is refused naming it, which `forceOpen` then shows.
 */
export default function ShownForMinor({
  birthDateId,
  forceOpen = false,
  children,
}: {
  birthDateId: string;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const hidden = !useBirthDateSaysMinor(birthDateId) && !forceOpen;
  return (
    <Box
      component="fieldset"
      disabled={hidden}
      data-testid="shown-for-minor"
      // A fieldset's own border, padding and `min-width: min-content` are undone, so the block
      // lays out exactly as the bare children did (and cannot widen the page at 320px).
      sx={{ display: hidden ? "none" : "block", border: 0, p: 0, m: 0, minWidth: 0 }}
    >
      {children}
    </Box>
  );
}
