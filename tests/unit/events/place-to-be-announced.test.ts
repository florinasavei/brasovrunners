import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/modules/events/repository";

/**
 * BR-REQ-011-01 criterion 19 (`DECISIONS.md` §328) — what a person reads where the place would
 * be, on the surfaces drawn from a public row: the facts on the event page, the listing card and
 * the hero (`EventFacts`, full and compact), the share picture, and the registration form's
 * facts line.
 *
 * The public queries already hand these surfaces no place (`tests/integration/cms/
 * location-to-be-announced.test.ts`). These rows are handed the typed place *anyway*, beside the
 * flag, so the surface's own rule is what is proven: the flag wins, and the sentence stands where
 * the place would — one key, the same words everywhere.
 */
vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: "ro", timeZone: "Europe/Bucharest" }),
    // The facts' date goes through `formatDay` in the page's language (§349).
    getLocale: async () => "ro",
  };
});

/** `next/og` draws a PNG through Satori; the element it is handed is what says the words. */
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

const SENTENCE = "Locația se anunță în curând";
const TYPED = "Sala Sporturilor Dumitru Popescu";
const MAP = "https://maps.example/sala-secreta";
const NOW = new Date("2026-10-01T09:00:00.000Z");

function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "RACE",
    surface: "ASPHALT",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-11-21T07:00:00Z"),
    endsAt: null,
    raceStartsAt: null,
    timezone: "Europe/Bucharest",
    mapUrl: MAP,
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
    registrationMode: "NONE",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    slug: "crosul-de-iarna",
    title: "Crosul de iarnă",
    excerpt: "Zece kilometri.",
    locationName: TYPED,
    locationAddress: "Strada Secretă 1",
    locationToBeAnnounced: true,
    difficulty: null,
    costType: null,
    publishedAt: NOW,
    ...overrides,
  } as PublicEvent;
}

describe("BR-REQ-011-01 criterion 19 the facts say the place is to be announced, and nothing else about it", () => {
  it("on the event page (full, one fact per line): the sentence under «Unde», no name, no map link", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, stacked: true }));
    expect(html).toContain("Unde");
    expect(html).toContain(SENTENCE);
    expect(html).not.toContain(TYPED);
    expect(html).not.toContain(MAP);
    expect(html).not.toContain("Vezi pe hartă");
  });

  it("on the listing card and the hero (compact, and full without links)", async () => {
    for (const rendered of [
      await EventFacts({ event: event(), now: NOW, variant: "compact", links: false }),
      await EventFacts({ event: event(), now: NOW }),
    ]) {
      const html = renderToStaticMarkup(rendered);
      expect(html).toContain(SENTENCE);
      expect(html).not.toContain(TYPED);
      expect(html).not.toContain(MAP);
    }
  });

  it("shows the place, as the map link, once it is announced", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event({ locationToBeAnnounced: false }), now: NOW, stacked: true }));
    expect(html).toContain(TYPED);
    expect(html).toContain(`href="${MAP}"`);
    expect(html).not.toContain(SENTENCE);
  });
});

describe("BR-REQ-011-01 criterion 19 the share picture", () => {
  const labels = {
    type: "Concurs",
    cancelled: "Anulat",
    locationToBeAnnounced: SENTENCE,
    distanceKm: (km: string) => `${km} km`,
    elevationM: (m: string) => `${m} m`,
  };
  const drawn = async (overrides: Partial<PublicEvent>) => {
    const image = (await eventShareImage(event(overrides), "ro", "og", labels)) as unknown as { element: ReactElement };
    return renderToStaticMarkup(image.element);
  };

  it("says the sentence where the meeting point would be, and never the typed place", async () => {
    const html = await drawn({});
    expect(html).toContain(SENTENCE);
    expect(html).not.toContain(TYPED);
  });

  it("names the place once it is announced", async () => {
    const html = await drawn({ locationToBeAnnounced: false });
    expect(html).toContain(TYPED);
    expect(html).not.toContain(SENTENCE);
  });

  it("is handed the sentence by both routes that draw it", () => {
    for (const file of ["src/app/[locale]/events/[slug]/opengraph-image.tsx", "src/app/[locale]/events/[slug]/share-image/route.ts"]) {
      expect(readFileSync(path.join(process.cwd(), file), "utf8"), file).toContain('locationToBeAnnounced: t("locationToBeAnnounced")');
    }
  });
});

describe("BR-REQ-011-01 criterion 19 the registration form's facts line (§102)", () => {
  it("says the sentence from the same key while the place is to be announced", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/events/[slug]/register/page.tsx"), "utf8");
    expect(page).toContain('event.locationToBeAnnounced ? ` · ${tEvent("locationToBeAnnounced")}`');
    expect(page).toContain('const tEvent = await getTranslations("Event")');
  });

  it("is one key, in both catalogues, with the same words the owner asked for", () => {
    const catalogue = (locale: string) => JSON.parse(readFileSync(path.join(process.cwd(), `messages/${locale}.json`), "utf8"));
    expect(catalogue("ro").Event.locationToBeAnnounced).toBe(SENTENCE);
    expect(catalogue("en").Event.locationToBeAnnounced).toBe("Location to be announced soon");
  });
});
