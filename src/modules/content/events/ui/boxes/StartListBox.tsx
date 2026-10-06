import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { EVENT_TYPES, takesRegistrations } from "@/modules/events/domain/event-type";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import CheckboxField from "@/shared/ui/CheckboxField";
import IncognitoIcon from "@/shared/ui/IncognitoIcon";
import Panel from "@/shared/ui/Panel";
import { startListSummary } from "../box-summaries";
import OnlyForMode from "../OnlyForMode";
import OnlyForType from "../OnlyForType";
import OnlyWhenTicked from "../OnlyWhenTicked";
import { eventInputConstraints } from "../../constraints";
import { BoxNote, type BoxProps, summaryWords } from "./box-kit";

/**
 * "Lista publică a participanților" (BR-REQ-039-01, §32, §406): a level-3 card inside «Program,
 * regulament și declarație» since §512, after the declaration — the page draws the list last, under
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
    aside: startListSummary(words, event?.participantListVisibility, event?.waitlistPublic),
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
              {/*
                «Lista de așteptare e publică» (§628): a narrowing of the list above, so it sits under it,
                indented — the owner's "încă o setare". It adds a condition to the waiting-list rows and
                opens no gate of the privacy notice's; the service stores it off unless the list is on.
              */}
              <Box data-testid="waitlist-public" sx={{ mt: 1, pl: 3.5, borderLeft: 2, borderColor: "divider" }}>
                <CheckboxField name="event.waitlistPublic" defaultChecked={event?.participantListVisibility === "NAMES" && event?.waitlistPublic === true}>
                  {t("editor.waitlistPublic")}
                </CheckboxField>
                <BoxNote more={t("editor.waitlistPublicHelpMore")}>{t("editor.waitlistPublicHelp")}</BoxNote>
              </Box>
              {/*
                «Arată public numărătoarea» (§647, §668): every number on the event's public pages — the places
                line, the card's counts, «Cine vine»'s «(N)» — on every event, whatever the hidden list's switch
                says (the owner: «mai punem bifă pentru afișarea numărătorii»). It hides numbers, never a name,
                so it is not indented under the names switch. On by default; its own marker tells "unticked"
                from "a form without the box", which must change nothing.
              */}
              <Box data-testid="participant-count-public" sx={{ mt: 1 }}>
                <input type="hidden" name="event.participantCountPublic.present" value="1" />
                <CheckboxField name="event.participantCountPublic" defaultChecked={event?.participantCountPublic ?? true}>
                  {t("editor.participantCountPublic")}
                </CheckboxField>
                <BoxNote>{t("editor.participantCountPublicHelp")}</BoxNote>
                {/*
                  «Arată public câți așteaptă» (§634) under it (§NNN; the owner: "these 2 checkboxes need to be nested"):
                  the line's NUMBER is one of the numbers above, so with the parent unticked it is private
                  whatever this says (`waitlistCountShown`). Shown only while the parent is ticked, but kept in
                  the form — hidden, never removed — so its value and its marker still post and nothing a save
                  did not touch changes. On by default.
                */}
                <OnlyWhenTicked name="event.participantCountPublic" initiallyTicked={event?.participantCountPublic ?? true}>
                  <Box data-testid="waitlist-count-public" sx={{ mt: 1, pl: { xs: 1.5, sm: 3.5 }, borderLeft: 2, borderColor: "divider", minWidth: 0 }}>
                    <input type="hidden" name="event.waitlistCountPublic.present" value="1" />
                    <CheckboxField name="event.waitlistCountPublic" defaultChecked={event?.waitlistCountPublic ?? true}>
                      {t("editor.waitlistCountPublic")}
                    </CheckboxField>
                    <BoxNote>{t("editor.waitlistCountPublicHelp")}</BoxNote>
                  </Box>
                </OnlyWhenTicked>
              </Box>
              {/*
                «Lista ascunsă» (§647; the owner, 2026-10-02: «direct din setările evenimentului să pot avea
                „folosește lista ascunsă” dedicată pentru BIB-uri date pe invitații»): the switch that lets the
                registrations be put on the hidden list, and — shown only while it is ticked — the hidden list's
                own number series and «Numără și lista ascunsă». One marker for the three, so a
                form without the group edits none of them; the service validates them whatever this shows.
              */}
              <Box data-testid="hidden-list-settings" sx={{ mt: 2 }}>
                <Typography variant="subtitle2" component="h4" sx={{ mb: 0.5, display: "flex", alignItems: "center", gap: 0.75 }}>
                  <IncognitoIcon fontSize="small" aria-hidden />
                  {t("editor.hiddenListTitle")}
                </Typography>
                <input type="hidden" name="event.hiddenList.present" value="1" />
                <CheckboxField name="event.hiddenListEnabled" defaultChecked={event?.hiddenListEnabled ?? false}>
                  {t("editor.hiddenListEnabled")}
                </CheckboxField>
                {/*
                  «Lista de invitați speciali» (§649): the switch's sentence says what ticking shows and what
                  unticking keeps; its «?» says who the list is for, the two settings under it, and how it
                  differs from «Invitații» by email — one line each, each under 200 characters.
                */}
                <BoxNote
                  testId="hidden-list-enabled-help"
                  more={[t("editor.hiddenListEnabledMoreFor"), t("editor.hiddenListEnabledMoreSettings"), t("editor.hiddenListEnabledMoreEmail"), t("editor.hiddenListEnabledMoreDifference")].join("\n")}
                >
                  {t("editor.hiddenListEnabledHelp")}
                </BoxNote>
                <OnlyWhenTicked name="event.hiddenListEnabled" initiallyTicked={event?.hiddenListEnabled ?? false}>
                  <Box data-testid="hidden-list-details" sx={{ mt: 1, pl: { xs: 1.5, sm: 3.5 }, borderLeft: 2, borderColor: "divider", minWidth: 0 }}>
                    <RecallField
                      name="event.hiddenListBibStart"
                      label={t("editor.hiddenListBibStart")}
                      helperText={t("editor.hiddenListBibStartHelp")}
                      helpMore={t("editor.hiddenListBibStartHelpMore")}
                      defaultValue={event?.hiddenListBibStart ?? ""}
                      {...textFieldConstraints(eventInputConstraints("hiddenListBibStart"), { inputMode: "numeric" })}
                      sx={{ width: { xs: "100%", sm: 320 }, my: 1 }}
                    />
                    <CheckboxField name="event.hiddenListCounted" defaultChecked={event?.hiddenListCounted ?? false}>
                      {t("editor.hiddenListCounted")}
                    </CheckboxField>
                    <BoxNote>{t("editor.hiddenListCountedHelp")}</BoxNote>
                  </Box>
                </OnlyWhenTicked>
              </Box>
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
