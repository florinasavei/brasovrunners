import { describe, expect, it } from "vitest";
import { newcomerWouldQueue, offersByItself, offersOnlyShut, registrationCta, type RegistrationCtaInput } from "@/modules/events/domain/registration-cta";
import { emailSampleFor, placeholdersFilledBy } from "@/modules/notifications/email-copy-fields";
import { placesAlertSentOf, placesAlertStep } from "@/modules/registrations/domain/places-alert";
import { publicDoorOpen } from "@/modules/registrations/domain/public-door";
import { publicNow, publicNowSetting } from "@/modules/registrations/domain/public-now";
import { newcomerJoinsLine, offersOnItsOwn, publicEntryQueues } from "@/modules/registrations/domain/waitlist";

/**
 * The Administrator's control over the site's door (§NNN), the pure halves: who a free place is for, the door the
 * public card draws, «Pe site acum» read off that same door, and the places alert's crossings.
 */
const NOW = new Date("2026-11-03T10:00:00.000Z");

function open(over: Partial<RegistrationCtaInput> = {}): RegistrationCtaInput {
  return {
    registrationMode: "INTERNAL",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-11-21T07:00:00.000Z"),
    registrationOpensAt: null,
    registrationOpensSoon: false,
    registrationClosesAt: null,
    publishedAt: new Date("2026-10-01T00:00:00.000Z"),
    externalRegistrationUrl: null,
    externalProvider: null,
    availablePlaces: 5,
    waitlistRoom: null,
    waitlistCapacity: null,
    waiting: 0,
    offered: 0,
    waitlisted: 0,
    ...over,
  };
}

describe("who a free place is for (§NNN)", () => {
  it("a public entry under «Locurile libere le dau doar eu» joins the line; a staff entry never does for it", () => {
    expect(publicEntryQueues({ freePlacesByOfferOnly: true, channel: "public" })).toBe(true);
    expect(publicEntryQueues({ freePlacesByOfferOnly: true, channel: "staff" })).toBe(false);
    expect(publicEntryQueues({ freePlacesByOfferOnly: false, channel: "public" })).toBe(false);
    // Absent is off and absent is the staff's: no caller is narrowed by forgetting to say.
    expect(publicEntryQueues({})).toBe(false);
    expect(newcomerJoinsLine({ waitlisted: 0, freePlacesByOfferOnly: true, channel: "public" })).toBe(true);
    expect(newcomerJoinsLine({ waitlisted: 0, freePlacesByOfferOnly: true, channel: "staff" })).toBe(false);
    // Somebody waiting still sends everybody to the line (§615).
    expect(newcomerJoinsLine({ waitlisted: 1, channel: "staff" })).toBe(true);
  });

  it("only where places are counted: on an uncapped event the tick sends nobody to the line", () => {
    expect(publicEntryQueues({ freePlacesByOfferOnly: true, channel: "public", capacity: null })).toBe(false);
    expect(publicEntryQueues({ freePlacesByOfferOnly: true, channel: "public", capacity: 10 })).toBe(true);
    expect(newcomerJoinsLine({ waitlisted: 0, freePlacesByOfferOnly: true, channel: "public", capacity: null })).toBe(false);
    expect(newcomerJoinsLine({ waitlisted: 0, freePlacesByOfferOnly: true, channel: "public", capacity: 10 })).toBe(true);
  });

  it("the tick wins over «Da»: no place goes out by itself while the free places are the staff's to give", () => {
    expect(offersOnItsOwn({ waitlistAutoOffer: true, freePlacesByOfferOnly: false, capacity: 10 })).toBe(true);
    expect(offersOnItsOwn({ waitlistAutoOffer: true, freePlacesByOfferOnly: true, capacity: 10 })).toBe(false);
    expect(offersOnItsOwn({ waitlistAutoOffer: false, freePlacesByOfferOnly: false, capacity: 10 })).toBe(false);
    // Uncapped, the tick means nothing: a cap lifted while people wait offers them the places as «Da» says (§147).
    expect(offersOnItsOwn({ waitlistAutoOffer: true, freePlacesByOfferOnly: true, capacity: null })).toBe(true);
  });

  it("the public door is open unless the row says false", () => {
    expect(publicDoorOpen({ publicRegistrationOpen: false })).toBe(false);
    expect(publicDoorOpen({ publicRegistrationOpen: true })).toBe(true);
    expect(publicDoorOpen({})).toBe(true);
    expect(publicDoorOpen(null)).toBe(true);
  });
});

