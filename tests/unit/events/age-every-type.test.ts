import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EVENT_TYPES, publicAgeRule } from "@/modules/events/domain/event-type";
import type { PublicEvent } from "@/modules/events/repository";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §NNN — the minimum age is one box in the editor's «Regulamentul» for every event
 * type, and the event's page says it for every type (amending §329's "only where the club counts
 * it"). Where the club takes the registrations, the form's own sentence with the parent's clause;
 * anywhere else the minimum alone, since there is no registration for a parent to make; nothing
 * for no minimum where nobody registers here.
 */
vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator: translator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => translator({ locale: "ro", messages: ro, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: "ro", timeZone: "Europe/Bucharest" }),
    getLocale: async () => "ro",
  };
});

const { default: EventFacts } = await import("@/modules/events/ui/EventFacts");

const NOW = new Date("2026-10-01T09:00:00.000Z");

function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    type: "GROUP_RUN",
    surface: "TRAIL",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-11-21T07:00:00Z"),
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
    registrationMode: "NONE",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    slug: "tura-pe-tampa",
    title: "Tura pe Tâmpa",
    excerpt: "Zece kilometri.",
    locationName: "Parcul Tractorul",
    locationAddress: "Strada Nicolae Labiș",
    locationToBeAnnounced: false,
    difficulty: null,
    costType: null,
    costAmount: null,
    costUrl: null,
    discountNote: null,
    publishedAt: NOW,
    minAge: 14,
    ...overrides,
  } as PublicEvent;
}

describe("§NNN the page says the minimum age for every type", () => {
  it("chooses the sentence by where the registrations are taken", () => {
    // The club's own door: the form's sentence, the parent's clause by the number (§329, §410).
    expect(publicAgeRule({ type: "RACE", registrationMode: "INTERNAL", minAge: 14 })).toBe("minimumAndGuardian");
    expect(publicAgeRule({ type: "RACE", registrationMode: "INTERNAL", minAge: 18 })).toBe("minimumOnly");
    expect(publicAgeRule({ type: "RACE", registrationMode: "INTERNAL", minAge: 0 })).toBe("guardianOnly");
    // Every type, registered elsewhere or not at all: the minimum alone, nothing for none.
    for (const type of EVENT_TYPES) {
      for (const registrationMode of ["NONE", "EXTERNAL"] as const) {
        expect(publicAgeRule({ type, registrationMode, minAge: 16 }), `${type} ${registrationMode}`).toBe("minimumOnly");
        expect(publicAgeRule({ type, registrationMode, minAge: 0 }), `${type} ${registrationMode}`).toBeNull();
      }
    }
    // A group run is turned up to whatever its hidden mode says (§111): never the parent's clause.
    expect(publicAgeRule({ type: "GROUP_RUN", registrationMode: "INTERNAL", minAge: 14 })).toBe("minimumOnly");
  });

  it("a group run's facts carry «Vârstă» with the minimum alone", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event({ minAge: 16 }), now: NOW, stacked: true }));
    expect(html).toContain(ro.Event.age);
    expect(html).toContain("Vârsta minimă: 16 ani.");
    expect(html).not.toContain("părinte");
  });

  it("an event registered elsewhere says the minimum too", async () => {
    const html = renderToStaticMarkup(
      await EventFacts({
        event: event({ type: "RACE", registrationMode: "EXTERNAL", externalProvider: "Asociația X", externalRegistrationUrl: "https://example.org/inscriere", minAge: 20 }),
        now: NOW,
        stacked: true,
      }),
    );
    expect(html).toContain("Vârsta minimă: 20 de ani.");
  });

  it("no minimum and no registration here: no age row at all", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event({ minAge: 0 }), now: NOW, stacked: true }));
    expect(html).not.toContain(`>${ro.Event.age}<`);
    expect(html).not.toContain("Vârsta minimă");
  });

  it("the editor's help says the box is for every type, in both languages, with the parent's clause kept", () => {
    expect(ro.Admin.editor.minAgeHelp).toContain("orice tip de eveniment");
    expect(en.Admin.editor.minAgeHelp).toContain("every type of event");
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.editor.boxes.summary.age.from).toContain("{age}");
      expect(catalogue.Admin.editor.boxes.summary.age.from).not.toMatch(/\d/);
      expect(catalogue.Admin.editor.minAgeReadOnly).toContain("{age}");
    }
  });
});
