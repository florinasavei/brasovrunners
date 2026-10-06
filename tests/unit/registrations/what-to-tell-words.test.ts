import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { formatDay } from "@/i18n/dates";
import { formatDeadlineInSentence } from "@/modules/notifications/domain/deadline-in-sentence";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";
import { confirmationDueMoment } from "@/modules/registrations/domain/hold-deadlines";
import { whatToTell, type TellFacts } from "@/modules/registrations/ui/tell-words";
import { waitlistStandingPhrase } from "@/modules/registrations/ui/waitlist-position-words";

/**
 * BR-REQ-037-01 (§654) — «Ce îi spui»: the sentences a staff member tells somebody who asks where
 * their registration stands, in the registration's language, from the real catalogues.
 *
 * What it holds: every open state says the participant's own state words first, a confirmed row the
 * confirmation page's sentence, a cancelled or expired row its own sentence — each state once; the deadline, the reservation and the waiting line are the
 * participant's page's own sentences (the same keys and the same `waitlistStandingPhrase`), not a copy;
 * the spam hint only where an email link is the next step; a cancelled event says only the
 * cancellation; the live link's expiry only where it adds an instant the block has not given — never on
 * a held place; and every line stays under 200 characters (§511) in both languages.
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
const START = new Date("2026-11-21T08:00:00.000Z");
/** An offer's deadline as the offer email writes `holdExpiresAtFormatted` (`render.ts`): the same two helpers. */
const offerDue = (locale: "ro" | "en", at: Date) => confirmationDueMoment(locale, { at, startsAt: START }, formatDeadlineInSentence(at, ZONE, locale));

