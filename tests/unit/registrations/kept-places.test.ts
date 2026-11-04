import { describe, expect, it } from "vitest";
import { capacityBelowTakenRefusalOf, CapacityBelowTakenError, wantedLapsedHoldReleases } from "@/modules/registrations/domain/capacity";
import { invitationFreePlaces, invitationRaises } from "@/modules/registrations/domain/invitations";
import {
  announcedCapacity,
  assertPlacesKeptWithin,
  capacityForEntry,
  freeSplit,
  keptOf,
  keptPlacesInUse,
  lineRoom,
  offerWordsByItself,
  PlacesKeptAboveCapacityError,
  placesKeptRefusalOf,
} from "@/modules/registrations/domain/kept-places";
import { placeOutlook } from "@/modules/registrations/domain/place-outlook";
import { occupiedForNewcomer } from "@/modules/registrations/domain/waitlist";
import { holdLapsedNext } from "@/modules/notifications/domain/hold-lapsed";
import { publicFill } from "@/modules/events/domain/registration-cta";

/**
 * «Locuri păstrate pentru club» (§914; BR-REQ-034-01, BR-REQ-034-02, BR-REQ-035-01), the pure rules: a threshold on
 * the entry's channel — the public form and the line's automatic offers measured on `capacity − K`, every staff verb
 * on the whole capacity — never a second capacity formula. K at 0, every event's default, changes nothing anywhere.
 */

describe("BR-REQ-034-01 kept places: the numbers an entry is measured on (§914)", () => {
  it("clamps K to the places, reads an absent or uncapped K as nothing", () => {
    expect(keptOf({ capacity: 175, placesKeptForClub: 10 })).toBe(10);
    expect(keptOf({ capacity: 5, placesKeptForClub: 10 })).toBe(5);
    expect(keptOf({ capacity: 5, placesKeptForClub: -3 })).toBe(0);
    expect(keptOf({ capacity: null, placesKeptForClub: 10 })).toBe(0);
    expect(keptOf({ capacity: 175 })).toBe(0);
    expect(keptOf({ capacity: 175, placesKeptForClub: null })).toBe(0);
  });

  it("measures a public entry on capacity − K and a staff verb on the whole capacity; an uncapped event stays uncapped", () => {
    expect(capacityForEntry({ capacity: 175, placesKeptForClub: 10, channel: "public" })).toBe(165);
    expect(capacityForEntry({ capacity: 175, placesKeptForClub: 10, channel: "staff" })).toBe(175);
    expect(capacityForEntry({ capacity: null, placesKeptForClub: 10, channel: "public" })).toBeNull();
    expect(announcedCapacity({ capacity: 175, placesKeptForClub: 10 })).toBe(165);
    expect(announcedCapacity({ capacity: null })).toBeNull();
  });

  it("is the identity with nothing kept, on every channel and every number", () => {
    for (const capacity of [1, 2, 10, 175]) {
      for (const channel of ["public", "staff"] as const) {
        expect(capacityForEntry({ capacity, placesKeptForClub: 0, channel })).toBe(capacity);
        for (const occupied of [0, 1, capacity - 1, capacity]) {
          expect(lineRoom({ capacity, placesKeptForClub: 0, occupied })).toBe(capacity - occupied);
          expect(keptPlacesInUse({ capacity, placesKeptForClub: 0, occupied })).toBe(false);
          expect(freeSplit({ capacity, placesKeptForClub: 0, occupied })).toEqual({ publicFree: Math.max(capacity - occupied, 0), keptFree: 0 });
        }
      }
    }
  });

  it("leaves the site's room unclamped, and says when the club's own places are in use", () => {
    expect(lineRoom({ capacity: 175, placesKeptForClub: 10, occupied: 160 })).toBe(5);
    expect(lineRoom({ capacity: 175, placesKeptForClub: 10, occupied: 170 })).toBe(-5);
    expect(lineRoom({ capacity: null, placesKeptForClub: 10, occupied: 3 })).toBeNull();
    expect(keptPlacesInUse({ capacity: 175, placesKeptForClub: 10, occupied: 165 })).toBe(false);
    expect(keptPlacesInUse({ capacity: 175, placesKeptForClub: 10, occupied: 166 })).toBe(true);
  });

  it("splits the free places into the site's and the club's, adding up to the free places whatever the numbers", () => {
    expect(freeSplit({ capacity: 175, placesKeptForClub: 10, occupied: 163 })).toEqual({ publicFree: 2, keptFree: 10 });
    expect(freeSplit({ capacity: 175, placesKeptForClub: 10, occupied: 170 })).toEqual({ publicFree: 0, keptFree: 5 });
    expect(freeSplit({ capacity: 175, placesKeptForClub: 10, occupied: 175 })).toEqual({ publicFree: 0, keptFree: 0 });
    for (let occupied = 0; occupied <= 12; occupied += 1) {
      const { publicFree, keptFree } = freeSplit({ capacity: 12, placesKeptForClub: 4, occupied });
      expect(publicFree + keptFree, `occupied ${occupied}`).toBe(Math.max(12 - occupied, 0));
      expect(keptFree).toBeLessThanOrEqual(4);
    }
  });

  it("promises an automatic offer in words only while nothing is kept; the allocator's gate is not this one", () => {
    expect(offerWordsByItself(true, { capacity: 175, placesKeptForClub: 0 })).toBe(true);
    expect(offerWordsByItself(true, { capacity: 175, placesKeptForClub: 10 })).toBe(false);
    expect(offerWordsByItself(false, { capacity: 175, placesKeptForClub: 0 })).toBe(false);
    // Uncapped, nothing is kept: the words are «Da»'s.
    expect(offerWordsByItself(true, { capacity: null, placesKeptForClub: 10 })).toBe(true);
  });
});

