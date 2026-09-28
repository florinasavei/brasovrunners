"use client";

import Autocomplete, { autocompleteClasses } from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import type { PopperProps } from "@mui/material/Popper";
import TextField from "@mui/material/TextField";
import useMediaQuery from "@mui/material/useMediaQuery";
import { type ReactNode, useMemo, useState } from "react";
import Flag from "@/shared/ui/Flag";
import { OPTION_GLYPH_SX, OPTION_LABEL_SX } from "@/shared/ui/select-option";
import { type SearchableCountry, searchCountries } from "../country-search";

/**
 * The one searchable country picker (§463) both country fields open: the telephone prefix
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
 *
 * `position: static` is the fix of §544. MUI styles its popper slot — ours included, since the
 * slot is rendered `as` this div inside MUI's own styled popper — with `position: absolute` when
 * `disablePortal` is set. Out of the flow, the list gave the popover's paper no height: the
 * paper (MUI's `overflow: auto`) was as tall as the search box alone and clipped the list under
 * it to about a row and a half with a scrollbar — the owner's «pop-up-ul cu cetățenia e
 * minuscul!». Back in the flow, the paper is as tall as the search box and the list together.
 */
export function InlineList(props: PopperProps) {
  return (
    <div className={props.className} style={INLINE_LIST_STYLE}>
      {props.children as ReactNode}
    </div>
  );
}

/** In the flow and, in the sheet, the flexible middle that hands the list its height. */
export const INLINE_LIST_STYLE = {
  position: "static",
  display: "flex",
  flexDirection: "column",
  flex: "1 1 auto",
  minHeight: 0,
} as const;

/** 44 pixels a row: a thumb picks a country out of a list of them (BR-REQ-041-01 criterion 6). */
export const PICKER_ROW_PX = 44;

/** Never fewer rows than this in view on a desktop (§544). */
export const PICKER_MIN_ROWS = 8;

/** The listbox's own padding, top plus bottom (MUI's `8px 0`). */
const LISTBOX_PADDING_PX = 16;

/**
 * Where the picker is a bottom sheet rather than a popover under the field: below `sm` (a phone
 * held upright) and on a screen too short for eight rows under a search box (a phone on its
 * side), where a popover would scroll its own search box away.
 */
export const SHEET_MEDIA_QUERY = "(max-width:599.95px), (max-height:519.95px)";

/** A bottom sheet's height: most of the screen, the page still showing above it. */
const SHEET_HEIGHT = "85vh";

/**
 * The popover's paper. On a desktop, under the field and as wide as a country name needs; as a
 * sheet, the screen's width at its bottom, the search box pinned at the top and the list taking
 * the rest (the flex column hands the listbox its height, so the list is the one that scrolls).
 */
export function pickerPaperSx(sheet: boolean) {
  if (!sheet) return { width: "min(22rem, calc(100vw - 32px))" } as const;
  return {
    top: "auto",
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    maxWidth: "100%",
    height: SHEET_HEIGHT,
    maxHeight: SHEET_HEIGHT,
    "@supports (height: 1dvh)": { height: "85dvh", maxHeight: "85dvh" },
    borderRadius: "16px 16px 0 0",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  } as const;
}

/**
 * The list itself. Every row 44 pixels (MUI's own rule — 48 on a phone, `auto` from `sm` — sits
 * on `.MuiAutocomplete-listbox .MuiAutocomplete-option`, which an `sx` on the row cannot beat,
 * so the height is set from the listbox). On a desktop, at least eight rows in view and 40 % of
 * the screen when that is more; in the sheet, whatever the sheet leaves under the search box.
 */
export function pickerListboxSx(sheet: boolean) {
  const rows = { [`& .${autocompleteClasses.option}`]: { minHeight: PICKER_ROW_PX } };
  if (sheet) return { ...rows, flex: "1 1 auto", minHeight: 0, maxHeight: "none" } as const;
  return { ...rows, maxHeight: `max(40vh, ${PICKER_MIN_ROWS * PICKER_ROW_PX + LISTBOX_PADDING_PX}px)` } as const;
}

/** The Autocomplete's own paper inside ours: flat, and in the sheet the list's flexible parent. */
function innerPaperSx(sheet: boolean) {
  return sheet ? ({ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" } as const) : undefined;
}

/**
 * Puts the chosen country in the middle of the list as it opens — "România" is the 180th row.
 * MUI scrolls a highlighted row just into view; the middle shows its neighbours too. Only the
 * list scrolls, never the page.
 */
export function centerChosenOption(root: ParentNode | null) {
  const listbox = root?.querySelector<HTMLElement>('[role="listbox"]');
  const chosen = listbox?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
  if (!listbox || !chosen) return;
  listbox.scrollTop = Math.max(0, chosen.offsetTop - (listbox.clientHeight - chosen.offsetHeight) / 2);
}

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
 * A popover under the field — on a phone a sheet at the bottom of the screen (§544) — the search
 * box focused, the list under it filtering as letters (or, for a telephone, digits) are typed,
 * the chosen country in view. Choosing a country hands its code back; Escape or a tap outside
 * leaves the country as it was.
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
  // The picker mounts on a tap, never on the server, so the first render already knows the screen.
  const sheet = useMediaQuery(SHEET_MEDIA_QUERY, { noSsr: true });
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      // As a sheet the paper is placed by its own `bottom: 0`, not under the field.
      anchorReference={sheet ? "none" : "anchorEl"}
      onClose={onDismiss}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={sheet ? { vertical: "bottom", horizontal: "center" } : { vertical: "top", horizontal: "left" }}
      // The field puts focus where it belongs once the popover is gone.
      disableRestoreFocus
      slotProps={{
        paper: { sx: pickerPaperSx(sheet) },
        transition: {
          onEntering: (node: HTMLElement) => centerChosenOption(node),
          // A fresh search each time it opens.
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
        // The search box's own block: pinned at the top, only the list under it scrolls.
        sx={{ flex: "0 0 auto" }}
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
            >
              <CountryOptionRow country={country} />
            </Box>
          );
        }}
        slots={{ popper: InlineList }}
        slotProps={{
          paper: { elevation: 0, square: true, sx: innerPaperSx(sheet) },
          listbox: { sx: pickerListboxSx(sheet) },
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
