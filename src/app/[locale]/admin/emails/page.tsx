import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import type { EmailLocale } from "@/infrastructure/email/adapter";
import { renderBilingual } from "@/modules/notifications/templates";
import { EMAIL_SAMPLE_FAMILY } from "@/modules/notifications/domain/email-sample";
import {
  emailCopyPrefill,
  emailSampleActionUrl,
  emailSampleFor,
  sampleLanguagesOf,
  sampleValuesIn,
} from "@/modules/notifications/email-copy-fields";
import { getDb } from "@/db/client";
import { resolveContactRecipients } from "@/modules/contact/domain/recipients";
import { readContactRecipients } from "@/modules/contact/recipients";
import { readDeadlines } from "@/modules/deadlines/deadlines";
import { deadlineWords } from "@/modules/deadlines/domain/duration-words";
import DeadlinesPanel from "@/modules/deadlines/ui/DeadlinesPanel";
import ContactRecipientsPanel from "@/modules/contact/ui/ContactRecipientsPanel";
import { replyToHeader, resolveShownContactAddresses } from "@/modules/contact/domain/shown-address";
import { readShownContactAddress } from "@/modules/contact/shown-address";
import ShownAddressPanel from "@/modules/contact/ui/ShownAddressPanel";
import { readClubNotices } from "@/modules/notifications/club-notices";
import { resolveDeclarationCopies } from "@/modules/notifications/domain/club-notices";
import { copyFor } from "@/modules/notifications/domain/email-copy";
import { NEVER_QUEUED_MESSAGE_TYPES } from "@/modules/notifications/domain/never-queued";
import { readEmailCopy } from "@/modules/notifications/email-copy";
import { readEmailPlan } from "@/modules/notifications/email-plan";
import { readOutboxQueue } from "@/modules/notifications/queue";
import EmailCopyEditor from "@/modules/notifications/ui/EmailCopyEditor";
import EmailPlanPanel from "@/modules/notifications/ui/EmailPlanPanel";
import EmailTransportPanel from "@/modules/notifications/ui/EmailTransportPanel";
import { roadsByMessageType } from "@/modules/notifications/domain/email-transport";
import { readEmailTransport } from "@/modules/notifications/email-transport";
import ClubNoticesPanel from "@/modules/notifications/ui/ClubNoticesPanel";
import OutboxQueuePanel from "@/modules/notifications/ui/OutboxQueuePanel";
import ParticipantEmailsPanel from "@/modules/notifications/ui/ParticipantEmailsPanel";
import UpcomingEmailsPanel from "@/modules/notifications/ui/UpcomingEmailsPanel";
import { FORECAST_HORIZON_DAYS, forecastAutomaticEmails } from "@/modules/notifications/forecast";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { canEditTexts, canManageRegistrations, canReadRegistrations, canSendNewsletter } from "@/modules/staff-identity/domain/roles";
import { DEFAULT_CONFIRMATION_OPENS_DAYS } from "@/modules/registrations/domain/hold-deadlines";
import { readAddressCap } from "@/modules/registrations/address-cap";
import { countForm } from "@/i18n/count-form";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ lang?: string; saved?: string; error?: string; sent?: string; message?: string }>;
};

/** Nothing queues these any more (§331, `domain/never-queued.ts`): listed last, and said so. */
const NEVER_QUEUED = NEVER_QUEUED_MESSAGE_TYPES;

/**
 * The organizer's message (§364) is written per send, on the event's page: its card previews the
 * sample one (`domain/email-sample.ts`) and says where it is written, with no words editor under
 * it and no sample-value warning over it.
 */
