"use client";

import MenuItem from "@mui/material/MenuItem";
import { createContext, type ReactNode, useContext, useState } from "react";
import RecallField, { useRecall } from "@/shared/forms/recall";
import { latestBirthDateFor, MIN_PARTICIPANT_AGE } from "../domain/age";

/**
 * The staff form's event and birth date, which have to know about each other (§324).
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
 * Two pieces sharing one choice rather than one component, because the two fields are not next
 * to each other on the form: the names come between them. Plain data crosses the boundary —
 * ids, labels, days — and the elements are made here (`AGENTS.md` §14.1).
 */
type Choice = { selected: string | undefined; choose: (eventId: string) => void; eventDays: Record<string, string> };

const ChoiceContext = createContext<Choice>({ selected: undefined, choose: () => {}, eventDays: {} });

export function StaffEventScope({
  eventDays,
  initialEventId,
  children,
}: {
  /** Each event's calendar day in its own zone, by id. */
  eventDays: Record<string, string>;
  initialEventId: string;
  children: ReactNode;
}) {
  const [changed, setChanged] = useState<string | undefined>(undefined);
  const recalled = useRecall().value("eventId");
  const selected = changed ?? (typeof recalled === "string" && recalled !== "" ? recalled : initialEventId);
  return <ChoiceContext.Provider value={{ selected, choose: setChanged, eventDays }}>{children}</ChoiceContext.Provider>;
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
  const { selected, eventDays } = useContext(ChoiceContext);
  const day = selected ? eventDays[selected] : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const youngest = day ? latestBirthDateFor(MIN_PARTICIPANT_AGE, day) : today;
  const max = youngest < today ? youngest : today;
  return (
    <RecallField
      name="birthDate"
      type="date"
      label={label}
      helperText={helperText}
      slotProps={{ inputLabel: { shrink: true }, htmlInput: { max } }}
    />
  );
}
