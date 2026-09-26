"use client";

import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import Flag from "@/shared/ui/Flag";
import type { SearchableCountry } from "../country-search";
import { chooseInSelect, CountryPicker, type CountrySearchWords, PICKER_BUTTON_SX } from "./CountryPicker";

/**
 * Citizenship: required, Romania unless the runner says otherwise (§432), and searchable (§463;
 * the owner, "vreau searchbox să pot găsi țara").
 *
 * **What posts is a native `<select name="nationality" required>`**, drawn by the server with
 * every country as an option and the draft's (or Romania's) chosen — so a reader without
 * JavaScript, or before hydration, picks from the phone's own list and posts an ISO code the
 * server accepts, and a refusal's draft (§142) and the error summary's link to `id` read what they
 * read before. There is no empty option: §432 has no "no answer" and no clear.
 *
 * **Once the island runs**, a transparent button lies over the select and opens the shared
 * `CountryPicker` with its search box; a choice is written into the select with a real `change`
 * event, exactly as the telephone prefix does it.
 *
 * The countries, their order and their names are the server's (§324), handed down as data.
 */
export default function NationalityField({
  id,
  name,
  label,
  error,
  helperText,
  defaultValue,
  countries,
  words,
}: {
  id: string;
  name: string;
  label: string;
  error?: boolean;
  helperText?: string;
  /** The code to start on: a refused submission's (§142), else Romania. */
  defaultValue?: string;
  countries: readonly SearchableCountry[];
  words: CountrySearchWords;
}) {
  const initial = countries.some((country) => country.code === defaultValue)
    ? (defaultValue as string)
    : (countries.find((country) => country.code === "RO")?.code ?? countries[0]?.code ?? "");
  const [value, setValue] = useState(initial);
  const hydrated = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );
  const selectRef = useRef<HTMLSelectElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [searching, setSearching] = useState(false);
  const chosenName = countries.find((country) => country.code === value)?.label ?? value;

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
      onChange={(event) => setValue(event.target.value)}
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
          // Under the search's button once it is there: one control in the tab order, not two.
          tabIndex: hydrated ? -1 : undefined,
          "aria-hidden": hydrated ? true : undefined,
        },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center" }}>
                <Flag code={value} width={20} />
              </Box>
            </InputAdornment>
          ),
          endAdornment: hydrated ? (
            <>
              <Box
                component="button"
                ref={buttonRef}
                type="button"
                aria-label={`${label}: ${chosenName}`}
                aria-haspopup="dialog"
                aria-expanded={searching}
                onClick={(event) => {
                  setAnchor(event.currentTarget);
                  setSearching(true);
                }}
                sx={PICKER_BUTTON_SX}
              />
              {/* Mounted while it closes too, so the transition ends and `onExited` places focus. */}
              {anchor && (
                <CountryPicker
                  mode="citizenship"
                  open={searching}
                  anchorEl={anchor}
                  countries={countries}
                  value={value}
                  label={label}
                  words={words}
                  onChoose={(code) => {
                    chooseInSelect(selectRef.current, code);
                    setSearching(false);
                  }}
                  onDismiss={() => setSearching(false)}
                  onExited={() => buttonRef.current?.focus()}
                />
              )}
            </>
          ) : null,
        },
      }}
    >
      {countries.map((country) => (
        <option key={country.code} value={country.code}>
          {country.label}
        </option>
      ))}
    </TextField>
  );
}
