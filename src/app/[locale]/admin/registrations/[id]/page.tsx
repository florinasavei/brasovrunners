import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  findRegistrationDetailForAdmin,
  listDeclarationAcceptances,
  listOutboxHistory,
} from "@/modules/registrations/admin-repository";
import { deriveAllowedResendMessageType } from "@/modules/registrations/domain/resend";
import { canManageStaff } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { resendRegistrationEmailAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ resent?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/** One registration's full timeline (AGENTS.md §15.8). Administrator only, same gate as the list. */
export default async function RegistrationDetailPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageStaff(actor.role)) notFound();

  const db = getDb();
  const registration = await findRegistrationDetailForAdmin(db, id);
  if (!registration) notFound();

  const [acceptances, outboxHistory] = await Promise.all([
    listDeclarationAcceptances(db, id),
    listOutboxHistory(db, id),
  ]);

  const { resent, error } = await searchParams;
  const tr = await getTranslations("Admin");
  const format = await getFormatter();

  const canResend = deriveAllowedResendMessageType(registration.status) !== null;
  const dt = (value: Date | null) => (value ? format.dateTime(value, { dateStyle: "medium", timeStyle: "short" }) : null);

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/admin/registrations">{tr("registrations.backToList")}</Link>
      </Typography>

      {resent && <Alert severity="success">{tr("registrations.resendSent")}</Alert>}
      {error && <Alert severity="error">{tr("registrations.resendNothingToSend")}</Alert>}

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {registration.registeredName}
        </Typography>
        <Chip size="small" label={tr(`registrations.status.${registration.status}`)} />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {registration.participantEmail} · {registration.eventTitle ?? registration.eventId}
      </Typography>

      <form action={resendRegistrationEmailAction}>
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="registrationId" value={registration.id} />
        <Button type="submit" variant="outlined" disabled={!canResend}>
          {tr("registrations.resend")}
        </Button>
      </form>

      <Stack spacing={1}>
        <Typography variant="h3" sx={{ fontSize: "1rem" }}>
          {tr("registrations.timeline")}
        </Typography>
        {[
          [tr("registrations.submitted"), dt(registration.submittedAt)],
          [tr("registrations.emailConfirmed"), dt(registration.emailConfirmedAt)],
          [tr("registrations.waitlisted"), dt(registration.waitlistedAt)],
          [tr("registrations.offerCreated"), dt(registration.offerCreatedAt)],
          [tr("registrations.holdExpires"), dt(registration.holdExpiresAt)],
          [tr("registrations.confirmed"), dt(registration.confirmedAt)],
          [tr("registrations.cancelled"), registration.cancelledAt ? `${dt(registration.cancelledAt)} (${registration.cancellationSource})` : null],
          [tr("registrations.expired"), registration.expiredAt ? `${dt(registration.expiredAt)} (${registration.expiryReason})` : null],
        ]
          .filter(([, value]) => value !== null)
          .map(([label, value]) => (
            <Typography key={label} variant="body2">
              {label}: {value}
            </Typography>
          ))}
        {acceptances.map((acceptance, index) => (
          <Typography key={index} variant="body2">
            {tr("registrations.declaration")}: {dt(acceptance.acceptedAt)} — {acceptance.typedName} (v{acceptance.declarationVersion})
          </Typography>
        ))}
      </Stack>

      <Stack spacing={1}>
        <Typography variant="h3" sx={{ fontSize: "1rem" }}>
          {tr("registrations.outboxHistory")}
        </Typography>
        {outboxHistory.map((row, index) => (
          <Typography key={index} variant="body2" color="text.secondary">
            {dt(row.createdAt)} · {row.messageType} · {row.status}
            {row.isManualResend ? ` · ${tr("registrations.resend")}` : ""}
          </Typography>
        ))}
      </Stack>
    </Stack>
  );
}
