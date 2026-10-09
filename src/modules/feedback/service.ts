import { randomUUID } from "node:crypto";
import type { Database } from "@/db/types";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import { type AppEnvironment, QA_SUBJECT_PREFIX } from "@/infrastructure/email/delivery";
import type { SmtpAddress, SmtpTransport } from "@/infrastructure/email/smtp-adapter";
import { contactSuspicion } from "@/modules/contact/domain/suspicion";
import { SUSPICIOUS_SUBJECT_PREFIX, suspicionFooter } from "@/modules/contact/message";
import type { ContactScreening } from "@/modules/contact/service";
import { consumeRateLimit, refundRateLimit } from "@/modules/rate-limit/service";
import { looksLikeSpam } from "@/modules/registrations/service";
import { DomainError } from "@/shared/errors/domain-error";
import {
  audiencesFor,
  chosenAudience,
  defaultAudience,
  type FeedbackAudience,
  type FeedbackBranch,
  type FeedbackInput,
  type FeedbackSettings,
  composeFeedbackEmail,
  feedbackFields,
  FEEDBACK_BRANCHES,
  invalidFeedbackFields,
  offeredBranches,
} from "./domain/branches";

/**
 * «Spune-ne ceva» (§676): one anonymous message from a visitor, sent the moment it is posted and
 * kept nowhere — no table, no outbox row, no audit of what it says, no body or address in a log line.
 *
 * **Two roads, chosen by the branch.** «Cum a fost», «O sugestie» and «O reclamație» leave the way a
 * contact message leaves (§149): the club's Gmail over SMTP, to the address the club set for that
 * branch, `Reply-To` the address the person typed when they typed one, and marked «[posibil spam]»
 * on the contact form's own signals (§310). The safety branch leaves **by Mailgun alone** — the
 * configured adapter through the environment's sender, which captures on a laptop and in the tests —
 * to one person's own address, with a neutral subject, no `Reply-To` and Mailgun's tracking off: a
 * copy in the shared Gmail's Sent folder is the opposite of «only {name}», so it has no Gmail road and
 * no fallback. A road that refuses is said on the page («Nu am putut trimite acum…») with the text
 * kept, never a silent loss and never a second road.
 *
 * **Who hears it, in the named mode (§NNN).** «Cine să afle?» may send a named message on any branch
 * to the club's mailbox (the branch's own recipient; for the safety branch the «O reclamație»
 * recipient, else the contact form's) by the SMTP road, or to the safety branch's person by Mailgun
 * alone, with the neutral subject — the road follows the reader, never the branch. An anonymous
 * message reaches its branch's own reader, as before. A choice not offered is refused on its box.
 * While the privacy notice in force does not name `{{feedbackFormsNamed}}` (`namedDescribed`), every
 * post is read as anonymous: no name, no way back, no choice of reader.
 *
 * **The gates, in the contact form's order**: the branch must be offered (switched on, a recipient,
 * the notice in force describing the forms); Cloudflare's `failed` refuses; the fields; the honeypot
 * and the timing check — answered «trimis» with nothing sent on the three ordinary branches, and on
 * the safety branch with the neutral «Nu am putut trimite acum…» and the text kept, because a lost
 * report costs more than a bot's sentence; the road; one bucket per branch an hour (there is no
 * identity to key on), said plainly.
 */

/** The SMTP road the three ordinary branches take (`contact/delivery.ts`, `contactSmtpRoad`). */
export type FeedbackSmtpRoad = { transport: SmtpTransport; from: SmtpAddress; appEnv: AppEnvironment };

/** The safety branch's road: the environment's sender over Mailgun (`createEmailSenderForEnvironment`), never Gmail. */
export type FeedbackMailgunRoad = { send(message: OutgoingEmail): Promise<SendResult> };

export type FeedbackDeps = {
  settings: FeedbackSettings;
  /** The privacy notice in force names `{{feedbackForms}}` in every language (`noticeDescribesFeedbackForms`). */
  noticeDescribes: boolean;
  /**
   * The privacy notice in force names `{{feedbackFormsNamed}}` in every language
   * (`noticeDescribesFeedbackFormsNamed`): until it does, every post is anonymous (§NNN).
   */
  namedDescribed: boolean;
  /** The contact form's own recipients (`contactDelivery`'s «to»), where a named safety report for «Clubul» goes when «O reclamație» has none. */
  clubFallback: readonly string[];
  smtp: FeedbackSmtpRoad | null;
  mailgun: FeedbackMailgunRoad | null;
  /** Which deployment sends, for the subject's `[QA] ` (§163). */
  appEnv: AppEnvironment;
  /** What Cloudflare said and what the post carried — never the IP (`AGENTS.md` §19.4). */
  screening: ContactScreening;
  /** The published event's title for a slug, in the form's language; null for one the club does not publish. */
  eventTitle: (slug: string, locale: "ro" | "en") => Promise<string | null>;
};

