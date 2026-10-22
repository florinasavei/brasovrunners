"use client";

import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type ComponentProps, type FormEvent, useState } from "react";
import { DEFAULT_EVENT_LINK_KIND, EVENT_LINK_KINDS, type EventLinkKind, MAX_EVENT_LINKS } from "@/modules/events/domain/links";
import { LINK_GLYPH } from "@/modules/events/ui/link-glyphs";
import type { HtmlConstraints } from "@/shared/forms/constraints";
import TipSpan from "@/shared/ui/TipSpan";
import { useRecall } from "@/shared/forms/recall";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import GlyphButton from "@/shared/ui/GlyphButton";
import { FACTS_SX, PENCIL_SX, ROW_SX, SUMMARY_SX } from "@/shared/ui/row-fold";
import StatusChip from "@/shared/ui/StatusChip";
import { ROUTE_GPX_INPUT_ID } from "./RouteGpxField";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";

export type LinkRowValue = { kind: string; url: string; labelRo: string; labelEn: string };

const EMPTY: LinkRowValue = { kind: DEFAULT_EVENT_LINK_KIND, url: "", labelRo: "", labelEn: "" };
const BOXES = ["url", "kind", "labelRo", "labelEn"] as const;

/** The pencil at the end of a link's line: the edit verb's glyph, by name (§318). */
const PencilIcon = ACTION_ICONS.edit;

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

