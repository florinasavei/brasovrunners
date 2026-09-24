"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { parseAddressList } from "@/modules/contact/domain/recipients";
import { updateContactRecipients } from "@/modules/contact/recipients";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { updateClubNotices } from "@/modules/notifications/club-notices";
import { updateDeadlines } from "@/modules/deadlines/deadlines";
import { DEADLINE_KEYS } from "@/modules/deadlines/domain/deadlines";
import { updateEmailCopy } from "@/modules/notifications/email-copy";
import { updateEmailPlan } from "@/modules/notifications/email-plan";
import { sendOutboxNow } from "@/modules/notifications/send-now";
import { requireStaff, requireStaffRole } from "@/modules/staff-identity/session";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
import { emailBodyToParagraphs, readEmailBody } from "@/modules/notifications/domain/email-rich-text";

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * "The plan we are on" (`DECISIONS.md` §100). Administrator only — the same gate as "send
 * now", because both spend the club's allowance — and the service asserts the role again.
 * Lands back on `/admin/emails` with the outcome in the query, like every backoffice action;
 * a refusal comes back as the form's state with every box still filled (§315).
 */
export async function updateEmailPlanAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/emails" });

  const number = (name: string): number | null => {
    const value = form.get(name);
    if (typeof value !== "string" || value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : Number.NaN;
  };

  try {
    const actor = await requireStaffRole("ADMIN");
    await updateEmailPlan(
      getDb(),
      actor,
      {
        plan: form.get("plan"),
        dailyAllowance: number("dailyAllowance"),
        monthlyAllowance: number("monthlyAllowance"),
        note: typeof form.get("note") === "string" ? form.get("note") : "",
      },
      new Date(),
    );
  } catch (error) {
    return refused(error, form);
  }
  // The action and the render that follows are one request, and the router keeps the payload
  // it already has for this path: without this the page comes back saying what it said before
  // the press (found on 2026-09-20 — a saved plan and a cleared recipient list both).
  revalidatePath(path);
  redirect(`${path}?saved=emailPlan#admin-alert`);
}

/**
 * "Who receives the contact form's messages" (`DECISIONS.md` §164). The same gate and the same
 * shape as the plan above: Administrator at the door, the service asserting the role again,
 * each address validated there, and the outcome in the query. Two typed lines come in; the
 * service is what decides whether they are addresses.
 */
export async function updateContactRecipientsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/emails" });
  const list = (name: string): string[] => parseAddressList(typeof form.get(name) === "string" ? String(form.get(name)) : "");

  try {
    const actor = await requireStaffRole("ADMIN");
    await updateContactRecipients(getDb(), actor, { to: list("to"), cc: list("cc"), bcc: list("bcc") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  // The action and the render that follows are one request, and the router keeps the payload
  // it already has for this path: without this the page comes back saying what it said before
  // the press (found on 2026-09-20 — a saved plan and a cleared recipient list both).
  revalidatePath(path);
  redirect(`${path}?saved=contactRecipients#admin-alert`);
}

/**
 * "Send now", from the queue panel (`DECISIONS.md` §243), and the same verb the registrations
 * list has had since §80: one service, `sendOutboxNow`, which is where the Administrator gate,
 * the throttle, the day's allowance and the audit row live. This is the thin half — where to
 * land, and in which language — exactly like the two actions above it.
 */
export async function sendOutboxNowFromEmailsAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/emails" });

  let outcome: string;
  try {
    const actor = await requireStaffRole("ADMIN");
    const result = await sendOutboxNow(getDb(), actor, new Date());
    outcome = `saved=outboxSent&sent=${result.sent}`;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = `error=${error.code}`;
  }
  // The queue the page is about has just changed; without this the panel comes back showing
  // the rows it showed before the press (the same trap §164 and §100 documented above).
  revalidatePath(path);
  redirect(`${path}?${outcome}#admin-alert`);
}

/**
 * Who at the club receives the declaration copies and the confirmation notices (§244, §245).
 * The same gate and the same shape as the two above: Administrator at the door, the service
 * asserting the role again and validating every address, the outcome in the query.
 */
export async function updateClubNoticesAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/emails" });
  const text = (name: string): string => (typeof form.get(name) === "string" ? String(form.get(name)).trim() : "");
  const list = (name: string): string[] => parseAddressList(text(name));

  try {
    const actor = await requireStaffRole("ADMIN");
    await updateClubNotices(
      getDb(),
      actor,
      {
        declarations: { to: text("declarationsTo"), cc: list("declarationsCc"), bcc: list("declarationsBcc") },
        confirmations: { to: list("confirmationsTo") },
        // A club copy of every message a real participant receives (2026-09-22): since §320 one
        // outbox row per address, queued beside the participant's by `enqueueEmail`, stripped of
        // every token, the QR and the attachments when it is rendered.
        participants: { bcc: list("participantsBcc") },
      },
      new Date(),
    );
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  redirect(`${path}?saved=clubNotices#admin-alert`);
}

/**
 * "Termene" — the club's deadlines (§NNN). Administrator at the door and in the service, like
 * every other setting on this page; every box is a whole number the service checks against its
 * bounds, and a refusal comes back as the form's state with every box as typed (§315). The seven
 * boxes post under their own names (`DEADLINE_KEYS`), read here as strings: the service's schema
 * is what decides whether they are numbers.
 */
export async function updateDeadlinesAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/emails" });

  try {
    const actor = await requireStaffRole("ADMIN");
    await updateDeadlines(
      getDb(),
      actor,
      Object.fromEntries(DEADLINE_KEYS.map((key) => [key, typeof form.get(key) === "string" ? String(form.get(key)).trim() : ""])),
      new Date(),
    );
  } catch (error) {
    return refused(error, form);
  }
  // The when-lines and the previews under the panel say these numbers; without this the page
  // comes back saying the old ones (the trap §164 and §100 documented above).
  revalidatePath(path);
  redirect(`${path}?saved=deadlines#admin-alert`);
}

