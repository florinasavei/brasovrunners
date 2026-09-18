import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CheckboxField from "@/shared/ui/CheckboxField";
import PhoneField from "@/modules/registrations/ui/PhoneField";
import { env } from "@/shared/config/env";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listEventsAcceptingRegistrations } from "@/modules/registrations/admin-repository";
import { canManageRegistrations, canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { createRegistrationAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ eventId?: string; error?: string; back?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * Enter a registration for somebody who asked in person (BR-REQ-037-05).
 *
 * Every staff role since `DECISIONS.md` §67 — the desk enters walk-ins — asserted here and
 * again in the action and once more in the service. The form is short on purpose: the club is
 * typing it while somebody waits, and every field it does not ask for is one the participant
 * answers themselves from the email that follows.
 *
 * By default this confirms nobody: the registration starts exactly where a public one does and
 * the participant finishes it from their own email. The one tick that changes that is the fast
 * track (BR-REQ-037-07), for a person standing at the desk: the address is vouched for by
 * whoever is typing, and the declaration is signed on paper in front of them — by the
 * participant, still; nobody signs one for somebody else (AGENTS.md §10.8).
 */
export default async function NewRegistrationPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canWorkTheDesk(actor.role)) notFound();

  const { eventId, error, back } = await searchParams;
  const fromDesk = back === "desk";
  const t = await getTranslations("Admin");
  const rt = await getTranslations("Registration");
  const format = await getFormatter();
  const events = await listEventsAcceptingRegistrations(getDb(), locale);

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        {fromDesk || !canManageRegistrations(actor.role) ? (
          <Link href="/admin/checkin">{t("desk.backToDesk")}</Link>
        ) : (
          <Link href="/admin/registrations">{t("registrations.backToList")}</Link>
        )}
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
          {fromDesk && <input type="hidden" name="back" value="desk" />}

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
          {env.FEATURE_DISPLAY_NAME && <TextField name="displayName" label={rt("displayName")} />}
          <TextField name="birthDate" type="date" label={rt("birthDate")} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField name="city" label={rt("city")} />
          <PhoneField name="phone" label={rt("phone")} countryLabel={rt("phoneCountry")} locale={locale} />
          <TextField name="emergencyContactName" label={rt("emergencyContactName")} />
          <PhoneField
            name="emergencyContactPhone"
            label={rt("emergencyContactPhone")}
            countryLabel={rt("phoneCountry")}
            locale={locale}
          />
          <TextField name="clubName" label={rt("clubName")} />
          {/* BR-REQ-031-06, asked here too: an organizer taking a registration over the
              telephone is usually taking it from somebody in the club. */}
          <CheckboxField name="clubMemberDeclared">{rt("clubMemberDeclared")}</CheckboxField>
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

            <CheckboxField name="listOptOut">{t("registrations.listOptOut")}</CheckboxField>

            {/* The service refuses the whole registration without this, so the warning is
                binding rather than decorative — the same rule the live-edit acknowledgement
                follows in the event editor. */}
            <CheckboxField name="relayedByParticipantRequest" required>
              {t("registrations.relayConfirmation")}
            </CheckboxField>

            {/*
              The fast track (BR-REQ-037-07). Ticked by default when the form was opened from the
              desk, because that is what the desk is for; unticked from the list, where the
              person is usually on the telephone and finishes from their own email.
            */}
            <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, px: 2, py: 1 }}>
              <CheckboxField name="fastTrack" defaultChecked={fromDesk}>
                {t("desk.fastTrack")}
              </CheckboxField>
              <Typography variant="body2" color="text.secondary">
                {t("desk.fastTrackHelp")}
              </Typography>
            </Box>

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
