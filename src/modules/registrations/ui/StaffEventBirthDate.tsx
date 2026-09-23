"use client";

import MenuItem from "@mui/material/MenuItem";
import { createContext, type ReactNode, useContext, useState } from "react";
import RecallField, { useRecall } from "@/shared/forms/recall";
import { latestBirthDateFor, MIN_PARTICIPANT_AGE } from "../domain/age";
import GuardianForMinor from "./GuardianForMinor";

/**
 * The staff form's event, birth date and parent, which have to know about each other (§324).
 *
 * The public form's date box stops at the latest birth date that is still fourteen on the
 * race's own day (§321), computed on the server for the one event the page is about. The staff
 * form — `/admin/registrations/new`, which the desk's walk-in opens — chooses the event on the
 * same form, so the bound is not known until the volunteer has chosen. A small island, then:
 * the server hands over each event's calendar day as a string (`YYYY-MM-DD`, already in the
 * event's own zone), the select says which one is chosen, and the date box's `max` follows —
 * `latestBirthDateFor`, the same arithmetic the server refuses with, and today as a bound as
 * well, as on the public form. The server still decides; this only stops the picker offering a
 * date it would turn back.
 *
 * Pieces sharing one choice rather than one component, because the fields are not next to each
 * other on the form: the names come between the event and the date. Plain data crosses the
 * boundary — ids, labels, days — and the elements are made here (`AGENTS.md` §14.1).
 */
type Choice = {
  selected: string | undefined;
  choose: (eventId: string) => void;
  /** Each event's calendar day in its own zone, by id. */
  eventDays: Readonly<Record<string, string>>;
  /** Each event's own minimum age (§NNN), by id; an event missing here reads as the default. */
  eventMinAges: Readonly<Record<string, number>>;
  /** Today and a hundred and twenty years ago, from the server, so both renders agree. */
  today: string;
  earliest: string;
};

const ChoiceContext = createContext<Choice>({
  selected: undefined,
  choose: () => {},
  eventDays: {},
  eventMinAges: {},
  today: "9999-12-31",
  earliest: "0001-01-01",
});

export function StaffEventScope({
  eventDays,
  eventMinAges = {},
  initialEventId,
  today,
  earliest,
  children,
}: {
  eventDays: Readonly<Record<string, string>>;
  eventMinAges?: Readonly<Record<string, number>>;
  initialEventId: string;
  today: string;
  earliest: string;
  children: ReactNode;
}) {
  const [changed, setChanged] = useState<string | undefined>(undefined);
  // After a refusal the select comes back holding what was posted (§315), and so does this.
  const recalled = useRecall().value("eventId");
  const selected = changed ?? (recalled ? recalled : initialEventId);
  return (
    <ChoiceContext.Provider value={{ selected, choose: setChanged, eventDays, eventMinAges, today, earliest }}>
      {children}
    </ChoiceContext.Provider>
  );
}

export function StaffEventSelect({
  events,
  label,
  defaultValue,
}: {
  events: ReadonlyArray<{ id: string; label: string }>;
  label: string;
  defaultValue: string;
}) {
  const { choose } = useContext(ChoiceContext);
  return (
    <RecallField
      select
      name="eventId"
      label={label}
      defaultValue={defaultValue}
      required
      onChange={(event) => choose(event.target.value)}
    >
      {events.map((event) => (
        <MenuItem key={event.id} value={event.id}>
          {event.label}
        </MenuItem>
      ))}
    </RecallField>
  );
}

export function StaffBirthDateField({ label, helperText }: { label: string; helperText: string }) {
  const { selected, eventDays, eventMinAges, today, earliest } = useContext(ChoiceContext);
  const day = selected ? eventDays[selected] : undefined;
  // The chosen event's own minimum (§NNN); zero is no minimum, and then the only bound is today.
  const minAge = selected ? (eventMinAges[selected] ?? MIN_PARTICIPANT_AGE) : MIN_PARTICIPANT_AGE;
  const youngest = day && minAge > 0 ? latestBirthDateFor(minAge, day) : today;
  const max = youngest < today ? youngest : today;
  return (
    <RecallField
      name="birthDate"
      type="date"
      label={label}
      helperText={helperText}
      slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: earliest, max } }}
    />
  );
}

/**
 * The parent or guardian's box (§108), shown when the birth date says under eighteen today — the
 * public form's own island and rule (`GuardianForMinor`, §188) — so a fourteen-to-seventeen-year-old
 * can be entered at the desk with a birth date rather than refused over a box that was not there.
 *
 * Two things the public form does not need. Its date box is found by the id the kept form gives
 * it (`useRecall().idOf`), and the block is re-mounted with every refusal, because the kept
 * form re-mounts its boxes then (§315) and a subscription to the old input would read nothing.
 * And a refusal that named the parent's box opens it whatever the date now says, so the summary
 * never links to something hidden.
 */
export function StaffGuardian({ children }: { children: ReactNode }) {
  const recall = useRecall();
  return (
    <GuardianForMinor key={recall.generation} birthDateId={recall.idOf("birthDate")} forceOpen={recall.named("guardianName")}>
      {children}
    </GuardianForMinor>
  );
}
