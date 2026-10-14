import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { submitVolunteerAction } from "@/app/[locale]/events/[slug]/actions";
import { countForm } from "@/i18n/count-form";
import type { Locale } from "@/i18n/routing";
import { BOT_CHECK_SLOT_SX } from "@/modules/registrations/domain/turnstile-widget";
import { phoneCountryLabels, phoneCountryOrder } from "@/modules/registrations/phone";
import { turnstileSiteKey } from "@/modules/registrations/turnstile";
import BotCheck from "@/modules/registrations/ui/BotCheck";
import PhoneField from "@/modules/registrations/ui/PhoneField";
import CheckboxField from "@/shared/ui/CheckboxField";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_INLINE_SX } from "@/shared/ui/disclosure";
import LegalLink from "@/shared/ui/LegalLink";
import SubmitButton from "@/shared/ui/SubmitButton";
import { DENSITY } from "@/theme/density";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import { VOLUNTEER_MESSAGE_MAX, VOLUNTEER_MINIMUM_AGE, VOLUNTEER_NAME_MAX } from "../domain/volunteer";
import type { PublicVolunteerRole } from "../volunteers";
import { VOLUNTEER_BOX_ID, type VolunteerBox as BoxName, type VolunteerOutcome, type VolunteerTyped } from "./volunteer-box";

/**
 * «Vreau să fiu voluntar» on an event's page (§754; the owner, 2026-10-13: «I want to register volunteers
 * for a race»): a fold with the roles that still need people, and one plain form — the name, the address, the
 * telephone number, the role, an optional message, the consent tick that names the privacy notice, and — since
 * §NNN — the tick that accepts the volunteer agreement in force and the one that says the person is of age.
 *
 * A Server Component around a Server Action, like the «Anunță-mă» box beside it: it works with scripts
 * off (a native `<details>` and a native `<select>`; the only islands are the telephone box and the
 * anti-bot widget, both with a no-script fallback of their own), the honeypot and the rendering time ride
 * along as hidden fields, Turnstile shows when the club switched it on, and the answer comes back as a
 * sentence after a redirect — the same one for a new person and for a repeat (BR-REQ-031-01 criterion 3).
 *
 * The page draws this only while the three conditions hold (`volunteerOfferClosedFor`): the event takes
 * volunteers, a role still needs people, and the privacy notice in force describes them. The action asks
 * again.
 */
