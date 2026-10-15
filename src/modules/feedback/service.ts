import type { Database } from "@/db/types";
import { type AppEnvironment, QA_SUBJECT_PREFIX } from "@/infrastructure/email/delivery";
import { contactSuspicion } from "@/modules/contact/domain/suspicion";
import { recordHeldBack, shouldHoldBack } from "@/modules/contact/held-back";
import { SUSPICIOUS_SUBJECT_PREFIX, suspicionFooter } from "@/modules/contact/message";
import type { ContactScreening } from "@/modules/contact/service";
import { drainRelayAfterResponse } from "@/modules/notifications/drain";
import { enqueueRelay } from "@/modules/notifications/relay";
import { consumeRateLimit, refundRateLimit } from "@/modules/rate-limit/service";
import { looksLikeSpam } from "@/modules/registrations/service";
import { DomainError } from "@/shared/errors/domain-error";
import {
  audiencesFor,
  chosenAudience,
  defaultAudience,
  effectiveFeedbackSettings,
  fallbackAllowedFor,
  type FeedbackAudience,
  type FeedbackBranch,
  type FeedbackInput,
  type FeedbackRoads,
  type FeedbackSettings,
  type FeedbackVia,
  composeFeedbackEmail,
  feedbackFields,
  FEEDBACK_BRANCHES,
  invalidFeedbackFields,
  offeredBranches,
  replyAddressForInput,
  viaFor,
} from "./domain/branches";

/**
 * «Spune-ne ceva» (§676): one anonymous message from a visitor — queued in the outbox the moment it is posted (§NNN) and sent at
 * once, after the response, by the relay (`notifications/relay.ts`). The service composes the message, applies the gates and
 * writes the row; it sends nothing itself. The words stay in the row only until the message is delivered, then they are deleted
 * (§NNN, amending §676's «kept nowhere»): no body or address in a log line, and the audit trail has no row about it. *
 * **Two roads, chosen by the club for each form (§772, amending §676).** The club's Gmail over SMTP —
 * the way a contact message leaves (§149) — or Mailgun, the configured adapter through the environment's
 * sender (which captures on a laptop and in the tests). The default is what §676 fixed in code: Gmail for
 * «Cum a fost», «O sugestie» and «O reclamație», Mailgun for «Girl Zone». Either way the message goes to
 * the address the club set for the form, `Reply-To` the address the person typed beside their name when
 * they typed one (§772; none otherwise — on Mailgun's road not even the club's), with Mailgun's tracking
 * off, and a message for the club's mailbox is marked «[posibil spam]» on the contact form's own signals
 * (§310) whichever road carries it. A message for Girl Zone's person has a neutral subject and is never
 * held back or marked. On Gmail the club's mailbox readers see a Girl Zone message — the one Gmail's Sent
 * folder keeps — so the person's confidentiality is the club's choice, said on the card (§772). **A road that
 * refuses is the relay's, no longer the page's (§NNN):** the person is answered «trimis», the message waits in the
 * outbox and, after two refusals by the service, the other road carries it (`domain/road-failover.ts`) — for Girl Zone's
 * person only with the club's tick and the notice's words (`fallbackAllowedFor`).
 *
 * **Who hears it, in the named mode (§678).** «Cine să afle?» may send a named message on any branch
 * to the club's mailbox (the branch's own recipient; for the safety branch the «O reclamație»
 * recipient, else the contact form's) or to the safety branch's person, with the neutral subject — the
 * road follows the form whose reader it reaches (`roadBranch`), never the form it was written on. An
 * anonymous message reaches its branch's own reader, as before. A choice not offered is refused on its box.
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

export type FeedbackDeps = {
  settings: FeedbackSettings;
  /** The privacy notice in force names `{{feedbackForms}}` in every language (`noticeDescribesFeedbackForms`). */
  noticeDescribes: boolean;
  /**
   * The privacy notice in force names `{{feedbackSafetyGmail}}` in every language
   * (`noticeDescribesFeedbackSafetyGmail`, §772): until it does, Girl Zone's messages leave by Mailgun
   * whatever the card says (`effectiveFeedbackSettings`).
   */
  safetyGmailDescribed: boolean;
  /**
   * The privacy notice in force names `{{feedbackFormsNamed}}` in every language
   * (`noticeDescribesFeedbackFormsNamed`): until it does, every post is anonymous (§678).
   */
  namedDescribed: boolean;
  /** The contact form's own recipients (`contactDelivery`'s «to»), where a named safety report for «Clubul» goes when «O reclamație» has none. */
  clubFallback: readonly string[];
  /**
   * Which roads this deployment has (`feedbackRoads`): the form is offered only where the road the club chose exists. The roads
   * themselves are the relay’s (§NNN, `notifications/relay-roads.ts`): the service queues, it does not send.
   */
  roads: FeedbackRoads;
  /** Which deployment sends, for the subject's `[QA] ` (§163). */
  appEnv: AppEnvironment;
  /** What Cloudflare said and what the post carried — never the IP (`AGENTS.md` §19.4). */
  screening: ContactScreening;
  /** The published event's title for a slug, in the form's language; null for one the club does not publish. */
  eventTitle: (slug: string, locale: "ro" | "en") => Promise<string | null>;
};

