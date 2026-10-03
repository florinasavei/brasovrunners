import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { formatDay } from "@/i18n/dates";
import { whatToTell, type TellFacts } from "@/modules/registrations/ui/tell-words";
import { waitlistStandingPhrase } from "@/modules/registrations/ui/waitlist-position-words";

/**
 * BR-REQ-037-01 (§NNN) — «Ce îi spui»: the sentences a staff member tells somebody who asks where
 * their registration stands, in the registration's language, from the real catalogues.
 *
 * What it holds: every state says the participant's own state words first; the deadline, the
 * reservation and the waiting line are the participant's page's own sentences (the same keys and the
 * same `waitlistStandingPhrase`), not a copy; the spam hint only where an email link is the next step;
 * a cancelled event says only the cancellation; the live link's expiry when one exists; and every line
 * stays under 200 characters (§511) in both languages.
 */
const NOW = new Date("2026-10-03T09:00:00.000Z");
const LATER = new Date("2026-10-05T09:00:00.000Z");
const EARLIER = new Date("2026-10-01T09:00:00.000Z");
const ZONE = "Europe/Bucharest";

const catalogues = { ro, en } as const;
type Say = (key: string, values?: Record<string, string | number>) => string;
const say = (locale: "ro" | "en") => createTranslator({ locale, messages: catalogues[locale], namespace: "Registrations" }) as unknown as Say;
const ours = (locale: "ro" | "en", key: string) => (catalogues[locale].Admin.registrations.tell as Record<string, unknown>)[key] as string;
const instant = (locale: "ro" | "en", at: Date) => formatDay(at, { locale, timeZone: ZONE, style: "long", withTime: true, position: "inline" });

function facts(overrides: Partial<TellFacts>): TellFacts {
  return {
    status: "CONFIRMED",
    holdExpiresAt: null,
    emailLinkExpiresAt: null,
    offerEmailQueued: false,
    eventStartsAt: new Date("2026-11-21T08:00:00.000Z"),
    eventTimezone: ZONE,
    eventCancelled: false,
    waitlistAutoOffer: true,
    waitlistCountPublic: true,
    waitlistPosition: null,
    waitlistLength: null,
    liveLinkExpiresAt: null,
    bibNumber: null,
    checkedInAt: null,
    ...overrides,
  };
}

