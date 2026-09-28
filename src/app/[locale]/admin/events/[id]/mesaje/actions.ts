"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { checkOrganizerMessage } from "@/modules/notifications/domain/organizer-message";
import { DELIVERY_CHOICE_FIELD, deliveryChoiceOf } from "@/modules/notifications/domain/send-at-once";
import { SendNowRefused, sendNowRefusalCode } from "@/modules/notifications/send-at-once";
import {
  type ParticipantMessagePreview,
  previewParticipantMessage,
  sendParticipantMessage,
} from "@/modules/notifications/participant-messages";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flash } from "@/shared/feedback/flash";
import { type FormOutcome, keptValuesOf, refused } from "@/shared/forms/outcome";

/**
 * "Trimite un mesaj participanților" (`DECISIONS.md` §364): the send and the live preview.
 *
 * Both ask the session who is asking and let the service decide whether they may
 * (`canMessageParticipants`, BR-REQ-060-01) — a POST replayed from anywhere never went past the
 * page that hides the link.
 */

function localeOf(value: FormDataEntryValue | null): Locale {
  return typeof value === "string" && (routing.locales as readonly string[]).includes(value) ? (value as Locale) : routing.defaultLocale;
}

function posted(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The send, behind `ActionForm` (§315): a refusal comes back as the form's state with every box
 * still filled — the empty language named, an unknown `{placeholder}` named in the sentence, an
 * empty group named on its radio buttons — and a send redirects to the page with what it queued.
 * A second press of the same form lands on the page saying so, with nothing queued again.
 */
export async function sendParticipantMessageAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form.get("uiLocale"));
  const eventId = posted(form, "eventId");
  const words = {
    subject: { ro: posted(form, "subjectRo"), en: posted(form, "subjectEn") },
    body: { ro: posted(form, "bodyRo"), en: posted(form, "bodyEn") },
  };

  // The dialog's answer (§540): «now» past the scheduled pass, anything else the queue, as before.
  const delivery = deliveryChoiceOf(form.get(DELIVERY_CHOICE_FIELD));

  let result;
  try {
    const actor = await requireStaff();
    result = await sendParticipantMessage(
      getDb(),
      actor,
      { eventId, audience: posted(form, "audience"), sendId: posted(form, "sendId"), delivery, ...words },
      new Date(),
    );
  } catch (error) {
    // A «now» the day's allowance cannot hold (§80, §540): its own sentence, the boxes as typed.
    if (error instanceof SendNowRefused) {
      return { error: sendNowRefusalCode(error), fields: [], values: keptValuesOf(form) };
    }
    // An unknown placeholder is refused with its name in the sentence, so the organizer knows
    // which `{…}` to correct and not only which box it is in (§247's rule, said the same way).
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") {
      const names = [
        ...new Set(
          checkOrganizerMessage(words).issues.flatMap((issue) => (issue.problem === "unknownPlaceholder" ? issue.names : [])),
        ),
      ];
      if (names.length > 0) {
        return {
          error: "MESSAGE_UNKNOWN_PLACEHOLDER",
          errorValues: { names: names.map((name) => `{${name}}`).join(", ") },
          fields: error.fields,
          values: keptValuesOf(form),
        };
      }
    }
    return refused(error, form);
  }

  if (result.kind === "nobody") {
    return { error: "NO_RECIPIENTS", fields: ["audience"], values: keptValuesOf(form) };
  }

  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/mesaje", params: { id: eventId } } });
  const query = result.kind === "duplicate" ? "duplicate=1" : `sent=${result.real}&test=${result.test}`;
  // The toast (§384): what was queued, for how many — the same count the banner shows.
  await flash(
    result.kind === "duplicate"
      ? { kind: "info", key: "participantMessageDuplicate" }
      : // Sent now, past the scheduled pass (§540), says so; a list longer than one press sends
        // (`SEND_NOW_ROW_LIMIT`) says how many leave now and how many at the scheduled pass; queued, as before.
        delivery === "now" && (result.later ?? 0) > 0
        ? { kind: "success", key: "participantMessageSentNowPart", values: { count: String(result.sentNow ?? 0), later: String(result.later ?? 0) } }
        : delivery === "now"
          ? { kind: "success", key: "participantMessageSentNow", values: { count: String(result.real), test: String(result.test) } }
          : { kind: "success", key: "participantMessageSent", values: { count: String(result.real), test: String(result.test) } },
  );
  revalidatePath(path);
  redirect(`${path}?${query}#admin-alert`);
}

/**
 * The composer's live preview: the words as they stand, rendered as a registrant in `language`
 * would receive them. Nothing is queued. A refusal — no session, a role that may not write, an
 * event that is gone — answers `null`, and the composer says the preview is unavailable.
 */
export async function previewParticipantMessageAction(input: {
  eventId: unknown;
  language: unknown;
  subjectRo: unknown;
  subjectEn: unknown;
  bodyRo: unknown;
  bodyEn: unknown;
}): Promise<ParticipantMessagePreview | null> {
  // From the network: every field is read as a string, whatever was sent.
  const read = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
  try {
    const actor = await requireStaff();
    return await previewParticipantMessage(getDb(), actor, {
      eventId: read(input.eventId, 64),
      locale: localeOf(typeof input.language === "string" ? input.language : null),
      subject: { ro: read(input.subjectRo, 1000), en: read(input.subjectEn, 1000) },
      body: { ro: read(input.bodyRo, 20_000), en: read(input.bodyEn, 20_000) },
    });
  } catch (error) {
    if (isDomainError(error)) return null;
    throw error;
  }
}
