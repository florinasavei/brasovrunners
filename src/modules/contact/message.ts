import { type AppEnvironment, markSubjectForEnvironment } from "@/infrastructure/email/delivery";
import type { SmtpAddress, SmtpMessage } from "@/infrastructure/email/smtp-adapter";
import type { ContactSignals, ContactSuspicion, SuspicionReason } from "./domain/suspicion";

/**
 * The message the club receives from the contact form (§149). Romanian whatever the visitor's
 * language; from the club's sending address (Gmail refuses any other), `Reply-To` the visitor;
 * `[QA] ` on QA (AGENTS.md §16.4). Plain SMTP, not an outbox template.
 */

export type ContactMessageInput = {
  name: string;
  email: string;
  message: string;
  locale: "ro" | "en";
  /** Absolute (§8). */
  pageUrl: string;
};

export type ContactMessageRoute = {
  from: SmtpAddress;
  to: readonly string[];
  /** A real `Cc` header, so "Reply all" keeps the club on the thread (§164). */
  cc?: readonly string[];
  /** Envelope-only recipients, named in no header. */
  bcc?: readonly string[];
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

/** Keep stable: the club's Gmail filters on it (`SETUP.md` §38). */
export const SUSPICIOUS_SUBJECT_PREFIX = "[posibil spam] ";

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

/** The reasons and everything measured, so the reader can overrule the mark. */
function suspicionFooter(suspicion: ContactSuspicion): { heading: string; reasons: string[]; signals: string } {
  const { signals } = suspicion;
  return {
    heading: "Posibil spam — livrat oricum, ca să nu pierdem un om:",
    reasons: suspicion.reasons.map(reasonLine),
    signals: `Semnale: ${[elapsedText(signals.elapsedSeconds), linksText(signals), HONEYPOT_TEXT[signals.honeypot], BOT_CHECK_TEXT[signals.botCheck]].join(" · ")}`,
  };
}

/** A suspicious message gets the subject prefix and a footer; any other is byte-for-byte unchanged (tests pin it). */
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
  // Behind a rule, below the visitor's words, so the verdict is plainly not theirs.
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
    // A header may not fold (§164); `CONTACT_FORM_TO` is never validated at startup.
    to: route.to.map(headerSafe),
    ...(route.cc && route.cc.length > 0 ? { cc: route.cc.map(headerSafe) } : {}),
    ...(route.bcc && route.bcc.length > 0 ? { bcc: route.bcc.map(headerSafe) } : {}),
    replyTo: { name, address: input.email },
    // "[QA] [posibil spam] …" on QA; a filter on the phrase matches either way.
    subject: markSubjectForEnvironment(subject, route.appEnv),
    text: markedText,
    html: markedHtml,
  };
}
