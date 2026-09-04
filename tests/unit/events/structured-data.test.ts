import { describe, expect, it } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";
import {
  clubId,
  sportsEventJsonLd,
  sportsOrganizationJsonLd,
  toOffsetIsoString,
} from "@/modules/events/structured-data";

/**
 * BR-REQ-052-02 — structured data.
 *
 * Criterion 7 requires the suite to parse the emitted JSON-LD and assert its properties, so
 * these serialise to JSON and read it back rather than inspecting the object literal. A block
 * that cannot survive `JSON.stringify` is not structured data.
 */
function baseEvent(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    kind: "TRAIL_RUN",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-09-20T05:00:00Z"),
    endsAt: null,
    raceStartsAt: null,
    timezone: "Europe/Bucharest",
    mapUrl: null,
    featured: false,
    distanceMeters: 14000,
    elevationGainMeters: 600,
    registrationMode: "NONE",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    slug: "tura-pe-tampa",
    title: "Tură pe Tâmpa",
    excerpt: "Urcare pe Tâmpa și retur.",
    locationName: "Stația de telecabină Tâmpa",
    locationAddress: "Aleea Tiberiu Brediceanu",
    difficultyLabel: "Mediu",
    costText: "Gratuit",
    seoTitle: null,
    seoDescription: null,
    publishedAt: new Date("2026-09-01T10:00:00Z"),
    ...overrides,
  } as PublicEvent;
}

const URL = "https://example.test/ro/evenimente/tura-pe-tampa";

function parsed(data: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(data));
}

describe("BR-REQ-052-02 criterion 2 SportsEvent", () => {
  it("carries the event timezone offset on start and end, not a bare Z", () => {
    const block = parsed(sportsEventJsonLd(baseEvent({ endsAt: new Date("2026-09-20T08:00:00Z") }), URL, "Brașov Runners"));

    // 05:00 UTC in September is 08:00 in Bucharest, which is UTC+3.
    expect(block.startDate).toBe("2026-09-20T08:00:00+03:00");
    expect(block.endDate).toBe("2026-09-20T11:00:00+03:00");
    expect(block.startDate).not.toContain("Z");
  });

  it("uses the winter offset for a winter date, so the offset is not hardcoded", () => {
    const block = parsed(
      sportsEventJsonLd(baseEvent({ startsAt: new Date("2026-01-15T06:00:00Z") }), URL, "Brașov Runners"),
    );
    // January is UTC+2 in Bucharest.
    expect(block.startDate).toBe("2026-01-15T08:00:00+02:00");
  });

  it("references the club @id as organizer", () => {
    const block = parsed(sportsEventJsonLd(baseEvent(), URL, "Brașov Runners"));
    expect(block.organizer["@id"]).toBe(clubId());
    expect(block.organizer["@id"]).toBe(parsed(sportsOrganizationJsonLd("Brașov Runners"))["@id"]);
  });

  it("includes a postal address on the location", () => {
    const block = parsed(sportsEventJsonLd(baseEvent(), URL, "Brașov Runners"));
    expect(block.location["@type"]).toBe("Place");
    expect(block.location.address["@type"]).toBe("PostalAddress");
    expect(block.location.address.addressLocality).toBe("Brașov");
    expect(block.location.address.addressCountry).toBe("RO");
    expect(block.location.address.streetAddress).toBe("Aleea Tiberiu Brediceanu");
  });

  it("omits streetAddress rather than emitting null when there is no address", () => {
    const block = parsed(sportsEventJsonLd(baseEvent({ locationAddress: null }), URL, "Brașov Runners"));
    expect("streetAddress" in block.location.address).toBe(false);
  });
});

describe("BR-REQ-052-02 criterion 4 cancelled events", () => {
  it("keeps the block and marks it cancelled", () => {
    const block = parsed(sportsEventJsonLd(baseEvent({ eventStatus: "CANCELLED" }), URL, "Brașov Runners"));
    expect(block["@type"]).toBe("SportsEvent");
    expect(block.eventStatus).toBe("https://schema.org/EventCancelled");
  });
});

describe("BR-REQ-052-02 criterion 3 capacity", () => {
  it("emits no remainingAttendeeCapacity while the pilot has no capped events", () => {
    // The criterion requires it to equal the count shown on the page. The pilot shows none,
    // so emitting the property at all would be a claim we cannot back.
    const block = parsed(sportsEventJsonLd(baseEvent(), URL, "Brașov Runners"));
    expect("remainingAttendeeCapacity" in block).toBe(false);
  });
});

describe("BR-REQ-052-02 criterion 6 no participant data", () => {
  it("contains no participant, email, registration or declaration field", () => {
    const serialised = JSON.stringify([
      sportsEventJsonLd(baseEvent(), URL, "Brașov Runners"),
      sportsOrganizationJsonLd("Brașov Runners"),
    ]).toLowerCase();

    for (const forbidden of ["participant", "@example.", "registration", "declaration", "attendee"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe("toOffsetIsoString", () => {
  it("handles a UTC event unchanged", () => {
    expect(toOffsetIsoString(new Date("2026-06-01T12:00:00Z"), "UTC")).toBe(
      "2026-06-01T12:00:00+00:00",
    );
  });

  it("handles midnight without emitting hour 24", () => {
    const result = toOffsetIsoString(new Date("2026-06-01T21:00:00Z"), "Europe/Bucharest");
    expect(result).toBe("2026-06-02T00:00:00+03:00");
  });
});

/**
 * BR-REQ-052-02 criterion 2 — two times, mapped to the two properties schema.org has.
 *
 * A race gathers at one time and starts at another. `startDate` must be the moment a runner
 * has to be on the line, because that is what a search result shows; `doorTime` is when the
 * event begins. The wrong way round would advertise the gathering as the start.
 */
describe("BR-REQ-052-02 the race start and the gathering", () => {
  it("puts the race start in startDate and the event start in doorTime", () => {
    const block = parsed(
      sportsEventJsonLd(
        baseEvent({
          startsAt: new Date("2026-10-11T06:00:00Z"),
          raceStartsAt: new Date("2026-10-11T07:00:00Z"),
        }),
        URL,
        "Brașov Runners",
      ),
    );

    expect(block.startDate).toBe("2026-10-11T10:00:00+03:00");
    expect(block.doorTime).toBe("2026-10-11T09:00:00+03:00");
  });

  it("falls back to the event start when the club has stated only one time", () => {
    const block = parsed(sportsEventJsonLd(baseEvent(), URL, "Brașov Runners"));

    expect(block.startDate).toBe("2026-09-20T08:00:00+03:00");
    expect(block.doorTime).toBe(block.startDate);
  });
});