describe("the public card's door (§NNN)", () => {
  it("«Înscrieri publice deschise» off shuts an open window, and only an open one", () => {
    expect(registrationCta(open({ publicRegistrationOpen: false }), NOW)).toEqual({ kind: "PAUSED", reason: "SWITCH" });
    // Before the window or after it, the dates speak.
    expect(registrationCta(open({ publicRegistrationOpen: false, registrationClosesAt: new Date("2026-11-01T00:00:00Z") }), NOW).kind).toBe("CLOSED");
  });

  it("«Locurile libere le dau doar eu» draws the waiting list's door beside free places, never «Înscrie-te»", () => {
    expect(registrationCta(open({ freePlacesByOfferOnly: true }), NOW)).toMatchObject({ kind: "OPEN", fromWaitlist: true });
    expect(registrationCta(open(), NOW)).toMatchObject({ kind: "OPEN", fromWaitlist: false });
    expect(newcomerWouldQueue({ availablePlaces: 5, freePlacesByOfferOnly: true })).toBe(true);
    expect(newcomerWouldQueue({ availablePlaces: 5 })).toBe(false);
  });

  it("an uncapped event ignores the tick: nothing is scarce, so the button stays «Înscrie-te»", () => {
    expect(registrationCta(open({ availablePlaces: null, freePlacesByOfferOnly: true }), NOW)).toMatchObject({ kind: "OPEN", fromWaitlist: false });
    expect(newcomerWouldQueue({ availablePlaces: null, freePlacesByOfferOnly: true })).toBe(false);
    expect(registrationCta(open({ availablePlaces: null, freePlacesByOfferOnly: true, waitlistCapacity: 0 }), NOW)).toMatchObject({ kind: "OPEN" });
  });

  it("free places the organizers' alone with a line that takes nobody: shut in its own words, not «full»", () => {
    expect(registrationCta(open({ freePlacesByOfferOnly: true, waitlistCapacity: 0 }), NOW)).toEqual({ kind: "PAUSED", reason: "OFFERS_ONLY" });
    expect(registrationCta(open({ freePlacesByOfferOnly: true, waitlistCapacity: 3, waitlistRoom: 0, waitlisted: 3, waiting: 3 }), NOW)).toEqual({ kind: "PAUSED", reason: "OFFERS_ONLY" });
    // With no free place it is the ordinary full race.
    expect(registrationCta(open({ freePlacesByOfferOnly: true, availablePlaces: 0, waitlistCapacity: 0 }), NOW)).toEqual({ kind: "FULL_NO_WAITLIST" });
  });

  it("the register page asks the door's own predicate for that shut door", () => {
    expect(offersOnlyShut({ availablePlaces: 2, freePlacesByOfferOnly: true, waitlistCapacity: 0 })).toBe(true);
    expect(offersOnlyShut({ availablePlaces: 2, freePlacesByOfferOnly: true, waitlistCapacity: 5, waitlistRoom: 0 })).toBe(true);
    expect(offersOnlyShut({ availablePlaces: 2, freePlacesByOfferOnly: true, waitlistCapacity: 5, waitlistRoom: 1 })).toBe(false);
    expect(offersOnlyShut({ availablePlaces: 0, freePlacesByOfferOnly: true, waitlistCapacity: 0 })).toBe(false);
    expect(offersOnlyShut({ availablePlaces: null, freePlacesByOfferOnly: true, waitlistCapacity: 0 })).toBe(false);
    expect(offersOnlyShut({ availablePlaces: 2, waitlistCapacity: 0 })).toBe(false);
  });

  it("what the door and the join form say of an offer follows the allocator's own gate: «Da» and the tick off", () => {
    // «Da», the tick off: a place reaches the line by itself — «Când se eliberează un loc, primești un email…».
    expect(offersByItself({ waitlistAutoOffer: true, freePlacesByOfferOnly: false }, 0)).toBe(true);
    // A copy cached before the setting reads as «Da», the column's default.
    expect(offersByItself({}, 0)).toBe(true);
    // «Nu», or the tick (whatever «Da» says): the organizers give every place — their words.
    expect(offersByItself({ waitlistAutoOffer: false }, 0)).toBe(false);
    expect(offersByItself({ waitlistAutoOffer: true, freePlacesByOfferOnly: true }, 0)).toBe(false);
    expect(offersByItself({ waitlistAutoOffer: true, freePlacesByOfferOnly: true }, 3)).toBe(false);
    // The allocator's own statement of it, where places are counted.
    for (const event of [{ waitlistAutoOffer: true, freePlacesByOfferOnly: false }, { waitlistAutoOffer: false, freePlacesByOfferOnly: false }, { waitlistAutoOffer: true, freePlacesByOfferOnly: true }]) {
      expect(offersByItself(event, 2)).toBe(offersOnItsOwn({ ...event, capacity: 10 }));
    }
    // On an uncapped event the tick means nothing, as for the allocator.
    expect(offersByItself({ waitlistAutoOffer: true, freePlacesByOfferOnly: true }, null)).toBe(true);
  });
});

