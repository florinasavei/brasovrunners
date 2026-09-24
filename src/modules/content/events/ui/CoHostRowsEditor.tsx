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
import Typography from "@mui/material/Typography";
import { type ComponentProps, useState } from "react";
import {
  CO_HOST_LINK_KINDS,
  type CoHostLinkKind,
  DEFAULT_CO_HOST_LINK_KIND,
  isCoHostLinkKind,
  MAX_CO_HOST_LINKS,
  MAX_CO_HOSTS,
} from "@/modules/events/domain/co-hosts";
import CoHostLinkGlyph from "@/modules/events/ui/co-host-glyphs";
import type { HtmlConstraints } from "@/shared/forms/constraints";
import { useRecall } from "@/shared/forms/recall";

export type CoHostLinkRowValue = { kind: string; url: string; labelRo: string; labelEn: string };
export type CoHostRowValue = { name: string; links: CoHostLinkRowValue[] };

const EMPTY_LINK: CoHostLinkRowValue = { kind: DEFAULT_CO_HOST_LINK_KIND, url: "", labelRo: "", labelEn: "" };
const EMPTY: CoHostRowValue = { name: "", links: [] };

/**
 * The cards as a refused submit posted them, gathered by both indices from
 * `event.coHosts[p].name` and `event.coHosts[p].links[l].<box>` (§315) — the same reading
 * `recalledRows` gives the plain links, one level deeper for the partner a link belongs to.
 */
function recalledRows(names: string[], value: (name: string) => string | undefined): CoHostRowValue[] {
  const rows: CoHostRowValue[] = [];
  for (const name of names) {
    const nameMatch = /^event\.coHosts\[(\d+)\]\.name$/.exec(name);
    if (nameMatch) {
      const p = Number(nameMatch[1]);
      rows[p] = { name: value(name) ?? "", links: rows[p]?.links ?? [] };
      continue;
    }
    const linkMatch = /^event\.coHosts\[(\d+)\]\.links\[(\d+)\]\.(kind|url|labelRo|labelEn)$/.exec(name);
    if (linkMatch) {
      const p = Number(linkMatch[1]);
      const l = Number(linkMatch[2]);
      const box = linkMatch[3] as keyof CoHostLinkRowValue;
      const partner = rows[p] ?? EMPTY;
      const links = [...partner.links];
      links[l] = { ...(links[l] ?? EMPTY_LINK), [box]: value(name) ?? "" };
      rows[p] = { name: partner.name, links };
    }
  }
  return rows
    .filter((row): row is CoHostRowValue => row !== undefined)
    .map((row) => ({ name: row.name, links: row.links.filter((link): link is CoHostLinkRowValue => link !== undefined) }));
}

/**
 * The partners' cards, coming back as they were typed after a refused submit (§315): keyed on
 * the answer and handed the recalled cards, exactly as `LinkRowsEditor` and `ScheduleRowsEditor`.
 */
export default function CoHostRowsEditor(props: ComponentProps<typeof CoHostRowsEditorIsland>) {
  const recall = useRecall();
  const initial = recall.has ? recalledRows(recall.names(), recall.value) : props.initial;
  return <CoHostRowsEditorIsland key={recall.generation} {...props} initial={initial} />;
}

type LinkRow = { key: number; value: CoHostLinkRowValue };
type PartnerRow = { key: number; name: string; title: string; links: LinkRow[]; nextLinkKey: number };

function makePartnerRow(value: CoHostRowValue, key: number): PartnerRow {
  const links = value.links.length > 0 ? value.links : [EMPTY_LINK];
  return { key, name: value.name, title: value.name, links: links.map((link, index) => ({ key: index, value: link })), nextLinkKey: links.length };
}

/**
 * The organizations the event is held with, in the editor (`DECISIONS.md` §168; the owner,
 * §344: "this can have multiple links, so it should be a card, it's like: partner link, partner
 * event, etc"): one boxed card per partner, titled with its name — "Partener nou" while it has
 * none — holding the name box and the partner's own links, each a row with its kind, address and
 * a label in each language, the same four boxes `LinkRowsEditor` carries for "Linkuri și
 * fișiere" (§332).
 *
 * A client island for what a form cannot do by itself — add or remove a card, move one, and the
 * same three for a card's own links — and nothing else: every box is an ordinary uncontrolled
 * input named `event.coHosts[p].name` or `event.coHosts[p].links[l].<box>`, which
 * `admin/actions.ts#eventFieldsFrom` gathers by both indices. A card and a link left blank are
 * the spare lines and are dropped on save; a link with no name beside its card, or a link with
 * no address, is refused with both numbers (`fields.ts#coHostsField`).
 *
 * Cards and links each keep a key of their own across removals and moves, so moving the third
 * partner up carries its own links with it rather than handing them to the partner that took its
 * place — the same discipline `LinkRowsEditor` follows for one list, doubled for two nested ones.
 * The title is read from the name box's own `onChange` (`BibFooterTextField`'s pattern): the box
 * stays an ordinary uncontrolled input, and only the small heading above it is live.
 */
