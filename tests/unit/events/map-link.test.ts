import { describe, expect, it } from "vitest";
import { mapLinkFor } from "@/modules/events/domain/map-link";

/**
 * BR-REQ-011-01 criterion 7 — the map link points at the exact meeting point.
 *
 * A name is not a place: a park is forty hectares and the start is one corner of it. These
 * cover the two sources, the precedence between them, and every way the pair can be wrong —
 * because the failure mode of a bad map link is a runner standing somewhere else at 09:00.
 */

// Not a real map service: the base URL is configuration, and this file must not name a host
// any more than `src/` may (AGENTS.md §8).
const BASE = "https://maps.example.test/";

describe("BR-REQ-011-01 building a map link", () => {
  const coordinates = { mapUrl: null, latitude: "45.6427", longitude: "25.5887" };

  it("builds a link from the coordinates", () => {
    expect(mapLinkFor(coordinates, BASE)).toBe("https://maps.example.test/?q=45.6427,25.5887");
  });

  it("appends to a base URL that already carries a query", () => {
    expect(mapLinkFor(coordinates, "https://maps.example.test/?api=1")).toBe(
      "https://maps.example.test/?api=1&q=45.6427,25.5887",
    );
  });

  it("keeps a pasted link when there is one, whatever the coordinates say", () => {
    // The override exists for what coordinates cannot express: a venue page, a drawn route.
    const pasted = "https://maps.example.test/place/parcul-tractorul";
    expect(mapLinkFor({ ...coordinates, mapUrl: pasted }, BASE)).toBe(pasted);
    // And it works with no base URL configured at all.
    expect(mapLinkFor({ ...coordinates, mapUrl: pasted }, undefined)).toBe(pasted);
  });

  it("builds nothing when no map service is configured", () => {
    // A missing link is a missing convenience. A guessed one sends people to the wrong place.
    expect(mapLinkFor(coordinates, undefined)).toBeNull();
    expect(mapLinkFor(coordinates, "")).toBeNull();
  });

  it("builds nothing from half a coordinate", () => {
    expect(mapLinkFor({ mapUrl: null, latitude: "45.6427", longitude: null }, BASE)).toBeNull();
    expect(mapLinkFor({ mapUrl: null, latitude: null, longitude: "25.5887" }, BASE)).toBeNull();
    expect(mapLinkFor({ mapUrl: null, latitude: null, longitude: null }, BASE)).toBeNull();
  });

  it("refuses a value that is not a number or is out of range", () => {
    // The database constrains the column, but this function is also handed preview rows and
    // test fixtures; "?q=NaN,NaN" is a link to nowhere that reports no error.
    expect(mapLinkFor({ mapUrl: null, latitude: "north", longitude: "25.5" }, BASE)).toBeNull();
    expect(mapLinkFor({ mapUrl: null, latitude: "95", longitude: "25.5" }, BASE)).toBeNull();
    expect(mapLinkFor({ mapUrl: null, latitude: "45.6", longitude: "181" }, BASE)).toBeNull();
  });

  it("keeps zero, which is a real coordinate", () => {
    // Null Island is in the Gulf of Guinea, but 0 is a legitimate latitude and the check must
    // not treat it as absent.
    expect(mapLinkFor({ mapUrl: null, latitude: "0", longitude: "25.5887" }, BASE)).toBe(
      "https://maps.example.test/?q=0,25.5887",
    );
  });

  it("rounds to six decimals, which is about ten centimetres", () => {
    expect(
      mapLinkFor({ mapUrl: null, latitude: "45.64271234567", longitude: "25.58871234567" }, BASE),
    ).toBe("https://maps.example.test/?q=45.642712,25.588712");
  });
});
