"use client";

import Box from "@mui/material/Box";
import { type ReactNode, useEffect, useRef, useSyncExternalStore } from "react";
import { ageOn } from "@/modules/registrations/domain/age";
import { useBirthDateValue } from "@/modules/registrations/ui/use-birth-date-minor";

/** The three boxes of the guardian's block that the browser should call required while the block is shown (§768). */
const GUARDIAN_BOXES = ["guardianName", "guardianEmail", "guardianAware"] as const;

/**
 * Whether a date of birth says a person the club takes with a guardian: from the minimum (fourteen) to seventeen **on the event's
 * day** (§773, `volunteerEventDay`) — a person who is seventeen today and eighteen on the morning of the race is not asked for a
 * parent. Anything else — no date yet, one that makes a younger person or an adult — is not asked here: the server judges it, and a
 * person of thirteen is told the floor, not asked for a parent.
 */
function saysMinor(birthDate: string, eventDay: string, minimumAge: number, adultAge: number): boolean {
  if (birthDate === "") return false;
  const years = ageOn(birthDate, eventDay);
  return years !== null && years >= minimumAge && years < adultAge;
}

/**
 * The parent's or guardian's boxes on the volunteers' page (§768; the owner, 2026-10-14: «atunci fă cu acord ceva» for a
 * volunteer under 18): shown while the date of birth typed (§773: «Data nașterii», the registration form's own box, which this
 * island reads by its id as `GuardianForMinor` does, `useBirthDateValue`) gives from the minimum to seventeen on the event's day,
 * hidden otherwise — and **always shown without scripts**.
 *
 * The server draws the block hidden (open only when the date typed back after a refusal says a minor, `startOpen`) and with
 * no box `required`, so an adult never sees it flash before this island hydrates, and a visitor with scripts off — whose
 * `<noscript>` rule opens it — finds every box and fills those that apply: an adult leaves them empty and the server drops
 * them (`refuseGuardianBoxes`). With scripts on, this island watches the date box by its id: it shows the block while the date
 * says a minor, and marks the three boxes `required` while it is shown, so the browser asks them of a minor only. The block is a
 * native `fieldset` the server renders as `children` (never a component or an element as a prop across the boundary); this island
 * only decides whether it is seen and whether its boxes are required. The server refuses a minor's post without them in any
 * case — hiding is a courtesy, never the rule.
 *
 * The floor, the age of majority and the event's day come from the server as plain values: an island on a public page imports no
 * schema (§489, no Zod in a client island), so the platform's constants are never imported here.
 */
export default function GuardianFields({
  birthDateId,
  eventDay,
  minimumAge,
  adultAge,
  startOpen,
  children,
}: {
  birthDateId: string;
  /** The day the age is counted on, `YYYY-MM-DD`. */
  eventDay: string;
  minimumAge: number;
  adultAge: number;
  /** Whether the date the server knows (typed before a refusal) says a minor: the first render, which hydrates as it was sent. */
  startOpen: boolean;
  children: ReactNode;
}) {
  // What the server sent is what hydrates; once the page is interactive the date typed decides.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const birthDate = useBirthDateValue(birthDateId);
  const open = hydrated ? saysMinor(birthDate, eventDay, minimumAge, adultAge) : startOpen;
  const box = useRef<HTMLDivElement>(null);

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
      {/* Scripts off: nothing decides from the date, so the block is open — the server drops what an adult typed. */}
      <noscript dangerouslySetInnerHTML={{ __html: '<style>[data-testid="volunteer-guardian-block"]{display:block !important}</style>' }} />
    </>
  );
}
