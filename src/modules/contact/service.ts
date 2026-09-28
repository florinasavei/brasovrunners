import type { Database } from "@/db/types";
import type { SmtpTransport } from "@/infrastructure/email/smtp-adapter";
import { canonicalizeEmail, InvalidEmailError } from "@/modules/participants/domain/canonical-email";
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { consumeRateLimit, refundRateLimit } from "@/modules/rate-limit/service";
import { looksLikeSpam } from "@/modules/registrations/service";
import type { TurnstileVerdict } from "@/modules/registrations/turnstile";
import { DomainError } from "@/shared/errors/domain-error";
import { contactSuspicion } from "./domain/suspicion";
import { contactFields, type ContactInput } from "./fields";
import { type ContactMessageRoute, renderContactMessage } from "./message";

/**
 * "Scrie-ne" (§149, BR-REQ-070-04): a visitor's message, sent at once through SMTP, never the
 * outbox, and never stored. A bot is answered "sent" and nothing is sent (BR-REQ-031-01 c3); a
 * throttled person is told so. What passes the gates but looks automated is delivered marked
 * "[posibil spam]" and still answered "sent" (`domain/suspicion.ts`, `AGENTS.md` §19.4, §39).
 */

export type ContactDelivery = ContactMessageRoute & { transport: SmtpTransport };

/** What the action knows beyond the form's fields. Never the visitor's IP (`AGENTS.md` §19.4). */
export type ContactScreening = {
  /** The club's switch is on and both Turnstile keys are set (§97, §254). */
  botCheckOn: boolean;
  tokenPresent: boolean;
  turnstileVerdict: TurnstileVerdict;
  /** From `APP_BASE_URL`; `null` switches the imitation rule off. */
  clubHost: string | null;
};

/** A caller that screened nothing marks nothing. */
const UNSCREENED: ContactScreening = {
  botCheckOn: false,
  tokenPresent: false,
  turnstileVerdict: "not_configured",
  clubHost: null,
};

export type ContactOutcome =
  /** Sent or captured, marked or not. */
  | { outcome: "sent" }
  /** A bot's post: answered as sent, sent nowhere. */
  | { outcome: "ignored" }
  /** Too many this hour; `retryAfter` in seconds, for the sentence on the page. */
  | { outcome: "limited"; retryAfter: number }
  /** The deployment has no way out (`CONTACT_FORM_MODE=off`). */
  | { outcome: "unavailable" }
  /** SMTP refused or timed out; the page says to write directly. */
  | { outcome: "delivery_failed" };

/** Which boxes a rejected post names, in the form's order. */
function invalidFields(error: unknown): string[] {
  const issues = (error as { issues?: Array<{ path?: unknown[] }> }).issues ?? [];
  const named = new Set(issues.map((issue) => String(issue.path?.[0] ?? "")));
  return ["name", "email", "message"].filter((field) => named.has(field));
}

export function readContactInput(input: unknown): ContactInput {
  const parsed = contactFields.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", "the contact form is incomplete", invalidFields(parsed.error));
  }
  return parsed.data;
}

export async function submitContactMessage<T extends Record<string, unknown>>(
  db: Database<T>,
  delivery: ContactDelivery | null,
  rawInput: unknown,
  now: Date,
  pageUrl: string,
  screening: ContactScreening = UNSCREENED,
): Promise<ContactOutcome> {
  const input = readContactInput(rawInput);

  // Honeypot and timing check: answer "sent", send nothing.
  if (looksLikeSpam(input, now)) return { outcome: "ignored" };

  // Keyed on the hashed canonical identity, never an IP (AGENTS.md §10.4, §19.4; §74): no copy
  // of the address is kept.
  let key: string;
  try {
    key = bucketKey(canonicalizeEmail(input.email).canonicalEmail);
  } catch (error) {
    if (error instanceof InvalidEmailError) throw new DomainError("VALIDATION_ERROR", "invalid email", ["email"]);
    throw error;
  }

  // Before anything is counted against the sender.
  if (!delivery) return { outcome: "unavailable" };

  const verdict = await consumeRateLimit(db, "contact-message", key, now);
  if (!verdict.allowed) return { outcome: "limited", retryAfter: verdict.retryAfter };

  // Nothing below can refuse the message (§205).
  const suspicion = contactSuspicion({
    ...screening,
    elapsedMs: elapsedSince(input.renderedAt, now),
    senderEmail: input.email,
    message: input.message,
    honeypot: input.honeypot,
  });

  const message = renderContactMessage(
    { name: input.name, email: input.email, message: input.message, locale: input.locale, pageUrl },
    { from: delivery.from, to: delivery.to, cc: delivery.cc, bcc: delivery.bcc, appEnv: delivery.appEnv },
    suspicion,
  );
  const result = await delivery.transport.send(message);
  if (result.outcome === "sent") {
    // Reason names only, never anything typed (§216).
    if (suspicion.suspicious) {
      console.info("[contact] delivered marked as possible spam:", suspicion.reasons.map((reason) => reason.kind).join(","));
    }
    return { outcome: "sent" };
  }

  // The adapter reduces the error to a code, never the password (`SETUP.md` §38 step 5). A
  // message that reached nobody is refunded, so a mailbox outage does not throttle the sender.
  console.error("[contact] delivery failed", result.error);
  await refundRateLimit(db, "contact-message", key, now);
  return { outcome: "delivery_failed" };
}

/** `null` when the form carried no readable render time (§217). */
function elapsedSince(renderedAt: string | undefined, now: Date): number | null {
  const at = Date.parse(renderedAt ?? "");
  return Number.isNaN(at) ? null : now.getTime() - at;
}

function bucketKey(canonicalEmail: string): string {
  return emailBucketKey("contact-message", canonicalEmail);
}
