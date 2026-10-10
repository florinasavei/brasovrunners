"use client";

import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { type ComponentProps, useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import GlyphButton from "@/shared/ui/GlyphButton";
import { DEFAULT_TEAM_LINK_KIND, isTeamLinkKind, MAX_TEAM_LINK_LABEL, MAX_TEAM_LINK_URL, MAX_TEAM_LINKS, TEAM_LINK_KINDS, type TeamLinkKind } from "../links";
import TeamLinkGlyph from "./TeamLinkGlyph";

export type TeamLinkRowValue = { kind: string; url: string; labelRo: string; labelEn: string };

export type TeamLinkRowsLabels = {
  kind: string;
  url: string;
  labelRo: string;
  labelEn: string;
  add: string;
  remove: string;
  moveUp: string;
  moveDown: string;
  row: string;
};

const EMPTY: TeamLinkRowValue = { kind: DEFAULT_TEAM_LINK_KIND, url: "", labelRo: "", labelEn: "" };

/** The rows as a refused submit posted them, gathered by index from `links[i].<box>` (§315). */
function recalledRows(names: string[], value: (name: string) => string | undefined): TeamLinkRowValue[] {
  const rows: TeamLinkRowValue[] = [];
  for (const name of names) {
    const match = /^links\[(\d+)\]\.(kind|url|labelRo|labelEn)$/.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    rows[index] = { ...(rows[index] ?? EMPTY), [match[2]]: value(name) ?? "" };
  }
  return rows.filter((row) => row !== undefined);
}

/** A person's links in «Echipa»'s editor (§474), recalled after a refused submit (§315) as for events (§332). */
export default function TeamLinkRowsEditor(props: ComponentProps<typeof TeamLinkRowsEditorIsland>) {
  const recall = useRecall();
  const initial = recall.has && recall.value("links.present") !== undefined ? recalledRows(recall.names(), recall.value) : props.initial;
  return <TeamLinkRowsEditorIsland key={recall.generation} {...props} initial={initial} />;
}

/**
 * Per row: kind, address, and a label in each language (both or neither, §352). The island only
 * adds, removes and moves rows; every box is a plain input `links[i].<box>`, and the hidden
 * `links.present` makes removing every row save "no links".
 */
function TeamLinkRowsEditorIsland({
  initial,
  labels,
  kindLabels,
}: {
  initial: TeamLinkRowValue[];
  labels: TeamLinkRowsLabels;
  /** Each kind's translated word — what the card shows when a label is empty. */
  kindLabels: Record<TeamLinkKind, string>;
}) {
  const recall = useRecall();
  const [rows, setRows] = useState<Array<{ key: number; value: TeamLinkRowValue }>>(() =>
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
    const known = isTeamLinkKind(kind) ? kind : DEFAULT_TEAM_LINK_KIND;
    return (
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
        <TeamLinkGlyph kind={known} size={18} />
        {kindLabels[known]}
      </Box>
    );
  };

  // 44 px targets (BR-REQ-041-01 criterion 6).
  const square = { minHeight: 44, minWidth: 44, px: 1, "& .MuiButton-startIcon": { m: 0 } } as const;

  return (
    <Stack spacing={1.5} id={recall.idOf("links")} tabIndex={-1} sx={{ outline: "none" }}>
      <input type="hidden" name="links.present" value="1" />
      {rows.map(({ key, value }, index) => {
        const name = (box: keyof TeamLinkRowValue) => `links[${index}].${box}`;
        const n = index + 1;
        return (
          <Stack
            key={key}
            spacing={1}
            role="group"
            aria-label={`${labels.row} ${n}`}
            sx={{
              p: 1.5,
              border: 1,
              borderColor: (["url", "kind", "labelRo", "labelEn"] as const).some((field) => recall.named(name(field))) ? "error.main" : "divider",
              borderRadius: 1,
            }}
          >
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                select
                name={name("kind")}
                id={recall.idOf(name("kind"))}
                error={recall.named(name("kind"))}
                label={labels.kind}
                defaultValue={isTeamLinkKind(value.kind) ? value.kind : DEFAULT_TEAM_LINK_KIND}
                size="small"
                sx={{ width: { xs: "100%", sm: 200 }, flexShrink: 0 }}
                slotProps={{ select: { renderValue: (chosen) => withGlyph(String(chosen)) }, inputLabel: { shrink: true } }}
              >
                {TEAM_LINK_KINDS.map((kind) => (
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
                size="small"
                fullWidth
                slotProps={{ htmlInput: { maxLength: MAX_TEAM_LINK_URL, pattern: "[Hh][Tt][Tt][Pp][Ss]://.*", inputMode: "url" } }}
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
                slotProps={{ htmlInput: { maxLength: MAX_TEAM_LINK_LABEL, lang: "ro" } }}
              />
              <TextField
                name={name("labelEn")}
                id={recall.idOf(name("labelEn"))}
                error={recall.named(name("labelEn"))}
                label={labels.labelEn}
                defaultValue={value.labelEn}
                size="small"
                fullWidth
                slotProps={{ htmlInput: { maxLength: MAX_TEAM_LINK_LABEL, lang: "en" } }}
              />
            </Stack>
            <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end" }}>
              <GlyphButton icon="moveUp" type="button" variant="text" aria-label={`${labels.moveUp} ${n}`} onClick={() => move(index, -1)} disabled={index === 0} sx={square} />
              <GlyphButton icon="moveDown" type="button" variant="text" aria-label={`${labels.moveDown} ${n}`} onClick={() => move(index, 1)} disabled={index === rows.length - 1} sx={square} />
              <GlyphButton icon="delete" type="button" variant="text" aria-label={`${labels.remove} ${n}`} onClick={() => remove(key)} sx={square} />
            </Stack>
          </Stack>
        );
      })}
      {/* Stops at `MAX_TEAM_LINKS` rather than offering a row the save would refuse. */}
      <GlyphButton
        icon="add"
        type="button"
        variant="text"
        size="small"
        onClick={add}
        disabled={rows.length >= MAX_TEAM_LINKS}
        sx={{ alignSelf: "flex-start", textTransform: "none", minHeight: 44 }}
      >
        {labels.add}
      </GlyphButton>
    </Stack>
  );
}
