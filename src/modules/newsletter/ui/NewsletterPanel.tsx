import { randomUUID } from "node:crypto";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { previewNewsletterAction, sendNewsletterAction, withdrawNewsletterAddressAction } from "@/app/[locale]/admin/emails/actions";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { bulkBudget } from "@/modules/notifications/domain/bulk";
import type { EmailVolumeToday } from "@/modules/notifications/volume";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField, { RecallRadio } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import { NEWSLETTER_BODY_MAX, NEWSLETTER_SUBJECT_MAX } from "../domain/message";
import { SENDABLE_TOPICS } from "../domain/topics";
import type { NewsletterAudience, NewsletterSendRow } from "../service";
import NewsletterPreview from "./NewsletterPreview";

type Props = {
  locale: Locale;
  audience: NewsletterAudience;
  history: readonly NewsletterSendRow[];
  volume: EmailVolumeToday;
  /** The privacy notice in force describes the newsletter: the contact page offers the pop-up (§NNN). */
  offered: boolean;
  /** `canSendNewsletter`: the composer. */
  maySend: boolean;
  /** The Administrator's: removing an address at the person's request. */
  mayWithdraw: boolean;
  openWhen?: FoldOpenWhen;
};

/**
 * «Abonați» on `/admin/emails` (§NNN): who subscribed from the contact page, as numbers — never an
 * address: confirmed and pending, per topic, and the last send; «Scrie abonaților», a composer that
 * writes to the subscribers of one topic in both languages, with a preview of the message as it
 * will arrive; what was sent; and the Administrator's form for an address somebody asked, in
 * writing, to have removed.
 *
 * A Server Component around two `ActionForm`s. The composer asks first, per topic, naming how many
 * receive it (§384), and says how much of it leaves today under the reserve the outbox keeps for
 * registrations (`domain/bulk.ts`) — the rest goes on the following days, never dropped (§40).
 */
