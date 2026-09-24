"use client";

import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteIcon from "@mui/icons-material/Delete";
import Alert from "@mui/material/Alert";
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
import { identicalInBothLanguages } from "@/shared/forms/both-languages";
import type { HtmlConstraints } from "@/shared/forms/constraints";
import { useRecall } from "@/shared/forms/recall";

export type CoHostLinkRowValue = { kind: string; url: string; labelRo: string; labelEn: string };
export type CoHostRowValue = { name: string; descriptionRo: string; descriptionEn: string; links: CoHostLinkRowValue[] };

const EMPTY_LINK: CoHostLinkRowValue = { kind: DEFAULT_CO_HOST_LINK_KIND, url: "", labelRo: "", labelEn: "" };
const EMPTY: CoHostRowValue = { name: "", descriptionRo: "", descriptionEn: "", links: [] };

/**
 * The cards as a refused submit posted them, gathered by both indices from
 * `event.coHosts[p].name`, `event.coHosts[p].descriptionRo` / `.descriptionEn` (§352) and
 * `event.coHosts[p].links[l].<box>` (§315) — the same reading `recalledRows` gives the plain
 * links, one level deeper for the partner a link belongs to.
 */
function recalledRows(names: string[], value: (name: string) => string | undefined): CoHostRowValue[] {
  const rows: CoHostRowValue[] = [];
  for (const name of names) {
    const cardMatch = /^event\.coHosts\[(\d+)\]\.(name|descriptionRo|descriptionEn)$/.exec(name);
    if (cardMatch) {
      const p = Number(cardMatch[1]);
      const box = cardMatch[2] as "name" | "descriptionRo" | "descriptionEn";
      rows[p] = { ...(rows[p] ?? EMPTY), [box]: value(name) ?? "" };
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
      rows[p] = { ...partner, links };
    }
  }
  return rows
    .filter((row): row is CoHostRowValue => row !== undefined)
    .map((row) => ({ ...row, links: row.links.filter((link): link is CoHostLinkRowValue => link !== undefined) }));
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
type PartnerRow = {
  key: number;
  name: string;
  title: string;
  descriptionRo: string;
  descriptionEn: string;
  links: LinkRow[];
  nextLinkKey: number;
};

function makePartnerRow(value: CoHostRowValue, key: number): PartnerRow {
  const links = value.links.length > 0 ? value.links : [EMPTY_LINK];
  return {
    key,
    name: value.name,
    title: value.name,
    descriptionRo: value.descriptionRo,
    descriptionEn: value.descriptionEn,
    links: links.map((link, index) => ({ key: index, value: link })),
    nextLinkKey: links.length,
  };
}

/**
 * The organizations the event is held with, in the editor (`DECISIONS.md` §168; the owner,
 * §344: "this can have multiple links, so it should be a card, it's like: partner link, partner
 * event, etc"): one boxed card per partner, titled with its name — "Partener nou" while it has
 * none — holding the name box, "Despre parteneriat" in Română and English side by side (§352, both
 * or neither), and the partner's own links, each a row with its kind, address and a label in each
 * language, the same four boxes `LinkRowsEditor` carries for "Linkuri și fișiere" (§332).
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
    /** "Despre parteneriat" (§352): the heading over the two description boxes. */
    about: string;
    /** The two boxes' own labels: each language in its own words, "Română" and "English". */
    descriptionRo: string;
    descriptionEn: string;
    /** One line under both: optional, in both languages, a sentence or two, shown under the name. */
    descriptionHelp: string;
    /**
     * The amber line under the two boxes when they say the same words (§NNN, bilingual
     * everywhere): "Textul în engleză e identic cu cel în română — e tradus?". Never a refusal.
     */
    identical: string;
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
  /**
   * The boxes' HTML constraints, read off `fields.ts#coHostLinkRowSchema` (the link's address and
   * label) and `fields.ts#coHostRowSchema` (the description's ceiling) by the Server Component (§315).
   */
  constraints: { url: HtmlConstraints; label: HtmlConstraints; description: HtmlConstraints };
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
  // What the two description boxes hold now, read from their own `onChange` like the title: the
  // boxes stay uncontrolled, and only the "identical in both languages" line below follows them.
  const describePartner = (key: number, language: "Ro" | "En", text: string) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [`description${language}`]: text } : row)));

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
      {rows.map(({ key, name, title, descriptionRo, descriptionEn, links }, index) => {
        const n = index + 1;
        const nameField = `event.coHosts[${index}].name`;
        const descriptionField = (language: "Ro" | "En") => `event.coHosts[${index}].description${language}`;
        // Keyed on the card, not its position, so a moved card keeps its heading's and help's ids.
        const aboutId = `co-host-${key}-about`;
        const aboutHelpId = `co-host-${key}-about-help`;
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

              {/*
                What the partnership is (§352), right under the name — the order the page reads it
                in. Two boxes, one per language, side by side from `sm`: both or neither, so they
                are always seen together, never behind a tab. Ordinary uncontrolled inputs like the
                name, so moving a card carries what was typed in them.
              */}
              <Stack spacing={1} role="group" aria-labelledby={aboutId} aria-describedby={aboutHelpId}>
                <Typography id={aboutId} variant="body2" sx={{ fontWeight: 600 }}>
                  {labels.about}
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  {(
                    [
                      ["Ro", labels.descriptionRo, descriptionRo],
                      ["En", labels.descriptionEn, descriptionEn],
                    ] as const
                  ).map(([language, label, initialValue]) => {
                    const field = descriptionField(language);
                    return (
                      <TextField
                        key={language}
                        name={field}
                        id={recall.idOf(field)}
                        error={recall.named(field)}
                        label={label}
                        defaultValue={initialValue}
                        onChange={(event) => describePartner(key, language, event.target.value)}
                        multiline
                        minRows={2}
                        maxRows={5}
                        fullWidth
                        slotProps={{ htmlInput: { ...constraints.description, "aria-describedby": aboutHelpId } }}
                      />
                    );
                  })}
                </Stack>
                <Typography id={aboutHelpId} variant="caption" color="text.secondary">
                  {labels.descriptionHelp}
                </Typography>
                {/* The Romanian pasted into the English box (§NNN): said here, never refused. */}
                {identicalInBothLanguages(descriptionRo, descriptionEn) && (
                  <Alert severity="warning" data-testid={`co-host-${index}-identical`}>
                    {labels.identical}
                  </Alert>
                )}
              </Stack>

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
                        borderColor: (["url", "kind", "labelRo", "labelEn"] as const).some((field) => recall.named(box(field))) ? "error.main" : "divider",
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
