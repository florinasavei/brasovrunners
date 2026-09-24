"use client";

import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteIcon from "@mui/icons-material/Delete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { type ComponentProps, useState } from "react";
import { DEFAULT_EVENT_LINK_KIND, EVENT_LINK_KINDS, type EventLinkKind, MAX_EVENT_LINKS } from "@/modules/events/domain/links";
import { LINK_GLYPH } from "@/modules/events/ui/link-glyphs";
import type { HtmlConstraints } from "@/shared/forms/constraints";
import { useRecall } from "@/shared/forms/recall";

export type LinkRowValue = { kind: string; url: string; labelRo: string; labelEn: string };

const EMPTY: LinkRowValue = { kind: DEFAULT_EVENT_LINK_KIND, url: "", labelRo: "", labelEn: "" };

/** The rows as a refused submit posted them, gathered by index from `event.links[i].<box>` (§315). */
function recalledRows(names: string[], value: (name: string) => string | undefined): LinkRowValue[] {
  const rows: LinkRowValue[] = [];
  for (const name of names) {
    const match = /^event\.links\[(\d+)\]\.(kind|url|labelRo|labelEn)$/.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    rows[index] = { ...(rows[index] ?? EMPTY), [match[2]]: value(name) ?? "" };
  }
  return rows.filter((row) => row !== undefined);
}

/**
 * The links' rows, coming back as they were typed after a refused submit (§315): keyed on the
 * answer and handed the recalled rows, exactly as `CoHostRowsEditor` and `ScheduleRowsEditor`.
 */
export default function LinkRowsEditor(props: ComponentProps<typeof LinkRowsEditorIsland>) {
  const recall = useRecall();
  const initial = recall.has ? recalledRows(recall.names(), recall.value) : props.initial;
  return <LinkRowsEditorIsland key={recall.generation} {...props} initial={initial} />;
}

/**
 * "Linkuri și fișiere" in the editor (`DECISIONS.md` §332): per row, what it is (with its glyph,
 * the same the public page shows), the address, and a label in each language side by side. A
 * client island for the three things a form cannot do by itself — add a row, remove one, move
 * one up or down — and nothing else: every box is an ordinary input named
 * `event.links[i].<box>`, which `admin/actions.ts#eventFieldsFrom` gathers by index. The index
 * is the row's place on the screen at the moment of the press, so "link 2" in a refusal is the
 * second row the organizer sees. A row with nothing typed is the spare line and is dropped on
 * save.
 *
 * Rows keep a key of their own across removals and moves, so moving the third link up carries
 * its typed boxes with it rather than handing them to the row that took its place.
 *
 * The hidden `event.links.present` says the form carried the list at all: with every row
 * removed nothing else is posted, and "no rows" must read as "no links", not as "not editing".
 */
