import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { formatDay } from "@/i18n/dates";
import { emailMessageType } from "@/db/schema/email-outbox";
import { registrationStatus } from "@/db/schema/registrations";
import { COVER_PAIRS, typesCoveredBy, typesCovering } from "@/modules/notifications/domain/content-cover";
import { REJECTION_CAUSES, type RejectionCause } from "@/modules/notifications/domain/rejection-cause";
import { EVENT_NOTICE_STATUSES } from "@/modules/notifications/event-notices";
import { deriveAllowedResendMessageType } from "@/modules/registrations/domain/resend";
import {
  callInstead,
  deskEmailStateOf,
  EMAIL_STATE_KINDS,
  emailStateDetailOf,
  emailStateOf,
  EVENT_MOMENTS,
  pressThatClears,
  STILL_NEEDED_KEYS,
  stillNeededMessageTypes,
} from "@/modules/registrations/domain/email-state";
import { rejectedEmailWords, type RejectedEmailFacts, type RejectedEmailReader, type RejectedEmailWords } from "@/modules/registrations/ui/rejected-email-words";
import { whatToTell, type TellFacts } from "@/modules/registrations/ui/tell-words";

/**
 * BR-REQ-037-03, BR-REQ-038-01 criterion 8 (§663; amending §650, §76, §83; the data decision „The runners' own emails tell the truth”; §671) —
 * «Email respins» says which email did not arrive, when, why — by the registration's one email state and,
 * for an address that refuses the club's mail, by its cause — whether the address had been confirmed before
 * it, and what to do, by who reads it.
 */
const catalogues = { ro, en } as const;
const READERS: readonly RejectedEmailReader[] = ["administrator", "organizer", "desk"];
const CONFIRMED_AT = new Date("2026-10-01T07:30:00.000Z");
const REJECTED_AT = new Date("2026-10-03T09:15:00.000Z");
const LATER = new Date("2026-10-05T10:00:00.000Z");
const inline = (locale: "ro" | "en", at: Date) => formatDay(at, { locale, timeZone: "Europe/Bucharest", style: "short", withTime: true, position: "inline" });
/** The story in reading order, as the registration's «Emailuri» tells it; the reason stays apart, in small print. */
const rejectedEmailSentences = (words: RejectedEmailWords): string[] => [words.which, words.why, words.context, words.todo];
const fill = (text: string, values: Record<string, string>) => Object.entries(values).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), text);

function facts(overrides: Partial<RejectedEmailFacts> = {}): RejectedEmailFacts {
  return {
    kind: "unreachable",
    messageType: "BIB_ASSIGNED",
    at: REJECTED_AT,
    atKnown: true,
    sent: true,
    status: "BOUNCED",
    cause: "no-such-address",
    own: true,
    press: "confirmation",
    laterDeliveredAt: null,
    retriedAt: null,
    retriedVia: null,
    detail: "550 5.1.1 mailbox unavailable",
    emailConfirmedAt: CONFIRMED_AT,
    ...overrides,
  };
}

