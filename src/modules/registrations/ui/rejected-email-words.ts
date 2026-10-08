import { createTranslator } from "next-intl";
import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { callInstead, type DeskEmailState } from "../domain/email-state";

type Say = (key: string, values?: Record<string, string | number>) => string;

export type RejectedEmailFacts = DeskEmailState & {
    /** When the address was confirmed — by the person's click, by staff, or on paper at the desk; null if never. */
    emailConfirmedAt: Date | null;
    /** The provider's own words, for the page's small print alone (`RegistrationEmailStateDetail.detail`). */
    detail?: string | null;
  };

/**
 * Who reads the words (§NNN): an Administrator (the list, the page — may press every resend), an
 * Organizer (the list, the page — reads, presses nothing, §289), or whoever works the desk on race day
 * (every staff role; no address and no phone there, §67 — but the person in front of them).
 */
export type RejectedEmailReader = "administrator" | "organizer" | "desk";

export type RejectedEmailWords = {
  /**
   * «Respins: „Înscriere confirmată (cu QR și număr)”, trimis sâmb., 3 oct. 2026, la 10:00.» — or, for one
   * that never left, «refuzat la trimitere» (the instant is the refused attempt's, `rejected_at`, not the
   * queueing's); a family member's, «Respins la aceeași adresă, …» only when it left.
   */
  which: string;
  /** Why, in plain words — by the state's kind (§NNN): the address refused it, the club's account was refused, the address works again, it was sent again. */
  why: string;
  /** Why a confirmed row can carry the chip: the address was confirmed before (or after) it, or never. */
  context: string;
  /**
   * What staff do, by who reads it (`RejectedEmailReader`): phone, or at the desk tell the person in front
   * of them; send it again, by the press that clears it, or ask an Administrator to; for the event's
   * notices, which no press sends again, phone the person (at the desk: tell them) that what changed is on
   * the event's page, or that it was cancelled; wait. The address is the person's to change (§645).
   */
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
 * Pure: the staff member's language, who reads it, the facts the list, the page and the desk already read.
 * One rule for who does what (§NNN), by the reader:
 *
 * - **«Send it again»** is the Administrator's verb (`AGENTS.md` §15.11, §289): the Administrator is told
 *   the press; the Organizer and the desk are told «Roagă un administrator să…».
 * - **A phone call** — for an address that refuses the club's mail, and for the event's notices, which no
 *   press sends again (`callInstead`) — is not a resend: §289 restricts resends, not calls. The
 *   Administrator and the Organizer are told «Sună persoana: …»; the phone sits behind the audited
 *   «Urgențe și sănătate» reveal on the registration's page.
 * - **The desk** can phone nobody (§67: no address, no phone there) but has the person in front of it on
 *   race day: it is told what to say to them — «Spune-i persoanei: …» what changed is on the event's
 *   page, or that the event was cancelled; for an address that refuses the club's mail, that the club's
 *   emails do not reach them and an Administrator phones them.
 *
 * The sentences never contradict each other (§NNN): one that never left — the club's account refused it
 * (`not-sent`, whatever `sent` says), or the provider refused it at the send — is «refuzat la trimitere»
 * and «Nu a plecat», never «trimis» or «Respins la aceeași adresă», and its address's refusal is the
 * provider's, never the recipient's server's; a complaint arrived, so it left. A table test reads every
 * combination, every reader.
 */
export function rejectedEmailWords(facts: RejectedEmailFacts, locale: string, reader: RejectedEmailReader): RejectedEmailWords {
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
  // Whether it left: never when the club's account refused it (its own sentence says so), always for a
  // complaint (it arrived) — so «trimis» and «Nu a plecat» are never said of one email.
  const left = facts.kind !== "not-sent" && (facts.sent || facts.status === "COMPLAINED");
  // Refused at the send, the message never left: «refuzat la trimitere», not «trimis»; and a family member's that
  // never left was not refused at the address — «Nu a plecat», not «Respins la aceeași adresă».
  const whichKey = facts.own ? (left ? "which" : "whichQueued") : left ? "whichFamily" : "whichFamilyQueued";
  const which = say(`registrations.rejected.${whichKey}`, { type, instant: instant(facts.at) });
  const retriedAt = facts.retriedAt ?? null;
  const laterDeliveredAt = facts.laterDeliveredAt ?? null;
  // Each kind has its own sentence, with its date when the reader has it and without it otherwise —
  // never the address's refusal for an email that is merely owed or waiting.
  // The press named is the one that clears it (§NNN, `pressThatClears`): «Retrimite QR» for anything the
  // confirmation carries, «Trimite reminderul» for the reminder — on the family member's registration when
  // the refusal is theirs, never a press on this one that cannot clear it.
  // «Detalii actualizate» and the cancellation have no press (§NNN): the person is phoned (at the desk: told)
  // — the same words whichever registration at the address shows it, and never what changed, which the
  // notice may not name (a programme, a reinstatement, a note alone): that is on the event's page.
  const call = callInstead(facts.messageType);
  const press = facts.press ?? "resend";
  const pressed = call
    ? say(reader === "desk" ? `registrations.rejected.todoTell.${call}` : `registrations.rejected.todoCall.${call}`)
    : say(reader === "administrator" ? `registrations.rejected.todoPress.${press}` : `registrations.rejected.todoAskAdmin.${press}`);
  const resend = facts.own || call ? pressed : say("registrations.rejected.todoFamily", { todo: pressed });
  const [why, todo] = (() => {
    switch (facts.kind) {
      case "not-sent":
        return [say("registrations.rejected.why.account"), resend];
      case "missing":
        return [
          laterDeliveredAt
            ? say("registrations.rejected.why.missing", { date: instant(laterDeliveredAt) })
            : say("registrations.rejected.why.missingUndated"),
          resend,
        ];
      case "retried":
        if (facts.retriedVia === "gmail") {
          return [
            retriedAt ? say("registrations.rejected.why.retriedGmail", { date: instant(retriedAt) }) : say("registrations.rejected.why.retriedGmailUndated"),
            say("registrations.rejected.todoAsk"),
          ];
        }
        return [
          retriedAt ? say("registrations.rejected.why.retried", { date: instant(retriedAt) }) : say("registrations.rejected.why.retriedUndated"),
          say("registrations.rejected.todoWait"),
        ];
      default:
        // Refused at the send, the address's refusal is the provider's: the recipient's server never saw it.
        return [
          say(left ? `registrations.rejected.why.${facts.status}` : "registrations.rejected.why.BOUNCEDQueued"),
          say(reader === "desk" ? "registrations.rejected.todoTellUnreachable" : "registrations.rejected.todo"),
        ];
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
