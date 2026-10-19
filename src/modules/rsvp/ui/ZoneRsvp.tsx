import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { answerAsMemberAction, leaveAsMemberAction } from "@/app/[locale]/members-area/runs/actions";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import CheckboxField from "@/shared/ui/CheckboxField";
import SubmitButton from "@/shared/ui/SubmitButton";
import { zoneRsvpAnchor } from "../domain/zone-outcome";

/**
 * «Vin!» in the members' zone (§NNN; the owner, 2026-10-18: «I want the flow to be super easy, also later to integrate with the member
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
 */
export type ZoneRsvpProps = {
  locale: Locale;
  eventId: string;
  /** This account has a confirmed answer (`answeredByAccount`). */
  going: boolean;
  /** Confirmed answers, this account's included (0: «Fii primul care spune că vine.»). */
  count: number;
  /** The name the account would show (`accountPublicName`), or null: then there is nothing to tick. */
  publicName: string | null;
};

export default async function ZoneRsvp({ locale, eventId, going, count, publicName }: ZoneRsvpProps) {
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
          <form action={leaveAsMemberAction}>
            {hidden}
            <SubmitButton label={t("rsvp.cancel")} pendingLabel={t("rsvp.submitting")} variant="outlined">
              <EventBusyIcon />
            </SubmitButton>
          </form>
        </>
      ) : (
        <form action={answerAsMemberAction}>
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