describe("rejectedEmailWords", () => {
  for (const locale of ["ro", "en"] as const) {
    const words = catalogues[locale].Admin.registrations.rejected;
    const type = catalogues[locale].Admin.emails.types.BIB_ASSIGNED;

    it(`names the email by its «Emailuri» name and says when, in club time (${locale})`, () => {
      const said = rejectedEmailWords(facts(), locale, "organizer");
      expect(said.which).toBe(fill(words.which, { type, instant: inline(locale, REJECTED_AT) }));
      // §452: the hour inside a sentence takes «la» / «at»; no «pe» before the weekday.
      expect(said.which).toContain(locale === "ro" ? ", la 12:15" : ", at 12:15");
      expect(said.which).not.toMatch(/ pe /);
    });

    it(`says «refuzat la trimitere», not «trimis», for a message the provider refused at the send — the instant it has (${locale})`, () => {
      const said = rejectedEmailWords(facts({ sent: false }), locale, "organizer");
      expect(said.which).toBe(fill(words.whichQueued, { type, instant: inline(locale, REJECTED_AT) }));
      expect(said.which).not.toBe(rejectedEmailWords(facts(), locale, "organizer").which);
    });

    it(`says «pus în coadă», never «refuzat la trimitere», when only the queueing's instant is known — a refusal from before 0131 (${locale})`, () => {
      // Migration 0131 does not backfill `rejected_at`: the instant is then `created_at`, the queueing's.
      const untimed = rejectedEmailWords(facts({ sent: false, atKnown: false }), locale, "organizer");
      expect(untimed.which).toBe(fill(words.whichUntimed, { type, instant: inline(locale, REJECTED_AT) }));
      expect(untimed.which).not.toBe(fill(words.whichQueued, { type, instant: inline(locale, REJECTED_AT) }));
      const family = rejectedEmailWords(facts({ sent: false, atKnown: false, own: false, kind: "not-sent", cause: "account" }), locale, "organizer");
      expect(family.which).toBe(fill(words.whichFamilyUntimed, { type, instant: inline(locale, REJECTED_AT) }));
      // A refusal's own instant keeps «refuzat la trimitere», own or a family member's.
      expect(rejectedEmailWords(facts({ sent: false, atKnown: true, own: false, kind: "not-sent", cause: "account" }), locale, "organizer").which).toBe(
        fill(words.whichFamilyQueued, { type, instant: inline(locale, REJECTED_AT) }),
      );
      // One that left says «trimis» either way.
      expect(rejectedEmailWords(facts({ atKnown: false }), locale, "organizer").which).toBe(fill(words.which, { type, instant: inline(locale, REJECTED_AT) }));
    });

    it(`says a family member's refusal at the same address as such (${locale})`, () => {
      expect(rejectedEmailWords(facts({ own: false }), locale, "organizer").which).toBe(fill(words.whichFamily, { type, instant: inline(locale, REJECTED_AT) }));
    });

    it(`says a family member's email that never left as never left — never as refused at the address (${locale})`, () => {
      // A §543 family, and the club's account refused the sibling's race number on 1–2 October.
      const atTheAddress = fill(words.whichFamily, { type, instant: inline(locale, REJECTED_AT) });
      for (const reader of READERS) {
        const said = rejectedEmailWords(facts({ own: false, sent: false, kind: "not-sent", cause: "account" }), locale, reader);
        expect(said.which).toBe(fill(words.whichFamilyQueued, { type, instant: inline(locale, REJECTED_AT) }));
        expect(said.which).not.toBe(atTheAddress);
        expect(said.why).toBe(words.why.account);
        // «Respins la aceeași adresă» is said nowhere: the account was refused, not the address.
        const refusedAtTheAddress = words.whichFamily.split(",")[0];
        for (const sentence of rejectedEmailSentences(said)) expect(sentence).not.toContain(refusedAtTheAddress);
        // The address's own refusal at the send, by the provider: never left either, never the recipient's server.
        const invalid = rejectedEmailWords(facts({ own: false, sent: false, kind: "unreachable", cause: "no-such-address" }), locale, reader);
        expect(invalid.which).toBe(fill(words.whichFamilyQueued, { type, instant: inline(locale, REJECTED_AT) }));
        expect(invalid.why).toBe(words.why.BOUNCEDQueued);
        // Any other refusal at the send is the provider's, not the address's.
        expect(rejectedEmailWords(facts({ sent: false, cause: "other" }), locale, reader).why).toBe(words.why.queuedOther);
      }
    });

    it(`says why by the cause, in plain words, the provider's words apart (${locale})`, () => {
      const bounce = rejectedEmailWords(facts(), locale, "organizer");
      expect(bounce.why).toBe(words.why.cause["no-such-address"]);
      expect(bounce.reason).toBe(fill(words.reason, { reason: "550 5.1.1 mailbox unavailable" }));
      expect(rejectedEmailSentences(bounce)).not.toContain(bounce.reason);
      for (const cause of REJECTION_CAUSES.filter((each) => each !== "account")) {
        expect(rejectedEmailWords(facts({ cause, status: cause === "complained" ? "COMPLAINED" : "BOUNCED" }), locale, "organizer").why, cause).toBe(words.why.cause[cause]);
      }
      const complaint = rejectedEmailWords(facts({ status: "COMPLAINED", cause: "complained", detail: null }), locale, "organizer");
      expect(complaint.reason).toBeNull();
      // No list and no desk carries the provider's words: without them there is no small print.
      expect(rejectedEmailWords(facts({ detail: undefined }), locale, "organizer").reason).toBeNull();
      // The provider's code, once: before words that do not start with it, alone when there are no words.
      expect(rejectedEmailWords(facts({ code: "550", detail: "550 5.1.1 mailbox unavailable" }), locale, "organizer").reason).toBe(fill(words.reason, { reason: "550 5.1.1 mailbox unavailable" }));
      expect(rejectedEmailWords(facts({ code: "552", detail: "mailbox full" }), locale, "organizer").reason).toBe(fill(words.reason, { reason: "552 mailbox full" }));
      expect(rejectedEmailWords(facts({ code: "605", detail: null }), locale, "organizer").reason).toBe(fill(words.reason, { reason: "605" }));
    });

    it(`says the club's account was refused, never the address, for a message that never left (${locale})`, () => {
      const said = rejectedEmailWords(facts({ kind: "not-sent", sent: false, cause: "account" }), locale, "administrator");
      expect(said.why).toBe(words.why.account);
      // Said first that it was the account, not the address; then the press that clears it.
      expect(said.todo).toBe(`${words.todoCause.account} ${words.todoPress.confirmation}`);
      expect(Object.values(words.why.cause)).not.toContain(said.why);
      // The desk asks for the press, as for any owed email.
      expect(rejectedEmailWords(facts({ kind: "not-sent", sent: false, cause: "account" }), locale, "desk").todo).toBe(words.todoAskAdmin.confirmation);
    });

    it(`says the address works again and this one is owed (${locale})`, () => {
      const said = rejectedEmailWords(facts({ kind: "missing", laterDeliveredAt: LATER }), locale, "administrator");
      expect(said.why).toBe(fill(words.why.missing, { date: inline(locale, LATER) }));
      expect(said.todo).toBe(words.todoPress.confirmation);
    });

    it(`names the press that clears it, never one that sends something else (${locale})`, () => {
      // A race number refused on a confirmed registration: «Retrimite QR» sends the confirmation, which carries it.
      expect(rejectedEmailWords(facts({ kind: "missing", press: "confirmation" }), locale, "administrator").todo).toBe(words.todoPress.confirmation);
      expect(rejectedEmailWords(facts({ kind: "missing", press: "confirmation" }), locale, "organizer").todo).toBe(words.todoAskAdmin.confirmation);
      expect(words.todoPress.confirmation).toContain(catalogues[locale].Admin.registrations.resendQr);
      // The reminder has its own press, «Trimite reminderul».
      const reminder = facts({ kind: "missing", messageType: "EVENT_REMINDER", press: "reminder" });
      expect(rejectedEmailWords(reminder, locale, "administrator").todo).toBe(words.todoPress.reminder);
      expect(words.todoPress.reminder).toContain(catalogues[locale].Admin.registrations.sendReminder);
      expect(rejectedEmailWords(reminder, locale, "organizer").todo).toBe(words.todoAskAdmin.reminder);
      // Any other status: the page's own resend, which sends the very message.
      const verify = facts({ kind: "not-sent", messageType: "VERIFY_REGISTRATION_EMAIL", press: "resend" });
      expect(rejectedEmailWords(verify, locale, "administrator").todo).toBe(`${words.todoCause.account} ${words.todoPress.resend}`);
      expect(rejectedEmailWords(verify, locale, "organizer").todo).toBe(`${words.todoCause.account} ${words.todoAskAdmin.resend}`);
      // A family member's: from that person's registration, not this one.
      expect(rejectedEmailWords(facts({ kind: "missing", own: false }), locale, "administrator").todo).toBe(fill(words.todoFamily, { todo: words.todoPress.confirmation }));
      expect(rejectedEmailWords(facts({ kind: "missing", own: false }), locale, "organizer").todo).toBe(fill(words.todoFamily, { todo: words.todoAskAdmin.confirmation }));
    });

    it(`says a message sent again waits for its delivery, or by Gmail is never confirmed (${locale})`, () => {
      const mailgun = rejectedEmailWords(facts({ kind: "retried", retriedAt: LATER, retriedVia: "mailgun" }), locale, "organizer");
      expect(mailgun.why).toBe(fill(words.why.retried, { date: inline(locale, LATER) }));
      expect(mailgun.todo).toBe(words.todoWait);
      const gmail = rejectedEmailWords(facts({ kind: "retried", retriedAt: LATER, retriedVia: "gmail" }), locale, "organizer");
      expect(gmail.why).toBe(fill(words.why.retriedGmail, { date: inline(locale, LATER) }));
      expect(gmail.todo).toBe(words.todoAsk);
    });

    it(`never says the address refused an email that is owed or waiting, even without its date (${locale})`, () => {
      expect(rejectedEmailWords(facts({ kind: "missing" }), locale, "organizer").why).toBe(words.why.missingUndated);
      expect(rejectedEmailWords(facts({ kind: "retried" }), locale, "organizer").why).toBe(words.why.retriedUndated);
      expect(rejectedEmailWords(facts({ kind: "retried", retriedVia: "gmail" }), locale, "organizer").why).toBe(words.why.retriedGmailUndated);
      for (const kind of ["not-sent", "missing", "retried"] as const) {
        expect(Object.values(words.why.cause)).not.toContain(rejectedEmailWords(facts({ kind }), locale, "organizer").why);
      }
    });

    it(`asks a reader who may not send it again to ask an Administrator — the desk, the Organizer (${locale})`, () => {
      for (const kind of ["not-sent", "missing"] as const) {
        // An email the club's account could not send says so first, to whoever may phone about it.
        const account = kind === "not-sent" ? `${words.todoCause.account} ` : "";
        expect(rejectedEmailWords(facts({ kind }), locale, "organizer").todo).toBe(`${account}${words.todoAskAdmin.confirmation}`);
        expect(rejectedEmailWords(facts({ kind }), locale, "desk").todo).toBe(words.todoAskAdmin.confirmation);
        expect(rejectedEmailWords(facts({ kind }), locale, "administrator").todo).toBe(`${account}${words.todoPress.confirmation}`);
      }
    });

    it(`says the desk's projection in full: its dates, no provider words, no Administrator's verb (${locale})`, () => {
      const subquery = {
        kind: "missing",
        messageType: "REGISTRATION_CONFIRMED",
        at: REJECTED_AT.getTime(),
        atKnown: true,
        sent: true,
        status: "BOUNCED",
        cause: "no-such-address",
        unclassified: null,
        own: true,
        registrationStatus: "CONFIRMED",
        laterDeliveredAt: LATER.getTime(),
        retriedAt: null,
        retriedVia: null,
      };
      const desk = deskEmailStateOf(subquery);
      expect(desk).not.toBeNull();
      const missing = rejectedEmailWords({ ...desk!, emailConfirmedAt: CONFIRMED_AT }, locale, "desk");
      expect(missing.why).toBe(fill(words.why.missing, { date: inline(locale, LATER) }));
      expect(missing.todo).toBe(words.todoAskAdmin.confirmation);
      expect(missing.reason).toBeNull();
      const retried = rejectedEmailWords(
        { ...deskEmailStateOf({ ...subquery, kind: "retried", laterDeliveredAt: null, retriedAt: LATER.getTime(), retriedVia: "mailgun" })!, emailConfirmedAt: CONFIRMED_AT },
        locale,
        "desk",
      );
      expect(retried.why).toBe(fill(words.why.retried, { date: inline(locale, LATER) }));
      expect(retried.todo).toBe(words.todoWait);
      expect(rejectedEmailSentences(retried).join(" ")).not.toContain(words.todoPress.confirmation);
    });

    it(`says the address was confirmed before the rejected email, after it, or never (${locale})`, () => {
      expect(rejectedEmailWords(facts(), locale, "organizer").context).toBe(fill(words.confirmedBefore, { date: inline(locale, CONFIRMED_AT) }));
      const later = new Date("2026-10-04T08:00:00.000Z");
      expect(rejectedEmailWords(facts({ emailConfirmedAt: later }), locale, "organizer").context).toBe(fill(words.confirmedAfter, { date: inline(locale, later) }));
      expect(rejectedEmailWords(facts({ emailConfirmedAt: null, messageType: "VERIFY_REGISTRATION_EMAIL" }), locale, "organizer").context).toBe(words.neverConfirmed);
    });

    it(`tells the Administrator and the Organizer to phone, the address being the person's to change; the desk what to say to the person (${locale})`, () => {
      expect(rejectedEmailWords(facts(), locale, "administrator").todo).toBe(words.todo);
      expect(rejectedEmailWords(facts(), locale, "organizer").todo).toBe(words.todo);
      // The desk tells the person what they can do — never that somebody will phone them, which nothing tracks.
      expect(rejectedEmailWords(facts(), locale, "desk").todo).toBe(words.todoTellUnreachable);
      expect(words.todoTellUnreachable).not.toMatch(locale === "ro" ? /o sună/ : /will phone/);
      expect(rejectedEmailSentences(rejectedEmailWords(facts(), locale, "organizer"))).toHaveLength(4);
    });

    it(`never suggests a new registration on a confirmed one: the place stays, said first (${locale})`, () => {
      const newRegistration = locale === "ro" ? "înscriere nouă" : "registering again";
      for (const reader of READERS) {
        for (const cause of REJECTION_CAUSES) {
          const said = rejectedEmailWords(facts({ cause, confirmed: true, status: cause === "complained" ? "COMPLAINED" : "BOUNCED" }), locale, reader);
          expect(said.todo, `${reader} ${cause}`).not.toContain(newRegistration);
          if (reader !== "desk") expect(said.todo.startsWith(words.placeKept), `${reader} ${cause}`).toBe(true);
        }
        // Not confirmed: the address is the person's to change, by a new registration (§645).
        expect(rejectedEmailWords(facts({ confirmed: false }), locale, reader).todo).toContain(newRegistration);
      }
      // An owed email on a confirmed registration: the place first, then the press.
      expect(rejectedEmailWords(facts({ kind: "missing", confirmed: true }), locale, "administrator").todo).toBe(`${words.placeKept} ${words.todoPress.confirmation}`);
      // An email sent again asks nobody to act: no lead.
      expect(rejectedEmailWords(facts({ kind: "retried", confirmed: true }), locale, "administrator").todo).toBe(words.todoWait);
    });

    it(`asks for a phone call, never a press, for «Detalii actualizate» and the cancellation (${locale})`, () => {
      for (const [messageType, call] of [
        ["EVENT_UPDATE_NOTICE", "update"],
        ["EVENT_CANCELLED", "cancelled"],
      ] as const) {
        expect(callInstead(messageType)).toBe(call);
        for (const kind of ["not-sent", "missing"] as const) {
          for (const own of [true, false]) {
            const notice = facts({ kind, messageType, press: null, own, sent: kind !== "not-sent", cause: kind === "not-sent" ? "account" : "mailbox-full" });
            // The Administrator and the Organizer phone (a call is not a resend, §289); the desk tells the person in front of it; the same on a family member's.
            expect(rejectedEmailWords(notice, locale, "administrator").todo).toBe(words.todoCall[call]);
            expect(rejectedEmailWords(notice, locale, "organizer").todo).toBe(words.todoCall[call]);
            expect(rejectedEmailWords(notice, locale, "desk").todo).toBe(words.todoTell[call]);
            for (const reader of READERS) {
              for (const sentence of rejectedEmailSentences(rejectedEmailWords(notice, locale, reader))) {
                for (const press of [...Object.values(words.todoPress), ...Object.values(words.todoAskAdmin)]) expect(sentence).not.toBe(press);
              }
            }
          }
        }
        // An address that does not exist: the call is the to-do itself, «Sună persoana» once; the desk tells the person both.
        expect(rejectedEmailWords(facts({ messageType, press: null }), locale, "administrator").todo).toBe(words.todoCall[call]);
        expect(rejectedEmailWords(facts({ messageType, press: null }), locale, "organizer").todo).toBe(words.todoCall[call]);
        expect(rejectedEmailWords(facts({ messageType, press: null }), locale, "desk").todo).toBe(`${words.todoTellUnreachable} ${words.todoTell[call]}`);
        // Any other cause: nothing sends the notice again, so the cause's sentence is followed by the call.
        const blocked = facts({ messageType, press: null, cause: "blocked" });
        expect(rejectedEmailWords(blocked, locale, "administrator").todo).toBe(`${words.todoCause.retryLater} ${words.todoCall[call]}`);
        expect(rejectedEmailWords(blocked, locale, "organizer").todo).toBe(`${words.todoCause.retryLater} ${words.todoCall[call]}`);
        expect(rejectedEmailWords(blocked, locale, "desk").todo).toBe(`${words.todoTellCause.blocked} ${words.todoTell[call]}`);
      }
      expect(callInstead("REGISTRATION_CONFIRMED")).toBeNull();
    });

    it(`says «Detalii actualizate» did not arrive and that what changed is on the event's page — never what changed, which the notice may not name (${locale})`, () => {
      // The notice goes out for a moved place or time, a programme alone, a reinstatement, a note alone
      // (`announceSavedDate`, `EVENT_CHANGE_KINDS`): the state carries none of it, so the words must be true of all.
      const timeOrPlace = locale === "ro" ? "ora sau locul" : "the time or the place";
      const page = locale === "ro" ? "pagina evenimentului" : "event page";
      for (const kind of ["not-sent", "missing"] as const) {
        for (const reader of READERS) {
          const said = rejectedEmailWords(facts({ kind, messageType: "EVENT_UPDATE_NOTICE", press: null, sent: kind !== "not-sent", cause: kind === "not-sent" ? "account" : "mailbox-full" }), locale, reader);
          const label = JSON.stringify({ kind, reader });
          expect(said.todo, label).not.toContain(timeOrPlace);
          expect(said.todo, label).toContain(page);
        }
      }
      for (const text of [words.todoCall.update, words.todoTell.update]) expect(text).not.toContain(timeOrPlace);
    });

    it(`every (reader × kind × type) to-do, by one rule: the Administrator presses or phones, the Organizer asks for the press or phones, the desk asks for the press or tells the person (${locale})`, () => {
      const types = [
        ["BIB_ASSIGNED", "confirmation"],
        ["EVENT_REMINDER", "reminder"],
        ["VERIFY_REGISTRATION_EMAIL", "resend"],
        ["EVENT_UPDATE_NOTICE", null],
        ["EVENT_CANCELLED", null],
      ] as const;
      let combinations = 0;
      for (const reader of READERS) {
        for (const kind of EMAIL_STATE_KINDS) {
          for (const [messageType, press] of types) {
            combinations += 1;
            const label = JSON.stringify({ reader, kind, messageType });
            const said = rejectedEmailWords(
              facts({ kind, messageType, press, sent: kind !== "not-sent", cause: kind === "not-sent" ? "account" : "mailbox-full", retriedAt: kind === "retried" ? LATER : null, retriedVia: kind === "retried" ? "mailgun" : null }),
              locale,
              reader,
            );
            const call = callInstead(messageType);
            const pressed = press === null ? null : reader === "administrator" ? words.todoPress[press] : words.todoAskAdmin[press];
            // A full mailbox: the person makes room, then the press that clears it — none for the event's notices.
            // An event's notice, which nothing sends again, always ends with the call (at the desk: what to tell the person).
            const unreachable =
              reader === "desk"
                ? [words.todoTellCause["mailbox-full"], call ? words.todoTell[call] : null].filter(Boolean).join(" ")
                : [words.todoCause["mailbox-full"], call ? words.todoCall[call] : pressed].filter(Boolean).join(" ");
            const expected =
              kind === "unreachable"
                ? unreachable
                : kind === "retried"
                  ? words.todoWait
                  : call
                    ? reader === "desk"
                      ? words.todoTell[call]
                      : words.todoCall[call]
                    : // The club's account's refusal says so first, to whoever may phone about it.
                      kind === "not-sent" && reader !== "desk"
                      ? `${words.todoCause.account} ${pressed as string}`
                      : (pressed as string);
            expect(said.todo, label).toBe(expected);
            // Only the Administrator is told a press; nobody at the desk is told to phone.
            if (reader !== "administrator") for (const text of Object.values(words.todoPress)) expect(said.todo, label).not.toContain(text);
            if (reader === "desk") expect(said.todo, label).not.toMatch(locale === "ro" ? /^Sună/ : /^Phone/);
          }
        }
      }
      expect(combinations).toBe(READERS.length * EMAIL_STATE_KINDS.length * types.length);
    });

    it(`names a message type the catalogue does not know generically (${locale})`, () => {
      const said = rejectedEmailWords(facts({ messageType: "SOMETHING_NEW" }), locale, "organizer");
      expect(said.which).toContain(words.typeUnknown);
      expect(said.which).not.toContain("SOMETHING_NEW");
      expect(said.short).toBe(words.typeUnknown);
    });

    it(`keeps every sentence under 200 characters (§511) (${locale})`, () => {
      const strings = (node: unknown): string[] =>
        typeof node === "string" ? [node] : node && typeof node === "object" ? Object.values(node).flatMap(strings) : [];
      const registrations = catalogues[locale].Admin.registrations;
      const all = [
        ...strings(words),
        ...strings(registrations.tell.rejected),
        ...strings(registrations.emails),
        ...strings(catalogues[locale].Admin.emails.typesShort),
        registrations.bouncedOnly,
        registrations.bouncedOnlyHelp,
      ];
      expect(all.length).toBeGreaterThan(80);
      for (const text of all) expect(text.length, text).toBeLessThan(200);
    });
  }
});

