import Stack from "@mui/material/Stack";
import { getLocale, getTranslations } from "next-intl/server";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import { EVENT_TYPES, takesRegistrations } from "@/modules/events/domain/event-type";
import { RETENTION_PERIODS } from "@/modules/jobs/domain/retention-periods";
import CheckboxField from "@/shared/ui/CheckboxField";
import Panel from "@/shared/ui/Panel";
import type { EditableEvent } from "../../repository";
import { healthNoteSummary } from "../box-summaries";
import OnlyForMode from "../OnlyForMode";
import OnlyForType from "../OnlyForType";
import { BoxNote, type BoxProps, summaryWords } from "./box-kit";

/**
 * Whether the event has a registration form on the site to ask the health note on (§111): a type
 * that takes registrations, registering on the site. The group below draws its tick by it, and
 * «Regulamentul»'s closed line says «Informații medicale: da/nu» only where it holds.
 */
export function asksHealthNoteOnForm(event: Pick<EditableEvent, "type" | "registrationMode"> | null): boolean {
  return takesRegistrations(event?.type ?? "GROUP_RUN") && (event?.registrationMode ?? "NONE") === "INTERNAL";
}

/**
 * «Condiții de participare», the group at the foot of «Regulamentul» (§557, moved in §NNN; the owner,
 * 2026-10-16, pointing from the closed card to the rules card beside the minimum age: «cardul ăsta ar
 * trebui mutat în ăsta»). It was a level-3 card of its own after the declaration; it is now a level-4
 * static `Panel` — the boxed frame with a heading and no fold, as «Clubul pe lista publică» is inside
 * the public list's card — under «Vârsta minimă de participare» and outside the language tabs, because
 * what it holds is a switch, not translated text. Everything it holds, and every name it posts, is
 * what the card held: one tick — «Informații medicale».
 *
 * Ticked, the registration form asks the optional health note (BR-REQ-031-05); unticked — the
 * default, every event before the column included — the form asks nothing medical and the server
 * stores no note. The same pattern as the kit's «Tricou» (§554): a marker posts with the tick, so
 * a form without the group writes nothing. Only a type that takes registrations, registering on
 * the site, has a form to ask it on (§111), so the tick follows the type and the mode as the public
 * list's does — hidden, never removed — and a sentence stands in its place otherwise.
 *
 * The help names the days the note is kept from the retention sweep's own constant, never typed.
 * For a role that may only read the settings, the group is its heading and its line (§542).
 */
export default async function ConditionsGroup({ event, mayEditSettings }: Pick<BoxProps, "event" | "mayEditSettings">) {
  const t = await getTranslations("Admin");
  const locale = await getLocale();
  const { words } = await summaryWords();
  const initialType = event?.type ?? "GROUP_RUN";
  const initialMode = event?.registrationMode ?? "NONE";
  const group = {
    glyph: "conditions",
    level: 4,
    static: true,
    title: t("editor.boxes.conditions.title"),
    "data-testid": "conditions-group",
  } as const;
  // A reader sees the heading and the line only where there is a form to ask it on (§111, §542).
  if (!mayEditSettings) return <Panel {...group} aside={asksHealthNoteOnForm(event) ? healthNoteSummary(words, event?.askHealthNote ?? false) : undefined} />;
  const days = durationPhrase(locale, RETENTION_PERIODS.identityAndHealthDaysAfterEvent, "days");
  return (
    <Panel {...group}>
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
