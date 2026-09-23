"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { useBirthDateSaysMinor } from "./use-birth-date-minor";

/**
 * A block the form offers to adults only — the socials (§NNN): the privacy notice says the club
 * keeps no Strava or Instagram of a minor, so the boxes go away once the birth date says under
 * eighteen, the mirror of `GuardianForMinor`.
 *
 * Shown in the server's markup and with JavaScript off, because nothing typed is known there and
 * the adult is the common case. Hiding is a courtesy, not the rule: `submitRegistration` stores
 * neither field for a minor whatever the browser sent — a value typed before the date was, or a
 * form posted without scripts.
 */
export default function HiddenForMinor({ birthDateId, children }: { birthDateId: string; children: ReactNode }) {
  const minor = useBirthDateSaysMinor(birthDateId);
  return <Box sx={{ display: minor ? "none" : "block" }}>{children}</Box>;
}