describe("the sentences never contradict each other, in every combination (§670)", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`own × sent × timed × kind × status × cause × reader: «trimis» never beside «Nu a plecat», the address never beside «nu adresa» (${locale})`, () => {
      const words = catalogues[locale].Admin.registrations.rejected;
      const values = { type: catalogues[locale].Admin.emails.types.BIB_ASSIGNED, instant: inline(locale, REJECTED_AT) };
      // What each «which» claims: it left (and, for a family member's, was refused at the address), or it never left.
      const left = [fill(words.which, values), fill(words.whichFamily, values)];
      const neverLeft = [fill(words.whichQueued, values), fill(words.whichFamilyQueued, values), fill(words.whichUntimed, values), fill(words.whichFamilyUntimed, values)];
      // What each «why» claims: the recipient's side refused it (so it left), or it never left.
      const reachedTheRecipient: string[] = Object.values(words.why.cause);
      const neverLeftWhy = [words.why.account, words.why.BOUNCEDQueued, words.why.queuedOther];
      let combinations = 0;
      for (const own of [true, false]) {
        for (const sent of [true, false]) {
          for (const atKnown of [true, false]) {
            for (const kind of EMAIL_STATE_KINDS) {
              for (const status of ["BOUNCED", "COMPLAINED"] as const) {
                for (const cause of REJECTION_CAUSES) {
                  for (const reader of READERS) {
                    combinations += 1;
                    const label = JSON.stringify({ own, sent, atKnown, kind, status, cause, reader });
                    const these = {
                      sent,
                      atKnown,
                      kind,
                      status,
                      cause,
                      laterDeliveredAt: kind === "missing" ? LATER : null,
                      retriedAt: kind === "retried" ? LATER : null,
                      retriedVia: kind === "retried" ? ("mailgun" as const) : null,
                    };
                    const said = rejectedEmailWords(facts({ own, ...these }), locale, reader);
                    expect([...left, ...neverLeft], label).toContain(said.which);
                    if (left.includes(said.which)) expect(neverLeftWhy, label).not.toContain(said.why);
                    if (neverLeft.includes(said.which)) expect(reachedTheRecipient, label).not.toContain(said.why);
                    // The club's account refused it: it never left, at this registration's or a family member's.
                    if (kind === "not-sent") expect(neverLeft, label).toContain(said.which);
                    // A complaint arrived: it left.
                    if (status === "COMPLAINED" && kind !== "not-sent") expect(left, label).toContain(said.which);
                    // Only a refusal's own instant is «refuzat la trimitere»; a queueing's is «pus în coadă».
                    if (!atKnown) expect([fill(words.whichQueued, values), fill(words.whichFamilyQueued, values)], label).not.toContain(said.which);
                    // Own and family read the same «why»: only «which» and the press's place differ.
                    expect(said.why, label).toBe(rejectedEmailWords(facts({ own: !own, ...these }), locale, reader).why);
                    // No key leaks into a sentence: every one is a catalogue sentence.
                    for (const sentence of [...rejectedEmailSentences(said), said.line, said.label]) expect(sentence, label).not.toMatch(/registrations\.rejected|Admin\./);
                  }
                }
              }
            }
          }
        }
      }
      expect(combinations).toBe(2 * 2 * 2 * EMAIL_STATE_KINDS.length * 2 * REJECTION_CAUSES.length * READERS.length);
    });
  }
});