function LinkRowsEditorIsland({
  initial,
  labels,
  kindLabels,
  constraints,
}: {
  initial: LinkRowValue[];
  labels: { kind: string; url: string; labelRo: string; labelEn: string; add: string; remove: string; moveUp: string; moveDown: string; row: string };
  /** Each kind's word, already translated — the same word the page shows when a label is empty. */
  kindLabels: Record<EventLinkKind, string>;
  /** The boxes' HTML constraints, read off `fields.ts#eventLinkRowSchema` by the Server Component (§315). */
  constraints: { url: HtmlConstraints; label: HtmlConstraints };
}) {
  // Which boxes a refusal named, so each marks itself; the summary links here by `fieldId`.
  const recall = useRecall();
  const [rows, setRows] = useState<Array<{ key: number; value: LinkRowValue }>>(() =>
    (initial.length > 0 ? initial : [EMPTY]).map((value, index) => ({ key: index, value })),
  );
  const [nextKey, setNextKey] = useState(rows.length);

  const add = () => {
    setRows((current) => [...current, { key: nextKey, value: EMPTY }]);
    setNextKey((key) => key + 1);
  };
  const remove = (key: number) => setRows((current) => current.filter((row) => row.key !== key));
  const move = (from: number, by: -1 | 1) =>
    setRows((current) => {
      const to = from + by;
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });

  const withGlyph = (kind: string) => {
    const known = (EVENT_LINK_KINDS as readonly string[]).includes(kind) ? (kind as EventLinkKind) : DEFAULT_EVENT_LINK_KIND;
    const Icon = LINK_GLYPH[known];
    return (
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
        <Icon aria-hidden="true" sx={{ fontSize: 18, color: "text.secondary" }} />
        {kindLabels[known]}
      </Box>
    );
  };

  // A 44-pixel square for every control a thumb has to hit (BR-REQ-041-01 criterion 6).
  const square = { minHeight: 44, minWidth: 44 } as const;

  return (
    <Stack spacing={1.5} id={recall.idOf("event.links")} tabIndex={-1} sx={{ outline: "none" }}>
      <input type="hidden" name="event.links.present" value="1" />
      {rows.map(({ key, value }, index) => {
        const name = (box: keyof LinkRowValue) => `event.links[${index}].${box}`;
        const n = index + 1;
        return (
          <Stack
            key={key}
            spacing={1}
            role="group"
            aria-label={`${labels.row} ${n}`}
            sx={{ p: 1.5, border: 1, borderColor: recall.named(name("url")) || recall.named(name("kind")) ? "error.main" : "divider", borderRadius: 1 }}
          >
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                select
                name={name("kind")}
                id={recall.idOf(name("kind"))}
                error={recall.named(name("kind"))}
                label={labels.kind}
                defaultValue={value.kind || DEFAULT_EVENT_LINK_KIND}
                size="small"
                sx={{ width: { xs: "100%", sm: 220 }, flexShrink: 0 }}
                slotProps={{ select: { renderValue: (chosen) => withGlyph(String(chosen)) }, inputLabel: { shrink: true } }}
              >
                {EVENT_LINK_KINDS.map((kind) => (
                  <MenuItem key={kind} value={kind} sx={{ minHeight: 44 }}>
                    {withGlyph(kind)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                name={name("url")}
                id={recall.idOf(name("url"))}
                error={recall.named(name("url"))}
                label={labels.url}
                defaultValue={value.url}
                type="url"
                inputMode="url"
                size="small"
                fullWidth
                slotProps={{ htmlInput: { ...constraints.url } }}
              />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                name={name("labelRo")}
                id={recall.idOf(name("labelRo"))}
                error={recall.named(name("labelRo"))}
                label={labels.labelRo}
                defaultValue={value.labelRo}
                size="small"
                fullWidth
                slotProps={{ htmlInput: { ...constraints.label } }}
              />
              <TextField
                name={name("labelEn")}
                id={recall.idOf(name("labelEn"))}
                error={recall.named(name("labelEn"))}
                label={labels.labelEn}
                defaultValue={value.labelEn}
                size="small"
                fullWidth
                slotProps={{ htmlInput: { ...constraints.label } }}
              />
            </Stack>
            <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end" }}>
              <IconButton aria-label={`${labels.moveUp} ${n}`} onClick={() => move(index, -1)} disabled={index === 0} sx={square}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton aria-label={`${labels.moveDown} ${n}`} onClick={() => move(index, 1)} disabled={index === rows.length - 1} sx={square}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
              <IconButton aria-label={`${labels.remove} ${n}`} onClick={() => remove(key)} sx={square}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>
        );
      })}
      {/* The list's own ceiling (§332): the button stops at twelve rather than letting a
          thirteenth row be typed and then refused. */}
      <Button
        type="button"
        variant="text"
        size="small"
        startIcon={<AddIcon />}
        onClick={add}
        disabled={rows.length >= MAX_EVENT_LINKS}
        sx={{ alignSelf: "flex-start", textTransform: "none", minHeight: 44 }}
      >
        {labels.add}
      </Button>
    </Stack>
  );
}
