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
import { shiftProgrammeDates } from "@/modules/events/domain/schedule";
import DateField from "@/shared/forms/pickers/DateField";
import TimeField from "@/shared/forms/pickers/TimeField";
import { useRecall } from "@/shared/forms/recall";

export type ScheduleRowValue = { date: string; time: string; endTime: string; ro: string; en: string; place: string };

const EMPTY: ScheduleRowValue = { date: "", time: "", endTime: "", ro: "", en: "", place: "" };

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
 * The programme's rows in the editor (`DECISIONS.md` §117): when, what in both languages,
 * where — one line each, in order. A client island for the two things a form cannot do by
 * itself, add a row and remove one; every box posts under a name of its own,
 * `event.schedule[i].<box>`, which `admin/actions.ts#eventFieldsFrom` gathers by index. A row
 * left blank is the spare line and is dropped on save; a half-filled one is refused with its
 * number, so the organizer is told which line, not just that one is wrong.
 *
 * Rows keep a key of their own across removals, so removing the second line does not hand
 * the third line's boxes the second line's values.
 *
 * The rows follow the event's date: the programme is usually on the day of the event, so
 * when "Începutul evenimentului" — `startDateName`, a sibling input of the same form — moves
 * from one day to another, every row that has a date moves by the same number of days
 * (`shiftProgrammeDates`, the pure part), and a new row opens on the event's day. The date
 * box is the one controlled input for that reason; the rest stay uncontrolled. The form still
 * posts whatever is in the boxes — nothing below the form changed.
 */
function ScheduleRowsEditorIsland({
  initial,
  labels,
  startDateName,
}: {
  initial: ScheduleRowValue[];
  labels: { date: string; time: string; endTime: string; ro: string; en: string; place: string; add: string; remove: string; empty: string };
  /** The `name` of the event's start-date box in the same form. */
  startDateName: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  // Which boxes a refusal named, so each marks itself; the summary links here by `fieldId`.
  const recall = useRecall();
  const [rows, setRows] = useState<Array<{ key: number; value: ScheduleRowValue }>>(() =>
    (initial.length > 0 ? initial : [EMPTY]).map((value, index) => ({ key: index, value })),
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
      if (!previous) return;
      setRows((current) => {
        const shifted = shiftProgrammeDates(
          current.map((row) => row.value),
          previous,
          next,
        );
        return current.map((row, index) => ({ key: row.key, value: shifted[index] }));
      });
    };
    scope.addEventListener("change", onChange);
    return () => scope.removeEventListener("change", onChange);
  }, [startDateName]);

  const add = () => {
    const date = findStartDateInput(root.current, startDateName)?.value || lastStart.current;
    setRows((current) => [...current, { key: nextKey, value: { ...EMPTY, date } }]);
    setNextKey((key) => key + 1);
  };
  const remove = (key: number) => setRows((current) => current.filter((row) => row.key !== key));
  const setDate = (key: number, date: string) =>
    setRows((current) => current.map((row) => (row.key === key ? { key, value: { ...row.value, date } } : row)));

  return (
    <Stack ref={root} spacing={1.5}>
      {rows.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {labels.empty}
        </Typography>
      )}
      {rows.map(({ key, value }, index) => {
        const name = (box: keyof ScheduleRowValue) => `event.schedule[${index}].${box}`;
        return (
          <Stack
            key={key}
            direction={{ xs: "column", md: "row" }}
            spacing={1}
            sx={{ alignItems: { md: "flex-start" }, p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}
          >
            {/* Wraps on a phone: the three boxes' own widths (150 + 140 + 140, each holding a
                44-pixel button) add up to more than a phone's content width, and a `Stack`
                does not wrap by itself. None of the three has a clear button — the row's own
                remove button empties it in one press, and a clear button beside a calendar or
                clock button, both held to 44 pixels (BR-REQ-041-01 criterion 6), collided with
                the digits in a box this narrow. */}
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {/* Controlled, unlike the rest of the row: this is the one box the start-date
                  effect above moves by hand, and a stale posted value under this row's *current*
                  index (after an earlier row was removed) must never win over that move
                  (`DateField`'s `value` prop skips its own refusal lookup for exactly this). */}
              <DateField
                name={name("date")}
                label={labels.date}
                value={value.date}
                onValueChange={(posted) => setDate(key, posted)}
                size="small"
                clearable={false}
                sx={{ width: 150 }}
              />
              {/* Picked, not typed, like the start time (`WallTimeField`): MUI's own 24-hour
                  clock, posting `HH:mm` in either language of the backoffice. */}
              <TimeField name={name("time")} label={labels.time} defaultValue={value.time} size="small" clearable={false} sx={{ width: 140 }} />
              <TimeField name={name("endTime")} label={labels.endTime} defaultValue={value.endTime} size="small" clearable={false} sx={{ width: 140 }} />
            </Box>
            <TextField name={name("ro")} id={recall.idOf(name("ro"))} error={recall.named(name("ro"))} label={labels.ro} defaultValue={value.ro} size="small" fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
            <TextField name={name("en")} id={recall.idOf(name("en"))} error={recall.named(name("en"))} label={labels.en} defaultValue={value.en} size="small" fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
            <TextField name={name("place")} id={recall.idOf(name("place"))} error={recall.named(name("place"))} label={labels.place} defaultValue={value.place} size="small" fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
            <IconButton aria-label={`${labels.remove} ${index + 1}`} onClick={() => remove(key)} sx={{ minHeight: 44, minWidth: 44, alignSelf: { xs: "flex-end", md: "center" } }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        );
      })}
      <Button type="button" variant="text" size="small" startIcon={<AddIcon />} onClick={add} sx={{ alignSelf: "flex-start", textTransform: "none", minHeight: 44 }}>
        {labels.add}
      </Button>
    </Stack>
  );
}
