import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
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
import {
  listEventsWithRegistrations,
  listRegistrationsForAdmin,
} from "@/modules/registrations/admin-repository";
import type { RegistrationStatus } from "@/db/schema/registrations";
import { registrationStatus } from "@/db/schema/registrations";
import { canManageStaff } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ eventId?: string; status?: string }>;
};

export const dynamic = "force-dynamic";

function isRegistrationStatus(value: string | undefined): value is RegistrationStatus {
  return !!value && (registrationStatus.enumValues as readonly string[]).includes(value);
}

/**
 * Who is registered, and for what (BR-REQ-060-01, BR-REQ-070-01). Administrator only — §10.2
 * reserves "registrations, participants, waitlist... exports" to that role, and no other role
 * gets a hint that this screen exists: an Author or Editor guessing the URL gets 404, the same
 * pattern `admin/staff/page.tsx` uses.
 *
 * Never shows an email address in a list a wider staff role could stumble onto — the delivery
 * address is shown here, on this Administrator-only page, and nowhere public
 * (`privacy/public-surface.test.ts` is what proves that this stays true).
 */
export default async function AdminRegistrationsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageStaff(actor.role)) notFound();

  const { eventId, status } = await searchParams;
  const db = getDb();

  const [registrations, events] = await Promise.all([
    listRegistrationsForAdmin(db, {
      eventId: eventId || undefined,
      status: isRegistrationStatus(status) ? status : undefined,
    }),
    listEventsWithRegistrations(db),
  ]);

  const t = await getTranslations("Admin");
  const format = await getFormatter();

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("nav.registrations")}
        </Typography>
        <Button
          component="a"
          href={`/api/admin/registrations/export${eventId ? `?eventId=${eventId}` : ""}`}
          variant="outlined"
          size="small"
        >
          {t("registrations.export")}
        </Button>
      </Stack>

      <Stack component="form" direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
        <TextField select name="eventId" label={t("nav.events")} defaultValue={eventId ?? ""} sx={{ minWidth: 220 }}>
          <MenuItem value="">{t("registrations.filterAll")}</MenuItem>
          {events.map((event) => (
            <MenuItem key={event.id} value={event.id}>
              {event.title ?? event.id}
            </MenuItem>
          ))}
        </TextField>
        <TextField select name="status" label={t("registrations.statusLabel")} defaultValue={status ?? ""} sx={{ minWidth: 220 }}>
          <MenuItem value="">{t("registrations.filterAll")}</MenuItem>
          {registrationStatus.enumValues.map((value) => (
            <MenuItem key={value} value={value}>
              {t(`registrations.status.${value}`)}
            </MenuItem>
          ))}
        </TextField>
        <Button type="submit" variant="contained">
          {t("registrations.filter")}
        </Button>
      </Stack>

      {registrations.length === 0 ? (
        <Typography variant="body1">{t("registrations.empty")}</Typography>
      ) : (
        <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {registrations.map((row) => (
            <Card key={row.id} component="li" variant="outlined">
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                  <Chip size="small" label={t(`registrations.status.${row.status}`)} />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={format.dateTime(row.submittedAt, { dateStyle: "medium", timeStyle: "short" })}
                  />
                </Stack>
                <Typography variant="h3" sx={{ fontSize: "1rem" }}>
                  <Link href={{ pathname: "/admin/registrations/[id]", params: { id: row.id } }}>
                    {row.registeredName}
                  </Link>
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {row.participantEmail} · {row.eventTitle ?? row.eventId}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