describe("BR-REQ-034-01 kept places in the public count (§914)", () => {
  it("counts a lapsed hold as free for a public newcomer only where the allocator would let it go for one", () => {
    const line = { waitlistCapacity: 0, waitlisted: 0, openOffers: 0 };
    // The club's places not in use: as before, the lapsed holds are free for the next newcomers.
    expect(occupiedForNewcomer({ ...line, occupied: 165, lapsedDeclarationHolds: 5, keptInUse: false })).toBe(160);
    // In use: none is released for a public newcomer, so none is said free.
    expect(occupiedForNewcomer({ ...line, occupied: 170, lapsedDeclarationHolds: 5, keptInUse: true })).toBe(170);
    // Absent, today's rule.
    expect(occupiedForNewcomer({ ...line, occupied: 170, lapsedDeclarationHolds: 5 })).toBe(165);
  });

  it("adds up on the announced capacity: taken plus free is the number the site says", () => {
    const fill = publicFill(165, 5, { occupied: 160, confirmed: 150 });
    expect(fill).toMatchObject({ taken: 160, capacity: 165 });
    // The club gave kept places beyond the site's number: the line still reads full, never above it.
    expect(publicFill(165, 0, { occupied: 170, confirmed: 168 })).toMatchObject({ taken: 165, capacity: 165 });
  });
});

describe("BR-REQ-035-01 §160 with kept places: never more holds released than people want places (§914)", () => {
  it("keeps the identity table for every free ≥ 0", () => {
    for (const lapsed of [0, 1, 3, 30]) {
      for (const waiting of [0, 1, 20]) {
        for (const free of [0, 1, 5, 40]) {
          expect(wantedLapsedHoldReleases({ lapsed, waiting, free })).toBe(Math.min(lapsed, Math.max(waiting - free, 0)));
          expect(wantedLapsedHoldReleases({ lapsed, waiting, free })).toBeLessThanOrEqual(waiting);
        }
      }
    }
  });

  it("the critic's case: K typed on a full race releases what today's rule releases, never the overshoot", () => {
    // 175 places, all taken, K = 10, 20 waiting, 30 lapsed: the line's room is −10, clamped to 0 as `free` always was.
    const room = lineRoom({ capacity: 175, placesKeptForClub: 10, occupied: 175 }) ?? 0;
    expect(wantedLapsedHoldReleases({ lapsed: 30, waiting: 20, free: Math.max(room, 0) })).toBe(20);
  });
});

