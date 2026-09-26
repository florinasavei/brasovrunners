"use client";

import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import type { PopperProps } from "@mui/material/Popper";
import TextField from "@mui/material/TextField";
import { type ReactNode, useState } from "react";
import Flag from "@/shared/ui/Flag";
import { OPTION_GLYPH_SX, OPTION_LABEL_SX } from "@/shared/ui/select-option";
import { type SearchableCountry, searchCountries } from "../country-search";

/**
 * The pieces both searchable country pickers share (§NNN): the words, the row, and the list with
 * a search box that the telephone prefix opens in a popover.
 *
 * The words come from the server as plain strings, like every other label these islands draw —
 * a public page ships no catalogue to the browser (§353).
 */
export type CountrySearchWords = {
  /** The search box's placeholder and accessible name: "Caută țara". */
  search: string;
  /** Said in the list when nothing matches. */
  noMatch: string;
  /** The clear button's accessible name (citizenship only — a prefix is never empty). */
  clear: string;
  /** The open and close buttons' accessible names. */
  open: string;
  close: string;
};

/** One country in a list: flag, name and, for a telephone, its code — "🇷🇴 România +40". */
export function CountryOptionRow({ country }: { country: SearchableCountry }) {
  return (
    <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%", minWidth: 0 }}>
      <Box component="span" sx={OPTION_GLYPH_SX}>
        {/* Lazy: a list of two hundred and fifty flags fetches only the ones scrolled to. */}
        <Flag code={country.code} width={20} loading="lazy" />
      </Box>
      <Box component="span" sx={{ ...OPTION_LABEL_SX, flex: "1 1 auto" }}>
        {country.label}
      </Box>
      {country.dialingCode && (
        <Box component="span" sx={{ flex: "0 0 auto", color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
          +{country.dialingCode}
        </Box>
      )}
    </Box>
  );
}

/**
 * The list drawn in place inside the popover rather than floated over it: the popover is already
 * the floating surface, and a second one anchored to its search box would cover the page.
 *
 * Only `className` and the children travel; the popper's own positioning props (`anchorEl`,
 * `open`, `disablePortal`, a measured `style.width`) mean nothing to a div in the flow.
 */
function InlineList(props: PopperProps) {
  return <div className={props.className}>{props.children as ReactNode}</div>;
}

/** 44 pixels a row: a thumb picks a country out of a list of them (BR-REQ-041-01 criterion 6). */
const OPTION_SX = { minHeight: 44 } as const;

/**
 * The telephone prefix's search (§NNN): a popover under the flag, the search box focused, the
 * list under it filtering as letters or digits are typed. Choosing a country hands its code back
 * and the field moves on to the digits; Escape or a tap outside leaves the country as it was.
 */
export function CountrySearchPopover({
  open,
  anchorEl,
  countries,
  value,
  label,
  words,
  onChoose,
  onDismiss,
  onExited,
}: {
  open: boolean;
  /** The flag's button: the popover opens under it. */
  anchorEl: HTMLElement;
  countries: readonly SearchableCountry[];
  value: string;
  /** The picker's accessible name — the field's own "Țara". */
  label: string;
  words: CountrySearchWords;
  onChoose: (code: string) => void;
  onDismiss: () => void;
  /** After the popover has gone: where focus goes next is the field's business. */
  onExited: () => void;
}) {
  const [query, setQuery] = useState("");
  const selected = countries.find((country) => country.code === value) ?? null;
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onDismiss}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      // The field puts focus where it belongs once the popover is gone: on the digits after a
      // choice, back on the flag after a dismissal.
      disableRestoreFocus
      slotProps={{
        paper: { sx: { width: "min(22rem, calc(100vw - 32px))" } },
        // A fresh search each time it opens.
        transition: {
          onExited: () => {
            setQuery("");
            onExited();
          },
        },
      }}
    >
      <Autocomplete
        open
        disablePortal
        disableClearable
        autoHighlight
        options={countries as SearchableCountry[]}
        // Always a country: a prefix is never empty, and the list holds the one the field shows.
        value={selected ?? countries[0]}
        inputValue={query}
        onInputChange={(_event, next, reason) => {
          if (reason === "input" || reason === "clear") setQuery(next);
        }}
        onChange={(_event, next) => {
          if (next) onChoose(next.code);
        }}
        onClose={(_event, reason) => {
          if (reason === "escape") onDismiss();
        }}
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
            <Box
              component="li"
              key={key}
              {...rest}
              // Autocomplete skips onChange for the country already chosen; a tap on it still
              // closes the popover.
              onClick={(event) => {
                rest.onClick?.(event);
                if (country.code === value) onChoose(country.code);
              }}
              sx={OPTION_SX}
            >
              <CountryOptionRow country={country} />
            </Box>
          );
        }}
        slots={{ popper: InlineList }}
        slotProps={{
          paper: { elevation: 0, square: true },
          listbox: { sx: { maxHeight: "min(50vh, 20rem)" } },
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            // Focused on opening: the search is why the popover exists.
            autoFocus
            placeholder={words.search}
            sx={{ p: 1 }}
            slotProps={{
              ...params.slotProps,
              // Sixteen pixels, or iOS zooms the page into the box as it takes focus.
              htmlInput: { ...params.slotProps.htmlInput, "aria-label": `${label} — ${words.search}`, style: { fontSize: 16 } },
              input: { ...params.slotProps.input, endAdornment: null },
            }}
          />
        )}
      />
    </Popover>
  );
}
