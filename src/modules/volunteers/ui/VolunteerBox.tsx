import ChecklistIcon from "@mui/icons-material/Checklist";
import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import FormHelperText from "@mui/material/FormHelperText";
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
import SexField from "@/modules/registrations/ui/SexField";
import { SHIRT_SIZES } from "@/modules/registrations/domain/kit";
import CheckboxField from "@/shared/ui/CheckboxField";
import { DISCLOSURE_OPEN_ARROW, DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_INLINE_SX } from "@/shared/ui/disclosure";
import LegalLink from "@/shared/ui/LegalLink";
import SubmitButton from "@/shared/ui/SubmitButton";
import { CLUB_NAME } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import { VOLUNTEER_AGE_MAX, VOLUNTEER_CITY_MAX, VOLUNTEER_MESSAGE_MAX, VOLUNTEER_MINIMUM_AGE, VOLUNTEER_NAME_MAX } from "../domain/volunteer";
import RoleDescription from "./RoleDescription";
import type { PublicVolunteerRole } from "../volunteers";
import { VOLUNTEER_BOX_ID, type VolunteerBox as BoxName, type VolunteerOutcome, type VolunteerTyped } from "./volunteer-box";

/**
 * «Vreau să fiu voluntar» on an event's page (§754; the owner, 2026-10-13: «I want to register volunteers
 * for a race»): a fold with one plain form — «Ce ești dispus(ă) să faci», one box per role that still needs
 * people, as many ticked as the person would do (§761; the owner, 2026-10-14: «poate bifa mai multe atribuțiuni
 * din ce e dispus să facă»), the name, the address, the telephone number, an optional message, the consent tick
 * that names the privacy notice, and — since §758 — the tick that accepts the volunteer agreement in force and the
 * one that says the person is of age. The organizers then give the person one role.
 *
 * A Server Component around a Server Action, like the «Anunță-mă» box beside it: it works with scripts
 * off (a native `<details>` and native checkboxes; the only islands are the telephone box and the
 * anti-bot widget, both with a no-script fallback of their own), the honeypot and the rendering time ride
 * along as hidden fields, Turnstile shows when the club switched it on, and the answer comes back as a
 * sentence after a redirect — the same one for a new person and for a repeat (BR-REQ-031-01 criterion 3).
 *
 * The page draws this only while the three conditions hold (`volunteerOfferClosedFor`): the event takes
 * volunteers, a role still needs people, and the privacy notice in force describes them. The action asks
 * again.
 *
 * What the person says about themselves (§NNN; the owner, 2026-10-14): while the notice in force names it (`profile`),
 * the form asks «Vârsta» (the registration's own number-in-years habit, at least 18 — the tick «Am cel puțin 18 ani» is
 * gone, the age answers it), «Sex» (the registration form's own `SexField`, its words), «Orașul» (its city box's words),
 * the optional ticks «Am mai fost voluntar în trecut la alte curse» and «Fac parte din grupul {club}» (the club's name
 * from `CLUB_NAME`, as the registration form's member tick draws it — the person's claim, checked against nothing) and,
 * only while the event gives T-shirts (`shirts`), «Mărimea tricoului» — the kit's sizes. While it does not, the form is
 * §758's, with its tick. Each role's description is its document, under its tick (`RoleDescription`).
 */
