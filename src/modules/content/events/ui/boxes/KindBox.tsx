import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { DEFAULT_DIFFICULTY_STEP, DIFFICULTY_BANDS, difficultyBandOf, difficultyLevelOf, difficultyStepOf } from "@/modules/events/domain/difficulty";
import { EVENT_TYPES } from "@/modules/events/domain/event-type";
import { EVENT_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import CheckboxField from "@/shared/ui/CheckboxField";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";
import { eventInputConstraints } from "../../constraints";
import DifficultyRow from "../DifficultyRow";
import DifficultyStepField from "../DifficultyStepField";
import GlyphSelect from "../GlyphSelect";
import TypeNote from "../TypeNote";
import { BoxNote, type BoxProps, type LanguageEntry, SettingsReadOnly } from "./box-kit";
import CostBox, { costLine } from "./CostBox";
import StatusCard, { type StatusNotice } from "./StatusBox";

/**
 * Card 1, "Ce fel de eveniment" (§350, §406): the type — which switches other cards' fields
 * (§71, §111) — with named cards for the status (`StatusCard`, §448) and the cost (`CostBox`,
 * §466, drawn for every role since the discount note may be a words-only reader's), and the
 * difficulty band and step (§526). The closed line: «Alergare de grup · Programat · Gratuit ·
 * Mediu 2». Open on create (the type decides the rest), folded on the editor; choosing a group
 * run with people registered warns in amber, never locks. A settings reader is told so in place
 * of the select and status.
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
  // The public pages' type labels read the same to an organizer.
  const tEvent = await getTranslations("Event");
  const initialType = event?.type ?? "GROUP_RUN";
  /** One sentence per type, for the note under the select (§170). */
  const typeNotes = Object.fromEntries(EVENT_TYPES.map((type) => [type, t(`editor.typeNotes.${type}`)]));
  const separator = (t.raw("editor.boxes.summary") as { separator: string }).separator;
  // The level on the club's scale of fifteen (§526), as its band and step.
  const level = event ? difficultyLevelOf(event) : null;
  const band = level === null ? null : difficultyBandOf(level);
  // The club's whole scale (§526, §528) behind a «?»; a newline is a tooltip line (§257).
  const difficultyScale = DIFFICULTY_SCALE_LINES.map((line) => t(`editor.difficultyScale.${line}`)).join("\n");
  const step = level === null ? DEFAULT_DIFFICULTY_STEP : difficultyStepOf(level);
  const difficultyLine = band ? t("editor.difficultySummary", { band: t(`editor.difficultyValues.${band}`), step }) : null;
  // The type, the status and the cost (§466), and the difficulty when stated (§526): what this box asks, on its closed line.
  // For the members alone (§552), said on the closed line too: it decides who sees the event at all.
  const membersLine = event?.membersOnly ? t("editor.membersOnlyShort") : null;
  const aside = [tEvent(`type.${initialType}`), EVENT_STATUS_LABEL[event?.eventStatus ?? "SCHEDULED"], await costLine(event, languages), difficultyLine, membersLine]
    .filter((part): part is string => Boolean(part))
    .join(separator);
  // Awaited rather than nested, so the element is ready when the box is (as `requiredLine`).
  const status = !mayEditSettings
    ? null
    : event === null
      ? await StatusCard({ event: null })
      : notice
        ? await StatusCard({ event, risk, notice })
        : null;
  // Awaited for the same reason.
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
          {/* The band and its step on one centred axis (§526, §537, `DifficultyRow`). */}
          <DifficultyRow
            band={
              // The whole scale behind a «?» beside the band too (§528).
              <>
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
              </>
            }
            step={
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
            }
          />
          {/* A compact help fold, closed by default (§336, §398). */}
          <Panel collapsible variant="help" title={t("editor.typeHelpSummary")}>
            <Typography variant="body2" color="text.secondary">
              {t("editor.typeHelp")}
            </Typography>
          </Panel>
          {/*
            «Doar pentru membrii BVR» (§552): who sees the event at all — beside what kind it is. The
            marker says the form carried the box, so a form without it never makes an event public.
            A series carries it by scope, like the night override (§382, §394).
          */}
          <Box>
            <input type="hidden" name="event.membersOnly.present" value="1" />
            <CheckboxField name="event.membersOnly" defaultChecked={event?.membersOnly ?? false}>
              {t("editor.membersOnly")}
            </CheckboxField>
            <BoxNote>{t("editor.membersOnlyHelp")}</BoxNote>
          </Box>
          {/* 1.1 — the status (§448): the same select on the create page, starting at "Programat". */}
          {status}
          {/* The cost (§466): the page draws it after the course. */}
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

/** The «?»'s lines, in order (§528). */
const DIFFICULTY_SCALE_LINES = ["EASY", "MEDIUM1", "MEDIUM2", "MEDIUM3", "FAIRLY_HARD", "HARD", "VERY_HARD", "steps"] as const;
