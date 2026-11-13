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
import { findEventNotificationDetails } from "@/modules/events/repository";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findEventForEditing } from "@/modules/content/events/repository";
import { typedStartShape } from "@/modules/events/domain/provisional-start";
import { readRepeatRule } from "@/modules/events/domain/repeat";
import { EMAIL_SAMPLE } from "@/modules/notifications/domain/email-sample";
import {
  CHOSEN_AUDIENCE,
  CHOSEN_FIELD,
  ORGANIZER_BODY_MAX,
  ORGANIZER_SUBJECT_PLACEHOLDERS,
  ORGANIZER_SUBJECT_MAX,
  organizerMessageCost,
  type OrganizerSendOutlook,
  organizerSendOutlook,
  PARTICIPANT_MESSAGE_AUDIENCES,
} from "@/modules/notifications/domain/organizer-message";
import { gmailClaimSize, preferredTransport } from "@/modules/notifications/domain/email-transport";
import { readEmailTransport } from "@/modules/notifications/email-transport";
import { GMAIL_PACE_BUDGET_MS } from "@/infrastructure/email/delivery";
import { OUTBOX_BATCH_SIZE } from "@/modules/notifications/outbox";
import { readJobCadence } from "@/modules/jobs/cadence";
import { PINGER_SLOT_MINUTES } from "@/modules/jobs/schedule";
import {
  countParticipantMessageAudiences,
  listChoosableRecipients,
  listParticipantMessages,
  readKeptMessage,
  subjectAsDrawn,
} from "@/modules/notifications/participant-messages";
import { withSendNowChoice } from "@/modules/notifications/domain/send-at-once";
import { sendNowChoiceFor } from "@/modules/notifications/send-now-choice";
import ParticipantMessageComposer, { type ComposerAudience } from "@/modules/notifications/ui/ParticipantMessageComposer";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { canMessageParticipants } from "@/modules/staff-identity/domain/roles";
import { REGISTRATION_STATUS_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { isUuid } from "@/shared/ids";
import Panel from "@/shared/ui/Panel";
import { previewParticipantMessageAction, sendParticipantMessageAction } from "./actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ sent?: string; test?: string; duplicate?: string; kept?: string }>;
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
 * A fifth choice beside the four groups, «Doar anumiți participanți» (§NNN; the owner, 2026-11-13: «As vrea sa fac un
 * test pentru mailul asta, sa selectez doar anumiti participanti»): the event's active registrations by name, a tick
 * each, for a trial of a message or a word to a few. The page returned to after such a send (`?kept=<the send's id>`)
 * hands its words back to the boxes, so the same message goes to everybody without being typed twice.
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
  const { sent, test, duplicate, kept } = await searchParams;

  const now = new Date();
  const [counts, volume, history, eventDetails, people, keptMessage] = await Promise.all([
    countParticipantMessageAudiences(db, event.id),
    readEmailVolumeToday(db, now),
    listParticipantMessages(db, event.id),
    findEventNotificationDetails(db, event.id, locale),
    // «Doar anumiți participanți» (§NNN): everybody who can be ticked, and — back from such a send — its words for the boxes.
    listChoosableRecipients(db, event.id),
    typeof kept === "string" ? readKeptMessage(db, event.id, kept) : null,
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
    return { subject: raw("subject"), body: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"].map(raw).join("\n\n") };
  };
  const [reminderRo, reminderEn] = await Promise.all([reminderOf("ro"), reminderOf("en")]);

  /*
    What a send costs, how it leaves and how much of it waits (§100, §40; the decision «Cere reconfirmarea», part two),
    worded here for every choice so the composer switches sentences and does no arithmetic — on the road the send's
    messages really take: the participants' on the group's road, the club's copy on its own (`preferredTransport`), both
    Mailgun's where Gmail is not configured. No reserve: the outbox claims a send to many after every registration's own
    message on its road and holds none of it back, so what waits ahead of it is every waiting row on that road but the
    bulk kind (`volume.waitingAhead`), and the line says only what the queue will do.
  */
  const [transport, cadence] = await Promise.all([readEmailTransport(db), readJobCadence(db)]);
  const roadOf = (clubCopy: boolean) => (volume.gmailConfigured ? preferredTransport(transport, "ORGANIZER_MESSAGE", clubCopy) : "mailgun");
  const participantsRoad = roadOf(false);
  const copiesRoad = roadOf(true);
  // How long it takes: the scheduled pass's batch at the pinger's pace by day, or Mailgun's hour when slower; Gmail's own pace a pass.
  const minutesPerRun = Math.max(PINGER_SLOT_MINUTES, cadence.minutes);
  const hourBinds = volume.hourlyAllowance !== null && volume.hourlyAllowance < (OUTBOX_BATCH_SIZE * 60) / minutesPerRun;
  const gmailPerPass = gmailClaimSize(transport.gmailPaceSeconds, GMAIL_PACE_BUDGET_MS, OUTBOX_BATCH_SIZE);
  const allowance =
    volume.remaining === null
      ? t("editor.notice.allowanceNone", { plan: volume.planName })
      : `${t(volume.period === "day" ? "editor.notice.allowanceDay" : "editor.notice.allowanceMonth", {
          plan: volume.planName,
          remaining: String(volume.remaining),
        })}${volume.waitingMessages > 0 ? `; ${t("participantMessages.waiting", { waiting: String(volume.waitingMessages) })}` : ""}`;
  const hoursKey = (hours: number) => countForm(hours, locale);
  const paceOf = (outlook: OrganizerSendOutlook): string =>
    outlook.road === "gmail"
      ? t(`participantMessages.paceGmail.${hoursKey(outlook.hours)}`, { batch: String(outlook.perPass), minutes: String(minutesPerRun), hours: String(outlook.hours) })
      : hourBinds
        ? t(`participantMessages.paceHour.${hoursKey(outlook.hours)}`, { hourly: String(volume.hourlyAllowance), hours: String(outlook.hours) })
        : t(`participantMessages.paceRuns.${hoursKey(outlook.hours)}`, { batch: String(OUTBOX_BATCH_SIZE), minutes: String(minutesPerRun), hours: String(outlook.hours) });
  // Where a large send belongs, by the screen's own labels: «Setări» → «Emailuri» → the plan's heading.
  const planPath = { settings: t("nav.settings"), emails: t("settingsTabs.emails"), plan: t("emails.plan.title") };
  /*
    Mailgun stopped now (§622), read once with the volume, as `/api/health` reads it (`readMailgunStop` on Mailgun's road):
    the line says until when and who sends meanwhile — the club's Gmail, within its limit, where «Gmail preia când Mailgun
    se oprește» is in force (`volume.fallbackToGmail`), nobody otherwise — and no sentence about what leaves now or today
    stands beside it.
  */
  const mailgunStoppedLine = volume.mailgunStop
    ? t(volume.fallbackToGmail ? "participantMessages.mailgunStoppedGmail" : "participantMessages.mailgunStopped", {
        until: formatDay(volume.mailgunStop.until, { locale, timeZone: event.timezone, style: "short", withTime: true, position: "inline" }),
      })
    : null;

  const audiences: ComposerAudience[] = PARTICIPANT_MESSAGE_AUDIENCES.map((audience) => {
    const { real, test: testCount } = counts[audience];
    const messages = organizerMessageCost({ real, test: testCount }, volume.participantBccCount);
    const copies = messages - real - testCount;
    // The send's messages on the participants' road: theirs, and the club's copy when it takes the same road (§419).
    const onRoad = real + testCount + (copiesRoad === participantsRoad ? copies : 0);
    const outlook =
      participantsRoad === "gmail"
        ? organizerSendOutlook({ road: "gmail", messages: onRoad, ahead: volume.waitingAhead.gmail, batchSize: OUTBOX_BATCH_SIZE, minutesPerRun, gmailRoom: volume.gmailRoom, gmailPerPass })
        : organizerSendOutlook({
            road: "mailgun",
            messages: onRoad,
            ahead: volume.waitingAhead.mailgun,
            batchSize: OUTBOX_BATCH_SIZE,
            minutesPerRun,
            period: volume.period,
            allowance: volume.allowance,
            remaining: volume.remaining,
            hourlyAllowance: volume.hourlyAllowance,
          });
    const ownFirst = t("participantMessages.ownFirst");
    let deferredLine: string | undefined;
    let warningLine: string | undefined;
    let costLine: string | undefined;
    let paceLine: string | undefined;
    if (outlook.road === "gmail") {
      // The club's Gmail (§443): its own room, cap and pace — nothing of Mailgun's allowance or pace is true here.
      costLine = t("participantMessages.costGmail", { messages: String(outlook.messages), room: String(volume.gmailRoom), cap: String(volume.gmailDailyCap) });
      if (outlook.waiting > 0) {
        deferredLine = t(transport.atGmailCap === "mailgun" ? "participantMessages.gmailOverflow" : "participantMessages.gmailWaits", {
          now: String(outlook.now),
          waiting: String(outlook.waiting),
          cap: String(volume.gmailDailyCap),
        });
      }
      // Gmail's limit is the club's other Gmail mail's too: always said, and the dialog's warning when the send does not fit now.
      const shared = t("participantMessages.gmailShared");
      if (outlook.waiting > 0) warningLine = shared;
      paceLine = [deferredLine, outlook.now > 0 ? paceOf(outlook) : "", outlook.waiting === 0 ? `${t("participantMessages.gmailFits")} ${shared}` : "", ownFirst]
        .filter(Boolean)
        .join(" ");
    } else {
      costLine =
        copies > 0 && copiesRoad !== participantsRoad
          ? t("participantMessages.costCopiesGmail", { messages: String(outlook.messages), allowance, copies: String(copies) })
          : t("participantMessages.cost", { messages: String(outlook.messages), allowance });
      // While Mailgun is stopped nothing of this send leaves now or today: the counts of «now» and «today» are not said.
      if (outlook.deferred > 0 && !mailgunStoppedLine) {
        deferredLine =
          outlook.period === "month"
            ? t("participantMessages.deferredMonth", { now: String(outlook.now), deferred: String(outlook.deferred) })
            : // Once the day's allowance is spent, the fallback in force carries the rest (§622): it waits for no reset.
              outlook.period === "day" && volume.fallbackToGmail
              ? t("participantMessages.deferredDayGmail", { now: String(outlook.now) })
              : outlook.period === "day" && outlook.restDays > 1
              ? t(`participantMessages.deferredDays.${countForm(outlook.restDays, locale)}`, {
                  now: String(outlook.now),
                  deferred: String(outlook.deferred),
                  days: String(outlook.restDays),
                  perDay: String(outlook.perDay),
                })
              : t("participantMessages.deferredDay", { now: String(outlook.now), deferred: String(outlook.deferred) });
      }
      /*
        A daily plan the send does not fit (part two): a warning, since the registrations' own emails share that allowance —
        they leave first, and once the day's allowance is spent Mailgun sends nothing more that day. Where «Gmail preia când
        Mailgun se oprește» is in force (`volume.fallbackToGmail`) Gmail then carries every group, in the claim's order
        (`outbox.ts`): the registrations' own and this send share the day's allowance and Gmail's limit, and the days the
        allowance is used are not counted — how many depends on Gmail's room, not on the allowance alone.
      */
      if (outlook.period === "day" && outlook.deferred > 0) {
        warningLine = (
          volume.fallbackToGmail
            ? [t("participantMessages.dailyShareGmail"), t("participantMessages.dailyPlan", planPath)]
            : [
                t(`participantMessages.dailyWarning.${countForm(outlook.daysUsed, locale)}`, { days: String(outlook.daysUsed) }),
                t("participantMessages.dailyShare"),
                t("participantMessages.dailyPlan", planPath),
              ]
        ).join(" ");
      }
      const fitsLine =
        mailgunStoppedLine || outlook.period === "none" || outlook.deferred > 0 ? "" : t(outlook.period === "month" ? "participantMessages.fitsMonth" : "participantMessages.fitsToday");
      paceLine = [mailgunStoppedLine, deferredLine, outlook.now > 0 ? paceOf(outlook) : "", fitsLine, ownFirst].filter(Boolean).join(" ");
    }
    return {
      value: audience,
      label: t(`participantMessages.audiences.${audience}`),
      real,
      test: testCount,
      recipientsLine:
        real + testCount === 0 ? t("participantMessages.nobody") : t(`participantMessages.recipients.${countForm(real, locale)}`, { count: real }),
      ...(testCount > 0 ? { testLine: t("participantMessages.testLine", { test: String(testCount) }) } : {}),
      ...(messages > 0 && costLine ? { costLine } : {}),
      ...(messages > 0 && deferredLine ? { deferredLine } : {}),
      ...(messages > 0 && warningLine ? { warningLine } : {}),
      ...(messages > 0 && paceLine ? { paceLine } : {}),
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
  /*
    «Doar anumiți participanți» (§NNN): the people are ticked in the browser, so its question cannot name a number in its
    title — the bold email line counts the ticks at the press instead (`ticksOf`), a test registration's counting nobody
    (§12.6), with the club's one copy of the send. No pace or allowance line: none is worked out for a list ticked there,
    and the outbox defers what a spent allowance cannot carry, as for any send (§40).
  */
  const testPeople = people.filter((person) => person.test).map((person) => person.id);
  const chosenConfirm = withSendNowChoice(
    {
      when: [{ field: "audience", equals: CHOSEN_AUDIENCE }],
      title: t("participantMessages.chosen.confirmTitle"),
      body: [t("participantMessages.confirmBody"), testPeople.length > 0 ? t("participantMessages.chosen.testNote") : ""].filter(Boolean).join(" "),
      ...words.mail({ to: { ticksOf: CHOSEN_FIELD, audience: "participants", uncounted: testPeople }, type: "ORGANIZER_MESSAGE" }),
      confirmLabel: t("participantMessages.confirmSend"),
      cancelLabel: words.cancel,
    },
    sendNow,
  );
  const groupConfirms = audiences.map((choice) =>
    withSendNowChoice(
      {
        when: [{ field: "audience", equals: choice.value }],
        title: choice.confirmTitle,
        // The pace and the allowance (the decision «Cere reconfirmarea», part two) after «Când pleacă», then the test rows.
        body: [t("participantMessages.confirmBody"), choice.paceLine, choice.testLine].filter(Boolean).join(" "),
        // A daily plan the send does not fit: the warning the Administrator cannot miss, in the dialog's own warning.
        ...(choice.warningLine ? { warning: choice.warningLine } : {}),
        // No "0 participants" for a group of test rows alone: the test line says who is written to. The message named, and
        // the club's one copy of the send (§419) — the design «telling the owner about every email a staff press sends», slice 3.
        ...words.mail({ to: { count: choice.real, audience: "participants" }, type: "ORGANIZER_MESSAGE" }),
        confirmLabel: t("participantMessages.confirmSend"),
        cancelLabel: words.cancel,
      },
      sendNow,
    ),
  );
  const sendConfirm = [...groupConfirms, chosenConfirm];
  const languageRo = tSite("languageName.ro");
  const languageEn = tSite("languageName.en");
  // The subject's fields, in both helps; the body's one more, `{feedbackLink}`, has its own sentence (§676).
  const placeholderList = ORGANIZER_SUBJECT_PLACEHOLDERS.map((name) => `{${name}}`).join(", ");
  const refusal = await refusalMessages({
    audience: t("participantMessages.audience"),
    [CHOSEN_FIELD]: t("participantMessages.chosen.label"),
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
            {/* Back from a send to the people ticked (§NNN): the boxes below still hold its words. */}
            {keptMessage ? ` ${t("participantMessages.chosen.kept")}` : ""}
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
            chosen={{
              value: CHOSEN_AUDIENCE,
              field: CHOSEN_FIELD,
              // A name and a state, in the backoffice's own word for it (§35), and a test row's mark — nothing else of a person.
              people: people.map((person) => ({ id: person.id, name: person.name, state: REGISTRATION_STATUS_LABEL[person.status], test: person.test })),
            }}
            {...(keptMessage
              ? {
                  kept: {
                    subjectRo: keptMessage.subject.ro,
                    subjectEn: keptMessage.subject.en,
                    bodyRo: keptMessage.body.ro,
                    bodyEn: keptMessage.body.en,
                    askReconfirm: keptMessage.askReconfirm,
                    sendQr: keptMessage.sendQr,
                  },
                }
              : {})}
            defaultAudience="ALL_ACTIVE"
            maxSubject={ORGANIZER_SUBJECT_MAX}
            maxBody={ORGANIZER_BODY_MAX}
            preview={previewParticipantMessageAction}
            labels={{
              audience: t("participantMessages.audience"),
              audienceHelp: t("participantMessages.audienceHelp"),
              chosen: {
                label: t("participantMessages.chosen.label"),
                help: t("participantMessages.chosen.help"),
                search: t("participantMessages.chosen.search"),
                // `{count}`, `{total}` and `{names}` stay literal: the composer fills them from the ticks.
                count: t.raw("participantMessages.chosen.count") as string,
                none: t("participantMessages.chosen.none"),
                names: t.raw("participantMessages.chosen.names") as string,
                noMatch: t("participantMessages.chosen.noMatch"),
                empty: t("participantMessages.chosen.empty"),
                test: t("participantMessages.chosen.test"),
              },
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
              sendQr: t("participantMessages.sendQr"),
              sendQrHelp: t("participantMessages.sendQrHelp"),
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
                  {eventDetails ? subjectAsDrawn(entry.subject[locale] || entry.subject.ro, eventDetails, locale) : entry.subject[locale] || entry.subject.ro}
                </Typography>
                <Typography variant="body2">
                  {entry.audience ? t(`participantMessages.audiencesShort.${entry.audience}`) : "—"}
                  {" · "}
                  {t(`participantMessages.recipients.${countForm(entry.recipients, locale)}`, { count: entry.recipients })}
                  {entry.test > 0 ? ` · ${t("participantMessages.historyTest", { test: String(entry.test) })}` : ""}
                </Typography>
                {/* «Trimite și numărul de concurs și codul QR» (§943): that the send was ticked, and for how many confirmed — never who. */}
                {entry.sendQr && (
                  <Typography variant="body2" data-testid="participant-message-history-qr">
                    {t("participantMessages.historyQr", { count: String(entry.withQr) })}
                  </Typography>
                )}
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
