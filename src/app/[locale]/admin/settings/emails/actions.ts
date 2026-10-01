"use server";

import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { addressListRefusal, parseAddressList } from "@/modules/contact/domain/recipients";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { updateClubNotices } from "@/modules/notifications/club-notices";
import { CLUB_NOTICE_RECIPIENTS_MAX, clubNoticeBoxesOf } from "@/modules/notifications/domain/club-notices";
import { EmailCopySampleValueError, type EmailSampleHit } from "@/modules/notifications/domain/email-sample";
import { updateEmailCopy } from "@/modules/notifications/email-copy";
import { updateEmailPlan } from "@/modules/notifications/email-plan";
import { updateEmailTransport } from "@/modules/notifications/email-transport";
import { sendOutboxNow } from "@/modules/notifications/send-now";
import { SendNowRefused, sendNowRefusalCode } from "@/modules/notifications/send-at-once";
import { RetryFailedThrottled, retryFailedEmails } from "@/modules/notifications/retry-failed";
import { updateDeliveryTiming } from "@/modules/notifications/delivery-timing";
import { requireStaff, requireStaffCapability } from "@/modules/staff-identity/session";
import { canManageClubSettings, canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, keptValuesOf, refused } from "@/shared/forms/outcome";
import { wholeDigits } from "@/shared/forms/whole-digits";
import { emailBodyToParagraphs, readEmailBody } from "@/modules/notifications/domain/email-rich-text";

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * "The plan we are on" (`DECISIONS.md` §100). Administrator only — the same gate as "send
 * now", because both spend the club's allowance — and the service asserts the role again.
 * Lands back on «Setări» → «Emailuri» (§516) with the outcome in the query, like every backoffice action;
 * a refusal comes back as the form's state with every box still filled (§315).
 */
export async function updateEmailPlanAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/emails" });

  // Plain text boxes: only a whole number of digits counts; "12.7", "1e3" and "0x10" are refused, never
  // rounded — the desk's race-number rule, one function (`wholeDigits`, §553).
  const number = (name: string): number | null => wholeDigits(form.get(name));

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateEmailPlan(
      getDb(),
      actor,
      {
        plan: form.get("plan"),
        dailyAllowance: number("dailyAllowance"),
        monthlyAllowance: number("monthlyAllowance"),
        // «Limita pe oră» (§605): empty is no pace; a form without the box (a page from before it) is the default.
        hourlyAllowance: form.has("hourlyAllowance") ? number("hourlyAllowance") : undefined,
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
  await flashOutcome({ saved: "emailPlan" });
  redirect(`${path}?saved=emailPlan#admin-alert`);
}

/**
 * "Prin ce pleacă emailurile" (§443): the road per group, Gmail's cap, pace and choice at the cap, the overflow. The
 * plan's gate and shape: Administrator at the door, the service asserting the role again and
 * validating every field, a refusal returned with the boxes as typed (§315).
 */
export async function updateEmailTransportAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/emails" });
  const choice = (name: string): unknown => form.get(name);
  const whole = (name: string): number => {
    const value = form.get(name);
    if (typeof value !== "string" || value.trim() === "") return Number.NaN;
    return Number(value);
  };

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateEmailTransport(
      getDb(),
      actor,
      {
        groups: {
          links: choice("links"),
          confirmations: choice("confirmations"),
          reminders: choice("reminders"),
          announcements: choice("announcements"),
          club: choice("club"),
          newsletter: choice("newsletter"),
        },
        gmailDailyCap: whole("gmailDailyCap"),
        gmailPaceSeconds: whole("gmailPaceSeconds"),
        atGmailCap: choice("atGmailCap"),
        overflowToGmail: form.get("overflowToGmail") === "yes",
        // «Gmail preia când Mailgun se oprește» (§622): greyed — not posted — where Gmail is not configured; the service keeps it then.
        ...(form.has("fallbackToGmail") ? { fallbackToGmail: form.get("fallbackToGmail") === "yes" } : {}),
      },
      new Date(),
    );
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  await flashOutcome({ saved: "emailTransport" });
  redirect(`${path}?saved=emailTransport#admin-alert`);
}

/**
 * "Send now", from the queue panel (`DECISIONS.md` §243), and the same verb the registrations
 * list has had since §80: one service, `sendOutboxNow`, which is where the Administrator gate,
 * the throttle, the day's allowance and the audit row live. This is the thin half — where to
 * land, and in which language — exactly like the actions above it.
 */
export async function sendOutboxNowFromEmailsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/emails" });

  let outcome: string;
  try {
    // The registrations list's own verb (§80): the same predicate here, there and in the service.
    const actor = await requireStaffCapability(canManageRegistrations);
    const result = await sendOutboxNow(getDb(), actor, new Date());
    // Gmail carried for a stopped Mailgun (§622): the page says how many, why and until when.
    // The queue's header says a stop nobody carries; the sentence says only what Gmail carried (§622).
    const carried = result.stop && result.carriedByGmail ? `&gmail=${result.viaGmail}&stop=${result.stop.kind}&until=${encodeURIComponent(result.stop.until.toISOString())}` : "";
    outcome = `saved=outboxSent&sent=${result.sent}${carried}`;
    await flashOutcome({ saved: "outboxSent", sent: String(result.sent) });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    // Mailgun's hour spent is its own sentence (§605), its stop too, with when it ends (§622); every other refusal its code.
    const until = error instanceof SendNowRefused && error.until ? `&until=${encodeURIComponent(error.until.toISOString())}` : "";
    outcome = `error=${sendNowRefusalCode(error)}${until}`;
  }
  // The queue the page is about has just changed; without this the panel comes back showing
  // the rows it showed before the press (the same trap §164 and §100 documented above).
  revalidatePath(path);
  redirect(`${path}?${outcome}#admin-alert`);
}

/**
 * «Reîncearcă emailurile eșuate» (§622): the week's FAILED rows back in the queue, from the queue
 * panel. The service is where the gate (`canManageRegistrations`), the three-an-hour throttle and the
 * audit row live; this is where to land, with the count.
 */
export async function retryFailedEmailsFromEmailsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/emails" });

  let outcome: string;
  try {
    const actor = await requireStaffCapability(canManageRegistrations);
    const { retried } = await retryFailedEmails(getDb(), actor, new Date());
    outcome = `saved=failedRetried&sent=${retried}`;
    await flashOutcome({ saved: "failedRetried", sent: String(retried) });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = `error=${error instanceof RetryFailedThrottled ? error.reason : error.code}`;
  }
  revalidatePath(path);
  redirect(`${path}?${outcome}#admin-alert`);
}

/**
 * The queue panel's switch (§529): «Trimitere programată» on or off, beside the rows it decides
 * the departure of. The same setting, service and gates as «Când pleacă emailurile» in «Termene»
 * (§513) — the Administrator at the door and in the service, one closed choice the schema decides,
 * audited — landing back on the queue it has just changed. Switched off, the service also sends
 * what the round was holding, after this response.
 */
export async function updateDeliveryTimingFromEmailsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/emails" });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateDeliveryTiming(getDb(), actor, { timing: form.get("timing") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  // The panel names the new timing and the queue's departures; «Termene» states the same setting.
  revalidatePath(path);
  revalidatePath(getPathname({ locale, href: "/admin/settings/deadlines" }));
  await flashOutcome({ saved: "deliveryTiming" });
  redirect(`${path}?saved=deliveryTiming#outbox-queue`);
}

/**
 * Who at the club receives the declaration copies and the confirmation notices (§244, §245).
 * The same gate and the same shape as the two above: Administrator at the door, the service
 * asserting the role again and validating every address, the outcome in the query.
 */
export async function updateClubNoticesAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/emails" });
  // `posted`, not `text`: the catalogue check reads any `t…("key")` in a file that translates.
  const posted = (name: string): string => (typeof form.get(name) === "string" ? String(form.get(name)).trim() : "");
  const list = (name: string): string[] => parseAddressList(posted(name));

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    /*
      "Declarațiile semnate merg la" holds one address (§244). Two typed there were refused as one
      invalid entry, which reads as a typo; the refusal says instead that the box takes one and
      where the others go (§457). Asked after the role, so nobody else learns anything from it.
    */
    if (list("declarationsTo").length > 1) {
      return { error: "ONE_ADDRESS_ONLY", fields: ["declarationsTo"], values: keptValuesOf(form) };
    }
    await updateClubNotices(
      getDb(),
      actor,
      {
        // Split like the list boxes, so "arhiva@x.ro;" is the address and not a refusal naming it.
        declarations: { to: list("declarationsTo")[0] ?? "", cc: list("declarationsCc"), bcc: list("declarationsBcc") },
        confirmations: { to: list("confirmationsTo") },
        // A club copy of every message a real participant receives (2026-09-22): since §320 one
        // outbox row per address, queued beside the participant's by `enqueueEmail`, stripped of
        // every token, the QR and the attachments when it is rendered.
        participants: { bcc: list("participantsBcc") },
      },
      new Date(),
    );
  } catch (error) {
    /*
      The refusal names the boxes and says why (§457): the service's list paths mapped to the
      form's names, and the entries that are not addresses — or the list over the ceiling — in
      the sentence. The owner met "Verifică datele introduse" linking to nothing, and a Bcc that
      would not save.
    */
    const outcome = refused(error, form, { fieldNames: (domain) => clubNoticeBoxesOf(domain.fields) });
    if (outcome.error !== "VALIDATION_ERROR") return outcome;
    const lists = [list("declarationsTo").slice(0, 1), ...(["declarationsCc", "declarationsBcc", "confirmationsTo", "participantsBcc"] as const).map(list)];
    return { ...outcome, ...addressListRefusal(lists, CLUB_NOTICE_RECIPIENTS_MAX) };
  }
  revalidatePath(path);
  await flashOutcome({ saved: "clubNotices" });
  redirect(`${path}?saved=clubNotices#admin-alert`);
}

