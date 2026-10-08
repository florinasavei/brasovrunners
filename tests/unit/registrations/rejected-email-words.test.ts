import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { formatDay } from "@/i18n/dates";
import { deskEmailStateOf, emailStateDetailOf, emailStateOf } from "@/modules/registrations/domain/email-state";
import { rejectedEmailSentences, rejectedEmailWords, type RejectedEmailFacts } from "@/modules/registrations/ui/rejected-email-words";
import { whatToTell, type TellFacts } from "@/modules/registrations/ui/tell-words";

/**
 * BR-REQ-037-03, BR-REQ-038-01 criterion 8 (§663; amending §650, §76, §83; §NNN) — «Email respins» says which
 * email did not arrive, when, why — by the registration's one email state: the address refused it, the
 * club's account was refused when it was to leave, the address works again but it was not sent again, or it
 * was sent again — and whether the address had been confirmed before it.
 */
const catalogues = { ro, en } as const;
const CONFIRMED_AT = new Date("2026-10-01T07:30:00.000Z");
const REJECTED_AT = new Date("2026-10-03T09:15:00.000Z");
const LATER = new Date("2026-10-05T10:00:00.000Z");
const inline = (locale: "ro" | "en", at: Date) => formatDay(at, { locale, timeZone: "Europe/Bucharest", style: "short", withTime: true, position: "inline" });