export default async function NewsletterPanel({ locale, audience, history, volume, offered, maySend, mayWithdraw, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const tn = await getTranslations("Newsletter");
  const words = await confirmWords();
  const budget = bulkBudget(volume);
  const sendId = randomUUID();
  const when = (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
  const topicNames = (topics: readonly string[]) => topics.map((topic) => tn(`topics.${topic}`)).join(", ");
  // The newest send that reached somebody, a newsletter or an alert: `history` is newest first.
  const lastMessage = history[0] ?? null;

  const choices = SENDABLE_TOPICS.map((topic) => {
    const count = audience.byTopic[topic];
    const deferred = budget === null ? 0 : Math.max(0, count - budget);
    return { topic, count, deferred };
  });
  const confirm = choices.map((choice) => ({
    when: [{ field: "topic", equals: choice.topic }],
    title: t(`newsletter.confirmTitle.${countForm(choice.count, locale)}`, { count: choice.count }),
    body: t("newsletter.confirmBody", { topic: tn(`topics.${choice.topic}`) }),
    ...(choice.count > 0 ? { email: words.email(choice.count) } : {}),
    confirmLabel: t("newsletter.send"),
    cancelLabel: words.cancel,
  }));

  return (
    <Panel
      title={t("newsletter.title")}
      intro={t("newsletter.intro")}
      aside={t(`newsletter.aside.${countForm(audience.confirmed, locale)}`, { count: audience.confirmed })}
      collapsible
      openWhen={openWhen}
      id="newsletter"
      data-testid="newsletter-panel"
    >
      {!offered && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="newsletter-off">
          {t("newsletter.off")}
        </Alert>
      )}

      <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="newsletter-counts">
        {t("newsletter.counts", { confirmed: String(audience.confirmed), unconfirmed: String(audience.unconfirmed) })}
      </Typography>
      <Typography variant="body2" color="text.secondary" data-testid="newsletter-last-send">
        {lastMessage ? t("newsletter.lastSend", { when: when(lastMessage.at) }) : t("newsletter.lastSendNone")}
      </Typography>
      <Box component="ul" sx={{ mt: 1, mb: 2, pl: 3 }}>
        {choices.map((choice) => (
          <li key={choice.topic}>
            <Typography variant="body2">{t("newsletter.topicCount", { topic: tn(`topics.${choice.topic}`), count: String(choice.count) })}</Typography>
          </li>
        ))}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {budget === null ? t("newsletter.allowanceNone") : t(volume.period === "month" ? "newsletter.allowanceMonth" : "newsletter.allowanceDay", { count: String(budget) })}
      </Typography>

      {maySend ? (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, mb: 1 }}>
            {t("newsletter.compose")}
          </Typography>
          <ActionForm
            key={sendId}
            action={sendNewsletterAction}
            messages={await refusalMessages({
              topic: t("newsletter.topic"),
              subjectRo: t("newsletter.subjectRo"),
              subjectEn: t("newsletter.subjectEn"),
              bodyRo: t("newsletter.bodyRo"),
              bodyEn: t("newsletter.bodyEn"),
            })}
            confirm={confirm}
            scope="newsletter"
            data-testid="newsletter-compose"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="sendId" value={sendId} />
            <Stack spacing={2}>
              <Box component="fieldset" id="field-newsletter-topic" sx={{ m: 0, p: 0, border: 0, minWidth: 0 }}>
                <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t("newsletter.topic")}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  {t("newsletter.topicHelp")}
                </Typography>
                {choices.map((choice, index) => (
                  <Box component="label" key={choice.topic} sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 44, cursor: "pointer" }}>
                    <RecallRadio name="topic" value={choice.topic} defaultChecked={index === 0} style={{ width: 20, height: 20 }} />
                    <span>
                      {tn(`topics.${choice.topic}`)}
                      <Typography component="span" variant="body2" color="text.secondary">
                        {" · "}
                        {t(`newsletter.recipients.${countForm(choice.count, locale)}`, { count: choice.count })}
                        {choice.deferred > 0 ? ` · ${t("newsletter.deferred", { count: String(choice.deferred) })}` : ""}
                      </Typography>
                    </span>
                  </Box>
                ))}
              </Box>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <RecallField
                  name="subjectRo"
                  label={t("newsletter.subjectRo")}
                  fullWidth
                  size="small"
                  slotProps={{ htmlInput: { maxLength: NEWSLETTER_SUBJECT_MAX } }}
                />
                <RecallField
                  name="subjectEn"
                  label={t("newsletter.subjectEn")}
                  fullWidth
                  size="small"
                  slotProps={{ htmlInput: { maxLength: NEWSLETTER_SUBJECT_MAX } }}
                />
              </Stack>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <RecallField
                  name="bodyRo"
                  label={t("newsletter.bodyRo")}
                  multiline
                  minRows={6}
                  fullWidth
                  helperText={t("newsletter.bodyHelp", { max: String(NEWSLETTER_BODY_MAX) })}
                  slotProps={{ htmlInput: { maxLength: NEWSLETTER_BODY_MAX } }}
                />
                <RecallField
                  name="bodyEn"
                  label={t("newsletter.bodyEn")}
                  multiline
                  minRows={6}
                  fullWidth
                  helperText={t("newsletter.bodyHelp", { max: String(NEWSLETTER_BODY_MAX) })}
                  slotProps={{ htmlInput: { maxLength: NEWSLETTER_BODY_MAX } }}
                />
              </Stack>
              <NewsletterPreview
                preview={previewNewsletterAction}
                labels={{
                  title: t("newsletter.previewTitle"),
                  help: t("newsletter.previewHelp"),
                  ro: t("newsletter.previewRo"),
                  en: t("newsletter.previewEn"),
                  loading: t("newsletter.previewLoading"),
                  unavailable: t("newsletter.previewUnavailable"),
                  subject: t("emails.subject"),
                }}
              />
              <Box>
                <GlyphSubmitButton label={t("newsletter.send")} pendingLabel={t("newsletter.sending")} icon="send" />
              </Box>
            </Stack>
          </ActionForm>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("newsletter.readOnly")}
        </Typography>
      )}

      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, mb: 1 }}>
        {t("newsletter.history")}
      </Typography>
      {history.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("newsletter.historyEmpty")}
        </Typography>
      ) : (
        <Box component="ul" sx={{ mt: 0, mb: 2, pl: 3 }} data-testid="newsletter-history">
          {history.map((row, index) => (
            <li key={`${row.at.toISOString()}-${index}`}>
              <Typography variant="body2">
                {row.kind === "EVENT_ALERT"
                  ? t("newsletter.historyAlert", { when: when(row.at), topics: topicNames(row.topics), count: String(row.recipients) })
                  : t("newsletter.historyMessage", {
                      when: when(row.at),
                      subject: row.subject ? row.subject[locale] : "—",
                      topics: topicNames(row.topics),
                      count: String(row.recipients),
                      sender: row.senderName ?? t("newsletter.historyNoSender"),
                    })}
              </Typography>
            </li>
          ))}
        </Box>
      )}

      {mayWithdraw && (
        <Box>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t("newsletter.withdrawTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("newsletter.withdrawHelp")}
          </Typography>
          <ActionForm
            action={withdrawNewsletterAddressAction}
            messages={await refusalMessages({ email: t("newsletter.withdrawEmail") })}
            confirm={{ title: t("newsletter.withdrawConfirmTitle"), body: t("newsletter.withdrawConfirmBody"), confirmLabel: t("newsletter.withdraw"), cancelLabel: words.cancel, destructive: true }}
            scope="newsletterWithdraw"
            data-testid="newsletter-withdraw"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "flex-start" }, maxWidth: 560 }}>
              <RecallField name="email" type="email" label={t("newsletter.withdrawEmail")} size="small" fullWidth slotProps={{ htmlInput: { autoComplete: "off" } }} />
              <GlyphSubmitButton label={t("newsletter.withdraw")} pendingLabel={t("newsletter.withdrawing")} icon="delete" color="error" />
            </Stack>
          </ActionForm>
        </Box>
      )}
    </Panel>
  );
}