export type FeedbackOutcome =
  /** Sent; `audience` only when a named message reached the other reader than its branch's own (§678). */
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
 * The function log's one line: the branch, the reader once it is known (`club` or `person`, §678) and
 * the outcome — never a word the person typed, an address or a name (§676).
 */
function logged(branch: FeedbackBranch | "unknown", outcome: FeedbackOutcome, reader?: FeedbackAudience): FeedbackOutcome {
  console.info(`[feedback] ${branch}${reader ? ` ${reader}` : ""}: ${outcome.outcome}`);
  return outcome;
}

export async function submitFeedback<T extends Record<string, unknown>>(
  db: Database<T>,
  given: FeedbackDeps,
  rawInput: unknown,
  now: Date,
): Promise<FeedbackOutcome> {
  // The settings as they act: Girl Zone leaves by Gmail only while the notice in force says so (§772).
  const deps: FeedbackDeps = { ...given, settings: effectiveFeedbackSettings(given.settings, given.safetyGmailDescribed) };
  const branch = postedBranch(rawInput);
  const roads: FeedbackRoads = deps.roads;
  if (!branch || !offeredBranches(deps.settings, deps.noticeDescribes, roads).includes(branch)) {
    return logged(branch ?? "unknown", { outcome: "unavailable" });
  }
  // Cloudflare's own refusal only (§216): a widget that never ran is `unavailable`, and passes.
  if (deps.screening.turnstileVerdict === "failed") return logged(branch, { outcome: "captcha" });

  // Anonymous only until the notice in force says a name may be given (§678).
  const input = readFeedbackInput(deps.namedDescribed ? rawInput : asAnonymous(rawInput));

  // A password manager that filled the trap with the typed address is autofill, not a bot (§282).
  const typedContact = (input.branch === "safety" ? input.email || input.contact : input.email) ?? undefined;
  if (looksLikeSpam({ honeypot: input.honeypot, renderedAt: input.renderedAt, email: typedContact }, now)) {
    return logged(branch, input.branch === "safety" ? { outcome: "unavailable" } : { outcome: "ignored" });
  }

  // «Cine să afle?» (§678): the branch's own reader unless a named post chose the other one offered.
  const offeredAudiences = audiencesFor(branch, deps.settings, { ...roads, clubFallback: deps.clubFallback.length > 0 });
  const audience = chosenAudience(input, offeredAudiences);
  if (!audience) throw new DomainError("VALIDATION_ERROR", "the feedback form chose a reader not offered", ["audience"]);
  const recipients = readersOf(branch, audience, deps);
  if (recipients.length === 0) return logged(branch, { outcome: "unavailable" }, audience);
  // The road the club chose for the form that reaches this reader (§772); absent on this deployment is no road.
  const via = viaFor(deps.settings, branch, audience);
  if (!roads[via]) return logged(branch, { outcome: "unavailable" }, audience);

  const verdict = await consumeRateLimit(db, "feedback", branch, now);
  if (!verdict.allowed) return logged(branch, { outcome: "limited", retryAfter: verdict.retryAfter }, audience);

  const eventSlug = input.branch === "howItWent" || input.branch === "complaint" ? input.event : null;
  const eventTitle = eventSlug ? await deps.eventTitle(eventSlug, input.locale) : null;
  const email = composeFeedbackEmail(input, { eventTitle, toPerson: audience === "person" }, deps.appEnv);

  let queued: "queued" | "held";
  try {
    queued = await deliver(db, deps, via, audience, recipients, email, input, now);
  } catch (error) {
    // The queue could not be written (the database is away): a message that was kept nowhere is not one of the branch's thirty.
    await refundRateLimit(db, "feedback", branch, now).catch(() => undefined);
    throw error;
  }
  if (queued === "held") {
    // Held back by the Administrator's tick (§744): it reached nobody, so it is not one of the branch's
    // thirty an hour either. The bucket is keyed on the branch, and a bot flood held back in silence
    // must not lock real people out of it. The sender is answered «trimis», as ever; the log says «held».
    await refundRateLimit(db, "feedback", branch, now);
    return audience === defaultAudience(branch) ? { outcome: "sent" } : { outcome: "sent", audience };
  }
  // Queued: it leaves at once, after this response, and by the other road when the chosen one is down (§NNN).
  return logged(branch, audience === defaultAudience(branch) ? { outcome: "sent" } : { outcome: "sent", audience }, audience);
}

/** A post with the named mode taken away (§678): `feedbackFields` then drops the name, the way back and the reader. */
function asAnonymous(raw: unknown): unknown {
  return raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>), identity: "anonymous" } : raw;
}

/** The addresses one reader is: the safety branch's person, or the club's mailbox for the branch (`audiencesFor`). */
function readersOf(branch: FeedbackBranch, audience: "club" | "person", deps: FeedbackDeps): readonly string[] {
  if (audience === "person") return deps.settings.safety.to ? [deps.settings.safety.to] : [];
  if (branch !== "safety") return deps.settings[branch].to ? [deps.settings[branch].to as string] : [];
  return deps.settings.complaint.to ? [deps.settings.complaint.to] : deps.clubFallback;
}

