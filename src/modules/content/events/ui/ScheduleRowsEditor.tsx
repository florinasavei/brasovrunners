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
 * The programme's rows, coming back as they were typed after a refused submit (§315): the
 * island below holds the rows in state of its own, so it is keyed on the answer and handed the
 * recalled rows as its starting point. With nothing recalled this is the island as it was.
 */
export default function ScheduleRowsEditor(props: ComponentProps<typeof ScheduleRowsEditorIsland>) {
  const recall = useRecall();
  const initial = recall.has ? recalledRows(recall.names(), recall.value) : props.initial;
  return <ScheduleRowsEditorIsland key={recall.generation} {...props} initial={initial} />;
}

/**
 * The form's start-date box, by name. The rows and the start date share nothing but the form:
 * the start is a Server Component's field (`WallTimeField`), so the island reaches it the way
 * `OnlyForType` reaches the type select — through the DOM, scoped to the form the rows are in,
 * with the document as the fallback for a rows editor rendered outside one.
 */
function findStartDateInput(root: HTMLElement | null, name: string): HTMLInputElement | null {
  const named = root?.closest("form")?.elements.namedItem(name);
  if (named instanceof HTMLInputElement) return named;
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
}

/**
 * One row's layout (§405; the owner, 2026-09-25, of this card: "super ugly and inconsistent").
 * One CSS grid per row, laid out by the width the **list** has, not the window's: from `md` up
 * the editor's side column is pinned beside the boxes (§350), so the list is narrower on a
 * 900-pixel window than on a 700-pixel one, and a viewport breakpoint would squeeze "Unde" to
 * nothing exactly there. Three widths:
 *
 * - **Wide** (`WIDE`): Data · Ora · Până la · Unde · the bin on the first line; «Ce (română)» ·
 *   «Ce (engleză)» side by side on the second — §362's pair, the way "Linkuri și fișiere"
 *   (`LinkRowsEditor`) puts a row's two labels under its address.
 * - **Medium** (`MEDIUM`): Data · Ora · Până la · the bin; "Unde" on a line of its own; the pair.
 * - **Narrow** (a phone): every box stacked in the same order, the bin under them, at the end.
 *
 * The gaps are the density scale's (§380): the phone's step on a phone, the sibling lists' own
 * step (a `Stack` `spacing={1}` in `LinkRowsEditor` and `CoHostRowsEditor`) from `sm`.
 */
// Measured on a production build: at 36rem "Unde" was left some 115 pixels beside the times on a
// 700-pixel window; from 40rem it has 150 or more.
const WIDE = "@container programme-rows (min-width: 40rem)";
// The four MEDIUM columns need at least 9.5rem + 6.5rem + 6.5rem + 44px + three 8px gaps =
// 428px of inner width; the row's own padding and border (12px × 2 + 2px on `sm`) take 26px off
// the container, so the threshold has to clear 428 + 26 = 454px. 29rem (464px) is the first
// round number past it (§405, the review that found 26rem overflowing from ~416 to ~454px).
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
    // The date needs its calendar button (44 pixels) beside `30.09.2027`; the two times need
    // `10:00` and the browser's own clock beside it.
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

/** A 44-pixel square for the bin (BR-REQ-041-01 criterion 6), at the end of the row on a phone, beside the times from `MEDIUM`. */
const REMOVE_SX = { gridArea: "remove", minHeight: 44, minWidth: 44, justifySelf: "end", [MEDIUM]: { justifySelf: "center" } } as const;