function perSend(messageType: EmailMessageType): boolean {
  // The newsletter too (§NNN): written in its own composer, on the backoffice's «Newsletter» page.
  return messageType === "ORGANIZER_MESSAGE" || messageType === "NEWSLETTER";
}

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
  const { lang, saved, error, sent, message } = await searchParams;
  const emailLocale: EmailLocale = lang === "en" ? "en" : lang === "ro" ? "ro" : locale;
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
  // Which message's words were just saved (§336): the save names it, and only a real type counts.
  const copySaved = saved === "emailCopy" || saved === "emailCopyReset" || saved === "emailCopySamples";
  const savedMessage = types.find((candidate) => candidate === message);

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
  // The club's deadlines (§377), straight through like the words: the panel that sets them, the
  // when-lines that state them, the previews that print them and the forecast (§383), as they now stand.
  const deadlinesRead = readDeadlines(db);
  const [plan, transport, volume, recipients, queue, notices, written, deadlines, forecast, addressCap, shownAddress] = await Promise.all([
    readEmailPlan(db),
    // Which road each group takes, Gmail's cap and pace (§NNN), beside the plan it spends less of.
    readEmailTransport(db),
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
    deadlinesRead,
    /*
      What the platform will send on its own in the coming days (§383), in the club's deadlines as
      read above — one read, both uses. Counts and event titles only, never a recipient, so every
      reader of this page sees it.
    */
    deadlinesRead.then(({ deadlines: inForce }) => forecastAutomaticEmails(db, { now, horizonDays: FORECAST_HORIZON_DAYS, deadlines: inForce })),
    // How many registrations one address may carry at an event (§389), straight through like the deadlines.
    readAddressCap(db),
    // «Adresa de contact afișată» (§NNN): what the site shows and every email's Reply-To.
    readShownContactAddress(db),
  ]);
  const t = await getTranslations("Admin");
  // The page's own sentences in the page's language; the previews carry the numbers in `timings`.
  const pageWords = deadlineWords(locale, deadlines.deadlines);
  const perAddress = addressCap.cap.registrationsPerAddress;
  const whenValues = {
    confirmation: pageWords.confirmation,
    hold: pageWords.hold,
    offer: pageWords.offer,
    reminder: pageWords.reminder ?? "",
    // The club's limit per address, for the one message that states it (§389).
    people: t(`emails.addressCap.people.${countForm(perAddress, locale)}`, { count: perAddress }),
  };
  /*
    When each message goes, in the club's numbers (§377). The reminder's lines say "off by default"
    when the club sends none — an event may still choose one — and the declaration's last call is a
    sentence of its own after its when-line, for the same reason.
  */
  const reminderOff = pageWords.reminder === null;
  const whenOf = (type: EmailMessageType): string => {
    if (type === "EVENT_REMINDER" && reminderOff) return t("emails.reminderOff.when");
    const line = t(`emails.when.${type}`, whenValues);
    if (type !== "COMPLETE_DECLARATION") return line;
    return `${line} ${reminderOff ? t("emails.lastCallOff") : t("emails.lastCall", whenValues)}`;
  };
  const whenShortOf = (type: EmailMessageType): string =>
    type === "EVENT_REMINDER" && reminderOff ? t("emails.reminderOff.whenShort") : t(`emails.whenShort.${type}`, whenValues);
  const resolvedRecipients = resolveContactRecipients(recipients, env.CONTACT_FORM_TO);

  const emailsPath = getPathname({ locale, href: "/admin/emails" });
  // The club's deadlines (§377), as the outbox gives every message: the numbers the words say.
  const timings = {
    confirmationHours: deadlines.deadlines.confirmationHours,
    holdMinutes: deadlines.deadlines.holdMinutes,
    offerHours: deadlines.deadlines.offerHours,
    reminderHours: deadlines.deadlines.reminderHours,
    // The window a new event gets unless its organizer changes it (§104), as the column does.
    confirmationOpensDays: DEFAULT_CONFIRMATION_OPENS_DAYS,
  };
  const actionUrl = emailSampleActionUrl(emailLocale);
  // The Reply-To the send sets (§NNN): the preview's "or reply to this email" line follows it, never the env alone.
  const replyTo = replyToHeader(resolveShownContactAddresses(shownAddress, env.EMAIL_REPLY_TO));
  const mayWrite = canEditTexts(staff.role);

  const cards = types.map((messageType) => {
    /*
      The sample the preview is rendered with (§91) — one constant, `domain/email-sample.ts`, which
      is also what the save refuses to store (§359), so the preview and the guard cannot drift. Each
      half in its own language's sample, and without the fields this message never carries (§373,
      email follow-up: the legend under the editor dims them, and the preview says the same).
    */
    const sample = emailSampleFor(messageType, emailLocale);
    // The club's deadlines in force (§377), which the send gives every message as numbers.
    sample.timings = timings;
    sample.replyTo = replyTo;
    // And the club's limit per address, on the message that states it (§389): the link's shape —
    // with who the sample address holds and the person its form named (§NNN).
    if (messageType === "REGISTER_ANOTHER_PERSON") {
      sample.addressCap = perAddress;
      sample.familyRegistered = [...EMAIL_SAMPLE_FAMILY.registered];
      sample.familyPersonName = EMAIL_SAMPLE_FAMILY.personName;
      sample.familyPersonBirthDate = EMAIL_SAMPLE_FAMILY.personBirthDate;
    }
    // Bilingual, as it goes out (§96): the chosen language first, the other under a rule —
    // and through the club's own words where it has written some (§247), so the preview is
    // what a participant will actually receive rather than what the platform ships.
    const content = renderBilingual(messageType, emailLocale, sample, actionUrl, written.copy);
    /*
      The organizer's message has no stored words to read or warn about (§364): it is written per
      send, the save refuses an entry for it and the send ignores one, so a hand-made entry in the
      setting is neither shown nor flagged here — the card would be saying something untrue.
    */
    const own = perSend(messageType) ? null : copyFor(written.copy, messageType, emailLocale);
    /*
      A saved text that still holds a value of the sample (§359): saved from the editor before it
      started from the fields, every participant would read "Crosul de toamnă" whatever their event.
      Said on the card, closed or open, to whoever may write the words — nobody else can act on it.
    */
    const samples = mayWrite && own ? sampleValuesIn(own, messageType, emailLocale) : [];
    /*
      And in which languages — both, whichever tab is open: every message goes out in both (§96),
      so an English text holding the sample's title reaches every Romanian participant too. The
      closed card names the language to switch to; the warning and the button above stay with the
      language being edited.
    */
    const sampleLanguages = mayWrite && !perSend(messageType) ? sampleLanguagesOf(written.copy, messageType) : [];
    return { messageType, content, own, samples, sampleLanguages };
  });
  const anySamples = cards.some((card) => card.sampleLanguages.length > 0);

  return (
    <Stack spacing={3}>
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved === "emailPlan" && <Alert severity="success">{t("emails.plan.saved")}</Alert>}
        {saved === "emailTransport" && <Alert severity="success">{t("emails.transport.saved")}</Alert>}
        {saved === "contactRecipients" && <Alert severity="success">{t("emails.contacts.saved")}</Alert>}
        {saved === "shownContactAddress" && <Alert severity="success">{t("emails.shownAddress.saved")}</Alert>}
        {saved === "outboxSent" && <Alert severity="success">{t("outbox.sentNow", { count: sent ?? "0" })}</Alert>}
        {saved === "clubNotices" && <Alert severity="success">{t("emails.clubNotices.saved")}</Alert>}
        {saved === "emailCopy" && <Alert severity="success">{t("emails.copy.saved")}</Alert>}
        {saved === "emailCopyReset" && <Alert severity="success">{t("emails.copy.resetDone")}</Alert>}
        {saved === "deadlines" && <Alert severity="success">{t("emails.deadlines.saved")}</Alert>}
        {saved === "addressCap" && <Alert severity="success">{t("emails.addressCap.saved")}</Alert>}
        {saved === "emailCopySamples" && <Alert severity="success">{t("emails.copy.samplesReplaced")}</Alert>}
      </Box>

      {/*
        Every panel below is a fold, closed (§336), and opens by itself for what the reader must
        see: its own save, "send now"'s answer, something waiting. A kept form's refusal (§315)
        is not in this list because it never reaches the page as a parameter — `shared/ui/fold.ts`
        says how it stays in view.
      */}
      <EmailPlanPanel locale={locale} plan={plan} volume={volume} mayEdit={mayEditEmail} openWhen={{ saved: saved === "emailPlan" }} />

      {/* Mailgun or the club's Gmail, per group (§NNN): what spends the plan above, and what does not. */}
      <EmailTransportPanel
        locale={locale}
        setting={transport}
        volume={volume}
        mayEdit={mayEditEmail}
        openWhen={{ saved: saved === "emailTransport" }}
        neverQueued={NEVER_QUEUED}
      />

      {/* What is actually queued, and the button that sends it (§243). "Send now" is the one
          form on this page that answers through `?error=`, so an error here is its own. */}
      {queue && (
        <OutboxQueuePanel
          locale={locale}
          queue={queue}
          volume={volume}
          mayEdit={mayEditEmail}
          openWhen={{ saved: saved === "outboxSent", refused: Boolean(error) }}
        />
      )}

      {/* The club's own copies (§244, §245), beside the contact recipients they mirror. */}
      {notices && (
        <ClubNoticesPanel
          locale={locale}
          notices={notices}
          declarations={resolveDeclarationCopies(notices, env.DECLARATIONS_ARCHIVE_TO)}
          mayEdit={mayEditEmail}
          openWhen={{ saved: saved === "clubNotices" }}
        />
      )}

      <ContactRecipientsPanel
        locale={locale}
        recipients={recipients}
        resolved={resolvedRecipients}
        mayEdit={mayEditEmail}
        openWhen={{ saved: saved === "contactRecipients" }}
      />

      {/* «Adresa de contact afișată» (§NNN), beside who receives the form: both are "where the club is written to". */}
      <ShownAddressPanel
        locale={locale}
        state={shownAddress}
        mailbox={env.EMAIL_REPLY_TO ?? null}
        resolved={resolveShownContactAddresses(shownAddress, env.EMAIL_REPLY_TO)}
        mayEdit={mayEditEmail}
        openWhen={{ saved: saved === "shownContactAddress" }}
      />
      {/*
        The newsletter (§NNN) has its own page in the menu since the owner's 2026-09-26 "un meniu
        suplimentar în backoffice cu «Newsletter»": one line here pointing at it, for the roles that
        may open it — the page answers 404 to anybody else, so nobody is offered a door that refuses.
      */}
      {canSendNewsletter(staff.role) && (
        <Typography variant="body2" data-testid="newsletter-link">
          <Link href="/admin/newsletter">{t("emails.newsletterLink")}</Link>{" "}
          <Typography component="span" variant="body2" color="text.secondary">
            {t("emails.newsletterLinkHelp")}
          </Typography>
        </Typography>
      )}

      {/* "Termene" (§377): the numbers the messages below state, right above them, so a change is read back in the next card. */}
      <DeadlinesPanel
        locale={locale}
        state={deadlines}
        mayEdit={mayEditEmail}
        openWhen={{ saved: saved === "deadlines" || saved === "addressCap" }}
        addressCap={addressCap}
      />

      {/*
        What goes out on its own next (§383), directly above the cards each row links to. The
        club-copy line names the club's addresses, so it is for the readers the club's lists are for.
      */}
      <UpcomingEmailsPanel
        locale={locale}
        rows={forecast}
        horizonDays={FORECAST_HORIZON_DAYS}
        clubCopies={notices ? notices.participants.bcc : null}
        roads={roadsByMessageType(transport, volume.gmailConfigured)}
      />

      <ParticipantEmailsPanel
        title={t("emails.title")}
        intro={t("emails.intro")}
        aside={t("emails.aside", { count: types.length, language: t(`emails.lang.${emailLocale}`) })}
        languageLabel={t("emails.langLabel")}
        /*
          Which language is previewed, as sub-tabs rather than two links (§268; the owner,
          2026-09-22: "these need to be tabs") — inside the card since §336, because it switches
          the previews and the words being edited and nothing else on this page. Plain anchors
          rendered on the server; the fragment lands the reader back on the card, and the card
          opens because a language was chosen (`inUse` below).
        */
        languages={routing.locales.map((candidate) => ({
          href: `${emailsPath}?lang=${candidate}#participant-emails`,
          label: t(`emails.lang.${candidate}`),
          active: candidate === emailLocale,
        }))}
        // A saved text holding sample values, in either language, opens the card to whoever may fix it (§359).
        openWhen={{ saved: copySaved, inUse: lang !== undefined, attention: anySamples }}
        messages={cards.map(({ messageType, content, own, samples, sampleLanguages }) => {
          return {
            type: messageType,
            name: t(`emails.types.${messageType}`),
            whenShort: whenShortOf(messageType),
            // The three types nothing queues any more are said to be so on the closed card (§331).
            ...(NEVER_QUEUED.has(messageType) ? { neverSent: t("emails.neverSent") } : {}),
            ...(sampleLanguages.length > 0
              ? { sampleValues: t("emails.copy.sampleMarker", { languages: sampleLanguages.map((language) => language.toUpperCase()).join(", ") }) }
              : {}),
            when: whenOf(messageType),
            subjectLine: `${t("emails.subject")}: ${content.subject}`,
            html: content.html,
            // The card whose words were just saved opens with the card around it, so the preview
            // that changed is the first thing in view (§336).
            justSaved: copySaved && savedMessage === messageType,
            // The words, for whoever writes them (§103, §247). Under the preview it changes. The
            // organizer's message has none to keep: it is written per send, on the event's page (§364).
            editor: perSend(messageType) ? (
              <Alert severity="info" sx={{ mb: 2 }} data-testid="email-per-send">
                {messageType === "NEWSLETTER" ? t("emails.perSendNewsletter") : t("emails.perSend")}
              </Alert>
            ) : mayWrite ? (
              <EmailCopyEditor
                locale={locale}
                emailLocale={emailLocale}
                messageType={messageType}
                written={own}
                /* The platform's own words with the fields in them, never the preview's sample
                   values (§359): what the box starts from while the club has written nothing. */
                shipped={emailCopyPrefill(messageType, emailLocale, replyTo)}
                samples={samples}
                // The deadlines the preview above prints (§377), for the legend's four rows.
                deadlines={deadlines.deadlines}
              />
            ) : undefined,
          };
        })}
      />
    </Stack>
  );
}
