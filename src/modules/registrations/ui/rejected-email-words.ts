import { createTranslator } from "next-intl";
import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { DeskEmailState, RegistrationEmailState } from "../domain/email-state";

type Say = (key: string, values?: Record<string, string | number>) => string;

export type RejectedEmailFacts = DeskEmailState &
  Partial<Pick<RegistrationEmailState, "laterDeliveredAt" | "retriedAt" | "retriedVia">> & {
    /** When the address was confirmed — by the person's click, by staff, or on paper at the desk; null if never. */
    emailConfirmedAt: Date | null;
    /** The provider's own words, for the page's small print alone (`RegistrationEmailStateDetail.detail`). */
    detail?: string | null;
  };

export type RejectedEmailWords = {
  /** «Respins: „Înscriere confirmată (cu QR și număr)”, trimis sâmb., 3 oct. 2026, la 10:00.» */
  which: string;
  /** Why, in plain words — by the state's kind (§NNN): the address refused it, the club's account was refused, the address works again, it was sent again. */
  why: string;
  /** Why a confirmed row can carry the chip: the address was confirmed before (or after) it, or never. */
  context: string;
  /** What staff do: phone; send it again; wait. The address is the person's to change (§645). */
  todo: string;
  /** The provider's own short words, for the page's small print; null on a list, at the desk, or when it gave none. */
  reason: string | null;
};

/**
 * «Email respins», said in full (§663; amending §650, §76, §83) — of the registration's one email state
 * (§NNN): which email did not arrive (its name in the «Emailuri» catalogue; at the same address, a family
 * member's at this event), when (club time, §452's inline form), why — by the state's kind: the address
 * refused it; the club's own Mailgun account was refused when it was to leave; the address works again but
 * this one was not sent again; or it was sent again and no delivery is known —, whether the address had been
 * confirmed before it, and what to do. Staff never change the address (§645, `AGENTS.md` §15.11): only the
 * person can, by registering again.
 *
 * Pure: the staff member's language, the facts the list, the page and the desk already read.
 */
export function rejectedEmailWords(facts: RejectedEmailFacts, locale: string): RejectedEmailWords {
  const lang = locale === "en" ? "en" : "ro";
  const messages = lang === "en" ? en : ro;
  const say = createTranslator({ locale: lang, messages, namespace: "Admin" }) as unknown as Say;
  const instant = (at: Date) => formatDay(at, { locale: lang, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
  const names: Record<string, string> = messages.Admin.emails.types;
  const type = names[facts.messageType] ?? say("registrations.rejected.typeUnknown");
  const confirmed = facts.emailConfirmedAt;
  const context =
    confirmed === null
      ? say("registrations.rejected.neverConfirmed")
      : confirmed.getTime() <= facts.at.getTime()
        ? say("registrations.rejected.confirmedBefore", { date: instant(confirmed) })
        : say("registrations.rejected.confirmedAfter", { date: instant(confirmed) });
  const which = !facts.own
    ? say("registrations.rejected.whichFamily", { type, instant: instant(facts.at) })
    : // Refused at the send, the message never left: «pus în coadă», not «trimis».
      say(facts.sent ? "registrations.rejected.which" : "registrations.rejected.whichQueued", { type, instant: instant(facts.at) });
  const retriedAt = facts.retriedAt ?? null;
  const laterDeliveredAt = facts.laterDeliveredAt ?? null;
  const [why, todo] = (() => {
    switch (facts.kind) {
      case "not-sent":
        return [say("registrations.rejected.why.account"), say("registrations.rejected.todoResend")];
      case "missing":
        return [
          laterDeliveredAt
            ? say("registrations.rejected.why.missing", { date: instant(laterDeliveredAt) })
            : say(`registrations.rejected.why.${facts.status}`),
          say("registrations.rejected.todoResend"),
        ];
      case "retried":
        if (retriedAt && facts.retriedVia === "gmail") {
          return [say("registrations.rejected.why.retriedGmail", { date: instant(retriedAt) }), say("registrations.rejected.todoAsk")];
        }
        return [
          retriedAt ? say("registrations.rejected.why.retried", { date: instant(retriedAt) }) : say(`registrations.rejected.why.${facts.status}`),
          say("registrations.rejected.todoWait"),
        ];
      default:
        return [say(`registrations.rejected.why.${facts.status}`), say("registrations.rejected.todo")];
    }
  })();
  const detail = facts.detail ?? null;
  return {
    which,
    why,
    context,
    todo,
    reason: detail === null ? null : say("registrations.rejected.reason", { reason: detail }),
  };
}

/** The four sentences in reading order, for a line of text or a tooltip; the reason stays apart, in small print. */
export function rejectedEmailSentences(words: RejectedEmailWords): string[] {
  return [words.which, words.why, words.context, words.todo];
}
