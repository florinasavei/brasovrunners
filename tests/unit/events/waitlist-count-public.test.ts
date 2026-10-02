import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { publicFill, registrationCta, type RegistrationCtaInput } from "@/modules/events/domain/registration-cta";
import { fillPhrase, fullThanksPhrase } from "@/modules/events/ui/counted-phrases";

/**
 * BR-REQ-035-01, BR-REQ-039-01 (§634) — «Arată public câți așteaptă». The owner, 2026-10-02: «Trebuie să
 * avem mare grijă să nu afișăm lista de așteptare și să nu le zicem oamenilor al câtelea sunt în listă»,
 * then «O să avem o bifă și dacă să afișăm sau nu câți sunt pe lista de așteptare».
 *
 * The pure half: the door withholds the people waiting from what it may say, without changing which door
 * it is; the places line drops their part; the full state's lead has a third shape with no number. On, or
 * absent, every value is today's. `registration-fill-render.test.ts` renders the same from a database.
 */
const START = new Date("2026-10-04T07:00:00Z");
const PUBLISHED = new Date("2026-09-01T10:00:00Z");
const DURING = new Date("2026-09-15T12:00:00Z");

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

function translator(locale: "ro" | "en") {
  return createTranslator({ locale, messages: locale === "ro" ? ro.Event : en.Event, namespace: undefined }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
}

describe("§634 registrationCta with the count kept private", () => {
  it("full: the same door, the room kept, the line's length said as null", () => {
    const full = event({ availablePlaces: 0, waitlistRoom: 4, waitlistCapacity: 10, waiting: 6, waitlisted: 6 });
    expect(registrationCta({ ...full, waitlistCountPublic: false }, DURING)).toEqual({ kind: "FULL", waitlistRoom: 4, waiting: null });
    expect(registrationCta(full, DURING)).toEqual({ kind: "FULL", waitlistRoom: 4, waiting: 6 });
    expect(registrationCta({ ...full, waitlistCountPublic: true }, DURING)).toEqual(registrationCta(full, DURING));
  });

  it("places given from the line: still the line's door, the offers kept, the people waiting said as nobody", () => {
    const open = event({ availablePlaces: 3, waitlistRoom: null, waitlistCapacity: null, waiting: 3, offered: 1, waitlisted: 2 });
    expect(registrationCta({ ...open, waitlistCountPublic: false }, DURING)).toEqual({
      kind: "OPEN",
      availablePlaces: 3,
      offered: 1,
      waitlisted: 0,
      fromWaitlist: true,
    });
    expect(registrationCta(open, DURING)).toEqual({ kind: "OPEN", availablePlaces: 3, offered: 1, waitlisted: 2, fromWaitlist: true });
  });

  it("decides nothing from the switch: the line full, or no line, refuses exactly as before", () => {
    const lineFull = event({ availablePlaces: 0, waitlistRoom: 0, waitlistCapacity: 3, waiting: 3, waitlisted: 3 });
    expect(registrationCta({ ...lineFull, waitlistCountPublic: false }, DURING)).toEqual({ kind: "WAITLIST_FULL" });
    const none = event({ availablePlaces: 0, waitlistRoom: 0, waitlistCapacity: 0 });
    expect(registrationCta({ ...none, waitlistCountPublic: false }, DURING)).toEqual({ kind: "FULL_NO_WAITLIST" });
  });
});

describe("§634 publicFill and the places line with the count kept private", () => {
  it("drops the people waiting, and the places kept for them while places are still free", () => {
    // Places free beside the line: kept is exactly the people waiting, so it goes with them.
    expect(publicFill(10, 4, { occupied: 4, confirmed: 4, waitlisted: 2, waitlistCountPublic: false })).toEqual({ taken: 4, capacity: 10, confirmed: 4 });
    expect(publicFill(10, 4, { occupied: 4, confirmed: 4, waitlisted: 2 })).toEqual({ taken: 4, capacity: 10, confirmed: 4, kept: 2, waitlisted: 2 });
    // No place free: kept is the free places the line claims, a fact about places — it stays.
    expect(publicFill(10, 0, { occupied: 6, confirmed: 6, waitlisted: 5, waitlistCountPublic: false })).toEqual({ taken: 6, capacity: 10, confirmed: 6, kept: 4 });
    // An entry from before the counts: the plain line either way.
    expect(publicFill(10, 0, { waitlisted: 5, waitlistCountPublic: false })).toEqual({ taken: 10, capacity: 10 });
  });

  it("says the places line without «N pe lista de așteptare», in both languages", () => {
    const off = publicFill(2, 0, { occupied: 2, confirmed: 2, waitlisted: 1, waitlistCountPublic: false });
    if (!off) throw new Error("capped");
    expect(fillPhrase(translator("ro"), "ro", off)).toBe("2 înscriși din 2 locuri");
    expect(fillPhrase(translator("en"), "en", off)).toBe("2 of 2 places taken");
    const on = publicFill(2, 0, { occupied: 2, confirmed: 2, waitlisted: 1 });
    if (!on) throw new Error("capped");
    expect(fillPhrase(translator("ro"), "ro", on)).toBe("2 înscriși din 2 locuri — 1 pe lista de așteptare");
  });
});

describe("§634 fullThanksPhrase without the line's length", () => {
  it("reads the three Romanian forms of the capacity, and English", () => {
    const say = translator("ro");
    expect(fullThanksPhrase(say, "ro", 1, null)).toBe("Mulțumim! Singurul loc s-a ocupat. Intră pe lista de așteptare.");
    expect(fullThanksPhrase(say, "ro", 10, null)).toBe("Mulțumim! Toate cele 10 locuri s-au ocupat. Intră pe lista de așteptare.");
    expect(fullThanksPhrase(say, "ro", 150, null)).toBe("Mulțumim! Toate cele 150 de locuri s-au ocupat. Intră pe lista de așteptare.");
    expect(fullThanksPhrase(translator("en"), "en", 150, null)).toBe("Thank you! All 150 places are taken. Join the waiting list.");
    expect(fullThanksPhrase(translator("en"), "en", 1, null)).toBe("Thank you! The one place is taken. Join the waiting list.");
  });

  it("leaves the two shapes with a count as they were", () => {
    const say = translator("ro");
    expect(fullThanksPhrase(say, "ro", 150, 10)).toBe("Mulțumim! Toate cele 150 de locuri s-au ocupat — 10 așteaptă deja un loc.");
    expect(fullThanksPhrase(say, "ro", 150, 0)).toBe("Mulțumim! Toate cele 150 de locuri s-au ocupat. Fii primul pe lista de așteptare.");
  });
});
