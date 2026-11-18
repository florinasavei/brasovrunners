"use client";

import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { createContext, type ReactNode, useContext, useState } from "react";
import RecallField, { useRecall } from "@/shared/forms/recall";
import { effectiveMinimumAge, latestBirthDateFor, yearsPhrase } from "../domain/age";
import { BIB_NUMBER_MAX } from "../domain/spare-bibs";
import BirthDateField from "./BirthDateField";
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
  /** Each event's own minimum age (§329), by id; an event missing here reads as the default. */
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

/**
 * The public form's own box (`BirthDateField`, §561): typed day first, «11.05.1990», never the
 * backoffice's MUI picker (`shared/forms/pickers`, `DECISIONS.md` §345) — a birth date is decades
 * back, and paging a calendar month by month to reach 1985 is slower than typing it. Its helper
 * is the desk's rule and, once a date and an event are chosen, the date in words with the age on
 * that event's day (§467), under the box rather than drawn over its edge. Re-mounted with every
 * refusal, as the kept form's boxes are (§315), and it comes back holding what was posted.
 *
 * `words.tooYoung` carries `{age}`, filled here with the chosen event's own minimum (§329).
 */
export function StaffBirthDateField({
  label,
  helperText,
  locale,
  words,
}: {
  label: string;
  helperText: string;
  locale: string;
  words: { echoTemplate: string; placeholder: string; unreadable: string; tooYoung: string };
}) {
  const recall = useRecall();
  const { selected, eventDays, eventMinAges, today, earliest } = useContext(ChoiceContext);
  const day = selected ? eventDays[selected] : undefined;
  // The chosen event's own minimum (§329), never under fourteen (§515); with no event chosen, today.
  const minAge = effectiveMinimumAge(selected ? eventMinAges[selected] : undefined);
  const youngest = day ? latestBirthDateFor(minAge, day) : today;
  const max = youngest < today ? youngest : today;
  const named = recall.named("birthDate");
  return (
    <BirthDateField
      key={recall.generation}
      id={recall.idOf("birthDate")}
      name="birthDate"
      label={label}
      defaultValue={recall.value("birthDate") ?? ""}
      error={named}
      errorText={named && recall.fieldError ? recall.fieldError : undefined}
      help={helperText}
      min={earliest}
      max={max}
      eventDay={day}
      locale={locale}
      echoTemplate={words.echoTemplate}
      placeholder={words.placeholder}
      unreadable={words.unreadable}
      tooYoung={words.tooYoung.replace("{age}", yearsPhrase(minAge, locale))}
    />
  );
}

/** Where one event's desk spares stand for the walk-in's box (§444, §NNN): none reserved, every one given, or the free ones. */
export type HandedBibSpares =
  | { kind: "none" }
  | { kind: "out" }
  | { kind: "free"; options: ReadonlyArray<{ number: number; label: string }> };

/** The select's two choices that are not a spare: «Alt număr…» shows the typed box, «Fără număr acum» posts none. */
const OTHER_NUMBER = "other";
const NO_NUMBER = "";

/**
 * The number handed to a walk-in with the paper (§444), inside the fast track's box. It follows the event select — re-mounted
 * with the event, so a new choice brings its own spares — and after a refusal it holds what was posted (§315). Plain data
 * crosses the boundary: each event's spares by id, and the words.
 *
 * **While the chosen event has free spares (§NNN; the owner, 2026-11-18: «trebuie sa pot selecta din acele BIB-uri goale (de
 * rezerva)»)** the box is a native select of them, lowest first and the lowest chosen — the number proposed before — then
 * «Alt număr…», which shows the number box to type another bib from the box, and «Fără număr acum», which posts nothing so the
 * site draws one. Without spares it is the number box as it always was. The server is unchanged: it receives a number or none,
 * and refuses a number given meanwhile.
 */
