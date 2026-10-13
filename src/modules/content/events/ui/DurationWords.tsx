"use client";

import { useSelectedValue } from "./OnlyForType";

/**
 * «Durata»'s label and help by the event's type, as the type select says right now (§NNN; the owner,
 * 2026-10-13, on «Ore / Minute» and «Cât durează — de exemplu 1 oră și 45 de minute…»: «Aici nu e clar
 * „cât durează” ce? trebuie să pot pune timp limită»). A race asks «Timp limită» — how long the runners
 * have from the start (the gun, when it has one: `duration.ts#durationBase`) until the finish closes —
 * and every other event «Cât durează evenimentul». The same two boxes and the same column underneath;
 * only the words follow the select.
 *
 * Text only, so it can stand inside the fieldset's `<legend>` beside the glyph the Server Component
 * draws: strings in, a string out — no element crosses into this island (§370). The server's first
 * paint is the saved type's words (`initialType`); a refused save re-renders from what was posted.
 */
export default function DurationWords({
  selectName,
  initialType,
  race,
  other,
}: {
  selectName: string;
  initialType: string;
  /** The words for a race. */
  race: string;
  /** The words for a group run or any other event. */
  other: string;
}) {
  const type = useSelectedValue(selectName, initialType);
  return <span data-testid="duration-words">{type === "RACE" ? race : other}</span>;
}
