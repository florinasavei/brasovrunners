"use client";

import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { takesRegistrations, type EventType } from "@/modules/events/domain/event-type";
import { declarationKindMismatch, type RaceDeclarationKey } from "@/modules/legal-documents/domain/keys";
import { useRecall } from "@/shared/forms/recall";
import { useSelectedValue } from "./OnlyForType";

const NAME = "event.declarationDocumentId";

/**
 * «Declarația pe care o semnează participantul» (§39, §515): the race's declaration, a choice among
 * the approved versions of both kinds, trail and road or park.
 *
 * A client island because its start follows the surface select of «Traseul», read with the observer
 * `OnlyForType` uses: a race with **no declaration chosen** — a new one, or a saved one that never had
 * one — starts on the newest version in force of the kind its course reads (`preselectedRaceDeclaration`,
 * computed per surface on the server and handed in as `preselect`), and follows the surface until
 * somebody picks by hand. A saved choice is never replaced: an existing asphalt race that names a
 * trail version keeps it, and the line under the select (`declarationKindMismatch`) says the course
 * calls for the other kind, so the organizer changes it on purpose.
 *
 * The start applies only while the form says the event registers on the site (a type that takes
 * registrations, mode «Înscrieri pe site»): the select is hidden, never removed, for any other mode,
 * and it still posts — a version id posted for a run with no registration here is a refusal (§39),
 * so there it starts on «Niciuna», as it always did.
 *
 * After a refused save the posted value comes back (§315), as `RecallField` does.
 */
export default function RaceDeclarationSelect({
  initialType,
  initialMode,
  initialSurface,
  savedId,
  options,
  preselect,
  words,
}: {
  initialType: string;
  initialMode: string;
  initialSurface: string;
  /** The version the saved event names, or null (a new event, or one with none chosen). */
  savedId: string | null;
  options: readonly { id: string; key: RaceDeclarationKey; label: string }[];
  /** The start for each value of the surface select, blank included: a version id, or "" for none. */
  preselect: Record<string, string>;
  words: {
    label: string;
    help: string;
    unset: string;
    /** «Traseul e pe «Asfalt», iar varianta aleasă e «Eveniment montan»: …» — by the surface, then the kind it wants. */
    mismatch: Record<string, Partial<Record<RaceDeclarationKey, string>>>;
  };
}) {
  const recall = useRecall();
  const surface = useSelectedValue("event.surface", initialSurface);
  const type = useSelectedValue("event.type", initialType);
  const mode = useSelectedValue("event.registrationMode", initialMode);
  const registersHere = takesRegistrations(type as EventType) && mode === "INTERNAL";
  // Picked by hand: from then on the select keeps what the person chose.
  const [manual, setManual] = useState<string | null>(null);
  const recalled = recall.has ? (recall.value(NAME) ?? "") : null;
  // A saved id the list no longer holds (a withdrawn version) is still posted as it was, as the
  // plain select did before: the save, not this box, says what is wrong with it.
  const value = manual ?? recalled ?? savedId ?? (registersHere ? (preselect[surface] ?? preselect[""] ?? "") : "");
  const chosenKey = options.find((option) => option.id === value)?.key ?? null;
  const wanted = declarationKindMismatch(chosenKey, surface || null, options);
  const note = wanted ? words.mismatch[surface]?.[wanted] : undefined;
  const named = recall.named(NAME);

  return (
    <Stack spacing={1} data-testid="race-declaration-select">
      <TextField
        select
        key={recall.generation}
        id={recall.idOf(NAME)}
        name={NAME}
        label={words.label}
        value={value}
        onChange={(event) => setManual(event.target.value)}
        error={named}
        helperText={named && recall.fieldError ? recall.fieldError : words.help}
      >
        <MenuItem value="">{words.unset}</MenuItem>
        {options.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
      {note && (
        <Typography variant="body2" color="warning.main" data-testid="race-declaration-mismatch">
          {note}
        </Typography>
      )}
    </Stack>
  );
}