describe("«Ce îi spui» on a row whose email did not arrive (§663, §670)", () => {
  const base: TellFacts = {
    status: "CONFIRMED", holdExpiresAt: null, emailLinkExpiresAt: null, offerEmailQueued: false, eventStartsAt: new Date("2026-11-21T08:00:00.000Z"),
    eventTimezone: "Europe/Bucharest", eventCancelled: false, waitlistAutoOffer: true, waitlistCountPublic: true, participantCountPublic: true, waitlistPosition: null,
    waitlistLength: null, liveLinkExpiresAt: null, bibNumber: 17, checkedInAt: null,
  };
  const now = new Date("2026-10-04T09:00:00.000Z");
  const state = (overrides: Partial<NonNullable<TellFacts["emailState"]>> = {}): NonNullable<TellFacts["emailState"]> => ({
    kind: "unreachable",
    status: "BOUNCED",
    messageType: "REGISTRATION_CONFIRMED",
    at: REJECTED_AT,
    cause: "mailbox-full",
    ...overrides,
  });
  for (const locale of ["ro", "en"] as const) {
    const tell = catalogues[locale].Admin.registrations.tell.rejected;
    const short = catalogues[locale].Admin.emails.typesShort;
    const date = formatDay(REJECTED_AT, { locale, timeZone: "Europe/Bucharest", style: "long", year: false, position: "inline" });
    const lost = (cause: Exclude<RejectionCause, "account" | "complained">, type = short.REGISTRATION_CONFIRMED) => fill(tell.lost, { type, date, why: tell.why[cause] });

    it(`names the email in the participant's words and its date, why by cause, what they can do — and on a confirmed row that the place stays (${locale})`, () => {
      const without = whatToTell(locale, base, now);
      expect(whatToTell(locale, { ...base, emailState: state() }, now)).toEqual([...without, lost("mailbox-full"), tell.can["mailbox-full"], tell.placeKept]);
      expect(whatToTell(locale, { ...base, emailState: state({ cause: "blocked" }) }, now)).toEqual([...without, lost("blocked"), tell.can.blocked, tell.placeKept]);
      expect(whatToTell(locale, { ...base, emailState: state({ cause: "suppressed" }) }, now)).toEqual([...without, lost("suppressed"), tell.can.suppressed, tell.placeKept]);
      expect(whatToTell(locale, { ...base, emailState: state({ cause: "unsubscribed" }) }, now)).toEqual([...without, lost("unsubscribed"), tell.can.unsubscribed, tell.placeKept]);
      // On a confirmed registration, never «a new registration»: the place stays.
      expect(whatToTell(locale, { ...base, emailState: state({ cause: "no-such-address" }) }, now)).toEqual([...without, lost("no-such-address"), tell.placeKept]);
      // A complaint arrived: marked as spam, never «did not reach you».
      const complained = whatToTell(locale, { ...base, emailState: state({ status: "COMPLAINED", cause: "complained" }) }, now);
      expect(complained).toEqual([...without, fill(tell.spam, { type: short.REGISTRATION_CONFIRMED, date }), tell.can.unsubscribed, tell.placeKept]);
      expect(whatToTell(locale, { ...base, emailState: null }, now)).toEqual(without);
      // The race number by its own short name.
      expect(whatToTell(locale, { ...base, emailState: state({ messageType: "BIB_ASSIGNED" }) }, now)).toContain(lost("mailbox-full", short.BIB_ASSIGNED));
      // Every cause has its words, under 200 characters.
      for (const cause of REJECTION_CAUSES) {
        for (const line of whatToTell(locale, { ...base, emailState: state({ cause }) }, now)) expect(line.length, `${cause}: ${line}`).toBeLessThan(200);
      }
    });

    it(`says an email the club's account could not send, or one owed to an address that works again, as owed — never as a refusal (${locale})`, () => {
      const pending: TellFacts = { ...base, status: "PENDING_DECLARATION", bibNumber: null, holdExpiresAt: new Date("2026-10-10T08:00:00.000Z") };
      for (const kind of ["not-sent", "missing"] as const) {
        const owed = fill(tell.owed, { type: short.REGISTRATION_CONFIRMED, date });
        expect(whatToTell(locale, { ...base, emailState: state({ kind, cause: kind === "not-sent" ? "account" : "mailbox-full" }) }, now)).toEqual([...whatToTell(locale, base, now), owed, tell.placeKept]);
        // Not confirmed: no place to speak of.
        const declaration = state({ kind, messageType: "COMPLETE_DECLARATION", cause: "account" });
        expect(whatToTell(locale, { ...pending, emailState: declaration }, now).at(-1)).toBe(fill(tell.owed, { type: short.COMPLETE_DECLARATION, date }));
        // A family member's email owed at the same address is theirs: nothing to tell this person, not even the place.
        expect(whatToTell(locale, { ...base, emailState: state({ kind, own: false }) }, now)).toEqual(whatToTell(locale, base, now));
      }
      // Sent again: nothing to say until its delivery is known.
      expect(whatToTell(locale, { ...base, emailState: state({ kind: "retried" }) }, now)).toEqual(whatToTell(locale, base, now));
    });

    it(`says «Detalii actualizate» that did not reach them as what changed, promising nothing, and keeps «look in spam» (${locale})`, () => {
      const without = whatToTell(locale, base, now);
      const spamHint = catalogues[locale].Registrations.spamHint.body;
      const pending: TellFacts = { ...base, status: "PENDING_DECLARATION", bibNumber: null, holdExpiresAt: new Date("2026-10-10T08:00:00.000Z") };
      for (const kind of ["not-sent", "missing"] as const) {
        const update = state({ kind, own: true, press: null, messageType: "EVENT_UPDATE_NOTICE", cause: kind === "not-sent" ? "account" : "mailbox-full" });
        const said = whatToTell(locale, { ...base, emailState: update }, now);
        expect(said).toEqual([...without, tell.changed, tell.placeKept]);
        expect(said).not.toContain(fill(tell.owed, { type: short.EVENT_UPDATE_NOTICE, date }));
        // A family member's notice is theirs: nothing to this person.
        expect(whatToTell(locale, { ...base, emailState: { ...update, own: false } }, now)).toEqual(without);
        // Not the email a pending registration waits on: its link may still be in spam.
        expect(whatToTell(locale, { ...pending, emailState: update }, now)).toContain(spamHint);
        // A cancellation they did not get is the cancelled event's own line, and only that.
        const cancelled: TellFacts = { ...base, eventCancelled: true };
        expect(whatToTell(locale, { ...cancelled, emailState: { ...update, messageType: "EVENT_CANCELLED" } }, now)).toEqual(whatToTell(locale, cancelled, now));
      }
    });

    it(`drops «look in spam» for an email refused and not sent again, keeps it for a complaint and a send again (${locale})`, () => {
      const pending: TellFacts = { ...base, status: "PENDING_EMAIL_CONFIRMATION", bibNumber: null };
      const spamHint = catalogues[locale].Registrations.spamHint.body;
      const verify = (overrides: Partial<NonNullable<TellFacts["emailState"]>> = {}) => state({ messageType: "VERIFY_REGISTRATION_EMAIL", cause: "no-such-address", ...overrides });
      expect(whatToTell(locale, pending, now)).toContain(spamHint);
      const bounced = whatToTell(locale, { ...pending, emailState: verify() }, now);
      expect(bounced).not.toContain(spamHint);
      // Not confirmed: the address is the person's to change, by a new registration.
      expect(bounced.slice(-2)).toEqual([lost("no-such-address", short.VERIFY_REGISTRATION_EMAIL), tell.can["no-such-address"]]);
      expect(whatToTell(locale, { ...pending, emailState: verify({ status: "COMPLAINED", cause: "complained" }) }, now)).toContain(spamHint);
      // Never left (the club's account), or owed to an address that works again: not in spam either.
      for (const kind of ["not-sent", "missing"] as const) {
        const said = whatToTell(locale, { ...pending, emailState: verify({ kind, press: "resend" }) }, now);
        expect(said).not.toContain(spamHint);
        expect(said.at(-1)).toBe(fill(tell.owed, { type: short.VERIFY_REGISTRATION_EMAIL, date }));
        // A family member's owed email says nothing about this person's own, which may be in spam like anybody's.
        expect(whatToTell(locale, { ...pending, emailState: verify({ kind, own: false, press: "resend" }) }, now)).toContain(spamHint);
      }
      // The address's refusal is everybody's at it, a family member's included.
      expect(whatToTell(locale, { ...pending, emailState: verify({ own: false }) }, now)).not.toContain(spamHint);
      // Sent again: it may be in spam this time.
      expect(whatToTell(locale, { ...pending, emailState: verify({ kind: "retried" }) }, now)).toContain(spamHint);
    });
  }
});

