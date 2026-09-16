import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Container from "@mui/material/Container";
import FormControlLabel from "@mui/material/FormControlLabel";
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
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { registrationState } from "@/modules/events/domain/registration-window";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { countryOptions } from "@/modules/registrations/countries";
import { ERROR_SUMMARY_ID, parseInvalidFields } from "@/modules/registrations/form-errors";
import { countryName } from "@/modules/registrations/names";
import RegistrationJourney from "@/modules/registrations/ui/RegistrationJourney";
import { CHECKBOX_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";
import { submitRegistrationAction } from "./actions";

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
 * A collapsed optional group. Native `<details>`, styled to read as a panel.
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
    py: 1.5,
    listStyle: "revert",
    display: "flex",
    alignItems: "center",
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
  const field = (name: string, help?: string) => ({
    id: fieldId(name),
    name,
    error: invalid.has(name),
    helperText: invalid.has(name) ? t("errors.field") : help,
  });

  // A rejected field inside a collapsed group would otherwise be unreachable from the summary.
  const healthRejected = invalid.has("healthNotes") || invalid.has("healthConsent");
  const raceRejected = invalid.has("tshirtSize") || invalid.has("clubName");

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
      <Typography variant="h1" gutterBottom>
        {t("title", { event: event.title })}
      </Typography>

      {/* Where they are in the journey, and what happens next — the same component every page
          of this flow renders, so the answer never depends on which page they are looking at. */}
      <RegistrationJourney current={submitted ? "confirm" : "details"} />

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
              {rejected.length > 0 ? (
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

              <Typography component="h2" variant="h6" sx={{ mt: 1 }}>
                {t("sections.about")}
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

              {/*
                BR-REQ-039-02. Closed by default, because the default answer is the common one:
                a start list says the name you just gave. Opening it changes what is published
                without changing who the declaration is signed by.
              */}
              <Box component="details" open={invalid.has("displayName")} sx={disclosureSx}>
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
                  defaultValue="UNSPECIFIED"
                >
                  <MenuItem value="FEMALE">{t("sexOptions.FEMALE")}</MenuItem>
                  <MenuItem value="MALE">{t("sexOptions.MALE")}</MenuItem>
                  <MenuItem value="UNSPECIFIED">{t("sexOptions.UNSPECIFIED")}</MenuItem>
                </TextField>

                <TextField
                  {...field("nationality")}
                  label={t("nationality")}
                  select
                  required
                  fullWidth
                  defaultValue="RO"
                >
                  {countries.map((country) => (
                    <MenuItem key={country.code} value={country.code}>
                      {country.label}
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

              <TextField
                {...field("email")}
                type="email"
                label={t("email")}
                required
                autoComplete="email"
                slotProps={{ htmlInput: { inputMode: "email" } }}
              />
              {/*
                A deliberately permissive pattern: a runner from anywhere may enter, and refusing
                a valid foreign number is a worse failure than accepting one nobody rings. It
                exists so the browser catches a typed word before the server has to.
              */}
              <TextField
                {...field("phone")}
                type="tel"
                label={t("phone")}
                required
                autoComplete="tel"
                slotProps={{
                  htmlInput: {
                    inputMode: "tel",
                    pattern: "[0-9+()./\\s-]{3,40}",
                    minLength: 3,
                    maxLength: 40,
                  },
                }}
              />

              {/*
                Required because somebody has to be reachable if a runner is not (BR-BUS-031).
                `autoComplete="off"` on both: this is deliberately somebody *else's* name and
                number, and a phone offering the runner's own would be accepted by reflex.
              */}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  {...field("emergencyContactName")}
                  label={t("emergencyContactName")}
                  required
                  fullWidth
                  autoComplete="off"
                />
                <TextField
                  {...field("emergencyContactPhone")}
                  type="tel"
                  label={t("emergencyContactPhone")}
                  required
                  fullWidth
                  autoComplete="off"
                  slotProps={{
                    htmlInput: {
                      inputMode: "tel",
                      pattern: "[0-9+()./\\s-]{3,40}",
                      minLength: 3,
                      maxLength: 40,
                    },
                  }}
                />
              </Stack>

              {/*
                Everything from here to the consents is optional, and collapsed for that reason.

                On a 390-pixel screen these four controls were a third of the page, standing
                between a runner and the button they came to press, and not one of them has to
                be answered for a registration to be accepted. Collapsed, they are still asked —
                each summary names what is inside, so somebody who wants a t-shirt or has an
                allergy to declare finds it — and what a stranger has to complete is the required
                set plus the consents.

                The consents themselves stay open: BR-REQ-072-01 criterion 1 and BR-REQ-039-01
                require the choice to be *presented*, and a question behind a summary nobody
                opens has not been put to anyone.
              */}
              <Box component="details" open={raceRejected} sx={disclosureSx}>
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
                  <FormControlLabel
                    control={
                      <Checkbox
                        id={fieldId("clubMemberDeclared")}
                        name="clubMemberDeclared"
                        sx={CHECKBOX_TAP_TARGET}
                      />
                    }
                    label={t("clubMemberDeclared")}
                  />

                  <TextField
                    {...field("tshirtSize")}
                    label={t("tshirtSize")}
                    select
                    defaultValue="NONE"
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
                BR-REQ-031-05. Health data is an Article 9 special category, so it gets its own
                disclosure rather than a line inside the group above, its own consent, and
                wording that says plainly it may be left empty. The server refuses text without
                the tick rather than silently dropping either one.
              */}
              <Box component="details" open={healthRejected} sx={disclosureSx}>
                <Typography component="summary" variant="body2">
                  {t("disclosure.health")}
                </Typography>
                <Stack spacing={2} sx={{ pb: 2 }}>
                  <TextField
                    {...field("healthNotes", t("healthNotesHelp"))}
                    label={t("healthNotes")}
                    multiline
                    minRows={2}
                    autoComplete="off"
                    slotProps={{ htmlInput: { maxLength: 2000 } }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        id={fieldId("healthConsent")}
                        name="healthConsent"
                        sx={CHECKBOX_TAP_TARGET}
                      />
                    }
                    label={`${t("healthConsent")} — ${t("optionalSuffix")}`}
                  />
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
              <FormControlLabel
                control={
                  <Checkbox
                    id={fieldId("privacyAcknowledged")}
                    name="privacyAcknowledged"
                    required
                    sx={CHECKBOX_TAP_TARGET}
                  />
                }
                label={
                  <>
                    {t("privacyPrefix")} <Link href="/legal/privacy">{t("privacyLinkLabel")}</Link>
                  </>
                }
              />
              <FormControlLabel
                control={<Checkbox name="resultsNameConsent" sx={CHECKBOX_TAP_TARGET} />}
                label={`${t("resultsNameConsent")} — ${t("optionalSuffix")}`}
              />
              {/*
                BR-REQ-039-01. Asked on every form, including for an event that publishes no
                start list today: an organizer can switch one on months later, and a question
                nobody put to this person cannot be answered on their behalf afterwards. The
                label says "if the club publishes one" for exactly that reason.
              */}
              <FormControlLabel
                control={<Checkbox name="listOptOut" sx={CHECKBOX_TAP_TARGET} />}
                label={`${t("listOptOut")} — ${t("optionalSuffix")}`}
              />

              {/*
                Enabled, always, and deliberately.

                A submit button disabled until a form validates cannot say *why* it is disabled:
                somebody using a screen reader meets a control that does nothing and is told
                nothing, and somebody using a mouse is left hunting for the field they missed.
                Pressing it is what produces the answer — the browser refuses, focuses the first
                unfilled field and says what it wants, in the reader's own language, with no
                JavaScript at all. Disabling it would also need a client island, which the
                standing rule keeps to the few that earn it (§1.5). The marking above is the fix;
                the button is not.
              */}
              <Button type="submit" variant="contained" sx={TAP_TARGET}>
                {t("submit")}
              </Button>
            </Stack>
          </form>
        </>
      )}
    </Container>
  );
}
