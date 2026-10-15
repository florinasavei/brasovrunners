import type { Database } from "@/db/types";
import { drainRelayAfterResponse } from "@/modules/notifications/drain";
import { enqueueRelay } from "@/modules/notifications/relay";
import { canonicalizeEmail, InvalidEmailError } from "@/modules/participants/domain/canonical-email";
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { consumeRateLimit, refundRateLimit } from "@/modules/rate-limit/service";
import { looksLikeSpam } from "@/modules/registrations/service";
import type { TurnstileVerdict } from "@/modules/registrations/turnstile";
import { DomainError } from "@/shared/errors/domain-error";
import { contactSuspicion } from "./domain/suspicion";
import { recordHeldBack, shouldHoldBack } from "./held-back";
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
 *
 * **What the gates let through is still read** (the owner, 2026-09-23: "primesc spam cu SEO
 * stuff"). A script that posts no token, leaves the trap empty and waits out the timer passes
 * all three by design, because a person with JavaScript off does exactly the same (§205, §216).
 * So such a message is not refused and not dropped: it is **delivered, marked** —
 * "[posibil spam]" in front of the subject and a footer naming why (`domain/suspicion.ts`) — and
 * the sender is answered "sent" like anybody else, so a script learns nothing about which signal
 * it tripped (`AGENTS.md` §19.4, §39).
 */

/**
 * Who receives and from where (the club's recipients, the sender's name, the environment for the subject's mark) — and no
 * transport since §NNN: the message is queued in the outbox and the relay's roads carry it (`notifications/relay.ts`).
 */
export type ContactDelivery = ContactMessageRoute;

/**
 * What the action knows about the post that the form's fields do not carry: whether the club's
 * challenge was on, whether a token came with the post and what Cloudflare said of it, and the
 * deployment's hostname for the imitation rule. Never the visitor's IP (`AGENTS.md` §19.4):
 * it goes to Cloudflare with the token and nowhere else.
 */
export type ContactScreening = {
  /** The club's switch is on and both Turnstile keys are set (§97, §254). */
  botCheckOn: boolean;
  /** A token came with the post, whatever Cloudflare then said of it. */
  tokenPresent: boolean;
  turnstileVerdict: TurnstileVerdict;
  /** This deployment's hostname, from `APP_BASE_URL`; `null` switches the imitation rule off. */
  clubHost: string | null;
  /**
   * The Administrator's «Nu-mi trimite mesajele care par spam» (§744), read by the caller with the
   * recipients row it already has. Absent reads as off.
   */
  holdBack?: boolean;
};

/** A caller that screened nothing marks nothing: the message is exactly what it always was. */
const UNSCREENED: ContactScreening = {
  botCheckOn: false,
  tokenPresent: false,
  turnstileVerdict: "not_configured",
  clubHost: null,
};

export type ContactOutcome =
  /** Sent, or captured on a laptop — marked "[posibil spam]" or not: the answer is the same. */
  | { outcome: "sent" }
  /** A bot's post: answered as sent, sent nowhere. */
  | { outcome: "ignored" }
  /** Too many this hour; `retryAfter` in seconds, for the sentence on the page. */
  | { outcome: "limited"; retryAfter: number }
  /** The deployment has no way out (`CONTACT_FORM_MODE=off`). */
  | { outcome: "unavailable" };

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
  screening: ContactScreening = UNSCREENED,
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

  // Past every gate; now only read. Nothing below can refuse the message (§205).
  const suspicion = contactSuspicion({
    ...screening,
    elapsedMs: elapsedSince(input.renderedAt, now),
    senderEmail: input.email,
    message: input.message,
    honeypot: input.honeypot,
  });

  // The Administrator's tick (§744 (amends §310)): a message the check marks is counted and not
  // emailed. The sender's answer is the same "sent" — a script learns nothing. Unticked, the
  // code below is exactly what it was.
  if (suspicion.suspicious && shouldHoldBack(suspicion, screening.holdBack === true)) {
    await recordHeldBack(db, "contact", now);
    console.info("[contact] held back as possible spam:", suspicion.reasons.map((reason) => reason.kind).join(","));
    return { outcome: "sent" };
  }

  const message = renderContactMessage(
    { name: input.name, email: input.email, message: input.message, locale: input.locale, pageUrl },
    { from: delivery.from, to: delivery.to, cc: delivery.cc, bcc: delivery.bcc, appEnv: delivery.appEnv },
    suspicion,
  );
  /*
    Queued, not sent from here (§NNN, amending §149): the club's Gmail is the road the form always had, the other road
    takes over when it is down and the message may take it, and the retries are the outbox's. A transport that fails no
    longer loses the message or tells the visitor «nu am putut trimite»: the row is the promise. The first recipient is
    the row's `To`, the rest ride as visible copies with the club's own list, as they always did.
  */
  const [first, ...otherTo] = message.to;
  const copies = [...otherTo, ...(message.cc ?? [])];
  let row;
  try {
    row = await enqueueRelay(db, {
      type: "CONTACT_MESSAGE",
      road: "gmail",
      to: first,
      locale: input.locale,
      content: {
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(copies.length > 0 ? { cc: copies } : {}),
        ...(message.bcc && message.bcc.length > 0 ? { bcc: message.bcc } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo.address, replyToName: message.replyTo.name } : {}),
        fallbackAllowed: true,
        form: "contact",
      },
      now,
    });
  } catch (error) {
    // Nothing was kept: not one of the sender's five.
    await refundRateLimit(db, "contact-message", key, now).catch(() => undefined);
    throw error;
  }
  if (row) drainRelayAfterResponse([row.id]);
  // How often the mark fires, for whoever reads the function log — the reasons' names only,
  // never the address, the domain or anything typed (§216's rule for its own line).
  if (suspicion.suspicious) {
    console.info("[contact] queued marked as possible spam:", suspicion.reasons.map((reason) => reason.kind).join(","));
  }
  return { outcome: "sent" };
}

/** Milliseconds from the page's render to the post, or `null` when the form carried no readable time (§217). */
function elapsedSince(renderedAt: string | undefined, now: Date): number | null {
  const at = Date.parse(renderedAt ?? "");
  return Number.isNaN(at) ? null : now.getTime() - at;
}

/** The bucket's key: equality is all it needs, so the address itself never sits in the table. */
function bucketKey(canonicalEmail: string): string {
  return emailBucketKey("contact-message", canonicalEmail);
}