/**
 * One message queued, for the road the club chose (§772; §NNN). What the road is does not change what the message
 * is: for the club's mailbox it is screened first on the contact form's signals — held back when the
 * Administrator's tick says so (§744), else marked «[posibil spam]» (§310) — and for Girl Zone's person
 * it never is, because a lost report costs more than a marked one. `Reply-To` is the address typed
 * beside the name (`replyAddressForInput`), through the canonicalizer already; none otherwise, on either road.
 *
 * One outbox row per recipient — each address on its own, as Mailgun's allowance counts them and as nobody on
 * the list needs to see the others — carrying the message until it is delivered (`notifications/relay.ts`), and
 * the other road when this one is down and the message may take it (`fallbackAllowedFor`). Sent at once, after
 * the response (`drainRelayAfterResponse`).
 */
async function deliver<T extends Record<string, unknown>>(
  db: Database<T>,
  deps: FeedbackDeps,
  via: FeedbackVia,
  audience: FeedbackAudience,
  recipients: readonly string[],
  email: { subject: string; text: string; html: string },
  input: FeedbackInput,
  now: Date,
): Promise<"queued" | "held"> {
  const replyAddress = replyAddressForInput(input);
  let content = email;
  if (audience === "club") {
    const screened = await screenForClub(db, email, input, replyAddress, deps.screening, now);
    if (screened === "held") return "held";
    content = screened;
  }
  const fallbackAllowed = fallbackAllowedFor(deps.settings, audience, deps.safetyGmailDescribed);
  // All the rows or none: a second insert that fails must not leave the first one queued while the visitor is told it failed (and
  // the rate limit is given back), or a resubmit would send the first recipient's copy twice.
  const queued = await db.transaction(async (tx) => {
    const ids: string[] = [];
    for (const address of recipients.map((entry) => entry.replace(/[\r\n]+/g, " ").trim())) {
      const row = await enqueueRelay(tx, {
        type: "FEEDBACK_MESSAGE",
        road: via,
        to: address,
        locale: input.locale,
        content: {
          subject: content.subject,
          text: content.text,
          html: content.html,
          fallbackAllowed,
          form: "feedback",
          ...(replyAddress ? { replyTo: replyAddress, ...(input.name ? { replyToName: input.name } : {}) } : { noReplyTo: true as const }),
        },
        now,
      });
      if (row) ids.push(row.id);
    }
    return ids;
  });
  drainRelayAfterResponse(queued);
  return "queued";
}

/**
 * The contact form's screen for the club's mailbox (§310, §744): `"held"` when the Administrator's tick
 * says a suspected message is counted and not emailed, else the message — marked «[posibil spam]» when it
 * looks automated. The safety branch is never held back, whichever reader it is sent to.
 */
async function screenForClub<T extends Record<string, unknown>>(
  db: Database<T>,
  email: { subject: string; text: string; html: string },
  input: FeedbackInput,
  replyAddress: string | null,
  screening: ContactScreening,
  now: Date,
): Promise<"held" | { subject: string; text: string; html: string }> {
  const rendered = Date.parse(input.renderedAt ?? "");
  const suspicion = contactSuspicion({
    ...screening,
    elapsedMs: Number.isNaN(rendered) ? null : now.getTime() - rendered,
    // A confidential report's address is not the screen's to read: «imitates-club» and the trap compare it with the club's domain, and a report is never marked on it (§772).
    senderEmail: input.branch === "safety" ? "" : (replyAddress ?? ""),
    message: input.message,
    honeypot: input.honeypot,
  });
  // The contact form's tick (§744 (amends §310)): counted, not emailed, answered «trimis». The safety
  // branch is never held back — a lost report costs more than a marked one.
  if (input.branch !== "safety" && suspicion.suspicious && shouldHoldBack(suspicion, screening.holdBack === true)) {
    await recordHeldBack(db, input.branch, now);
    console.info("[feedback] held back as possible spam:", suspicion.reasons.map((reason) => reason.kind).join(","));
    return "held";
  }
  const marked = suspicion.suspicious ? suspicionFooter(suspicion) : null;
  if (!marked) return email;
  const text = [email.text, "", "---", marked.heading, ...marked.reasons.map((line) => `• ${line}`), marked.signals].join("\n");
  const html = `${email.html}<hr><p><strong>${escapeHtml(marked.heading)}</strong></p><ul>${marked.reasons.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul><p><small>${escapeHtml(marked.signals)}</small></p>`;
  // On QA the environment's mark comes first — «[QA] [posibil spam] …» — as on the contact form.
  return { subject: markAfterEnvironment(email.subject), text, html };
}

function markAfterEnvironment(subject: string): string {
  return subject.startsWith(QA_SUBJECT_PREFIX)
    ? `${QA_SUBJECT_PREFIX}${SUSPICIOUS_SUBJECT_PREFIX}${subject.slice(QA_SUBJECT_PREFIX.length)}`
    : `${SUSPICIOUS_SUBJECT_PREFIX}${subject}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