describe("the email state's object, as the subquery hands it back", () => {
  const object = {
    kind: "missing",
    messageType: "REGISTRATION_CONFIRMED",
    at: REJECTED_AT.getTime(),
    atKnown: true,
    sent: true,
    status: "BOUNCED",
    cause: "mailbox-full",
    own: true,
    registrationStatus: "CONFIRMED",
    laterDeliveredAt: LATER.getTime(),
    retriedAt: null,
    retriedVia: null,
    code: "552 5.2.2",
    detail: "mailbox full",
  };

  it("reads the parsed object and its text alike, the instants as epoch milliseconds", () => {
    const expected = {
      kind: "missing",
      messageType: "REGISTRATION_CONFIRMED",
      at: REJECTED_AT,
      atKnown: true,
      sent: true,
      status: "BOUNCED",
      cause: "mailbox-full",
      own: true,
      press: "confirmation",
      laterDeliveredAt: LATER,
      retriedAt: null,
      retriedVia: null,
    };
    expect(emailStateOf(object)).toEqual(expected);
    expect(emailStateOf(JSON.stringify(object))).toEqual(expected);
    expect(emailStateOf(null)).toBeNull();
    expect(emailStateDetailOf(object)).toEqual({ ...expected, code: "552 5.2.2", detail: "mailbox full" });
    // A refusal from before `rejected_at` was stored: its instant is the queueing's, and the object says so.
    expect(emailStateOf({ ...object, atKnown: false })?.atKnown).toBe(false);
  });

  it("gives the desk what did not arrive, why and when — never the provider's words, nor the stored answer it classified", () => {
    const desk = deskEmailStateOf({ ...object, unclassified: "mailgun 401: Forbidden" });
    expect(desk).toEqual({
      kind: "missing",
      messageType: "REGISTRATION_CONFIRMED",
      at: REJECTED_AT,
      atKnown: true,
      sent: true,
      status: "BOUNCED",
      cause: "mailbox-full",
      own: true,
      press: "confirmation",
      laterDeliveredAt: LATER,
      retriedAt: null,
      retriedVia: null,
    });
    for (const key of ["detail", "code", "unclassified", "registrationStatus"]) expect(Object.keys(desk ?? {})).not.toContain(key);
    // No status it knows: no press named.
    expect(deskEmailStateOf({ ...object, registrationStatus: "SOMETHING" })?.press).toBeNull();
  });

  it("classifies a row stored without a cause from its stored answer, by the same rule (`rejectionCause`)", () => {
    expect(emailStateOf({ ...object, cause: null })?.cause).toBe("other");
    expect(emailStateOf({ ...object, cause: null, unclassified: "bounce" })?.cause).toBe("refused");
    expect(emailStateOf({ ...object, cause: null, unclassified: "suppress-bounce" })?.cause).toBe("suppressed");
    expect(emailStateOf({ ...object, cause: null, sent: false, unclassified: "mailgun 401: Forbidden" })?.cause).toBe("account");
    expect(emailStateOf({ ...object, cause: null, status: "COMPLAINED" })?.cause).toBe("complained");
    expect(emailStateOf({ ...object, kind: "nonsense" })?.kind).toBe("unreachable");
  });
});

