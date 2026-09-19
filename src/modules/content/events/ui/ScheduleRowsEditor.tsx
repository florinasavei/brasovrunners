"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";

export type ScheduleRowValue = { date: string; time: string; endTime: string; ro: string; en: string; place: string };

const EMPTY: ScheduleRowValue = { date: "", time: "", endTime: "", ro: "", en: "", place: "" };

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
 */
export default function ScheduleRowsEditor({
  initial,
  labels,
}: {
  initial: ScheduleRowValue[];
  labels: { date: string; time: string; endTime: string; ro: string; en: string; place: string; add: string; remove: string; empty: string };
}) {
  const [rows, setRows] = useState<Array<{ key: number; value: ScheduleRowValue }>>(() =>
    (initial.length > 0 ? initial : [EMPTY]).map((value, index) => ({ key: index, value })),
  );
  const [nextKey, setNextKey] = useState(rows.length);

  const add = () => {
    setRows((current) => [...current, { key: nextKey, value: EMPTY }]);
    setNextKey((key) => key + 1);
  };
  const remove = (key: number) => setRows((current) => current.filter((row) => row.key !== key));

  return (
    <Stack spacing={1.5}>
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
                defaultValue={value.date}
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
