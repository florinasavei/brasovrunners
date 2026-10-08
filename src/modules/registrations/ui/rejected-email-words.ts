import { createTranslator } from "next-intl";
import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import type { RejectionCause } from "@/modules/notifications/domain/rejection-cause";
import { callInstead, type DeskEmailState, isDeskQrMessage, needsEmailAction } from "../domain/email-state";

type Say = (key: string, values?: Record<string, string | number>) => string;
type Lang = "ro" | "en";

const langOf = (locale: string): Lang => (locale === "en" ? "en" : "ro");
const catalogueOf = (lang: Lang) => (lang === "en" ? en : ro);

/** One translator per language for the whole process: a list of two hundred rows asks for it once. */
const sayers = new Map<Lang, Say>();
function adminSay(lang: Lang): Say {
  let say = sayers.get(lang);
  if (!say) {
    say = createTranslator({ locale: lang, messages: catalogueOf(lang), namespace: "Admin" }) as unknown as Say;
    sayers.set(lang, say);
  }
  return say;
}

const NBSP = " ";

/**
 * A line of parts joined by « · », each part unbreakable (§NNN): at 360 pixels the line wraps between two
 * parts, never inside one — «Căsuța e plină» never leaves «plină» alone on the next line.
 */
export function unbreakableLine(text: string): string {
  return text
    .split(" · ")
    .map((part) => part.replace(/ /g, NBSP))
    .join(" · ");
}

/**
 * The short date of a card (§452's short style, no year, no hour; §366's phone width): «sâmb., 3 oct.» /
 * «Sat, 3 Oct», in club time — the refusals a registration shows are of an event that has not ended, so
 * the year is the reader's own.
 */
export function shortDay(at: Date, locale: string): string {
  return formatDay(at, { locale: langOf(locale), timeZone: CLUB_TIME_ZONE, style: "short", year: false, position: "inline" });
}

/**
 * An email's short name, in the words the participant reads (`Admin.emails.typesShort`, §NNN): «Confirmarea
 * cu QR», «Numărul de concurs». A type with no short name keeps its long one (`Admin.emails.types`), and a
 * type the catalogue does not know reads «un email al clubului».
 */
export function shortEmailName(messageType: string, locale: string): string {
  const messages = catalogueOf(langOf(locale));
  const short: Record<string, string> = messages.Admin.emails.typesShort;
  const long: Record<string, string> = messages.Admin.emails.types;
  return short[messageType] ?? long[messageType] ?? messages.Admin.registrations.rejected.typeUnknown;
}

/** The cause in at most four words (§NNN): «Adresa nu există», «Căsuța e plină», «Mailgun nu mai trimite». */
export function causeLabel(cause: RejectionCause, locale: string): string {
  return adminSay(langOf(locale))(`registrations.rejected.label.${cause}`);
}

/**
 * Why, in plain words, for one refusal (§NNN): the receiving server's reason by its cause when the message
 * left; when it never left, the club's account (`account`), the provider refusing the address at the send,
 * or the provider refusing it otherwise. A complaint always left.
 */
export function causeWhy(cause: RejectionCause, left: boolean, locale: string): string {
  const say = adminSay(langOf(locale));
  if (!left) {
    if (cause === "account") return say("registrations.rejected.why.account");
    return say(cause === "no-such-address" ? "registrations.rejected.why.BOUNCEDQueued" : "registrations.rejected.why.queuedOther");
  }
  // The account's refusal never left; a row that claims both reads as the plain refusal it would be.
  return say(`registrations.rejected.why.cause.${cause === "account" ? "other" : cause}`);
}

