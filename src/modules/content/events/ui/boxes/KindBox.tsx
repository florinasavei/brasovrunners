import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { DEFAULT_DIFFICULTY_STEP, DIFFICULTY_BANDS, difficultyBandOf, difficultyLevelOf, difficultyStepOf } from "@/modules/events/domain/difficulty";
import { EVENT_TYPES } from "@/modules/events/domain/event-type";
import { EVENT_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";
import { eventInputConstraints } from "../../constraints";
import DifficultyStepField from "../DifficultyStepField";
import GlyphSelect from "../GlyphSelect";
import TypeNote from "../TypeNote";
import { type BoxProps, type LanguageEntry, SettingsReadOnly } from "./box-kit";
import CostBox, { costLine } from "./CostBox";
import StatusCard, { type StatusNotice } from "./StatusBox";

/**
 * Card 1, "Ce fel de eveniment" (§350, §406, §448): the type, which the page's overline says first
 * — and which switches other cards' fields on and off: a group run has no registration and no
 * programme (§111), only a race has a gun time (§71) — and, as a named card inside it, the event's
 * status (`StatusCard`).
 *
 * **The status is here again since §448** (the owner, 2026-09-26: "starea evenimentului ar trebui
 * să apară pe primul card «Ce fel de eveniment»"). §358 had put the status, the course and the
 * links inside this box; §406 moved all three out — the course and the links to where the page
 * draws them, the status to the cards that are not on the page. The course and the links stay
 * where §406 put them; the status comes back, because it is the first thing an organizer asks of an
 * event after what kind it is. The box's closed line says both: «Alergare de grup · Programat».
 *
 * Open on the create page, because the type decides what the other cards ask; folded on the
 * editor. With people registered, choosing "Alergare de grup" says in amber what happens to them —
 * a warning, never a lock — and, since the status card inside it is one of the boxes whose change
 * reaches people, the box wears the amber outline too (the count is said once, under the page map,
 * §408).
 *
 * **The cost is a named card in here too since §466** (the owner, 2026-09-26: "cardul 7. Cost poate
 * fi inclus în cardul 1. la ce fel de eveniment"): `CostBox`, drawn after the status card under the plain
 * title «Cost» with its id `box-cost`, so a deep link still lands on it; it has no number and no
 * chip on the map, and the cards after it renumber. The box's closed line names it third:
 * «Alergare de grup · Programat · Gratuit».
 * It is drawn for every role — a words-only reader may own the discount note (§394).
 *
 * **The difficulty is asked here since §526** — the band («Ușor» … «Foarte greu») and its step
 * (1 · 2 · 3) side by side from `sm`: with the type, what kind of outing this is. The closed line
 * names it last, «Mediu 2», and says nothing while the club has not said.
 *
 * A role that may only read the settings is told so, in place of the select and the status card;
 * the closed line still names both.
 */
export default async function KindBox({
  event,
  mayEditSettings,
  heading,
  risk = null,
  notice,
  registered = 0,
  languages = [],
}: BoxProps & {
  /** Every language's row, for the cost card's discount note (§394, §466). */
  languages?: readonly LanguageEntry[];
  registered?: number;
  /** The cancellation's words (§331); the editor hands them, the create page does not. */
  notice?: StatusNotice;
}) {
  const t = await getTranslations("Admin");
  // The type labels already exist for the public pages, and read the same to an organizer.
  const tEvent = await getTranslations("Event");
  const initialType = event?.type ?? "GROUP_RUN";
  /** One sentence per type, for the note under the select (§170). */
  const typeNotes = Object.fromEntries(EVENT_TYPES.map((type) => [type, t(`editor.typeNotes.${type}`)]));
  const separator = (t.raw("editor.boxes.summary") as { separator: string }).separator;
  // The level on the club's scale of fifteen (§526), as the two controls show it: its band and its step.
  const level = event ? difficultyLevelOf(event) : null;
  const band = level === null ? null : difficultyBandOf(level);
  // The club's whole scale, one line per band in the owner's words (§526, §528), behind a «?» beside
  // the band and after «Treapta»'s help: a newline is a line in the tooltip (§257).
  const difficultyScale = DIFFICULTY_SCALE_LINES.map((line) => t(`editor.difficultyScale.${line}`)).join("\n");
  const step = level === null ? DEFAULT_DIFFICULTY_STEP : difficultyStepOf(level);
  const difficultyLine = band ? t("editor.difficultySummary", { band: t(`editor.difficultyValues.${band}`), step }) : null;
  // The type, the status and the cost (§466), and the difficulty when stated (§526): what this box asks, on its closed line.
  const aside = [tEvent(`type.${initialType}`), EVENT_STATUS_LABEL[event?.eventStatus ?? "SCHEDULED"], await costLine(event, languages), difficultyLine]
    .filter((part): part is string => Boolean(part))
    .join(separator);
  // Awaited here rather than nested, so the element is ready when the box is (a string renderer
  // cannot wait for an async component inside a tree — `requiredLine` does the same).
  const status = !mayEditSettings
    ? null
    : event === null
      ? await StatusCard({ event: null })
      : notice
        ? await StatusCard({ event, risk, notice })
        : null;
  // The cost card (§466), awaited for the same reason as the status card.
  const cost = await CostBox({ event, mayEditSettings, languages });

  return (
    <Panel glyph="kind"
      collapsible
      id="box-kind"
      title={heading ?? t("editor.boxes.kind.title")}
      aside={aside}
      openWhen={{ attention: event === null }}
      tone={risk ? "risk" : "default"}
    >
      {mayEditSettings ? (
        <Stack spacing={1.5}>
          {/* The closed set with its glyphs (§121), the same the public pages show (§112). */}
          <GlyphSelect
            name="event.type"
            label={t("editor.type")}
            defaultValue={initialType}
            options={EVENT_TYPES.map((type) => ({ value: type, label: tEvent(`type.${type}`), glyph: `type:${type}` as const }))}
            required={eventInputConstraints("type").required}
          />
          {/* What the chosen type means, in one line; the comparison of all seven folded under it. */}
          <TypeNote selectName="event.type" initialType={initialType} notes={typeNotes} />
          <Typography variant="body2" color="text.secondary">
            {t("editor.boxes.kind.changes")}
          </Typography>
          {registered > 0 && initialType !== "GROUP_RUN" && (
            <TypeNote
              selectName="event.type"
              initialType={initialType}
              notes={{ GROUP_RUN: t("editor.boxes.kind.groupRunWarning", { count: registered }) }}
              warning
            />
          )}
          {/* How hard (§526): the band and its step, side by side from `sm` — the level on the
              club's scale of fifteen, which «Ghid» explains. */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
            {/* The whole scale behind a «?» beside the band too (§528): the band is the first choice. */}
            <Box sx={{ display: "flex", alignItems: "center", flex: 1 }}>
              <GlyphSelect
                name="event.difficulty"
                label={t("editor.fields.difficulty")}
                defaultValue={band ?? ""}
                options={[
                  { value: "", label: t("editor.notStated") },
                  ...DIFFICULTY_BANDS.map((value) => ({ value, label: t(`editor.difficultyValues.${value}`), glyph: `difficulty:${value}` as const })),
                ]}
                sx={{ flex: 1 }}
              />
              <QuietHelp text={difficultyScale} testId="difficulty-band-help" />
            </Box>
            <DifficultyStepField
              name="event.difficultyStep"
              defaultStep={step}
              words={{
                label: t("editor.fields.difficultyStep"),
                help: t("editor.difficultyStepHelp"),
                scale: difficultyScale,
                choices: { step1: t("editor.difficultySteps.step1"), step2: t("editor.difficultySteps.step2"), step3: t("editor.difficultySteps.step3") },
              }}
            />
          </Stack>
          {/* A compact help fold, not a card (§398; the owner: "«Ce înseamnă fiecare tip?» ar
              trebui să fie un card mai mic"): a clickable line, closed by default (§336). */}
          <Panel collapsible variant="help" title={t("editor.typeHelpSummary")}>
            <Typography variant="body2" color="text.secondary">
              {t("editor.typeHelp")}
            </Typography>
          </Panel>
          {/* 1.1 — the status (§448): the same select on the create page, starting at "Programat". */}
          {status}
          {/* 1.2 — the cost (§466): the page draws it after the course; the editor asks it here. */}
          {cost}
        </Stack>
      ) : (
        <Stack spacing={1.5}>
          <SettingsReadOnly />
          {cost}
        </Stack>
      )}
    </Panel>
  );
}

/** The «?»'s lines, in order: «Ușor», «Mediu» per step, the other bands, what a step means — the owner's words (§528), which «Ghid» points to. */
const DIFFICULTY_SCALE_LINES = ["EASY", "MEDIUM1", "MEDIUM2", "MEDIUM3", "FAIRLY_HARD", "HARD", "VERY_HARD", "steps"] as const;
