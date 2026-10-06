import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { formatDay } from "@/i18n/dates";
import { rejectedEmailOf } from "@/modules/registrations/domain/rejected-email";
import { rejectedEmailSentences, rejectedEmailWords, type RejectedEmailFacts } from "@/modules/registrations/ui/rejected-email-words";
import { whatToTell, type TellFacts } from "@/modules/registrations/ui/tell-words";

/**
 * BR-REQ-037-03, BR-REQ-038-01 criterion 8 (§663; amending §650, §76, §83) — «Email respins» says which
 * email was rejected, when, why, and whether the address had been confirmed before it: a confirmed row
 * with a rejected email is a confirmed participant the club can no longer reach by email.
 */
const catalogues = { ro, en } as const;
const CONFIRMED_AT = new Date("2026-10-01T07:30:00.000Z");
const REJECTED_AT = new Date("2026-10-03T09:15:00.000Z");
const inline = (locale: "ro" | "en", at: Date) => formatDay(at, { locale, timeZone: "Europe/Bucharest", style: "short", withTime: true, position: "inline" });

function facts(overrides: Partial<RejectedEmailFacts> = {}): RejectedEmailFacts {
  return { messageType: "BIB_ASSIGNED", at: REJECTED_AT, sent: true, status: "BOUNCED", reason: "550 5.1.1 mailbox unavailable", emailConfirmedAt: CONFIRMED_AT, ...overrides };
}

describe("rejectedEmailWords", () => {
  for (const locale of ["ro", "en"] as const) {
    const words = catalogues[locale].Admin.registrations.rejected;
    const fill = (text: string, values: Record<string, string>) => Object.entries(values).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), text);

    it(`names the email by its «Emailuri» name and says when, in club time (${locale})`, () => {
      const said = rejectedEmailWords(facts(), locale);
      expect(said.which).toBe(fill(words.which, { type: catalogues[locale].Admin.emails.types.BIB_ASSIGNED, instant: inline(locale, REJECTED_AT) }));
      // §452: the hour inside a sentence takes «la» / «at»; no «pe» before the weekday.
      expect(said.which).toContain(locale === "ro" ? ", la 12:15" : ", at 12:15");
      expect(said.which).not.toMatch(/ pe /);
    });

    it(`says «pus în coadă», not «trimis», for a message the provider refused at the send (${locale})`, () => {
      const said = rejectedEmailWords(facts({ sent: false }), locale);
      expect(said.which).toBe(fill(words.whichQueued, { type: catalogues[locale].Admin.emails.types.BIB_ASSIGNED, instant: inline(locale, REJECTED_AT) }));
      expect(said.which).not.toBe(rejectedEmailWords(facts(), locale).which);
    });

    it(`says a bounce and a complaint in plain words, the provider's reason apart (${locale})`, () => {
      const bounce = rejectedEmailWords(facts(), locale);
      expect(bounce.why).toBe(words.why.BOUNCED);
      expect(bounce.reason).toBe(fill(words.reason, { reason: "550 5.1.1 mailbox unavailable" }));
      expect(rejectedEmailSentences(bounce)).not.toContain(bounce.reason);
      const complaint = rejectedEmailWords(facts({ status: "COMPLAINED", reason: null }), locale);
      expect(complaint.why).toBe(words.why.COMPLAINED);
      expect(complaint.reason).toBeNull();
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

    it(`keeps every new sentence under 200 characters (§511) (${locale})`, () => {
      const all = [words.which, words.whichQueued, words.typeUnknown, words.why.BOUNCED, words.why.COMPLAINED, words.reason, words.confirmedBefore, words.confirmedAfter, words.neverConfirmed, words.todo,
        catalogues[locale].Admin.registrations.tell.rejected.BOUNCED, catalogues[locale].Admin.registrations.tell.rejected.COMPLAINED,
        catalogues[locale].Admin.registrations.bouncedOnly, catalogues[locale].Admin.registrations.bouncedOnlyHelp];
      for (const text of all) expect(text.length, text).toBeLessThan(200);
    });
  }
});

describe("«Ce îi spui» on a row whose newest email was rejected (§663)", () => {
  const base: TellFacts = {
    status: "CONFIRMED", holdExpiresAt: null, emailLinkExpiresAt: null, offerEmailQueued: false, eventStartsAt: new Date("2026-11-21T08:00:00.000Z"),
    eventTimezone: "Europe/Bucharest", eventCancelled: false, waitlistAutoOffer: true, waitlistCountPublic: true, participantCountPublic: true, waitlistPosition: null,
    waitlistLength: null, liveLinkExpiresAt: null, bibNumber: 17, checkedInAt: null,
  };
  const now = new Date("2026-10-04T09:00:00.000Z");
  for (const locale of ["ro", "en"] as const) {
    it(`adds one sentence, bounce or complaint, in the registration's language (${locale})`, () => {
      const without = whatToTell(locale, base, now);
      const bounced = whatToTell(locale, { ...base, emailRejected: { status: "BOUNCED" } }, now);
      expect(bounced).toEqual([...without, catalogues[locale].Admin.registrations.tell.rejected.BOUNCED]);
      const complained = whatToTell(locale, { ...base, emailRejected: { status: "COMPLAINED" } }, now);
      expect(complained.at(-1)).toBe(catalogues[locale].Admin.registrations.tell.rejected.COMPLAINED);
      expect(whatToTell(locale, { ...base, emailRejected: null }, now)).toEqual(without);
    });

    it(`drops «look in spam» when the address bounced the email it waits on, keeps it for a complaint (${locale})`, () => {
      const pending: TellFacts = { ...base, status: "PENDING_EMAIL_CONFIRMATION", bibNumber: null };
      const spamHint = catalogues[locale].Registrations.spamHint.body;
      expect(whatToTell(locale, pending, now)).toContain(spamHint);
      const bounced = whatToTell(locale, { ...pending, emailRejected: { status: "BOUNCED" } }, now);
      expect(bounced).not.toContain(spamHint);
      expect(bounced.at(-1)).toBe(catalogues[locale].Admin.registrations.tell.rejected.BOUNCED);
      expect(whatToTell(locale, { ...pending, emailRejected: { status: "COMPLAINED" } }, now)).toContain(spamHint);
    });
  }
});

describe("rejectedEmailOf — the subquery's object", () => {
  it("reads the parsed object and its text alike, the instant as epoch milliseconds", () => {
    const object = { messageType: "BIB_ASSIGNED", at: REJECTED_AT.getTime(), sent: false, status: "COMPLAINED", reason: "" };
    const expected = { messageType: "BIB_ASSIGNED", at: REJECTED_AT, sent: false, status: "COMPLAINED", reason: null };
    expect(rejectedEmailOf(object)).toEqual(expected);
    expect(rejectedEmailOf(JSON.stringify(object))).toEqual(expected);
    expect(rejectedEmailOf(null)).toBeNull();
  });
});