/**
 * The club's own wording for one message, in one language (`DECISIONS.md` §247).
 *
 * A Redactor's verb, not an Administrator's: §103 is explicit that the Redactor writes the
 * words. The service asserts that again, validates every placeholder, and records the one
 * message that changed. "Revino la textul implicit" is the same form's second button — it
 * posts `reset`, and the service reads that as "no override". "Înlocuiește cu câmpurile" is a
 * third, drawn only while the saved text holds sample values (§359): it posts `replace`, and the
 * service rewrites them to their fields before it saves. A text that still holds one is refused,
 * naming the value and its field.
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

/**
 * The refusal of words that still hold sample values (§359), as the form's state: the boxes named
 * as for any refusal, and the sentence filled with the value and what goes in its place — the one
 * value, or each of them — in the backoffice's language.
 */
async function sampleValueRefusal(error: EmailCopySampleValueError, outcome: FormOutcome, locale: Locale): Promise<FormOutcome> {
  const t = await getTranslations({ locale, namespace: "Admin" });
  const replacementOf = (hit: EmailSampleHit) =>
    hit.placeholder ? `{${hit.placeholder}}` : t("emails.copy.sampleWords", { words: hit.words ?? "" });
  const distinct = error.hits.filter((hit, index) => error.hits.findIndex((other) => other.value === hit.value) === index);
  if (distinct.length === 1) {
    return { ...outcome, error: "SAMPLE_VALUE_IN_EMAIL", errorValues: { value: distinct[0].value, placeholder: replacementOf(distinct[0]) } };
  }
  const found = distinct.map((hit) => t("emails.copy.samplePair", { value: hit.value, replacement: replacementOf(hit) })).join("; ");
  return { ...outcome, error: "SAMPLE_VALUES_IN_EMAIL", errorValues: { found } };
}

export async function updateEmailCopyAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const lang = form.get("lang") === "en" ? "en" : "ro";
  const path = getPathname({ locale, href: "/admin/settings/emails" });
  const back = `${path}?lang=${lang}`;
  const posted = (name: string): string => (typeof form.get(name) === "string" ? String(form.get(name)) : "");
  const reset = form.get("reset") === "1";
  // "Înlocuiește cu câmpurile" (§359): a third submit on the same form, saving what is in the boxes
  // with every sample value rewritten to its field — the same gate and audit row as a save.
  const replace = !reset && form.get("replace") === "1";

  let outcome: string;
  const messageType = posted("messageType") as EmailMessageType;
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
        entry: reset ? null : emailCopyEntryFrom(posted("subject"), posted("body")),
        replaceSampleValues: replace,
      },
      new Date(),
    );
    outcome = reset ? "saved=emailCopyReset" : replace ? "saved=emailCopySamples" : "saved=emailCopy";
    await flashOutcome({ saved: outcome.slice("saved=".length) });
  } catch (error) {
    // The subject and the words come back as typed (§315); the `reset` and `replace` presses are not values.
    const kept = refused(error, form, { never: ["reset", "replace"] });
    return error instanceof EmailCopySampleValueError ? sampleValueRefusal(error, kept, locale) : kept;
  }
  revalidatePath(path);
  // The message is named on the way back (§336), so its card opens with the preview that just
  // changed. Only a real type reaches this line — anything else was refused above.
  redirect(`${back}&${outcome}&message=${messageType}#admin-alert`);
}