export type RejectedEmailFacts = DeskEmailState & {
  /** When the address was confirmed — by the person's click, by staff, or on paper at the desk; null if never. */
  emailConfirmedAt: Date | null;
  /**
   * The person's own click on a link (`participants.email_verified_at`): an address that answered a click
   * before its refusal «no longer exists» (§NNN) — the person may have closed the mailbox. Absent at the desk.
   */
  emailVerifiedAt?: Date | null;
  /**
   * This registration is confirmed (§NNN): its place stays whatever the email, the words say so first, and
   * they never suggest a new registration — on a full race a new one goes to the waiting list.
   */
  confirmed?: boolean;
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
   * that never left, «refuzat la trimitere» at the refused attempt's instant (`rejected_at`), and «pus în
   * coadă» at the queueing's when the refusal's own instant was never stored (§NNN); a family member's,
   * «Respins la aceeași adresă, …» only when it left. The long name: the registration page's story.
   */
  which: string;
  /** Why, in plain words — by the cause for an address that refuses mail, by the state's kind otherwise (§NNN). */
  why: string;
  /** Why a confirmed row can carry it: the address was confirmed before (or after) it, or never. */
  context: string;
  /**
   * What to do, by who reads it (§NNN): on a confirmed registration first that the place stays; then what
   * the cause asks — phone, let the person make room, wait and send again, lift Mailgun's suppression only
   * when the person confirms the address, never lift an unsubscription unasked — and the press that clears
   * it by its button's name for the Administrator, «Roagă un administrator să…» for the Organizer; the desk
   * what to say to the person in front of it, never to phone.
   */
  todo: string;
  /** The provider's own short words, for the page's small print; null on a list, at the desk, or when it gave none. */
  reason: string | null;
  /** The cause in at most four words: the card's label. */
  label: string;
  /** The email's short name. */
  short: string;
  /**
   * The one line under the name (§NNN), each part unbreakable: «Adresa nu există · Confirmarea cu QR ·
   * sâmb., 3 oct.» (red); «Confirmarea cu QR lipsește · adresa merge acum» or «Nu a plecat · … · …»
   * (amber); «Retrimis sâmb., 3 oct. · așteptăm livrarea» (quiet — the list draws nothing for it).
   */
  line: string;
  tone: "error" | "warning" | "info";
  /**
   * The desk's one chip (§NNN, §67): only while somebody must act and the refused email is the QR
   * confirmation — «Fără QR pe email — caută după nume», and what to tell the person. Null for every
   * other email, every other reader, and a state that waits.
   */
  desk: { label: string; hint: string } | null;
};

/** The causes whose to-do ends with the press that clears it: the address may take the email now. */
const SEND_AGAIN_AFTER: ReadonlySet<RejectionCause> = new Set(["mailbox-full", "blocked", "gave-up", "refused", "other", "suppressed", "account"]);

/** The to-do sentence for an address that refuses the club's mail, by cause, before the press (§NNN). */
function causeTodoKey(cause: RejectionCause, confirmed: boolean): string {
  switch (cause) {
    case "no-such-address":
      // Never «a new registration» on a confirmed one (§NNN): on a full race it goes to the waiting list.
      return confirmed ? "todoKept" : "todo";
    case "mailbox-full":
      return "todoCause.mailbox-full";
    case "suppressed":
      return "todoCause.suppressed";
    case "unsubscribed":
      return "todoCause.unsubscribed";
    case "complained":
      return "todoCause.complained";
    case "complaint-suppressed":
      return "todoCause.complaint-suppressed";
    default:
      return "todoCause.retryLater";
  }
}

/** What the desk tells the person in front of it about an address that refuses the club's mail (§NNN). */
function deskTellKey(cause: RejectionCause, confirmed: boolean): string {
  switch (cause) {
    case "no-such-address":
      return confirmed ? "todoTellKept" : "todoTellUnreachable";
    case "mailbox-full":
      return "todoTellCause.mailbox-full";
    case "suppressed":
      return "todoTellCause.suppressed";
    case "unsubscribed":
      return "todoTellCause.unsubscribed";
    case "complained":
    case "complaint-suppressed":
      return "todoTellCause.complained";
    default:
      return "todoTellCause.blocked";
  }
}

