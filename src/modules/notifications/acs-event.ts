import { withoutBrackets } from "@/infrastructure/email/acs-adapter";
import { redactProviderText } from "@/infrastructure/email/redact";
import { rejectionCause } from "./domain/rejection-cause";
import type { MailgunDeliveryEvent } from "./outbox";

/**
 * What the Azure delivery webhook keeps of one Event Grid event (`docs/AZURE.md` Part 1), as the
 * Mailgun webhook keeps of its own (`mailgun-event.ts`, §670): the status, its instant, the recipient
 * (compared, never stored) and the status words, redacted. The event is mapped onto the shape the
 * outbox already applies (`applyMailgunEvent`), so a bounce from Azure lands on its row exactly as one
 * from Mailgun does.
 *
 * Event Grid's schema for `Microsoft.Communication.EmailDeliveryReportReceived`: `data.status` is
 * one of `Delivered`, `Expanded`, `Bounced`, `Suppressed`, `FilteredSpam`, `Quarantined` or `Failed`.
 * `data.messageId` is Azure's own operation id; `data.internetMessageId`, where Azure sends it, is the
 * `Message-ID` header the adapter stored. Which of the two arrives for mail sent over SMTP is the
 * plan's open question 1: both are tried, and the answer is read on QA.
 */
export type EventGridEvent = {
  eventType?: unknown;
  eventTime?: unknown;
  data?: {
    validationCode?: unknown;
    recipient?: unknown;
    messageId?: unknown;
    internetMessageId?: unknown;
    status?: unknown;
    deliveryAttemptTimestamp?: unknown;
    deliveryStatusDetails?: { statusMessage?: unknown } | null;
  } | null;
};

export const EVENT_GRID_VALIDATION = "Microsoft.EventGrid.SubscriptionValidationEvent";
export const ACS_DELIVERY_REPORT = "Microsoft.Communication.EmailDeliveryReportReceived";

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** The handshake Event Grid sends when the subscription is created: its code, to be echoed back. */
export function validationCodeOf(events: readonly EventGridEvent[]): string | null {
  const handshake = events.find((event) => event.eventType === EVENT_GRID_VALIDATION);
  return handshake ? text(handshake.data?.validationCode) : null;
}

/**
 * Azure's status, as the outbox's event. `Delivered` delivers; `Bounced` is the address; `Suppressed`
 * is an address Azure refuses because it bounced before; `FilteredSpam` and `Quarantined` are a
 * refusal of the message — every one of them final, as a Mailgun `failed` with severity permanent.
 * `Expanded` (a distribution list opened) and `Failed` (Azure's own internal failure, retried by
 * nobody and not about the address) change nothing.
 */
function eventOf(status: string): Pick<MailgunDeliveryEvent, "event" | "severity" | "reason"> | null {
  switch (status) {
    case "Delivered":
      return { event: "delivered", severity: null, reason: null };
    case "Bounced":
      return { event: "failed", severity: "permanent", reason: "bounce" };
    case "Suppressed":
      return { event: "failed", severity: "permanent", reason: "suppress-bounce" };
    case "FilteredSpam":
    case "Quarantined":
      return { event: "failed", severity: "permanent", reason: status.toLowerCase() };
    default:
      return null;
  }
}

/** The delivery events among Event Grid's batch, each mapped; one with no id or no status is skipped. */
export function deliveryEventsOf(events: readonly EventGridEvent[], now: Date): MailgunDeliveryEvent[] {
  const out: MailgunDeliveryEvent[] = [];
  for (const event of events) {
    if (event.eventType !== ACS_DELIVERY_REPORT) continue;
    const data = event.data ?? null;
    const status = text(data?.status);
    const mapped = status ? eventOf(status) : null;
    const id = text(data?.internetMessageId) ?? text(data?.messageId);
    if (!mapped || !id) continue;
    const recipient = text(data?.recipient);
    const words = text(data?.deliveryStatusDetails?.statusMessage);
    const detail = words ? redactProviderText(words, { recipient }) || null : null;
    const occurred = text(data?.deliveryAttemptTimestamp) ?? text(event.eventTime);
    const at = occurred ? new Date(occurred) : null;
    out.push({
      providerMessageId: withoutBrackets(id),
      ...mapped,
      recipient,
      occurredAt: at && !Number.isNaN(at.getTime()) ? at : null,
      code: null,
      detail,
      cause: mapped.event === "delivered" ? null : rejectionCause({ status: "BOUNCED", sent: true, reason: mapped.reason, code: null, detail: words }),
      now,
    });
  }
  return out;
}
