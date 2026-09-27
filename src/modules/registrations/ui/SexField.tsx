"use client";

import FemaleIcon from "@mui/icons-material/Female";
import MaleIcon from "@mui/icons-material/Male";
import PersonIcon from "@mui/icons-material/Person";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import { OPTION_GLYPH_SX } from "@/shared/ui/select-option";
import Box from "@mui/material/Box";

export const SEX_ANSWERS = ["FEMALE", "MALE", "UNSPECIFIED"] as const;
type SexAnswer = (typeof SEX_ANSWERS)[number];

/** A glyph beside the chosen answer (§171; the owner: "pune iconițe chiar și la sex"). */
const GLYPHS = { FEMALE: FemaleIcon, MALE: MaleIcon, UNSPECIFIED: PersonIcon } as const;

/**
 * «Sex» on the public registration form: an answer the runner gives, never one pre-chosen (§NNN).
 *
 * **What posts is a native `<select name="sex" required>`** drawn by the server, like the
 * citizenship (§463): its first option is an empty, disabled «Alege…», chosen while there is no
 * draft, then the three answers. So a reader without JavaScript, or before hydration, picks from
 * the phone's own list, and the browser's required check refuses a form with no answer — a MUI
 * listbox select would post through a hidden input only JavaScript can fill, and a required one
 * would lock a no-JavaScript reader out of the form entirely.
 *
 * Once the island runs it adds only the chosen answer's glyph in front of the words; a native
 * `<option>` cannot carry one.
 */
export default function SexField({
  id,
  name,
  label,
  error,
  helperText,
  defaultValue,
  placeholder,
  answers,
}: {
  id: string;
  name: string;
  label: string;
  error?: boolean;
  helperText?: string;
  /** A refused submission's answer (§142); anything else starts on the placeholder. */
  defaultValue?: string;
  /** «Alege…» / «Choose…», the empty first option. */
  placeholder: string;
  /** Each answer's words, in the reader's language. */
  answers: Readonly<Record<SexAnswer, string>>;
}) {
  const initial = (SEX_ANSWERS as readonly string[]).includes(defaultValue ?? "") ? (defaultValue as SexAnswer) : "";
  const [value, setValue] = useState<SexAnswer | "">(initial);
  const Glyph = value ? GLYPHS[value] : null;

  return (
    <TextField
      id={id}
      name={name}
      label={label}
      select
      required
      fullWidth
      error={error}
      helperText={helperText}
      defaultValue={initial}
      onChange={(event) => setValue(event.target.value as SexAnswer | "")}
      slotProps={{
        select: { native: true },
        inputLabel: { shrink: true },
        input: Glyph
          ? {
              startAdornment: (
                <InputAdornment position="start">
                  <Box component="span" sx={OPTION_GLYPH_SX}>
                    <Glyph fontSize="small" aria-hidden="true" />
                  </Box>
                </InputAdornment>
              ),
            }
          : undefined,
      }}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {SEX_ANSWERS.map((answer) => (
        <option key={answer} value={answer}>
          {answers[answer]}
        </option>
      ))}
    </TextField>
  );
}
