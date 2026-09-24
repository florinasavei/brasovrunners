"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { useBirthDateSaysMinor } from "./use-birth-date-minor";

/**
 * A block the form offers to adults only — the socials (§323): the privacy notice says the club
 * keeps no Strava or Instagram of a minor, so the boxes go away once the birth date says under
 * eighteen, the mirror of `GuardianForMinor`.
 *
 * Shown in the server's markup and with JavaScript off, because nothing typed is known there and
 * the adult is the common case. Hiding is a courtesy, not the rule: `submitRegistration` stores
 * neither field for a minor whatever the browser sent — a form posted without scripts.
 *
 * ## Hidden means out of the form, not only out of sight
 *
 * `display: none` alone leaves the inputs in the form: still validated, still posted. A Strava
 * box holding something that is not a URL then stops the browser submitting at all ("An invalid
 * form control is not focusable", and nothing on screen says why), and a well-formed URL that is
 * not Strava's comes back refused by the server with the summary pointing at a box the parent
 * cannot see (review finding). So the block is a `<fieldset>` that is `disabled` while hidden:
 * a disabled control is neither validated nor submitted, which is exactly "not asked".
 *
 * `forceOpen` is the server's verdict, as on `GuardianForMinor`: when a submission came back
 * naming one of these fields, the block is shown and enabled whatever the date box holds, so an
 * error never points at something invisible or unreachable.
 */
export default function HiddenForMinor({
  birthDateId,
  forceOpen = false,
  children,
}: {
  birthDateId: string;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const hidden = useBirthDateSaysMinor(birthDateId) && !forceOpen;
  return (
    <Box
      component="fieldset"
      disabled={hidden}
      // A fieldset's own border, padding and `min-width: min-content` are undone, so the block
      // lays out exactly as the bare children did (and cannot widen the page at 320px).
      sx={{ display: hidden ? "none" : "block", border: 0, p: 0, m: 0, minWidth: 0 }}
    >
      {children}
    </Box>
  );
}
