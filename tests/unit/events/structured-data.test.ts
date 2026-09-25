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
    type: "GROUP_RUN", surface: "TRAIL",
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
    difficulty: "MODERATE" as const,
    costType: "FREE" as const,
    seoTitle: null,
    seoDescription: null,
    publishedAt: new Date("2026-09-01T10:00:00Z"),
    ...overrides,
  } as PublicEvent;
}

const URL = "https://example.test/ro/evenimente/tura-pe-tampa";
/** The listing — the club's front page, which the organization block names as its `url` (§342). */
const LISTING = "https://example.test/ro/evenimente";

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

  it("names the co-host as a second organizer after the club, with its page (§121)", () => {
    const block = parsed(sportsEventJsonLd(baseEvent({ coHostName: "Asociația X", coHostUrl: "https://example.org/x" }), URL, "Brașov Runners"));
    expect(block.organizer).toEqual([
      { "@type": "SportsOrganization", "@id": clubId(), name: "Brașov Runners" },
      { "@type": "Organization", name: "Asociația X", url: "https://example.org/x" },
    ]);
  });

  it("names every co-host as an organizer after the club, in the club's own order (§168)", () => {
    const block = parsed(
      sportsEventJsonLd(
        baseEvent({
          coHosts: [
            { name: "Brașov Marathon", url: "https://example.org/bm" },
            { name: "Salvamont", url: null },
          ],
          // The two columns the list replaced are ignored while the list is there.
          coHostName: "Asociația X",
          coHostUrl: "https://example.org/x",
        } as Partial<PublicEvent>),
        URL,
        "Brașov Runners",
      ),
    );
    expect(block.organizer).toEqual([
      { "@type": "SportsOrganization", "@id": clubId(), name: "Brașov Runners" },
      { "@type": "Organization", name: "Brașov Marathon", url: "https://example.org/bm" },
      { "@type": "Organization", name: "Salvamont" },
    ]);
  });

  it("takes a partner's url from its SITE link even when a different kind was listed first (§344)", () => {
    const block = parsed(
      sportsEventJsonLd(
        baseEvent({
          coHosts: [
            {
              name: "Brașov Marathon",
              links: [
                { kind: "FACEBOOK", url: "https://facebook.com/bm", labelRo: null, labelEn: null },
                { kind: "SITE", url: "https://bm.example.test", labelRo: null, labelEn: null },
              ],
            },
          ],
        } as Partial<PublicEvent>),
        URL,
        "Brașov Runners",
      ),
    );
    expect(block.organizer).toEqual([
      { "@type": "SportsOrganization", "@id": clubId(), name: "Brașov Runners" },
      { "@type": "Organization", name: "Brașov Marathon", url: "https://bm.example.test" },
    ]);
  });

  it("says what the partnership is in the page's language, and only when the club wrote it in both (§352)", () => {
    const festival = (descriptionEn: string | null) =>
      baseEvent({
        coHosts: [
          {
            name: "Brașov Running Festival",
            descriptionRo: "Alergăm împreună duminică.",
            descriptionEn,
            links: [{ kind: "SITE", url: "https://festival.example.test", labelRo: null, labelEn: null }],
          },
        ],
      } as Partial<PublicEvent>);
    const partnerOf = (block: { organizer: unknown[] }) => block.organizer[1];

    expect(partnerOf(parsed(sportsEventJsonLd(festival("We run together on Sunday."), URL, "Brașov Runners", [], "ro")))).toEqual({
      "@type": "Organization",
      name: "Brașov Running Festival",
      url: "https://festival.example.test",
      description: "Alergăm împreună duminică.",
    });
    expect(partnerOf(parsed(sportsEventJsonLd(festival("We run together on Sunday."), URL, "Brașov Runners", [], "en")))).toMatchObject({
      description: "We run together on Sunday.",
    });
    // Half a pair: said in neither language — the English block never carries the Romanian text.
    for (const locale of ["ro", "en"] as const) {
      expect(partnerOf(parsed(sportsEventJsonLd(festival(null), URL, "Brașov Runners", [], locale)))).not.toHaveProperty("description");
    }
    // No language given: no description, never a guessed one.
    expect(partnerOf(parsed(sportsEventJsonLd(festival("We run together on Sunday."), URL, "Brașov Runners")))).not.toHaveProperty("description");
  });

  it("keeps one organizer object, not a list of one, when the club hosts alone", () => {
    const block = parsed(sportsEventJsonLd(baseEvent(), URL, "Brașov Runners"));
    expect(block.organizer).toEqual({ "@type": "SportsOrganization", "@id": clubId(), name: "Brașov Runners" });
  });

  it("says a club event is free, with a zero offer at its own page, unless it is marked PAID (§121, §343, §369)", () => {
    const free = parsed(sportsEventJsonLd(baseEvent(), URL, "Brașov Runners"));
    expect(free.isAccessibleForFree).toBe(true);
    expect(free.offers).toMatchObject({ "@type": "Offer", price: "0", priceCurrency: "RON", url: URL, availability: "https://schema.org/InStock" });
    expect(free.offers.validFrom).toBe("2026-09-01T13:00:00+03:00");
    const unstated = parsed(sportsEventJsonLd(baseEvent({ costType: null }), URL, "Brașov Runners"));
    expect(unstated.isAccessibleForFree).toBe(true);
    const paid = parsed(sportsEventJsonLd(baseEvent({ costType: "PAID" }), URL, "Brașov Runners"));
    expect(paid.isAccessibleForFree).toBe(false);
    expect(paid.offers).toBeUndefined();
    // A donation is given, not paid for the place (§369): the event is free to attend.
    const donation = parsed(sportsEventJsonLd(baseEvent({ costType: "DONATION" } as Partial<PublicEvent>), URL, "Brașov Runners"));
    expect(donation.isAccessibleForFree).toBe(true);
    expect(donation.offers).toEqual(free.offers);
    expect(donation.potentialAction).toBeUndefined();
  });

  it("offers the club's own cost link, never a price parsed out of the free text amount (§343)", () => {
    const paidUrl = "https://revolut.me/brasovrunners";
    const paid = parsed(
      sportsEventJsonLd(
        baseEvent({ costType: "PAID", costAmount: "50 lei", costUrl: paidUrl } as Partial<PublicEvent>),
        URL,
        "Brașov Runners",
      ),
    );
    expect(paid.isAccessibleForFree).toBe(false);
    expect(paid.offers).toEqual({ "@type": "Offer", url: paidUrl, availability: "https://schema.org/InStock" });
    expect(paid.offers.price).toBeUndefined();

    const donationUrl = "https://www.wingsforlifeworldrun.com/en/donate";
    const donation = parsed(
      sportsEventJsonLd(
        baseEvent({ costType: "DONATION", costUrl: donationUrl } as Partial<PublicEvent>),
        URL,
        "Brașov Runners",
      ),
    );
    // Free to attend, the zero offer at the event's own page, and the donation link as schema.org's
    // own verb for it — never the offer's url, which would read as "free tickets, over there" (§369).
    expect(donation.isAccessibleForFree).toBe(true);
    expect(donation.offers).toMatchObject({ "@type": "Offer", price: "0", priceCurrency: "RON", url: URL, availability: "https://schema.org/InStock" });
    expect(donation.offers.url).not.toBe(donationUrl);
    expect(donation.potentialAction).toEqual({ "@type": "DonateAction", target: donationUrl });
    // A suggested amount is words, and stays out of the block like a price does.
    const suggested = parsed(
      sportsEventJsonLd(
        baseEvent({ costType: "DONATION", costAmount: "sugerat 50 lei", costUrl: donationUrl } as Partial<PublicEvent>),
        URL,
        "Brașov Runners",
      ),
    );
    expect(suggested.offers.price).toBe("0");
    expect(JSON.stringify(suggested)).not.toContain("50 lei");
    // A free event carries no donation verb, whatever a stale link column holds.
    expect(parsed(sportsEventJsonLd(baseEvent({ costUrl: donationUrl } as Partial<PublicEvent>), URL, "Brașov Runners")).potentialAction).toBeUndefined();
  });

  it("offers the organizer's own registration link on an EXTERNAL-registration PAID event, never cost_url (§394)", () => {
    const externalUrl = "https://alt-club.ro/inscriere";
    const clubCostUrl = "https://revolut.me/brasovrunners";
    const external = parsed(
      sportsEventJsonLd(
        baseEvent({
          costType: "PAID",
          costAmount: "75 lei",
          costUrl: clubCostUrl,
          registrationMode: "EXTERNAL",
          externalRegistrationUrl: externalUrl,
        } as Partial<PublicEvent>),
        URL,
        "Brașov Runners",
      ),
    );
    expect(external.isAccessibleForFree).toBe(false);
    expect(external.offers).toEqual({ "@type": "Offer", url: externalUrl, availability: "https://schema.org/InStock" });
    expect(external.offers.url).not.toBe(clubCostUrl);

    // No organizer link at all: no offer, rather than falling back to the club's own cost link.
    const noLink = parsed(
      sportsEventJsonLd(
        baseEvent({ costType: "PAID", costUrl: clubCostUrl, registrationMode: "EXTERNAL", externalRegistrationUrl: null } as Partial<PublicEvent>),
        URL,
        "Brașov Runners",
      ),
    );
    expect(noLink.offers).toBeUndefined();

    // An INTERNAL paid event is unaffected: its own cost link, exactly as before.
    const internal = parsed(
      sportsEventJsonLd(
        baseEvent({ costType: "PAID", costUrl: clubCostUrl, registrationMode: "INTERNAL" } as Partial<PublicEvent>),
        URL,
        "Brașov Runners",
      ),
    );
    expect(internal.offers.url).toBe(clubCostUrl);
  });

  it("references the club @id as organizer", () => {
    const block = parsed(sportsEventJsonLd(baseEvent(), URL, "Brașov Runners"));
    expect(block.organizer["@id"]).toBe(clubId());
    expect(block.organizer["@id"]).toBe(parsed(sportsOrganizationJsonLd("Brașov Runners", LISTING))["@id"]);
  });

  it("names the listing as the club's url, never the bare base that redirects (§342)", () => {
    const block = parsed(sportsOrganizationJsonLd("Brașov Runners", LISTING));
    expect(block.url).toBe(LISTING);
    expect(block.url).not.toBe(clubId().replace(/\/#organization$/, ""));
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

describe("BR-REQ-052-02 who may enter (§329)", () => {
  const race = (overrides: Partial<PublicEvent>) =>
    baseEvent({ type: "RACE", registrationMode: "INTERNAL", minAge: 14, ...overrides } as Partial<PublicEvent>);

  it("states the event's own minimum as schema.org's open-ended range", () => {
    expect(parsed(sportsEventJsonLd(race({}), URL, "Brașov Runners")).typicalAgeRange).toBe("14-");
    expect(parsed(sportsEventJsonLd(race({ minAge: 16 } as Partial<PublicEvent>), URL, "Brașov Runners")).typicalAgeRange).toBe("16-");
  });

  it("states nothing for no minimum, and nothing where the club counts no age", () => {
    // Zero is no minimum: "0-" would be a rule nobody set.
    expect("typicalAgeRange" in parsed(sportsEventJsonLd(race({ minAge: 0 } as Partial<PublicEvent>), URL, "Brașov Runners"))).toBe(false);
    // Registered elsewhere, or not at all, or turned up to (§111): the platform refuses nobody there.
    for (const overrides of [{ registrationMode: "EXTERNAL" }, { registrationMode: "NONE" }, { type: "GROUP_RUN" }] as const) {
      const block = parsed(sportsEventJsonLd(race(overrides as Partial<PublicEvent>), URL, "Brașov Runners"));
      expect("typicalAgeRange" in block, JSON.stringify(overrides)).toBe(false);
    }
  });
});

describe("BR-REQ-052-02 criterion 6 no participant data", () => {
  it("contains no participant, email, registration or declaration field", () => {
    const serialised = JSON.stringify([
      sportsEventJsonLd(baseEvent(), URL, "Brașov Runners"),
      sportsOrganizationJsonLd("Brașov Runners", LISTING),
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

/**
 * BR-REQ-052-02 criterion 2 and BR-REQ-011-01 criterion 7 — the meeting point on a map.
 *
 * The link is whatever the organizer pasted. No `geo`: the coordinates it was built from left
 * with migration `0023` (`DECISIONS.md` §61), and a pin guessed from a place name would be
 * wrong, which is worse than no pin.
 */
describe("BR-REQ-052-02 the meeting point as a map link", () => {
  it("publishes neither a map nor a guessed pin when the club has pasted no link", () => {
    const block = parsed(sportsEventJsonLd(baseEvent(), URL, "Brașov Runners"));
    expect(block.location.geo).toBeUndefined();
    expect(block.location.hasMap).toBeUndefined();
  });

  it("publishes the same map link the page renders", () => {
    const mapUrl = "https://maps.example.test/place/parcul-tractorul";
    const block = parsed(sportsEventJsonLd(baseEvent({ mapUrl }), URL, "Brașov Runners"));
    expect(block.location.hasMap).toBe(mapUrl);
  });

  // `DECISIONS.md` §155: the two cards the page draws are the result's pictures; none is claimed when none is given.
  it("lists the event's cards as its images, and no image when it has none", () => {
    const pictures = [`${URL}/opengraph-image`, `${URL}/share-image`];
    expect(parsed(sportsEventJsonLd(baseEvent(), URL, "Brașov Runners", pictures)).image).toEqual(pictures);
    expect(parsed(sportsEventJsonLd(baseEvent(), URL, "Brașov Runners")).image).toBeUndefined();
  });
});