/** The address's host, as a line names it — «drive.google.com», never the whole address — or "" while it is not one yet. */
function hostOf(url: string): string {
  try {
    return new URL(url.trim()).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
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
 * **Each link is the house's row fold** (§842, `shared/ui/row-fold.ts`): the line is the link in
 * words — its kind's glyph, its label in the editor's language (the kind's word when it has none,
 * as the page says it) and the address's host, «etichetă într-o singură limbă» when the label is
 * half written — with the pencil at the end, and a press on it opens the row's boxes in place,
 * the arrows and «Șterge linkul» last. A saved link's line starts closed; a row added in this
 * sitting («Adaugă un link», and the spare line of an empty list) starts open, reading «Link nou»
 * until something is typed. The line follows the typing (the boxes stay uncontrolled: only what
 * the line says is kept here, by the row's key). Every box is still in the event's one form, open
 * or shut: a closed fold posts its boxes like an open one, and a box the browser refuses inside
 * one (the address's https pattern) is opened by `ActionForm`'s `onInvalidCapture` before the
 * browser looks for it; a box a refusal named opens its row by itself.
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
  locale,
}: {
  initial: LinkRowValue[];
  labels: {
    kind: string;
    url: string;
    labelRo: string;
    labelEn: string;
    add: string;
    remove: string;
    moveUp: string;
    moveDown: string;
    row: string;
    uploadGpx: string;
    /** «Link nou»: the line of a row with nothing typed yet. */
    new: string;
    /** «Modifică linkul»: the line's tooltip, what a press on it does. */
    edit: string;
    /** «etichetă într-o singură limbă» (§354): the line's warning chip, the box's own words. */
    labelOneLanguage: string;
  };
  /** Each kind's word, already translated — the same word the page shows when a label is empty. */
  kindLabels: Record<EventLinkKind, string>;
  /** The boxes' HTML constraints, read off `fields.ts#eventLinkRowSchema` by the Server Component (§315). */
  constraints: { url: HtmlConstraints; label: HtmlConstraints };
  /** The editor's language: which label the line shows first. */
  locale: string;
}) {
  // Which boxes a refusal named, so each marks itself; the summary links here by `fieldId`.
  const recall = useRecall();
  // `fresh`: added in this sitting (or the spare line of an empty list), so its fold opens by itself.
  const [rows, setRows] = useState<Array<{ key: number; value: LinkRowValue; fresh: boolean }>>(() =>
    initial.length > 0 ? initial.map((value, index) => ({ key: index, value, fresh: false })) : [{ key: 0, value: EMPTY, fresh: true }],
  );
  const [nextKey, setNextKey] = useState(rows.length);
  // What each row's boxes hold now, by the row's key, kept only for its line and for whether a «GPX» row offers the
  // upload (§718). The boxes themselves stay uncontrolled and their `defaultValue` stays the row's initial value: a
  // default that followed the typing is what MUI warns about on the select. A key is never reused, so a removed
  // row's entry is inert.
  const [typed, setTyped] = useState<Record<number, Partial<LinkRowValue>>>({});

  const add = () => {
    setRows((current) => [...current, { key: nextKey, value: EMPTY, fresh: true }]);
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
  const note = (key: number, box: keyof LinkRowValue, text: string) => setTyped((current) => ({ ...current, [key]: { ...current[key], [box]: text } }));
  // The address and the two labels, heard from the row's own boxes as they bubble up (`onInput`).
  const hear = (key: number) => (event: FormEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const box = /\.(url|labelRo|labelEn)$/.exec(target.name)?.[1] as keyof LinkRowValue | undefined;
    if (box) note(key, box, target.value);
  };

  const knownKind = (kind: string): EventLinkKind => ((EVENT_LINK_KINDS as readonly string[]).includes(kind) ? (kind as EventLinkKind) : DEFAULT_EVENT_LINK_KIND);
  const withGlyph = (kind: string) => {
    const known = knownKind(kind);
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
      {rows.length > 0 && (
        <Stack spacing={0} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {rows.map(({ key, value, fresh }, index) => {
            const name = (box: keyof LinkRowValue) => `event.links[${index}].${box}`;
            const n = index + 1;
            const now = { ...value, ...typed[key] };
            const kind = now.kind || DEFAULT_EVENT_LINK_KIND;
            const KindGlyph = LINK_GLYPH[knownKind(kind)];
            const label = (locale === "en" ? now.labelEn || now.labelRo : now.labelRo || now.labelEn).trim();
            const host = hostOf(now.url);
            const blank = now.url.trim() === "" && label === "";
            const oneLanguage = (now.labelRo.trim() === "") !== (now.labelEn.trim() === "");
            // A box a refusal named marks its row: the line in the error colour, and the fold open (§336).
            const named = BOXES.some((box) => recall.named(name(box)));
            return (
              <Box component="li" key={key} sx={ROW_SX}>
                <Box component="details" open={fresh || named || undefined} data-testid="link-row">
                  <Box component="summary" title={labels.edit} data-testid="link-row-toggle" sx={SUMMARY_SX}>
                    <Box sx={{ gridArea: "words", minWidth: 0, display: "flex", alignItems: "center", gap: 1, color: named ? "error.main" : undefined }}>
                      <KindGlyph aria-hidden="true" sx={{ fontSize: 18, color: named ? "error.main" : "text.secondary", flexShrink: 0 }} />
                      <Box sx={{ minWidth: 0, wordBreak: "break-word" }}>
                        <Typography component="span" sx={{ fontWeight: 600 }} data-testid="link-row-name">
                          {blank ? labels.new : label || kindLabels[knownKind(kind)]}
                        </Typography>
                        {host && (
                          <Typography component="span" color="text.secondary" data-testid="link-row-host">
                            {" "}
                            · {host}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                    <Box sx={FACTS_SX}>
                      {oneLanguage && <StatusChip glyph="language" variant="outlined" color="warning" label={labels.labelOneLanguage} inline />}
                    </Box>
                    <PencilIcon aria-hidden fontSize="small" sx={PENCIL_SX} />
                  </Box>
                  <Stack spacing={1} role="group" aria-label={`${labels.row} ${n}`} onInput={hear(key)} sx={{ pb: 1.5, pt: 0.5 }}>
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
                        onChange={(event) => note(key, "kind", event.target.value)}
                        slotProps={{ select: { renderValue: (chosen) => withGlyph(String(chosen)) }, inputLabel: { shrink: true } }}
                      >
                        {EVENT_LINK_KINDS.map((option) => (
                          <MenuItem key={option} value={option} sx={{ minHeight: 44 }}>
                            {withGlyph(option)}
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
                    {/* The route's GPX as a file instead of a link (§718): the same upload as the card's, by its input. */}
                    {labels.uploadGpx && kind === "GPX" && (
                      <GlyphButton htmlFor={ROUTE_GPX_INPUT_ID} icon="upload" variant="outlined" sx={{ alignSelf: "flex-start", minHeight: 44 }} data-testid="link-row-upload-gpx">
                        {labels.uploadGpx}
                      </GlyphButton>
                    )}
                    {/* «Tradu din română» (§464): the English label from the Romanian one. */}
                    <TranslateFieldButton en={name("labelEn")} />
                    {/* The row's verbs, last in its fold: the order, then «Șterge linkul». */}
                    <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
                      <TipSpan title={labels.moveUp}>
                        <IconButton aria-label={`${labels.moveUp} ${n}`} onClick={() => move(index, -1)} disabled={index === 0} sx={square}>
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                      </TipSpan>
                      <TipSpan title={labels.moveDown}>
                        <IconButton aria-label={`${labels.moveDown} ${n}`} onClick={() => move(index, 1)} disabled={index === rows.length - 1} sx={square}>
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                      </TipSpan>
                      <GlyphButton
                        icon="delete"
                        type="button"
                        color="error"
                        variant="outlined"
                        size="small"
                        aria-label={`${labels.remove} ${n}`}
                        onClick={() => remove(key)}
                        sx={{ minHeight: 44, textTransform: "none" }}
                      >
                        {labels.remove}
                      </GlyphButton>
                    </Stack>
                  </Stack>
                </Box>
              </Box>
            );
          })}
        </Stack>
      )}
      {/* The list's own ceiling (§332): the button stops at twelve rather than letting a
          thirteenth row be typed and then refused. A press adds an open row, «Link nou». */}
      <GlyphButton
        icon="add"
        type="button"
        variant="text"
        size="small"
        onClick={add}
        disabled={rows.length >= MAX_EVENT_LINKS}
        sx={{ alignSelf: "flex-start", textTransform: "none", minHeight: 44 }}
      >
        {labels.add}
      </GlyphButton>
    </Stack>
  );
}
