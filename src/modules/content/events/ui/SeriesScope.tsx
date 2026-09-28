"use client";

import DateRangeIcon from "@mui/icons-material/DateRange";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Link from "@mui/material/Link";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Checkbox from "@mui/material/Checkbox";
import Typography from "@mui/material/Typography";
import { useTranslations } from "next-intl";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { countForm } from "@/i18n/count-form";
import EditionMark from "@/modules/events/ui/EditionMark";
import type { SeriesDate } from "@/modules/events/ui/SeriesDates";
import { fillIn } from "@/shared/forms/fill-in";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { CHECKBOX_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * Which dates of a series a save reaches (§134, §350): "Doar această dată / Această dată și
 * următoarele / Toate datele seriei" beside the save button, the individual dates folded underneath,
 * and a sentence with the count. "This and the following" is the default (reversing §240): past
 * dates are history, and rewriting them rewrites what their runners were told. One piece of state
 * keeps radios, sentence and ticks in agreement; the ticked ids post as hidden `dates` inputs and
 * the service applies the save to exactly those (`SeriesEditScope`). The open date is always in. A
 * hand-picked set shows as a fourth, read-only radio.
 */

type Preset = "this" | "following" | "all";

/** A series date with its day in words, written on the server (`src/i18n/dates.ts`, §324). */
export type ScopeDate = SeriesDate & { day: string };

type ScopeState = {
  dates: readonly ScopeDate[];
  currentId: string;
  ticked: ReadonlySet<string>;
  toggle: (id: string) => void;
  setPreset: (preset: Preset) => void;
  /** The preset the ticks amount to, or null when they are a hand-made set. */
  preset: Preset | null;
};

const ScopeContext = createContext<ScopeState | null>(null);

export function followingIds(dates: readonly { id: string }[], currentId: string): string[] {
  const position = dates.findIndex((date) => date.id === currentId);
  return position < 0 ? [] : dates.slice(position + 1).map((date) => date.id);
}

/** Which preset a set of ticks amounts to, or null for a hand-made set. */
export function presetOf(dates: readonly { id: string }[], currentId: string, ticked: ReadonlySet<string>): Preset | null {
  const others = dates.filter((date) => date.id !== currentId).map((date) => date.id);
  const following = followingIds(dates, currentId);
  const same = (ids: readonly string[]) => ids.length === ticked.size && ids.every((id) => ticked.has(id));
  if (ticked.size === 0) return "this";
  if (same(following)) return "following";
  if (same(others)) return "all";
  return null;
}

/** The dates a preset ticks, the open one never among them. */
export function presetIds(preset: Preset, dates: readonly { id: string }[], currentId: string): string[] {
  if (preset === "this") return [];
  if (preset === "all") return dates.filter((date) => date.id !== currentId).map((date) => date.id);
  return followingIds(dates, currentId);
}

/**
 * The radio to show: the pressed preset while the ticks still match it, else what the ticks amount
 * to. From the ticks alone, "Toate" on the first date (or "următoarele" on the last) would snap
 * to another preset with the same dates and the control would lie. A hand tick clears `chosen`.
 */
export function shownPreset(
  chosen: Preset | null,
  dates: readonly { id: string }[],
  currentId: string,
  ticked: ReadonlySet<string>,
): Preset | null {
  if (chosen) {
    const ids = presetIds(chosen, dates, currentId);
    if (ids.length === ticked.size && ids.every((id) => ticked.has(id))) return chosen;
  }
  return presetOf(dates, currentId, ticked);
}

export function SeriesScopeProvider({ dates, currentId, children }: { dates: readonly ScopeDate[]; currentId: string; children: ReactNode }) {
  // "This and the following" when the editor opens (§350, reversing §240).
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(followingIds(dates, currentId)));
  // The last pressed radio, or null once a date was ticked by hand (`shownPreset`).
  const [chosen, setChosen] = useState<Preset | null>("following");
  const value = useMemo<ScopeState>(
    () => ({
      dates,
      currentId,
      ticked,
      preset: shownPreset(chosen, dates, currentId, ticked),
      toggle: (id) => {
        setChosen(null);
        setTicked((was) => {
          const next = new Set(was);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      },
      setPreset: (next) => {
        setChosen(next);
        setTicked(new Set(presetIds(next, dates, currentId)));
      },
    }),
    [dates, currentId, ticked, chosen],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

function useScope(): ScopeState {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error("SeriesScopeProvider is missing above this component");
  return scope;
}

/**
 * "Salvează pentru" in the Salvare box: the radios, the sentence, why only changes travel
 * (folded), and "Alege datele una câte una" (folded unless hand-picked). Inside the save form so
 * the hidden inputs post with it.
 */
export function SeriesScopeBox({ locale }: { locale: string }) {
  const t = useTranslations("Admin");
  const tEvent = useTranslations("Event");
  const { dates, currentId, ticked, preset, setPreset, toggle } = useScope();

  // Every date the save reaches, the current one included, in the series' order.
  const reached = dates.filter((date) => date.id === currentId || ticked.has(date.id));
  const current = dates.find((date) => date.id === currentId);
  const count = reached.length;
  const datesWords = tEvent(`series.count.${countForm(count, locale)}`, { count });
  const sentence =
    count <= 1
      ? t("editor.scope.countThis")
      : preset === "following" && current
        ? fillIn(t.raw("editor.scope.countFollowing") as string, {
            dates: datesWords,
            first: current.day,
            rest: String(count - 1),
            last: reached[reached.length - 1]?.day ?? "",
          })
        : fillIn(t.raw("editor.scope.countRange") as string, {
            dates: datesWords,
            first: reached[0]?.day ?? "",
            last: reached[reached.length - 1]?.day ?? "",
          });

  return (
    <Stack spacing={1.5} data-testid="series-scope">
      {[...ticked].map((id) => (
        <input key={id} type="hidden" name="dates" value={id} />
      ))}
      <Box component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
        <Typography component="legend" variant="subtitle2" sx={{ fontWeight: 600 }}>
          {t("editor.scope.title")}
        </Typography>
        <RadioGroup
          value={preset ?? "custom"}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "this" || next === "following" || next === "all") setPreset(next);
          }}
        >
          {(["this", "following", "all"] as const).map((value) => (
            <FormControlLabel key={value} value={value} control={<Radio />} label={t(`editor.scope.${value}`)} sx={TAP_TARGET} />
          ))}
          {preset === null && (
            <FormControlLabel value="custom" control={<Radio />} label={t("editor.scope.custom", { count: ticked.size })} disabled sx={TAP_TARGET} />
          )}
        </RadioGroup>
      </Box>
      <Typography variant="body2" data-testid="series-scope-count" role="status">
        {sentence} {count > 1 ? t("editor.scope.countTail") : ""}
      </Typography>
      <Box component="details" sx={BOXED_DISCLOSURE_SX}>
        <Typography component="summary" variant="body2">
          <HelpOutlineIcon aria-hidden sx={FOLD_GLYPH_SX} />
          {t("editor.scope.whyTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("editor.scope.help")}
        </Typography>
      </Box>
      {/* The exceptions, one date at a time; open while the ticks are hand-picked. */}
      <Box component="details" open={preset === null || undefined} sx={BOXED_DISCLOSURE_SX} data-testid="series-pick-dates">
        <Typography component="summary" variant="body2" sx={{ fontWeight: 600 }}>
          <DateRangeIcon aria-hidden sx={FOLD_GLYPH_SX} />
          {t("editor.boxes.pickDates.title")}
        </Typography>
        <Stack>
          {dates.map((date) => {
            const isCurrent = date.id === currentId;
            return (
              <Stack key={date.id} direction="row" spacing={1} sx={{ alignItems: "center", minHeight: 44, flexWrap: "wrap" }}>
                {isCurrent ? (
                  <Typography variant="body2" sx={{ pl: 1.5, fontWeight: 600 }}>
                    {date.label} · {t("editor.scope.thisOne")}
                  </Typography>
                ) : (
                  <FormControlLabel
                    control={<Checkbox checked={ticked.has(date.id)} onChange={() => toggle(date.id)} sx={CHECKBOX_TAP_TARGET} />}
                    label={date.label}
                    sx={date.note?.kind === "cancelled" ? { textDecoration: "line-through", color: "text.secondary" } : undefined}
                  />
                )}
                {date.note && <EditionMark note={date.note} size={16} />}
                {!isCurrent && (
                  <Link href={date.href} variant="body2" sx={{ display: "inline-block", py: 1 }}>
                    {t("editor.scope.openShort")}
                  </Link>
                )}
              </Stack>
            );
          })}
        </Stack>
      </Box>
    </Stack>
  );
}
