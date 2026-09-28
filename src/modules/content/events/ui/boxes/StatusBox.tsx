import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { EVENT_NOTICE_TEXT_MAX } from "@/modules/events/domain/event-changes";
import { EVENT_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import RecallField from "@/shared/forms/recall";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import type { EditableEvent } from "../../repository";
import { EventCancelFields, type EventNoticeLabels } from "../EventNoticeFields";
import { BoxNote, type RiskMark, RiskLine } from "./box-kit";

const EVENT_STATUSES = ["SCHEDULED", "CANCELLED", "COMPLETED"] as const;

/** The cancellation's words and counts (§331). */
export type StatusNotice = { labels: EventNoticeLabels; offerNotice: boolean; maxLength: number };

/**
 * The create page passes no event and no notice; the editor passes both. The type keeps a saved
 * (possibly cancelled) event out of the create page's card.
 */
export type StatusCardProps = { risk?: RiskMark | null } & ({ event: null; notice?: never } | { event: EditableEvent; notice: StatusNotice });

/**
 * "Starea evenimentului" (§448): a named card inside «Ce fel de eveniment». On the create page the
 * same select starting at "Programat": "Anulat" asks why in both languages (§331, §354) with no
 * "tell them" box (nobody is registered and create sends no email); "Încheiat" is refused while
 * the start is ahead. On the editor it is inside the save form (§315); choosing "Anulat" shows the
 * reason and "tell them" (§331); amber with people registered (§408). Drawn only for a role that
 * may change the settings.
 */
export default async function StatusCard({ event, risk, notice }: StatusCardProps) {
  const t = await getTranslations("Admin");
  const card = {
    id: "box-status",
    glyph: "status",
    level: 3,
    title: t("editor.boxes.status.title"),
    aside: EVENT_STATUS_LABEL[event?.eventStatus ?? "SCHEDULED"],
    tone: risk ? "risk" : "default",
  } as const;

  const select = (initialStatus: (typeof EVENT_STATUSES)[number]) => (
    <RecallField
      select
      name="event.eventStatus"
      label={t("editor.eventStatus")}
      defaultValue={initialStatus}
      required={eventInputConstraints("eventStatus").required}
      sx={{ maxWidth: 320 }}
    >
      {EVENT_STATUSES.map((value) => (
        <MenuItem key={value} value={value}>
          {EVENT_STATUS_LABEL[value]}
        </MenuItem>
      ))}
    </RecallField>
  );

  if (event === null) {
    const tSite = await getTranslations("Site");
    // Only the cancellation's words: with nobody to tell, the notice's are never drawn.
    const labels: EventNoticeLabels = {
      notify: "",
      notifyHelp: "",
      note: "",
      noteHelp: "",
      cancelTitle: t("editor.notice.cancelTitleCreate"),
      cancelIntro: t("editor.notice.cancelIntroCreate"),
      cancelReason: t("editor.notice.cancelReason"),
      cancelReasonHelp: t("editor.notice.cancelReasonHelpCreate", { max: String(EVENT_NOTICE_TEXT_MAX) }),
      cancelNotify: "",
      cancelNotifyHelp: "",
      languageRo: tSite("languageName.ro"),
      languageEn: tSite("languageName.en"),
      identical: t("editor.identical.warning"),
    };
    return (
      <Panel collapsible {...card}>
        <Stack spacing={2} data-testid="status-on-create">
          {select("SCHEDULED")}
          <BoxNote>{t("editor.boxes.status.createNote")}</BoxNote>
          <EventCancelFields
            statusSelectName="event.eventStatus"
            initialStatus="SCHEDULED"
            wasCancelled={false}
            offerNotice={false}
            maxLength={EVENT_NOTICE_TEXT_MAX}
            labels={labels}
          />
        </Stack>
      </Panel>
    );
  }

  return (
    <Panel collapsible {...card}>
      {risk && <RiskLine>{t("editor.risk.status")}</RiskLine>}
      <Stack spacing={2}>
        {select(event.eventStatus)}
        <EventCancelFields
          statusSelectName="event.eventStatus"
          initialStatus={event.eventStatus}
          wasCancelled={event.eventStatus === "CANCELLED"}
          offerNotice={notice.offerNotice}
          maxLength={notice.maxLength}
          labels={notice.labels}
        />
      </Stack>
    </Panel>
  );
}