export type FeedbackOutcome =
  /** Sent; `audience` only when a named message reached the other reader than its branch's own (§NNN). */
  | { outcome: "sent"; audience?: FeedbackAudience }
  /** A bot's post on an ordinary branch: answered as sent, sent nowhere. */
  | { outcome: "ignored" }
  /** The branch's thirty this hour; `retryAfter` in seconds. */
  | { outcome: "limited"; retryAfter: number }
  /** Not offered, no road, or the road refused — or the safety branch's answer to a post that looked automated. */
  | { outcome: "unavailable" }
  /** Cloudflare looked at the token and rejected it. */
  | { outcome: "captcha" };

/** The branch the post names, read before anything else: every other gate depends on it. */
function postedBranch(raw: unknown): FeedbackBranch | null {
  const branch = raw && typeof raw === "object" ? (raw as { branch?: unknown }).branch : undefined;
  return FEEDBACK_BRANCHES.find((name) => name === branch) ?? null;
}

export function readFeedbackInput(raw: unknown): FeedbackInput {
  const parsed = feedbackFields.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "the feedback form is incomplete", invalidFeedbackFields(parsed.error));
  return parsed.data;
}

/**
 * The function log's one line: the branch, the reader once it is known (`club` or `person`, §NNN) and
 * the outcome — never a word the person typed, an address or a name (§676).
 */
function logged(branch: FeedbackBranch | "unknown", outcome: FeedbackOutcome, reader?: FeedbackAudience): FeedbackOutcome {
  console.info(`[feedback] ${branch}${reader ? ` ${reader}` : ""}: ${outcome.outcome}`);
  return outcome;
}

export async function submitFeedback<T extends Record<string, unknown>>(
  db: Database<T>,
  deps: FeedbackDeps,
  rawInput: unknown,
  now: Date,
): Promise<FeedbackOutcome> {
  const branch = postedBranch(rawInput);
  if (!branch || !offeredBranches(deps.settings, deps.noticeDescribes, deps.smtp !== null).includes(branch)) {
    return logged(branch ?? "unknown", { outcome: "unavailable" });
  }
  // Cloudflare's own refusal only (§216): a widget that never ran is `unavailable`, and passes.
  if (deps.screening.turnstileVerdict === "failed") return logged(branch, { outcome: "captcha" });

  // Anonymous only until the notice in force says a name may be given (§NNN).
  const input = readFeedbackInput(deps.namedDescribed ? rawInput : asAnonymous(rawInput));

  // A password manager that filled the trap with the typed address is autofill, not a bot (§282).
  const typedContact = input.branch === "safety" ? input.contact : (input.email ?? undefined);
  if (looksLikeSpam({ honeypot: input.honeypot, renderedAt: input.renderedAt, email: typedContact }, now)) {
    return logged(branch, input.branch === "safety" ? { outcome: "unavailable" } : { outcome: "ignored" });
  }

  // «Cine să afle?» (§NNN): the branch's own reader unless a named post chose the other one offered.
  const offeredAudiences = audiencesFor(branch, deps.settings, { smtp: deps.smtp !== null, clubFallback: deps.clubFallback.length > 0 });
  const audience = chosenAudience(input, offeredAudiences);
  if (!audience) throw new DomainError("VALIDATION_ERROR", "the feedback form chose a reader not offered", ["audience"]);
  const recipients = readersOf(branch, audience, deps);
  if (recipients.length === 0) return logged(branch, { outcome: "unavailable" }, audience);
  const road = audience === "person" ? deps.mailgun : deps.smtp;
  if (!road) return logged(branch, { outcome: "unavailable" }, audience);

  const verdict = await consumeRateLimit(db, "feedback", branch, now);
  if (!verdict.allowed) return logged(branch, { outcome: "limited", retryAfter: verdict.retryAfter }, audience);

  const eventSlug = input.branch === "howItWent" || input.branch === "complaint" ? input.event : null;
  const eventTitle = eventSlug ? await deps.eventTitle(eventSlug, input.locale) : null;
  const email = composeFeedbackEmail(input, { eventTitle, toPerson: audience === "person" }, deps.appEnv);

  const sent =
    audience === "person"
      ? await sendSafety(deps.mailgun as FeedbackMailgunRoad, recipients[0], email, input.locale)
      : await sendOrdinary(deps.smtp as FeedbackSmtpRoad, recipients, email, input, deps.screening, now);
  if (sent) return logged(branch, audience === defaultAudience(branch) ? { outcome: "sent" } : { outcome: "sent", audience }, audience);

  // A message that reached nobody is not one of the branch's thirty.
  await refundRateLimit(db, "feedback", branch, now);
  return logged(branch, { outcome: "unavailable" }, audience);
}

