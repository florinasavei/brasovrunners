import { describe, expect, it } from "vitest";
import { eventFieldsSchema } from "@/modules/content/events/fields";

/**
 * Migration `0018` turned two free-text fields into closed sets. What the schema has to get
 * right is the third answer: the club may decline to state either, and "not stated" must stay
 * distinguishable from `FREE` and from `EASY` — an event with no stated cost is not free, and
 * one with no stated difficulty is not easy.
 */
const BASE = {
  kind: "COMMUNITY_RUN",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-01T09:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  latitude: "",
  longitude: "",
  locationName: "Parcul Tractorul",
  locationAddress: "",
  mapUrl: "",
  distanceMeters: "",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "NONE",
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
  participantListVisibility: "HIDDEN",
} as const;

const parse = (difficulty: unknown, costType: unknown) =>
  eventFieldsSchema.safeParse({ ...BASE, difficulty, costType });

describe("event difficulty and cost type", () => {
  it("accepts each value of the closed sets", () => {
    for (const difficulty of ["EASY", "MODERATE", "HARD"]) {
      expect(parse(difficulty, "FREE").success).toBe(true);
    }
    for (const costType of ["FREE", "PAID"]) {
      expect(parse("MODERATE", costType).success).toBe(true);
    }
  });

  it("reads an unselected dropdown as not stated, not as a validation error", () => {
    const parsed = parse("", "");
    expect(parsed.success).toBe(true);
    // Null, not the empty string: the page tests for absence to decide whether to render the
    // row at all, and "" is a value that renders as a blank fact.
    expect(parsed.data?.difficulty).toBeNull();
    expect(parsed.data?.costType).toBeNull();
  });

  it("accepts null directly, which is what the form action posts for an empty select", () => {
    const parsed = parse(null, null);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.difficulty).toBeNull();
  });

  it("refuses a value outside the set rather than silently calling it not stated", () => {
    // It cannot have come from the dropdown that posts this field, so swallowing it would hide
    // a tampered or stale form instead of refusing it.
    expect(parse("EXTREME", "FREE").success).toBe(false);
    expect(parse("MODERATE", "50 lei").success).toBe(false);
  });

  it("refuses the free text these fields used to hold", () => {
    // The words that were valid before migration 0018 are exactly what must now fail, or a
    // stale form would keep writing them and the enum would have bought nothing.
    expect(parse("Mediu", "Gratuit").success).toBe(false);
  });
});
