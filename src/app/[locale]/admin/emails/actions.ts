"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { parseAddressList } from "@/modules/contact/domain/recipients";
import { updateContactRecipients } from "@/modules/contact/recipients";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { updateEmailCopy } from "@/modules/notifications/email-copy";
import { updateEmailPlan } from "@/modules/notifications/email-plan";
import { requireStaff, requireStaffRole } from "@/modules/staff-identity/session";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * "The plan we are on" (`DECISIONS.md` §100). Administrator only — the same gate as "send
 * now", because both spend the club's allowance — and the service asserts the role again.
 * Lands back on `/admin/emails` with the outcome in the query, like every backoffice action.
 */
export async function updateEmailPlanAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/emails" });

  const number = (name: string): number | null => {
    const value = form.get(name);
    if (typeof value !== "string" || value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : Number.NaN;
  };

  let outcome: string;
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
    outcome = "saved=emailPlan";
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = `error=${error.code}`;
  }
  // The action and the render that follows are one request, and the router keeps the payload
  // it already has for this path: without this the page comes back saying what it said before
  // the press (found on 2026-09-20 — a saved plan and a cleared recipient list both).
  revalidatePath(path);
  redirect(`${path}?${outcome}#admin-alert`);
}

/**
 * "Who receives the contact form's messages" (`DECISIONS.md` §164). The same gate and the same
 * shape as the plan above: Administrator at the door, the service asserting the role again,
 * each address validated there, and the outcome in the query. Two typed lines come in; the
 * service is what decides whether they are addresses.
 */
export async function updateContactRecipientsAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/emails" });
  const list = (name: string): string[] => parseAddressList(typeof form.get(name) === "string" ? String(form.get(name)) : "");

  let outcome: string;
  try {
    const actor = await requireStaffRole("ADMIN");
    await updateContactRecipients(getDb(), actor, { to: list("to"), cc: list("cc") }, new Date());
    outcome = "saved=contactRecipients";
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = `error=${error.code}`;
  }
  // The action and the render that follows are one request, and the router keeps the payload
  // it already has for this path: without this the page comes back saying what it said before
  // the press (found on 2026-09-20 — a saved plan and a cleared recipient list both).
  revalidatePath(path);
  redirect(`${path}?${outcome}#admin-alert`);
}

/**
 * The club's own wording for one message, in one language (`DECISIONS.md` §247).
 *
 * A Redactor's verb, not an Administrator's: §103 is explicit that the Redactor writes the
 * words. The service asserts that again, validates every placeholder, and records the one
 * message that changed. "Revino la textul platformei" is the same form's second button — it
 * posts `reset`, and the service reads that as "no override".
 */
export async function updateEmailCopyAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const lang = form.get("lang") === "en" ? "en" : "ro";
  const path = getPathname({ locale, href: "/admin/emails" });
  const back = `${path}?lang=${lang}`;
  const text = (name: string): string => (typeof form.get(name) === "string" ? String(form.get(name)) : "");

  let outcome: string;
  try {
    const actor = await requireStaff();
    const messageType = text("messageType") as EmailMessageType;
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
            : {
                subject: text("subject"),
                // A blank line between paragraphs, which is how anybody writes them into a box.
                paragraphs: text("paragraphs")
                  .split(/\r?\n\s*\r?\n/)
                  .map((paragraph) => paragraph.trim())
                  .filter((paragraph) => paragraph !== ""),
              },
      },
      new Date(),
    );
    outcome = form.get("reset") === "1" ? "saved=emailCopyReset" : "saved=emailCopy";
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = `error=${error.code}`;
  }
  revalidatePath(path);
  redirect(`${back}&${outcome}#admin-alert`);
}
