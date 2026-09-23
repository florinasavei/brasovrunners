import { type AppEnvironment, markSubjectForEnvironment } from "@/infrastructure/email/delivery";
import type { SmtpAddress, SmtpMessage } from "@/infrastructure/email/smtp-adapter";
import type { ContactSignals, ContactSuspicion, SuspicionReason } from "./domain/suspicion";

/**
 * The message the club receives when somebody writes through the form (`DECISIONS.md` §149).
 *
 * Romanian, whatever language the visitor wrote in: the reader is the club, and the club
 * reads Romanian. The visitor's own words are quoted as typed. From the club's own sending
 * address (Gmail refuses any other), to the mailboxes the club named, and `Reply-To` the
 * visitor — so "Reply" in Gmail answers them, which is the whole of the workflow. On QA the
 * subject carries the outbox's `[QA] ` mark (AGENTS.md §16.4): the club's real mailboxes are
 * on both projects, and a question typed on the public `qa.` host must not read as a real one.
 *
 * Not a template under `notifications/templates`: those render the club's card for a
 * participant, through the outbox; this is one plain message to the club, through SMTP.
 */

export type ContactMessageInput = {
  name: string;
  email: string;
  message: string;
  /** Which language the form was on, so the club knows how to answer. */
  locale: "ro" | "en";
  /** The page the form was posted from, absolute (§8): the club sees where the question came from. */
  pageUrl: string;
};

export type ContactMessageRoute = {
  from: SmtpAddress;
  to: readonly string[];
  /**
   * The club's copy list (`DECISIONS.md` §164): a real `Cc` header, not a second `To`, so a
   * colleague sees she was copied and "Reply all" keeps the club together on the thread.
   */
  cc?: readonly string[];
  /**
   * The club's hidden copies (2026-09-22): envelope recipients that appear in no header, so
   * neither the visitor's `Reply-To` thread nor the Cc'd colleagues learn of them.
   */
  bcc?: readonly string[];
  /** Which deployment sends it, for the subject's mark. */
  appEnv: AppEnvironment;
};

const LANGUAGE_NAME: Record<ContactMessageInput["locale"], string> = { ro: "română", en: "engleză" };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One line: a header value may not fold, whatever the box allowed. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function contactSubject(name: string): string {
  return `Mesaj de pe site: ${headerSafe(name)}`;
}

/**
 * The mark on a message the gates let through that still looks like a program's
 * (`domain/suspicion.ts`; the owner, 2026-09-23, of SEO spam through the form). Stable, because
 * the club filters on it — a Gmail filter on `subject:"[posibil spam]"` (`SETUP.md` §38) — so a
 * change to these characters is a change to every club mailbox's filter.
 */
export const SUSPICIOUS_SUBJECT_PREFIX = "[posibil spam] ";

/** One line per reason, in Romanian whatever the form's language: the club is the reader (this module's first note). */
function reasonLine(reason: SuspicionReason): string {
  switch (reason.kind) {
    case "no-token":
      return "Verificarea anti-bot nu a rulat: formularul a fost trimis fără token — de obicei un program, nu un om.";
    case "token-rejected":
      return "Cloudflare a respins verificarea anti-bot a acestui formular.";
    case "imitates-club":
      return `Adresa expeditorului imită domeniul clubului: ${reason.senderDomain}.`;
  }
}