function CoHostRowsEditorIsland({
  initial,
  labels,
  kindLabels,
  constraints,
}: {
  initial: CoHostRowValue[];
  labels: {
    add: string;
    remove: string;
    moveUp: string;
    moveDown: string;
    partnerNew: string;
    name: string;
    kind: string;
    url: string;
    labelRo: string;
    labelEn: string;
    addLink: string;
    removeLink: string;
    moveLinkUp: string;
    moveLinkDown: string;
    link: string;
    /**
     * "al partenerului {p}" — said after every link row's name and its buttons, with `{p}`
     * replaced by the card's number (§347, batch integration). "Linkuri și fișiere" (§332) sits
     * on the same form with its own "Linkul 1" and "Șterge linkul 1"; without the partner in the
     * name, a screen reader heard two identical groups and two identical buttons.
     */
    ofPartner: string;
  };
  /** Each link kind's word, already translated — the same word the page shows when a label is empty. */
  kindLabels: Record<CoHostLinkKind, string>;
  /** The link boxes' HTML constraints, read off `fields.ts#coHostLinkRowSchema` by the Server Component (§315). */
  constraints: { url: HtmlConstraints; label: HtmlConstraints };
}) {
  // Which boxes a refusal named, so each marks itself; the summary links here by `fieldId`.
  const recall = useRecall();
  const [rows, setRows] = useState<PartnerRow[]>(() => (initial.length > 0 ? initial : [EMPTY]).map((value, index) => makePartnerRow(value, index)));
  const [nextKey, setNextKey] = useState(rows.length);

  const addPartner = () => {
    setRows((current) => [...current, makePartnerRow(EMPTY, nextKey)]);
    setNextKey((key) => key + 1);
  };
  const removePartner = (key: number) => setRows((current) => current.filter((row) => row.key !== key));
  const movePartner = (from: number, by: -1 | 1) =>
    setRows((current) => {
      const to = from + by;
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  const renamePartner = (key: number, title: string) => setRows((current) => current.map((row) => (row.key === key ? { ...row, title } : row)));

  const addLink = (partnerKey: number) =>
    setRows((current) =>
      current.map((row) =>
        row.key === partnerKey
          ? { ...row, links: [...row.links, { key: row.nextLinkKey, value: EMPTY_LINK }], nextLinkKey: row.nextLinkKey + 1 }
          : row,
      ),
    );
  const removeLink = (partnerKey: number, linkKey: number) =>
    setRows((current) => current.map((row) => (row.key === partnerKey ? { ...row, links: row.links.filter((link) => link.key !== linkKey) } : row)));
  const moveLink = (partnerKey: number, from: number, by: -1 | 1) =>
    setRows((current) =>
      current.map((row) => {
        if (row.key !== partnerKey) return row;
        const to = from + by;
        if (to < 0 || to >= row.links.length) return row;
        const links = [...row.links];
        [links[from], links[to]] = [links[to], links[from]];
        return { ...row, links };
      }),
    );

  const withGlyph = (kind: string) => {
    const known = isCoHostLinkKind(kind) ? kind : DEFAULT_CO_HOST_LINK_KIND;
    return (
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
        <CoHostLinkGlyph kind={known} size={18} />
        {kindLabels[known]}
      </Box>
    );
  };

  // A 44-pixel square for every control a thumb has to hit (BR-REQ-041-01 criterion 6).
  const square = { minHeight: 44, minWidth: 44 } as const;

  return (
    <Stack spacing={2} id={recall.idOf("event.coHosts")} tabIndex={-1} sx={{ outline: "none" }}>
      {rows.map(({ key, name, title, links }, index) => {
        const n = index + 1;
        const nameField = `event.coHosts[${index}].name`;
        return (
          <Box key={key} sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 1 }}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                  {title.trim() ? title : labels.partnerNew}
                </Typography>
                <IconButton aria-label={`${labels.moveUp} ${n}`} onClick={() => movePartner(index, -1)} disabled={index === 0} sx={square}>
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
                <IconButton aria-label={`${labels.moveDown} ${n}`} onClick={() => movePartner(index, 1)} disabled={index === rows.length - 1} sx={square}>
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
                <IconButton aria-label={`${labels.remove} ${n}`} onClick={() => removePartner(key)} sx={square}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>

              <TextField
                name={nameField}
                id={recall.idOf(nameField)}
                error={recall.named(nameField)}
                label={labels.name}
                defaultValue={name}
                onChange={(event) => renamePartner(key, event.target.value)}
                slotProps={{ htmlInput: { maxLength: 200 } }}
                fullWidth
              />

              <Stack spacing={1} id={recall.idOf(`event.coHosts[${index}].links`)} tabIndex={-1} sx={{ outline: "none" }}>
                {links.map(({ key: linkKey, value }, linkIndex) => {
                  const box = (field: keyof CoHostLinkRowValue) => `event.coHosts[${index}].links[${linkIndex}].${field}`;
                  // "1 al partenerului 2": the link's number and whose it is, in every name below.
                  const ln = `${linkIndex + 1} ${labels.ofPartner.replace("{p}", String(n))}`;
                  return (
                    <Stack
                      key={linkKey}
                      spacing={1}
                      role="group"
                      aria-label={`${labels.link} ${ln}`}
                      sx={{
                        p: 1.5,
                        border: 1,
                        borderColor: recall.named(box("url")) || recall.named(box("kind")) ? "error.main" : "divider",
                        borderRadius: 1,
                      }}
                    >
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                          select
                          name={box("kind")}
                          id={recall.idOf(box("kind"))}
                          error={recall.named(box("kind"))}
                          label={labels.kind}
                          defaultValue={value.kind || DEFAULT_CO_HOST_LINK_KIND}
                          size="small"
                          sx={{ width: { xs: "100%", sm: 220 }, flexShrink: 0 }}
                          slotProps={{ select: { renderValue: (chosen) => withGlyph(String(chosen)) }, inputLabel: { shrink: true } }}
                        >
                          {CO_HOST_LINK_KINDS.map((kind) => (
                            <MenuItem key={kind} value={kind} sx={{ minHeight: 44 }}>
                              {withGlyph(kind)}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          name={box("url")}
                          id={recall.idOf(box("url"))}
                          error={recall.named(box("url"))}
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
                          name={box("labelRo")}
                          id={recall.idOf(box("labelRo"))}
                          error={recall.named(box("labelRo"))}
                          label={labels.labelRo}
                          defaultValue={value.labelRo}
                          size="small"
                          fullWidth
                          slotProps={{ htmlInput: { ...constraints.label } }}
                        />
                        <TextField
                          name={box("labelEn")}
                          id={recall.idOf(box("labelEn"))}
                          error={recall.named(box("labelEn"))}
                          label={labels.labelEn}
                          defaultValue={value.labelEn}
                          size="small"
                          fullWidth
                          slotProps={{ htmlInput: { ...constraints.label } }}
                        />
                      </Stack>
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end" }}>
                        <IconButton
                          aria-label={`${labels.moveLinkUp} ${ln}`}
                          onClick={() => moveLink(key, linkIndex, -1)}
                          disabled={linkIndex === 0}
                          sx={square}
                        >
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          aria-label={`${labels.moveLinkDown} ${ln}`}
                          onClick={() => moveLink(key, linkIndex, 1)}
                          disabled={linkIndex === links.length - 1}
                          sx={square}
                        >
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton aria-label={`${labels.removeLink} ${ln}`} onClick={() => removeLink(key, linkKey)} sx={square}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>
                  );
                })}
                <Button
                  type="button"
                  variant="text"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => addLink(key)}
                  disabled={links.length >= MAX_CO_HOST_LINKS}
                  sx={{ alignSelf: "flex-start", textTransform: "none", minHeight: 44 }}
                >
                  {labels.addLink}
                </Button>
              </Stack>
            </Stack>
          </Box>
        );
      })}
      <Button
        type="button"
        variant="text"
        size="small"
        startIcon={<AddIcon />}
        onClick={addPartner}
        disabled={rows.length >= MAX_CO_HOSTS}
        sx={{ alignSelf: "flex-start", textTransform: "none", minHeight: 44 }}
      >
        {labels.add}
      </Button>
    </Stack>
  );
}
