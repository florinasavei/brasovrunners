import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { publicFill, publicNumbersShown, registrationCta, type RegistrationCtaInput } from "@/modules/events/domain/registration-cta";
import type { PublicEvent } from "@/modules/events/repository";
import { cardRegistrationLine } from "@/modules/events/ui/CardRegistration";
import { fullThanksPhrase } from "@/modules/events/ui/counted-phrases";
import { hiddenListCounting } from "@/modules/registrations/domain/hidden-list";

/**
 * BR-REQ-034-01, BR-REQ-039-01 (§NNN, amending §648 point 8) — «Arată public numărătoarea» unticked hides
 * every public number of the event. The owner, 2026-10-06: «Am debifat "arată public câți așteaptă" dar
 * tot văd asta..», and his choice: hide all numbers — the page says only whether places are left or the
 * race is full, with no counts at all.
 *
 * The pure half: the one rule (`publicNumbersShown`), the door (`registrationCta`) and the places line
 * (`publicFill`) with the switch off — open with free places, full with and without a waiting list, the
 * waiting list full, places given from it, offered places — and the card's words built from them, none
 * carrying a digit of the capacity or of a count. Ticked, or absent, every value is today's.
 * `participant-count-public-render.test.ts` renders the same from a database.
 */
const START = new Date("2026-11-21T07:00:00Z");
const PUBLISHED = new Date("2026-09-01T10:00:00Z");
const DURING = new Date("2026-09-24T10:00:00Z");

function event(overrides: Partial<RegistrationCtaInput> = {}): RegistrationCtaInput {
  return {
    registrationMode: "INTERNAL",
    eventStatus: "SCHEDULED",
    startsAt: START,
    registrationOpensAt: null,
    registrationOpensSoon: false,
    registrationClosesAt: null,
    publishedAt: PUBLISHED,
    externalRegistrationUrl: null,
    externalProvider: null,
    availablePlaces: null,
    ...overrides,
  };
}

/** The card's own fields, with no closing date: the lead then carries no date's digits either. */
const CARD_EVENT = {
  slug: "cros",
  timezone: "Europe/Bucharest",
  registrationMode: "INTERNAL",
  eventStatus: "SCHEDULED",
  startsAt: START,
  registrationOpensAt: null,
  registrationClosesAt: null,
  publishedAt: PUBLISHED,
  externalRegistrationUrl: null,
  externalProvider: null,
} as unknown as PublicEvent;

