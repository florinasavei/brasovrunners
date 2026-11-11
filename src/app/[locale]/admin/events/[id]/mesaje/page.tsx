import { randomUUID } from "node:crypto";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { countForm } from "@/i18n/count-form";
import { formatDay } from "@/i18n/dates";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findEventForEditing } from "@/modules/content/events/repository";
import { typedStartShape } from "@/modules/events/domain/provisional-start";
import { readRepeatRule } from "@/modules/events/domain/repeat";
import { EMAIL_SAMPLE } from "@/modules/notifications/domain/email-sample";
import {
  ORGANIZER_BODY_MAX,
  ORGANIZER_SUBJECT_PLACEHOLDERS,
  ORGANIZER_SUBJECT_MAX,
  organizerMessageCost,
  organizerMessageDeferral,
  organizerMessagePace,
  PARTICIPANT_MESSAGE_AUDIENCES,
} from "@/modules/notifications/domain/organizer-message";
import { staffReserve } from "@/modules/notifications/domain/bulk";
import { OUTBOX_BATCH_SIZE } from "@/modules/notifications/outbox";
import { readJobCadence } from "@/modules/jobs/cadence";
import { PINGER_SLOT_MINUTES } from "@/modules/jobs/schedule";
import { countParticipantMessageAudiences, listParticipantMessages } from "@/modules/notifications/participant-messages";
import { withSendNowChoice } from "@/modules/notifications/domain/send-at-once";
import { sendNowChoiceFor } from "@/modules/notifications/send-now-choice";
import ParticipantMessageComposer, { type ComposerAudience } from "@/modules/notifications/ui/ParticipantMessageComposer";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { canMessageParticipants } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { isUuid } from "@/shared/ids";
import Panel from "@/shared/ui/Panel";
import { previewParticipantMessageAction, sendParticipantMessageAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ sent?: string; test?: string; duplicate?: string }>;
};

/** Reads the queue and the history, and is returned to right after a send. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * "Trimite un mesaj participanților" (`DECISIONS.md` §364; the owner, 2026-09-24: "I also want to
 * be able to send custom emails to people, in case something happens, e.g. bad weather, cancelled
 * event, etc!").
 *
 * One event's page, reached from the editor's immediate actions and from the registrations list
 * filtered by the event: who receives it — confirmed, waiting, owing the declaration, or all
 * three, each with its count — the subject and the message in Română and English, the message as
 * it will arrive, and Send behind a question that names how many. Under it, "Mesaje trimise":
 * what was sent before from here, by whom, to whom as a group, and how many.
 *
 * For whoever may write to the participants (`canMessageParticipants`: the Organizer and up, not
 * the Tehnic role); anybody else gets the 404 a typed address to a page that does not exist gets
 * (BR-REQ-060-01), and the actions refuse them again.
 *
 * **One date of a series is one event**: the message goes to that date's registrants. Writing to
 * every date ahead at once is left out (§364 says why) — each date's page has its own composer.
 */
