"use client";

import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import Flag from "@/shared/ui/Flag";
import type { SearchableCountry } from "../country-search";
import { searchCountries } from "../country-search";
import { CountryOptionRow, type CountrySearchWords } from "./CountrySearch";

/**
 * Citizenship as a box you type into (§NNN): the owner, "vreau searchbox să pot găsi țara".
 *
 * It was a MUI `Select` of two hundred and fifty flags and names — a scroll, with nothing to
 * type. Now the field *is* the search: tap, type "germ", pick Germania. The same rule as the
 * telephone prefix's search (`country-search.ts`), accents and case ignored.
 *
 * **What is posted is unchanged**: a hidden `nationality` carrying the ISO code, or empty for no
 * answer (§322, optional — the clear button is how an answer is taken back, and the empty box
 * says "Nu spun"). The server's schema, the draft a refusal brings back (§142) and the error
 * summary's link to `id` all read what they read before.
 *
 * **Nothing lost against the select it replaces**: MUI's `Select` needed JavaScript to open as
 * well, so a reader without it could not choose a country before either; the hidden input posts
 * the prefilled answer (or none) exactly as the select's own hidden input did.
 *
 * The countries, their order and their names are the server's (§324), handed down as data.
 */
export default function NationalityField({
  id,
  name,
  label,
  noneLabel,
  error,
  helperText,
  defaultValue,
  countries,
  words,
}: {
  id: string;
  name: string;
  label: string;
  /** What the empty box says: "Nu spun". */
  noneLabel: string;
  error?: boolean;
  helperText?: string;
  /** The code a refused submission posted (§142), or nothing. */
  defaultValue?: string;
  countries: readonly SearchableCountry[];
  words: CountrySearchWords;
}) {
  const [value, setValue] = useState<SearchableCountry | null>(
    () => countries.find((country) => country.code === defaultValue) ?? null,
  );

  return (
    <>
      <Autocomplete
        id={id}
        autoHighlight
        options={countries as SearchableCountry[]}
        value={value}
        onChange={(_event, next) => setValue(next)}
        filterOptions={(options, state) => searchCountries(options, state.inputValue)}
        getOptionLabel={(country) => country.label}
        isOptionEqualToValue={(option, chosen) => option.code === chosen.code}
        noOptionsText={words.noMatch}
        openText={words.open}
        closeText={words.close}
        clearText={words.clear}
        renderOption={(props, country) => {
          const { key, ...rest } = props;
          return (
            // 44 pixels a row: a thumb picks one out of a list (BR-REQ-041-01 criterion 6).
            <Box component="li" key={key} {...rest} sx={{ minHeight: 44 }}>
              <CountryOptionRow country={country} />
            </Box>
          );
        }}
        slotProps={{ listbox: { sx: { maxHeight: "min(50vh, 20rem)" } } }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            placeholder={noneLabel}
            error={error}
            helperText={helperText}
            slotProps={{
              ...params.slotProps,
              // Shrunk always, so "Nu spun" is read as the answer it is rather than hidden
              // under the label, as the select's empty option was (§322).
              inputLabel: { ...params.slotProps.inputLabel, shrink: true },
              input: {
                ...params.slotProps.input,
                startAdornment: value ? (
                  <Box component="span" sx={{ display: "inline-flex", alignItems: "center", pl: 0.5 }}>
                    <Flag code={value.code} width={20} />
                  </Box>
                ) : null,
              },
              htmlInput: {
                ...params.slotProps.htmlInput,
                // Not an address field: the browser's own suggestions would cover the list.
                autoComplete: "off",
              },
            }}
          />
        )}
      />
      <input type="hidden" name={name} value={value?.code ?? ""} />
    </>
  );
}
