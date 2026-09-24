import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import SubNav from "@/shared/ui/SubNav";
import type { EmailLocale } from "@/infrastructure/email/adapter";
import { buildTemplateContent, renderBilingual, type TemplateData } from "@/modules/notifications/templates";
import { getDb } from "@/db/client";
import { resolveContactRecipients } from "@/modules/contact/domain/recipients";
import { readContactRecipients } from "@/modules/contact/recipients";
import ContactRecipientsPanel from "@/modules/contact/ui/ContactRecipientsPanel";
import { readClubNotices } from "@/modules/notifications/club-notices";
import { resolveDeclarationCopies } from "@/modules/notifications/domain/club-notices";
import { copyFor } from "@/modules/notifications/domain/email-copy";
import { NEVER_QUEUED_MESSAGE_TYPES } from "@/modules/notifications/domain/never-queued";
import { readEmailCopy } from "@/modules/notifications/email-copy";
import { readEmailPlan } from "@/modules/notifications/email-plan";
import { readOutboxQueue } from "@/modules/notifications/queue";
import EmailCopyEditor from "@/modules/notifications/ui/EmailCopyEditor";
import EmailPlanPanel from "@/modules/notifications/ui/EmailPlanPanel";
import ClubNoticesPanel from "@/modules/notifications/ui/ClubNoticesPanel";
import OutboxQueuePanel from "@/modules/notifications/ui/OutboxQueuePanel";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { canEditTexts, canManageRegistrations, canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ lang?: string; saved?: string; error?: string; sent?: string }> };

/** Nothing queues these any more (§331, `domain/never-queued.ts`): listed last, and said so. */
const NEVER_QUEUED = NEVER_QUEUED_MESSAGE_TYPES;

/**
 * Reads the session, the plan and the contact recipients, and is returned to straight after
 * a save — so it may never be served from a cache. Without this the panel showed the values
 * it had before the press (found on 2026-09-20: clearing the recipients wrote the row and the
 * page went on saying the old addresses).
 */