export default async function ParticipantMessagesPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canMessageParticipants(actor.role)) notFound();
  // A malformed id is the same 404 an unknown one gets, not the query Postgres refuses (§376).
  if (!isUuid(id)) notFound();

  const db = getDb();
  const record = await findEventForEditing(db, id);
  if (!record) notFound();
  const { event, translations } = record;
  const title = translations.find((row) => row.locale === locale)?.title || translations[0]?.title || "";
  const { sent, test, duplicate } = await searchParams;

  const now = new Date();
  const [counts, volume, history] = await Promise.all([
    countParticipantMessageAudiences(db, event.id),
    readEmailVolumeToday(db, now),
    listParticipantMessages(db, event.id),
  ]);

  const t = await getTranslations("Admin");
  const tSite = await getTranslations("Site");
  /*
    «Completează cu textul de reminder» (the decision «Cere reconfirmarea»): the ready text in Romanian and in English
    from both catalogues, whatever the backoffice's language, its `{placeholders}` literal (`t.raw`) for the send to fill;
    the body is the paragraphs, a blank line between each, as `organizerParagraphs` reads them.
  */
  const reminderOf = async (language: "ro" | "en") => {
    const words = await getTranslations({ locale: language, namespace: "Admin" });
    const raw = (key: string) => words.raw(`participantMessages.reminderText.${key}`) as string;
    return { subject: raw("subject"), body: ["p1", "p2", "p3", "p4", "p5", "p6"].map(raw).join("\n\n") };
  };
  const [reminderRo, reminderEn] = await Promise.all([reminderOf("ro"), reminderOf("en")]);

  /*
    What a send costs and how much of it waits (§100, §40), worded here for every choice so the
    composer switches sentences and does no arithmetic. The headroom is what the plan has left over
    its period minus what already waits in the queue ahead of this send.
  */
  /*
    The headroom for a staff send (the decision «Cere reconfirmarea», part two): what the plan has left, less what the
    registrations' own emails keep (`staffReserve`), less what waits ahead of it — every row but the bulk ones, which go
    after it. The same reading the outbox claims by, so the line cannot promise what the queue will not do.
  */
  const ahead = Math.max(0, volume.waitingMessages - volume.bulkWaitingMessages);
  const headroom = volume.remaining === null ? null : Math.max(0, volume.remaining - staffReserve(volume) - ahead);
  // How long it takes (part two): the scheduled pass's batch at the pinger's pace by day, or Mailgun's hour when slower.
  const cadence = await readJobCadence(db);
  const minutesPerRun = Math.max(PINGER_SLOT_MINUTES, cadence.minutes);
  const perHourByRuns = (OUTBOX_BATCH_SIZE * 60) / minutesPerRun;
  const hourBinds = volume.hourlyAllowance !== null && volume.hourlyAllowance < perHourByRuns;
  const paceLineOf = (messages: number): string => {
    const { hours } = organizerMessagePace({ messages, ahead, batchSize: OUTBOX_BATCH_SIZE, minutesPerRun, hourlyAllowance: volume.hourlyAllowance });
    return hourBinds
      ? t(`participantMessages.paceHour.${countForm(hours, locale)}`, { hourly: String(volume.hourlyAllowance), hours: String(hours) })
      : t(`participantMessages.paceRuns.${countForm(hours, locale)}`, { batch: String(OUTBOX_BATCH_SIZE), minutes: String(minutesPerRun), hours: String(hours) });
  };
  const allowance =
    volume.remaining === null
      ? t("editor.notice.allowanceNone", { plan: volume.planName })
      : `${t(volume.period === "day" ? "editor.notice.allowanceDay" : "editor.notice.allowanceMonth", {
          plan: volume.planName,
          remaining: String(volume.remaining),
        })}${volume.waitingMessages > 0 ? `; ${t("participantMessages.waiting", { waiting: String(volume.waitingMessages) })}` : ""}`;

  const audiences: ComposerAudience[] = PARTICIPANT_MESSAGE_AUDIENCES.map((audience) => {
    const { real, test: testCount } = counts[audience];
    const messages = organizerMessageCost({ real, test: testCount }, volume.participantBccCount);
    const deferral = organizerMessageDeferral(messages, headroom);
    const deferredLine =
      deferral.deferred > 0
        ? t(volume.period === "month" ? "participantMessages.deferredMonth" : "participantMessages.deferredDay", {
            now: String(deferral.now),
            deferred: String(deferral.deferred),
          })
        : undefined;
    // Before «Trimite» (part two): how long it takes, and whether it fits the allowance — the deferral's own words when not.
    const fitsLine = volume.remaining === null ? "" : t(volume.period === "month" ? "participantMessages.fitsMonth" : "participantMessages.fitsToday");
    const paceLine = messages > 0 ? [paceLineOf(messages), deferredLine ?? fitsLine].filter((line) => line !== "").join(" ") : undefined;
    return {
      value: audience,
      label: t(`participantMessages.audiences.${audience}`),
      real,
      test: testCount,
      recipientsLine:
        real + testCount === 0 ? t("participantMessages.nobody") : t(`participantMessages.recipients.${countForm(real, locale)}`, { count: real }),
      ...(testCount > 0 ? { testLine: t("participantMessages.testLine", { test: String(testCount) }) } : {}),
      ...(messages > 0 ? { costLine: t("participantMessages.cost", { messages: String(messages), allowance }) } : {}),
      ...(deferredLine ? { deferredLine } : {}),
      ...(paceLine ? { paceLine } : {}),
      confirmTitle: t(`participantMessages.confirmTitle.${countForm(real, locale)}`, { count: real }),
    };
  });

  const words = await confirmWords();
  /*
    Send asks first, per group (§384): the question names how many, and the email line the same
    number — `countParticipantMessageAudiences`, the count the send itself queues from. One spec
    per radio choice, picked by the `audience` the form posts, so the dialog is the group's own.
  */
  // «Trimite acum» or «Pune la coadă» (§540): under the scheduled timing, the send asks which.
  const sendNow = await sendNowChoiceFor(db, locale);
  const sendConfirm = audiences.map((choice) =>
    withSendNowChoice(
      {
        when: [{ field: "audience", equals: choice.value }],
        title: choice.confirmTitle,
        // The pace and the allowance (the decision «Cere reconfirmarea», part two) after «Când pleacă», then the test rows.
        body: [t("participantMessages.confirmBody"), choice.paceLine, choice.testLine].filter(Boolean).join(" "),
        // No "0 participants" for a group of test rows alone: the test line says who is written to. The message named, and
        // the club's one copy of the send (§419) — the design «telling the owner about every email a staff press sends», slice 3.
        ...words.mail({ to: { count: choice.real, audience: "participants" }, type: "ORGANIZER_MESSAGE" }),
        confirmLabel: t("participantMessages.confirmSend"),
        cancelLabel: words.cancel,
      },
      sendNow,
    ),
  );
  const languageRo = tSite("languageName.ro");
  const languageEn = tSite("languageName.en");
  // The subject's fields, in both helps; the body's one more, `{feedbackLink}`, has its own sentence (§676).
  const placeholderList = ORGANIZER_SUBJECT_PLACEHOLDERS.map((name) => `{${name}}`).join(", ");
  const refusal = await refusalMessages({
    audience: t("participantMessages.audience"),
    subjectRo: `${t("participantMessages.subject")} (${languageRo})`,
    subjectEn: `${t("participantMessages.subject")} (${languageEn})`,
    bodyRo: `${t("participantMessages.body")} (${languageRo})`,
    bodyEn: `${t("participantMessages.body")} (${languageEn})`,
  });

  const inSeries = event.repeatOf !== null || readRepeatRule(event.repeatRule) !== null;
  const nobodyAnywhere = counts.ALL_ACTIVE.real + counts.ALL_ACTIVE.test === 0;
  const sentCount = /^\d+$/.test(sent ?? "") ? Number(sent) : null;
  const sentTest = /^\d+$/.test(test ?? "") ? Number(test) : 0;
  // A new id every time the page is drawn, and the form re-mounts on it: after a send the boxes
  // are empty, and the next press is a new message rather than the last one again.
  const sendId = randomUUID();
  // Inside the history line's sentence, so in the language's own case (§349).
  // The heading's date: the day and hour typed, the day alone for an hour left blank, or «Data se
  // anunță mai târziu» for a date left blank (§545) — never the provisional start stored for either.
  const start = typedStartShape(event);
  const eventDate = start
    ? formatDay(start.at, { locale, timeZone: event.timezone, style: "long", withTime: start.hour })
    : t("editor.dateToBeAnnounced");
  const when = (at: Date) => formatDay(at, { locale, timeZone: event.timezone, style: "short", withTime: true, position: "inline" });

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href={{ pathname: "/admin/events/[id]", params: { id: event.id } }}>{t("participantMessages.backToEvent")}</Link>
      </Typography>

      <Box>
        <Typography variant="h2" sx={{ fontSize: "1.35rem", mb: 0.5 }}>
          {t("participantMessages.title")}
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }} data-testid="participant-message-event">
          {t("participantMessages.event", { event: title, date: eventDate })}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("participantMessages.intro")}
        </Typography>
      </Box>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {sentCount !== null && (
          <Alert severity="success" data-testid="participant-message-sent">
            {t(`participantMessages.sent.${countForm(sentCount, locale)}`, { count: sentCount })}
            {sentTest > 0 ? ` ${t("participantMessages.sentTest", { test: String(sentTest) })}` : ""}
          </Alert>
        )}
        {duplicate === "1" && <Alert severity="info">{t("participantMessages.duplicate")}</Alert>}
      </Box>

      {event.eventStatus === "CANCELLED" && <Alert severity="info">{t("participantMessages.cancelledNote")}</Alert>}
      {inSeries && <Alert severity="info">{t("participantMessages.seriesNote")}</Alert>}
      {nobodyAnywhere && (
        <Alert severity="info">{event.registrationMode === "INTERNAL" ? t("participantMessages.nobodyYet") : t("participantMessages.noRegistrationHere")}</Alert>
      )}

      <Panel glyph="compose" static id="box-participant-message" title={t("participantMessages.compose")}>
        <ActionForm key={sendId} action={sendParticipantMessageAction} messages={refusal} confirm={sendConfirm} data-testid="participant-message-form">
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="eventId" value={event.id} />
          <input type="hidden" name="sendId" value={sendId} />
          {sendNow && <input type="hidden" name={sendNow.field} value={sendNow.value} />}
          <ParticipantMessageComposer
            eventId={event.id}
            audiences={audiences}
            defaultAudience="ALL_ACTIVE"
            maxSubject={ORGANIZER_SUBJECT_MAX}
            maxBody={ORGANIZER_BODY_MAX}
            preview={previewParticipantMessageAction}
            labels={{
              audience: t("participantMessages.audience"),
              audienceHelp: t("participantMessages.audienceHelp"),
              languageRo,
              languageEn,
              subject: t("participantMessages.subject"),
              subjectHelp: t("participantMessages.subjectHelp", { max: String(ORGANIZER_SUBJECT_MAX), list: placeholderList }),
              body: t("participantMessages.body"),
              bodyHelp: t("participantMessages.bodyHelp", { max: String(ORGANIZER_BODY_MAX), list: placeholderList, feedback: "{feedbackLink}" }),
              bodyScope: t("participantMessages.bodyScope"),
              identical: t("editor.identical.warning"),
              preview: t("participantMessages.preview"),
              // Named from the constant the preview is rendered with, so the line cannot name somebody else.
              previewHelp: t("participantMessages.previewHelp", {
                name: EMAIL_SAMPLE[locale].participantName,
                bibNumber: String(EMAIL_SAMPLE[locale].bibNumber),
              }),
              previewRo: t("participantMessages.previewRo"),
              previewEn: t("participantMessages.previewEn"),
              previewLoading: t("participantMessages.previewLoading"),
              previewUnavailable: t("participantMessages.previewUnavailable"),
              previewUnknown: t.raw("participantMessages.previewUnknown") as string,
              previewSubject: t("emails.subject"),
              send: t("participantMessages.send"),
              reconfirm: t("participantMessages.reconfirm"),
              reconfirmHelp: t("participantMessages.reconfirmHelp"),
              reminderFill: {
                button: t("participantMessages.reminderFill.button"),
                confirmTitle: t("participantMessages.reminderFill.confirmTitle"),
                confirmBody: t("participantMessages.reminderFill.confirmBody"),
                confirmGo: t("participantMessages.reminderFill.confirmGo"),
                confirmCancel: t("participantMessages.reminderFill.confirmCancel"),
                subjectRo: reminderRo.subject,
                subjectEn: reminderEn.subject,
                bodyRo: reminderRo.body,
                bodyEn: reminderEn.body,
              },
            }}
          />
        </ActionForm>
      </Panel>

      {/* "Mesaje trimise": read from the sends' audit rows — the group and the count, never who. */}
      <Panel glyph="history" static id="box-participant-message-history" title={t("participantMessages.history")}>
        {history.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("participantMessages.historyEmpty")}
          </Typography>
        ) : (
          <Stack spacing={1.5} component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
            {history.map((entry, index) => (
              <Box
                component="li"
                key={`${entry.at.toISOString()}-${index}`}
                data-testid="participant-message-history-row"
                sx={{ borderBottom: index < history.length - 1 ? 1 : 0, borderColor: "divider", pb: 1.5 }}
              >
                <Typography variant="body2" color="text.secondary">
                  {t("participantMessages.historyWhen", { date: when(entry.at), sender: entry.senderName ?? t("participantMessages.historyNoSender") })}
                </Typography>
                {/* The subject in the backoffice's language — the audit row keeps both — and the Romanian one should a row carry no other. */}
                <Typography variant="body1" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
                  {entry.subject[locale] || entry.subject.ro}
                </Typography>
                <Typography variant="body2">
                  {entry.audience ? t(`participantMessages.audiencesShort.${entry.audience}`) : "—"}
                  {" · "}
                  {t(`participantMessages.recipients.${countForm(entry.recipients, locale)}`, { count: entry.recipients })}
                  {entry.test > 0 ? ` · ${t("participantMessages.historyTest", { test: String(entry.test) })}` : ""}
                </Typography>
                {/* How far it has left (the decision «Cere reconfirmarea», part two): hidden once the rows were swept. */}
                {entry.progress.left + entry.progress.waiting + entry.progress.failed > 0 && (
                  <Typography variant="body2" color="text.secondary" data-testid="participant-message-history-progress">
                    {t("participantMessages.historyProgress", { left: String(entry.progress.left), waiting: String(entry.progress.waiting) })}
                    {entry.progress.failed > 0 ? ` · ${t("participantMessages.historyFailed", { failed: String(entry.progress.failed) })}` : ""}
                  </Typography>
                )}
                {/* «Cere reconfirmarea»: who said «Vin», who cancelled since, who did not answer — information, never a state. */}
                {entry.answers && (
                  <Typography variant="body2" data-testid="participant-message-history-answers">
                    {t("participantMessages.historyAnswers", {
                      yes: String(entry.answers.yes),
                      cancelled: String(entry.answers.cancelled),
                      none: String(entry.answers.none),
                    })}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </Panel>
    </Stack>
  );
}
