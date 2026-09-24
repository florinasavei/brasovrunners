import { describe, expect, it } from "vitest";
import { eventFieldsSchema } from "@/modules/content/events/fields";

/**
 * Migration `0018` turned two free-text fields into closed sets. What the schema has to get
 * right is the third answer: the club may decline to state either, and "not stated" must stay
 * distinguishable from `FREE` and from `EASY` — an event with no stated cost is not free, and
 * one with no stated difficulty is not easy.
 */
const BASE = {
  type: "GROUP_RUN",
  surface: "",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-01T09:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Parcul Tractorul",
  locationAddress: "",
  mapUrl: "",
  routeUrl: "",
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

const parse = (difficulty: unknown, costType: unknown, cost: { costAmount?: unknown; costUrl?: unknown } = {}) =>
  eventFieldsSchema.safeParse({ ...BASE, difficulty, costType, ...cost });

describe("event difficulty and cost type", () => {
  it("accepts each value of the closed sets", () => {
    for (const difficulty of ["EASY", "MODERATE", "HARD"]) {
      expect(parse(difficulty, "FREE").success).toBe(true);
    }
    for (const costType of ["FREE", "PAID", "DONATION"]) {
      // PAID and DONATION each need their own required box filled, tested on its own below.
      expect(parse("MODERATE", costType, { costAmount: "50 lei", costUrl: "https://example.test/pay" }).success).toBe(true);
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

/**
 * `DECISIONS.md` §NNN: `DONATION` is a third answer to "does a runner need their wallet" — no
 * fee the platform or the club takes, a link to somewhere else where a runner gives what they
 * choose. A paid event must say the amount; a donation must say the link.
 */
describe("event cost amount and donation link (§NNN)", () => {
  it("requires the amount for a paid event, and refuses a blank one", () => {
    const withAmount = parse("MODERATE", "PAID", { costAmount: "50 lei", costUrl: "" });
    expect(withAmount.success).toBe(true);

    const blank = parse("MODERATE", "PAID", { costAmount: "", costUrl: "" });
    expect(blank.success).toBe(false);
    if (!blank.success) {
      expect(blank.error.issues[0]?.path).toEqual(["costAmount"]);
    }
  });

  it("requires the link for a donation, and refuses a blank one", () => {
    const withLink = parse("MODERATE", "DONATION", { costAmount: "", costUrl: "https://www.wingsforlifeworldrun.com/en/donate" });
    expect(withLink.success).toBe(true);

    const blank = parse("MODERATE", "DONATION", { costAmount: "", costUrl: "" });
    expect(blank.success).toBe(false);
    if (!blank.success) {
      expect(blank.error.issues[0]?.path).toEqual(["costUrl"]);
    }
  });

  it("refuses a cost link that is not https, like every other pasted link", () => {
    expect(parse("MODERATE", "DONATION", { costAmount: "", costUrl: "http://example.test/donate" }).success).toBe(false);
    expect(parse("MODERATE", "PAID", { costAmount: "50 lei", costUrl: "not-a-link" }).success).toBe(false);
  });

  it("keeps the amount optional on a donation and the link optional on a paid event", () => {
    expect(parse("MODERATE", "DONATION", { costAmount: "", costUrl: "https://example.test/donate" }).success).toBe(true);
    expect(parse("MODERATE", "PAID", { costAmount: "50 lei", costUrl: "" }).success).toBe(true);
  });

  it("does not require either box for a caller not editing the cost fields at all", () => {
    // The discipline `links` and `bibDesign` follow (§169, §249): a caller that omits the keys
    // entirely — a fixture, a script written before this migration — is not "editing" cost, and
    // must not be refused for a fact it never mentioned. The real editor always posts both.
    expect(eventFieldsSchema.safeParse({ ...BASE, difficulty: null, costType: "PAID" }).success).toBe(true);
    expect(eventFieldsSchema.safeParse({ ...BASE, difficulty: null, costType: "DONATION" }).success).toBe(true);
  });

  it("refuses an amount longer than 60 characters", () => {
    const tooLong = "x".repeat(61);
    expect(parse("MODERATE", "PAID", { costAmount: tooLong, costUrl: "" }).success).toBe(false);
    expect(parse("MODERATE", "PAID", { costAmount: "x".repeat(60), costUrl: "" }).success).toBe(true);
  });
});
