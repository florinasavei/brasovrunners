import FemaleIcon from "@mui/icons-material/Female";
import MaleIcon from "@mui/icons-material/Male";
import PersonIcon from "@mui/icons-material/Person";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import MuiLink from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import ReadAndAgree from "@/modules/registrations/ui/ReadAndAgree";
import { isRichTextEmpty, readRichText } from "@/modules/content/rich-text/domain/schema";
import { registrationState } from "@/modules/events/domain/registration-window";
import { confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { countryOptions } from "@/modules/registrations/countries";
import { readFormDraft } from "@/modules/registrations/form-draft";
import { ERROR_SUMMARY_ID, parseInvalidFields } from "@/modules/registrations/form-errors";
import { countryName } from "@/modules/registrations/names";
import RegistrationJourney from "@/modules/registrations/ui/RegistrationJourney";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import {
  OPTION_GLYPH_SX,
  OPTION_LABEL_SX,
  OPTION_ROW_SX,
  SELECT_WITH_GLYPHS_SX,
} from "@/shared/ui/select-option";
import CheckboxField from "@/shared/ui/CheckboxField";
import GuardianForMinor from "@/modules/registrations/ui/GuardianForMinor";
import Flag from "@/shared/ui/Flag";
import Hint from "@/shared/ui/Hint";
import PhoneField from "@/modules/registrations/ui/PhoneField";
import RegistrationSteps from "@/modules/registrations/ui/RegistrationSteps";
import SubmitButton from "@/shared/ui/SubmitButton";
import { turnstileSiteKey } from "@/modules/registrations/turnstile";
import TurnstileWidget from "@/modules/registrations/ui/TurnstileWidget";
import { submitRegistrationAction } from "./actions";
import { PAGE_WIDTH } from "@/theme/brand";
import { env } from "@/shared/config/env";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ submitted?: string; error?: string; fields?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** The anchor a field is reached by from the error summary. Prefixed so it cannot collide. */
const fieldId = (name: string) => `f-${name}`;


/**
 * An optional group, **open by default** since 2026-09-17. It was collapsed to shorten the page
 * (`DECISIONS.md` §47, 580px saved), and the cost turned out to be the one thing the club cares
 * about in that group: the field for a runner's own club sat behind a summary nobody opened,
 * and the owner reported the field as missing. Open, the page is longer and everything on it is
 * seen; the element stays a `<details>` so anybody who wants it shorter can fold it. Native,
 * styled to read as a panel.
 *
 * `<details>` and not a disclosure component: it opens with JavaScript switched off, costs no
 * client island (AGENTS.md §1.5), and is already how this codebase collapses things — the
 * display-name field below and the destructive actions on the registrations list.
 */
const disclosureSx = {
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  px: 2,
  "& > summary": {
    cursor: "pointer",
    // Height from padding, not a flex box: `display: flex` on a <summary> removes the
    // disclosure triangle in Chrome and Safari, and a group that can fold should look like it.
    py: 1.5,
    listStyle: "revert",
    ...TAP_TARGET,
  },
} as const;

/**
 * The registration form (BR-REQ-030-01, BR-REQ-031-01, BR-REQ-031-04, BR-REQ-031-05,
 * BR-REQ-033-01 criterion 1, BR-REQ-041-01).
 *
 * Only for an event that is `INTERNAL` and currently open — anything else 404s rather than
 * showing a form that cannot submit, the same reasoning `sign-in/page.tsx` gives for not
 * rendering a switcher nobody can use.
 *
 * ## Why this is one page and not a wizard
 *
 * Recorded in full in `DECISIONS.md` §47. In short: every way of splitting this across steps
 * has to keep partial answers somewhere, and each place costs more than the length it saves —
 * hidden fields would echo health text (GDPR Article 9) into the markup of every later step,
 * a partial row would put a half-registration in front of the allocator, and a client wizard
 * would trade the browser's own translated, accessible validation for hand-written validation
 * on the one page that has to work everywhere. What actually made the page long is that a
 * third of it asks for things nobody has to answer, so those are collapsed and the rest is not.
 */
export default async function RegisterPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const event = await findPublishedEventBySlug(getDb(), locale, slug);
  if (!event) notFound();

  const now = new Date();
  // Read once: the widget is drawn only when both keys are set (`turnstile.ts`).
  const siteKey = turnstileSiteKey();
  const state = registrationState(
    {
      registrationMode: event.registrationMode,
      eventStatus: event.eventStatus,
      startsAt: event.startsAt,
      registrationOpensAt: event.registrationOpensAt,
      registrationClosesAt: event.registrationClosesAt,
      publishedAt: event.publishedAt,
    },
    now,
  );
  if (state !== "OPEN") notFound();

  const { submitted, error, fields } = await searchParams;

  /**
   * Which boxes to mark, when the server rejected the form.
   *
   * Names only — nothing typed goes into a URL. Reaching this at all should be rare: every
   * constraint below is also a native one, so a browser refuses the submission first and
   * points at the offending field without a round trip. This is the fallback for the cases
   * the browser cannot know about, and for a form posted without JavaScript or by a bot.
   *
   * The parameter is matched against the known field names rather than trusted, because
   * anybody can type one into a URL (`form-errors.ts`).
   */
  const rejected = parseInvalidFields(fields);
  const invalid = new Set<string>(rejected);
  /**
   * The anti-bot check is a rejection about nothing the person typed (§176), so it is not one
   * of the form's fields and `parseInvalidFields` drops it. Read from the raw parameter, matched
   * against the one literal it may be — anybody can type into a URL.
   */
  const captchaFailed = (fields ?? "").split(",").includes("captcha");
  /**
   * The timing check asked again rather than discarding the submission (§194). Like the captcha
   * above it is a rejection about nothing the person typed, so it is read from the raw parameter
   * and matched against the one literal it may be.
   */
  const tooFast = (fields ?? "").split(",").includes("tooFast");

  // BR-REQ-031-04 criterion 4, expressed where the browser can enforce it too.
  const latestBirthDate = now.toISOString().slice(0, 10);
  const earliestBirthDate = new Date(
    Date.UTC(now.getUTCFullYear() - 120, now.getUTCMonth(), now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
  const t = await getTranslations("Registration");
  // Names from the platform, order from the reader's own collation (`countries.ts`).
  const countries = countryOptions(locale, (code) => countryName(code, locale));

  /**
   * The props every text field shares: its anchor, its name, whether it was rejected, and the
   * message under it when it was.
   *
   * `docs/PRACTICES.md` § Accessibility asks for an error stated next to its field rather than
   * only in a summary at the top. MUI derives `aria-describedby` from `helperText`, so the
   * message is announced with the field instead of having to be hunted for.
   */
  // What they typed before the rejection (§142), to put back in every box; nothing otherwise.
  const draft = error ? await readFormDraft() : null;
  const typed = (name: string, fallback?: string) => draft?.[name] ?? fallback;
  const field = (name: string, help?: string) => ({
    id: fieldId(name),
    name,
    error: invalid.has(name),
    helperText: invalid.has(name) ? t("errors.field") : help,
    defaultValue: typed(name),
  });

  // What they are signing up for, on the form itself (§102): the date, the place, and the
  // event's page, its rules and the two legal texts as links — the owner: "show the race date,
  // details and TOS on the sign-up form as links". Formatted in the event's own zone.
  const whenLabel = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
    dateStyle: "full",
    timeStyle: "short", hourCycle: "h23",
    timeZone: event.timezone,
  }).format(event.startsAt);
  const hasRules = !isRichTextEmpty(readRichText(event.rulesJson));
  // The third step of the wizard (§104): "confirm a week before" only while that week is ahead.
  const window = confirmationWindow(event);
  const stepsWindow =
    window && window.opensAt.getTime() > now.getTime()
      ? { opensDays: event.confirmationOpensDaysBefore, deadlineDays: event.confirmationDeadlineDaysBefore }
      : null;
  const factLink = { display: "inline-flex", alignItems: "center", minHeight: TAP_TARGET.minHeight, marginRight: 16 } as const;

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: 3, sm: 6 } }}>
      <Typography variant="h1" gutterBottom>
        {t("title", { event: event.title })}
      </Typography>

      <Box sx={{ mb: 2 }}>
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {whenLabel}
          {event.locationName ? ` · ${event.locationName}` : ""}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap" }}>
          <Link href={{ pathname: "/events/[slug]", params: { slug } }} style={factLink}>
            {t("facts.details")}
          </Link>
          {hasRules && (
            <Link href={{ pathname: "/events/[slug]", params: { slug }, hash: "rules" }} style={factLink}>
              {t("facts.rules")}
            </Link>
          )}
          <Link href="/legal/terms" style={factLink}>
            {t("facts.terms")}
          </Link>
          <Link href="/legal/privacy" style={factLink}>
            {t("facts.privacy")}
          </Link>
        </Box>
      </Box>

      {/* Where they are in the journey, and what happens next — the same component every page
          of this flow renders, so the answer never depends on which page they are looking at. */}
      <RegistrationJourney current={submitted ? "confirm" : "details"} />

      {/* The five steps and the waiting list, folded: the journey above says where they are,
          this says the whole of it (`DECISIONS.md` §91). */}
      {!submitted && (
        <Box sx={{ mb: 3 }}>
          <RegistrationSteps folded window={stepsWindow} />
        </Box>
      )}

      {submitted ? (
        <Stack spacing={2}>
          <Alert severity="success">{t("submitted")}</Alert>
          {/*
            The one thing a person needs when the message does not arrive, offered at the
            moment they would first notice — carrying the event so the resend knows which
            registration is meant without asking a second question.
          */}
          <Typography variant="body2" color="text.secondary">
            {t("resend.prompt")}{" "}
            <Link href={{ pathname: "/registrations/resend", query: { event: slug } }}>
              {t("resend.linkLabel")}
            </Link>
          </Typography>
        </Stack>
      ) : (
        <>
          {/*
            The error summary, and what the redirect lands on.

            `submitRegistrationAction` sends a rejection back to `#registration-errors`, so the
            browser scrolls here and — because this is focusable — puts focus here, rather than
            leaving somebody at the top of a long page with no idea what happened. That is the
            fix for the round trip that used to drop a person above the whole form.
            `role="alert"` covers the case where the browser restores a scroll position instead.

            Each rejected field is a link to its own anchor, which is the one pattern that needs
            no JavaScript: following it moves focus to the input itself.
          */}
          {error && (
            <Alert
              severity="error"
              id={ERROR_SUMMARY_ID}
              role="alert"
              tabIndex={-1}
              sx={{ mb: 2 }}
            >
              <AlertTitle>{t("errors.title")}</AlertTitle>
              {/*
                The anti-bot check, said in words (§176; the owner: "trebuie să ne putem
                înscrie man!").

                A token Cloudflare does not confirm — a widget that never rendered, a challenge
                that timed out while somebody filled a long form, a bad minute on the network —
                comes back as `fields=captcha`. `captcha` is not one of the form's fields, so
                the summary filtered it out and fell through to "verifică datele completate",
                which sends a person hunting through twenty inputs that are all correct. It is
                the one rejection that is about nothing they typed, so it is said first and on
                its own, and the catalogue already had the sentence for it.
              */}
              {captchaFailed ? (
                t("errors.captcha")
              ) : rejected.length > 0 ? (
                <>
                  {t("errors.fieldsIntro")}
                  <Box component="ul" sx={{ m: 0, mt: 1, pl: 3 }}>
                    {rejected.map((name) => (
                      <li key={name}>
                        <MuiLink href={`#${fieldId(name)}`}>{t(`fieldNames.${name}`)}</MuiLink>
                      </li>
                    ))}
                  </Box>
                </>
              ) : (
                t("errors.generic")
              )}
            </Alert>
          )}

          {/*
            What the asterisk means, said once, before the first field that uses one.

            Every required input already carries `required`, so the browser refuses the
            submission and moves focus to the first field that is not filled — that is native
            validation and it needs no JavaScript. What was missing is the *legend*: MUI marks a
            required `TextField` with an asterisk and nothing on the page said what an asterisk
            meant, so "which of these must I fill in" had no answer until you pressed the button.
          */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("requiredLegend")}
          </Typography>
          {/*
            What is published and what is not, before the first field asks for anything (§171;
            the owner: "la formularul de înscriere trebuie să fie clar ce date sunt publice și
            ce date sunt confidențiale").

            A form that asks for a birth date, a phone number, a next of kin and a health note
            owes the person reading it one sentence about where any of that goes — and the
            answer here is unusually good, so it is worth saying: nothing is published unless
            the event has a start list *and* the box below is ticked, and then only the name.
            The two section markers repeat it where each block of fields is.
          */}
          <Alert severity="info" icon={false} sx={{ mb: 2 }}>
            {event.participantListVisibility === "NAMES" ? t("privacyBannerWithList") : t("privacyBanner")}
          </Alert>
          <form action={submitRegistrationAction}>
            <Stack spacing={2}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="slug" value={slug} />
              {/* Bots fill every field; a human never sees or fills this one. */}
              <input
                type="text"
                name="honeypot"
                autoComplete="off"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
              />
              <input type="hidden" name="renderedAt" value={now.toISOString()} />

              {/*
                Two columns from `md` up, one below (BR-REQ-041-01 is phone-first and the phone
                is unchanged). Left: what a registration cannot be accepted without. Right: the
                three optional groups, open, beside the required set rather than after it — on a
                laptop the form used a 600px column of a 1200px page and scrolled for three
                screens; now the whole of it is one screen (the owner, 2026-09-17: "use the space
                more efficiently"). `alignItems: flex-start` so a short right column does not
                stretch to match the left. The consents and the button stay full width beneath
                both, because they close the form and must not look like part of one half.
              */}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                  columnGap: 4,
                  rowGap: 2,
                  alignItems: "start",
                }}
              >
              <Stack spacing={2} sx={{ minWidth: 0 }}>
              <Typography component="h2" variant="h6" sx={{ mt: 1 }}>
                {t("sections.about")}
              </Typography>
              {/* The marker under each block (§171): where these answers go. */}
              <Typography variant="caption" color="text.secondary">
                {t("confidentialNote")}
              </Typography>

              {/*
                BR-REQ-031-04. The legal name is asked in two parts because that is what a
                declaration, a results table and an age category each need separately; the
                display name is asked once, right underneath, so the difference between "who you
                are" and "what a start list shows" is visible when somebody decides it.
              */}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  {...field("firstName")}
                  label={t("firstName")}
                  required
                  autoComplete="given-name"
                  fullWidth
                />
                <TextField
                  {...field("lastName")}
                  label={t("lastName")}
                  required
                  autoComplete="family-name"
                  fullWidth
                />
              </Stack>

              <TextField
                {...field("birthDate", t("birthDateHelp"))}
                type="date"
                label={t("birthDate")}
                required
                autoComplete="bday"
                slotProps={{
                  inputLabel: { shrink: true },
                  // The same bounds the schema applies, so a date in the future is refused by
                  // the picker itself rather than by a round trip that says nothing useful.
                  htmlInput: { min: earliestBirthDate, max: latestBirthDate },
                }}
              />

              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  {...field("sex")}
                  label={t("sex")}
                  select
                  required
                  fullWidth
                  defaultValue={typed("sex", "UNSPECIFIED")}
                  sx={SELECT_WITH_GLYPHS_SX}
                >
                  {/* A glyph beside each answer (§171; the owner: "pune iconițe chiar și la
                      sex"). As **children** of the item, never as a prop across the boundary —
                      see `CheckboxField` for what an element-valued prop costs — and MUI shows
                      the chosen item's children in the closed field, so the mark stays.

                      Which is also why the row is declared twice: the children travel to the
                      closed field, the item's own `sx` does not. `select-option.ts` says what
                      that cost before it was laid out in both places. */}
                  <MenuItem value="FEMALE" sx={OPTION_ROW_SX}>
                    <Box component="span" sx={OPTION_GLYPH_SX}>
                      <FemaleIcon fontSize="small" aria-hidden="true" />
                    </Box>
                    <Box component="span" sx={OPTION_LABEL_SX}>
                      {t("sexOptions.FEMALE")}
                    </Box>
                  </MenuItem>
                  <MenuItem value="MALE" sx={OPTION_ROW_SX}>
                    <Box component="span" sx={OPTION_GLYPH_SX}>
                      <MaleIcon fontSize="small" aria-hidden="true" />
                    </Box>
                    <Box component="span" sx={OPTION_LABEL_SX}>
                      {t("sexOptions.MALE")}
                    </Box>
                  </MenuItem>
                  <MenuItem value="UNSPECIFIED" sx={OPTION_ROW_SX}>
                    <Box component="span" sx={OPTION_GLYPH_SX}>
                      <PersonIcon fontSize="small" aria-hidden="true" />
                    </Box>
                    <Box component="span" sx={OPTION_LABEL_SX}>
                      {t("sexOptions.UNSPECIFIED")}
                    </Box>
                  </MenuItem>
                </TextField>

                <TextField
                  {...field("nationality")}
                  label={t("nationality")}
                  select
                  required
                  fullWidth
                  defaultValue={typed("nationality", "RO")}
                  sx={SELECT_WITH_GLYPHS_SX}
                >
                  {/*
                    The flag before the name (§171), from the set `scripts/sync-flags.mjs`
                    already copies into `public/flags/` — which that script's own comment
                    anticipated for exactly this ("will show many when a participant can state
                    their country"). Normalised to 4:3, so a column of two hundred names does
                    not wobble between Romania's 2:3 and the United Kingdom's 1:2.

                    Not the regional-indicator emoji, which Windows draws as two boxed capitals
                    — and Windows is what the club's own laptop runs.
                  */}
                  {countries.map((country) => (
                    <MenuItem key={country.code} value={country.code} sx={OPTION_ROW_SX}>
                      {/* The flag is `display: block` and 20×15; the fixed box is what stops it
                          taking a line of its own in the closed field and what keeps every
                          country name starting at the same x. */}
                      <Box component="span" sx={OPTION_GLYPH_SX}>
                        <Flag code={country.code} width={20} />
                      </Box>
                      <Box component="span" sx={OPTION_LABEL_SX}>
                        {country.label}
                      </Box>
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>

              <TextField
                {...field("city")}
                label={t("city")}
                required
                autoComplete="address-level2"
              />

              <Typography component="h2" variant="h6" sx={{ mt: 2 }}>
                {t("sections.contact")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("contactNote")}
              </Typography>

              <TextField
                {...field("email")}
                type="email"
                label={t("email")}
                required
                autoComplete="email"
                slotProps={{ htmlInput: { inputMode: "email" } }}
              />
              {/* The country and the digits (§84): what is stored is one number a phone can dial. */}
              <PhoneField
                name="phone"
                draft={draft ? { country: draft.phoneCountry, national: draft.phone } : undefined}
                id={fieldId("phone")}
                label={t("phone")}
                countryLabel={t("phoneCountry")}
                locale={locale}
                required
                autoComplete="tel-national"
                error={invalid.has("phone")}
                helperText={invalid.has("phone") ? t("errors.phone") : t("phoneHelp")}
              />

              {/*
                Required because somebody has to be reachable if a runner is not (BR-BUS-031).
                `autoComplete="off"` on both: this is deliberately somebody *else's* name and
                number, and a phone offering the runner's own would be accepted by reflex.
              */}
              <Stack spacing={2}>
                <TextField
                  {...field("emergencyContactName")}
                  label={t("emergencyContactName")}
                  required
                  fullWidth
                  autoComplete="off"
                />
                <PhoneField
                  name="emergencyContactPhone"
                  draft={draft ? { country: draft.emergencyContactPhoneCountry, national: draft.emergencyContactPhone } : undefined}
                  id={fieldId("emergencyContactPhone")}
                  label={t("emergencyContactPhone")}
                  countryLabel={t("phoneCountry")}
                  locale={locale}
                  required
                  autoComplete="off"
                  error={invalid.has("emergencyContactPhone")}
                  helperText={invalid.has("emergencyContactPhone") ? t("errors.phone") : undefined}
                />
              </Stack>

              </Stack>

              {/*
                Everything from here to the consents is optional. The three groups are open by
                default (DECISIONS.md §59) and still foldable, each summary naming what it holds.

                The consents below the columns are never folded: BR-REQ-072-01 criterion 1 and
                BR-REQ-039-01 require the choice to be *presented*, and a question behind a
                summary nobody opens has not been put to anyone.
              */}
              <Stack spacing={2} sx={{ minWidth: 0 }}>
              <Typography component="h2" variant="h6" sx={{ mt: 1 }}>
                {t("sections.optional")}
              </Typography>
              {/*
                BR-REQ-039-02. Closed by default, because the default answer is the common one:
                a start list says the name you just gave. Opening it changes what is published
                without changing who the declaration is signed by.
              */}
              {env.FEATURE_DISPLAY_NAME && (
              <Box component="details" open sx={disclosureSx}>
                <Typography component="summary" variant="body2">
                  {t("displayNameToggle")}
                </Typography>
                <Stack spacing={1.5} sx={{ pb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t("displayNameHelp")}
                  </Typography>
                  <TextField
                    {...field("displayName")}
                    label={t("displayName")}
                    placeholder={t("displayNamePlaceholder")}
                    autoComplete="nickname"
                    slotProps={{ htmlInput: { maxLength: 120 } }}
                  />
                </Stack>
              </Box>
              )}
              <Box component="details" open sx={disclosureSx}>
                <Typography component="summary" variant="body2">
                  {t("disclosure.race")}
                </Typography>
                <Stack spacing={2} sx={{ pb: 2 }}>
                  {/*
                    BR-REQ-031-06. First in the group, and the reason the summary names the club:
                    a member looking for where to say so finds it by the word "Brașov Runners"
                    rather than by opening every disclosure on the page.

                    It sits beside `clubName` because they are the same question asked twice —
                    somebody who ticks this is in the club whose name they would otherwise type.
                    It is a claim and it grants nothing; `DECISIONS.md` §48 says why it is not
                    checked against `staff_users`.
                  */}
                  <CheckboxField id={fieldId("clubMemberDeclared")} name="clubMemberDeclared" defaultChecked={typed("clubMemberDeclared") === "on"}>
                    {t("clubMemberDeclared")}
                    {/* What the claim means, where it is claimed (§189): "grup" rather than
                        "echipă", because the club is a group somebody runs with and not a squad
                        somebody is selected for, and the tooltip says where the line is. */}
                    <Hint text={t("clubMemberHint")} />
                  </CheckboxField>

                  <TextField
                    {...field("tshirtSize")}
                    label={t("tshirtSize")}
                    select
                    defaultValue={typed("tshirtSize", "NONE")}
                  >
                    <MenuItem value="NONE">{t("tshirtSizes.NONE")}</MenuItem>
                    {["XS", "S", "M", "L", "XL", "XXL"].map((size) => (
                      <MenuItem key={size} value={size}>
                        {size}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    {...field("clubName", t("optional"))}
                    label={t("clubName")}
                    autoComplete="organization"
                  />
                </Stack>
              </Box>

              {/*
                A minor's parent or guardian (§108, §185, §188): shown when the birth date says so.

                It was a fold — "Părinte sau tutore" — and the owner read an opened fold as a
                question he now had to answer: "mă disperă faza cu tutorele!". He was right about
                the shape. §185 made it a tick, which was the right shape and the wrong question:
                the form already asks for the birth date, and the birth date is the answer, so
                asking twice only invites the two answers to disagree — and the server would then
                refuse an unticked minor over a field nobody had been shown.

                The rule has not moved: the server requires a guardian when the birth date gives
                under eighteen, whatever the browser drew. `forceOpen` is that verdict coming
                back — a rejection naming the field opens the block whatever the date box now
                holds, so an error never points at something invisible.
              */}
              <GuardianForMinor birthDateId={fieldId("birthDate")} forceOpen={invalid.has("guardianName")}>
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    {t("guardianHelp")}
                  </Typography>
                  <TextField
                    {...field("guardianName", t("guardianNameHelp"))}
                    label={t("guardianName")}
                    autoComplete="off"
                    slotProps={{ htmlInput: { maxLength: 200 } }}
                  />
                </Stack>
              </GuardianForMinor>

              {/* Socials, optional and folded (§106): the club follows back and tags; never
                  published by the platform. Closed by default — it is the one section a
                  person can skip without the form being any less complete. */}
              <Box component="details" sx={disclosureSx}>
                <Typography component="summary" variant="body2">
                  {t("disclosure.socials")}
                </Typography>
                <Stack spacing={2} sx={{ pb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t("socialsHelp")}
                  </Typography>
                  <TextField
                    {...field("stravaUrl", t("stravaUrlHelp"))}
                    label={t("stravaUrl")}
                    placeholder="https://www.strava.com/athletes/12345"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    slotProps={{ htmlInput: { maxLength: 200 } }}
                  />
                  <TextField
                    {...field("instagramHandle", t("instagramHandleHelp"))}
                    label={t("instagramHandle")}
                    placeholder="@numele.tau"
                    autoComplete="off"
                    slotProps={{ htmlInput: { maxLength: 40 } }}
                  />
                </Stack>
              </Box>

              {/*
                BR-REQ-031-05. Health data is an Article 9 special category, so it gets its own
                disclosure rather than a line inside the group above, its own consent, and
                wording that says plainly it may be left empty. The server refuses text without
                the tick rather than silently dropping either one.

                Closed now, and second (§171; the owner: "nu e clar cu informațiile medicale,
                trebuie să bifeze doar «declar că sunt apt»"). The block asked for free text
                first and a consent under it, which reads as "tell us your conditions" — so the
                one thing the club actually needs from everybody, the fitness statement, was
                nowhere and this was everywhere. The statement is a required tick down in the
                consents; this is the optional note for the person who wants the medical team
                to know something, and it says so.
              */}
              <Box component="details" sx={disclosureSx} open={invalid.has("healthConsent")}>
                <Typography component="summary" variant="body2">
                  {t("disclosure.health")}
                </Typography>
                <Stack spacing={2} sx={{ pb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t("healthIntro")}
                  </Typography>
                  <TextField
                    {...field("healthNotes", t("healthNotesHelp"))}
                    label={t("healthNotes")}
                    multiline
                    minRows={2}
                    autoComplete="off"
                    slotProps={{ htmlInput: { maxLength: 2000 } }}
                  />
                  <CheckboxField id={fieldId("healthConsent")} name="healthConsent" defaultChecked={typed("healthConsent") === "on"}>
                    {`${t("healthConsent")} — ${t("optionalSuffix")}`}
                  </CheckboxField>
                </Stack>
              </Box>

              </Stack>
              </Box>

              <Typography component="h2" variant="h6" sx={{ mt: 2 }}>
                {t("sections.consents")}
              </Typography>

              {/*
                The one consent that is required, and the only one — BR-REQ-031-02.

                The asterisk comes from `FormControlLabel`, which reads `required` off the
                control it wraps. It used to be added by hand here, from a reading of MUI that
                was true once and is not true of the installed version — the two together
                rendered "nota de confidențialitate * *" on the form. The two consents below
                say "optional" in words, so the difference is legible without pressing anything.
              */}
              {/*
                "Declar că sunt apt" (§171), required, and first among the consents because it
                is the one every entrant makes about themselves. It is a statement, not health
                data: no condition, no diagnosis, nothing Article 9 covers — which is why it can
                be insisted on where the note above cannot. The declaration signed later says
                the same thing at length; this is it asked at the moment of entering.
              */}
              {/*
                The race's own conditions, read before they can be agreed to (§195).

                Only when this event wrote any. An event with no rules of its own has nothing to
                open, so the tick points at the club's terms as a plain link — the requirement is
                the same, the panel would just be an empty box.
              */}
              {hasRules ? (
                <ReadAndAgree
                  name="rulesAcknowledged"
                  fieldId={fieldId("rulesAcknowledged")}
                  title={t("rules.panelTitle", { event: event.title })}
                  openLabel={t("rules.open")}
                  readingLabel={t("rules.reading")}
                  agreedLabel={t("rules.agreed")}
                  agreeButtonLabel={t("rules.agreeButton")}
                  keepReadingLabel={t("rules.keepReading")}
                  closeLabel={t("rules.close")}
                  plainLabel={t("rules.plain")}
                  href={`${getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } })}#rules`}
                  document={event.rulesJson}
                />
              ) : (
                <CheckboxField id={fieldId("rulesAcknowledged")} name="rulesAcknowledged" required>
                  {t("rules.plain")} <Link href="/legal/terms">{t("facts.terms")}</Link>
                </CheckboxField>
              )}
              <CheckboxField id={fieldId("fitnessDeclared")} name="fitnessDeclared" required>
                {t("fitnessDeclared")}
              </CheckboxField>
              <CheckboxField id={fieldId("privacyAcknowledged")} name="privacyAcknowledged" required>
                {t("privacyPrefix")} <Link href="/legal/privacy">{t("privacyLinkLabel")}</Link>
              </CheckboxField>
              <CheckboxField name="resultsNameConsent" defaultChecked={typed("resultsNameConsent") === "on"}>
                {`${t("resultsNameConsent")} — ${t("optionalSuffix")}`}
              </CheckboxField>
              {/*
                BR-REQ-039-01, `DECISIONS.md` §85, §143. Asked only when this event publishes a
                start list, and asked the way round the other consents are (the owner: "it
                should be the other way: 'I want to be on the participant list'") — a tick puts
                the name on, no tick keeps it off. A question about a list that does not exist
                is noise. Switching the list on later means asking the people already
                registered — the notice, not a pre-answered box.
              */}
              {event.participantListVisibility === "NAMES" && (
                <CheckboxField name="listOptIn" defaultChecked={typed("listOptIn") === "on"}>
                  {`${t("listOptIn")} — ${t("optionalSuffix")}`}
                </CheckboxField>
              )}

              {/*
                Pressable, always, and deliberately — and, since 2026-09-17, honest about it.

                A submit button *disabled* until a form validates cannot say why: somebody using
                a screen reader meets a control that does nothing and is told nothing, and
                somebody with a mouse is left hunting for the field they missed. Pressing it is
                what produces the answer — the browser refuses, focuses the first unfilled field
                and says what it wants, in the reader's own language. So the button stays
                pressable. What the owner asked for is the *signal* that the form is not yet
                complete, and `SubmitButton` gives that: dimmed, with one sentence beneath it,
                while any required field is empty, and a press still runs the browser's check.
                One client island, shared with every other form here.
              */}
              {/* The language of the emails and the declaration (§97): the page's, unless said otherwise. */}
              <TextField
                name="preferredLocale"
                label={t("preferredLocale")}
                helperText={t("preferredLocaleHelp")}
                select
                fullWidth
                defaultValue={typed("preferredLocale", locale)}
              >
                <MenuItem value="ro">{t("preferredLocaleOptions.ro")}</MenuItem>
                <MenuItem value="en">{t("preferredLocaleOptions.en")}</MenuItem>
              </TextField>

              {/* Cloudflare Turnstile, when the club switched it on (§97), drawn and reset by
                  its own island (§185) — the implicit widget could not survive a re-render. */}
              {siteKey && (
                <Box id={fieldId("captcha")}>
                  <TurnstileWidget siteKey={siteKey} locale={locale} attempt={now.toISOString()} />
                  {captchaFailed && (
                    <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                      {t("errors.captcha")}
                    </Typography>
                  )}
                </Box>
              )}
              {/* Said where the press happened, in the plain second person: the form is whole, the
                  answers are still in it, and pressing again is all there is to do (§194). */}
              {tooFast && (
                <Alert severity="warning">
                  <AlertTitle>{t("errors.tooFastTitle")}</AlertTitle>
                  {t("errors.tooFast")}
                </Alert>
              )}
              <SubmitButton
                label={t("submit")}
                pendingLabel={t("submitting")}
                incompleteHint={t("incompleteHint")}
                size="large"
                fullWidth
              />
            </Stack>
          </form>
        </>
      )}
    </Container>
  );
}
