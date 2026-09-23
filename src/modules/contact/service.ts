import { createHash } from "node:crypto";
import type { Database } from "@/db/types";
import type { SmtpTransport } from "@/infrastructure/email/smtp-adapter";
import { canonicalizeEmail, InvalidEmailError } from "@/modules/participants/domain/canonical-email";
import { consumeRateLimit, refundRateLimit } from "@/modules/rate-limit/service";
import { looksLikeSpam } from "@/modules/registrations/service";
import { DomainError } from "@/shared/errors/domain-error";
import { contactFields, type ContactInput } from "./fields";
import { type ContactMessageRoute, renderContactMessage } from "./message";

/**
 * "Scrie-ne" (`DECISIONS.md` §149, BR-REQ-070-04): one message from a visitor to the club,
 * sent the moment it is posted, through SMTP and never the outbox.
 *
 * The guards are the registration form's, in the registration form's order, with one
 * difference in what they say. A bot — the trap field filled, the form posted faster than a
 * person reads it — is answered with the same "sent" as everybody else and nothing is sent,
 * because a distinct answer tells the script which check it tripped (BR-REQ-031-01 c3). A
 * person who has written five times this hour is *told* so, plainly: the throttle exists to
 * keep a script out of the club's mailbox, and a person who hits it is not a script.
 *
 * Nothing is stored. The message is the email; the platform keeps no copy, which is what the
 * privacy notice promises ("kept in the club's mailbox as ordinary correspondence") — so the
 * throttle's row holds a hash of the identity, not the address, for the day it lives.
 */

export type ContactDelivery = ContactMessageRoute & { transport: SmtpTransport };

export type ContactOutcome =
  /** Sent, or captured on a laptop. */
  | { outcome: "sent" }
  /** A bot's post: answered as sent, sent nowhere. */
  | { outcome: "ignored" }
  /** Too many this hour; `retryAfter` in seconds, for the sentence on the page. */
  | { outcome: "limited"; retryAfter: number }
  /** The deployment has no way out (`CONTACT_FORM_MODE=off`). */
  | { outcome: "unavailable" }
  /** SMTP refused or timed out; the page says to write directly. */
  | { outcome: "delivery_failed" };

/** Which boxes a rejected post names: the schema's own paths, in the form's order. */
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
): Promise<ContactOutcome> {
  const input = readContactInput(rawInput);

  // The form's silence: the honeypot and the timing check answer "sent" and send nothing.
  if (looksLikeSpam(input, now)) return { outcome: "ignored" };

  // Keyed on the canonical identity (AGENTS.md §10.4, §19.4 — never an IP), the registration
  // form's own bucket rule: a +tag is the same sender, a dotted Gmail spelling is not (§74).
  // Hashed, because the bucket outlives the request and the notice says no copy is kept. An
  // address the canonicalizer refuses is a field error.
  let key: string;
  try {
    key = bucketKey(canonicalizeEmail(input.email).canonicalEmail);
  } catch (error) {
    if (error instanceof InvalidEmailError) throw new DomainError("VALIDATION_ERROR", "invalid email", ["email"]);
    throw error;
  }

  // No way out on this deployment: said before anything is counted against the sender.
  if (!delivery) return { outcome: "unavailable" };

  const verdict = await consumeRateLimit(db, "contact-message", key, now);
  if (!verdict.allowed) return { outcome: "limited", retryAfter: verdict.retryAfter };

  const message = renderContactMessage(
    { name: input.name, email: input.email, message: input.message, locale: input.locale, pageUrl },
    { from: delivery.from, to: delivery.to, cc: delivery.cc, bcc: delivery.bcc, appEnv: delivery.appEnv },
  );
  const result = await delivery.transport.send(message);
  if (result.outcome === "sent") return { outcome: "sent" };

  // The server's refusal, as a code or a class — never the password or its reply (the adapter
  // reduces it): the one trace an operator has on a wrong-password day (`SETUP.md` §38 step 5).
  // A message that reached nobody is not one of the sender's five: on a day the mailbox is
  // down, the fifth try must not turn "we could not send" into "too many messages".
  console.error("[contact] delivery failed", result.error);
  await refundRateLimit(db, "contact-message", key, now);
  return { outcome: "delivery_failed" };
}

/** The bucket's key: equality is all it needs, so the address itself never sits in the table. */
function bucketKey(canonicalEmail: string): string {
  return createHash("sha256").update(`contact-message:${canonicalEmail}`).digest("hex");
}