export function StaffHandedBibField({
  label,
  words,
  spares,
}: {
  label: string;
  words: {
    /** What the select says. */
    pickHelp: string;
    /** The typed box under «Alt număr…»: its label and its help. */
    otherLabel: string;
    otherHelp: string;
    /** The box, when the chosen event has no spare reserved. */
    noSpareHelp: string;
    /** And when every reserved spare is given: the box suggests nothing and says so. */
    outHelp: string;
    otherOption: string;
    noneOption: string;
  };
  /** Where each event's spares stand, by id; an event missing here has none reserved. */
  spares: Readonly<Record<string, HandedBibSpares>>;
}) {
  const { selected } = useContext(ChoiceContext);
  const recall = useRecall();
  const state: HandedBibSpares = (selected ? spares[selected] : undefined) ?? { kind: "none" };
  if (state.kind === "free" && state.options.length > 0) {
    return <SpareBibChoice key={`${selected ?? ""}:${recall.generation}`} label={label} words={words} options={state.options} />;
  }
  return (
    <RecallField
      key={selected ?? ""}
      name="bibNumber"
      type="number"
      label={label}
      defaultValue=""
      helperText={state.kind === "out" ? words.outHelp : words.noSpareHelp}
      slotProps={{ htmlInput: { min: 1, max: BIB_NUMBER_MAX, step: 1, inputMode: "numeric" }, inputLabel: { shrink: true } }}
      sx={{ width: { sm: 320 } }}
    />
  );
}

/**
 * The select of the free spares, and the typed box under «Alt număr…». Only one of the two is named `bibNumber` at a time,
 * so the form posts one number or none. After a refusal the posted number comes back: a spare is chosen again, an empty one
 * is «Fără număr acum», anything else is «Alt număr…» with the box holding it.
 */
function SpareBibChoice({
  label,
  words,
  options,
}: {
  label: string;
  words: { pickHelp: string; otherLabel: string; otherHelp: string; otherOption: string; noneOption: string };
  options: ReadonlyArray<{ number: number; label: string }>;
}) {
  const recall = useRecall();
  const recalled = recall.value("bibNumber");
  const isSpare = (value: string) => options.some((option) => String(option.number) === value);
  const initial = recalled === undefined ? String(options[0].number) : recalled === NO_NUMBER ? NO_NUMBER : isSpare(recalled) ? recalled : OTHER_NUMBER;
  const [choice, setChoice] = useState(initial);
  const named = recall.named("bibNumber");
  const refusal = named && recall.fieldError ? recall.fieldError : undefined;
  const other = choice === OTHER_NUMBER;
  return (
    <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
      <TextField
        select
        id={other ? undefined : recall.idOf("bibNumber")}
        name={other ? undefined : "bibNumber"}
        label={label}
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
        error={named && !other}
        helperText={!other && refusal ? refusal : words.pickHelp}
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        sx={{ width: { xs: "100%", sm: 320 } }}
        data-testid="handed-bib-choice"
      >
        {options.map((option) => (
          <option key={option.number} value={String(option.number)}>
            {option.label}
          </option>
        ))}
        <option value={OTHER_NUMBER}>{words.otherOption}</option>
        <option value={NO_NUMBER}>{words.noneOption}</option>
      </TextField>
      {other && (
        <TextField
          id={recall.idOf("bibNumber")}
          name="bibNumber"
          type="number"
          label={words.otherLabel}
          defaultValue={recalled !== undefined && recalled !== NO_NUMBER && !isSpare(recalled) ? recalled : ""}
          error={named}
          helperText={refusal ?? words.otherHelp}
          slotProps={{ htmlInput: { min: 1, max: BIB_NUMBER_MAX, step: 1, inputMode: "numeric" }, inputLabel: { shrink: true } }}
          sx={{ width: { xs: "100%", sm: 320 } }}
          data-testid="handed-bib-other"
        />
      )}
    </Stack>
  );
}

/**
 * «Numere de rezervă libere» on the walk-in's form (§NNN): the chosen event's line, the desk's own words (`spare-line.ts`),
 * following the event select. Plain strings by id; an event missing here says nothing.
 */
export function StaffSparesLine({ lines }: { lines: Readonly<Record<string, string>> }) {
  const { selected } = useContext(ChoiceContext);
  const line = selected ? lines[selected] : undefined;
  if (!line) return null;
  return (
    <Typography variant="body2" color="text.secondary" data-testid="desk-spares">
      {line}
    </Typography>
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
