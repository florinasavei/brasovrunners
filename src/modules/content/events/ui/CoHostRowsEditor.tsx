"use client";

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { type ComponentProps, useState } from "react";
import { useRecall } from "@/shared/forms/recall";

export type CoHostRowValue = { name: string; url: string };

const EMPTY: CoHostRowValue = { name: "", url: "" };

/** The partners as a refused submit posted them, gathered by index from `event.coHosts[i].<box>` (§306). */
function recalledRows(names: string[], value: (name: string) => string | undefined): CoHostRowValue[] {
  const rows: CoHostRowValue[] = [];
  for (const name of names) {
    const match = /^event\.coHosts\[(\d+)\]\.(name|url)$/.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    rows[index] = { ...(rows[index] ?? EMPTY), [match[2]]: value(name) ?? "" };
  }
  return rows.filter((row) => row !== undefined);
}

/**
 * The partners' rows, coming back as they were typed after a refused submit (§306): keyed on
 * the answer and handed the recalled rows, exactly as `ScheduleRowsEditor` is.
 */
export default function CoHostRowsEditor(props: ComponentProps<typeof CoHostRowsEditorIsland>) {
  const recall = useRecall();
  const initial = recall.has ? recalledRows(recall.names(), recall.value) : props.initial;
  return <CoHostRowsEditorIsland key={recall.generation} {...props} initial={initial} />;
}

/**
 * The organizations the event is held with, in the editor (`DECISIONS.md` §168): a name and a
 * page per row, in the club's own order. The same island as `ScheduleRowsEditor` and for the
 * same two reasons — a form cannot add a row or remove one by itself — and nothing else: every
 * box is an ordinary uncontrolled input named `event.coHosts[i].<box>`, which
 * `admin/actions.ts#eventFieldsFrom` gathers by index. A row left blank in both boxes is the
 * spare line and is dropped on save; a page with no name beside it is refused with its number.
 *
 * Rows keep a key of their own across removals, so removing the second partner does not hand
 * the third partner's boxes the second one's values.
 */
function CoHostRowsEditorIsland({
  initial,
  labels,
}: {
  initial: CoHostRowValue[];
  labels: { name: string; url: string; add: string; remove: string };
}) {
  // Which boxes a refusal named, so each marks itself; the summary links here by `fieldId`.
  const recall = useRecall();
  const [rows, setRows] = useState<Array<{ key: number; value: CoHostRowValue }>>(() =>
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
      {rows.map(({ key, value }, index) => (
        <Stack key={key} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
          <TextField
            name={`event.coHosts[${index}].name`}
            id={recall.idOf(`event.coHosts[${index}].name`)}
            error={recall.named(`event.coHosts[${index}].name`)}
            label={labels.name}
            defaultValue={value.name}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            sx={{ flex: 1 }}
          />
          <TextField
            name={`event.coHosts[${index}].url`}
            id={recall.idOf(`event.coHosts[${index}].url`)}
            error={recall.named(`event.coHosts[${index}].url`)}
            type="url"
            label={labels.url}
            defaultValue={value.url}
            inputMode="url"
            sx={{ flex: 1 }}
          />
          <IconButton
            aria-label={`${labels.remove} ${index + 1}`}
            onClick={() => remove(key)}
            sx={{ minHeight: 44, minWidth: 44, alignSelf: { xs: "flex-end", sm: "center" } }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
      <Button
        type="button"
        variant="text"
        size="small"
        startIcon={<AddIcon />}
        onClick={add}
        sx={{ alignSelf: "flex-start", textTransform: "none", minHeight: 44 }}
      >
        {labels.add}
      </Button>
    </Stack>
  );
}