export default async function VolunteerBox({
  locale,
  slug,
  roles,
  shirts,
  profile,
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
  /** «Oferim tricouri voluntarilor» is on for this event (§NNN): the form asks «Mărimea tricoului». */
  shirts: boolean;
  /** The notice in force names what a volunteer says about themselves (§NNN): the form asks it — else §758's tick «Am cel puțin 18 ani». */
  profile: boolean;
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
  const roleDoc = (role: PublicVolunteerRole) => (locale === "en" ? role.descriptionEnJson : role.descriptionRoJson);
  const roleWords = (role: PublicVolunteerRole) => (locale === "en" ? role.descriptionEn : role.descriptionRo);
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
  // The roles ticked before a refusal (§142), still offered: a role that filled meanwhile is simply not drawn.
  const ticked = new Set((typed.roleIds ?? "").split(",").filter((id) => roles.some((role) => role.id === id)));
  // «Vârsta» says one of two sentences after a refusal: a number below the minimum is «cel puțin 18 ani», anything else is «scrie vârsta».
  const typedAge = Number((typed.age ?? "").trim());
  const ageSentence = /^\d{1,3}$/.test((typed.age ?? "").trim()) && typedAge < VOLUNTEER_MINIMUM_AGE ? "ageMinimum" : "age";
  /** A refusal's sentence for one box, in the form's own words (§758's `{age}` is the minimum's phrase). */
  const refusal = (name: BoxName) => t(`volunteers.errors.${name === "age" ? ageSentence : name}`, { age });

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
                        {/* `{age}` is the minimum's phrase (§758); the other sentences take none and ignore it. */}
                        <a href={`#${fieldId(name)}`}>{refusal(name)}</a>
                      </li>
                    ))}
                  </Box>
                )}
              </Alert>
            )}

            {/*
              «Ce ești dispus(ă) să faci» (§761): one box per role that still needs people — its name, what it asks and
              how many it still needs, in plain words — ticked as many as the person would do. Native checkboxes
              posting one name (`roleIds`) with several values, so it works with scripts off; at least one is the
              service's rule, said at the group after a refused post (and in the summary above, linking here).
            */}
            <Box
              component="fieldset"
              id={fieldId("roleIds")}
              aria-describedby={[`${fieldId("roleIds")}-help`, invalid.has("roleIds") ? `${fieldId("roleIds")}-error` : null].filter(Boolean).join(" ")}
              sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}
              data-testid="volunteer-roles"
            >
              <Typography component="legend" sx={{ fontWeight: 600, p: 0 }}>
                <ChecklistIcon aria-hidden sx={FOLD_GLYPH_INLINE_SX} />
                {t("volunteers.choices")}
                <span aria-hidden="true">{" *"}</span>
              </Typography>
              <Typography id={`${fieldId("roleIds")}-help`} variant="body2" color="text.secondary">
                {t("volunteers.choicesHelp")}
              </Typography>
              {invalid.has("roleIds") && (
                <FormHelperText id={`${fieldId("roleIds")}-error`} error data-testid="volunteer-roles-error" sx={{ mx: 0 }}>
                  {t("volunteers.errors.roleIds")}
                </FormHelperText>
              )}
              <Stack sx={{ mt: 0.5 }}>
                {roles.map((role) => (
                  <Box key={role.id} data-testid="volunteer-role-option">
                    <CheckboxField name="roleIds" value={role.id} id={`volunteer-role-${role.id}`} defaultChecked={ticked.has(role.id)} help={needs(role)}>
                      <Box component="span" sx={{ fontWeight: 600 }}>
                        {roleName(role)}
                      </Box>
                    </CheckboxField>
                    {/* «Descrierea rolului» (§NNN): the editor's document under the tick, folded «Detalii» past about three lines. */}
                    <RoleDescription doc={roleDoc(role)} words={roleWords(role)} detailsLabel={t("volunteers.details")} />
                  </Box>
                ))}
              </Stack>
            </Box>

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

            {profile && (
              <Stack spacing={2} data-testid="volunteer-profile">
                {/* «Vârsta» and «Sex» (§NNN): the age in whole years — at least the platform's minimum, so the tick «Am cel puțin 18 ani» is gone — and the registration form's own sex box. */}
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField
                    id={fieldId("age")}
                    name="age"
                    label={t("volunteers.profile.age")}
                    helperText={invalid.has("age") ? refusal("age") : t("volunteers.profile.ageHelp", { age })}
                    required
                    fullWidth
                    autoComplete="off"
                    defaultValue={typed.age}
                    error={invalid.has("age")}
                    slotProps={{ htmlInput: { inputMode: "numeric", pattern: "[0-9]*", maxLength: String(VOLUNTEER_AGE_MAX).length } }}
                  />
                  <SexField
                    id={fieldId("sex")}
                    name="sex"
                    label={tForm("sex")}
                    placeholder={tForm("sexChoose")}
                    answers={{ FEMALE: tForm("sexOptions.FEMALE"), MALE: tForm("sexOptions.MALE") }}
                    defaultValue={typed.sex}
                    error={invalid.has("sex")}
                    helperText={invalid.has("sex") ? t("volunteers.errors.sex") : undefined}
                  />
                </Stack>
                <TextField
                  id={fieldId("city")}
                  name="city"
                  label={t("volunteers.profile.city")}
                  required
                  fullWidth
                  autoComplete="address-level2"
                  defaultValue={typed.city}
                  error={invalid.has("city")}
                  helperText={invalid.has("city") ? t("volunteers.errors.city") : undefined}
                  slotProps={{ htmlInput: { maxLength: VOLUNTEER_CITY_MAX } }}
                />
                {/* «Mărimea tricoului» (§NNN), only while the event gives T-shirts — the kit's own sizes, «Fără tricou» first. */}
                {shirts && (
                  <TextField
                    id={fieldId("shirtSize")}
                    name="shirtSize"
                    label={t("volunteers.profile.shirt")}
                    select
                    fullWidth
                    defaultValue={typed.shirtSize ?? ""}
                    error={invalid.has("shirtSize")}
                    helperText={invalid.has("shirtSize") ? t("volunteers.errors.shirtSize") : t("volunteers.profile.shirtHelp")}
                    slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                    data-testid="volunteer-shirt"
                  >
                    <option value="">{tForm("tshirtSizes.NONE")}</option>
                    {SHIRT_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </TextField>
                )}
                {/* Two optional ticks (§NNN): unticked is «nu», not an unanswered question; the club's group is the person's own claim, like the registration form's. */}
                <Box>
                  <CheckboxField name="volunteeredBefore" id={fieldId("volunteeredBefore")} defaultChecked={typed.volunteeredBefore === "on"}>
                    {t("volunteers.profile.before")}
                  </CheckboxField>
                  <CheckboxField name="clubMember" id={fieldId("clubMember")} defaultChecked={typed.clubMember === "on"}>
                    {t("volunteers.profile.club", { club: CLUB_NAME })}
                  </CheckboxField>
                </Box>
              </Stack>
            )}

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
              The volunteer agreement (§758): the person's acceptance of the text in force, linked in a new tab like the
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
            {/* §758's tick, only while the notice does not name what a volunteer says about themselves: with the age asked, the age answers it (§NNN). */}
            {!profile && (
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
            )}

            <SubmitButton label={t("volunteers.submit")} pendingLabel={t("volunteers.submitting")} size="large">
              <VolunteerActivismIcon />
            </SubmitButton>
          </Stack>
        )}
      </Box>
    </Box>
  );
}
