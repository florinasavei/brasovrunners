import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { getTranslations } from "next-intl/server";
import { EVENT_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import RecallField from "@/shared/forms/recall";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import { EventCancelFields, type EventNoticeLabels } from "../EventNoticeFields";
import { BoxNote, type BoxProps, RiskLine, SettingsReadOnly } from "./box-kit";

const EVENT_STATUSES = ["SCHEDULED", "CANCELLED", "COMPLETED"] as const;

/**
 * Card 1.1, "Starea evenimentului" (§350, §NNN) — the first card inside "Ce fel de eveniment", on
 * both pages, so the two look the same.
 *
 * **On the create page it is read-only**: "Programat", and one line saying the status can be
 * changed once the event exists. The page posts a hidden `SCHEDULED` beside it — this card posts
 * nothing — so "Anulat" and "Încheiat" are never offered for an event that does not exist yet
 * (cancelling asks why and tells the people registered, §331, and a new event has neither).
 *
 * **On the editor**, inside the save form, so a refusal keeps it (§315); while "Anulat" is chosen on
 * an event that was not cancelled, the cancellation's reason and its "tell them" appear under the
 * select (§331) — they read the select by name. With people registered the card is amber and says
 * what a cancellation does to them.
 */
export default async function StatusBox({
  event,
  mayEditSettings,
  risk,
  notice,
}: BoxProps & {
  /** The cancellation's words and counts (§331); the editor's only — create has nobody to tell. */
  notice?: { labels: EventNoticeLabels; offerNotice: boolean; maxLength: number };
}) {
  const t = await getTranslations("Admin");
  const status = event?.eventStatus ?? "SCHEDULED";
  return (
    <Panel
      collapsible
      level={3}
      id="box-status"
      title={t("editor.boxes.status.title")}
      aside={EVENT_STATUS_LABEL[status]}
      tone={risk ? "risk" : "default"}
      badge={risk?.chip}
    >
      {risk && <RiskLine>{t("editor.risk.status", { count: risk.count })}</RiskLine>}
      {!mayEditSettings ? (
        <SettingsReadOnly />
      ) : event === null || !notice ? (
        <Stack spacing={1} data-testid="status-on-create">
          {/* No name: the page's hidden `event.eventStatus` is what posts. */}
          <TextField label={t("editor.eventStatus")} defaultValue={EVENT_STATUS_LABEL.SCHEDULED} disabled sx={{ maxWidth: 320 }} />
          <BoxNote>{t("editor.boxes.status.createNote")}</BoxNote>
        </Stack>
      ) : (
        <Stack spacing={2}>
          <RecallField
            select
            name="event.eventStatus"
            label={t("editor.eventStatus")}
            defaultValue={event.eventStatus}
            required={eventInputConstraints("eventStatus").required}
            sx={{ maxWidth: 320 }}
          >
            {EVENT_STATUSES.map((value) => (
              <MenuItem key={value} value={value}>
                {EVENT_STATUS_LABEL[value]}
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
      )}
    </Panel>
  );
}
