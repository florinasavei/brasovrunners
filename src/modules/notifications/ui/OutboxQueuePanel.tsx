import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Panel from "@/shared/ui/Panel";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import { getTranslations } from "next-intl/server";
import { sendOutboxNowFromEmailsAction } from "@/app/[locale]/admin/emails/actions";
import type { Locale } from "@/i18n/routing";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { OutboxQueue } from "@/modules/notifications/queue";
import type { EmailVolumeToday } from "@/modules/notifications/volume";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";

type Props = {
  locale: Locale;
  queue: OutboxQueue;
  volume: EmailVolumeToday;
  /** "Trimite acum" is the Administrator's (§80); the queue itself is read by whoever may read the registrations (§291). */
  mayEdit: boolean;
  /** Why the fold opens by itself, as the page knows it: "send now" just answered (§336). */
  openWhen?: FoldOpenWhen;
};

/**
 * The queue itself, on the club's own screen (`DECISIONS.md` §243).
 *
 * The registrations list already had "how many are waiting" and the button that sends them
 * (§80); what nobody could see was *which* message, to whom, how many attempts it has survived
 * and what the provider last said about it — that lived in the database and, in aggregate, on
 * `/devs`. On race morning the useful question is "is Ana's confirmation stuck, and why", and
 * this is the screen that answers it.
 *
 * A Server Component with one form. Rows are stacked rather than tabulated: five facts about a
 * message do not fit a table at 320 pixels, and a table that scrolls sideways is worse than a
 * paragraph (the same reasoning §196 applied to the one place a table is unavoidable).
 */
export default async function OutboxQueuePanel({ locale, queue, volume, mayEdit, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  // Inside the row's sentence ("În coadă din joi, 24 sept. 2026, 18:05"), short (§349).
  const when = { format: (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }) };

  return (
    <Panel
      title={t("emails.queue.title")}
      intro={t("emails.queue.intro")}
      aside={t("outbox.waitingShort", { count: queue.total })}
      collapsible
      // Open while something waits (§269), and after "send now" answered — sent or refused (§336).
      openWhen={{ ...openWhen, attention: queue.total > 0 }}
      id="outbox-queue"
      data-testid="outbox-queue"
    >

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" }, mb: 1.5 }}>
        <Typography variant="body2" sx={{ flex: 1, fontWeight: 500 }}>
          {t("emails.queue.count", { count: queue.total })}
        </Typography>
        {/* The same rule the list's button follows (§80): offered only when there is something
            to send and room to send it, because a disabled button cannot say why. And only to
            the role that may press it (§291): for the Organizer the count above is the whole
            answer, and the else-branch's "allowance spent" would be an answer to a question they
            were never offered. */}
        {!mayEdit ? null : queue.total > 0 && (volume.remaining === null || volume.remaining > 0) ? (
          <ActionForm
            action={sendOutboxNowFromEmailsAction}
            confirm={{ title: t("confirm.sendNowTitle"), body: t("confirm.sendNowBody"), email: words.queue(queue.total), confirmLabel: t("outbox.sendNow"), cancelLabel: words.cancel }}
            data-testid="send-now-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <GlyphSubmitButton
              label={t("outbox.sendNow")}
              pendingLabel={t("outbox.sending")}
              ariaLabel={t("outbox.sendNowLong")}
              icon="send"
              variant="contained"
            />
          </ActionForm>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {queue.total === 0 ? t("outbox.nothingWaiting") : t("outbox.allowanceSpent")}
          </Typography>
        )}
      </Stack>

      {queue.rows.length > 0 && (
        <Stack component="ul" spacing={1} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {queue.rows.map((row) => (
            <Box component="li" key={row.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center", mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t(`emails.types.${row.messageType}`)}
                </Typography>
                {/* FAILED is the one that needs the eye: it has spent its retries and will not
                    move again on its own. The other two are ordinary queue states. */}
                <Chip
                  size="small"
                  color={row.status === "FAILED" ? "error" : "default"}
                  label={t(`emails.queue.status.${row.status}`)}
                />
                {row.isManualResend && <Chip size="small" variant="outlined" label={t("emails.queue.manual")} />}
              </Stack>
              <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                {row.recipientEmail}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="p">
                {t("emails.queue.facts", {
                  queued: when.format(row.createdAt),
                  attempts: row.attemptCount,
                  next: row.nextAttemptAt ? when.format(row.nextAttemptAt) : t("emails.queue.nextAny"),
                })}
              </Typography>
              {row.lastError && (
                <Typography variant="caption" color="error" component="p" sx={{ mt: 0.5, wordBreak: "break-word" }}>
                  {t("emails.queue.lastError", { error: row.lastError })}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}

      {queue.total > queue.rows.length && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("emails.queue.more", { count: queue.total - queue.rows.length })}
        </Typography>
      )}
    </Panel>
  );
}
