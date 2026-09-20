import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import type { EmailLocale } from "@/infrastructure/email/adapter";
import { renderBilingual, type TemplateData } from "@/modules/notifications/templates";
import { getDb } from "@/db/client";
import { resolveContactRecipients } from "@/modules/contact/domain/recipients";
import { readContactRecipients } from "@/modules/contact/recipients";
import ContactRecipientsPanel from "@/modules/contact/ui/ContactRecipientsPanel";
import { readEmailPlan } from "@/modules/notifications/email-plan";
import EmailPlanPanel from "@/modules/notifications/ui/EmailPlanPanel";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ lang?: string; saved?: string; error?: string }> };

/**
 * Every email the platform sends, rendered with sample data (`DECISIONS.md` §91; the owner:
 * "I must be able to see the email templates that get sent to them").
 *
 * The same `buildTemplateContent` and `renderContent` the outbox worker uses, so what is on
 * this page is what a participant gets, subject and all — there is no second copy of the
 * wording to drift. The sample is a made-up runner at a made-up event; the links point at
 * the site with `EXAMPLE` where a token would be, so nothing here can be acted on. Each
 * message sits in a sandboxed `<iframe srcdoc>`, because an email has its own `<html>` and
 * its own styles and must not inherit the backoffice's.
 */
export default async function EmailTemplatesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireStaff();
  const { lang, saved, error } = await searchParams;
  const emailLocale: EmailLocale = lang === "en" ? "en" : lang === "ro" ? "ro" : locale;

  // The plan and the counts (§100), above the messages: what can still go out is the first
  // thing anybody opening this page on race day wants to know.
  const db = getDb();
  const now = new Date();
  const [plan, volume, recipients] = await Promise.all([
    readEmailPlan(db),
    readEmailVolumeToday(db, now),
    // Who reads "Scrie-ne" (§164): the same page, because both are "what the club's email does".
    readContactRecipients(db),
  ]);
  const resolvedRecipients = resolveContactRecipients(recipients, env.CONTACT_FORM_TO);

  const t = await getTranslations("Admin");
  const tRo = emailLocale === "ro";
  const sample: TemplateData = {
    participantName: tRo ? "Ana Popescu" : "Ana Popescu",
    eventTitle: tRo ? "Crosul de toamnă" : "The autumn cross",
    eventLocationName: tRo ? "Stația de telecabină Tâmpa" : "Tâmpa cable-car station",
    eventStartsAtFormatted: tRo ? "duminică, 4 octombrie 2026, 09:00" : "Sunday, 4 October 2026, 09:00",
    eventStartsAtFormattedOther: tRo ? "Sunday, 4 October 2026, 09:00" : "duminică, 4 octombrie 2026, 09:00",
    currentStatus: tRo ? "confirmată" : "confirmed",
    checkinCode: "EXAMPL",
    checkinQrUrl: `${env.APP_BASE_URL}/api/registrations/qr/EXAMPL.png`,
    bibNumber: 42,
    eventMapUrl: `${env.APP_BASE_URL}/#map`,
    eventChecklist: tRo ? "Apă, o haină de ploaie, bună dispoziție" : "Water, a rain jacket, good spirits",
    replyTo: env.EMAIL_REPLY_TO ?? undefined,
    thanksUrl: `${env.APP_BASE_URL}/#results`,
    declarationPdfUrl: `${env.APP_BASE_URL}/api/registrations/declaration/EXAMPLE`,
    eventUrl: `${env.APP_BASE_URL}/${emailLocale}/EXAMPLE-event`,
    eventRulesUrl: `${env.APP_BASE_URL}/${emailLocale}/EXAMPLE-event#rules`,
    eventScheduleUrl: `${env.APP_BASE_URL}/${emailLocale}/EXAMPLE-event#schedule`,
    manageUrl: `${env.APP_BASE_URL}/${emailLocale}/EXAMPLE`,
    // The staff invitation (§141): a made-up colleague, added by a made-up administrator.
    staffRole: "Organizator",
    inviterName: "Florin",
    staffEmail: "ana.popescu@example.org",
    signInUrl: `${env.APP_BASE_URL}/${emailLocale}/EXAMPLE`,
  };
  const actionUrl = `${env.APP_BASE_URL}/${emailLocale}/EXAMPLE`;

  const types = emailMessageType.enumValues as readonly EmailMessageType[];

  return (
    <Stack spacing={3}>
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved === "emailPlan" && <Alert severity="success">{t("emails.plan.saved")}</Alert>}
        {saved === "contactRecipients" && <Alert severity="success">{t("emails.contacts.saved")}</Alert>}
      </Box>

      <EmailPlanPanel locale={locale} plan={plan} volume={volume} />

      <ContactRecipientsPanel locale={locale} recipients={recipients} resolved={resolvedRecipients} />

      <Box>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("emails.title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {t("emails.intro")}
        </Typography>
        <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
          {routing.locales.map((candidate) => (
            <Link
              key={candidate}
              href={{ pathname: "/admin/emails", query: { lang: candidate } }}
              style={{ fontWeight: candidate === emailLocale ? 700 : 400, minHeight: 44, display: "inline-flex", alignItems: "center" }}
              aria-current={candidate === emailLocale ? "true" : undefined}
            >
              {t(`emails.lang.${candidate}`)}
            </Link>
          ))}
        </Stack>
      </Box>

      {types.map((messageType) => {
        // Bilingual, as it goes out (§96): the chosen language first, the other under a rule.
        const content = renderBilingual(messageType, emailLocale, sample, actionUrl);
        const { html } = content;
        return (
          <Box
            key={messageType}
            component="details"
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              px: 2,
              "& > summary": { cursor: "pointer", py: 1.5, listStyle: "revert" },
            }}
          >
            <Typography component="summary" variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t(`emails.types.${messageType}`)}
              <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                {t("emails.subject")}: {content.subject}
              </Typography>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t(`emails.when.${messageType}`)}
            </Typography>
            <Box
              component="iframe"
              srcDoc={html}
              sandbox=""
              title={t(`emails.types.${messageType}`)}
              sx={{ width: "100%", height: 620, border: 1, borderColor: "divider", borderRadius: 1, mb: 2 }}
            />
          </Box>
        );
      })}
    </Stack>
  );
}
