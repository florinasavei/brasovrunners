import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listAuditTrail } from "@/modules/audit/repository";
import {
  findRegistrationDetailForAdmin,
  listDeclarationAcceptances,
  listOutboxHistory,
} from "@/modules/registrations/admin-repository";
import { deriveAllowedResendMessageType } from "@/modules/registrations/domain/resend";
import { canTransition } from "@/modules/registrations/domain/state-machine";
import { canManageStaff } from "@/modules/staff-identity/domain/roles";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import { cancelRegistrationAction, correctRegisteredNameAction } from "../actions";
import { resendRegistrationEmailAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ resent?: string; saved?: string; error?: string }>;
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

  const [acceptances, outboxHistory, auditTrail] = await Promise.all([
    listDeclarationAcceptances(db, id),
    listOutboxHistory(db, id),
    listAuditTrail(db, "registration", id),
  ]);

  const { resent, saved, error } = await searchParams;
  const tr = await getTranslations("Admin");
  const format = await getFormatter();

  const canResend = deriveAllowedResendMessageType(registration.status) !== null;
  // §10.5 has no edge from PENDING_EMAIL_CONFIRMATION to CANCELLED: an unconfirmed address
  // lapses on its own and holds no place, so there is nothing to release and no form to show.
  const canCancel = canTransition(registration.status, "CANCELLED");
  const dt = (value: Date | null) => (value ? format.dateTime(value, { dateStyle: "medium", timeStyle: "short" }) : null);

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/admin/registrations">{tr("registrations.backToList")}</Link>
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {resent && <Alert severity="success">{tr("registrations.resendSent")}</Alert>}
        {saved && <Alert severity="success">{tr("saved")}</Alert>}
      {/* The action redirects with a language-neutral code (AGENTS.md 14.3); this is where it
          becomes a sentence. */}
        {error && <Alert severity="error">{tr(`errors.${error}`)}</Alert>}
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {registration.registeredName}
        </Typography>
        <Chip size="small" label={REGISTRATION_STATUS_LABEL[registration.status]} />
        {registration.kind === "TEST" && (
          <Chip size="small" color="warning" label={tr("registrations.testKind")} />
        )}
        {/* BR-REQ-037-05: a staff-entered row behaves exactly like any other, and says so. */}
        {registration.source === "STAFF" && (
          <Chip size="small" variant="outlined" label={tr("registrations.enteredByStaff")} />
        )}
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

      <Divider />

      {/*
        The one editable field (BR-REQ-037-03 criterion 1), and the audit trail below records
        what it was before. There is deliberately no email field here: the verified address is
        the participant's identity (AGENTS.md 10.3), and a typo is fixed by cancelling and
        registering again with the right one — criterion 2 asks for exactly that absence.
      */}
      <Box component="section">
        <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
          {tr("registrations.correctName")}
        </Typography>
        <form action={correctRegisteredNameAction}>
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="registrationId" value={registration.id} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
            <TextField
              name="registeredName"
              label={tr("registrations.participantName")}
              defaultValue={registration.registeredName}
              size="small"
              required
              sx={{ flex: 1 }}
            />
            <Button type="submit" variant="outlined" sx={{ minHeight: 44 }}>
              {tr("registrations.saveName")}
            </Button>
          </Stack>
        </form>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {tr("registrations.correctNameHelp")}
        </Typography>
      </Box>

      {/*
        Cancelling is what "remove this registration" means: the row is the record of what
        somebody agreed to, so nothing deletes it. The place is released inside the same locked
        transaction a participant's own cancellation uses, and goes to the front of the waiting
        list rather than to whoever registers next (AGENTS.md 15.5, 15.6).
      */}
      {canCancel && (
        <Box component="section">
          <Typography variant="h3" sx={{ fontSize: "1rem", mb: 1 }}>
            {tr("registrations.cancelTitle")}
          </Typography>
          <form action={cancelRegistrationAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="registrationId" value={registration.id} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
              <TextField
                name="reason"
                label={tr("registrations.cancelReason")}
                size="small"
                required
                sx={{ flex: 1 }}
              />
              <ConfirmSubmitButton
                label={tr("registrations.cancelAction")}
                title={tr("confirm.cancelRegistrationTitle")}
                body={tr("confirm.cancelRegistrationBody")}
                confirmLabel={tr("registrations.cancelAction")}
                cancelLabel={tr("confirm.cancel")}
                color="error"
              />
            </Stack>
          </form>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {tr("registrations.cancelHelp")}
          </Typography>
        </Box>
      )}

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

      {auditTrail.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h3" sx={{ fontSize: "1rem" }}>
            {tr("registrations.auditTrail")}
          </Typography>
          {auditTrail.map((entry, index) => (
            <Typography key={index} variant="body2">
              {dt(entry.createdAt)} · {tr(`registrations.audit.${entry.action}`)} ·{" "}
              {entry.actorName ?? tr("registrations.auditActorRemoved")}
              {/* Metadata is the shape of the change — a name before and after, a typed reason —
                  never a copy of what the change was about (AGENTS.md 12.12). */}
              {Object.keys(entry.metadataJson as object).length > 0 &&
                ` · ${JSON.stringify(entry.metadataJson)}`}
            </Typography>
          ))}
        </Stack>
      )}

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
