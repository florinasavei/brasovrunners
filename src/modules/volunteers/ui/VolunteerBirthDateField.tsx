"use client";

import BirthDateField from "@/modules/registrations/ui/BirthDateField";
import { useRecall } from "@/shared/forms/recall";

/**
 * «Data nașterii» on the organizers' entry of a volunteer (§773; the owner, 2026-10-14: «în loc de vârstă vreau să treacă data
 * nașterii»): the registration form's own box — `BirthDateField`, its mask, its echo «11.05.1990 · 34 de ani în ziua evenimentului»
 * and its plain-text fallback with scripts off — made to come back filled after a refused save, like every other box of the card
 * (`RecallField`, §315). The bounds are the service's: not younger than the minimum on the event's day, not older than the
 * platform's ceiling (`latestVolunteerBirthDate`, `earliestVolunteerBirthDate`), computed on the server and handed over as strings.
 *
 * A client island only because the recall (`useRecall`) and the box's mask are; plain data crosses the boundary — the date, the
 * day, the bounds and the words — and never an element (`AGENTS.md` §14.1).
 */
export default function VolunteerBirthDateField({
  label,
  defaultValue,
  help,
  min,
  max,
  eventDay,
  locale,
  words,
}: {
  label: string;
  /** `YYYY-MM-DD` the row holds, or "" for none. */
  defaultValue: string;
  /** The one help line at rest. */
  help: string;
  /** The oldest and the youngest birth date the service takes, `YYYY-MM-DD`. */
  min: string;
  max: string;
  /** The event's day the age is counted on, `YYYY-MM-DD`. */
  eventDay: string;
  locale: string;
  words: { echoTemplate: string; placeholder: string; unreadable: string; tooYoung: string };
}) {
  const recall = useRecall();
  const named = recall.named("birthDate");
  return (
    <BirthDateField
      key={recall.generation}
      id={recall.idOf("birthDate")}
      name="birthDate"
      label={label}
      defaultValue={recall.value("birthDate") ?? defaultValue}
      error={named}
      errorText={named && recall.fieldError ? recall.fieldError : undefined}
      help={help}
      min={min}
      max={max}
      eventDay={eventDay}
      locale={locale}
      echoTemplate={words.echoTemplate}
      placeholder={words.placeholder}
      unreadable={words.unreadable}
      tooYoung={words.tooYoung}
      autoComplete="off"
      size="small"
      fullWidth
    />
  );
}
