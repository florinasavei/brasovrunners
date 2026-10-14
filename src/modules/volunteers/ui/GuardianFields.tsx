"use client";

import Box from "@mui/material/Box";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** The three boxes of the guardian's block that the browser should call required while the block is shown (§NNN). */
const GUARDIAN_BOXES = ["guardianName", "guardianEmail", "guardianAware"] as const;

/** Whether an age typed says a person under eighteen: whole years, one to seventeen. Anything else is not asked here (the server judges it). */
function saysMinor(typed: string): boolean {
  const years = typed.trim();
  return /^\d{1,3}$/.test(years) && Number(years) >= 1 && Number(years) < 18;
}

/**
 * The parent's or guardian's boxes on the volunteers' page (§NNN; the owner, 2026-10-14: «atunci fă cu acord ceva» for a
 * volunteer under 18): shown while the age typed is under eighteen, hidden otherwise — and **always shown without scripts**.
 *
 * The server draws the block open and with no box `required`: a visitor with scripts off, or before this island
 * hydrates, finds every box and fills those that apply — an adult leaves them empty and the server drops them
 * (`checkGuardian`). With scripts on, this island watches the age box by its id: it hides the block while the age says
 * nothing under eighteen, and marks the three boxes `required` while it is shown, so the browser asks them of a minor
 * only. The block is a native `fieldset` the server renders as `children` (never a component or an element as a prop
 * across the boundary); this island only decides whether it is seen and whether its boxes are required. The server
 * refuses a minor's post without them in any case — hiding is a courtesy, never the rule.
 */
export default function GuardianFields({ ageInputId, children }: { ageInputId: string; children: ReactNode }) {
  // Open on the server and on the first client render, so what hydrates is what was sent; the effect then follows the age.
  const [open, setOpen] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const age = document.getElementById(ageInputId);
    if (!(age instanceof HTMLInputElement)) return;
    const follow = () => setOpen(saysMinor(age.value));
    follow();
    age.addEventListener("input", follow);
    return () => age.removeEventListener("input", follow);
  }, [ageInputId]);

  useEffect(() => {
    const scope = box.current;
    if (!scope) return;
    for (const name of GUARDIAN_BOXES) {
      for (const input of scope.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) input.required = open;
    }
  }, [open]);

  return (
    <Box ref={box} hidden={!open} data-open={open ? "true" : "false"} data-testid="volunteer-guardian-block">
      {children}
    </Box>
  );
}