/**
 * The club's own wording for one message, in one language (`DECISIONS.md` §247).
 *
 * A Redactor's verb, not an Administrator's: §103 is explicit that the Redactor writes the
 * words. The service asserts that again, validates every placeholder, and records the one
 * message that changed. "Revino la textul platformei" is the same form's second button — it
 * posts `reset`, and the service reads that as "no override".
 */
/**
 * What the form posts, as an entry (§270): the subject, the document the rich-text island wrote,
 * and the plain paragraphs **derived from that document** rather than typed separately.
 *
 * Derived, so the two halves of a message cannot disagree: the plain-text part of every email is
 * built from `paragraphs`, and a club that edited the formatted words and left a stale textarea
 * behind would have sent one wording to a reading client and another to a plain one.
 *
 * A document that cannot be parsed — an older browser posting the textarea's contents, a node an
 * email may not carry — falls back to reading the field as plain paragraphs separated by blank
 * lines, which is exactly what the box did before this. The save then refuses or accepts on the
 * words alone, and nobody loses what they typed.
 */
function emailCopyEntryFrom(subject: string, body: string): { subject: string; paragraphs: string[]; body?: unknown } {
  const plain = (value: string): string[] =>
    value
      .split(/\r?\n\s*\r?\n/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph !== "");

  let parsed: unknown;
  try {
    parsed = body.trim() === "" ? null : JSON.parse(body);
  } catch {
    parsed = null;
  }
  const doc = parsed === null ? null : readEmailBody(parsed);
  if (!doc) return { subject, paragraphs: plain(body) };
  return { subject, paragraphs: emailBodyToParagraphs(doc), body: doc };
}

export async function updateEmailCopyAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const lang = form.get("lang") === "en" ? "en" : "ro";
  const path = getPathname({ locale, href: "/admin/emails" });
  const back = `${path}?lang=${lang}`;
  const text = (name: string): string => (typeof form.get(name) === "string" ? String(form.get(name)) : "");

  let outcome: string;
  const messageType = text("messageType") as EmailMessageType;
  try {
    const actor = await requireStaff();
    if (!(emailMessageType.enumValues as readonly string[]).includes(messageType)) {
      throw new DomainError("VALIDATION_ERROR", `unknown message type ${messageType}`);
    }
    await updateEmailCopy(
      getDb(),
      actor,
      {
        messageType,
        locale: lang,
        entry:
          form.get("reset") === "1"
            ? null
            : emailCopyEntryFrom(text("subject"), text("body")),
      },
      new Date(),
    );
    outcome = form.get("reset") === "1" ? "saved=emailCopyReset" : "saved=emailCopy";
  } catch (error) {
    // The subject and the words come back as typed (§315); the `reset` press is not a value.
    return refused(error, form, { never: ["reset"] });
  }
  revalidatePath(path);
  // The message is named on the way back (§336), so its card opens with the preview that just
  // changed. Only a real type reaches this line — anything else was refused above.
  redirect(`${back}&${outcome}&message=${messageType}#admin-alert`);
}
