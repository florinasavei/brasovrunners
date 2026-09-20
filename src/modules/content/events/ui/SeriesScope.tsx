"use client";

import CheckBoxIcon from "@mui/icons-material/CheckBox";
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import EditionMark from "@/modules/events/ui/EditionMark";
import type { SeriesDate } from "@/modules/events/ui/SeriesDates";

/**
 * Which dates of a series a save reaches (`DECISIONS.md` §134; the owner, on the header's
 * chips: "here I should have a select all", and on the three radios: "they should be
 * radios … does not make sense").
 *
 * The header's chips are the choice: a press ticks a date, the arrow opens it, "Toate" ticks
 * every one. The box above Save says the same choice in words and offers the three presets
 * — this date, this and the following, all — as one exclusive control that sets the ticks.
 * Both read one piece of state, held here, so the two never disagree; the ticked ids reach
 * the form as hidden `dates` inputs inside it (`SeriesScopeBox`), and the service applies the
 * save to exactly those (`SeriesEditScope`). The date the page is about is always in and
 * cannot be unticked.
 */

type Preset = "this" | "following" | "all";

type ScopeState = {
  dates: readonly SeriesDate[];
  currentId: string;
  ticked: ReadonlySet<string>;
  toggle: (id: string) => void;
  setPreset: (preset: Preset) => void;
  /** The preset the ticks amount to, or null when they are a hand-made set. */
  preset: Preset | null;
};

const ScopeContext = createContext<ScopeState | null>(null);

function followingIds(dates: readonly SeriesDate[], currentId: string): string[] {
  const position = dates.findIndex((date) => date.id === currentId);
  return position < 0 ? [] : dates.slice(position + 1).map((date) => date.id);
}

export function SeriesScopeProvider({ dates, currentId, children }: { dates: readonly SeriesDate[]; currentId: string; children: ReactNode }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const value = useMemo<ScopeState>(() => {
    const others = dates.filter((date) => date.id !== currentId).map((date) => date.id);
    const following = followingIds(dates, currentId);
    const same = (ids: readonly string[]) => ids.length === ticked.size && ids.every((id) => ticked.has(id));
    const preset: Preset | null = ticked.size === 0 ? "this" : same(others) ? "all" : same(following) ? "following" : null;
    return {
      dates,
      currentId,
      ticked,
      preset,
      toggle: (id) =>
        setTicked((was) => {
          const next = new Set(was);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setPreset: (next) => setTicked(new Set(next === "this" ? [] : next === "all" ? others : following)),
    };
  }, [dates, currentId, ticked]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

function useScope(): ScopeState {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error("SeriesScopeProvider is missing above this component");
  return scope;
}

/** The header's chips: tick to include, the arrow to open, "Toate" for every date. */
export function SeriesScopeChips() {
  const t = useTranslations("Admin");
  const { dates, currentId, ticked, toggle, setPreset, preset } = useScope();
  const router = useRouter();
  const everyOther = preset === "all";
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center" }}>
      {dates.length > 1 && (
        <Chip
          clickable
          variant={everyOther ? "filled" : "outlined"}
          color={everyOther ? "primary" : "default"}
          icon={everyOther ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
          label={everyOther ? t("editor.scope.selectNone") : t("editor.scope.selectAll")}
          onClick={() => setPreset(everyOther ? "this" : "all")}
          size="small"
        />
      )}
      {dates.map((date) => {
        const current = date.id === currentId;
        const on = current || ticked.has(date.id);
        return (
          <Chip
            key={date.id}
            clickable={!current}
            role={current ? undefined : "checkbox"}
            aria-checked={current ? undefined : on}
            aria-label={current ? undefined : date.label}
            aria-current={current ? "page" : undefined}
            variant={on ? "filled" : "outlined"}
            color={on ? "primary" : "default"}
            icon={
              /*
                The date being edited wears no box (§175; the owner: "e ciudat că aici nu pot
                deselecta ediția curentă, e un pic redundant sincer").

                He is right: a tick that cannot be untied is not a choice, it is a picture of
                one, and offering it invites the press that does nothing. The save always
                reaches the date whose editor is open — that is what §134 decided and it has
                not changed — so this chip says "this one" by being filled and current, and the
                boxes are on the dates where ticking is a decision.
              */
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, ml: 0.5 }}>
                {current ? null : on ? <CheckBoxIcon fontSize="small" /> : <CheckBoxOutlineBlankIcon fontSize="small" />}
                {date.note && <EditionMark note={date.note} size={16} />}
              </Box>
            }
            label={date.label}
            onClick={current ? undefined : () => toggle(date.id)}
            onDelete={current ? undefined : () => router.push(date.href)}
            deleteIcon={<OpenInNewIcon aria-label={t("editor.scope.open", { date: date.label })} />}
            size="small"
            sx={{
              ...(date.note?.kind === "cancelled" && !on ? { textDecoration: "line-through", color: "text.secondary" } : {}),
            }}
          />
        );
      })}
    </Box>
  );
}

/**
 * The box above Save: what the ticks amount to, the three presets as one exclusive control,
 * the explanation folded away (the owner: "more boxed and collapsible, it looks ugly on
 * mobile"). Inside the form, so the hidden inputs travel with it.
 */
export function SeriesScopeBox() {
  const t = useTranslations("Admin");
  const { ticked, preset, setPreset } = useScope();
  const sentence =
    preset === "this"
      ? t("editor.scope.this")
      : preset === "following"
        ? `${t("editor.scope.following")} (${ticked.size})`
        : preset === "all"
          ? `${t("editor.scope.all")} (${ticked.size})`
          : t("editor.scope.chosen", { count: String(ticked.size) });
  return (
    <Box component="details" sx={{ border: 1, borderColor: "divider", borderRadius: 2, px: 2, py: 1, "& > summary": { cursor: "pointer", py: 1.25 } }}>
      <Typography component="summary" variant="body2">
        {t("editor.scope.title")}{" "}
        <Box component="strong" sx={{ fontWeight: 600 }}>
          {sentence}
        </Box>
      </Typography>
      {[...ticked].map((id) => (
        <input key={id} type="hidden" name="dates" value={id} />
      ))}
      <ToggleButtonGroup
        exclusive
        size="small"
        orientation="horizontal"
        value={preset}
        onChange={(_event, next: Preset | null) => next && setPreset(next)}
        aria-label={t("editor.scope.title")}
        sx={{ my: 1, flexWrap: "wrap", "& .MuiToggleButton-root": { textTransform: "none", minHeight: 44 } }}
      >
        <ToggleButton value="this">{t("editor.scope.this")}</ToggleButton>
        <ToggleButton value="following">{t("editor.scope.following")}</ToggleButton>
        <ToggleButton value="all">{t("editor.scope.all")}</ToggleButton>
      </ToggleButtonGroup>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
        {t("editor.scope.help")}
      </Typography>
    </Box>
  );
}
