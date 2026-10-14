"use client";

import Box from "@mui/material/Box";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** The three boxes of the guardian's block that the browser should call required while the block is shown (§768). */
const GUARDIAN_BOXES = ["guardianName", "guardianEmail", "guardianAware"] as const;

/**
 * Whether an age typed says a person the club takes with a guardian: whole years, from the minimum (fourteen) to seventeen.
 * Anything else — a number under the floor, an adult, no number — is not asked here: the server judges it, and a person of
 * thirteen is told the floor, not asked for a parent.
 */
function saysMinor(typed: string, minimumAge: number, adultAge: number): boolean {
  const years = typed.trim();
  return /^\d{1,3}$/.test(years) && Number(years) >= minimumAge && Number(years) < adultAge;
}

/**
 * The parent's or guardian's boxes on the volunteers' page (§768; the owner, 2026-10-14: «atunci fă cu acord ceva» for a
 * volunteer under 18): shown while the age typed is from the minimum to seventeen, hidden otherwise — and **always shown
 * without scripts**.
 *
 * The server draws the block hidden (open only when the age typed back after a refusal says a minor, `startOpen`) and with
 * no box `required`, so an adult never sees it flash before this island hydrates, and a visitor with scripts off — whose
 * `<noscript>` rule opens it — finds every box and fills those that apply: an adult leaves them empty and the server drops
 * them (`refuseGuardianBoxes`). With scripts on, this island watches the age box by its id: it shows the block while the age
 * says a minor, and marks the three boxes `required` while it is shown, so the browser asks them of a minor only. The block is a native `fieldset` the server renders as `children` (never a component or an element as a prop
 * across the boundary); this island only decides whether it is seen and whether its boxes are required. The server
 * refuses a minor's post without them in any case — hiding is a courtesy, never the rule.
 *
 * The floor and the age of majority come from the server as numbers: an island on a public page imports no schema (§489,
 * no Zod in a client island), so the platform's constants are never imported here.
 */
export default function GuardianFields({
  ageInputId,
  minimumAge,
  adultAge,
  startOpen,
  children,
}: {
  ageInputId: string;
  minimumAge: number;
  adultAge: number;
  /** Whether the age the server knows (typed before a refusal) says a minor: the first render, which hydrates as it was sent. */
  startOpen: boolean;
  children: ReactNode;
}) {
  // What the server sent is what hydrates; the effect then follows the age typed.
  const [open, setOpen] = useState(startOpen);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const age = document.getElementById(ageInputId);
    if (!(age instanceof HTMLInputElement)) return;
    const follow = () => setOpen(saysMinor(age.value, minimumAge, adultAge));
    follow();
    age.addEventListener("input", follow);
    return () => age.removeEventListener("input", follow);
  }, [ageInputId, minimumAge, adultAge]);

  useEffect(() => {
    const scope = box.current;
    if (!scope) return;
    for (const name of GUARDIAN_BOXES) {
      for (const input of scope.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) input.required = open;
    }
  }, [open]);

  return (
    <>
      <Box ref={box} hidden={!open} data-open={open ? "true" : "false"} data-testid="volunteer-guardian-block">
        {children}
      </Box>
      {/* Scripts off: nothing decides from the age, so the block is open — the server drops what an adult typed. */}
      <noscript>
        <style>{`[data-testid="volunteer-guardian-block"]{display:block !important}`}</style>
      </noscript>
    </>
  );
}
