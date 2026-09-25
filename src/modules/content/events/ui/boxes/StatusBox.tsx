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
import { BoxNote, type BoxProps, RiskLine } from "./box-kit";

const EVENT_STATUSES = ["SCHEDULED", "CANCELLED", "COMPLETED"] as const;

/** The cancellation's words and counts (§331). */
type StatusNotice = { labels: EventNoticeLabels; offerNotice: boolean; maxLength: number };

/**
 * The create page hands no event and no notice; the editor hands both, always — the type says so,
 * so a saved event (possibly cancelled) can never fall into the create page's read-only
 * "Programat", which posts nothing.
 */
type StatusBoxProps = Omit<BoxProps, "event"> & ({ event: null; notice?: never } | { event: EditableEvent; notice: StatusNotice });

/**
 * "Starea evenimentului" (§350, §358, §406) — a box of its own among the cards that are not a
 * section of the page, at the end of both pages (§406: the editor is the page, in its order, and a
 * scheduled event's status is drawn nowhere; a cancelled or finished one is a notice over the
 * title, which the status box still says on its closed line). It was card 1.1 inside "Ce fel de
 * eveniment" (§358); it moved whole — its fields, its names, its id — and, as one of the five boxes
 * whose change reaches people, it wears the amber outline (the count is said once, under the page
 * map, §408).
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
 *
 * For a role that may only read the settings, the box is its heading and its line — the status,
 * and the amber outline when people are registered — and nothing to open: the type's box says that
 * the settings are not theirs (§358).
 */
export default async function StatusBox({ event, mayEditSettings, risk, notice, heading }: StatusBoxProps) {
  const t = await getTranslations("Admin");
  const card = {
    id: "box-status",
    title: heading ?? t("editor.boxes.status.title"),
    aside: EVENT_STATUS_LABEL[event?.eventStatus ?? "SCHEDULED"],
    tone: risk ? "risk" : "default",
  } as const;
  if (!mayEditSettings) return <Panel {...card} />;

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
