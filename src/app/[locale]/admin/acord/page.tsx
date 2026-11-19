import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE, formatDateInWords } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { TEAM_AGREEMENT_NAME_MAX, teamAgreementReturnTo } from "@/modules/staff-identity/domain/team-agreement";
import { requireStaffBeforeTeamAgreement } from "@/modules/staff-identity/session";
import { findTeamAgreementText, teamAgreementOwedBy } from "@/modules/staff-identity/team-agreement";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import { acceptTeamAgreementAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Reads the session cookie, so it can never be prerendered or cached (AGENTS.md §14.5). */
export const dynamic = "force-dynamic";

/**
 * The team's undertaking, read and accepted (§NNN; the owner, 2026-11-19: «Voluntarii trebuie să semneze acordul GDPR când intră
 * în platformă»): where the gate (`requireStaff`, the admin layout) sends a colleague below the Administrator who has not accepted
 * the version of `STAFF_DATA_AGREEMENT` in force — the text as the other legal pages draw it, its version line, «Numele tău
 * complet», «Am citit și accept angajamentul» and «Accept și intru», then back to where they were going (`returnTo`, a same-site
 * path only, else the backoffice's first page).
 *
 * The one backoffice page such a colleague may open (`requireStaffBeforeTeamAgreement`); the shell above it draws no tabs and
 * keeps «Ieși din cont». Nothing owed — an Administrator, nothing in force, the version accepted already — and the page sends the
 * reader straight on: it is never a second way to read or accept a text.
 */
export default async function TeamAgreementPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaffBeforeTeamAgreement();
  const query = await searchParams;
  const returnTo = teamAgreementReturnTo(typeof query.returnTo === "string" ? query.returnTo : null);
  const back = returnTo ?? getPathname({ locale, href: "/admin" });
  const db = getDb();
  const now = new Date();
  if (!(await teamAgreementOwedBy(db, actor, now))) redirect(back);
  const document = await findTeamAgreementText(db, locale, now);
  if (!document) redirect(back);

  const t = await getTranslations("Admin");
  const tLegal = await getTranslations("Legal");
  const messages = await refusalMessages({ fullName: t("teamAgreement.fullName"), accepted: t("teamAgreement.accept") });

  return (
    <Stack spacing={3} data-testid="team-agreement">
      <Typography variant="h2" sx={HEADING_SX.title}>
        {t("teamAgreement.title")}
      </Typography>
      <Alert severity="info" data-testid="team-agreement-intro">
        {t("teamAgreement.intro")}
      </Alert>

      {/* The text as the public legal pages draw it (§323): its title, its version line, the body. */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} data-testid="team-agreement-text">
        <Typography variant="h3" sx={{ ...HEADING_SX[2], mb: 1, overflowWrap: "anywhere" }}>
          {document.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }} data-testid="team-agreement-version">
          {tLegal("inForce", { version: document.version, date: formatDateInWords(new Date(document.effectiveAt), { locale, timeZone: CLUB_TIME_ZONE }) })}
        </Typography>
        <LegalDocumentBody body={document.body} emphasizeFilled={false} />
      </Paper>

      <ActionForm action={acceptTeamAgreementAction} messages={messages} data-testid="team-agreement-form">
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="documentId" value={document.id} />
        <input type="hidden" name="returnTo" value={returnTo ?? ""} />
        <Stack spacing={2} sx={{ maxWidth: 560 }}>
          <RecallField
            name="fullName"
            label={t("teamAgreement.fullName")}
            helperText={t("teamAgreement.fullNameHelp")}
            required
            autoComplete="name"
            slotProps={{ htmlInput: { maxLength: TEAM_AGREEMENT_NAME_MAX } }}
          />
          <CheckboxField name="accepted" required requiredMessage={t("teamAgreement.acceptRequired")}>
            {t("teamAgreement.accept")}
          </CheckboxField>
          <Box>
            <GlyphSubmitButton label={t("teamAgreement.submit")} pendingLabel={t("teamAgreement.submitting")} icon="confirm" variant="contained" />
          </Box>
        </Stack>
      </ActionForm>

      <Typography variant="body2" color="text.secondary" data-testid="team-agreement-sign-out">
        {t("teamAgreement.signOutHint")}
      </Typography>
    </Stack>
  );
}
