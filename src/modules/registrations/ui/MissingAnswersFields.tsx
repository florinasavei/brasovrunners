import ContactPageIcon from "@mui/icons-material/ContactPage";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/routing";
import { HOME_COUNTRY } from "@/modules/events/domain/place";
import { countryOptions } from "@/modules/registrations/countries";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import { SHIRT_SIZES } from "@/modules/registrations/domain/kit";
import { ANSWERS_ASKED_FIELD, COMPLETE_ANSWERS_ID, type MissingAnswer } from "@/modules/registrations/missing-answers";
import { countryName } from "@/modules/registrations/names";
import { phoneCountryLabels, phoneCountryOrder } from "@/modules/registrations/phone";
import BirthDateField from "@/modules/registrations/ui/BirthDateField";
import GuardianForMinor from "@/modules/registrations/ui/GuardianForMinor";
import NationalityField from "@/modules/registrations/ui/NationalityField";
import PhoneField from "@/modules/registrations/ui/PhoneField";
import SexField from "@/modules/registrations/ui/SexField";

export type MissingAnswersFieldsInput = {
  /** The boxes to draw (`missing-answers.ts#answersToAsk`), in the form's order. */
  fields: readonly MissingAnswer[];
  /** The guardian beside a missing birth date, shown when the date typed is a minor's (`GuardianForMinor`). */
  guardianIfMinor: boolean;
  locale: Locale;
  /** The birth date's bounds and the event's day and minimum age (`form-view.ts#birthDateBounds`). */
  birthDate: { earliest: string; latest: string; eventDay: string; minAge: number };
  /** When the row was written, an ISO instant: a minor's guardian is owed against it, as the server judges (§645). */
  minorOn: string;
  /** The boxes a refusal named, and which rule refused (§231, §321). */
  invalid: ReadonlySet<string>;
  refusal: { tooYoung: boolean; emergencySame: boolean };
  /** What the refused press typed (§142), or null. */
  draft: Readonly<Record<string, string>> | null;
  /** Prepended to each box's id, so a family's cards on one page never share one (§547). */
  idPrefix?: string;
  /** The heading — the person's own («Completează-ți datele»), or another person's on a family's page. */
  heading: string;
  /** The heading's level: a section of its own page, or a person's card. */
  headingLevel?: "h2" | "h3";
  /**
   * A refused press (§905): the summary at the top of the boxes — what was not recorded, a link to each box named,
   * and the rule's own sentence when one refused (a minor's date under a signed declaration, a name of record).
   */
  refused?: { note: string; sentences: readonly string[] } | null;
  /**
   * The name the club typed, drawn in the two name boxes for the person to check and correct before signing (§907,
   * `missing-answers.ts#asksNameCheck`): the declaration's page of a staff row not yet signed, and nowhere else. Null:
   * the name boxes are drawn only when the name is missing, empty, as every missing answer.
   */
  checkedName?: { firstName: string | null; lastName: string | null } | null;
};

/** A box's id on the page: what a refusal's links point at, and what the signature's island reads the name from (§907). */
export function answerBoxId(name: string, idPrefix = ""): string {
  return `f-${idPrefix}${name}`;
}

/**
 * **«Completează-ți datele» (§905)** — the answers a registration still owes, drawn with the public form's own
 * boxes, labels, bounds and browser checks (`registration-form.tsx`): the birth date typed day first with its
 * echo, the country pickers on Romania, the telephone with its country, the emergency contact who must be
 * somebody else, «Feminin» / «Masculin», the T-shirt with «Fără tricou», the guardian shown by a minor's date.
 * Only the missing ones; nothing already on the registration is asked again — but the name the club typed, on the
 * declaration's page of a staff row not yet signed (`checkedName`, §907): the form's own two name boxes, prefilled,
 * first, under the one line that says why it matters. Awaited, not mounted, like `registrationForm`, so the pages that
 * draw it stay one tree a synchronous renderer can draw.
 *
 * The boxes only — the caller owns the `<form>`: the declaration's, where they are saved with the signature, or
 * the manage page's own, with its save button.
 */
