import { type AppEnvironment, markSubjectForEnvironment } from "@/infrastructure/email/delivery";
import type { SmtpAddress, SmtpMessage } from "@/infrastructure/email/smtp-adapter";

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

export function renderContactMessage(input: ContactMessageInput, route: ContactMessageRoute): SmtpMessage {
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

  return {
    from: route.from,
    to: route.to,
    replyTo: { name, address: input.email },
    subject: markSubjectForEnvironment(contactSubject(name), route.appEnv),
    text,
    html,
  };
}
