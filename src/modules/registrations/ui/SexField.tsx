"use client";

import FemaleIcon from "@mui/icons-material/Female";
import MaleIcon from "@mui/icons-material/Male";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { OPTION_GLYPH_SX } from "@/shared/ui/select-option";
import { SEX_CHOICES, type SexChoice } from "../domain/sex";
import { chooseInSelect, PICKER_BUTTON_SX } from "./CountryPicker";

/** Each answer's glyph beside its word (§171, §554; the owner: «trebuie să afișăm și iconițele»). */
const SEX_GLYPHS = { FEMALE: FemaleIcon, MALE: MaleIcon } as const satisfies Record<SexChoice, unknown>;

/** 44 pixels a row: a thumb picks an answer (BR-REQ-041-01 criterion 6). */
const ROW_PX = 44;

/**
 * «Sex» on the public registration form: a dropdown, «Feminin» first and «Masculin» second, each
 * with its glyph (§NNN, amending §554; the owner, 2026-09-29: «put the Female sex first, and make
 * it a dropdown again, not radio»). Only the two answers of §554 — no «Prefer să nu spun».
 *
 * **What posts is a native `<select name="sex" required>`** the server draws, as the citizenship
 * does (§463): its first option is an empty, disabled «Alege…», chosen while there is no draft
 * (nothing pre-chosen, §510), then the two answers. A reader without JavaScript, or before
 * hydration, picks from the phone's own list; the browser, the §422 list and the server refuse a
 * form with no answer. The select carries the field's id, where the refusal summary's link lands
 * (§47), and `aria-invalid` when the refusal named it.
 *
 * **Once the island runs**, a transparent button lies over the select and opens a list with each
 * answer's glyph beside its word — a native `<option>` cannot carry one — and a choice is written
 * into the select with a real `change` event (`chooseInSelect`), so what is posted, a refusal's
 * draft (§142) and the §422 list read exactly what they read without it. The chosen answer's glyph
 * then stands in front of its word in the closed field. The summary's link still lands on the
 * select; the select hands its focus to the button, the one control in the tab order.
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
  /** A refused submission's answer (§142); anything else — the retired one included — starts on the placeholder. */
  defaultValue?: string;
  /** «Alege…» / «Choose…», the empty first option. */
  placeholder: string;
  /** Each answer's word, in the reader's language. */
  answers: Readonly<Record<SexChoice, string>>;
}) {
  const initial = (SEX_CHOICES as readonly string[]).includes(defaultValue ?? "") ? (defaultValue as SexChoice) : "";
  const [value, setValue] = useState<SexChoice | "">(initial);
  const hydrated = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );
  const selectRef = useRef<HTMLSelectElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const Glyph = value ? SEX_GLYPHS[value] : null;
  const listId = `${id}-list`;

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
      onChange={(event) => setValue(event.target.value as SexChoice | "")}
      sx={{
        "& .MuiInputBase-root:has(> button:focus-visible)": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: "-3px",
        },
      }}
      slotProps={{
        select: { native: true },
        inputLabel: { shrink: true },
        htmlInput: {
          ref: selectRef,
          // Under the button once it is there: one control in the tab order, not two. The refusal
          // summary's link still lands here, and the focus goes on to the button.
          tabIndex: hydrated ? -1 : undefined,
          "aria-hidden": hydrated ? true : undefined,
          onFocus: hydrated ? () => buttonRef.current?.focus() : undefined,
        },
        input: {
          startAdornment: Glyph ? (
            <InputAdornment position="start">
              <Box component="span" sx={OPTION_GLYPH_SX}>
                <Glyph fontSize="small" aria-hidden="true" />
              </Box>
            </InputAdornment>
          ) : undefined,
          endAdornment: hydrated ? (
            <>
              <Box
                component="button"
                ref={buttonRef}
                type="button"
                aria-label={`${label}: ${value ? answers[value] : placeholder}`}
                aria-haspopup="listbox"
                aria-expanded={Boolean(anchor)}
                aria-controls={anchor ? listId : undefined}
                aria-invalid={error || undefined}
                aria-describedby={helperText ? `${id}-helper-text` : undefined}
                onClick={(event) => setAnchor(event.currentTarget)}
                sx={PICKER_BUTTON_SX}
              />
              <Menu
                open={Boolean(anchor)}
                anchorEl={anchor}
                onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                transformOrigin={{ vertical: "top", horizontal: "left" }}
                slotProps={{
                  paper: { sx: { minWidth: anchor?.clientWidth } },
                  list: { id: listId, role: "listbox", "aria-label": label },
                }}
              >
                {SEX_CHOICES.map((answer) => {
                  const Option = SEX_GLYPHS[answer];
                  return (
                    <MenuItem
                      key={answer}
                      role="option"
                      selected={value === answer}
                      aria-selected={value === answer}
                      sx={{ minHeight: ROW_PX }}
                      onClick={() => {
                        chooseInSelect(selectRef.current, answer);
                        setAnchor(null);
                      }}
                    >
                      <ListItemIcon>
                        <Option fontSize="small" aria-hidden="true" />
                      </ListItemIcon>
                      <ListItemText>{answers[answer]}</ListItemText>
                    </MenuItem>
                  );
                })}
              </Menu>
            </>
          ) : null,
        },
      }}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {SEX_CHOICES.map((answer) => (
        <option key={answer} value={answer}>
          {answers[answer]}
        </option>
      ))}
    </TextField>
  );
}