export const dynamic = "force-dynamic";

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
  const staff = await requireStaff();
  const { lang, saved, error, sent } = await searchParams;
  const emailLocale: EmailLocale = lang === "en" ? "en" : lang === "ro" ? "ro" : locale;

  // The plan and the counts (§100), above the messages: what can still go out is the first
  // thing anybody opening this page on race day wants to know.
  const db = getDb();
  const now = new Date();
  /*
    The queue names recipients, which is participant data (§15.11), so it is read only for the
    roles that hold the participant list — the Organizer too, since §289 (the owner: "organizatorul
    ar trebui sa vada (readonly) chiar si pagina de status unde vede cate mailuri s-au trimis").
    A Redactor opening this page sees the templates, the plan's figures and the words.

    Reading and changing are two gates (§291). Every form on this page — the plan, "send now",
    the club's copies, the contact recipients — is the Administrator's, and each service refuses
    anybody else; the panels take `mayEdit` so that refusal is never the first thing a reader
    learns about it. The owner met exactly that: "Salvează planul" and "Salvează destinatarii"
    drawn for an Organizer who could only be told FORBIDDEN.
  */
  const maySeeQueue = canReadRegistrations(staff.role);
  const mayEditEmail = canManageRegistrations(staff.role);
  const [plan, volume, recipients, queue, notices, written] = await Promise.all([
    readEmailPlan(db),
    readEmailVolumeToday(db, now),
    // Who reads "Scrie-ne" (§164): the same page, because both are "what the club's email does".
    readContactRecipients(db),
    maySeeQueue ? readOutboxQueue(db) : null,
    // Who receives a signed declaration and who is told about a confirmation (§244, §245):
    // participant data again, so the same gate as the queue.
    maySeeQueue ? readClubNotices(db) : null,
    /*
      The club's own wording (§247). Read straight through rather than from the send path's
      half-minute memo: this page is where somebody presses Save and immediately looks at the
      preview, and showing them what they saved thirty seconds ago would read as a lost edit.
    */
    readEmailCopy(db),
  ]);
  const resolvedRecipients = resolveContactRecipients(recipients, env.CONTACT_FORM_TO);

  const t = await getTranslations("Admin");
  const emailsPath = getPathname({ locale, href: "/admin/emails" });
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
    // "Linkuri și fișiere" (§332): the sample event has some, so the preview shows the line.
    eventLinksUrl: `${env.APP_BASE_URL}/${emailLocale}/EXAMPLE-event#links`,
    manageUrl: `${env.APP_BASE_URL}/${emailLocale}/EXAMPLE`,
    // The public list's switch on the confirmation (§143): the sample runner is on the list.
    listConsentUrl: `${env.APP_BASE_URL}/${emailLocale}/EXAMPLE-list`,
    listed: true,
    // The staff invitation (§141): a made-up colleague, added by a made-up administrator.
    staffRole: "Organizator",
    inviterName: "Florin",
    staffEmail: "ana.popescu@example.org",
    signInUrl: `${env.APP_BASE_URL}/${emailLocale}/EXAMPLE`,
    // "Detalii actualizate" and "Eveniment anulat" (§331): a new place and start, the
    // organizer's note, and a reason — read only by those two messages' templates.
    updateChanges: ["place", "time"],
    organizerNote: tRo ? "Ne vedem la intrarea dinspre Livada Poștei, lângă panoul cu harta." : "We meet at the Livada Poștei entrance, by the map board.",
    cancellationReason: tRo ? "Avertizare meteo de cod portocaliu pentru Tâmpa: traseul nu este sigur." : "An orange weather warning for Tâmpa: the route is not safe.",
  };
  const actionUrl = `${env.APP_BASE_URL}/${emailLocale}/EXAMPLE`;

  /*
    Every type, as it would go out — and the three that nothing queues any more said to be so and
    listed last, rather than left looking like mail somebody receives (§331; the owner: "I want to
    know exactly when and if participants get email alerts"). They stay in the catalogue because
    the enum cannot lose a value (expand only, `AGENTS.md` §7.6) and a row sent long ago still
    renders through them.
  */
  const types = [
    ...(emailMessageType.enumValues as readonly EmailMessageType[]).filter((type) => !NEVER_QUEUED.has(type)),
    ...(emailMessageType.enumValues as readonly EmailMessageType[]).filter((type) => NEVER_QUEUED.has(type)),
  ];

  return (
    <Stack spacing={3}>
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved === "emailPlan" && <Alert severity="success">{t("emails.plan.saved")}</Alert>}
        {saved === "contactRecipients" && <Alert severity="success">{t("emails.contacts.saved")}</Alert>}
        {saved === "outboxSent" && <Alert severity="success">{t("outbox.sentNow", { count: sent ?? "0" })}</Alert>}
        {saved === "clubNotices" && <Alert severity="success">{t("emails.clubNotices.saved")}</Alert>}
        {saved === "emailCopy" && <Alert severity="success">{t("emails.copy.saved")}</Alert>}
        {saved === "emailCopyReset" && <Alert severity="success">{t("emails.copy.resetDone")}</Alert>}
      </Box>

      <EmailPlanPanel locale={locale} plan={plan} volume={volume} mayEdit={mayEditEmail} />

      {/* What is actually queued, and the button that sends it (§243). */}
      {queue && <OutboxQueuePanel locale={locale} queue={queue} volume={volume} mayEdit={mayEditEmail} />}

      {/* The club's own copies (§244, §245), beside the contact recipients they mirror. */}
      {notices && (
        <ClubNoticesPanel
          locale={locale}
          notices={notices}
          declarations={resolveDeclarationCopies(notices, env.DECLARATIONS_ARCHIVE_TO)}
          mayEdit={mayEditEmail}
        />
      )}

      <ContactRecipientsPanel locale={locale} recipients={recipients} resolved={resolvedRecipients} mayEdit={mayEditEmail} />

      <Box>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("emails.title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {t("emails.intro")}
        </Typography>
        {/*
          Which language is previewed, as sub-tabs rather than two links (the owner, 2026-09-22:
          "these need to be tabs"). Two underlined words in a row read as prose — "Română
          English" — and the one that was current was distinguished by weight alone, which is
          the signal BR-REQ-041-01 says may not stand on its own. `SubNav` is the row §265
          already uses for a panel switch inside a section, so this is the same control the
          configuration screens carry, and it stays a plain anchor rendered on the server.
        */}
        <Box sx={{ mt: 1.5 }}>
          <SubNav
            items={routing.locales.map((candidate) => ({
              href: `${emailsPath}?lang=${candidate}`,
              label: t(`emails.lang.${candidate}`),
              active: candidate === emailLocale,
            }))}
          />
        </Box>
      </Box>

      {types.map((messageType) => {
        // Bilingual, as it goes out (§96): the chosen language first, the other under a rule —
        // and through the club's own words where it has written some (§247), so the preview is
        // what a participant will actually receive rather than what the platform ships.
        const content = renderBilingual(messageType, emailLocale, sample, actionUrl, written.copy);
        const { html } = content;
        // The platform's own text for this message, as the editor's starting point.
        const shipped = buildTemplateContent(messageType, emailLocale, sample, actionUrl);
        return (
          <Box key={messageType} component="details" sx={BOXED_DISCLOSURE_SX}>
            <Typography component="summary" variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t(`emails.types.${messageType}`)}
              {NEVER_QUEUED.has(messageType) && (
                <Typography component="span" variant="body2" color="warning.main" sx={{ ml: 1, fontWeight: 600 }}>
                  {t("emails.neverSent")}
                </Typography>
              )}
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
            {/* The words, for whoever writes them (§103, §247). Under the preview it changes. */}
            {canEditTexts(staff.role) && (
              <EmailCopyEditor
                locale={locale}
                emailLocale={emailLocale}
                messageType={messageType}
                written={copyFor(written.copy, messageType, emailLocale)}
                /* The platform's own text is plain sentences — the rich parts in this list only ever
                 come from something the club wrote, and this is the fallback for when it has
                 not (§270). */
              shipped={{
                subject: shipped.subject,
                paragraphs: shipped.paragraphs.filter((part): part is string => typeof part === "string"),
              }}
              />
            )}
          </Box>
        );
      })}
    </Stack>
  );
}
