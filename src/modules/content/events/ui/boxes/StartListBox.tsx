import Box from "@mui/material/Box";
import { getTranslations } from "next-intl/server";
import { EVENT_TYPES, takesRegistrations } from "@/modules/events/domain/event-type";
import CheckboxField from "@/shared/ui/CheckboxField";
import Panel from "@/shared/ui/Panel";
import { startListSummary } from "../box-summaries";
import OnlyForMode from "../OnlyForMode";
import OnlyForType from "../OnlyForType";
import { BoxNote, type BoxProps, summaryWords } from "./box-kit";

/**
 * "Lista publică a participanților" (BR-REQ-039-01, §32, §512): the last card inside «Program,
 * regulament și declarație», id `#box-start-list`. Off unless deliberately turned on — a
 * disclosure, so the help says what it publishes. Only registration here has anyone to list
 * (§32, §111), so the checkbox follows type and mode: hidden, never removed, read-only while
 * hidden (`ShownWhen`), ignored by the service where hidden. Read-only roles see the heading
 * and line only (§358).
 */
export default async function StartListBox({ event, mayEditSettings }: Pick<BoxProps, "event" | "mayEditSettings">) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const initialType = event?.type ?? "GROUP_RUN";
  const initialMode = event?.registrationMode ?? "NONE";
  const card = {
    id: "box-start-list",
    glyph: "startList",
    level: 3,
    title: t("editor.boxes.startList.title"),
    aside: startListSummary(words, event?.participantListVisibility),
  } as const;
  if (!mayEditSettings) return <Panel {...card} />;
  return (
    <Panel collapsible {...card}>
      <>
        <OnlyForType type={EVENT_TYPES.filter(takesRegistrations)} selectName="event.type" initialType={initialType}>
          <OnlyForMode mode="INTERNAL" initialMode={initialMode}>
            <Box>
              <CheckboxField name="event.participantListVisibility" defaultChecked={event?.participantListVisibility === "NAMES"}>
                {t("editor.participantList")}
              </CheckboxField>
              <BoxNote more={t("editor.participantListHelpMore")}>{t("editor.participantListHelp")}</BoxNote>
            </Box>
          </OnlyForMode>
          <OnlyForMode mode={["NONE", "EXTERNAL"]} initialMode={initialMode}>
            <BoxNote testId="start-list-not-here">{t("editor.boxes.startList.onlyHere")}</BoxNote>
          </OnlyForMode>
        </OnlyForType>
        <OnlyForType type={EVENT_TYPES.filter((type) => !takesRegistrations(type))} selectName="event.type" initialType={initialType}>
          <BoxNote testId="start-list-not-registering">{t("editor.boxes.startList.onlyRegisteringTypes")}</BoxNote>
        </OnlyForType>
      </>
    </Panel>
  );
}