/**
 * «Email respins», said in full (§663; amending §650, §76, §83) — of the registration's one email state
 * (the data decision, §NNN), by its cause and for who reads it (§NNN): which email did not arrive (its
 * name in the «Emailuri» catalogue, short on a card), when (club time, §452), why in plain words, whether
 * the address had been confirmed before it, and what to do. Staff never change the address (§645,
 * `AGENTS.md` §15.11): only the person can, by registering again — said only while the registration is
 * not confirmed.
 *
 * Pure: the staff member's language, who reads it, the facts the list, the page and the desk already read.
 * One rule for who does what, by the reader:
 *
 * - **«Send it again»** is the Administrator's verb (`AGENTS.md` §15.11, §289): the Administrator is told
 *   the press by its button's name; the Organizer and the desk are told «Roagă un administrator să…».
 * - **A phone call** — for an address that does not exist, and for the event's notices, which no press
 *   sends again (`callInstead`) — is not a resend: §289 restricts resends, not calls. The Administrator
 *   and the Organizer are told «Sună persoana: …».
 * - **The desk** can phone nobody (§67: no address, no phone there) but has the person in front of it on
 *   race day: it is told what to say to them — «Spune-i persoanei: …».
 *
 * The sentences never contradict each other: one that never left — the club's account refused it
 * (`not-sent`, whatever `sent` says), or the provider refused it at the send — is «refuzat la trimitere»
 * (or «pus în coadă» when only the queueing's instant is known) and «Nu a plecat», never «trimis» or
 * «Respins la aceeași adresă»; a complaint arrived, so it left. A table test reads every combination.
 */
