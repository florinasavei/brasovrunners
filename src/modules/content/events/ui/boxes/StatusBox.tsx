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
 * The create page hands no event and no notice; the editor hands both, always — the type says so,
 * so a saved event (possibly cancelled) can never fall into the create page's card, which starts
 * at "Programat" and has nobody to tell.
 */
export type StatusCardProps = { risk?: RiskMark | null } & ({ event: null; notice?: never } | { event: EditableEvent; notice: StatusNotice });

/**
 * "Starea evenimentului" (§350, §358, §NNN) — a named card inside the first box, «Ce fel de
 * eveniment» (`KindBox`), where the owner looks for it (2026-09-26: "starea evenimentului ar trebui
 * să apară pe primul card"). §358 put it there first; §406 made it a box of its own among the
 * cards that are not a section of the page; §NNN brings it back, whole — its fields, its names, its
 * id — and the first box's closed line says it beside the type: «Alergare de grup · Programat».
 *
 * **On the create page it is the editor's same select** (§NNN, reversing the read-only
 * "Programat" of §350/§358; the owner, 2026-09-26: "ar trebui să pot crea un eveniment deja anulat
 * din start"), starting at "Programat". "Anulat" asks why, in Română and in English, the same two
 * boxes as the editor's (§331, §354) — and nothing else: there is no "tell them" box, because
 * nobody can be registered for an event that does not exist yet, and the create sends no email.
 * "Încheiat" is offered too, for an event that already took place; the service refuses it while
 * the start is still ahead.
 *
 * **On the editor**, inside the save form, so a refusal keeps it (§315); while "Anulat" is chosen on
 * an event that was not cancelled, the cancellation's reason and its "tell them" appear under the
 * select (§331) — they read the select by name. With people registered the card is amber and says
 * what a cancellation does to them (the count is said once, under the page map, §408).
 *
 * Drawn only for a role that may change the settings: for any other, the first box says the
 * settings are not theirs, and its closed line still names the status.
 */
export default async function StatusCard({ event, risk, notice }: StatusCardProps) {
  const t = await getTranslations("Admin");
  const card = {
    id: "box-status",
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
    // Only the cancellation's own words: with nobody to tell, the notice's are never drawn.
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