function facts(overrides: Partial<RejectedEmailFacts> = {}): RejectedEmailFacts {
  return {
    kind: "unreachable",
    messageType: "BIB_ASSIGNED",
    at: REJECTED_AT,
    sent: true,
    status: "BOUNCED",
    cause: "no-such-address",
    own: true,
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
    const fill = (text: string, values: Record<string, string>) => Object.entries(values).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), text);
    const type = catalogues[locale].Admin.emails.types.BIB_ASSIGNED;

    it(`names the email by its «Emailuri» name and says when, in club time (${locale})`, () => {
      const said = rejectedEmailWords(facts(), locale);
      expect(said.which).toBe(fill(words.which, { type, instant: inline(locale, REJECTED_AT) }));
      // §452: the hour inside a sentence takes «la» / «at»; no «pe» before the weekday.
      expect(said.which).toContain(locale === "ro" ? ", la 12:15" : ", at 12:15");
      expect(said.which).not.toMatch(/ pe /);
    });

    it(`says «pus în coadă», not «trimis», for a message the provider refused at the send (${locale})`, () => {
      const said = rejectedEmailWords(facts({ sent: false }), locale);
      expect(said.which).toBe(fill(words.whichQueued, { type, instant: inline(locale, REJECTED_AT) }));
      expect(said.which).not.toBe(rejectedEmailWords(facts(), locale).which);
    });

    it(`says a family member's refusal at the same address as such (${locale})`, () => {
      expect(rejectedEmailWords(facts({ own: false }), locale).which).toBe(fill(words.whichFamily, { type, instant: inline(locale, REJECTED_AT) }));
    });

    it(`says a bounce and a complaint in plain words, the provider's words apart (${locale})`, () => {
      const bounce = rejectedEmailWords(facts(), locale);
      expect(bounce.why).toBe(words.why.BOUNCED);
      expect(bounce.reason).toBe(fill(words.reason, { reason: "550 5.1.1 mailbox unavailable" }));
      expect(rejectedEmailSentences(bounce)).not.toContain(bounce.reason);
      const complaint = rejectedEmailWords(facts({ status: "COMPLAINED", cause: "complained", detail: null }), locale);
      expect(complaint.why).toBe(words.why.COMPLAINED);
      expect(complaint.reason).toBeNull();
      // No list and no desk carries the provider's words: without them there is no small print.
      expect(rejectedEmailWords(facts({ detail: undefined }), locale).reason).toBeNull();
    });

    it(`says the club's account was refused, never the address, for a message that never left (${locale})`, () => {
      const said = rejectedEmailWords(facts({ kind: "not-sent", sent: false, cause: "account" }), locale, { mayResend: true });
      expect(said.why).toBe(words.why.account);
      expect(said.todo).toBe(words.todoResend);
      expect(said.why).not.toBe(words.why.BOUNCED);
    });

    it(`says the address works again and this one is owed (${locale})`, () => {
      const said = rejectedEmailWords(facts({ kind: "missing", laterDeliveredAt: LATER }), locale, { mayResend: true });
      expect(said.why).toBe(fill(words.why.missing, { date: inline(locale, LATER) }));
      expect(said.todo).toBe(words.todoResend);
    });

    it(`says a message sent again waits for its delivery, or by Gmail is never confirmed (${locale})`, () => {
      const mailgun = rejectedEmailWords(facts({ kind: "retried", retriedAt: LATER, retriedVia: "mailgun" }), locale);
      expect(mailgun.why).toBe(fill(words.why.retried, { date: inline(locale, LATER) }));
      expect(mailgun.todo).toBe(words.todoWait);
      const gmail = rejectedEmailWords(facts({ kind: "retried", retriedAt: LATER, retriedVia: "gmail" }), locale);
      expect(gmail.why).toBe(fill(words.why.retriedGmail, { date: inline(locale, LATER) }));
      expect(gmail.todo).toBe(words.todoAsk);
    });

    it(`never says the address refused an email that is owed or waiting, even without its date (${locale})`, () => {
      expect(rejectedEmailWords(facts({ kind: "missing" }), locale).why).toBe(words.why.missingUndated);
      expect(rejectedEmailWords(facts({ kind: "retried" }), locale).why).toBe(words.why.retriedUndated);
      expect(rejectedEmailWords(facts({ kind: "retried", retriedVia: "gmail" }), locale).why).toBe(words.why.retriedGmailUndated);
      for (const kind of ["not-sent", "missing", "retried"] as const) {
        expect(rejectedEmailWords(facts({ kind }), locale).why).not.toBe(words.why.BOUNCED);
      }
    });

    it(`asks a reader who may not send it again to ask an Administrator — the desk, the Organizer (${locale})`, () => {
      for (const kind of ["not-sent", "missing"] as const) {
        expect(rejectedEmailWords(facts({ kind }), locale).todo).toBe(words.todoAskAdmin);
        expect(rejectedEmailWords(facts({ kind }), locale, { mayResend: false }).todo).toBe(words.todoAskAdmin);
        expect(rejectedEmailWords(facts({ kind }), locale, { mayResend: true }).todo).toBe(words.todoResend);
      }
    });

    it(`says the desk's projection in full: its dates, no provider words, no Administrator's verb (${locale})`, () => {
      const subquery = {
        kind: "missing",
        messageType: "REGISTRATION_CONFIRMED",
        at: REJECTED_AT.getTime(),
        sent: true,
        status: "BOUNCED",
        cause: "no-such-address",
        unclassified: null,
        own: true,
        laterDeliveredAt: LATER.getTime(),
        retriedAt: null,
        retriedVia: null,
      };
      const desk = deskEmailStateOf(subquery);
      expect(desk).not.toBeNull();
      const missing = rejectedEmailWords({ ...desk!, emailConfirmedAt: CONFIRMED_AT }, locale, { mayResend: false });
      expect(missing.why).toBe(fill(words.why.missing, { date: inline(locale, LATER) }));
      expect(missing.todo).toBe(words.todoAskAdmin);
      expect(missing.reason).toBeNull();
      const retried = rejectedEmailWords(
        { ...deskEmailStateOf({ ...subquery, kind: "retried", laterDeliveredAt: null, retriedAt: LATER.getTime(), retriedVia: "mailgun" })!, emailConfirmedAt: CONFIRMED_AT },
        locale,
        { mayResend: false },
      );
      expect(retried.why).toBe(fill(words.why.retried, { date: inline(locale, LATER) }));
      expect(retried.todo).toBe(words.todoWait);
      expect(rejectedEmailSentences(retried).join(" ")).not.toContain(words.todoResend);
    });

    it(`says the address was confirmed before the rejected email, after it, or never (${locale})`, () => {
      expect(rejectedEmailWords(facts(), locale).context).toBe(fill(words.confirmedBefore, { date: inline(locale, CONFIRMED_AT) }));
      const later = new Date("2026-10-04T08:00:00.000Z");
      expect(rejectedEmailWords(facts({ emailConfirmedAt: later }), locale).context).toBe(fill(words.confirmedAfter, { date: inline(locale, later) }));
      expect(rejectedEmailWords(facts({ emailConfirmedAt: null, messageType: "VERIFY_REGISTRATION_EMAIL" }), locale).context).toBe(words.neverConfirmed);
    });

    it(`tells staff to phone, the address being the person's to change (${locale})`, () => {
      expect(rejectedEmailWords(facts(), locale).todo).toBe(words.todo);
      expect(rejectedEmailSentences(rejectedEmailWords(facts(), locale))).toHaveLength(4);
    });

    it(`names a message type the catalogue does not know generically (${locale})`, () => {
      const said = rejectedEmailWords(facts({ messageType: "SOMETHING_NEW" }), locale);
      expect(said.which).toContain(words.typeUnknown);
      expect(said.which).not.toContain("SOMETHING_NEW");
    });

    it(`keeps every sentence under 200 characters (§511) (${locale})`, () => {
      const all = [
        words.which, words.whichQueued, words.whichFamily, words.typeUnknown, words.why.BOUNCED, words.why.COMPLAINED, words.why.account, words.why.missing,
        words.why.retried, words.why.retriedGmail, words.why.missingUndated, words.why.retriedUndated, words.why.retriedGmailUndated, words.reason,
        words.confirmedBefore, words.confirmedAfter, words.neverConfirmed, words.todo, words.todoResend, words.todoAskAdmin, words.todoWait, words.todoAsk,
        catalogues[locale].Admin.registrations.tell.rejected.BOUNCED, catalogues[locale].Admin.registrations.tell.rejected.COMPLAINED,
        catalogues[locale].Admin.registrations.tell.rejected.owed,
        catalogues[locale].Admin.registrations.bouncedOnly, catalogues[locale].Admin.registrations.bouncedOnlyHelp,
      ];
      for (const text of all) expect(text.length, text).toBeLessThan(200);
    });
  }
});

