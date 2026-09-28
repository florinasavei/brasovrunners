"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { followStartDate } from "@/modules/events/domain/schedule";
import DateField from "@/shared/forms/pickers/DateField";
import TimeField from "@/shared/forms/pickers/TimeField";
import { useRecall } from "@/shared/forms/recall";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
import { DENSITY } from "@/theme/density";

export type ScheduleRowValue = { date: string; time: string; endTime: string; ro: string; en: string; place: string };

const EMPTY: ScheduleRowValue = { date: "", time: "", endTime: "", ro: "", en: "", place: "" };
const BOXES = ["date", "time", "endTime", "ro", "en", "place"] as const;

/** The rows as a refused submit posted them, gathered by index from `event.schedule[i].<box>` (§315). */
function recalledRows(names: string[], value: (name: string) => string | undefined): ScheduleRowValue[] {
  const rows: ScheduleRowValue[] = [];
  for (const name of names) {
    const match = /^event\.schedule\[(\d+)\]\.(date|time|endTime|ro|en|place)$/.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    rows[index] = { ...(rows[index] ?? EMPTY), [match[2]]: value(name) ?? "" };
  }
  return rows.filter((row) => row !== undefined);
}

/**
 * Recalls the typed rows after a refused submit (§315): the island holds rows in state, so it is
 * keyed on the answer and seeded with the recalled rows.
 */
export default function ScheduleRowsEditor(props: ComponentProps<typeof ScheduleRowsEditorIsland>) {
  const recall = useRecall();
  const initial = recall.has ? recalledRows(recall.names(), recall.value) : props.initial;
  return <ScheduleRowsEditorIsland key={recall.generation} {...props} initial={initial} />;
}

/**
 * The form's start-date box by name, reached through the DOM (as `OnlyForType` reaches the type
 * select), scoped to the rows' form with the document as fallback.
 */
function findStartDateInput(root: HTMLElement | null, name: string): HTMLInputElement | null {
  const named = root?.closest("form")?.elements.namedItem(name);
  if (named instanceof HTMLInputElement) return named;
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
}

/**
 * One row's grid (§405), laid out by the list's own width (a container query), not the window's:
 * from `md` the pinned side column makes the list narrower on a wider window. Wide: Data · Ora ·
 * Până la · Unde · bin, then the two «Ce» boxes side by side (§362). Medium: «Unde» on its own
 * line. Narrow: everything stacked, the bin last. Gaps follow the density scale (§380).
 */
// Measured on a production build: at 36rem "Unde" got ~115 px on a 700-px window; from 40rem, 150+.
const WIDE = "@container programme-rows (min-width: 40rem)";
// The four MEDIUM columns need 9.5rem + 6.5rem + 6.5rem + 44px + 3 × 8px = 428px, plus the row's
// 26px of padding and border: 454px. 29rem (464px) is the first round number past it (§405).
const MEDIUM = "@container programme-rows (min-width: 29rem)";

const ROW_SX = {
  display: "grid",
  gap: { xs: DENSITY.gapSm, sm: 1 },
  alignItems: "start",
  p: { xs: DENSITY.gapSm, sm: 1.5 },
  border: 1,
  borderRadius: 1,
  gridTemplateColumns: "minmax(0, 1fr)",
  gridTemplateAreas: `"date" "time" "end" "place" "what" "remove"`,
  [MEDIUM]: {
    // The date needs its 44-px calendar button beside `30.09.2027`.
    gridTemplateColumns: "minmax(9.5rem, 1.4fr) minmax(6.5rem, 1fr) minmax(6.5rem, 1fr) 44px",
    gridTemplateAreas: `"date time end remove" "place place place place" "what what what what"`,
  },
  [WIDE]: {
    gridTemplateColumns: "minmax(9.5rem, 10rem) minmax(6.5rem, 7.5rem) minmax(6.5rem, 7.5rem) minmax(0, 1fr) 44px",
    gridTemplateAreas: `"date time end place remove" "what what what what what"`,
  },
} as const;

/** «Ce (română)» · «Ce (engleză)»: side by side once there is room for two (§362), stacked on a phone. */
const WHAT_SX = {
  gridArea: "what",
  display: "grid",
  gap: { xs: DENSITY.gapSm, sm: 1 },
  gridTemplateColumns: "minmax(0, 1fr)",
  [MEDIUM]: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
} as const;

/** A 44-px square for the bin (BR-REQ-041-01 criterion 6): row end on a phone, beside the times from `MEDIUM`. */
const REMOVE_SX = { gridArea: "remove", minHeight: 44, minWidth: 44, justifySelf: "end", [MEDIUM]: { justifySelf: "center" } } as const;

/**
 * The programme's rows (§117): when, where, and what in both languages. Client only to add and
 * remove rows; each box posts `event.schedule[i].<box>`, gathered by index
 * (`admin/actions.ts#eventFieldsFrom`). An untyped row (a default date alone does not count) is
 * dropped; a half-filled one is refused with its number. Rows keep their own key across removals.
 * New rows open on the event's start date (§405), and when the start date moves every dated row
 * moves by the same number of days (`followStartDate`); the date box is therefore the one
 * controlled input.
 */