export default async function VolunteerBox({
  locale,
  slug,
  roles,
  outcome,
  refused,
  typed,
  renderedAt,
  attempt,
}: {
  locale: Locale;
  slug: string;
  /** Only the roles that still need people, in the club's order. */
  roles: readonly PublicVolunteerRole[];
  outcome: VolunteerOutcome | null;
  /** The boxes a refusal named (`?vfields=`). */
  refused: readonly BoxName[];
  /** What was typed before a refusal, from the sealed draft (§142). */
  typed: VolunteerTyped;
  /** When this form was rendered — or, on a corrected one, when the one it corrects was (§146's `since`). */
  renderedAt: Date;
  /** This render's own time: Turnstile resets on it, so a refusal never posts the spent token again (§185). */
  attempt: string;
}) {
  const t = await getTranslations("Event");
  const tForm = await getTranslations("Registration");
  const siteKey = turnstileSiteKey();
  const invalid = new Set<BoxName>(refused);
  const roleName = (role: PublicVolunteerRole) => (locale === "en" ? role.nameEn : role.nameRo);
  const roleDescription = (role: PublicVolunteerRole) => (locale === "en" ? role.descriptionEn : role.descriptionRo);
  const needs = (role: PublicVolunteerRole) => t(`volunteers.needs.${countForm(role.free, locale)}`, { count: role.free });
  const countrySearchWords = {
    search: tForm("countrySearch.search"),
    noMatch: tForm("countrySearch.noMatch"),
    open: tForm("countrySearch.open"),
    close: tForm("countrySearch.close"),
  };
  const fieldId = (name: string) => `volunteer-${name}`;
  // «18 ani» / «18 years», the unit in the words every age is said with (§440).
  const age = yearsPhrase(VOLUNTEER_MINIMUM_AGE, locale);

  return (
    <Box id={VOLUNTEER_BOX_ID} component="section" aria-labelledby={`${VOLUNTEER_BOX_ID}-title`} data-testid="volunteer-box" sx={{ mt: { xs: DENSITY.sectionGap, sm: 4 }, scrollMarginTop: 16 }}>
      <Box
        component="details"
        // A person who has just answered, or is correcting a refusal, finds the box open.
        open={outcome !== null}
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          px: 2,
          "& > summary": { ...DISCLOSURE_SUMMARY_SX, py: 1.5 },
          ...DISCLOSURE_OPEN_ARROW,
          "&[open]": { pb: 2 },
        }}
      >
        <Box component="summary">
          <Typography component="h2" id={`${VOLUNTEER_BOX_ID}-title`} variant="h2" sx={{ fontSize: "1.25rem" }}>
            <VolunteerActivismIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
            {t("volunteers.title")}
          </Typography>
        </Box>

        {outcome === "done" ? (
          // The same sentence whether the person was new or already on the list (BR-REQ-031-01 criterion 3).
          <Alert severity="success" role="status" data-testid="volunteer-done" sx={{ mt: 1 }}>
            {t("volunteers.done")}
          </Alert>
        ) : roles.length === 0 ? (
          // Every role filled while the person typed: thanked, and no form with nothing to choose from.
          <Alert severity="info" role="status" data-testid="volunteer-all-full" sx={{ mt: 1 }}>
            {t("volunteers.allFull")}
          </Alert>
        ) : (
          <Stack component="form" action={submitVolunteerAction} spacing={2} data-testid="volunteer-form" sx={{ mt: 1, maxWidth: 560 }}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="slug" value={slug} />
            {/* Bots fill every field; a human never sees or fills this one. */}
            <input type="text" name="honeypot" autoComplete="off" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }} />
            <input type="hidden" name="renderedAt" value={renderedAt.toISOString()} />

            <Typography variant="body2" color="text.secondary">
              {t("volunteers.intro")}
            </Typography>

            {outcome && (
              <Alert severity={outcome === "full" ? "warning" : "error"} role="alert" data-testid={`volunteer-${outcome}`}>
                {t(`volunteers.${outcome}`)}
                {outcome === "invalid" && refused.length > 0 && (
                  <Box component="ul" sx={{ m: 0, pl: 3 }}>
                    {refused.map((name) => (
                      <li key={name}>
                        {/* `{age}` is the age box's own value (§NNN); the other sentences take none and ignore it. */}
                        <a href={`#${fieldId(name)}`}>{t(`volunteers.errors.${name}`, { age })}</a>
                      </li>
                    ))}
                  </Box>
                )}
              </Alert>
            )}

            {/* What each role is and how many it still needs — plain words, before the choice. */}
            <Box component="ul" aria-label={t("volunteers.rolesLabel")} sx={{ m: 0, pl: 2.5 }} data-testid="volunteer-roles">
              {roles.map((role) => (
                <Box component="li" key={role.id} sx={{ mb: 0.5 }}>
                  <Typography component="span" sx={{ fontWeight: 600 }}>
                    {roleName(role)}
                  </Typography>
                  {" — "}
                  <Typography component="span" variant="body2" color="text.secondary">
                    {[roleDescription(role), needs(role)].filter(Boolean).join(" · ")}
                  </Typography>
                </Box>
              ))}
            </Box>

            <TextField
              id={fieldId("roleId")}
              name="roleId"
              select
              required
              fullWidth
              label={t("volunteers.role")}
              defaultValue={typed.roleId && roles.some((role) => role.id === typed.roleId) ? typed.roleId : (roles[0]?.id ?? "")}
              error={invalid.has("roleId")}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {roleName(role)}
                </option>
              ))}
            </TextField>

            <TextField
              id={fieldId("name")}
              name="name"
              label={t("volunteers.name")}
              required
              fullWidth
              autoComplete="name"
              defaultValue={typed.name}
              error={invalid.has("name")}
              slotProps={{ htmlInput: { maxLength: VOLUNTEER_NAME_MAX } }}
            />
            <TextField
              id={fieldId("email")}
              name="email"
              type="email"
              label={t("volunteers.email")}
              helperText={t("volunteers.emailHelp")}
              required
              fullWidth
              autoComplete="email"
              defaultValue={typed.email}
              error={invalid.has("email")}
              slotProps={{ htmlInput: { maxLength: 320 } }}
            />

            {/* The country and the digits (§84): what is kept is one number a phone can dial. */}
            <PhoneField
              invalidLabel={tForm("phoneInvalid")}
              tooShortLabel={tForm("phoneTooShort")}
              validLabel={tForm("phoneValid")}
              name="phone"
              draft={typed.phone !== undefined || typed.phoneCountry !== undefined ? { country: typed.phoneCountry, national: typed.phone } : undefined}
              id={fieldId("phone")}
              label={tForm("phone")}
              countryLabel={tForm("phoneCountry")}
              countryOrder={phoneCountryOrder(locale)}
              countryNames={phoneCountryLabels(locale)}
              searchWords={countrySearchWords}
              required
              autoComplete="tel-national"
              error={invalid.has("phone")}
              helperText={invalid.has("phone") ? tForm("errors.phone") : t("volunteers.phoneHelp")}
            />

            <TextField
              id={fieldId("message")}
              name="message"
              label={t("volunteers.message")}
              helperText={t("volunteers.messageHelp", { max: VOLUNTEER_MESSAGE_MAX })}
              fullWidth
              multiline
              minRows={2}
              defaultValue={typed.message}
              error={invalid.has("message")}
              slotProps={{ htmlInput: { maxLength: VOLUNTEER_MESSAGE_MAX } }}
            />

            {siteKey && (
              <Box sx={BOT_CHECK_SLOT_SX}>
                <BotCheck siteKey={siteKey} locale={locale} attempt={attempt} notice />
              </Box>
            )}

            {/*
              The consent itself: one tick, the person's own act, naming the notice it rests on — the house's
              CheckboxField (the refusal said at the box, §616) and LegalLink (the notice in a new tab, so this
              form, which keeps nothing until it is sent, is still there when the reader comes back, §197).
            */}
            <Box data-testid="volunteer-consent">
              <CheckboxField
                name="consent"
                id={fieldId("consent")}
                required
                error={invalid.has("consent") ? t("volunteers.errors.consent") : undefined}
                requiredMessage={t("volunteers.errors.consent")}
              >
                {t("volunteers.consent")}{" "}
                <LegalLink href="/legal/privacy" newTabLabel={tForm("opensInNewTab")}>
                  {t("volunteers.privacyLinkLabel")}
                </LegalLink>
                .
              </CheckboxField>
            </Box>

            {/*
              The volunteer agreement (§NNN): the person's acceptance of the text in force, linked in a new tab like the
              notice — its blanks (the name, the role, the event) are filled in the copy the email carries — and the
              platform's age, eighteen (`VOLUNTEER_MINIMUM_AGE`). Both required; the service refuses either missing.
            */}
            <Box data-testid="volunteer-agreement">
              <CheckboxField
                name="agreement"
                id={fieldId("agreement")}
                required
                error={invalid.has("agreement") ? t("volunteers.errors.agreement") : undefined}
                requiredMessage={t("volunteers.errors.agreement")}
              >
                {t("volunteers.agreement")}{" "}
                <LegalLink href="/legal/volunteer-agreement" newTabLabel={tForm("opensInNewTab")}>
                  {t("volunteers.agreementLinkLabel")}
                </LegalLink>
                .
              </CheckboxField>
            </Box>
            <Box data-testid="volunteer-adult">
              <CheckboxField
                name="adult"
                id={fieldId("adult")}
                required
                error={invalid.has("adult") ? t("volunteers.errors.adult", { age }) : undefined}
                requiredMessage={t("volunteers.errors.adult", { age })}
              >
                {t("volunteers.adult", { age })}
              </CheckboxField>
            </Box>

            <SubmitButton label={t("volunteers.submit")} pendingLabel={t("volunteers.submitting")} size="large">
              <VolunteerActivismIcon />
            </SubmitButton>
          </Stack>
        )}
      </Box>
    </Box>
  );
}
