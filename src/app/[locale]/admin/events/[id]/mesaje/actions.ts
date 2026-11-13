"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { checkOrganizerMessage, CHOSEN_AUDIENCE, CHOSEN_FIELD, CONFIRM_COUNT_FIELD } from "@/modules/notifications/domain/organizer-message";
import { DELIVERY_CHOICE_FIELD, deliveryChoiceOf } from "@/modules/notifications/domain/send-at-once";
import { SendNowRefused, sendNowRefusalCode } from "@/modules/notifications/send-at-once";
import {
  type ParticipantMessagePreview,
  previewParticipantMessage,
  sendParticipantMessage,
} from "@/modules/notifications/participant-messages";
import { requireStaff } from "@/modules/staff-identity/session";
import { inEmailPress } from "@/modules/notifications/press";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
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
 * empty group named on its radio buttons, nobody ticked named on the list, a number typed at «Scrie la
 * câți trimiți» that is not the number of recipients named on its box with the number now (§945) — and
 * a send redirects to the page with what it queued. A second press of the same form lands on the page
 * saying so, with nothing queued again.
 *
 * A send to the people ticked (§945) lands with its own id as `kept`: the page reads that send's words
 * back into the boxes (`readKeptMessage`), so a trial is followed by the same message to everybody.
 */
export async function sendParticipantMessageAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  // An email press (`notifications/press.ts`): every row it queues carries this cause, its id and who pressed.
  return inEmailPress("events.participantMessage", async (press) => {
    const locale = localeOf(form.get("uiLocale"));
    const eventId = posted(form, "eventId");
    const sendId = posted(form, "sendId");
    // «Doar anumiți participanți» (§945): the fifth choice of «Cui îi trimiți» — the people ticked, not a group.
    const chosen = posted(form, "audience") === CHOSEN_AUDIENCE;
    const words = {
      subject: { ro: posted(form, "subjectRo"), en: posted(form, "subjectEn") },
      body: { ro: posted(form, "bodyRo"), en: posted(form, "bodyEn") },
    };

    // The dialog's answer (§540): «now» past the scheduled pass, anything else the queue, as before.
    const delivery = deliveryChoiceOf(form.get(DELIVERY_CHOICE_FIELD));

    let result;
    try {
      const actor = await requireStaff();
      press.by(actor.id);
      result = await sendParticipantMessage(
        getDb(),
        actor,
        {
          eventId,
          audience: posted(form, "audience"),
          // The ticks; which of them are written to is the service's — only for that choice, only this event's active ones.
          registrationIds: form.getAll(CHOSEN_FIELD),
          // «Scrie la câți trimiți» (§945): the number as typed; the service holds it to the rows it is about to write.
          confirmCount: posted(form, CONFIRM_COUNT_FIELD),
          sendId,
          delivery,
          // «Cere reconfirmarea» (the decision «Cere reconfirmarea»): the tick posts `1`; anything else is no.
          askReconfirm: posted(form, "askReconfirm") === "1",
          // «Trimite și numărul de concurs și codul QR» (§943): the same; which registrations get them is the service's.
          sendQr: posted(form, "sendQr") === "1",
          ...words,
        },
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
      // Nobody ticked, or nobody ticked still registered: its own sentence, on the list (§945); an empty group, on the radios.
      return chosen
        ? { error: "NO_CHOSEN_RECIPIENTS", fields: [CHOSEN_FIELD], values: keptValuesOf(form) }
        : { error: "NO_RECIPIENTS", fields: ["audience"], values: keptValuesOf(form) };
    }

    if (result.kind === "miscounted") {
      // Nothing was queued (§945): the sentence says how many there are now, and the box comes back empty (`NEVER_KEPT`).
      return { error: "MESSAGE_COUNT_MISMATCH", errorValues: { actual: String(result.real) }, fields: [CONFIRM_COUNT_FIELD], values: keptValuesOf(form) };
    }

    const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/mesaje", params: { id: eventId } } });
    // `kept` (§945): the send's own id — a uuid the service held it to, naming a send and nobody — for the words to stay in the boxes.
    const query = result.kind === "duplicate" ? "duplicate=1" : `sent=${result.real}&test=${result.test}${chosen ? `&kept=${sendId}` : ""}`;
    // The toast (§384): the send, and what the press queued — how many, and when each part leaves, a press's «now»
    // past the scheduled pass (§540) and the rest of a list longer than one press sends (`SEND_NOW_ROW_LIMIT`)
    // included — is the mail line's (`withPressMail`), read from the rows themselves. A second press queues nothing.
    await flashOutcome(result.kind === "duplicate" ? { saved: "participantMessageDuplicate" } : { saved: "participantMessageSent" });
    revalidatePath(path);
    redirect(`${path}?${query}#admin-alert`);
  });
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
  /** «Cere reconfirmarea» as the box stands: only `true` draws «Vin» in the preview. */
  askReconfirm?: unknown;
  /** «Trimite și numărul de concurs și codul QR» as the box stands (§943): only `true` draws the example runner's block. */
  sendQr?: unknown;
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
      askReconfirm: input.askReconfirm === true,
      sendQr: input.sendQr === true,
    });
  } catch (error) {
    if (isDomainError(error)) return null;
    throw error;
  }
}
