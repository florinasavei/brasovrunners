import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { pingerCadenceMinutes } from "@/modules/jobs/quiet-hours";
import { type Departure, type DepartureContext, mailgunReopensAt } from "@/modules/notifications/domain/departure";
import { emailLeavesWords } from "@/modules/notifications/domain/email-wait";
import { EMAIL_HEALTH_THRESHOLDS } from "@/modules/notifications/health";
import type { OutboxDelivery } from "@/modules/notifications/outbox-delivery";
import type { EmailVolumeToday } from "@/modules/notifications/volume";

/**
 * The context every waiting row's departure is judged in (`domain/departure.ts`), read once per page from what
 * the page already has: the delivery (`outbox-delivery.ts`) and the day's volume (`volume.ts`). The queue panel
 * and «Emailuri azi» build it the same way, so the two say the same time for the same row.
 */
export function departureContextOf(input: {
  now: Date;
  delivery: OutboxDelivery;
  volume: Pick<EmailVolumeToday, "hourPaceHolds" | "whileStopped" | "remaining" | "period">;
}): DepartureContext {
  const { now, delivery, volume } = input;
  return {
    now,
    timing: delivery.timing,
    nextTickAt: new Date(delivery.nextTickAt),
    // The real runs after the next one are spaced by the longer of the two intervals (§334, §447).
    runIntervalMinutes: Math.max(delivery.holds.intervalMinutes, delivery.holds.governorFloorMinutes),
    overdueCadenceMinutes: delivery.overdueCadenceMinutes,
    overdueAfterMs: EMAIL_HEALTH_THRESHOLDS.OVERDUE_AFTER_MS,
    deferredBeyondMs: EMAIL_HEALTH_THRESHOLDS.DEFERRED_BEYOND_MS,
    hourPaceHolds: volume.hourPaceHolds === true,
    mailgunReopensAt: mailgunReopensAt(volume, now),
    pingerMinutesAt: (instant) => pingerCadenceMinutes(instant),
  };
}

/**
 * One departure in the queue's own words (`Admin.emails.queue.leaves.*`, §529): «Pleacă: 10:30 (estimat).», late
 * in red past health's threshold, a family's hold with its end. The hour as the screen after the registration form
 * says it (`emailLeavesWords`, §536): «10:15» today, the short day with its «la» and hour otherwise. `t` is the
 * `Admin` namespace's translator.
 */
export function departureWords(
  departure: Departure,
  input: { now: Date; locale: Locale; mayEdit: boolean; t: (key: string, values?: Record<string, string | number>) => string },
): { text: string; late: boolean } {
  const { now, locale, mayEdit, t } = input;
  switch (departure.kind) {
    case "sending":
      return { text: t("emails.queue.leaves.sending"), late: false };
    case "never":
      return { text: t("emails.queue.leaves.never"), late: false };
    case "now":
      return { text: t("emails.queue.leaves.leavesNow"), late: false };
    case "reset":
      return { text: t("emails.queue.leaves.reset", { at: emailLeavesWords(departure.at, now, locale).at }), late: false };
    case "at": {
      const at = emailLeavesWords(departure.at, now, locale).at;
      if (departure.heldUntil) {
        const until = formatDay(departure.heldUntil, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
        return { text: t("emails.queue.leaves.held", { until, at }), late: false };
      }
      if (departure.late) return { text: t(mayEdit ? "emails.queue.leaves.late" : "emails.queue.leaves.lateAskAdmin", { at }), late: true };
      return { text: t("emails.queue.leaves.at", { at }), late: false };
    }
  }
}