function ScheduleRowsEditorIsland({
  initial,
  labels,
  startDateName,
  startDate,
}: {
  initial: ScheduleRowValue[];
  labels: { date: string; time: string; endTime: string; ro: string; en: string; place: string; add: string; remove: string; empty: string; row: string };
  /** The `name` of the event's start-date box in the same form. */
  startDateName: string;
  /** The event's start date as the start box shows it (`YYYY-MM-DD`), or "" on the create page. */
  startDate: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  // Which boxes a refusal named; the summary links here by `fieldId`.
  const recall = useRecall();
  const [rows, setRows] = useState<Array<{ key: number; value: ScheduleRowValue }>>(() =>
    (initial.length > 0 ? initial : [{ ...EMPTY, date: startDate }]).map((value, index) => ({ key: index, value })),
  );
  const [nextKey, setNextKey] = useState(rows.length);
  // The last complete start date, so a change is measured from it. A date box reads "" while a
  // segment is retyped; that is waited out, so retyping the day does not wipe every row's date.
  const lastStart = useRef("");

  useEffect(() => {
    const input = findStartDateInput(root.current, startDateName);
    if (input) lastStart.current = input.value;
    // Listen on the form, not the element found now (§345): on a full load the picker replaces the
    // scriptless box during hydration, after this effect ran, so an element listener would sit on
    // a node about to unmount. One delegated listener, filtered by name, survives the swap.
    const scope: Document | HTMLFormElement = root.current?.closest("form") ?? document;
    const onChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.name !== startDateName) return;
      const next = target.value;
      if (!next || next === lastStart.current) return;
      const previous = lastStart.current;
      lastStart.current = next;
      setRows((current) => {
        const moved = followStartDate(
          current.map((row) => row.value),
          previous,
          next,
        );
        return current.map((row, index) => ({ key: row.key, value: moved[index] }));
      });
    };
    scope.addEventListener("change", onChange);
    return () => scope.removeEventListener("change", onChange);
  }, [startDateName]);

  const add = () => {
    const date = findStartDateInput(root.current, startDateName)?.value || lastStart.current || startDate;
    setRows((current) => [...current, { key: nextKey, value: { ...EMPTY, date } }]);
    setNextKey((key) => key + 1);
  };
  const remove = (key: number) => setRows((current) => current.filter((row) => row.key !== key));
  const setDate = (key: number, date: string) =>
    setRows((current) => current.map((row) => (row.key === key ? { key, value: { ...row.value, date } } : row)));

  return (
    <Stack ref={root} spacing={{ xs: DENSITY.gapSm, sm: 1.5 }} sx={{ containerType: "inline-size", containerName: "programme-rows" }}>
      {rows.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {labels.empty}
        </Typography>
      )}
      {rows.map(({ key, value }, index) => {
        const name = (box: keyof ScheduleRowValue) => `event.schedule[${index}].${box}`;
        const n = index + 1;
        return (
          <Box
            key={key}
            role="group"
            aria-label={`${labels.row} ${n}`}
            // A box a refusal named marks its row too (as `LinkRowsEditor`).
            sx={{ ...ROW_SX, borderColor: BOXES.some((box) => recall.named(name(box))) ? "error.main" : "divider" }}
          >
            {/* Controlled: the start-date effect moves it, and a stale posted value under this row's
                current index must never win (`DateField`'s `value` skips its refusal lookup). No
                clear buttons in the row: the bin empties it, and they crowd a narrow box. */}
            <DateField
              name={name("date")}
              label={labels.date}
              value={value.date}
              onValueChange={(posted) => setDate(key, posted)}
              size="small"
              clearable={false}
              sx={{ gridArea: "date", minWidth: 0 }}
            />
            {/* The typed 24-hour time box, as the start time (§400, §439). */}
            <TimeField name={name("time")} label={labels.time} defaultValue={value.time} size="small" clearable={false} sx={{ gridArea: "time", minWidth: 0 }} />
            <TimeField name={name("endTime")} label={labels.endTime} defaultValue={value.endTime} size="small" clearable={false} sx={{ gridArea: "end", minWidth: 0 }} />
            <TextField
              name={name("place")}
              id={recall.idOf(name("place"))}
              error={recall.named(name("place"))}
              label={labels.place}
              defaultValue={value.place}
              size="small"
              sx={{ gridArea: "place", minWidth: 0 }}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <Box sx={WHAT_SX}>
              <TextField name={name("ro")} id={recall.idOf(name("ro"))} error={recall.named(name("ro"))} label={labels.ro} defaultValue={value.ro} size="small" fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
              {/* «Tradu din română» (§464) in the English box's own cell, so it sits under English. */}
              <Box sx={{ minWidth: 0 }}>
                <TextField name={name("en")} id={recall.idOf(name("en"))} error={recall.named(name("en"))} label={labels.en} defaultValue={value.en} size="small" fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
                <TranslateFieldButton en={name("en")} />
              </Box>
            </Box>
            {/* Last in the document, so the keyboard reaches it after every box of the row. */}
            <IconButton aria-label={`${labels.remove} ${n}`} onClick={() => remove(key)} sx={REMOVE_SX}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      })}
      {/* The same add button as the editor's other list cards. */}
      <Button type="button" variant="text" size="small" startIcon={<AddIcon />} onClick={add} sx={{ alignSelf: "flex-start", textTransform: "none", minHeight: 44 }}>
        {labels.add}
      </Button>
    </Stack>
  );
}
