import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { updateClubIdentityAction } from "@/app/[locale]/admin/pages/contact/actions";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import type { ClubIdentityState } from "@/modules/contact/club-identity";
import {
  CLUB_IDENTITY_ITEMS,
  CLUB_IDENTITY_PLACES,
  CLUB_IDENTITY_SEAT_MAX,
  type ClubIdentityItem,
  showsAt,
} from "@/modules/contact/domain/club-identity";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import CheckboxField from "@/shared/ui/CheckboxField";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";

type Props = {
  locale: Locale;
  state: ClubIdentityState;
  /** Whether each line has a value: the legal name, the seat typed here, a shown contact address. */
  valueSet: Record<ClubIdentityItem, boolean>;
  /** Administrator only (§291, §450); the service refuses anybody else. */
  mayEdit: boolean;
  openWhen?: FoldOpenWhen;
};

/** The box's posted name for each line. */
const FIELD: Record<ClubIdentityItem, string> = { name: "showName", seat: "showSeat", email: "showEmail" };

/**
 * «Ce arată site-ul despre asociație» (§NNN): a grid of real tick boxes — a row per line (the name
 * and CIF, the seat, the email), a box per place (the listing, «Contact», «Echipa» and the club's
 * pages, the footer's fold) — the seat's own box, «Adresa afișată pe site», under its row, and one
 * «Salvează» for all of it behind the §384 confirmation. «Telefon public»'s shape (§565): a Server
 * Component, one form.
 */
export default async function ClubIdentityPanel({ locale, state, valueSet, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const count = (item: ClubIdentityItem) => (valueSet[item] ? state[item].length : 0);

  return (
    <Panel
      glyph="clubIdentity"
      title={t("emails.clubIdentity.title")}
      intro={t("emails.clubIdentity.intro")}
      aside={t("emails.clubIdentity.aside", { name: count("name"), seat: count("seat"), email: count("email"), all: CLUB_IDENTITY_PLACES.length })}
      collapsible
      openWhen={openWhen}
      id="club-identity"
      data-testid="club-identity-settings"
    >
      {state.updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("emails.clubIdentity.updatedAt", {
            when: formatDay(state.updatedAt, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      {!mayEdit ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t("emails.clubIdentity.readOnly")}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <ActionForm
            action={updateClubIdentityAction}
            messages={await refusalMessages({
              ...Object.fromEntries(CLUB_IDENTITY_ITEMS.map((item) => [item, t(`emails.clubIdentity.items.${item}`)])),
              seatAddress: t("emails.clubIdentity.seatAddress"),
            })}
            confirm={{
              title: t("confirm.clubIdentityTitle"),
              body: t("confirm.clubIdentityBody"),
              confirmLabel: t("emails.clubIdentity.save"),
              cancelLabel: words.cancel,
            }}
            scope="clubIdentity"
            data-testid="club-identity-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack spacing={2}>
              {CLUB_IDENTITY_ITEMS.map((item) => (
                <Box key={item} component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }} data-testid={`club-identity-row-${item}`}>
                  <Typography component="legend" variant="subtitle2" sx={{ p: 0 }}>
                    {t(`emails.clubIdentity.items.${item}`)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {valueSet[item] ? t(`emails.clubIdentity.help.${item}`) : t(`emails.clubIdentity.notSet.${item}`)}
                  </Typography>
                  {/* The four places as columns from `md`, so the rows line up as a grid; stacked on a phone. */}
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" }, columnGap: 2 }}>
                    {CLUB_IDENTITY_PLACES.map((place) => (
                      <CheckboxField key={place} name={FIELD[item]} value={place} defaultChecked={showsAt(state, item, place)}>
                        {t(`emails.clubIdentity.places.${place}`)}
                      </CheckboxField>
                    ))}
                  </Box>
                  {/* The seat the site prints: typed here, one value for both languages, never the configuration's (its flat). */}
                  {item === "seat" && (
                    <RecallField
                      name="seatAddress"
                      label={t("emails.clubIdentity.seatAddress")}
                      defaultValue={state.seatAddress ?? ""}
                      size="small"
                      fullWidth
                      helperText={t("emails.clubIdentity.seatAddressHelp")}
                      slotProps={{ htmlInput: { maxLength: CLUB_IDENTITY_SEAT_MAX, autoComplete: "off" } }}
                      sx={{ mt: 1, maxWidth: 560 }}
                    />
                  )}
                </Box>
              ))}
              <Box>
                <GlyphSubmitButton label={t("emails.clubIdentity.save")} pendingLabel={t("emails.clubIdentity.saving")} icon="save" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
