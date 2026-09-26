import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { getTranslations } from "next-intl/server";
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
 * so a saved event (possibly cancelled) can never fall into the create page's read-only
 * "Programat", which posts nothing.
 */
export type StatusCardProps = { risk?: RiskMark | null } & ({ event: null; notice?: never } | { event: EditableEvent; notice: StatusNotice });

/**
 * "Starea evenimentului" (§350, §358, §NNN) — a named card inside the first box, «Ce fel de
 * eveniment» (`KindBox`), where the owner looks for it (2026-09-26: "starea evenimentului ar trebui
 * să apară pe primul card"). §358 put it there first; §406 made it a box of its own among the
 * cards that are not a section of the page; §NNN brings it back, whole — its fields, its names, its
 * id — and the first box's closed line says it beside the type: «Alergare de grup · Programat».
 *
 * **On the create page it is read-only**: "Programat", and one line saying the status can be
 * changed once the event exists. The page posts a hidden `SCHEDULED` beside it — this card posts
 * nothing — so "Anulat" and "Încheiat" are never offered for an event that does not exist yet
 * (cancelling asks why and tells the people registered, §331, and a new event has neither).
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

  if (event === null) {
    return (
      <Panel collapsible {...card}>
        <Stack spacing={1} data-testid="status-on-create">
          {/* No name: the page's hidden `event.eventStatus` is what posts. */}
          <TextField label={t("editor.eventStatus")} defaultValue={EVENT_STATUS_LABEL.SCHEDULED} disabled sx={{ maxWidth: 320 }} />
          <BoxNote>{t("editor.boxes.status.createNote")}</BoxNote>
        </Stack>
      </Panel>
    );
  }

  return (
    <Panel collapsible {...card}>
      {risk && <RiskLine>{t("editor.risk.status")}</RiskLine>}
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
    </Panel>
  );
}
