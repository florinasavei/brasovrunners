import { createTranslator } from "next-intl";
import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { RejectedEmail } from "../domain/rejected-email";

type Say = (key: string, values?: Record<string, string | number>) => string;

export type RejectedEmailFacts = RejectedEmail & {
  /** When the address was confirmed — by the person's click, by staff, or on paper at the desk; null if never. */
  emailConfirmedAt: Date | null;
};

export type RejectedEmailWords = {
  /** «Respins: „Înscriere confirmată (cu QR și număr)”, trimis sâmb., 3 oct. 2026, la 10:00.» */
  which: string;
  /** Why, in plain words: a bounce or a complaint. */
  why: string;
  /** Why a confirmed row can carry the chip: the address was confirmed before (or after) it, or never. */
  context: string;
  /** What staff do: phone; the address is the person's to change (§645). */
  todo: string;
  /** The provider's own short reason, for the small print; null when it gave none. */
  reason: string | null;
};

/**
 * «Email respins», said in full (§663; amending §650, §76, §83). The chip means the NEWEST email sent to
 * this registration was rejected — any of the message types, and often long after the address was
 * confirmed: a confirmed participant whose race-number email bounced is exactly whom the club must
 * phone. So the words say which email (its name in the «Emailuri» catalogue), when (club time, §452's
 * inline form), why, whether the address had been confirmed before it, and what to do. Staff never
 * change the address (§645, `AGENTS.md` §15.11): only the person can, by registering again.
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
  return {
    // Refused at the send, the message never left: «pus în coadă», not «trimis».
    which: say(facts.sent ? "registrations.rejected.which" : "registrations.rejected.whichQueued", { type, instant: instant(facts.at) }),
    why: say(`registrations.rejected.why.${facts.status}`),
    context,
    todo: say("registrations.rejected.todo"),
    reason: facts.reason === null ? null : say("registrations.rejected.reason", { reason: facts.reason }),
  };
}

/** The four sentences in reading order, for a line of text or a tooltip; the reason stays apart, in small print. */
export function rejectedEmailSentences(words: RejectedEmailWords): string[] {
  return [words.which, words.why, words.context, words.todo];
}
