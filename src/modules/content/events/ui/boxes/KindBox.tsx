import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { EVENT_TYPES } from "@/modules/events/domain/event-type";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import GlyphSelect from "../GlyphSelect";
import TypeNote from "../TypeNote";
import { type BoxProps, SettingsReadOnly } from "./box-kit";

/**
 * Card 1, "Ce fel de eveniment" (§350, §NNN): the type, which the page's overline says first — and
 * which switches other cards' fields on and off: a group run has no registration and no programme
 * (§111), only a race has a gun time (§71).
 *
 * **The type alone since §NNN.** §358 put three cards inside it — the status, the course, the links
 * — because all three described the event itself. The editor is the page now, card by card in the
 * page's order (`events/domain/page-sections.ts`), and those three are drawn in three different
 * places on the page, or not at all: the course where the facts draw its pills, the links where
 * `#links` is; the status is not a section of the page, and sits with the other cards that are
 * not, at the end. Each moved as a whole — its fields, its names, its id.
 *
 * Open on the create page, because the type decides what the other cards ask; folded on the
 * editor, where its closed line is the type. With people registered, choosing "Alergare de grup"
 * says in amber what happens to them — a warning, never a lock. The box itself reaches nobody any
 * more, so it wears no count: the status card, where it went, does.
 *
 * A role that may only read the settings is told so, in place of the select.
 */
export default async function KindBox({
  event,
  mayEditSettings,
  heading,
  registered = 0,
}: BoxProps & {
  registered?: number;
}) {
  const t = await getTranslations("Admin");
  // The type labels already exist for the public pages, and read the same to an organizer.
  const tEvent = await getTranslations("Event");
  const initialType = event?.type ?? "GROUP_RUN";
  /** One sentence per type, for the note under the select (§170). */
  const typeNotes = Object.fromEntries(EVENT_TYPES.map((type) => [type, t(`editor.typeNotes.${type}`)]));

  return (
    <Panel collapsible id="box-kind" title={heading ?? t("editor.boxes.kind.title")} aside={tEvent(`type.${initialType}`)} openWhen={{ attention: event === null }}>
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
          {/* A compact help fold, not a card (§398; the owner: "«Ce înseamnă fiecare tip?» ar
              trebui să fie un card mai mic"): a clickable line, closed by default (§336). */}
          <Panel collapsible variant="help" title={t("editor.typeHelpSummary")}>
            <Typography variant="body2" color="text.secondary">
              {t("editor.typeHelp")}
            </Typography>
          </Panel>
        </Stack>
      ) : (
        <SettingsReadOnly />
      )}
    </Panel>
  );
}
