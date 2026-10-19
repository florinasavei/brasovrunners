import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import SaveIcon from "@mui/icons-material/Save";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { answerAsMemberAction, leaveAsMemberAction, setNameAsMemberAction } from "@/app/[locale]/members-area/runs/actions";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import CheckboxField from "@/shared/ui/CheckboxField";
import SubmitButton from "@/shared/ui/SubmitButton";
import type { ClubMemberKind } from "../domain/public-member";
import { zoneRsvpAnchor } from "../domain/zone-outcome";

/**
 * «Vin!» in the members' zone (§822; the owner, 2026-10-18: «I want the flow to be super easy, also later to integrate with the member
 * zone») — one row under a run in «Alergări» that takes answers: «N vin», and for the signed-in account one press, «Vin!», or, once it
 * has answered, «Tu vii ✓» with «Nu mai vin». No form to fill: the account is the address and the name.
 *
 * A Server Component with plain props (the page decides whether the run is offered — `readPublicComing`, the one gate — and reads
 * whether this account answered, live). It reuses the event page's own words (`Event.rsvp.*`: the button, the tick, «Tu vii», «Nu mai vin»,
 * the count's plural) so the two surfaces say the same thing, and the house's submit button with a glyph before its words.
 *
 * **The name is the person's own tick, off by default** (§143, §396, §812): «Vreau să apar cu numele» sits beside «Vin!» with the name it
 * would show underneath, and only while the account has a name to show. Unticked, the answer is counted and never named. The tick is
 * read again by the service against the notice in force, so the zone cannot publish a name the page would not.
 *
 * **Once «Tu vii ✓», the same tick stays** (§827, amending §812; the owner, 2026-10-19: «oamenii să poată ușor să zică „afișează / ascunde"
 * numele meu public»): «Numele meu apare la „Cine vine"», drawn from the answer's own `showName`, in its own small form with «Salvează» — a real
 * tick box, saved by one press, working without JavaScript. When neither the answer nor the account holds a name, a «Numele tău» box stands
 * with it. The account's name is used only when ticked (`setNameAsMemberAction`).
 *
 * **«Membru» is a fact here, not a tick** (§829; the owner, 2026-10-19: «organizatorii și administratorii sunt peste membri»): an answer an account made
 * from this page holds the mark `ACCOUNT`, set by the server from the account's role (every role of the club's accounts is at least a member), so the row says
 * «Membru» beside «Tu vii ✓» and offers nothing to tick — the mark «BVR» then stands beside the name the person chose to show on «Cine vine».
 *
 * **A name the person was not shown is never published** (§827, §812): when the answer holds a name — one a stranger may have typed on the
 * page with the tick off — the box «Numele tău» stands prefilled with it, editable, and the help says «Apari ca „…”»; the press posts what
 * the box holds. Only when the answer holds none is the account's own name the fallback, named in the help beside the tick.
 */
export type ZoneRsvpProps = {
  locale: Locale;
  eventId: string;
  /** The id of the run's title link (`zoneRsvpTitleId`): it names the row's forms for a screen reader. */
  titleId: string;
  /** This account has a confirmed answer (`answeredByAccount`). */
  going: boolean;
  /** Confirmed answers, this account's included (0: «Fii primul care spune că vine.»). */
  count: number;
  /** The name the account would show (`accountPublicName`), or null: then there is nothing to tick. */
  publicName: string | null;
  /** The answer's own tick «Numele meu apare la „Cine vine"» as it stands (the tick and a name), and the name the row holds (`answeredByAccount`). Only read while `going`. */
  showName: boolean;
  name: string | null;
  /** The member mark the answer holds (`answeredByAccount`, §829): `ACCOUNT` is drawn as the fact «Membru»; only read while `going`. */
  clubMember?: ClubMemberKind | null;
};

export default async function ZoneRsvp({ locale, eventId, titleId, going, count, publicName, showName, name, clubMember = null }: ZoneRsvpProps) {
  const t = await getTranslations("Event");
  const tZone = await getTranslations("Members");
  const hidden = (
    <>
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId} />
    </>
  );

  return (
    <Box
      id={zoneRsvpAnchor(eventId)}
      data-testid="zone-rsvp"
      data-going={going ? "true" : "false"}
      sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5, mt: 0.5, mb: 1.5, scrollMarginTop: 16 }}
    >
      {count >= 1 ? (
        <Box data-testid="zone-rsvp-count">
          <GlyphChip glyph="coming" label={t(`rsvp.chip.${countForm(count, locale)}`, { count })} variant="outlined" />
        </Box>
      ) : (
        !going && (
          <Typography variant="body2" color="text.secondary" data-testid="zone-rsvp-empty">
            {t("rsvp.countEmpty")}
          </Typography>
        )
      )}

      {going ? (
        <>
          {/* The tick is beside the words, never alone: state is not a glyph by itself. */}
          <Typography component="span" data-testid="zone-rsvp-going" sx={{ fontWeight: 700 }}>
            {`${t("rsvp.going")} ✓`}
          </Typography>
          {clubMember === "ACCOUNT" && (
            <Box data-testid="zone-rsvp-member">
              <GlyphChip glyph="membersOnly" label={t("rsvp.memberFact")} variant="outlined" color="primary" tooltip={t("rsvp.memberFactHelp")} />
            </Box>
          )}
          <form action={leaveAsMemberAction} aria-labelledby={titleId}>
            {hidden}
            <SubmitButton label={t("rsvp.cancel")} pendingLabel={t("rsvp.submitting")} variant="outlined">
              <EventBusyIcon />
            </SubmitButton>
          </form>
          {/* The name tick (§827): the box prefilled with the name the answer holds (shown, editable, posted), or blank when no name is anywhere; the help says which name the tick shows. */}
          <form action={setNameAsMemberAction} aria-labelledby={titleId} data-testid="zone-rsvp-name" style={{ flexBasis: "100%" }}>
            {hidden}
            <Stack spacing={1}>
              <CheckboxField name="showName" defaultChecked={showName} help={name !== null ? t("rsvp.nameKept", { name }) : publicName !== null ? tZone("rsvp.nameHelp", { name: publicName }) : t("rsvp.nameAsk")}>
                {t("rsvp.nameSwitch")}
              </CheckboxField>
              {(name !== null || publicName === null) && <TextField name="name" label={t("rsvp.nameBox")} defaultValue={name ?? ""} autoComplete="name" slotProps={{ htmlInput: { maxLength: 80 } }} sx={{ maxWidth: 360 }} />}
              <Box>
                <SubmitButton label={t("rsvp.nameSave")} pendingLabel={t("rsvp.submitting")} variant="outlined">
                  <SaveIcon />
                </SubmitButton>
              </Box>
            </Stack>
          </form>
        </>
      ) : (
        <form action={answerAsMemberAction} aria-labelledby={titleId}>
          {hidden}
          <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center" }}>
            <SubmitButton label={t("rsvp.submit")} pendingLabel={t("rsvp.submitting")}>
              <EventAvailableIcon />
            </SubmitButton>
            {publicName !== null && (
              <CheckboxField name="showName" help={tZone("rsvp.nameHelp", { name: publicName })}>
                {t("rsvp.showName")}
              </CheckboxField>
            )}
          </Stack>
        </form>
      )}
    </Box>
  );
}
