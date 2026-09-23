import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ActionForm from "@/shared/forms/ActionForm";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import { staffRegistrationConstraints } from "@/modules/registrations/constraints";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import PhoneField from "@/modules/registrations/ui/PhoneField";
import {
  StaffBirthDateField,
  StaffEventScope,
  StaffEventSelect,
  StaffGuardian,
} from "@/modules/registrations/ui/StaffEventBirthDate";
import { dayIn } from "@/modules/registrations/domain/age";
import { phoneCountryOrder } from "@/modules/registrations/phone";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { env } from "@/shared/config/env";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listEventsAcceptingRegistrations } from "@/modules/registrations/admin-repository";
import { canReadRegistrations, canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
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
  // The event the form opens on: the one the desk or the list came from, when it takes entries.
  const selectedEventId = events.find((event) => event.id === eventId)?.id ?? events[0]?.id ?? "";
  // The birth date's bounds (§321, §324): each event's own day, for the fourteen-on-race-day
  // `max` the island computes once an event is chosen, and today and 120 years ago from here, as
  // on the public form, so the server's render and the browser's agree.
  const now = new Date();
  const eventDays = Object.fromEntries(events.map((event) => [event.id, dayIn(event.startsAt, event.timezone)]));
  // Each event's own minimum age (§NNN), so the date's bound follows the event chosen.
  const eventMinAges = Object.fromEntries(events.map((event) => [event.id, event.minAge]));
  const today = now.toISOString().slice(0, 10);
  const earliestBirthDate = new Date(Date.UTC(now.getUTCFullYear() - 120, now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  // The phone prefixes' order, sorted here and only drawn in the browser (§324).
  const phoneOrder = phoneCountryOrder(locale);

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        {/* Back where they came from: the desk for a volunteer, the list for whoever has one
            (§289 — the Organizer does now). */}
        {fromDesk || !canReadRegistrations(actor.role) ? (
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
        // A refusal — a duplicate, a missing relay tick — comes back with every box filled (§315).
        <ActionForm
          action={createRegistrationAction}
          messages={await refusalMessages({
            eventId: t("registrations.event"),
            firstName: rt("firstName"),
            lastName: rt("lastName"),
            birthDate: rt("birthDate"),
            guardianName: rt("guardianName"),
            city: rt("city"),
            phone: rt("phone"),
            emergencyContactName: rt("emergencyContactName"),
            emergencyContactPhone: rt("emergencyContactPhone"),
            clubName: rt("clubName"),
            email: t("registrations.participantEmail"),
            participantLocale: t("registrations.participantLocale"),
            relayedByParticipantRequest: t("registrations.relayConfirmation"),
          })}
          data-testid="registration-new-form"
        >
          <input type="hidden" name="uiLocale" value={locale} />
          {fromDesk && <input type="hidden" name="back" value="desk" />}

          {/* The event and the birth date know about each other (§324): the date box's upper
              bound is the latest birth date still fourteen on the chosen event's day (§321). */}
          <StaffEventScope eventDays={eventDays} eventMinAges={eventMinAges} initialEventId={selectedEventId} today={today} earliest={earliestBirthDate}>
          <Stack spacing={2}>
            <StaffEventSelect
              label={t("registrations.event")}
              defaultValue={selectedEventId}
              events={events.map((event) => ({
                id: event.id,
                label: `${event.title ?? event.id} · ${format.dateTime(event.startsAt, {
                  timeZone: event.timezone,
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}${event.minAge > 0 ? ` · ${event.minAge}+` : ""}`,
              }))}
            />

            <RecallField name="firstName" label={rt("firstName")} {...textFieldConstraints(staffRegistrationConstraints("firstName"))} />
          <RecallField name="lastName" label={rt("lastName")} {...textFieldConstraints(staffRegistrationConstraints("lastName"))} />

          {/*
            BR-REQ-031-04 criterion 5. Everything below the name is optional here and
            required on the public form: an organizer is writing down a telephone call, and
            a registration recorded with gaps beats one refused for them.
          */}
          {env.FEATURE_DISPLAY_NAME && <RecallField name="displayName" label={rt("displayName")} {...textFieldConstraints(staffRegistrationConstraints("displayName"))} />}
          {/* Optional here too, and when it is given the server counts it (§321): under the chosen event's own minimum (§NNN, the "N+" beside its name) on
              the race day is refused, so the field says so before the volunteer presses. */}
          <StaffBirthDateField label={rt("birthDate")} helperText={t("registrations.birthDateMinimumAge")} />
          {/*
            The parent or guardian (§108), shown when the birth date says under eighteen today —
            the public form's own island and rule (§188), so a fourteen-to-seventeen-year-old can
            be entered at the desk with the date rather than refused for a box that was not there
            (§324). Open whatever the date says when a refusal named it.
          */}
          <StaffGuardian>
            <RecallField
              name="guardianName"
              label={rt("guardianName")}
              helperText={rt("guardianNameHelp")}
              autoComplete="off"
              {...textFieldConstraints(staffRegistrationConstraints("guardianName"))}
            />
          </StaffGuardian>
          <RecallField name="city" label={rt("city")} {...textFieldConstraints(staffRegistrationConstraints("city"))} />
          <PhoneField name="phone" label={rt("phone")} countryLabel={rt("phoneCountry")} countryOrder={phoneOrder} />
          <RecallField name="emergencyContactName" label={rt("emergencyContactName")} {...textFieldConstraints(staffRegistrationConstraints("emergencyContactName"))} />
          <PhoneField
            name="emergencyContactPhone"
            label={rt("emergencyContactPhone")}
            countryLabel={rt("phoneCountry")}
            countryOrder={phoneOrder}
          />
          <RecallField name="clubName" label={rt("clubName")} {...textFieldConstraints(staffRegistrationConstraints("clubName"))} />
          {/* BR-REQ-031-06, asked here too: an organizer taking a registration over the
              telephone is usually taking it from somebody in the club. */}
          <CheckboxField name="clubMemberDeclared">{rt("clubMemberDeclared")}</CheckboxField>
            <RecallField
              name="email"
              label={t("registrations.participantEmail")}
              helperText={t("registrations.participantEmailHelp")}
              {...textFieldConstraints(staffRegistrationConstraints("email"))}
            />

            <RecallField
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
            </RecallField>

            {/* A disclosure the person has to have asked for (§323): unticked unless they said so. */}
            <Box>
              <CheckboxField name="listOptIn">{t("registrations.listOptIn")}</CheckboxField>
              <Typography variant="body2" color="text.secondary">
                {t("registrations.listOptInHelp")}
              </Typography>
            </Box>

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
              <GlyphSubmitButton
                label={t("registrations.create")}
                pendingLabel={t("editor.saving")}
                icon="addPerson"
                incompleteHintNamed={t("forms.incompleteFirst")}
                size="medium"
              />
            </Box>
          </Stack>
          </StaffEventScope>
        </ActionForm>
      )}
    </Stack>
  );
}
