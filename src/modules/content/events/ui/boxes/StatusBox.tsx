import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { EVENT_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import RecallField from "@/shared/forms/recall";
import Panel from "@/shared/ui/Panel";
import type { EditableEvent } from "../../repository";
import { eventInputConstraints } from "../../constraints";
import { EventCancelFields, type EventNoticeLabels } from "../EventNoticeFields";
import { type RiskMark, RiskLine, SettingsReadOnly } from "./box-kit";

const EVENT_STATUSES = ["SCHEDULED", "CANCELLED", "COMPLETED"] as const;

/**
 * Box 9, "Starea evenimentului" (§350), edit only — the create page posts a hidden `SCHEDULED`,
 * so "Anulat" and "Încheiat" are never offered for an event that does not exist yet.
 *
 * Inside the save form, so a refusal keeps it (§315); while "Anulat" is chosen on an event that
 * was not cancelled, the cancellation's reason and its "tell them" appear under the select
 * (§331) — they read the select by name. With people registered the box is amber and says what a
 * cancellation does to them.
 */
export default async function StatusBox({
  event,
  mayEditSettings,
  risk,
  notice,
}: {
  event: EditableEvent;
  mayEditSettings: boolean;
  risk?: RiskMark | null;
  notice: { labels: EventNoticeLabels; offerNotice: boolean; maxLength: number };
}) {
  const t = await getTranslations("Admin");
  return (
    <Panel
      collapsible
      id="box-status"
      title={t("editor.boxes.status.title")}
      aside={EVENT_STATUS_LABEL[event.eventStatus]}
      tone={risk ? "risk" : "default"}
      badge={risk?.chip}
    >
      {risk && <RiskLine>{t("editor.risk.status", { count: risk.count })}</RiskLine>}
      {mayEditSettings ? (
        <Stack spacing={2}>
          <RecallField
            select
            name="event.eventStatus"
            label={t("editor.eventStatus")}
            defaultValue={event.eventStatus}
            required={eventInputConstraints("eventStatus").required}
            sx={{ maxWidth: 320 }}
          >
            {EVENT_STATUSES.map((status) => (
              <MenuItem key={status} value={status}>
                {EVENT_STATUS_LABEL[status]}
              </MenuItem>
            ))}
          </RecallField>
          <EventCancelFields
            statusSelectName="event.eventStatus"
            initialStatus={event.eventStatus}
            wasCancelled={event.eventStatus === "CANCELLED"}
            offerNotice={notice.offerNotice}
            maxLength={notice.maxLength}
            labels={notice.labels}
          />
        </Stack>
      ) : (
        <SettingsReadOnly />
      )}
    </Panel>
  );
}
