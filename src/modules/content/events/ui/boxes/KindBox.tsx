import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { EVENT_TYPES } from "@/modules/events/domain/event-type";
import { EVENT_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import { kindSummary } from "../box-summaries";
import GlyphSelect from "../GlyphSelect";
import TypeNote from "../TypeNote";
import { type BoxProps, SettingsReadOnly, summaryWords } from "./box-kit";

/**
 * Box 1, "Ce fel de eveniment" (§350): the type, which switches other boxes' fields on and off —
 * a group run has no registration and no programme (§111), only a race has a gun time (§71).
 *
 * **And the three cards about the event itself, inside it** (§NNN; the owner, 2026-09-24, on the
 * editor: "these 3 cards should be in the first one, both on edit and create mode"): 1.1 "Starea
 * evenimentului", 1.2 "Traseul", 1.3 "Linkuri și fișiere", as named level-3 cards under the type
 * and its help — the way "Participare și înscrieri" holds 8.1–8.5. The page draws them and hands
 * them in as `children`, so each keeps its own props, its own fields and its own id
 * (`#box-status`, `#box-course`, `#box-links`); a refusal or a `#fragment` naming a field inside
 * one opens this box and the card together (`openFoldsAround` walks every fold up).
 *
 * Open on the create page, because the type decides what the other boxes ask; folded on the
 * editor, where the closed line is the top of the fact sheet: the type, the status, the course in
 * two or three words and the number of links (`kindSummary`). With people registered, choosing
 * "Alergare de grup" says in amber what happens to them — a warning, never a lock.
 *
 * **With people registered, the box itself is amber and wears the count** (§350), because the
 * status card inside it is one of the five whose change reaches them, and a closed box has to say
 * so without being opened. The sentence about what a change does stays in the card it is about.
 *
 * A role that may only read the settings is told so once, here, in place of the type; the three
 * cards are then their headings and their lines, with nothing to open.
 */
export default async function KindBox({
  event,
  mayEditSettings,
  risk,
  registered = 0,
  locale,
  children,
}: BoxProps & {
  registered?: number;
  /** The reader's language, for the counted "2 linkuri" on the closed line. */
  locale: string;
  /** Cards 1.1–1.3, drawn by the page (§NNN). */
  children?: ReactNode;
}) {
  const t = await getTranslations("Admin");
  // The type labels already exist for the public pages, and read the same to an organizer.
  const tEvent = await getTranslations("Event");
  const { words } = await summaryWords();
  const initialType = event?.type ?? "GROUP_RUN";
  /** One sentence per type, for the note under the select (§170). */
  const typeNotes = Object.fromEntries(EVENT_TYPES.map((type) => [type, t(`editor.typeNotes.${type}`)]));
  const aside = kindSummary(
    words,
    event,
    {
      type: tEvent(`type.${initialType}`),
      // An event that does not exist yet is scheduled (§331): the create page posts `SCHEDULED`.
      status: EVENT_STATUS_LABEL[event?.eventStatus ?? "SCHEDULED"],
      surface: event?.surface ? tEvent(`surface.${event.surface}`) : null,
      difficulty: event?.difficulty ? t(`editor.difficultyValues.${event.difficulty}`) : null,
    },
    locale,
  );

  return (
    <Panel
      collapsible
      id="box-kind"
      title={t("editor.boxes.kind.title")}
      aside={aside}
      openWhen={{ attention: event === null }}
      tone={risk ? "risk" : "default"}
      badge={risk?.chip}
    >
      <Stack spacing={2}>
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
        {/* 1.1–1.3 — each a named card with its own closed line; for a reader who may only read
            them, the line alone, under the one sentence above. */}
        {children}
      </Stack>
    </Panel>
  );
}