function translator(locale: "ro" | "en") {
  return createTranslator({ locale, messages: locale === "ro" ? ro.Event : en.Event, namespace: undefined }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
}

/** The 21 November race the owner sent: 151 places, 141 confirmed, 10 in progress, 17 waiting. */
const COUNTS = { capacity: 151, occupied: 151, confirmed: 141 };

/** Every case the brief names, as the door's inputs (`readRegistrationDoor` would hand them). */
const CASES: Record<string, { input: Partial<RegistrationCtaInput>; capacity: number; occupied: number; confirmed: number }> = {
  "open with free places": { input: { availablePlaces: 9, waiting: 0, offered: 0, waitlisted: 0 }, capacity: 151, occupied: 142, confirmed: 131 },
  "open with an offer out, nobody waiting": { input: { availablePlaces: 9, waiting: 2, offered: 2, waitlisted: 0 }, capacity: 151, occupied: 142, confirmed: 131 },
  "full, the list taking people": {
    input: { availablePlaces: 0, waitlistRoom: 13, waitlistCapacity: 30, waiting: 17, waitlisted: 17 },
    ...COUNTS,
  },
  "full, the list unlimited": { input: { availablePlaces: 0, waitlistRoom: null, waitlistCapacity: null, waiting: 17, waitlisted: 17 }, ...COUNTS },
  "full, nobody waiting yet": { input: { availablePlaces: 0, waitlistRoom: null, waitlistCapacity: null, waiting: 0, waitlisted: 0 }, ...COUNTS },
  "full, the list full": { input: { availablePlaces: 0, waitlistRoom: 0, waitlistCapacity: 17, waiting: 17, waitlisted: 17 }, ...COUNTS },
  "full, no waiting list": { input: { availablePlaces: 0, waitlistRoom: 0, waitlistCapacity: 0 }, ...COUNTS },
  "places given from the waiting list, offers out": {
    input: { availablePlaces: 6, waitlistRoom: null, waitlistCapacity: null, waiting: 7, offered: 3, waitlisted: 4 },
    capacity: 151,
    occupied: 141,
    confirmed: 138,
  },
};

/** Every string the listing card would draw for a door. */
function cardStrings(locale: "ro" | "en", cta: ReturnType<typeof registrationCta>, fill: ReturnType<typeof publicFill>): string[] {
  const line = cardRegistrationLine(translator(locale), locale, CARD_EVENT, DURING, { kind: "KNOWN", cta, fill });
  return [line.lead, line.detail, line.note, line.roomLine, line.quietLine, line.button?.label].filter((part): part is string => typeof part === "string");
}

describe("§NNN publicNumbersShown — the one rule", () => {
  it("is on by default and for a row read without the column; off only for an explicit false", () => {
    expect(publicNumbersShown({ participantCountPublic: true })).toBe(true);
    expect(publicNumbersShown({})).toBe(true);
    expect(publicNumbersShown({ participantCountPublic: null })).toBe(true);
    expect(publicNumbersShown(null)).toBe(true);
    expect(publicNumbersShown(undefined)).toBe(true);
    expect(publicNumbersShown({ participantCountPublic: false })).toBe(false);
  });

  it("is the rule «Cine vine» reads too: its numbers and the places line go together", () => {
    expect(hiddenListCounting({ participantCountPublic: false }).countPublic).toBe(publicNumbersShown({ participantCountPublic: false }));
    expect(hiddenListCounting({ participantCountPublic: true }).countPublic).toBe(publicNumbersShown({ participantCountPublic: true }));
  });
});

describe("§NNN registrationCta with «Arată public numărătoarea» unticked", () => {
  it("open with free places: the register door, and no number — as an uncapped event", () => {
    const open = event(CASES["open with free places"].input);
    expect(registrationCta({ ...open, participantCountPublic: false }, DURING)).toEqual({ kind: "OPEN", availablePlaces: null, offered: 0, waitlisted: 0, fromWaitlist: false });
  });

  it("an offer out with nobody waiting: the register door, no offered count", () => {
    const open = event(CASES["open with an offer out, nobody waiting"].input);
    expect(registrationCta({ ...open, participantCountPublic: false }, DURING)).toEqual({ kind: "OPEN", availablePlaces: null, offered: 0, waitlisted: 0, fromWaitlist: false });
  });

  it("places given from the waiting list: still the line's door, with no number of places, offers or people", () => {
    const open = event(CASES["places given from the waiting list, offers out"].input);
    expect(registrationCta({ ...open, participantCountPublic: false }, DURING)).toEqual({ kind: "OPEN", availablePlaces: null, offered: 0, waitlisted: 0, fromWaitlist: true });
  });

  it("full: the waiting list's door, no room and no line's length — whatever «Arată public câți așteaptă» says", () => {
    const full = event(CASES["full, the list taking people"].input);
    expect(registrationCta({ ...full, participantCountPublic: false }, DURING)).toEqual({ kind: "FULL", waitlistRoom: null, waiting: null });
    expect(registrationCta({ ...full, participantCountPublic: false, waitlistCountPublic: true }, DURING)).toEqual({ kind: "FULL", waitlistRoom: null, waiting: null });
  });

  it("decides nothing: the list full, or no list, refuses exactly as before", () => {
    expect(registrationCta({ ...event(CASES["full, the list full"].input), participantCountPublic: false }, DURING)).toEqual({ kind: "WAITLIST_FULL" });
    expect(registrationCta({ ...event(CASES["full, no waiting list"].input), participantCountPublic: false }, DURING)).toEqual({ kind: "FULL_NO_WAITLIST" });
  });

  it("ticked, or absent, every door is today's", () => {
    for (const [name, { input }] of Object.entries(CASES)) {
      const today = registrationCta(event(input), DURING);
      expect(registrationCta({ ...event(input), participantCountPublic: true }, DURING), name).toEqual(today);
    }
    expect(registrationCta(event(CASES["full, the list taking people"].input), DURING)).toEqual({ kind: "FULL", waitlistRoom: 13, waiting: 17 });
    expect(registrationCta(event(CASES["open with free places"].input), DURING)).toEqual({ kind: "OPEN", availablePlaces: 9, offered: 0, waitlisted: 0, fromWaitlist: false });
  });
});

describe("§NNN publicFill with «Arată public numărătoarea» unticked", () => {
  it("is null: no places line at all", () => {
    expect(publicFill(151, 0, { occupied: 151, confirmed: 141, waitlisted: 17, participantCountPublic: false })).toBeNull();
    expect(publicFill(151, 9, { occupied: 142, confirmed: 131, participantCountPublic: false })).toBeNull();
    // An entry from before the counts: still none.
    expect(publicFill(151, 0, { participantCountPublic: false })).toBeNull();
  });

  it("ticked, or absent, is today's line", () => {
    const today = publicFill(151, 0, { occupied: 151, confirmed: 141, waitlisted: 17 });
    expect(today).toEqual({ taken: 151, capacity: 151, confirmed: 141, waitlisted: 17 });
    expect(publicFill(151, 0, { occupied: 151, confirmed: 141, waitlisted: 17, participantCountPublic: true })).toEqual(today);
  });
});

describe("§NNN the words drawn from an unticked door carry no number", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`says no digit of the capacity or of any count, in every case (${locale})`, () => {
      for (const [name, c] of Object.entries(CASES)) {
        const off = { participantCountPublic: false };
        const cta = registrationCta({ ...event(c.input), ...off }, DURING);
        const fill = publicFill(c.capacity, c.input.availablePlaces ?? null, { occupied: c.occupied, confirmed: c.confirmed, waitlisted: c.input.waitlisted, ...off });
        expect(fill, name).toBeNull();
        const strings = cardStrings(locale, cta, fill);
        expect(strings.length, name).toBeGreaterThan(0);
        // The window's closing instant («până sâm., 21 nov. 2026, la 09:00») is a date, not a count: cut off.
        for (const text of strings) expect(text.replace(/ (până|until) .*$/, ""), `${locale} ${name}`).not.toMatch(/\d/);
      }
    });
  }

  it("the full lead names no capacity: «Mulțumim! Toate locurile s-au ocupat. Intră pe lista de așteptare.»", () => {
    expect(fullThanksPhrase(translator("ro"), "ro", null, null)).toBe("Mulțumim! Toate locurile s-au ocupat. Intră pe lista de așteptare.");
    expect(fullThanksPhrase(translator("en"), "en", null, null)).toBe("Thank you! All places are taken. Join the waiting list.");
    // No capacity means no count of the line either, whatever arrives.
    expect(fullThanksPhrase(translator("ro"), "ro", null, 17)).toBe("Mulțumim! Toate locurile s-au ocupat. Intră pe lista de așteptare.");
    expect(ro.Event.cta.fullThanksPlain.length).toBeLessThanOrEqual(200);
    expect(en.Event.cta.fullThanksPlain.length).toBeLessThanOrEqual(200);
  });

  it("the state words stay: the register door, the line's door, «Locurile se dau din lista de așteptare», full, the list full, no list", () => {
    const say = (locale: "ro" | "en", name: string) => {
      const c = CASES[name];
      return cardStrings(locale, registrationCta({ ...event(c.input), participantCountPublic: false }, DURING), null);
    };
    expect(say("ro", "open with free places")).toContain("Înscrie-te la eveniment");
    expect(say("ro", "places given from the waiting list, offers out")).toEqual(
      expect.arrayContaining(["Locurile se dau din lista de așteptare", "Intră pe lista de așteptare"]),
    );
    expect(say("ro", "full, the list taking people")).toEqual(
      expect.arrayContaining(["Mulțumim! Toate locurile s-au ocupat. Intră pe lista de așteptare.", ro.Event.cta.fullJoin, "Intră pe lista de așteptare"]),
    );
    expect(say("ro", "full, the list full")).toContain(ro.Event.cta.waitlistFull);
    expect(say("en", "full, no waiting list")).toContain(en.Event.cta.fullNoWaitlist);
  });

  it("ticked, the card says the same numbers as today", () => {
    const c = CASES["full, the list taking people"];
    const cta = registrationCta(event(c.input), DURING);
    const fill = publicFill(c.capacity, 0, { occupied: c.occupied, confirmed: c.confirmed, waitlisted: c.input.waitlisted });
    expect(cardStrings("ro", cta, fill)).toEqual(
      expect.arrayContaining(["Mulțumim! Toate cele 151 de locuri s-au ocupat — 17 așteaptă deja un loc.", "Mai sunt 13 locuri pe lista de așteptare"]),
    );
  });
});
