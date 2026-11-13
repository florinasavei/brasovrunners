"use client";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useId, useState } from "react";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";
import { type ChoosablePerson, matchingPeople, pickedPeople } from "./chosen-recipients";

/** The list's words, worded on the server (§324): the island fills `{names}` with the people ticked, and formats nothing else. */
export type ChosenLabels = {
  /** The fifth radio's own words: «Doar anumiți participanți, pe care îi aleg din listă». */
  label: string;
  /** Its short name, as «Mesaje trimise» says it — «Participanți aleși» — for the line beside «Scrie la câți trimiți». */
  short: string;
  /** What the choice is for — a trial before everybody, or a word to a few — and that the words stay after it. */
  help: string;
  search: string;
  /** «Bifați: {count} din {total}» — both filled by the composer with the real people, for the line every group says its number on. */
  count: string;
  /** The test registrations ticked beside them, `{test}` filled by the composer: they receive it too and are counted nowhere. */
  testTicked: string;
  /** Nobody ticked yet: what to do. */
  none: string;
  /** «Primesc mesajul: {names}.» — who, by name, before the press: the question after it can only count them. */
  names: string;
  noMatch: string;
  /** Nobody is registered: there is no list to tick. */
  empty: string;
  /** The mark on a test registration's line (§12.6): it receives the message and is counted nowhere. */
  test: string;
};

/**
 * «Doar anumiți participanți» (§945) — the list under the fifth choice of «Cui îi trimiți»: everybody who can be written
 * to, by name with the registration's state, a box to find a name, and a tick each.
 *
 * The ticks are the composer's state (it disables «Trimite» while nobody is ticked and says how many are), so they
 * survive a search that hides their line and a look at another group. What is posted is one hidden field per person
 * ticked — hidden lines included — under the name the Server Action reads; drawn only while this choice is the chosen
 * one, so a send to a group posts no ticks at all. The server decides again who is written to: only this event's active
 * registrations among them (`sendParticipantMessage`).
 *
 * A name, a state and nothing else of a person (the page's list is for the roles that read the registrations anyway).
 * Enter in the search box finds; it never sends the form.
 */
export default function ChosenRecipients({
  id,
  field,
  people,
  picked,
  onPick,
  labels,
  refused,
}: {
  /** The id the refusal summary links to (`fieldId`), on the list's own box. */
  id: string;
  field: string;
  people: readonly ChoosablePerson[];
  picked: ReadonlySet<string>;
  onPick: (id: string, on: boolean) => void;
  labels: ChosenLabels;
  /** The last send was refused for this list — nobody ticked could be written to. */
  refused: boolean;
}) {
  const helpId = useId();
  const listId = useId();
  const [typed, setTyped] = useState("");
  const shown = matchingPeople(people, typed);
  const chosen = pickedPeople(people, picked);

  return (
    <Box id={id} tabIndex={-1} data-testid="participant-message-chosen" sx={{ mt: 0.5, mb: 1, ml: { sm: 5.5 }, scrollMarginTop: 16 }}>
      <Typography id={helpId} variant="caption" color="text.secondary" component="p">
        {labels.help}
      </Typography>
      {people.length === 0 ? (
        <Typography variant="body2" sx={{ mt: 1 }}>
          {labels.empty}
        </Typography>
      ) : (
        <>
          <TextField
            type="search"
            size="small"
            fullWidth
            label={labels.search}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            // Enter in a form's box sends the form: here it only finds.
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            slotProps={{ htmlInput: { autoComplete: "off", "aria-controls": listId } }}
            sx={{ mt: 1.5 }}
          />
          <Box
            id={listId}
            role="group"
            aria-label={labels.label}
            aria-describedby={helpId}
            sx={{ mt: 1, px: 1, maxHeight: 336, overflowY: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}
          >
            {shown.map((person) => (
              <FormControlLabel
                key={person.id}
                sx={{ display: "flex", mr: 0 }}
                data-testid="participant-message-chosen-row"
                control={<Checkbox checked={picked.has(person.id)} onChange={(event) => onPick(person.id, event.target.checked)} sx={CHECKBOX_TAP_TARGET} />}
                label={
                  <>
                    {person.name}{" "}
                    <Typography component="span" variant="body2" color="text.secondary">
                      · {person.state}
                      {person.test ? ` · ${labels.test}` : ""}
                    </Typography>
                  </>
                }
              />
            ))}
            {shown.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1.5 }}>
                {labels.noMatch}
              </Typography>
            )}
          </Box>
          {/* Who, by name, before the press — the lines a search hides included. */}
          <Typography
            variant="body2"
            color={chosen.length === 0 && refused ? "error" : undefined}
            sx={{ mt: 1, wordBreak: "break-word" }}
            aria-live="polite"
            data-testid="participant-message-chosen-names"
          >
            {chosen.length === 0 ? labels.none : labels.names.replace("{names}", chosen.map((person) => person.name).join(", "))}
          </Typography>
          {chosen.map((person) => (
            <input key={person.id} type="hidden" name={field} value={person.id} />
          ))}
        </>
      )}
    </Box>
  );
}