export async function missingAnswersFields(input: MissingAnswersFieldsInput): Promise<ReactNode> {
  const { fields, guardianIfMinor, locale, birthDate, minorOn, invalid, refusal, draft, idPrefix = "", heading, headingLevel = "h2", refused = null, checkedName = null } = input;
  if (fields.length === 0 && !guardianIfMinor) return null;
  const t = await getTranslations("Registration");
  const tc = await getTranslations("Registrations");
  const asks = (field: MissingAnswer) => fields.includes(field);
  // Every box this card draws, in order: what a refusal's links may point at.
  const drawn: MissingAnswer[] = guardianIfMinor ? [...fields, "guardianName"] : [...fields];
  const idOf = (name: string) => answerBoxId(name, idPrefix);
  // What the refused press typed (§142): named `prefill`, never `t…`, so the catalogue checker does not read it as a key.
  const prefill = (name: string, fallback?: string) => draft?.[name] ?? fallback;
  const box = (name: string, help?: string) => ({
    id: idOf(name),
    name,
    error: invalid.has(name),
    helperText: invalid.has(name) ? t("errors.field") : help,
    defaultValue: prefill(name),
  });
  /*
    A checked name box (§907): what the club typed, until a refused press — then what that press typed, as every
    box here (a draft keeps only what was not blank, so a box cleared comes back cleared).
  */
  const nameBox = (name: "firstName" | "lastName") => ({
    ...box(name),
    defaultValue: checkedName === null ? prefill(name) : draft !== null ? (draft[name] ?? "") : (checkedName[name] ?? ""),
  });
  // Anything beyond the name to complete: the intro says why the form asks it, after the name's own line (§907).
  const completesMore = guardianIfMinor || fields.some((field) => field !== "firstName" && field !== "lastName");
  const intro = (
    <Typography variant="body2" color="text.secondary" sx={checkedName === null ? { mb: 2 } : undefined}>
      {tc("complete.intro")}
    </Typography>
  );
  const minimumAge = { age: yearsPhrase(birthDate.minAge, locale) };
  const countries = asks("country") || asks("nationality") ? countryOptions(locale, (code) => countryName(code, locale)) : [];
  const countrySearchWords = {
    search: t("countrySearch.search"),
    noMatch: t("countrySearch.noMatch"),
    open: t("countrySearch.open"),
    close: t("countrySearch.close"),
  };
  const phoneOrder = phoneCountryOrder(locale);
  const phoneNames = phoneCountryLabels(locale);
  const guardianBox = (required: boolean) => (
    <TextField
      {...box("guardianName", t("guardianHelp"))}
      label={t("guardianName")}
      required={required}
      autoComplete="off"
      fullWidth
      slotProps={{ htmlInput: { maxLength: 200 } }}
    />
  );

  return (
    <Box
      component="section"
      id={idPrefix ? `${COMPLETE_ANSWERS_ID}-${idPrefix}` : COMPLETE_ANSWERS_ID}
      aria-label={heading}
      data-testid="complete-answers"
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
    >
      <input type="hidden" name={ANSWERS_ASKED_FIELD} value="1" />
      <Typography component={headingLevel} variant="h6" sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <ContactPageIcon aria-hidden="true" />
        {heading}
      </Typography>
      {/* The name checked comes first, under its own line; the intro then speaks of what is missing (§907). */}
      {checkedName === null && intro}
      {/* The refusal, where the redirect lands (§47's summary): focusable, announced, a link to each box it names. */}
      {refused && (
        <Alert severity="error" role="alert" tabIndex={-1} sx={{ mb: 2 }} data-testid="complete-answers-refused">
          <AlertTitle>{tc("complete.refusedTitle")}</AlertTitle>
          <Box>{refused.note}</Box>
          {refused.sentences.map((sentence) => (
            <Box key={sentence} sx={{ mt: 0.5 }}>
              {sentence}
            </Box>
          ))}
          {drawn.filter((field) => invalid.has(field)).map((field) => (
            <Box key={field} sx={{ mt: 0.5 }}>
              <MuiLink href={`#${idOf(field)}`}>{t(`fieldNames.${field}`)}</MuiLink>
            </Box>
          ))}
        </Alert>
      )}
      <Stack spacing={2} sx={checkedName !== null ? { mt: 1 } : undefined}>
        {/*
          The public form's own two name boxes. Checked (§907): prefilled with the club's typing, under the line that says
          what the name is for — the declaration is signed with it and the race number prints it.
        */}
        {checkedName !== null && (
          <Typography variant="body2" data-testid="complete-name-check">
            {tc("complete.nameCheck")}
          </Typography>
        )}
        {(asks("firstName") || asks("lastName")) && (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            {asks("firstName") && <TextField {...nameBox("firstName")} label={t("firstName")} required autoComplete="given-name" fullWidth />}
            {asks("lastName") && <TextField {...nameBox("lastName")} label={t("lastName")} required autoComplete="family-name" fullWidth />}
          </Stack>
        )}
        {checkedName !== null && completesMore && intro}
        {asks("birthDate") && (
          <BirthDateField
            id={idOf("birthDate")}
            name="birthDate"
            label={t("birthDate")}
            defaultValue={prefill("birthDate")}
            required
            autoComplete="bday"
            error={invalid.has("birthDate")}
            errorText={refusal.tooYoung ? t("errors.tooYoung", minimumAge) : t("errors.field")}
            min={birthDate.earliest}
            max={birthDate.latest}
            eventDay={birthDate.eventDay}
            locale={locale}
            echoTemplate={t("birthDateEcho", { date: "{date}", age: "{age}" })}
            placeholder={t("birthDatePlaceholder")}
            unreadable={t("birthDateUnreadable")}
            tooYoung={t("errors.tooYoung", minimumAge)}
          />
        )}
        {asks("country") && (
          <NationalityField {...box("country")} label={t("country")} defaultValue={prefill("country") || HOME_COUNTRY} countries={countries} words={countrySearchWords} />
        )}
        {asks("city") && <TextField {...box("city")} label={t("city")} required fullWidth autoComplete="address-level2" />}
        {asks("sex") && (
          <SexField
            {...box("sex", t("sexHelp"))}
            label={t("sex")}
            placeholder={t("sexChoose")}
            answers={{ FEMALE: t("sexOptions.FEMALE"), MALE: t("sexOptions.MALE") }}
          />
        )}
        {asks("nationality") && (
          <NationalityField
            {...box("nationality")}
            label={t("nationality")}
            defaultValue={prefill("nationality") || HOME_COUNTRY}
            countries={countries}
            words={countrySearchWords}
          />
        )}
        {asks("phone") && (
          <PhoneField
            invalidLabel={t("phoneInvalid")}
            tooShortLabel={t("phoneTooShort")}
            validLabel={t("phoneValid")}
            name="phone"
            draft={draft ? { country: draft.phoneCountry, national: draft.phone } : undefined}
            id={idOf("phone")}
            label={t("phone")}
            countryLabel={t("phoneCountry")}
            countryOrder={phoneOrder}
            countryNames={phoneNames}
            searchWords={countrySearchWords}
            required
            autoComplete="tel-national"
            error={invalid.has("phone")}
            helperText={invalid.has("phone") ? t("errors.phone") : t("phoneHelp")}
          />
        )}
        {asks("emergencyContactName") && (
          <TextField {...box("emergencyContactName", t("emergencyContactHelp"))} label={t("emergencyContactName")} required fullWidth autoComplete="off" />
        )}
        {asks("emergencyContactPhone") && (
          <PhoneField
            invalidLabel={t("phoneInvalid")}
            tooShortLabel={t("phoneTooShort")}
            validLabel={t("phoneValid")}
            name="emergencyContactPhone"
            draft={draft ? { country: draft.emergencyContactPhoneCountry, national: draft.emergencyContactPhone } : undefined}
            id={idOf("emergencyContactPhone")}
            label={t("emergencyContactPhone")}
            countryLabel={t("phoneCountry")}
            countryOrder={phoneOrder}
            countryNames={phoneNames}
            searchWords={countrySearchWords}
            required
            autoComplete="off"
            // The contact must be somebody else (§228): said as it is typed, when the person's own box is here too.
            mustDifferFromName={asks("phone") ? "phone" : undefined}
            mustDifferLabel={t("errors.emergencySame")}
            error={invalid.has("emergencyContactPhone")}
            helperText={invalid.has("emergencyContactPhone") ? (refusal.emergencySame ? t("errors.emergencySame") : t("errors.phone")) : undefined}
          />
        )}
        {asks("tshirtSize") && (
          <TextField {...box("tshirtSize")} label={t("tshirtSize")} select required defaultValue={prefill("tshirtSize", "NONE")}>
            <MenuItem value="NONE">{t("tshirtSizes.NONE")}</MenuItem>
            {SHIRT_SIZES.map((size) => (
              <MenuItem key={size} value={size}>
                {size}
              </MenuItem>
            ))}
          </TextField>
        )}
        {/* A minor's registration names a parent or guardian (§108): asked outright when the birth date on the row is a minor's… */}
        {asks("guardianName") && guardianBox(true)}
        {/* …and beside a missing birth date, shown by the date typed — the form's own island, on the server's day (§645). */}
        {guardianIfMinor && (
          <GuardianForMinor birthDateId={idOf("birthDate")} forceOpen={invalid.has("guardianName")} minorOn={minorOn}>
            {guardianBox(false)}
          </GuardianForMinor>
        )}
      </Stack>
    </Box>
  );
}