/** Under two minutes in seconds, under two hours in minutes, beyond that in hours. */
function elapsedText(seconds: number | null): string {
  if (seconds === null) return "fără ora deschiderii paginii";
  const span = seconds < 120 ? `${seconds} s` : seconds < 7_200 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds / 3_600)} h`;
  return `trimis la ${span} după deschiderea paginii`;
}

function linksText(signals: ContactSignals): string {
  if (signals.linkCount === 0) return "niciun link";
  const more = signals.linkHostCount > signals.linkHosts.length ? ", …" : "";
  return `${signals.linkCount === 1 ? "1 link" : `${signals.linkCount} linkuri`}: ${signals.linkHosts.join(", ")}${more}`;
}

const HONEYPOT_TEXT: Record<ContactSignals["honeypot"], string> = {
  empty: "câmpul ascuns gol",
  "sender-address": "câmpul ascuns completat de browser cu adresa expeditorului",
  filled: "câmpul ascuns completat",
};

const BOT_CHECK_TEXT: Record<ContactSignals["botCheck"], string> = {
  off: "verificarea anti-bot oprită",
  passed: "verificarea anti-bot trecută",
  "no-token": "verificarea anti-bot fără token",
  "no-answer": "Cloudflare nu a răspuns la verificare",
  rejected: "verificarea anti-bot respinsă",
};

/**
 * The footer of a marked message: why, in one plain line a reason, and what else was measured,
 * so the person reading can overrule the mark — a real question from somebody whose browser
 * never ran the widget looks exactly like this, and "Reply" still answers them.
 */
function suspicionFooter(suspicion: ContactSuspicion): { heading: string; reasons: string[]; signals: string } {
  const { signals } = suspicion;
  return {
    heading: "Posibil spam — livrat oricum, ca să nu pierdem un om:",
    reasons: suspicion.reasons.map(reasonLine),
    signals: `Semnale: ${[elapsedText(signals.elapsedSeconds), linksText(signals), HONEYPOT_TEXT[signals.honeypot], BOT_CHECK_TEXT[signals.botCheck]].join(" · ")}`,
  };
}

/**
 * The message itself. `suspicion` is what the gates could not decide (`domain/suspicion.ts`):
 * a suspicious one gets the subject's prefix and a footer below everything else; any other —
 * no suspicion given, or one that found nothing — is byte-for-byte the message as it has always
 * been, which `tests/unit/contact/message.test.ts` pins.
 */
export function renderContactMessage(
  input: ContactMessageInput,
  route: ContactMessageRoute,
  suspicion?: ContactSuspicion,
): SmtpMessage {
  const name = headerSafe(input.name);
  const text = [
    `Nume: ${name}`,
    `E-mail: ${input.email}`,
    `Limba formularului: ${LANGUAGE_NAME[input.locale]}`,
    `Pagina: ${input.pageUrl}`,
    "",
    "Mesaj:",
    input.message,
    "",
    "— Trimis prin formularul de contact al site-ului. Răspunde direct acestui e-mail ca să-i scrii.",
  ].join("\n");

  const html = [
    "<p>",
    `<strong>Nume:</strong> ${escapeHtml(name)}<br>`,
    `<strong>E-mail:</strong> <a href="mailto:${escapeHtml(input.email)}">${escapeHtml(input.email)}</a><br>`,
    `<strong>Limba formularului:</strong> ${LANGUAGE_NAME[input.locale]}<br>`,
    `<strong>Pagina:</strong> <a href="${escapeHtml(input.pageUrl)}">${escapeHtml(input.pageUrl)}</a>`,
    "</p>",
    `<p><strong>Mesaj:</strong></p>`,
    `<p style="white-space:pre-wrap">${escapeHtml(input.message)}</p>`,
    `<p><em>— Trimis prin formularul de contact al site-ului. Răspunde direct acestui e-mail ca să-i scrii.</em></p>`,
  ].join("");

  const marked = suspicion?.suspicious ? suspicionFooter(suspicion) : null;
  // Below the message and the signature, behind a rule, so the visitor's words read first and
  // the platform's verdict is plainly not theirs.
  const markedText = marked
    ? [text, "", "---", marked.heading, ...marked.reasons.map((line) => `• ${line}`), marked.signals].join("\n")
    : text;
  const markedHtml = marked
    ? [
        html,
        "<hr>",
        `<p><strong>${escapeHtml(marked.heading)}</strong></p>`,
        `<ul>${marked.reasons.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
        `<p><small>${escapeHtml(marked.signals)}</small></p>`,
      ].join("")
    : html;
  const subject = marked ? `${SUSPICIOUS_SUBJECT_PREFIX}${contactSubject(name)}` : contactSubject(name);

  return {
    from: route.from,
    // Each address on one line, whatever a setting or a variable once held: a header may not
    // fold (§164). Both lists, because `CONTACT_FORM_TO` is never validated at startup —
    // the operator types it — while the setting's addresses met the canonicalizer.
    to: route.to.map(headerSafe),
    ...(route.cc && route.cc.length > 0 ? { cc: route.cc.map(headerSafe) } : {}),
    ...(route.bcc && route.bcc.length > 0 ? { bcc: route.bcc.map(headerSafe) } : {}),
    // The sender's, marked or not: a real person whose browser never ran the widget is answered
    // with "Reply" like anybody else.
    replyTo: { name, address: input.email },
    // On QA the environment's mark comes first — "[QA] [posibil spam] …" — and a filter on the
    // phrase matches either way.
    subject: markSubjectForEnvironment(subject, route.appEnv),
    text: markedText,
    html: markedHtml,
  };
}
