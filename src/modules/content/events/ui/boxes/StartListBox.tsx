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
 * "Lista publică a participanților" (BR-REQ-039-01, §32, §406): a level-3 card inside «Program,
 * regulament și declarație» since §NNN, after the declaration — the page draws the list last, under
 * the rules, so it is the last of that card's cards (it was card 8.5 inside "Participare și
 * înscrieri" until §406, then card 10 of its own; it moved whole each time: the same checkbox, the
 * same name, the same id `#box-start-list`, the same help).
 *
 * Off unless somebody deliberately turns it on: a disclosure, so the help says what it publishes.
 * Only an event that takes registrations here has anybody to list (§32 refuses `NAMES` for `NONE`
 * and `EXTERNAL`, and a group run takes none, §111), so the checkbox follows the type and the mode
 * as it did inside the registration box — hidden, never removed, read-only while hidden
 * (`ShownWhen`), ignored by the service where the mode hides it — and a sentence stands in its
 * place otherwise.
 *
 * For a role that may only read the settings, the card is its heading and its line and nothing to
 * open, as the declaration card beside it is: the type's box says once that the settings are not theirs (§358).
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
