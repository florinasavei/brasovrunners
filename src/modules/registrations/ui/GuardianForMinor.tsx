"use client";

import Box from "@mui/material/Box";
import { type ReactNode, useCallback, useSyncExternalStore } from "react";
import { isMinorOn } from "../domain/age";

/**
 * The parent or guardian's name, shown when the birth date says the runner is a minor
 * (`DECISIONS.md` §188; the owner: "aș vrea ca asta cu «Participantul are sub 18 ani» să apară
 * doar când data nașterii indică faptul că e minor").
 *
 * §185 had made it a tick, because the fold it replaced read as a demand. The tick was the right
 * shape and the wrong question: the form already asks for the birth date, and the birth date is
 * the answer. Asking twice invites the two answers to disagree — and the server would then refuse
 * an unticked minor with an error about a field nobody had been shown.
 *
 * ## Why this is a client island, and what happens without JavaScript
 *
 * Nothing on the server can know what somebody is typing into the date box. So: closed in the
 * server's markup, opened when the birth date gives under eighteen, and — the part that matters —
 * a `<noscript>` rule that forces it open. With JavaScript off the field is simply always there,
 * which is how it behaved before any of this, rather than being unreachable for the one person
 * who has to fill it (`AGENTS.md` §1.5: the form works without JavaScript).
 *
 * `forceOpen` is the server's own verdict: when a submission came back naming `guardianName`, the
 * block renders open whatever the date box currently holds, so an error never points at something
 * invisible.
 *
 * ## Why `useSyncExternalStore` and not an effect
 *
 * The date field is somebody else's DOM — a Server Component's MUI `TextField`, carrying native
 * validation (`min`, `max`, `required`) that lifting it into this island would trade for
 * hand-written validation on the one form that has to work everywhere. So this island subscribes
 * to that input rather than owning it, which is exactly what `useSyncExternalStore` is for: React
 * reads the value during render instead of writing state from an effect, which is both correct
 * under concurrent rendering and what `react-hooks/set-state-in-effect` asks for.
 */
export default function GuardianForMinor({
  birthDateId,
  forceOpen = false,
  children,
}: {
  birthDateId: string;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const input = document.getElementById(birthDateId);
      if (!(input instanceof HTMLInputElement)) return () => {};
      // `input` for typing, `change` for the picker and for autofill.
      input.addEventListener("input", onStoreChange);
      input.addEventListener("change", onStoreChange);
      return () => {
        input.removeEventListener("input", onStoreChange);
        input.removeEventListener("change", onStoreChange);
      };
    },
    [birthDateId],
  );

  const birthDate = useSyncExternalStore(
    subscribe,
    () => {
      const input = document.getElementById(birthDateId);
      return input instanceof HTMLInputElement ? input.value : "";
    },
    // On the server there is no input and nothing typed, so the block renders closed — and the
    // `<noscript>` rule below is what keeps it reachable when that markup is all there will be.
    () => "",
  );

  const open = forceOpen || (birthDate !== "" && isMinorOn(birthDate, new Date()));

  return (
    <>
      <noscript>
        <style>{`.guardian-for-minor { display: block !important }`}</style>
      </noscript>
      <Box className="guardian-for-minor" sx={{ display: open ? "block" : "none" }}>
        {children}
      </Box>
    </>
  );
}
