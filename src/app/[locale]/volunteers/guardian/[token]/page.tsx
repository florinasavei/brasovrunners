import HandshakeIcon from "@mui/icons-material/Handshake";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE, formatDateInWords } from "@/i18n/dates";
import { routing } from "@/i18n/routing";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { readVolunteerGuardianLink } from "@/modules/volunteers/guardian";
import { VOLUNTEER_GUARDIAN_NAME_MAX } from "@/modules/volunteers/domain/volunteer";
import PublicFlash from "@/shared/feedback/PublicFlash";
import CheckboxField from "@/shared/ui/CheckboxField";
import SubmitButton from "@/shared/ui/SubmitButton";
import { DENSITY } from "@/theme/density";
import { acceptVolunteerGuardianAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ accepted?: string; invalid?: string; unavailable?: string; refused?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const BOXES = ["agreement", "typedName"] as const;

/**
 * The guardian's link (§NNN, amending §758): the page the email to the parent or guardian of a volunteer under eighteen
 * opens — the volunteer agreement in force in the page's language, filled for the volunteer, their roles and the event,
 * with the guardian's name in the minors' clause; one tick, the guardian's typed name — the acceptance itself — and one
 * button. The text is the same the volunteer accepted on the form; the guardian accepts it in their own name.
 *
 * The GET reads and never writes (AGENTS.md §12.8): a mail scanner that opens the link accepts nothing. The button is the
 * POST that spends the link in the same statement that records the acceptance, and lands here again with a word —
 * `accepted`, `invalid` (spent, expired, replaced, cancelled or no longer a minor: one answer, §13.2), `unavailable`, or
 * the boxes to fill. A token page, like every link page: per request, never indexed, never cached.
 */
export default async function VolunteerGuardianLinkPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const asked = await searchParams;
  const t = await getTranslations("Volunteers");
  const tLegal = await getTranslations("Legal");

  // After the POST the link is spent or known to be dead: the page says so without reading it again.
  const view = asked.accepted || asked.invalid || asked.unavailable ? null : await readVolunteerGuardianLink(getDb(), token, locale, new Date());
  const refused = new Set((asked.refused ?? "").split(",").filter((box) => (BOXES as readonly string[]).includes(box)));

  return (
    <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("guardian.title")}
      </Typography>

      {asked.accepted ? (
        <>
          <Alert severity="success" role="status" data-testid="volunteer-guardian-accepted">
            {t("guardian.accepted")}
          </Alert>
          {/* The toast the acceptance flashed (§427), here and on no other state of this page. */}
          <PublicFlash accept={["volunteerGuardianAccepted"]} />
        </>
      ) : asked.unavailable || view?.status === "noAgreement" ? (
        <Alert severity="info" data-testid="volunteer-guardian-unavailable">
          {t("guardian.noAgreement")}
        </Alert>
      ) : !view || view.status !== "open" ? (
        <Alert severity="warning" data-testid="volunteer-guardian-invalid">
          {t("guardian.invalid")}
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Typography>{t("guardian.intro", { guardian: view.guardianName, volunteer: view.volunteerName, event: view.eventTitle })}</Typography>

          {/* The text in force, filled for the volunteer, with the guardian's name in the minors' clause; the moment stays a blank until it happens. */}
          <Box component="section" aria-label={view.document.title} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2 }} data-testid="volunteer-guardian-text">
            <Typography component="h2" variant="h2" sx={{ fontSize: "1.25rem" }} gutterBottom>
              {view.document.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {tLegal("inForce", {
                version: view.document.version,
                date: formatDateInWords(new Date(view.document.effectiveAt), { locale, timeZone: CLUB_TIME_ZONE }),
              })}
            </Typography>
            <LegalDocumentBody body={view.document.body} values={view.values} />
          </Box>

          {/* The tick — the house's CheckboxField, the refusal said at the box (§616) —, the typed name and the one button. */}
          <Stack component="form" action={acceptVolunteerGuardianAction} spacing={2} data-testid="volunteer-guardian-form">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <CheckboxField
              name="agreement"
              id="volunteer-guardian-accept"
              required
              error={refused.has("agreement") ? t("guardian.errors.agreement", { volunteer: view.volunteerName }) : undefined}
              requiredMessage={t("guardian.errors.agreement", { volunteer: view.volunteerName })}
            >
              {t("guardian.accept", { volunteer: view.volunteerName })}
            </CheckboxField>
            <TextField
              id="volunteer-guardian-typed-name"
              name="typedName"
              label={t("guardian.typedName")}
              helperText={refused.has("typedName") ? t("guardian.errors.typedName") : t("guardian.typedNameHelp")}
              required
              fullWidth
              autoComplete="name"
              defaultValue=""
              error={refused.has("typedName")}
              slotProps={{ htmlInput: { maxLength: VOLUNTEER_GUARDIAN_NAME_MAX } }}
            />
            <Box>
              <SubmitButton label={t("guardian.submit")} pendingLabel={t("guardian.submitting")} size="large">
                <HandshakeIcon />
              </SubmitButton>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {t("guardian.paper")}
            </Typography>
          </Stack>
        </Stack>
      )}
    </Container>
  );
}
