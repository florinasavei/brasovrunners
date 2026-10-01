import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicEvent, PublicEventPage } from "@/modules/events/repository";

/**
 * BR-REQ-040-03 criteria 4 and 5 (§349) — the day of the week on the surfaces a runner reads the
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
    surface: "ASPHALT",
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

describe("§533 the start held back: the day alone, or nothing of time", () => {
  const held = (announcedDay: string | null): PublicEventPage => ({ ...event(), startsAt: null, endsAt: null, raceStartsAt: null, announcedDay });
  const text = (html: string) => html.replace(/<style[^>]*>[^<]*<\/style>/g, "").replace(/<[^>]+>/g, " ");

  it("says the day with «Ora se anunță în curând» and no hour when only the time is held back", async () => {
    pageLocale = "ro";
    const html = text(renderToStaticMarkup(await EventFacts({ event: held("2027-01-16"), now: NOW, stacked: true })));
    expect(html).toContain("Sâmbătă, 16 ian. 2027");
    expect(html).toContain("Ora se anunță în curând");
    expect(html).not.toContain("09:30");
  });

  it("says «Data se anunță în curând» and no day when the date is held back", async () => {
    pageLocale = "ro";
    const html = text(renderToStaticMarkup(await EventFacts({ event: held(null), now: NOW, stacked: true })));
    expect(html).toContain("Data se anunță în curând");
    expect(html).not.toContain("2027");
  });

  it("puts the same day on the share picture, in English too", async () => {
    const image = (await eventShareImage(held("2027-01-16"), "en", "og", {
      type: "Race",
      cancelled: "Cancelled",
      locationToBeAnnounced: "—",
      dateToBeAnnounced: "Date to be announced soon",
      timeToBeAnnounced: "Time to be announced soon",
      t: (key: string, values?: Record<string, string | number>) => (key.startsWith("distance") ? `${values?.km} km` : `${values?.m} m`),
    })) as unknown as { element: ReactElement };
    const html = text(renderToStaticMarkup(image.element));
    expect(html).toContain("Saturday, 16 Jan 2027 · Time to be announced soon");
    expect(html).not.toContain("09:30");
  });
});

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

  // The date and hour sit in their own <strong> (§472), so the sentence is read as text.
  const words = (html: string) => html.replace(/<style[^>]*>[^<]*<\/style>/g, "").replace(/<[^>]+>/g, "");

  it("names the registration's opening day inside the card's sentence in lower case, in Romanian", async () => {
    pageLocale = "ro";
    const early = new Date("2026-09-20T09:00:00Z");
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: early, variant: "compact", links: false }));
    expect(html).toContain("Sâmbătă, 16 ian. 2027");
    expect(words(html)).toContain("Înscrierile se deschid joi, 1 oct. 2026, la 18:00");
  });

  it("and in English", async () => {
    pageLocale = "en";
    const early = new Date("2026-09-20T09:00:00Z");
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: early, variant: "compact", links: false }));
    expect(words(html)).toContain("Registration opens on Thu, 1 Oct 2026, at 18:00");
  });
});

describe("BR-REQ-040-03 criterion 4 the share picture's date is the picture's language", () => {
  const labels = {
    type: "Concurs",
    cancelled: "Anulat",
    locationToBeAnnounced: "—",
    dateToBeAnnounced: "—",
    timeToBeAnnounced: "—",
    t: (key: string, values?: Record<string, string | number>) => (key.startsWith("distance") ? `${values?.km} km` : `${values?.m} m`),
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
