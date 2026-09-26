import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { EVENT_TYPES } from "@/modules/events/domain/event-type";
import { EVENT_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import GlyphSelect from "../GlyphSelect";
import TypeNote from "../TypeNote";
import { type BoxProps, SettingsReadOnly } from "./box-kit";
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
}: BoxProps & {
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
  const aside = [tEvent(`type.${initialType}`), EVENT_STATUS_LABEL[event?.eventStatus ?? "SCHEDULED"]].join(separator);
  // Awaited here rather than nested, so the element is ready when the box is (a string renderer
  // cannot wait for an async component inside a tree — `requiredLine` does the same).
  const status = !mayEditSettings
    ? null
    : event === null
      ? await StatusCard({ event: null })
      : notice
        ? await StatusCard({ event, risk, notice })
        : null;

  return (
    <Panel
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
          {/* A compact help fold, not a card (§398; the owner: "«Ce înseamnă fiecare tip?» ar
              trebui să fie un card mai mic"): a clickable line, closed by default (§336). */}
          <Panel collapsible variant="help" title={t("editor.typeHelpSummary")}>
            <Typography variant="body2" color="text.secondary">
              {t("editor.typeHelp")}
            </Typography>
          </Panel>
          {/* 1.1 — the status (§448): the same select on the create page, starting at "Programat". */}
          {status}
        </Stack>
      ) : (
        <SettingsReadOnly />
      )}
    </Panel>
  );
}
