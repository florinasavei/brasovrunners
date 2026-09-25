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
import { readRepeatRule } from "@/modules/events/domain/repeat";
import { EMAIL_SAMPLE } from "@/modules/notifications/domain/email-sample";
import {
  ORGANIZER_BODY_MAX,
  ORGANIZER_MESSAGE_PLACEHOLDERS,
  ORGANIZER_SUBJECT_MAX,
  organizerMessageCost,
  organizerMessageDeferral,
  PARTICIPANT_MESSAGE_AUDIENCES,
} from "@/modules/notifications/domain/organizer-message";
import { countParticipantMessageAudiences, listParticipantMessages } from "@/modules/notifications/participant-messages";
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
    What a send costs and how much of it waits (§100, §40), worded here for every choice so the
    composer switches sentences and does no arithmetic. The headroom is what the plan has left over
    its period minus what already waits in the queue ahead of this send.
  */
  const headroom = volume.remaining === null ? null : Math.max(0, volume.remaining - volume.waitingMessages);
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
    return {
      value: audience,
      label: t(`participantMessages.audiences.${audience}`),
      real,
      test: testCount,
      recipientsLine:
        real + testCount === 0 ? t("participantMessages.nobody") : t(`participantMessages.recipients.${countForm(real, locale)}`, { count: real }),
      ...(testCount > 0 ? { testLine: t("participantMessages.testLine", { test: String(testCount) }) } : {}),
      ...(messages > 0 ? { costLine: t("participantMessages.cost", { messages: String(messages), allowance }) } : {}),
      ...(deferral.deferred > 0
        ? {
            deferredLine: t(volume.period === "month" ? "participantMessages.deferredMonth" : "participantMessages.deferredDay", {
              now: String(deferral.now),
              deferred: String(deferral.deferred),
            }),
          }
        : {}),
      confirmTitle: t(`participantMessages.confirmTitle.${countForm(real, locale)}`, { count: real }),
    };
  });

  const words = await confirmWords();
  /*
    Send asks first, per group (§NNN): the question names how many, and the email line the same
    number — `countParticipantMessageAudiences`, the count the send itself queues from. One spec
    per radio choice, picked by the `audience` the form posts, so the dialog is the group's own.
  */
  const sendConfirm = audiences.map((choice) => ({
    when: [{ field: "audience", equals: choice.value }],
    title: choice.confirmTitle,
    body: choice.testLine ? `${t("participantMessages.confirmBody")} ${choice.testLine}` : t("participantMessages.confirmBody"),
    // No "0 participants" for a group of test rows alone: the test line says who is written to.
    ...(choice.real > 0 ? { email: words.email(choice.real) } : {}),
    confirmLabel: t("participantMessages.confirmSend"),
    cancelLabel: words.cancel,
  }));
  const languageRo = tSite("languageName.ro");
  const languageEn = tSite("languageName.en");
  const placeholderList = ORGANIZER_MESSAGE_PLACEHOLDERS.map((name) => `{${name}}`).join(", ");
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
          {t("participantMessages.event", { event: title, date: formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long", withTime: true }) })}
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

      <Panel static id="box-participant-message" title={t("participantMessages.compose")}>
        <ActionForm key={sendId} action={sendParticipantMessageAction} messages={refusal} confirm={sendConfirm} data-testid="participant-message-form">
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="eventId" value={event.id} />
          <input type="hidden" name="sendId" value={sendId} />
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
              bodyHelp: t("participantMessages.bodyHelp", { max: String(ORGANIZER_BODY_MAX), list: placeholderList }),
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
            }}
          />
        </ActionForm>
      </Panel>

      {/* "Mesaje trimise": read from the sends' audit rows — the group and the count, never who. */}
      <Panel static id="box-participant-message-history" title={t("participantMessages.history")}>
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
              </Box>
            ))}
          </Stack>
        )}
      </Panel>
    </Stack>
  );
}