describe("«Ce îi spui» on a row whose email did not arrive (§663, §NNN)", () => {
  const base: TellFacts = {
    status: "CONFIRMED", holdExpiresAt: null, emailLinkExpiresAt: null, offerEmailQueued: false, eventStartsAt: new Date("2026-11-21T08:00:00.000Z"),
    eventTimezone: "Europe/Bucharest", eventCancelled: false, waitlistAutoOffer: true, waitlistCountPublic: true, participantCountPublic: true, waitlistPosition: null,
    waitlistLength: null, liveLinkExpiresAt: null, bibNumber: 17, checkedInAt: null,
  };
  const now = new Date("2026-10-04T09:00:00.000Z");
  for (const locale of ["ro", "en"] as const) {
    it(`adds one sentence, bounce or complaint, when the address refuses the club's mail (${locale})`, () => {
      const without = whatToTell(locale, base, now);
      const bounced = whatToTell(locale, { ...base, emailState: { kind: "unreachable", status: "BOUNCED" } }, now);
      expect(bounced).toEqual([...without, catalogues[locale].Admin.registrations.tell.rejected.BOUNCED]);
      const complained = whatToTell(locale, { ...base, emailState: { kind: "unreachable", status: "COMPLAINED" } }, now);
      expect(complained.at(-1)).toBe(catalogues[locale].Admin.registrations.tell.rejected.COMPLAINED);
      expect(whatToTell(locale, { ...base, emailState: null }, now)).toEqual(without);
    });

    it(`says an email the club's account could not send, or one owed to an address that works again, as owed — never as a refusal (${locale})`, () => {
      const without = whatToTell(locale, base, now);
      const tell = catalogues[locale].Admin.registrations.tell.rejected;
      for (const kind of ["not-sent", "missing"] as const) {
        const said = whatToTell(locale, { ...base, emailState: { kind, status: "BOUNCED" } }, now);
        expect(said).toEqual([...without, tell.owed]);
        expect(said).not.toContain(tell.BOUNCED);
      }
      // Sent again: nothing to say until its delivery is known (the next change draws it).
      expect(whatToTell(locale, { ...base, emailState: { kind: "retried", status: "BOUNCED" } }, now)).toEqual(without);
    });

    it(`drops «look in spam» for an email refused and not sent again, keeps it for a complaint and a send again (${locale})`, () => {
      const pending: TellFacts = { ...base, status: "PENDING_EMAIL_CONFIRMATION", bibNumber: null };
      const spamHint = catalogues[locale].Registrations.spamHint.body;
      expect(whatToTell(locale, pending, now)).toContain(spamHint);
      const bounced = whatToTell(locale, { ...pending, emailState: { kind: "unreachable", status: "BOUNCED" } }, now);
      expect(bounced).not.toContain(spamHint);
      expect(bounced.at(-1)).toBe(catalogues[locale].Admin.registrations.tell.rejected.BOUNCED);
      expect(whatToTell(locale, { ...pending, emailState: { kind: "unreachable", status: "COMPLAINED" } }, now)).toContain(spamHint);
      // Never left (the club's account), or owed to an address that works again: not in spam either.
      for (const kind of ["not-sent", "missing"] as const) {
        const said = whatToTell(locale, { ...pending, emailState: { kind, status: "BOUNCED" } }, now);
        expect(said).not.toContain(spamHint);
        expect(said.at(-1)).toBe(catalogues[locale].Admin.registrations.tell.rejected.owed);
      }
      // Sent again: it may be in spam this time.
      expect(whatToTell(locale, { ...pending, emailState: { kind: "retried", status: "BOUNCED" } }, now)).toContain(spamHint);
    });
  }
});