/**
 * The programme's rows in the editor (`DECISIONS.md` §117): when, where, and what in both
 * languages — one card each, in order. A client island for the two things a form cannot do by
 * itself, add a row and remove one; every box posts under a name of its own,
 * `event.schedule[i].<box>`, which `admin/actions.ts#eventFieldsFrom` gathers by index. A row
 * with nothing typed — a date alone is the default below, not something typed — is the spare
 * line and is dropped on save; a half-filled one is refused with its number, so the organizer is
 * told which line, not just that one is wrong.
 *
 * Rows keep a key of their own across removals, so removing the second line does not hand
 * the third line's boxes the second line's values.
 *
 * **The default day is the event's** (§405): the spare line opens on the event's start date
 * (`startDate`, written by the server in the event's zone), a new row on whatever the start box
 * holds now, and the rows follow the start date: when "Începutul evenimentului" —
 * `startDateName`, a sibling input of the same form — moves from one day to another, every row
 * with a date moves by the same number of days and a row with none yet takes the new start
 * (`followStartDate`, the pure part). The date box is the one controlled input for that reason;
 * the rest stay uncontrolled. The form still posts whatever is in the boxes.
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
  // Which boxes a refusal named, so each marks itself; the summary links here by `fieldId`.
  const recall = useRecall();
  const [rows, setRows] = useState<Array<{ key: number; value: ScheduleRowValue }>>(() =>
    (initial.length > 0 ? initial : [{ ...EMPTY, date: startDate }]).map((value, index) => ({ key: index, value })),
  );
  const [nextKey, setNextKey] = useState(rows.length);
  // The last complete start date the form held, so a change is measured from it. A date box
  // reads "" while a segment is being retyped; that is waited out, never measured, so clearing
  // the day and typing a new one is one move, not a loss of every row's date.
  const lastStart = useRef("");

  useEffect(() => {
    const input = findStartDateInput(root.current, startDateName);
    if (input) lastStart.current = input.value;
    // Listen on the form, not the element `findStartDateInput` returns right now (§345): on a
    // full page load the picker replaces the scriptless box during hydration, after this effect
    // has already run (`useIslandRunning`'s `useSyncExternalStore` forces that re-render from
    // its own passive effect, which lands after this one), so a listener on the element it
    // returned here would be attached to a node about to be unmounted and would never hear the
    // picker's own change again. The form (document as the fallback for a rows editor rendered
    // outside one) outlives the swap, so one delegated listener, filtered to the start-date box
    // by name, survives both that swap and any later remount.
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
            // A box a refusal named marks its row too, as a link row does (`LinkRowsEditor`).
            sx={{ ...ROW_SX, borderColor: BOXES.some((box) => recall.named(name(box))) ? "error.main" : "divider" }}
          >
            {/* Controlled, unlike the rest of the row: this is the one box the start-date
                effect above moves by hand, and a stale posted value under this row's *current*
                index (after an earlier row was removed) must never win over that move
                (`DateField`'s `value` prop skips its own refusal lookup for exactly this). No
                clear button on any of the three: the row's own bin empties it in one press, and
                a clear button beside a calendar button, both held to 44 pixels, crowds the
                digits in a box this narrow. */}
            <DateField
              name={name("date")}
              label={labels.date}
              value={value.date}
              onValueChange={(posted) => setDate(key, posted)}
              size="small"
              clearable={false}
              sx={{ gridArea: "date", minWidth: 0 }}
            />
            {/* The platform's own `<input type="time">`, like the start time (`WallTimeField`),
                posting `HH:mm` in either language of the backoffice (§345, amended). */}
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
              <TextField name={name("en")} id={recall.idOf(name("en"))} error={recall.named(name("en"))} label={labels.en} defaultValue={value.en} size="small" fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
            </Box>
            {/* Last in the document, so the keyboard reaches it after every box of the row, wherever
                the grid draws it. */}
            <IconButton aria-label={`${labels.remove} ${n}`} onClick={() => remove(key)} sx={REMOVE_SX}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      })}
      {/* The same add button as every other list card of the editor (`LinkRowsEditor`, `CoHostRowsEditor`). */}
      <Button type="button" variant="text" size="small" startIcon={<AddIcon />} onClick={add} sx={{ alignSelf: "flex-start", textTransform: "none", minHeight: 44 }}>
        {labels.add}
      </Button>
    </Stack>
  );
}
