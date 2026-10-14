import HandshakeIcon from "@mui/icons-material/Handshake";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE, formatDateInWords } from "@/i18n/dates";
import { routing } from "@/i18n/routing";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { yearsPhrase } from "@/modules/registrations/domain/age";
import { readVolunteerAgreementLink } from "@/modules/volunteers/agreement";
import { VOLUNTEER_MINIMUM_AGE } from "@/modules/volunteers/domain/volunteer";
import CheckboxField from "@/shared/ui/CheckboxField";
import SubmitButton from "@/shared/ui/SubmitButton";
import { DENSITY } from "@/theme/density";
import { acceptVolunteerAgreementAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ accepted?: string; invalid?: string; unavailable?: string; refused?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The volunteer agreement's link (§758): the page an organizer's «Trimite linkul contractului» opens, for a person
 * they entered by hand — the agreement in force in the page's language, filled for this person (their name, the
 * role and what it asks, the event, its date and place), the two ticks (the agreement, the age) and one button.
 *
 * The GET reads and never writes (AGENTS.md §12.8): a mail scanner that opens the link accepts nothing. The button
 * is the POST that spends the link in the same statement that records the acceptance, and lands here again with a
 * word — `accepted`, `invalid` (spent, expired, replaced or cancelled: one answer, §13.2), `unavailable`, or the
 * ticks to give. The person's copy, as a PDF, follows by email.
 */
export default async function VolunteerAgreementLinkPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const asked = await searchParams;
  const t = await getTranslations("Volunteers");
  const tLegal = await getTranslations("Legal");
  const age = yearsPhrase(VOLUNTEER_MINIMUM_AGE, locale);

  // After the POST the link is spent or known to be dead: the page says so without reading it again.
  const view = asked.accepted || asked.invalid || asked.unavailable ? null : await readVolunteerAgreementLink(getDb(), token, locale, new Date());
  const refused = new Set((asked.refused ?? "").split(",").filter((tick) => tick === "agreement" || tick === "adult"));

  return (
    <Container id="main" component="main" maxWidth="md" sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={{ fontSize: "1.5rem" }}>
        {t("agreement.title")}
      </Typography>

      {asked.accepted ? (
        <Alert severity="success" role="status" data-testid="volunteer-agreement-accepted">
          {t("agreement.accepted")}
        </Alert>
      ) : asked.unavailable || view?.status === "noAgreement" ? (
        <Alert severity="info" data-testid="volunteer-agreement-unavailable">
          {t("agreement.noAgreement")}
        </Alert>
      ) : !view || view.status !== "open" ? (
        <Alert severity="warning" data-testid="volunteer-agreement-invalid">
          {t("agreement.invalid")}
        </Alert>
      ) : (
        <Stack spacing={2}>
          {/* The role the organizers gave, or — none yet — the roles the person chose (§761). */}
          <Typography>
            {view.roleName !== null
              ? t("agreement.intro", { name: view.name, event: view.eventTitle, role: view.roleName })
              : t("agreement.introChosen", { name: view.name, event: view.eventTitle, roles: view.chosenRoleNames.join(", ") })}
          </Typography>

          {/* The text in force, filled for this person; the moment of acceptance stays a blank until it happens. */}
          <Box component="section" aria-label={view.document.title} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2 }} data-testid="volunteer-agreement-text">
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

          {/* The two ticks — the house's CheckboxField, the refusal said at the box (§616) — and the one button. */}
          <Stack component="form" action={acceptVolunteerAgreementAction} spacing={1.5} data-testid="volunteer-agreement-form">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="token" value={token} />
            <CheckboxField
              name="agreement"
              id="volunteer-agreement-accept"
              required
              error={refused.has("agreement") ? t("agreement.errors.agreement") : undefined}
              requiredMessage={t("agreement.errors.agreement")}
            >
              {t("agreement.accept")}
            </CheckboxField>
            <CheckboxField
              name="adult"
              id="volunteer-agreement-adult"
              required
              error={refused.has("adult") ? t("agreement.errors.adult", { age }) : undefined}
              requiredMessage={t("agreement.errors.adult", { age })}
            >
              {t("agreement.adult", { age })}
            </CheckboxField>
            <Box>
              <SubmitButton label={t("agreement.submit")} pendingLabel={t("agreement.submitting")} size="large">
                <HandshakeIcon />
              </SubmitButton>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {t("agreement.paper")}
            </Typography>
          </Stack>
        </Stack>
      )}
    </Container>
  );
}