describe("the email state's object, as the subquery hands it back", () => {
  const object = {
    kind: "missing",
    messageType: "REGISTRATION_CONFIRMED",
    at: REJECTED_AT.getTime(),
    sent: true,
    status: "BOUNCED",
    cause: "mailbox-full",
    own: true,
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
      sent: true,
      status: "BOUNCED",
      cause: "mailbox-full",
      own: true,
      laterDeliveredAt: LATER,
      retriedAt: null,
      retriedVia: null,
    };
    expect(emailStateOf(object)).toEqual(expected);
    expect(emailStateOf(JSON.stringify(object))).toEqual(expected);
    expect(emailStateOf(null)).toBeNull();
    expect(emailStateDetailOf(object)).toEqual({ ...expected, code: "552 5.2.2", detail: "mailbox full" });
  });

  it("gives the desk what did not arrive, why and when — never the provider's words, nor the stored answer it classified", () => {
    const desk = deskEmailStateOf({ ...object, unclassified: "mailgun 401: Forbidden" });
    expect(desk).toEqual({
      kind: "missing",
      messageType: "REGISTRATION_CONFIRMED",
      at: REJECTED_AT,
      sent: true,
      status: "BOUNCED",
      cause: "mailbox-full",
      own: true,
      laterDeliveredAt: LATER,
      retriedAt: null,
      retriedVia: null,
    });
    for (const key of ["detail", "code", "unclassified"]) expect(Object.keys(desk ?? {})).not.toContain(key);
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