describe("what a message carries, and what a registration still needs (§670)", () => {
  it("the confirmation carries the race number, the signed declaration and the event's details; the reminder the race number and the details; the declaration request the details; every other type only itself", () => {
    expect(typesCoveredBy("REGISTRATION_CONFIRMED").sort()).toEqual(["BIB_ASSIGNED", "DECLARATION_SIGNED", "EVENT_UPDATE_NOTICE", "REGISTRATION_CONFIRMED"]);
    expect(typesCoveredBy("EVENT_REMINDER").sort()).toEqual(["BIB_ASSIGNED", "EVENT_REMINDER", "EVENT_UPDATE_NOTICE"]);
    expect(typesCoveredBy("COMPLETE_DECLARATION").sort()).toEqual(["COMPLETE_DECLARATION", "EVENT_UPDATE_NOTICE"]);
    for (const type of ["VERIFY_REGISTRATION_EMAIL", "WAITLIST_SPOT_OFFER", "ORGANIZER_MESSAGE", "BIB_ASSIGNED", "EVENT_UPDATE_NOTICE", "EVENT_CANCELLED"] as const) {
      expect(typesCoveredBy(type)).toEqual([type]);
    }
    expect(typesCovering("BIB_ASSIGNED").sort()).toEqual(["BIB_ASSIGNED", "EVENT_REMINDER", "REGISTRATION_CONFIRMED"]);
    expect(typesCovering("DECLARATION_SIGNED").sort()).toEqual(["DECLARATION_SIGNED", "REGISTRATION_CONFIRMED"]);
    // A later update notice covers an earlier one (a type covers itself); the race number's email and the organizers' message carry one line, not the details.
    expect(typesCovering("EVENT_UPDATE_NOTICE").sort()).toEqual(["COMPLETE_DECLARATION", "EVENT_REMINDER", "EVENT_UPDATE_NOTICE", "REGISTRATION_CONFIRMED"]);
    expect(typesCovering("EVENT_CANCELLED")).toEqual(["EVENT_CANCELLED"]);
    expect(typesCovering("ORGANIZER_MESSAGE")).toEqual(["ORGANIZER_MESSAGE"]);
  });

  it("the messages said to carry the event's details are the ones the templates draw the details block on", () => {
    const templates = readFileSync("src/modules/notifications/templates.ts", "utf8");
    const block = /const EVENT_FACTS_MESSAGES[^=]*= new Set\(\[([^\]]*)\]/.exec(templates)?.[1] ?? "";
    const withTheBlock = [...block.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
    for (const covering of typesCovering("EVENT_UPDATE_NOTICE").filter((type) => type !== "EVENT_UPDATE_NOTICE")) expect(withTheBlock).toContain(covering);
  });

  it("migration 0131's backfill reads the same pairs", () => {
    const migration = readFileSync("src/db/migrations/0131_email_delivery_facts.sql", "utf8");
    const types: readonly string[] = emailMessageType.enumValues;
    const pairs = [...migration.matchAll(/\('([A-Z_]+)', '([A-Z_]+)'\)/g)]
      .filter((match) => types.includes(match[1]) && types.includes(match[2]))
      .map((match) => `${match[1]}>${match[2]}`);
    const expected = COVER_PAIRS.map(([covering, covered]) => `${covering}>${covered}`).sort();
    // Three statements read the pairs; each lists all of them.
    expect(pairs.sort()).toEqual([...expected, ...expected, ...expected].sort());
  });

  it("a registration needs what its page can send again and what that carries — and on a confirmed one, the reminder while the event is ahead", () => {
    expect(stillNeededMessageTypes("CONFIRMED", "ahead").sort()).toEqual(["BIB_ASSIGNED", "DECLARATION_SIGNED", "EVENT_REMINDER", "EVENT_UPDATE_NOTICE", "REGISTRATION_CONFIRMED"]);
    // Race day, after the start: what the desk asks for, never the reminder nor the update notice.
    expect(stillNeededMessageTypes("CONFIRMED", "started").sort()).toEqual(["BIB_ASSIGNED", "DECLARATION_SIGNED", "REGISTRATION_CONFIRMED"]);
    expect(stillNeededMessageTypes("PENDING_EMAIL_CONFIRMATION", "ahead")).toEqual(["VERIFY_REGISTRATION_EMAIL"]);
    expect(stillNeededMessageTypes("PENDING_DECLARATION", "ahead").sort()).toEqual(["COMPLETE_DECLARATION", "EVENT_UPDATE_NOTICE"]);
    expect(stillNeededMessageTypes("PENDING_DECLARATION", "started")).toEqual(["COMPLETE_DECLARATION"]);
    expect(stillNeededMessageTypes("WAITLIST_OFFERED", "ahead").sort()).toEqual(["EVENT_UPDATE_NOTICE", "WAITLIST_SPOT_OFFER"]);
    expect(stillNeededMessageTypes("WAITLISTED", "ahead").sort()).toEqual(["EVENT_UPDATE_NOTICE", "WAITLIST_JOINED"]);
    // A cancelled event's links lead nowhere: only where the registration stands is sent again (§331) —
    // and, before its start, that it is cancelled, to the people told of it.
    expect(stillNeededMessageTypes("CONFIRMED", "cancelled-ahead")).toEqual(["EVENT_CANCELLED"]);
    expect(stillNeededMessageTypes("CONFIRMED", "cancelled-started")).toEqual([]);
    expect(stillNeededMessageTypes("CANCELLED", "cancelled-ahead")).toEqual(["REGISTRATION_STATE_NOTICE"]);
    expect(stillNeededMessageTypes("CANCELLED", "cancelled-started")).toEqual(["REGISTRATION_STATE_NOTICE"]);
    expect(stillNeededMessageTypes("PENDING_EMAIL_CONFIRMATION", "cancelled-ahead")).toEqual([]);
    // The event's notices, by their own rule: to the people they go to (§331), while they matter.
    for (const status of registrationStatus.enumValues) {
      const told = (EVENT_NOTICE_STATUSES as readonly string[]).includes(status);
      expect(stillNeededMessageTypes(status, "ahead").includes("EVENT_UPDATE_NOTICE"), status).toBe(told);
      expect(stillNeededMessageTypes(status, "cancelled-ahead").includes("EVENT_CANCELLED"), status).toBe(told);
      expect(stillNeededMessageTypes(status, "ahead"), status).not.toContain("EVENT_CANCELLED");
      expect(stillNeededMessageTypes(status, "cancelled-ahead"), status).not.toContain("EVENT_UPDATE_NOTICE");
      for (const moment of ["started", "cancelled-started"] as const) {
        expect(stillNeededMessageTypes(status, moment), `${moment} ${status}`).not.toContain("EVENT_UPDATE_NOTICE");
        expect(stillNeededMessageTypes(status, moment), `${moment} ${status}`).not.toContain("EVENT_CANCELLED");
      }
    }
    // What a registration has moved past is nobody's to send again.
    expect(stillNeededMessageTypes("CONFIRMED", "ahead")).not.toContain("VERIFY_REGISTRATION_EMAIL");
    expect(stillNeededMessageTypes("CONFIRMED", "ahead")).not.toContain("COMPLETE_DECLARATION");
    expect(stillNeededMessageTypes("CONFIRMED", "ahead")).not.toContain("WAITLIST_SPOT_OFFER");
    expect(stillNeededMessageTypes("CONFIRMED", "ahead")).not.toContain("ORGANIZER_MESSAGE");
    // The SQL's list is this function's, every status and every moment.
    expect(STILL_NEEDED_KEYS).toContain("ahead:CONFIRMED:BIB_ASSIGNED");
    expect(STILL_NEEDED_KEYS).toContain("cancelled-ahead:CONFIRMED:EVENT_CANCELLED");
    expect(STILL_NEEDED_KEYS).not.toContain("started:CONFIRMED:EVENT_REMINDER");
    expect(STILL_NEEDED_KEYS).toHaveLength(
      EVENT_MOMENTS.reduce((sum, moment) => sum + registrationStatus.enumValues.reduce((n, status) => n + stillNeededMessageTypes(status, moment).length, 0), 0),
    );
  });

  it("names the press that clears a refusal on the registration it was for — the one whose message carries it", () => {
    expect(pressThatClears("BIB_ASSIGNED", "CONFIRMED")).toBe("confirmation");
    expect(pressThatClears("DECLARATION_SIGNED", "CONFIRMED")).toBe("confirmation");
    expect(pressThatClears("REGISTRATION_CONFIRMED", "CONFIRMED")).toBe("confirmation");
    expect(pressThatClears("EVENT_REMINDER", "CONFIRMED")).toBe("reminder");
    expect(pressThatClears("VERIFY_REGISTRATION_EMAIL", "PENDING_EMAIL_CONFIRMATION")).toBe("resend");
    expect(pressThatClears("VERIFY_REGISTRATION_EMAIL", "CONFIRMED")).toBeNull();
    expect(pressThatClears("BIB_ASSIGNED", null)).toBeNull();
    // The event's notices have no press: the confirmation carries the details, but never says they changed.
    for (const status of registrationStatus.enumValues) {
      expect(pressThatClears("EVENT_UPDATE_NOTICE", status), status).toBeNull();
      expect(pressThatClears("EVENT_CANCELLED", status), status).toBeNull();
    }
    // Every press named is a press the page has: the state's own resend, or the reminder; every other still-needed message is a call.
    for (const moment of EVENT_MOMENTS) {
      for (const status of registrationStatus.enumValues) {
        for (const type of stillNeededMessageTypes(status, moment)) {
          const press = pressThatClears(type, status);
          if (callInstead(type) !== null) {
            expect(press, `${moment} ${status} ${type}`).toBeNull();
            continue;
          }
          expect(press, `${moment} ${status} ${type}`).not.toBeNull();
          if (press !== "reminder") expect(typesCoveredBy(deriveAllowedResendMessageType(status)!)).toContain(type);
        }
      }
    }
  });
});