export function rejectedEmailWords(facts: RejectedEmailFacts, locale: string, reader: RejectedEmailReader): RejectedEmailWords {
  const lang = langOf(locale);
  const messages = catalogueOf(lang);
  const say = adminSay(lang);
  const rejected = (key: string, values?: Record<string, string | number>) => say(`registrations.rejected.${key}`, values);
  const instant = (at: Date) => formatDay(at, { locale: lang, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" });
  const names: Record<string, string> = messages.Admin.emails.types;
  const type = names[facts.messageType] ?? rejected("typeUnknown");
  const short = shortEmailName(facts.messageType, lang);
  const confirmedAt = facts.emailConfirmedAt;
  const context =
    confirmedAt === null
      ? rejected("neverConfirmed")
      : confirmedAt.getTime() <= facts.at.getTime()
        ? rejected("confirmedBefore", { date: instant(confirmedAt) })
        : rejected("confirmedAfter", { date: instant(confirmedAt) });
  // Whether it left: never when the club's account refused it (its own sentence says so), always for a
  // complaint (it arrived) — so «trimis» and «Nu a plecat» are never said of one email.
  const left = facts.kind !== "not-sent" && (facts.sent || facts.status === "COMPLAINED");
  // Refused at the send, the message never left: «refuzat la trimitere» at the refusal's own instant, or «pus
  // în coadă» at the queueing's when a refusal written before `rejected_at` existed has only that (§NNN).
  const timed = facts.atKnown !== false;
  const whichKey = facts.own
    ? left
      ? "which"
      : timed
        ? "whichQueued"
        : "whichUntimed"
    : left
      ? "whichFamily"
      : timed
        ? "whichFamilyQueued"
        : "whichFamilyUntimed";
  const which = rejected(whichKey, { type, instant: instant(facts.at) });
  // «Adresa nu mai există» (§NNN): the address answered the person's own click before it was refused.
  const verifiedAt = facts.emailVerifiedAt ?? null;
  const noLonger = facts.kind === "unreachable" && left && facts.cause === "no-such-address" && verifiedAt !== null && verifiedAt.getTime() <= facts.at.getTime();
  const label = noLonger ? rejected("label.noLonger") : causeLabel(facts.cause, lang);
  const day = shortDay(facts.at, lang);
  const confirmed = facts.confirmed === true;
  const needsAction = needsEmailAction(facts);

  const call = callInstead(facts.messageType);
  // The press that clears it, on the registration it was for: the Administrator is told it, everybody else asks for it.
  const pressOf = (press: NonNullable<DeskEmailState["press"]>) =>
    rejected(reader === "administrator" ? `todoPress.${press}` : `todoAskAdmin.${press}`);
  const family = (text: string) => (facts.own ? text : rejected("todoFamily", { todo: text }));
  // On a confirmed registration the place stays (§NNN): the Administrator and the Organizer read that first.
  const lead = confirmed && needsAction && reader !== "desk" ? rejected("placeKept") : null;

  let why: string;
  let todo: string;
  let line: string;
  let tone: RejectedEmailWords["tone"];
  switch (facts.kind) {
    case "not-sent":
    case "missing": {
      why =
        facts.kind === "not-sent"
          ? rejected("why.account")
          : facts.laterDeliveredAt
            ? rejected("why.missing", { date: instant(facts.laterDeliveredAt) })
            : rejected("why.missingUndated");
      // «Detalii actualizate» and the cancellation have no press: the person is phoned (at the desk: told).
      const act = call
        ? rejected(reader === "desk" ? `todoTell.${call}` : `todoCall.${call}`)
        : family(pressOf(facts.press ?? "resend"));
      // The club's account, not the address (1–2 October): said before the press, to whoever may phone about it.
      const account = facts.kind === "not-sent" && call === null && reader !== "desk" ? rejected("todoCause.account") : null;
      todo = [lead, account, act].filter(Boolean).join(" ");
      line =
        facts.kind === "not-sent"
          ? unbreakableLine([causeLabel("account", lang), short, day].join(" · "))
          : unbreakableLine(rejected("line.missing", { short }));
      tone = "warning";
      break;
    }
    case "retried": {
      const retriedAt = facts.retriedAt ?? null;
      const gmail = facts.retriedVia === "gmail";
      why = gmail
        ? retriedAt
          ? rejected("why.retriedGmail", { date: instant(retriedAt) })
          : rejected("why.retriedGmailUndated")
        : retriedAt
          ? rejected("why.retried", { date: instant(retriedAt) })
          : rejected("why.retriedUndated");
      todo = rejected(gmail ? "todoAsk" : "todoWait");
      line = unbreakableLine(rejected(gmail ? "line.retriedGmail" : "line.retried", { date: shortDay(retriedAt ?? facts.at, lang) }));
      tone = "info";
      break;
    }
    default: {
      why = noLonger && verifiedAt ? rejected("why.noLonger", { date: shortDay(verifiedAt, lang) }) : causeWhy(facts.cause, left, lang);
      if (reader === "desk") {
        todo = rejected(deskTellKey(facts.cause, confirmed));
      } else {
        // Then what the cause asks; then, where the address may take it now, the press that clears it.
        const then = SEND_AGAIN_AFTER.has(facts.cause) && call === null && facts.press !== null ? family(pressOf(facts.press)) : null;
        todo = [lead, rejected(causeTodoKey(facts.cause, confirmed)), then].filter(Boolean).join(" ");
      }
      line = unbreakableLine([label, short, day].join(" · "));
      tone = "error";
    }
  }
  const detail = facts.detail ?? null;
  const desk =
    reader === "desk" && needsAction && isDeskQrMessage(facts.messageType)
      ? { label: rejected("desk.label"), hint: `${rejected("desk.hint")} ${todo}` }
      : null;
  return {
    which,
    why,
    context,
    todo,
    reason: detail === null ? null : rejected("reason", { reason: detail }),
    label,
    short,
    line,
    tone,
    desk,
  };
}

/** The story in reading order, for the registration page's «Emailuri»; the reason stays apart, in small print. */
export function rejectedEmailSentences(words: RejectedEmailWords): string[] {
  return [words.which, words.why, words.context, words.todo];
}

/**
 * The first sentence of a resend's question (§NNN), while the registration's state asks somebody to act:
 * what the last refusal says of this press — Mailgun will not send at all (a suppression, an
 * unsubscription, a complaint's suppression); the address does not exist; the mailbox was full on that
 * day; the receiving server refused it for its own reason. Nothing for an email the club's account could
 * not send or one owed to an address that works again: there, sending it again is the right press. It never
 * blocks the press, and the server decides who may press it.
 */
export function resendWarning(state: Pick<DeskEmailState, "kind" | "cause" | "at"> | null | undefined, locale: string): string | null {
  if (!state || !needsEmailAction(state) || state.kind !== "unreachable") return null;
  const lang = langOf(locale);
  const say = adminSay(lang);
  switch (state.cause) {
    case "suppressed":
    case "unsubscribed":
    case "complaint-suppressed":
      return say("registrations.rejected.warn.suppressed");
    case "no-such-address":
      return say("registrations.rejected.warn.noSuchAddress");
    case "mailbox-full":
      return say("registrations.rejected.warn.mailboxFull", { date: shortDay(state.at, lang) });
    case "complained":
      return say("registrations.rejected.warn.complained");
    case "account":
      return null;
    default:
      return say("registrations.rejected.warn.refused", { label: causeLabel(state.cause, lang) });
  }
}

/** A question's body with the warning as its first sentence, when there is one. */
export function withResendWarning(body: string, warning: string | null): string {
  return warning ? `${warning} ${body}` : body;
}
