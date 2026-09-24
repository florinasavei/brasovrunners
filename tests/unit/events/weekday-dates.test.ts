import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-040-03 criteria 4 and 5 (§NNN) — the day of the week on the surfaces a runner reads the
 * race's date on, in the language of the page or the picture: the facts on the event page and on
 * the listing card, the countdown line's sentence, and the share picture.
 */

// The language the mocked request is in; each test sets it.
let pageLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const messages = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: pageLocale, messages: messages[pageLocale], namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: pageLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => pageLocale,
  };
});

vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(
      public element: ReactElement,
      public options: unknown,
    ) {}
  },
}));
vi.mock("@/theme/pdf/fonts", () => ({ brandFonts: async () => [] }));

const { default: EventFacts } = await import("@/modules/events/ui/EventFacts");
const { eventShareImage } = await import("@/modules/events/share-image");

const NOW = new Date("2026-10-01T09:00:00.000Z");

/** Saturday 16 January 2027 at 09:30 in Brașov; registration opens on Thursday 1 October 2026 at 18:00. */
function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "RACE",
    surface: "ROAD",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2027-01-16T07:30:00Z"),
    endsAt: null,
    raceStartsAt: null,
    timezone: "Europe/Bucharest",
    mapUrl: null,
    routeUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    featured: false,
    isSpecial: false,
    distanceMeters: 10000,
    elevationGainMeters: null,
    registrationMode: "INTERNAL",
    registrationOpensAt: new Date("2026-10-01T15:00:00Z"),
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    slug: "crosul-de-iarna",
    title: "Crosul de iarnă",
    excerpt: "Zece kilometri.",
    locationName: "Parcul Tractorul",
    locationAddress: null,
    locationToBeAnnounced: false,
    difficulty: null,
    costType: null,
    publishedAt: NOW,
    ...overrides,
  } as PublicEvent;
}

describe("BR-REQ-040-03 criterion 4 the event's facts carry the day of the week, in the page's language", () => {
  it("writes the long form at the start of the facts on a Romanian page", async () => {
    pageLocale = "ro";
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, stacked: true }));
    expect(html).toContain("Sâmbătă, 16 ian. 2027");
    expect(html).toContain("09:30");
  });

  it("writes the same instant in English on an English page", async () => {
    pageLocale = "en";
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, stacked: true }));
    expect(html).toContain("Saturday, 16 Jan 2027");
    expect(html).not.toContain("Sâmbătă");
  });

  it("names the registration's opening day inside the card's sentence in lower case, in Romanian", async () => {
    pageLocale = "ro";
    const early = new Date("2026-09-20T09:00:00Z");
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: early, variant: "compact", links: false }));
    expect(html).toContain("Sâmbătă, 16 ian. 2027");
    expect(html).toContain("Înscrierile se deschid pe joi, 1 oct. 2026, 18:00");
  });

  it("and in English", async () => {
    pageLocale = "en";
    const early = new Date("2026-09-20T09:00:00Z");
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: early, variant: "compact", links: false }));
    expect(html).toContain("Thu, 1 Oct 2026, 18:00");
  });
});

describe("BR-REQ-040-03 criterion 4 the share picture's date is the picture's language", () => {
  const labels = {
    type: "Concurs",
    cancelled: "Anulat",
    locationToBeAnnounced: "—",
    distanceKm: (km: string) => `${km} km`,
    elevationM: (m: string) => `${m} m`,
  };
  const drawn = async (locale: "ro" | "en") => {
    const image = (await eventShareImage(event(), locale, "og", labels)) as unknown as { element: ReactElement };
    return renderToStaticMarkup(image.element);
  };

  it("draws the Romanian picture with the Romanian weekday, capitalised", async () => {
    expect(await drawn("ro")).toContain("Sâmbătă, 16 ian. 2027");
  });

  it("draws the English picture with the English weekday", async () => {
    const html = await drawn("en");
    expect(html).toContain("Saturday, 16 Jan 2027");
    expect(html).toContain("09:30");
  });
});
