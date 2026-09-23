"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { shiftProgrammeDates } from "@/modules/events/domain/schedule";

export type ScheduleRowValue = { date: string; time: string; endTime: string; ro: string; en: string; place: string };

const EMPTY: ScheduleRowValue = { date: "", time: "", endTime: "", ro: "", en: "", place: "" };

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
 * itself, add a row and remove one; every box is an ordinary uncontrolled input named
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
export default function ScheduleRowsEditor({
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
    if (!input) return;
    lastStart.current = input.value;
    const onChange = () => {
      const next = input.value;
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
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
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
            <Stack direction="row" spacing={1}>
              <TextField
                name={name("date")}
                type="date"
                label={labels.date}
                value={value.date}
                onChange={(event) => setDate(key, event.target.value)}
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ width: 150 }}
              />
              <TextField
                name={name("time")}
                label={labels.time}
                defaultValue={value.time}
                placeholder="HH:MM"
                size="small"
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: "numeric", pattern: "([01][0-9]|2[0-3]):[0-5][0-9]", maxLength: 5 } }}
                sx={{ width: 90 }}
              />
              <TextField
                name={name("endTime")}
                label={labels.endTime}
                defaultValue={value.endTime}
                placeholder="HH:MM"
                size="small"
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: "numeric", pattern: "([01][0-9]|2[0-3]):[0-5][0-9]", maxLength: 5 } }}
                sx={{ width: 90 }}
              />
            </Stack>
            <TextField name={name("ro")} label={labels.ro} defaultValue={value.ro} size="small" fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
            <TextField name={name("en")} label={labels.en} defaultValue={value.en} size="small" fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
            <TextField name={name("place")} label={labels.place} defaultValue={value.place} size="small" fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
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