describe("§NNN whatToTell — what to tell a person who asks where their registration stands", () => {
  for (const locale of ["ro", "en"] as const) {
    const spam = say(locale)("spamHint.body");
    const stateLine = (status: string) => say(locale)("mine.status." + status);

    it(`opens with the participant's own state words (${locale})`, () => {
      for (const status of ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED", "CONFIRMED", "CANCELLED", "EXPIRED"] as const) {
        const [first] = whatToTell(locale, facts({ status }), NOW);
        expect(first).toContain(stateLine(status));
      }
    });

    it(`a held place says the participant page's own «confirm by» sentence, the link and the spam hint (${locale})`, () => {
      const lines = whatToTell(locale, facts({ status: "PENDING_DECLARATION", holdExpiresAt: LATER, liveLinkExpiresAt: LATER }), NOW);
      expect(lines[1]).toBe(say(locale)("mine.confirmBy", { due: instant(locale, LATER) }));
      expect(lines).toContain(ours(locale, "linkUntil").replace("{instant}", instant(locale, LATER)));
      expect(lines.at(-1)).toBe(spam);
    });

    it(`past the hold's deadline, the place is still kept (${locale})`, () => {
      const lines = whatToTell(locale, facts({ status: "PENDING_DECLARATION", holdExpiresAt: EARLIER }), NOW);
      expect(lines[1]).toBe(ours(locale, "kept"));
      expect(lines).toContain(spam);
    });

    it(`an address not confirmed: the button in the email, or a family's reservation; nothing to look for once the link lapsed (${locale})`, () => {
      expect(whatToTell(locale, facts({ status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: LATER }), NOW)[1]).toBe(ours(locale, "PENDING_EMAIL_CONFIRMATION"));
      expect(whatToTell(locale, facts({ status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: LATER }), NOW)[1]).toBe(
        say(locale)("mine.reservedUntil", { until: instant(locale, LATER) }),
      );
      const lapsed = whatToTell(locale, facts({ status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: EARLIER }), NOW);
      expect(lapsed[1]).toBe(ours(locale, "linkLapsed"));
      expect(lapsed).not.toContain(spam);
    });

    it(`the waiting line is the participant page's own sentence, under each setting (${locale})`, () => {
      for (const [autoOffer, countPublic] of [
        [true, true],
        [false, true],
        [true, false],
      ] as const) {
        const lines = whatToTell(locale, facts({ status: "WAITLISTED", waitlistPosition: 3, waitlistLength: 10, waitlistAutoOffer: autoOffer, waitlistCountPublic: countPublic }), NOW);
        expect(lines[1]).toBe(waitlistStandingPhrase(say(locale), locale, { position: 3, length: 10, autoOffer, countPublic }));
        expect(lines[2]).toBe(ours(locale, "WAITLISTED"));
        expect(lines).not.toContain(spam);
      }
    });

    it(`an offer says its deadline, and once lapsed says so without the spam hint (${locale})`, () => {
      expect(whatToTell(locale, facts({ status: "WAITLIST_OFFERED", holdExpiresAt: LATER }), NOW)[1]).toBe(
        ours(locale, "offer").replace("{due}", instant(locale, LATER)),
      );
      // Still queued, the offer has not lapsed whatever its stored deadline (§520).
      expect(whatToTell(locale, facts({ status: "WAITLIST_OFFERED", holdExpiresAt: EARLIER, offerEmailQueued: true }), NOW)[1]).toContain(
        instant(locale, EARLIER),
      );
      const lapsed = whatToTell(locale, facts({ status: "WAITLIST_OFFERED", holdExpiresAt: EARLIER }), NOW);
      expect(lapsed[1]).toBe(ours(locale, "offerLapsed"));
      expect(lapsed).not.toContain(spam);
    });

    it(`a confirmed row says where the QR code is, its number and its check-in (${locale})`, () => {
      const lines = whatToTell(locale, facts({ status: "CONFIRMED", bibNumber: 42, checkedInAt: EARLIER }), NOW);
      expect(lines.slice(1)).toEqual([ours(locale, "CONFIRMED"), ours(locale, "bib").replace("{number}", "42"), ours(locale, "checkedIn")]);
    });

    it(`an ended row says it ended and offers no link (${locale})`, () => {
      expect(whatToTell(locale, facts({ status: "CANCELLED", liveLinkExpiresAt: LATER }), NOW).slice(1)).toEqual([ours(locale, "CANCELLED")]);
      expect(whatToTell(locale, facts({ status: "EXPIRED" }), NOW).slice(1)).toEqual([ours(locale, "EXPIRED")]);
    });

    it(`a cancelled event says only the cancellation, the participant page's words (${locale})`, () => {
      const lines = whatToTell(locale, facts({ status: "PENDING_DECLARATION", holdExpiresAt: LATER, liveLinkExpiresAt: LATER, eventCancelled: true }), NOW);
      expect(lines).toEqual([lines[0], say(locale)("manage.eventCancelled")]);
    });

    it(`every line stays under 200 characters (${locale})`, () => {
      const all = [
        facts({ status: "PENDING_DECLARATION", holdExpiresAt: LATER, liveLinkExpiresAt: LATER }),
        facts({ status: "WAITLISTED", waitlistPosition: 120, waitlistLength: 240, waitlistAutoOffer: false }),
        facts({ status: "CONFIRMED", bibNumber: 1234, checkedInAt: EARLIER, liveLinkExpiresAt: LATER }),
        facts({ status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: LATER, liveLinkExpiresAt: LATER }),
      ].flatMap((one) => whatToTell(locale, one, NOW));
      for (const line of all) expect(line.length, line).toBeLessThan(200);
    });
  }

  it("speaks the registration's language, not the reader's", () => {
    expect(whatToTell("en", facts({ status: "CONFIRMED" }), NOW)[0]).toBe("Your registration: Confirmed.");
    expect(whatToTell("ro", facts({ status: "CONFIRMED" }), NOW)[0]).toBe("Înscrierea ta: Confirmată.");
  });
});
