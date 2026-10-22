"use client";

import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type ComponentProps, type FormEvent, useEffect, useRef, useState } from "react";
import { followStartDate } from "@/modules/events/domain/schedule";
import DateField from "@/shared/forms/pickers/DateField";
import TimeField from "@/shared/forms/pickers/TimeField";
import { useRecall } from "@/shared/forms/recall";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import GlyphButton from "@/shared/ui/GlyphButton";
import { FACTS_SX, PENCIL_SX, ROW_SX, SUMMARY_SX } from "@/shared/ui/row-fold";
import { DENSITY } from "@/theme/density";

export type ScheduleRowValue = { date: string; time: string; endTime: string; ro: string; en: string; place: string };

const EMPTY: ScheduleRowValue = { date: "", time: "", endTime: "", ro: "", en: "", place: "" };
const BOXES = ["date", "time", "endTime", "ro", "en", "place"] as const;

/** The pencil at the end of a row's line: the edit verb's glyph, by name (§318). */
const PencilIcon = ACTION_ICONS.edit;

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

/** A row's day as the line says it, day first like the date box itself (`30.09.2027`), in either language. */
function dayOf(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

/**
 * One row's layout inside its fold (§405; the owner, 2026-09-25, of this card: "super ugly and
 * inconsistent"). One CSS grid per row, laid out by the width the **list** has, not the window's:
 * from `md` up the editor's side column is pinned beside the boxes (§350), so the list is narrower
 * on a 900-pixel window than on a 700-pixel one, and a viewport breakpoint would squeeze "Unde" to
 * nothing exactly there. Three widths:
 *
 * - **Wide** (`WIDE`): Data · Ora · Până la · Unde · the bin on the first line; «Ce (română)» ·
 *   «Ce (engleză)» side by side on the second — §362's pair, the way "Linkuri și fișiere"
 *   (`LinkRowsEditor`) puts a row's two labels under its address.
 * - **Medium** (`MEDIUM`): Data · Ora · Până la · the bin; "Unde" on a line of its own; the pair.
 * - **Narrow** (a phone): every box stacked in the same order, the bin under them, at the end.
 *
 * The gaps are the density scale's (§380): the phone's step on a phone, the sibling lists' own
 * step (a `Stack` `spacing={1}` in `LinkRowsEditor` and `CoHostRowsEditor`) from `sm`. The row
 * draws no box of its own since it is a row fold (§842): the hairline between rows is the fold's.
 */
// Measured on a production build: at 36rem "Unde" was left some 115 pixels beside the times on a
// 700-pixel window; from 40rem it has 150 or more.
const WIDE = "@container programme-rows (min-width: 40rem)";
// The four MEDIUM columns need at least 9.5rem + 6.5rem + 6.5rem + 44px + three 8px gaps =
// 428px of inner width. The row's own padding and border (26px) once had to come off the
// container too, so the threshold cleared 428 + 26 = 454px; the row fold has neither, and 29rem
// (464px) only leaves more room than it needs (§405, the review that found 26rem overflowing).
const MEDIUM = "@container programme-rows (min-width: 29rem)";

const GRID_SX = {
  display: "grid",
  gap: { xs: DENSITY.gapSm, sm: 1 },
  alignItems: "start",
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

/**
 * The bin: the house's square for a verb with no words (`TeamLinkRowsEditor`), 44 pixels
 * (BR-REQ-041-01 criterion 6), at the end of the row on a phone, beside the times from `MEDIUM`.
 */
const REMOVE_SX = {
  gridArea: "remove",
  minHeight: 44,
  minWidth: 44,
  px: 1,
  "& .MuiButton-startIcon": { m: 0 },
  justifySelf: "end",
  [MEDIUM]: { justifySelf: "center" },
} as const;

/**
 * The programme's rows in the editor (`DECISIONS.md` §117): when, where, and what in both
 * languages — one row each, in order. A client island for the two things a form cannot do by
 * itself, add a row and remove one; every box posts under a name of its own,
 * `event.schedule[i].<box>`, which `admin/actions.ts#eventFieldsFrom` gathers by index. A row
 * with nothing typed — a date alone is the default below, not something typed — is the spare
 * line and is dropped on save; a half-filled one is refused with its number, so the organizer is
 * told which line, not just that one is wrong.
 *
 * **Each row is the house's row fold** (§842, `shared/ui/row-fold.ts`): the line is the row in
 * words — «10:00–11:30 Ridicarea kiturilor» in the editor's language, the day and the place beside
 * it — with the pencil at the end, and a press on it opens the row's boxes in place, the bin last.
 * A saved row's line starts closed; a row added in this sitting («Adaugă un rând», and the spare
 * line of an empty programme) starts open, reading «Rând nou» until something is typed. The line
 * follows the typing (the boxes stay uncontrolled: only what the line says is kept here, by the
 * row's key). Every box is still in the event's one form, open or shut: a closed fold posts its
 * boxes like an open one; a time the browser refuses inside one (the box's `HH:mm` pattern) is
 * opened by `ActionForm`'s `onInvalidCapture` before the browser looks for it, and a box a refusal
 * named opens its row by itself.
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
  locale,
}: {
  initial: ScheduleRowValue[];
  labels: {
    date: string;
    time: string;
    endTime: string;
    ro: string;
    en: string;
    place: string;
    add: string;
    remove: string;
    empty: string;
    row: string;
    /** «Rând nou»: the line of a row with nothing typed yet. */
    new: string;
    /** «Modifică rândul»: the line's tooltip, what a press on it does. */
    edit: string;
  };
  /** The `name` of the event's start-date box in the same form. */
  startDateName: string;
  /** The event's start date as the start box shows it (`YYYY-MM-DD`), or "" on the create page. */
  startDate: string;
  /** The editor's language: which of the row's two «Ce» the line shows first. */
  locale: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  // Which boxes a refusal named, so each marks itself; the summary links here by `fieldId`.
  const recall = useRecall();
  // `fresh`: added in this sitting (or the spare line of an empty programme), so its fold opens by itself.
  const [rows, setRows] = useState<Array<{ key: number; value: ScheduleRowValue; fresh: boolean }>>(() =>
    initial.length > 0 ? initial.map((value, index) => ({ key: index, value, fresh: false })) : [{ key: 0, value: { ...EMPTY, date: startDate }, fresh: true }],
  );
  const [nextKey, setNextKey] = useState(rows.length);
  // What each row's uncontrolled boxes hold now, by the row's key, kept only for its line. A key is never reused.
  const [typed, setTyped] = useState<Record<number, Partial<ScheduleRowValue>>>({});
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
        return current.map((row, index) => ({ ...row, value: moved[index] }));
      });
    };
    scope.addEventListener("change", onChange);
    return () => scope.removeEventListener("change", onChange);
  }, [startDateName]);

  const add = () => {
    const date = findStartDateInput(root.current, startDateName)?.value || lastStart.current || startDate;
    setRows((current) => [...current, { key: nextKey, value: { ...EMPTY, date }, fresh: true }]);
    setNextKey((key) => key + 1);
  };
  const remove = (key: number) => setRows((current) => current.filter((row) => row.key !== key));
  const setDate = (key: number, date: string) => setRows((current) => current.map((row) => (row.key === key ? { ...row, value: { ...row.value, date } } : row)));
  // The times, the place and the two «Ce», heard from the row's own boxes as they bubble up (`onInput`; the time box announces its own tidying the same way).
  const hear = (key: number) => (event: FormEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const box = /\.(time|endTime|ro|en|place)$/.exec(target.name)?.[1] as keyof ScheduleRowValue | undefined;
    if (!box) return;
    const text = target.value;
    setTyped((current) => ({ ...current, [key]: { ...current[key], [box]: text } }));
  };

  return (
    <Stack ref={root} spacing={{ xs: DENSITY.gapSm, sm: 1.5 }} sx={{ containerType: "inline-size", containerName: "programme-rows" }}>
      {rows.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {labels.empty}
        </Typography>
      )}
      {rows.length > 0 && (
        <Stack spacing={0} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {rows.map(({ key, value, fresh }, index) => {
            const name = (box: keyof ScheduleRowValue) => `event.schedule[${index}].${box}`;
            const n = index + 1;
            const now = { ...value, ...typed[key], date: value.date };
            const when = [now.time.trim(), now.endTime.trim()].filter((part) => part !== "").join("–");
            const what = (locale === "en" ? now.en || now.ro : now.ro || now.en).trim();
            const facts = [dayOf(now.date), now.place.trim()].filter((part) => part !== "").join(" · ");
            const blank = when === "" && what === "";
            // A box a refusal named marks its row: the line in the error colour, and the fold open (§336).
            const named = BOXES.some((box) => recall.named(name(box)));
            return (
              <Box component="li" key={key} sx={ROW_SX}>
                <Box component="details" open={fresh || named || undefined} data-testid="programme-row">
                  <Box component="summary" title={labels.edit} data-testid="programme-row-toggle" sx={SUMMARY_SX}>
                    <Box sx={{ gridArea: "words", minWidth: 0, wordBreak: "break-word", color: named ? "error.main" : undefined }}>
                      {blank ? (
                        <Typography component="span" sx={{ fontWeight: 600 }} data-testid="programme-row-name">
                          {labels.new}
                        </Typography>
                      ) : (
                        <>
                          {when && (
                            <Typography component="span" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }} data-testid="programme-row-when">
                              {when}
                            </Typography>
                          )}
                          {when && what && " "}
                          {what && (
                            <Typography component="span" sx={{ fontWeight: when ? 400 : 600 }} data-testid="programme-row-name">
                              {what}
                            </Typography>
                          )}
                        </>
                      )}
                    </Box>
                    <Box sx={FACTS_SX}>
                      {facts !== "" && (
                        <Typography variant="body2" color="text.secondary" component="span" data-testid="programme-row-facts">
                          {facts}
                        </Typography>
                      )}
                    </Box>
                    <PencilIcon aria-hidden fontSize="small" sx={PENCIL_SX} />
                  </Box>
                  <Box sx={{ pb: 1.5, pt: 0.5 }}>
                    <Box role="group" aria-label={`${labels.row} ${n}`} onInput={hear(key)} sx={GRID_SX}>
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
                      {/* The typed 24-hour time box, like the start time (`WallTimeField`), showing and
                          posting `HH:mm` in either language of the backoffice (§400, §439). */}
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
                        {/* «Tradu din română» (§464): the row's English words from its Romanian ones — in the
                            English box's own cell, so from `MEDIUM` it sits under English, not on a third
                            grid row under Română. */}
                        <Box sx={{ minWidth: 0 }}>
                          <TextField name={name("en")} id={recall.idOf(name("en"))} error={recall.named(name("en"))} label={labels.en} defaultValue={value.en} size="small" fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
                          <TranslateFieldButton en={name("en")} />
                        </Box>
                      </Box>
                      {/* Last in the document, so the keyboard reaches it after every box of the row, wherever
                          the grid draws it. */}
                      <GlyphButton icon="delete" type="button" variant="text" aria-label={`${labels.remove} ${n}`} onClick={() => remove(key)} sx={REMOVE_SX} />
                    </Box>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Stack>
      )}
      {/* The same add button as every other list card of the editor (`LinkRowsEditor`, `CoHostRowsEditor`): a press adds an open row, «Rând nou». */}
      <GlyphButton icon="add" type="button" variant="text" size="small" onClick={add} sx={{ alignSelf: "flex-start", textTransform: "none", minHeight: 44 }}>
        {labels.add}
      </GlyphButton>
    </Stack>
  );
}
