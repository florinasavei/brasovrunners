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
 * Box 1, "Ce fel de eveniment" (§350): the type, which switches other boxes' fields on and off —
 * a group run has no registration and no programme (§111), only a race has a gun time (§71).
 *
 * Open on the create page, because the type decides what the other boxes ask; folded on the
 * editor, where the summary says which it is. With people registered, choosing "Alergare de grup"
 * says in amber what happens to them — a warning, never a lock.
 */
export default async function KindBox({ event, mayEditSettings, registered = 0 }: BoxProps & { registered?: number }) {
  const t = await getTranslations("Admin");
  // The type labels already exist for the public pages, and read the same to an organizer.
  const tEvent = await getTranslations("Event");
  const initialType = event?.type ?? "GROUP_RUN";
  /** One sentence per type, for the note under the select (§170). */
  const typeNotes = Object.fromEntries(EVENT_TYPES.map((type) => [type, t(`editor.typeNotes.${type}`)]));

  return (
    <Panel
      collapsible
      id="box-kind"
      title={t("editor.boxes.kind.title")}
      aside={tEvent(`type.${initialType}`)}
      openWhen={{ attention: event === null }}
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
          <Panel collapsible level={3} title={t("editor.typeHelpSummary")}>
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