function facts(overrides: Partial<TellFacts>): TellFacts {
  return {
    status: "CONFIRMED",
    holdExpiresAt: null,
    emailLinkExpiresAt: null,
    offerEmailQueued: false,
    eventStartsAt: START,
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

describe("§654 whatToTell — what to tell a person who asks where their registration stands", () => {
  for (const locale of ["ro", "en"] as const) {
    const spam = say(locale)("spamHint.body");
    const stateLine = (status: string) => say(locale)("mine.status." + status);

    it(`opens with the participant's own state words (${locale})`, () => {
      for (const status of ["PENDING_EMAIL_CONFIRMATION", "PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED"] as const) {
        const [first] = whatToTell(locale, facts({ status }), NOW);
        expect(first).toContain(stateLine(status));
      }
    });

    it(`a held place says the participant page's own «confirm by» sentence and the spam hint — not the declaration link's later expiry (${locale})`, () => {
      // `render.ts` mints the declaration's link until the race's start, later than the hold: the hold is the deadline to tell.
      const start = new Date("2026-11-21T08:00:00.000Z");
      const lines = whatToTell(locale, facts({ status: "PENDING_DECLARATION", holdExpiresAt: LATER, liveLinkExpiresAt: start }), NOW);
      expect(lines.slice(1)).toEqual([say(locale)("mine.confirmBy", { due: instant(locale, LATER) }), spam]);
      expect(lines.join(" ")).not.toContain(instant(locale, start));
    });

    it(`past the hold's deadline, the place is still kept, and the link's expiry is not said (${locale})`, () => {
      const lines = whatToTell(locale, facts({ status: "PENDING_DECLARATION", holdExpiresAt: EARLIER, liveLinkExpiresAt: LATER }), NOW);
      expect(lines.slice(1)).toEqual([ours(locale, "kept"), spam]);
    });

    it(`an address's link says its expiry once, and a family's reservation adds it only when it is another instant (${locale})`, () => {
      const linkLine = ours(locale, "linkUntil").replace("{instant}", instant(locale, LATER));
      const own = whatToTell(locale, facts({ status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: LATER, liveLinkExpiresAt: LATER }), NOW);
      expect(own.slice(1)).toEqual([ours(locale, "PENDING_EMAIL_CONFIRMATION"), linkLine, spam]);
      const reserved = new Date("2026-10-04T09:00:00.000Z");
      const family = whatToTell(locale, facts({ status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: reserved, liveLinkExpiresAt: LATER }), NOW);
      expect(family.slice(1)).toEqual([say(locale)("mine.reservedUntil", { until: instant(locale, reserved) }), linkLine, spam]);
      const same = whatToTell(locale, facts({ status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: LATER, liveLinkExpiresAt: LATER }), NOW);
      expect(same.slice(1)).toEqual([say(locale)("mine.reservedUntil", { until: instant(locale, LATER) }), spam]);
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

    it(`§NNN the waiting line keeps the count private with «Arată public numărătoarea» unticked (${locale})`, () => {
      const lines = whatToTell(
        locale,
        facts({ status: "WAITLISTED", waitlistPosition: 3, waitlistLength: 10, waitlistAutoOffer: true, waitlistCountPublic: true, participantCountPublic: false }),
        NOW,
      );
      expect(lines[1]).toBe(waitlistStandingPhrase(say(locale), locale, { position: 3, length: 10, autoOffer: true, countPublic: false }));
    });

    it(`an offer says its deadline once, and once lapsed says so without the spam hint (${locale})`, () => {
      // The offer's link lapses with the offer: its expiry is the instant already said, so not again.
      expect(whatToTell(locale, facts({ status: "WAITLIST_OFFERED", holdExpiresAt: LATER, liveLinkExpiresAt: LATER }), NOW).slice(1)).toEqual([
        ours(locale, "offer").replace("{due}", offerDue(locale, LATER)),
        spam,
      ]);
      // An offer capped at the start says «la start, …», as its email does.
      expect(whatToTell(locale, facts({ status: "WAITLIST_OFFERED", holdExpiresAt: START, liveLinkExpiresAt: START }), NOW)[1]).toBe(
        ours(locale, "offer").replace("{due}", `${locale === "ro" ? "la start" : "the start"}, ${formatDeadlineInSentence(START, ZONE, locale)}`),
      );
      // Still queued, the offer has not lapsed whatever its stored deadline (§520) — and the send re-bases
      // that deadline, so the block says the email is on its way, no instant, and no spam hint yet.
      for (const stored of [EARLIER, LATER]) {
        const queued = whatToTell(locale, facts({ status: "WAITLIST_OFFERED", holdExpiresAt: stored, offerEmailQueued: true, liveLinkExpiresAt: LATER }), NOW);
        expect(queued.slice(1)).toEqual([ours(locale, "offerQueued")]);
        expect(queued.join(" ")).not.toContain(instant(locale, stored));
      }
      const lapsed = whatToTell(locale, facts({ status: "WAITLIST_OFFERED", holdExpiresAt: EARLIER }), NOW);
      expect(lapsed[1]).toBe(ours(locale, "offerLapsed"));
      expect(lapsed).not.toContain(spam);
    });

    it(`a lapsed offer whose resend minted a live link says no link line (${locale})`, () => {
      // A WAITLIST_SPOT_OFFER resend after the deadline mints the link for the default lifetime; until the
      // sweep expires the row, «the place is no longer held» must not be followed by «valid until …».
      const lines = whatToTell(locale, facts({ status: "WAITLIST_OFFERED", holdExpiresAt: EARLIER, liveLinkExpiresAt: LATER }), NOW);
      expect(lines.slice(1)).toEqual([ours(locale, "offerLapsed")]);
      expect(lines.join(" ")).not.toContain(instant(locale, LATER));
    });

    it(`a confirmed row says it is confirmed once, where the QR code is, its number and its check-in (${locale})`, () => {
      const lines = whatToTell(locale, facts({ status: "CONFIRMED", bibNumber: 42, checkedInAt: EARLIER }), NOW);
      expect(lines).toEqual([
        `${say(locale)("spent.CONFIRMED.title")}.`,
        ours(locale, "CONFIRMED"),
        ours(locale, "bib").replace("{number}", "42"),
        say(locale)("manage.selfCheckInDone"),
      ]);
      expect(lines.join(" ")).not.toContain(stateLine("CONFIRMED"));
    });

    it(`an ended row says it ended, once, and offers no link (${locale})`, () => {
      expect(whatToTell(locale, facts({ status: "CANCELLED", liveLinkExpiresAt: LATER }), NOW)).toEqual([ours(locale, "CANCELLED")]);
      expect(whatToTell(locale, facts({ status: "EXPIRED" }), NOW)).toEqual([ours(locale, "EXPIRED")]);
      expect(whatToTell(locale, facts({ status: "EXPIRED", expiryReason: "WAITLIST_OFFER_LAPSED" }), NOW)).toEqual([ours(locale, "EXPIRED")]);
      // A lapsed declaration hold: what its email told the person (§638).
      expect(whatToTell(locale, facts({ status: "EXPIRED", expiryReason: "DECLARATION_HOLD_LAPSED" }), NOW)).toEqual([ours(locale, "holdLapsed")]);
    });

    it(`a cancelled or expired row says its state once, never framed as «Înscrierea ta: …» (${locale})`, () => {
      for (const [status, expiryReason] of [
        ["CANCELLED", null],
        ["EXPIRED", null],
        ["EXPIRED", "DECLARATION_HOLD_LAPSED"],
      ] as const) {
        const lines = whatToTell(locale, facts({ status, expiryReason }), NOW);
        expect(lines.join(" "), `${status} ${expiryReason}`).not.toContain(stateLine(status));
        expect(lines, `${status} ${expiryReason}`).toHaveLength(1);
      }
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
        facts({ status: "WAITLIST_OFFERED", holdExpiresAt: LATER, offerEmailQueued: true }),
        facts({ status: "EXPIRED", expiryReason: "DECLARATION_HOLD_LAPSED" }),
        facts({ status: "CANCELLED" }),
      ].flatMap((one) => whatToTell(locale, one, NOW));
      for (const line of all) expect(line.length, line).toBeLessThan(200);
    });
  }

  /*
    One story (§654): where a public page or an email already says it, the backoffice's line is that text
    word for word, so the volunteer never tells what the person did not read.
  */
  for (const locale of ["ro", "en"] as const) {
    it(`a cancelled row says the participant page's own words (${locale})`, () => {
      const mine = catalogues[locale].Registrations.mine;
      const firstSentence = mine.cancelled.slice(0, mine.cancelled.indexOf(".") + 1);
      expect(ours(locale, "CANCELLED")).toBe(`${mine.cancelledTitle}. ${firstSentence}`);
    });

    const email = (messageType: string, data: Partial<TemplateData>) =>
      buildOutgoingEmail({ to: "runner@example.org", locale, idempotencyKey: `tell-${messageType}`, messageType: messageType as never, data: data as TemplateData });
    const plain = (text: string) => text.replace(/\*\*/g, "");

    it(`an address to confirm says the address email's first line (${locale})`, () => {
      expect(plain(email("VERIFY_REGISTRATION_EMAIL", { eventTitle: "Crosul", participantName: "Ana" }).text)).toContain(ours(locale, "PENDING_EMAIL_CONFIRMATION"));
    });

    it(`a waiting row says the waiting-list email's own sentence (${locale})`, () => {
      expect(plain(email("WAITLIST_JOINED", { eventTitle: "Crosul" }).text)).toContain(ours(locale, "WAITLISTED"));
    });

    it(`an offer says the offer email's subject and its sentence up to the deadline (${locale})`, () => {
      // {due} built through the helpers `render.ts` fills `holdExpiresAtFormatted` with, and the block's own
      // line compared, so a drift between the two fails here — a plain deadline and one capped at the start.
      for (const at of [LATER, START]) {
        const sent = email("WAITLIST_SPOT_OFFER", { eventTitle: "Crosul", holdExpiresAtFormatted: offerDue(locale, at), offerHours: "24 de ore" });
        const said = whatToTell(locale, facts({ status: "WAITLIST_OFFERED", holdExpiresAt: at }), NOW)[1];
        const [subject, rest] = said.split(/(?<=\.) /);
        expect(sent.subject).toContain(subject.replace(/\.$/, ""));
        expect(plain(sent.text)).toContain(rest.replace(/\.$/, ""));
      }
    });

    it(`the race number is the confirmation email's own sentence (${locale})`, () => {
      expect(plain(email("REGISTRATION_CONFIRMED", { eventTitle: "Crosul", bibNumber: 42 }).text)).toContain(ours(locale, "bib").replace("{number}", "42"));
    });

    it(`a confirmed row opens with the confirmation's own sentence, the public page's and the email's (${locale})`, () => {
      const title = catalogues[locale].Registrations.spent.CONFIRMED.title;
      expect(whatToTell(locale, facts({ status: "CONFIRMED" }), NOW)[0]).toBe(`${title}.`);
      expect(email("REGISTRATION_CONFIRMED", { eventTitle: "Crosul" }).subject.toLowerCase()).toContain(title.toLowerCase().replace(/^(înscrierea ta|your registration) /, ""));
    });

    it(`a lapsed declaration hold says what its email said, without the event's name (${locale})`, () => {
      const title = "Crosul";
      const email = buildOutgoingEmail({
        to: "runner@example.org",
        locale,
        idempotencyKey: "tell-hold-lapsed",
        messageType: "DECLARATION_HOLD_EXPIRED",
        data: { eventTitle: title } as TemplateData,
      });
      const sentence = ours(locale, "holdLapsed");
      const inEmail = sentence.replace(locale === "ro" ? "Locul tău " : "Your place ", locale === "ro" ? `Locul tău la ${title} ` : `Your place at ${title} `);
      expect(email.text.replace(/\*\*/g, "")).toContain(inEmail);
    });
  }

  it("speaks the registration's language, not the reader's", () => {
    expect(whatToTell("en", facts({ status: "CONFIRMED" }), NOW)[0]).toBe("Your registration is confirmed.");
    expect(whatToTell("ro", facts({ status: "CONFIRMED" }), NOW)[0]).toBe("Înscrierea ta este confirmată.");
  });
});
