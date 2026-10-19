import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { switchVolunteersAccessAction } from "@/app/[locale]/admin/events/[id]/volunteer-actions";
import type { Locale } from "@/i18n/routing";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import RadioField from "@/shared/ui/RadioField";
import { VOLUNTEERS_ACCESS, type VolunteersAccess } from "../domain/access";

/**
 * «Cine se poate oferi» (§NNN, amending §754 and §768; the owner, 2026-10-19: «invite only volunteer … Brașov Runners only
 * volunteers»): the three ways a person may offer for this event, as native radios in a named card — a choice is a radio group,
 * never a button that flips (`RadioField`, the editor's «Clubul pe lista publică» is the model) — with one help line under each and
 * its own «Salvează». A plain form posting to a Server Action, so it works with scripts off, like the card's ticks beside it; the
 * service asserts the role again (BR-REQ-060-01) and changing the choice later deletes no sign-up and no invitation.
 *
 * Drawn only while «Primește voluntari» is on: the choice means nothing for an event that takes none, and the card draws it
 * under the tick it qualifies. The tick is a submit of its own, so the card cannot hide this box live; it decides when it renders.
 */
export default async function VolunteerAccessChoice({ locale, eventId, access }: { locale: Locale; eventId: string; access: VolunteersAccess }) {
  const t = await getTranslations("Admin");
  return (
    <Box component="form" action={switchVolunteersAccessAction} data-testid="volunteer-access-form">
      <input type="hidden" name="uiLocale" value={locale} />
      <input type="hidden" name="eventId" value={eventId} />
      <Panel level={4} static glyph="members" title={t("volunteers.access.title")} data-testid="volunteer-access">
        <Box role="radiogroup" aria-label={t("volunteers.access.title")} data-testid="volunteer-access-choices">
          {VOLUNTEERS_ACCESS.map((choice) => (
            <Box key={choice} sx={{ mb: 0.5 }}>
              <RadioField name="access" value={choice} defaultChecked={access === choice}>
                {t(`volunteers.access.${choice}`)}
              </RadioField>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", pl: 6.5 }} data-testid={`volunteer-access-help-${choice}`}>
                {t(`volunteers.access.${choice}Help`)}
              </Typography>
            </Box>
          ))}
        </Box>
        <Box sx={{ mt: 1.5 }}>
          <GlyphSubmitButton icon="save" label={t("volunteers.access.save")} pendingLabel={t("volunteers.access.saving")} />
        </Box>
      </Panel>
    </Box>
  );
}