describe("BR-REQ-034-02 invitations: the line claims only the site's places (§914)", () => {
  it("is today's number with nothing kept", () => {
    for (const capacity of [1, 10, 175]) {
      for (const occupied of [0, 5, capacity]) {
        for (const waiting of [0, 2, 20]) {
          expect(invitationFreePlaces({ capacity, occupied, waiting, placesKeptForClub: 0 })).toBe(Math.max(capacity - occupied - waiting, 0));
          expect(invitationFreePlaces({ capacity, occupied, waiting })).toBe(Math.max(capacity - occupied - waiting, 0));
        }
      }
    }
  });

  it("gives an invitation a kept place nobody holds, with no supplementary place, while the public line waits", () => {
    // 10 places, 3 kept, 7 taken (the site full), 2 waiting: the 3 kept are free for invitations.
    expect(invitationFreePlaces({ capacity: 10, occupied: 7, waiting: 2, placesKeptForClub: 3 })).toBe(3);
    expect(invitationRaises({ capacity: 10, occupied: 7, waiting: 2, needed: 3, placesKeptForClub: 3 })).toBe(0);
    expect(invitationRaises({ capacity: 10, occupied: 7, waiting: 2, needed: 4, placesKeptForClub: 3 })).toBe(1);
    // A site place still free is the line's first: 5 taken, 2 site places free and 2 waiting — the 3 kept for invitations.
    expect(invitationFreePlaces({ capacity: 10, occupied: 5, waiting: 2, placesKeptForClub: 3 })).toBe(3);
    // Never above the free places under the whole capacity.
    expect(invitationFreePlaces({ capacity: 10, occupied: 10, waiting: 0, placesKeptForClub: 3 })).toBe(0);
  });
});

describe("BR-REQ-034-02 «Locuri»: the free places split (§914)", () => {
  const counts = { capacity: 175, occupied: 163, confirmed: 150, declaration: 13, offered: 0, invited: 0, family: 0, waiting: 0, internal: 0, outside: 0 };

  it("says the site's free places and the club's, the whole outlook otherwise unchanged", () => {
    const outlook = placeOutlook({ ...counts, kept: 10 });
    expect(outlook).toMatchObject({ free: 12, publicFree: 2, keptFree: 10, fromWaiting: 0, raises: 0 });
  });

  it("adds nothing for a caller from before it", () => {
    const outlook = placeOutlook(counts);
    expect(outlook.free).toBe(12);
    expect("publicFree" in outlook || "keptFree" in outlook).toBe(false);
  });
});

describe("BR-REQ-034-02 the places refused in the editor's words (§914)", () => {
  it("refuses K above the places, naming the box and, for a series, the date", () => {
    expect(() => assertPlacesKeptWithin(10, 10)).not.toThrow();
    expect(() => assertPlacesKeptWithin(null, 50)).not.toThrow();
    const plain = (() => {
      try {
        assertPlacesKeptWithin(5, 6);
      } catch (error) {
        return error;
      }
    })();
    expect(plain).toBeInstanceOf(PlacesKeptAboveCapacityError);
    expect((plain as PlacesKeptAboveCapacityError).fields).toEqual(["placesKeptForClub"]);
    expect(placesKeptRefusalOf(plain)).toEqual({ code: "PLACES_KEPT_ABOVE_CAPACITY", date: null });
    expect(placesKeptRefusalOf(new PlacesKeptAboveCapacityError(6, 5, "2026-11-21"))).toEqual({ code: "PLACES_KEPT_ABOVE_CAPACITY_DATED", date: "2026-11-21" });
    expect(placesKeptRefusalOf(new Error("other"))).toBeNull();
  });

  it("says how many are taken, and by what, when the places would go under them", () => {
    const counts = { confirmed: 150, pendingDeclarationHolds: 9, unexpiredWaitlistOfferedHolds: 2, familyReservations: 1, familyPlaceHolds: 1, invitationHolds: 2 };
    const error = new CapacityBelowTakenError(160, counts);
    expect(error.fields).toEqual(["capacity"]);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(capacityBelowTakenRefusalOf(error)).toEqual({
      code: "CAPACITY_BELOW_TAKEN",
      values: { occupied: "165", confirmed: "150", declaration: "9", offered: "2", invited: "2", family: "2" },
      date: null,
    });
    expect(capacityBelowTakenRefusalOf(new CapacityBelowTakenError(160, counts, "2026-11-21"))?.code).toBe("CAPACITY_BELOW_TAKEN_DATED");
    expect(capacityBelowTakenRefusalOf(new Error("other"))).toBeNull();
  });
});

describe("BR-REQ-080-01 a lapsed hold's next step, on the site's places (§914)", () => {
  const open = { registrationOpen: true, waitlisted: 0, openOffers: 0, waitlistCapacity: 0 };

  it("says «te poți înscrie din nou» only while a site place is free, the kept ones aside", () => {
    expect(holdLapsedNext({ ...open, capacity: 10, occupied: 6, placesKeptForClub: 3 })).toBe("register");
    // 7 taken of 10, 3 kept: the site is full, and with no waiting list nothing more online.
    expect(holdLapsedNext({ ...open, capacity: 10, occupied: 7, placesKeptForClub: 3 })).toBe("desk");
    // Nothing kept: as before.
    expect(holdLapsedNext({ ...open, capacity: 10, occupied: 7 })).toBe("register");
  });
});
