import Stack from "@mui/material/Stack";
import { getLocale, getTranslations } from "next-intl/server";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import { EVENT_TYPES, takesRegistrations } from "@/modules/events/domain/event-type";
import { RETENTION_PERIODS } from "@/modules/jobs/domain/retention-periods";
import CheckboxField from "@/shared/ui/CheckboxField";
import Panel from "@/shared/ui/Panel";
import { healthNoteSummary } from "../box-summaries";
import OnlyForMode from "../OnlyForMode";
import OnlyForType from "../OnlyForType";
import { BoxNote, type BoxProps, summaryWords } from "./box-kit";

/**
 * «Condiții de participare» (§NNN; the owner, 2026-09-29: «trebuie să am o bifă și pentru acele
 * informații medicale, pentru că nu știu ce să fac cu ele, deci e mai bine să avem o bifă în
 * backoffice la Condiții de participare»): a level-3 card inside «Program, regulament și
 * declarație», after the declaration, holding one tick — «Informații medicale».
 *
 * Ticked, the registration form asks the optional health note (BR-REQ-031-05); unticked — the
 * default, every event before the column included — the form asks nothing medical and the server
 * stores no note. The same pattern as the kit's «Tricou» (§554): a marker posts with the tick, so
 * a form without the card writes nothing. Only a type that takes registrations, registering on
 * the site, has a form to ask it on (§111), so the tick follows the type and the mode as the public
 * list's does — hidden, never removed — and a sentence stands in its place otherwise.
 *
 * The help names the days the note is kept from the retention sweep's own constant, never typed.
 * For a role that may only read the settings, the card is its heading and its line (§542).
 */
export default async function ConditionsBox({ event, mayEditSettings }: Pick<BoxProps, "event" | "mayEditSettings">) {
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const { words } = await summaryWords();
  const initialType = event?.type ?? "GROUP_RUN";
  const initialMode = event?.registrationMode ?? "NONE";
  // The line only where there is a form to ask it on, as the outer card's line says it (§111).
  const asksOnForm = takesRegistrations(initialType) && initialMode === "INTERNAL";
  const card = {
    id: "box-conditions",
    glyph: "conditions",
    level: 3,
    title: t("editor.boxes.conditions.title"),
    aside: asksOnForm ? healthNoteSummary(words, event?.askHealthNote ?? false) : undefined,
  } as const;
  if (!mayEditSettings) return <Panel {...card} />;
  const days = durationPhrase(locale, RETENTION_PERIODS.identityAndHealthDaysAfterEvent, "days");
  return (
    <Panel collapsible {...card}>
      <>
        <OnlyForType type={EVENT_TYPES.filter(takesRegistrations)} selectName="event.type" initialType={initialType}>
          <OnlyForMode mode="INTERNAL" initialMode={initialMode}>
            <Stack spacing={1}>
              <input type="hidden" name="event.askHealthNote.present" value="1" />
              <CheckboxField name="event.askHealthNote" defaultChecked={event?.askHealthNote ?? false}>
                {t("editor.askHealthNote")}
              </CheckboxField>
              <BoxNote testId="ask-health-note-help">{t("editor.askHealthNoteHelp", { days })}</BoxNote>
            </Stack>
          </OnlyForMode>
          <OnlyForMode mode={["NONE", "EXTERNAL"]} initialMode={initialMode}>
            <BoxNote testId="conditions-not-here">{t("editor.boxes.conditions.onlyHere")}</BoxNote>
          </OnlyForMode>
        </OnlyForType>
        <OnlyForType type={EVENT_TYPES.filter((type) => !takesRegistrations(type))} selectName="event.type" initialType={initialType}>
          <BoxNote testId="conditions-not-registering">{t("editor.boxes.conditions.onlyRegisteringTypes")}</BoxNote>
        </OnlyForType>
      </>
    </Panel>
  );
}
