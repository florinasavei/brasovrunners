"use client";

import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import type { PopperProps } from "@mui/material/Popper";
import TextField from "@mui/material/TextField";
import { type ReactNode, useMemo, useState } from "react";
import Flag from "@/shared/ui/Flag";
import { OPTION_GLYPH_SX, OPTION_LABEL_SX } from "@/shared/ui/select-option";
import { type SearchableCountry, searchCountries } from "../country-search";

/**
 * The one searchable country picker (§NNN) both country fields open: the telephone prefix
 * (`mode="dialling"`, each row with its `+40`, digits searched) and the citizenship
 * (`mode="citizenship"`, names only).
 *
 * Neither field posts through it. Each keeps a native `<select>` that the server draws, the form
 * posts and a reader without JavaScript uses; once the field's island runs, a button lies over
 * that select and opens this popover, and a choice is written back to the select with a real
 * `change` event (`chooseInSelect`). So what is posted, the draft a refusal brings back (§142)
 * and the error summary's link are exactly what they were.
 *
 * The words come from the server as plain strings, like every other label these islands draw —
 * a public page ships no catalogue to the browser (§353).
 */
export type CountrySearchWords = {
  /** The search box's placeholder and accessible name: "Caută țara". */
  search: string;
  /** Said in the list when nothing matches. */
  noMatch: string;
  /** The open and close buttons' accessible names. */
  open: string;
  close: string;
};

export type CountryPickerMode = "dialling" | "citizenship";

/** One country in a list: flag, name and, for a telephone, its code — "🇷🇴 România +40". */
function CountryOptionRow({ country }: { country: SearchableCountry }) {
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
 * Writes a choice into the native select the field posts, and announces it with a bubbling
 * `change` event, so the select's own React `onChange` runs exactly as if its list had been used.
 */
export function chooseInSelect(select: HTMLSelectElement | null, code: string) {
  if (!select || select.value === code) return;
  select.value = code;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * The English name of every country, for the search only: "germany" on the Romanian page finds
 * Germania. Named here, in the browser, once the picker opens — never drawn, so the two runtimes'
 * ICU differences (§324) cannot touch hydration, and the page ships no second list of names.
 */
function withEnglishNames(countries: readonly SearchableCountry[], mode: CountryPickerMode): SearchableCountry[] {
  let english: Intl.DisplayNames | null = null;
  try {
    english = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    english = null;
  }
  return countries.map((country) => ({
    code: country.code,
    label: country.label,
    altLabel: english?.of(country.code) ?? undefined,
    dialingCode: mode === "dialling" ? country.dialingCode : undefined,
  }));
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

/** The overlay button's look: the whole field's box, transparent, one 44-pixel-plus target. */
export const PICKER_BUTTON_SX = {
  position: "absolute",
  inset: 0,
  zIndex: 1,
  width: "100%",
  height: "100%",
  m: 0,
  p: 0,
  border: 0,
  bgcolor: "transparent",
  cursor: "pointer",
} as const;

/**
 * A popover under the field, the search box focused, the list under it filtering as letters (or,
 * for a telephone, digits) are typed. Choosing a country hands its code back; Escape or a tap
 * outside leaves the country as it was.
 */
export function CountryPicker({
  mode,
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
  mode: CountryPickerMode;
  open: boolean;
  /** The field's button: the popover opens under it. */
  anchorEl: HTMLElement;
  countries: readonly SearchableCountry[];
  value: string;
  /** The picker's accessible name — the field's own "Țara" or "Cetățenie". */
  label: string;
  words: CountrySearchWords;
  onChoose: (code: string) => void;
  onDismiss: () => void;
  /** After the popover has gone: where focus goes next is the field's business. */
  onExited: () => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => withEnglishNames(countries, mode), [countries, mode]);
  const selected = options.find((country) => country.code === value) ?? null;
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onDismiss}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      // The field puts focus where it belongs once the popover is gone.
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
        options={options}
        // Always a country: both fields always hold one, and the list holds the one shown.
        value={selected ?? options[0]}
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
        filterOptions={(list, state) => searchCountries(list, state.inputValue)}
        getOptionLabel={(country) => country.label}
        isOptionEqualToValue={(option, chosen) => option.code === chosen.code}
        noOptionsText={words.noMatch}
        openText={words.open}
        closeText={words.close}
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
