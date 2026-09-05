import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listEventsAcceptingRegistrations } from "@/modules/registrations/admin-repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { createRegistrationAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ eventId?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * Enter a registration for somebody who asked in person (BR-REQ-037-05).
 *
 * Administrator only, asserted here and again in the action and once more in the service. The
 * form is short on purpose: the club is typing it while somebody waits, and every field it does
 * not ask for is one the participant answers themselves from the email that follows.
 *
 * What this form cannot do, and says so on the page: confirm anybody. The registration starts
 * exactly where a public one does, the participant gets the ordinary verification email, and
 * the declaration is signed by them from their own link — nobody signs one for somebody else
 * (AGENTS.md §10.8).
 */
export default async function NewRegistrationPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageRegistrations(actor.role)) notFound();

  const { eventId, error } = await searchParams;
  const t = await getTranslations("Admin");
  const rt = await getTranslations("Registration");
  const format = await getFormatter();
  const events = await listEventsAcceptingRegistrations(getDb(), locale);

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/admin/registrations">{t("registrations.backToList")}</Link>
      </Typography>

      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("registrations.newTitle")}
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Alert severity="info">{t("registrations.newExplanation")}</Alert>

      {events.length === 0 ? (
        <Alert severity="warning">{t("registrations.noEventsAcceptingRegistrations")}</Alert>
      ) : (
        <form action={createRegistrationAction}>
          <input type="hidden" name="uiLocale" value={locale} />

          <Stack spacing={2}>
            <TextField
              select
              name="eventId"
              label={t("registrations.event")}
              defaultValue={eventId ?? events[0].id}
              required
            >
              {events.map((event) => (
                <MenuItem key={event.id} value={event.id}>
                  {event.title ?? event.id} ·{" "}
                  {format.dateTime(event.startsAt, {
                    timeZone: event.timezone,
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </MenuItem>
              ))}
            </TextField>

            <TextField name="firstName" label={rt("firstName")} required />
          <TextField name="lastName" label={rt("lastName")} required />

          {/*
            BR-REQ-031-04 criterion 5. Everything below the name is optional here and
            required on the public form: an organizer is writing down a telephone call, and
            a registration recorded with gaps beats one refused for them.
          */}
          <TextField name="displayName" label={rt("displayName")} />
          <TextField name="birthDate" type="date" label={rt("birthDate")} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField name="city" label={rt("city")} />
          <TextField name="phone" type="tel" label={rt("phone")} />
          <TextField name="emergencyContactName" label={rt("emergencyContactName")} />
          <TextField name="emergencyContactPhone" type="tel" label={rt("emergencyContactPhone")} />
          <TextField name="clubName" label={rt("clubName")} />
            <TextField
              name="email"
              type="email"
              label={t("registrations.participantEmail")}
              helperText={t("registrations.participantEmailHelp")}
              required
            />

            <TextField
              select
              name="participantLocale"
              label={t("registrations.participantLocale")}
              defaultValue={locale}
              helperText={t("registrations.participantLocaleHelp")}
              required
            >
              {routing.locales.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(`registrations.locale.${value}`)}
                </MenuItem>
              ))}
            </TextField>

            <FormControlLabel
              control={<Checkbox name="listOptOut" />}
              label={t("registrations.listOptOut")}
            />

            {/* The service refuses the whole registration without this, so the warning is
                binding rather than decorative — the same rule the live-edit acknowledgement
                follows in the event editor. */}
            <FormControlLabel
              control={<Checkbox name="relayedByParticipantRequest" required />}
              label={t("registrations.relayConfirmation")}
            />

            <Box>
              <Button type="submit" variant="contained" sx={{ minHeight: 44 }}>
                {t("registrations.create")}
              </Button>
            </Box>
          </Stack>
        </form>
      )}
    </Stack>
  );
}