describe("«Pe site acum» (§NNN)", () => {
  const line = { waiting: 4, waitlistCapacity: 20 };

  it("reads the card's door: the button, the line with its numbers, or closed and why", () => {
    expect(publicNow(registrationCta(open(), NOW), line)).toEqual({ kind: "DIRECT" });
    expect(publicNow(registrationCta(open({ freePlacesByOfferOnly: true }), NOW), line)).toEqual({ kind: "WAITLIST", waiting: 4, limit: 20 });
    expect(publicNow(registrationCta(open({ availablePlaces: 0 }), NOW), { waiting: 2, waitlistCapacity: null })).toEqual({ kind: "WAITLIST", waiting: 2, limit: null });
    expect(publicNow(registrationCta(open({ publicRegistrationOpen: false }), NOW), line)).toEqual({ kind: "CLOSED", reason: "SWITCH" });
    expect(publicNow(registrationCta(open({ freePlacesByOfferOnly: true, waitlistCapacity: 0 }), NOW), line)).toEqual({ kind: "CLOSED", reason: "OFFERS_ONLY" });
    expect(publicNow(registrationCta(open({ availablePlaces: 0, waitlistCapacity: 0 }), NOW), line)).toEqual({ kind: "CLOSED", reason: "NO_WAITLIST" });
    expect(publicNow(registrationCta(open({ availablePlaces: 0, waitlistCapacity: 5, waitlistRoom: 0 }), NOW), line)).toEqual({ kind: "CLOSED", reason: "WAITLIST_FULL" });
    expect(publicNow(registrationCta(open({ registrationClosesAt: new Date("2026-11-01T00:00:00Z") }), NOW), line)).toEqual({ kind: "CLOSED", reason: "WINDOW_CLOSED" });
    expect(publicNow(registrationCta(open({ registrationOpensAt: new Date("2026-11-10T00:00:00Z") }), NOW), line)).toEqual({ kind: "CLOSED", reason: "NOT_YET_OPEN" });
    expect(publicNow(registrationCta(open({ eventStatus: "CANCELLED" }), NOW), line)).toEqual({ kind: "CLOSED", reason: "CANCELLED" });
    expect(publicNow(registrationCta(open({ registrationMode: "NONE" }), NOW), line)).toEqual({ kind: "CLOSED", reason: "NOT_HERE" });
  });

  it("links to the fold that changes it", () => {
    expect(publicNowSetting({ kind: "CLOSED", reason: "SWITCH" })).toBe("box-registration-window");
    expect(publicNowSetting({ kind: "CLOSED", reason: "WINDOW_CLOSED" })).toBe("box-registration-window");
    expect(publicNowSetting({ kind: "CLOSED", reason: "OFFERS_ONLY" })).toBe("box-places-control");
    expect(publicNowSetting({ kind: "WAITLIST", waiting: 0, limit: null })).toBe("box-places-control");
    expect(publicNowSetting({ kind: "DIRECT" })).toBe("box-places-control");
    expect(publicNowSetting({ kind: "CLOSED", reason: "CANCELLED" })).toBe("box-registration");
  });
});

describe("«Anunță-mă când rămân N locuri»: the crossings (§NNN)", () => {
  it("emails once on the way down to N, once at 0, and nothing in between", () => {
    expect(placesAlertStep({ alertAt: 3, free: 5, sent: null })).toEqual({ send: null, sent: null });
    expect(placesAlertStep({ alertAt: 3, free: 3, sent: null })).toEqual({ send: "LOW", sent: "LOW" });
    expect(placesAlertStep({ alertAt: 3, free: 2, sent: "LOW" })).toEqual({ send: null, sent: "LOW" });
    expect(placesAlertStep({ alertAt: 3, free: 0, sent: "LOW" })).toEqual({ send: "FULL", sent: "FULL" });
    expect(placesAlertStep({ alertAt: 3, free: 0, sent: "FULL" })).toEqual({ send: null, sent: "FULL" });
  });

  it("a drop straight to 0 says «full» alone; a place freed under N re-arms nothing", () => {
    expect(placesAlertStep({ alertAt: 3, free: 0, sent: null })).toEqual({ send: "FULL", sent: "FULL" });
    expect(placesAlertStep({ alertAt: 3, free: 1, sent: "FULL" })).toEqual({ send: null, sent: "FULL" });
  });

  it("re-arms above N, and the setting off forgets the last crossing", () => {
    expect(placesAlertStep({ alertAt: 3, free: 4, sent: "FULL" })).toEqual({ send: null, sent: null });
    expect(placesAlertStep({ alertAt: null, free: 0, sent: "FULL" })).toEqual({ send: null, sent: null });
    // N = 0: only the «full» email.
    expect(placesAlertStep({ alertAt: 0, free: 1, sent: null })).toEqual({ send: null, sent: null });
    expect(placesAlertStep({ alertAt: 0, free: 0, sent: null })).toEqual({ send: "FULL", sent: "FULL" });
  });

  it("reads the column's text back, anything else as nothing sent", () => {
    expect(placesAlertSentOf("LOW")).toBe("LOW");
    expect(placesAlertSentOf("FULL")).toBe("FULL");
    expect(placesAlertSentOf(null)).toBeNull();
    expect(placesAlertSentOf("other")).toBeNull();
  });

  it("its email names the colleague and the event, never a registration's status: the club's text legend and preview say so", () => {
    const filled = placeholdersFilledBy("PLACES_ALERT");
    expect(filled).toContain("participantName");
    expect(filled).toContain("eventTitle");
    expect(filled).not.toContain("currentStatus");
    for (const locale of ["ro", "en"] as const) expect(emailSampleFor("PLACES_ALERT", locale).currentStatus).toBeUndefined();
  });
});