/** A post with the named mode taken away (§NNN): `feedbackFields` then drops the name, the way back and the reader. */
function asAnonymous(raw: unknown): unknown {
  return raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>), identity: "anonymous" } : raw;
}

/** The addresses one reader is: the safety branch's person, or the club's mailbox for the branch (`audiencesFor`). */
function readersOf(branch: FeedbackBranch, audience: "club" | "person", deps: FeedbackDeps): readonly string[] {
  if (audience === "person") return deps.settings.safety.to ? [deps.settings.safety.to] : [];
  if (branch !== "safety") return deps.settings[branch].to ? [deps.settings[branch].to as string] : [];
  return deps.settings.complaint.to ? [deps.settings.complaint.to] : deps.clubFallback;
}

/** Mailgun alone (§676): no `Reply-To`, tracking off (every Mailgun send, §320), the environment's tag. */
async function sendSafety(road: FeedbackMailgunRoad, to: string, email: { subject: string; text: string; html: string }, locale: "ro" | "en"): Promise<boolean> {
  const result = await road.send({
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
    locale,
    // Identifies this send for a webhook and nothing else: no person, no content.
    idempotencyKey: `feedback:${randomUUID()}`,
    noReplyTo: true,
  });
  return result.outcome === "sent";
}

/**
 * The contact form's road (§149, §310): the club's Gmail, `Reply-To` the typed address, marked when it
 * looks automated. A named safety report the sender sent to «Clubul» (§NNN) takes it too, with its
 * neutral subject and no `Reply-To` — its way back may be a telephone, and it is in the body.
 */
async function sendOrdinary(
  road: FeedbackSmtpRoad,
  to: readonly string[],
  email: { subject: string; text: string; html: string },
  input: FeedbackInput,
  screening: ContactScreening,
  now: Date,
): Promise<boolean> {
  const rendered = Date.parse(input.renderedAt ?? "");
  const replyAddress = input.branch === "safety" ? null : input.email;
  const suspicion = contactSuspicion({
    ...screening,
    elapsedMs: Number.isNaN(rendered) ? null : now.getTime() - rendered,
    senderEmail: replyAddress ?? "",
    message: input.message,
    honeypot: input.honeypot,
  });
  const marked = suspicion.suspicious ? suspicionFooter(suspicion) : null;
  const text = marked ? [email.text, "", "---", marked.heading, ...marked.reasons.map((line) => `• ${line}`), marked.signals].join("\n") : email.text;
  const html = marked
    ? `${email.html}<hr><p><strong>${escapeHtml(marked.heading)}</strong></p><ul>${marked.reasons.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul><p><small>${escapeHtml(marked.signals)}</small></p>`
    : email.html;
  // On QA the environment's mark comes first — «[QA] [posibil spam] …» — as on the contact form.
  const subject = marked ? markAfterEnvironment(email.subject) : email.subject;
  const result = await road.transport.send({
    from: road.from,
    to: to.map((address) => address.replace(/[\r\n]+/g, " ").trim()),
    // Only in the named mode (§NNN): the anonymous mode has no address to answer, and no name.
    ...(replyAddress ? { replyTo: { name: input.name || replyAddress, address: replyAddress } } : {}),
    subject,
    text,
    html,
  });
  if (result.outcome !== "sent") console.error("[feedback] delivery failed", result.error);
  return result.outcome === "sent";
}

function markAfterEnvironment(subject: string): string {
  return subject.startsWith(QA_SUBJECT_PREFIX)
    ? `${QA_SUBJECT_PREFIX}${SUSPICIOUS_SUBJECT_PREFIX}${subject.slice(QA_SUBJECT_PREFIX.length)}`
    : `${SUSPICIOUS_SUBJECT_PREFIX}${subject}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
