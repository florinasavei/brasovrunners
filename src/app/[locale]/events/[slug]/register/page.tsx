import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Container from "@mui/material/Container";
import FormControlLabel from "@mui/material/FormControlLabel";
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
import { countryName } from "@/modules/registrations/names";
import { submitRegistrationAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ submitted?: string; error?: string; fields?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The registration form (BR-REQ-030-01, BR-REQ-031-01, BR-REQ-033-01 criterion 1).
 *
 * Only for an event that is `INTERNAL` and currently open — anything else 404s rather than
 * showing a form that cannot submit, the same reasoning `sign-in/page.tsx` gives for not
 * rendering a switcher nobody can use.
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
   */
  const invalid = new Set((fields ?? "").split(",").filter(Boolean));

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

  return (
    <Container id="main" component="main" maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
      <Typography variant="h1" gutterBottom>
        {t("title", { event: event.title })}
      </Typography>

      {submitted ? (
        <Alert severity="success">{t("submitted")}</Alert>
      ) : (
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

          {error && (
            <Alert severity="error">
              {invalid.size > 0
                ? t("errors.fields", {
                    fields: [...invalid].map((name) => t(`fieldNames.${name}`)).join(", "),
                  })
                : t("errors.generic")}
            </Alert>
          )}

          <Typography component="h2" variant="h6" sx={{ mt: 1 }}>
            {t("sections.about")}
          </Typography>

          {/*
            BR-REQ-031-04. The legal name is asked in two parts because that is what a
            declaration, a results table and an age category each need separately; the display
            name is asked once, right underneath, so the difference between "who you are" and
            "what a start list shows" is visible at the moment somebody decides it.
          */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              name="firstName"
              error={invalid.has("firstName")}
              label={t("firstName")}
              required
              autoComplete="given-name"
              fullWidth
            />
            <TextField
              name="lastName"
              error={invalid.has("lastName")}
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

            `<details>` rather than a disclosure component — it is native, it works with
            JavaScript switched off, and it costs no client island (AGENTS.md §1.5).
          */}
          <Box
            component="details"
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              px: 2,
              "& > summary": { cursor: "pointer", py: 1.5, listStyle: "revert" },
            }}
          >
            <Typography component="summary" variant="body2">
              {t("displayNameToggle")}
            </Typography>
            <Stack spacing={1.5} sx={{ pb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t("displayNameHelp")}
              </Typography>
              <TextField
                name="displayName"
                label={t("displayName")}
                placeholder={t("displayNamePlaceholder")}
                slotProps={{ htmlInput: { maxLength: 120 } }}
              />
            </Stack>
          </Box>

          <TextField
            name="birthDate"
            type="date"
            label={t("birthDate")}
            helperText={t("birthDateHelp")}
            required
            error={invalid.has("birthDate")}
            slotProps={{
              inputLabel: { shrink: true },
              // The same bounds the schema applies, so a date in the future is refused by
              // the date picker itself rather than by a round trip that says nothing useful.
              htmlInput: { min: earliestBirthDate, max: latestBirthDate },
            }}
          />

          <TextField name="sex" label={t("sex")} select required defaultValue="UNSPECIFIED">
            <MenuItem value="FEMALE">{t("sexOptions.FEMALE")}</MenuItem>
            <MenuItem value="MALE">{t("sexOptions.MALE")}</MenuItem>
            <MenuItem value="UNSPECIFIED">{t("sexOptions.UNSPECIFIED")}</MenuItem>
          </TextField>

          <TextField name="nationality" label={t("nationality")} select required defaultValue="RO">
            {countries.map((country) => (
              <MenuItem key={country.code} value={country.code}>
                {country.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            name="city"
            label={t("city")}
            required
            autoComplete="address-level2"
            error={invalid.has("city")}
          />

          <Typography component="h2" variant="h6" sx={{ mt: 2 }}>
            {t("sections.contact")}
          </Typography>

          <TextField
            name="email"
            type="email"
            label={t("email")}
            required
            autoComplete="email"
            error={invalid.has("email")}
          />
          {/*
            A deliberately permissive pattern: a runner from anywhere may enter, and refusing
            a valid foreign number is a worse failure than accepting one nobody rings. It
            exists so the browser catches a typed word before the server has to.
          */}
          <TextField
            name="phone"
            type="tel"
            label={t("phone")}
            required
            autoComplete="tel"
            error={invalid.has("phone")}
            slotProps={{ htmlInput: { pattern: "[0-9+()./\\s-]{3,40}", minLength: 3, maxLength: 40 } }}
          />

          {/* Required because somebody has to be reachable if a runner is not (BR-BUS-031). */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              name="emergencyContactName"
              label={t("emergencyContactName")}
              required
              fullWidth
              error={invalid.has("emergencyContactName")}
            />
            <TextField
              name="emergencyContactPhone"
              type="tel"
              label={t("emergencyContactPhone")}
              required
              fullWidth
              error={invalid.has("emergencyContactPhone")}
              slotProps={{ htmlInput: { pattern: "[0-9+()./\\s-]{3,40}", minLength: 3, maxLength: 40 } }}
            />
          </Stack>

          <Typography component="h2" variant="h6" sx={{ mt: 2 }}>
            {t("sections.race")}
          </Typography>

          <TextField name="tshirtSize" label={t("tshirtSize")} select defaultValue="NONE">
            <MenuItem value="NONE">{t("tshirtSizes.NONE")}</MenuItem>
            {["XS", "S", "M", "L", "XL", "XXL"].map((size) => (
              <MenuItem key={size} value={size}>
                {size}
              </MenuItem>
            ))}
          </TextField>

          <TextField name="clubName" label={t("clubName")} helperText={t("optional")} />

          {/*
            BR-REQ-031-05. Health data is an Article 9 special category, so it gets its own
            heading, its own consent, and wording that says plainly it may be left empty. The
            server refuses text without the tick rather than silently dropping either one.
          */}
          <Typography component="h2" variant="h6" sx={{ mt: 2 }}>
            {t("sections.health")}
          </Typography>

          <TextField
            name="healthNotes"
            label={t("healthNotes")}
            helperText={t("healthNotesHelp")}
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <FormControlLabel
            control={<Checkbox name="healthConsent" />}
            label={t("healthConsent")}
          />

          <Typography component="h2" variant="h6" sx={{ mt: 2 }}>
            {t("sections.consents")}
          </Typography>

          <FormControlLabel
            control={<Checkbox name="privacyAcknowledged" required />}
            label={
              <>
                {t("privacyPrefix")} <Link href="/legal/privacy">{t("privacyLinkLabel")}</Link>
              </>
            }
          />
          <FormControlLabel
            control={<Checkbox name="resultsNameConsent" />}
            label={t("resultsNameConsent")}
          />
          {/*
            BR-REQ-039-01. Asked on every form, including for an event that publishes no start
            list today: an organizer can switch one on months later, and a question nobody put
            to this person cannot be answered on their behalf afterwards. The label says "if
            the club publishes one" for exactly that reason.
          */}
          <FormControlLabel
            control={<Checkbox name="listOptOut" />}
            label={t("listOptOut")}
          />

          <Button type="submit" variant="contained">
            {t("submit")}
          </Button>
        </Stack>
        </form>
      )}
    </Container>
  );
}
