import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Panel from "@/shared/ui/Panel";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import { getTranslations } from "next-intl/server";
import { sendOutboxNowFromEmailsAction, updateDeliveryTimingFromEmailsAction } from "@/app/[locale]/admin/settings/emails/actions";
import type { Locale } from "@/i18n/routing";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { pingerCadenceMinutes } from "@/modules/jobs/quiet-hours";
import { isBulkMessage } from "@/modules/notifications/domain/bulk";
import { emailLeavesWords, outboxRowLeavesAt, outboxRowOverdue } from "@/modules/notifications/domain/email-wait";
import { EMAIL_HEALTH_THRESHOLDS } from "@/modules/notifications/health";
import type { OutboxDelivery } from "@/modules/notifications/outbox-delivery";
import type { OutboxQueue, QueuedMessage } from "@/modules/notifications/queue";
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
  /**
   * When the queue leaves (§529, from `outbox-delivery.ts`): the timing, the next real run of the
   * outbox job, the last one and what holds the scheduled round back — the same reading
   * `/api/health` carries (§513).
   */
  delivery: OutboxDelivery;
  /** The instant the page read the queue and the delivery at, so every row is estimated from one "now". */
  now: Date;
  /**
   * Whether the reader may switch the scheduled round on and off (§529): the Administrator's club
   * setting (`canManageClubSettings`, §513), asserted again by the action and the service.
   */
  mayEditTiming: boolean;
  /** Why the fold opens by itself, as the page knows it: "send now" or the switch just answered (§336). */
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
 * **When it leaves (§529; the owner, 2026-09-28: "vreau să pot vedea exact când pleacă emailurile
 * și să pot face on/off la acea setare").** Under the scheduled default (§513) a queue waiting for
 * the tick is normal, and on QA — pinged hourly, with a two-hour minimum interval — it waited up to
 * three hours with nothing on this screen saying so: it read as "the emails no longer leave". So
 * the panel opens with the timing, the outbox job's next expected run and its last one, and what
 * holds the round back (the pinger, the interval, the budget governor — each with the number that
 * applies now); every row says when *it* is expected to leave, and a row whose turn passed longer
 * ago than `/api/health`'s `overdue` threshold says so in red. The switch beside it is the «Termene»
 * setting itself, on the screen where its effect is visible.
 *
 * A Server Component with two forms. Rows are stacked rather than tabulated: five facts about a
 * message do not fit a table at 320 pixels, and a table that scrolls sideways is worse than a
 * paragraph (the same reasoning §196 applied to the one place a table is unavoidable).
 */
export default async function OutboxQueuePanel({ locale, queue, volume, mayEdit, delivery, now, mayEditTiming, openWhen }: Props) {
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  // Inside the row's sentence ("În coadă din joi, 24 sept. 2026, 18:05"), short (§349).
  const when = { format: (at: Date) => formatDay(at, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" }) };

  const scheduled = delivery.timing === "scheduled";
  const nextTickAt = new Date(delivery.nextTickAt);
  const { pingerMinutes, intervalMinutes, governorFloorMinutes } = delivery.holds;
  // The real runs after the next one are spaced by the longer of the two intervals (§334, §447).
  const runInterval = Math.max(intervalMinutes, governorFloorMinutes);
  const waitMinutes = delivery.waitMinutes ?? Math.max(pingerMinutes, runInterval);
  // What holds the round back now, each with its number: the pinger always, the others when set.
  const holds = [
    t("emails.queue.when.holds.pinger", { wait: minutesPhrase(locale, pingerMinutes) }),
    ...(intervalMinutes > 0 ? [t("emails.queue.when.holds.interval", { wait: minutesPhrase(locale, intervalMinutes) })] : []),
    ...(governorFloorMinutes > 0 ? [t("emails.queue.when.holds.governor", { wait: minutesPhrase(locale, governorFloorMinutes) })] : []),
  ];

  /*
    One row's departure, in words (§529). A row being sent is "now"; a row that spent its retries
    goes nowhere on its own; a waiting row leaves at the outbox job's first real run at or after its
    own turn — and when that turn is further back than health's `overdue` allows, it is late, said
    in red: the estimate would otherwise read as a promise the scheduler is not keeping. A newsletter
    held for the allowance's reserve (§445) is the reserve working, as health counts it, never late.
  */
  const leaves = (row: QueuedMessage): { text: string; late: boolean } => {
    if (row.status === "PROCESSING") return { text: t("emails.queue.leaves.sending"), late: false };
    if (row.status === "FAILED") return { text: t("emails.queue.leaves.never"), late: false };
    const dueAt = row.nextAttemptAt ?? row.createdAt;
    // Late by health's own number (§98, §447): `overdueCadenceMinutes` is the cadence `/api/health`
    // adds to its ninety minutes, the planned interval included — one judgement, two screens (§529).
    const late =
      !isBulkMessage(row.messageType) &&
      outboxRowOverdue({ now, dueAt, overdueAfterMs: EMAIL_HEALTH_THRESHOLDS.OVERDUE_AFTER_MS, intervalMinutes: delivery.overdueCadenceMinutes });
    const leavesAt = outboxRowLeavesAt({ dueAt, nextTickAt, intervalMinutes: runInterval, pingerMinutesAt: (instant) => pingerCadenceMinutes(instant) });
    // The departure in the words the screen after the registration form uses for the same message
    // (`emailLeavesWords`, §NNN): «10:15» today, the short day with its «la» and hour otherwise.
    const at = emailLeavesWords(leavesAt, now, locale).at;
    // A family sitting's hold (§519): a turn in the future and no attempt made yet — not a retry,
    // not the newsletter's reserve. It says the hold's end and the round after it.
    if (row.nextAttemptAt && row.nextAttemptAt.getTime() > now.getTime() && row.familyHeld) {
      return { text: t("emails.queue.leaves.held", { until: when.format(row.nextAttemptAt), at }), late: false };
    }
    return { text: late
        ? t(mayEdit ? "emails.queue.leaves.late" : "emails.queue.leaves.lateAskAdmin", { at })
        : t("emails.queue.leaves.at", { at }), late };
  };

  /*
    What «Trimite acum» sends and what it leaves (§529): the claim's own rule — the due rows go, within
    the day's limit; the held ones stay until their turn, each for its reason, counted apart.
  */
  const heldReasons = (["family", "retry", "reserve"] as const)
    .filter((reason) => queue.held[reason] > 0)
    .map((reason) => t(`emails.queue.sendNow.reasons.${reason}`, { count: queue.held[reason] }));
  const sendNowBody =
    queue.held.total > 0 && queue.held.until
      ? `${t("confirm.sendNowBody")} ${t("emails.queue.sendNow.held", { count: queue.held.total, until: when.format(queue.held.until), reasons: heldReasons.join(" · ") })}`
      : t("confirm.sendNowBody");

  return (
    <Panel glyph="outbox"
      title={t("emails.queue.title")}
      intro={t("emails.queue.intro")}
      aside={t("emails.queue.aside", {
        waiting: t("outbox.waitingShort", { count: queue.total }),
        state: scheduled ? t("emails.queue.when.onShort") : t("emails.queue.when.offShort"),
      })}
      collapsible
      // Open while something waits (§269), and after "send now" or the switch answered — sent or refused (§336).
      openWhen={{ ...openWhen, attention: queue.total > 0 }}
      id="outbox-queue"
      data-testid="outbox-queue"
    >
      {/*
        When the queue leaves (§529): the switch's state, the next and the last real run, and what
        holds the round back. Said to every reader of the queue; the switch is the Administrator's.
      */}
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, mb: 2 }} data-testid="outbox-when">
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1, mb: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t("emails.queue.when.title")}
          </Typography>
          <Chip
            size="small"
            color={scheduled ? "primary" : "default"}
            label={scheduled ? t("emails.queue.when.on") : t("emails.queue.when.off")}
            data-testid="outbox-when-state"
            data-timing={delivery.timing}
          />
        </Stack>
        <Typography variant="body2" data-testid="outbox-when-next">
          {scheduled
            ? t("emails.queue.when.scheduled", { at: when.format(nextTickAt), wait: minutesPhrase(locale, waitMinutes) })
            : t("emails.queue.when.immediate", { at: when.format(nextTickAt) })}
        </Typography>
        <Typography variant="body2" color="text.secondary" data-testid="outbox-when-holds">
          {t("emails.queue.when.holdsLead", { holds: holds.join(" · ") })}
        </Typography>
        <Typography variant="body2" color="text.secondary" data-testid="outbox-when-last">
          {delivery.lastRunAt ? t("emails.queue.when.lastRun", { at: when.format(new Date(delivery.lastRunAt)) }) : t("emails.queue.when.neverRan")}
        </Typography>
        {mayEditTiming && (
          /*
            The switch (§529): the «Termene» setting (§513), one press to the other value, asking
            first (§384) with what the press changes — switched off, the queue leaves now.
          */
          <ActionForm
            action={updateDeliveryTimingFromEmailsAction}
            confirm={{
              title: scheduled ? t("emails.queue.when.offTitle") : t("emails.queue.when.onTitle"),
              body: scheduled ? t("emails.queue.when.offBody") : t("emails.queue.when.onBody", { wait: minutesPhrase(locale, Math.max(pingerMinutes, runInterval)) }),
              confirmLabel: scheduled ? t("emails.queue.when.turnOff") : t("emails.queue.when.turnOn"),
              cancelLabel: words.cancel,
            }}
            scope="outbox-timing"
            data-testid="outbox-timing-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="timing" value={scheduled ? "immediate" : "scheduled"} />
            <Box sx={{ mt: 1 }}>
              <GlyphSubmitButton
                label={scheduled ? t("emails.queue.when.turnOff") : t("emails.queue.when.turnOn")}
                pendingLabel={t("emails.deadlines.saving")}
                icon={scheduled ? "turnOff" : "turnOn"}
                variant="outlined"
              />
            </Box>
          </ActionForm>
        )}
      </Box>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" }, mb: 1.5 }}>
        <Typography variant="body2" sx={{ flex: 1, fontWeight: 500 }}>
          {t("emails.queue.count", { count: queue.total })}
        </Typography>
        {/* The same rule the list's button follows (§80): offered only when there is something
            to send and room to send it, because a disabled button cannot say why. And only to
            the role that may press it (§291): for the Organizer the count above is the whole
            answer, and the else-branch's "allowance spent" would be an answer to a question they
            were never offered. "Something to send" is a due row (§529): a queue held entirely —
            a family still signing, a retry, the newsletter's reserve — sends nothing on a press,
            and the sentence says so instead. */}
        {!mayEdit ? null : queue.due > 0 && (volume.remaining === null || volume.remaining > 0) ? (
          <ActionForm
            action={sendOutboxNowFromEmailsAction}
            confirm={{ title: t("confirm.sendNowTitle"), body: sendNowBody, email: words.queue(queue.due), confirmLabel: t("outbox.sendNow"), cancelLabel: words.cancel }}
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
            {queue.total === 0 ? t("outbox.nothingWaiting") : queue.due === 0 ? t("emails.queue.sendNow.nothingDue") : t("outbox.allowanceSpent")}
          </Typography>
        )}
      </Stack>

      {queue.rows.length > 0 && (
        <Stack component="ul" spacing={1} sx={{ listStyle: "none", p: 0, m: 0 }}>
          {queue.rows.map((row) => {
            const departure = leaves(row);
            return (
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
                  {t("emails.queue.facts", { queued: when.format(row.createdAt), attempts: row.attemptCount })}
                </Typography>
                <Typography
                  variant="caption"
                  component="p"
                  color={departure.late ? "error" : "text.primary"}
                  sx={{ fontWeight: 500 }}
                  data-testid="outbox-row-leaves"
                >
                  {departure.text}
                </Typography>
                {row.lastError && (
                  <Typography variant="caption" color="error" component="p" sx={{ mt: 0.5, wordBreak: "break-word" }}>
                    {t("emails.queue.lastError", { error: row.lastError })}
                  </Typography>
                )}
              </Box>
            );
          })}
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
