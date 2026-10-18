"use client";

import type { ReactNode } from "react";
import { ShownWhen, useSelectedValue } from "./OnlyForType";

/**
 * Shows its children while the event asks for no registration (§811, «Vin!» part 1): a type that takes none (a group run,
 * §111) **or** a type that does, with «Fără înscrieri» chosen. The editor's «Acceptă răspunsuri „Vin!”» tick belongs to exactly
 * that — an event one simply turns up to — and is written off by any other mode (`service.ts#hiddenByMode`).
 *
 * `OnlyForType` and `OnlyForMode` read one select each; this one needs both answers, so it reads both with the same observer
 * (`useSelectedValue`) and shows when either says "no registration". The children are always in the DOM — hidden, not removed —
 * so the tick posts whatever the form shows, and `ShownWhen` keeps a hidden box from stopping the save.
 */
export default function OnlyForTurnUp({
  registeringTypes,
  initialType,
  initialMode,
  children,
}: {
  /** The types that take registrations (`takesRegistrations`): every other type is turned up to. */
  registeringTypes: readonly string[];
  initialType: string;
  initialMode: string;
  children: ReactNode;
}) {
  const type = useSelectedValue("event.type", initialType);
  const mode = useSelectedValue("event.registrationMode", initialMode);
  const shown = !registeringTypes.includes(type) || mode === "NONE";
  return (
    <ShownWhen shown={shown} answer={`${type}:${mode}`}>
      {children}
    </ShownWhen>
  );
}
