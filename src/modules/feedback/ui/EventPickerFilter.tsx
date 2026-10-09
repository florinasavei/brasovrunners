"use client";

import Autocomplete, { autocompleteClasses } from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import {
  filterPickerOptions,
  GENERAL_VALUE,
  PICKER_CHIPS,
  type PickerChip,
  pickerChipsShown,
  pickerNoEventFound,
  type PickerOption,
} from "../domain/event-picker";

/**
 * «Evenimentul», filtered as one types (§680, amending §676) — the island the feedback page mounts
 * around its native `<select name="event">` when the list is longer than eight rows.
 *
 * Until it runs — on the server, while the page hydrates, and for good in a browser without
 * JavaScript — it draws its children: the server's native select, which the form posts. When the
 * chips will be drawn, the same row of chips stands above it already, invisible and out of the
 * accessibility tree, so the field does not jump down by a row as the island takes over on a
 * phone; a browser that says it runs no script (`scripting: none`) gives that row no room. Once it
 * runs it draws, in the select's place, MUI's `Autocomplete` (its own combobox semantics for the
 * keyboard and a screen reader) and a hidden `<input name="event">` carrying the slug chosen, so
 * exactly one `event` is posted and the server reads it as before. Above the box, when both kinds
 * are among the events, three chips narrow the list to one kind.
 *
 * Everything it receives is plain data — the rows, the value chosen, the words (§353, §370) —
 * and it formats nothing: each row's day comes already in the page's date words.
 */
export type EventPickerWords = {
  /** «Evenimentul», the box's label — the native select's own. */
  label: string;
  /** The box's placeholder: what may be typed. */
  search: string;
  /** Said under «Altceva / în general» when no event matches what was typed. */
  noMatch: string;
  /** The open and close buttons' accessible names. */
  open: string;
  close: string;
  /** The chips' group, for a screen reader. */
  kinds: string;
  chips: Readonly<Record<PickerChip, string>>;
};

const NO_MATCH_VALUE = "\u0000no-match";

/** A thumb's row (BR-REQ-041-01 criterion 6). */
const ROW_PX = 44;

const NOTHING_TO_WATCH = () => () => undefined;

export default function EventPickerFilter({
  id,
  name,
  options,
  selected,
  error,
  helperText,
  words,
  children,
}: {
  /** The native select's id (`f-event`): the label, the error summary's link and the e2e find the box by it. */
  id: string;
  /** The field the form posts, `event`. */
  name: string;
  /** «Altceva / în general» first, then the events in `pickerOrder`'s order. */
  options: readonly PickerOption[];
  /** The slug the server preselected — the draft's, `?eveniment=`'s, or `""`. */
  selected: string;
  error: boolean;
  helperText?: string;
  words: EventPickerWords;
  /** The native select, drawn until the island runs. */
  children: ReactNode;
}) {
  // False on the server and while hydrating — the native select — true once the island runs.
  const running = useSyncExternalStore(NOTHING_TO_WATCH, () => true, () => false);
  // What the native select holds as the island takes over: a choice made before hydration is kept.
  const [value, setValue] = useState(() => {
    if (typeof document === "undefined") return selected;
    const native = document.getElementById(id);
    return native instanceof HTMLSelectElement && options.some((option) => option.value === native.value) ? native.value : selected;
  });
  const [chip, setChip] = useState<PickerChip>("all");
  const chipsShown = pickerChipsShown(options);

  // The chips; `reserved`, the same row holding the island's place before it runs — not seen, not read, not pressed.
  const chipRow = (reserved: boolean) => (
    <Box
      role={reserved ? undefined : "group"}
      aria-label={reserved ? undefined : words.kinds}
      aria-hidden={reserved || undefined}
      sx={{
        display: "flex",
        flexWrap: "wrap",
        gap: 1,
        mb: 1.5,
        ...(reserved && { visibility: "hidden", "@media (scripting: none)": { display: "none" } }),
      }}
    >
      {PICKER_CHIPS.map((kind) => (
        <Chip
          key={kind}
          label={words.chips[kind]}
          data-testid={reserved ? undefined : `feedback-event-chip-${kind}`}
          aria-pressed={reserved ? undefined : chip === kind}
          color={chip === kind ? "primary" : "default"}
          variant={chip === kind ? "filled" : "outlined"}
          onClick={reserved ? undefined : () => setChip(kind)}
          sx={{ height: "auto", minHeight: ROW_PX, borderRadius: ROW_PX / 2, px: 0.5 }}
        />
      ))}
    </Box>
  );

  if (!running) {
    return (
      <>
        {chipsShown && chipRow(true)}
        {children}
      </>
    );
  }

  // The events that match — «Altceva» first only while the box is empty or none does (`filterPickerOptions`)
  // — and, when none does, a row that says so and cannot be chosen.
  const filter = (list: PickerOption[], state: { inputValue: string }): PickerOption[] => {
    const shown = filterPickerOptions(list, state.inputValue, chip);
    return pickerNoEventFound(shown) ? [...shown, { value: NO_MATCH_VALUE, label: words.noMatch, kind: "other", day: null, when: null }] : shown;
  };

  const chosen = options.find((option) => option.value === value) ?? options.find((option) => option.value === GENERAL_VALUE) ?? options[0];

  return (
    <Box data-testid="feedback-event-filter">
      {chipsShown && chipRow(false)}
      <Autocomplete
        id={id}
        options={options as PickerOption[]}
        value={chosen}
        onChange={(_event, next) => {
          if (next && next.value !== NO_MATCH_VALUE) setValue(next.value);
        }}
        disableClearable
        autoHighlight
        filterOptions={filter}
        getOptionLabel={(option) => (option.when ? `${option.label} — ${option.when}` : option.label)}
        getOptionKey={(option) => option.value || "general"}
        getOptionDisabled={(option) => option.value === NO_MATCH_VALUE}
        isOptionEqualToValue={(option, current) => option.value === current.value}
        noOptionsText={words.noMatch}
        openText={words.open}
        closeText={words.close}
        renderOption={(props, option) => {
          const { key, ...rest } = props;
          return (
            <Box component="li" key={key} {...rest}>
              {option.value === NO_MATCH_VALUE ? (
                <Box component="span" sx={{ color: "text.secondary", fontStyle: "italic" }} data-testid="feedback-event-no-match">
                  {option.label}
                </Box>
              ) : (
                <Box component="span" sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <Box component="span" data-testid="feedback-event-option-title">
                    {option.label}
                  </Box>
                  {option.when && (
                    <Box component="span" sx={{ color: "text.secondary", typography: "body2" }}>
                      {option.when}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          );
        }}
        slotProps={{
          // Below the box, always: a phone's keyboard takes the bottom, and a list flipped above the box would leave it.
          popper: { placement: "bottom-start", modifiers: [{ name: "flip", enabled: false }] },
          listbox: { sx: { [`& .${autocompleteClasses.option}`]: { minHeight: ROW_PX } } },
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={words.label}
            placeholder={words.search}
            error={error}
            helperText={helperText}
            fullWidth
            slotProps={{
              ...params.slotProps,
              inputLabel: { ...params.slotProps.inputLabel, shrink: true },
              // Sixteen pixels, or iOS zooms the page into the box as it takes focus.
              htmlInput: { ...params.slotProps.htmlInput, style: { fontSize: 16 } },
            }}
          />
        )}
      />
      <input type="hidden" name={name} value={chosen.value} />
    </Box>
  );
}
