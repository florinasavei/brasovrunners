import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { PublicEvent } from "@/modules/events/repository";
import { cardRegistrationLine } from "@/modules/events/ui/CardRegistration";
import type { RegistrationDoor } from "@/modules/events/ui/registration-door";

/**
 * §NNN — the listing card's registration line, as words: the pure half of `CardRegistration`,
 * over the real catalogues. `card-registration.test.ts` renders every state from a real database;
 * this covers what a database cannot be made to do on cue — a count that could not be read (§281)
 * — and pins which states are bold and which carry the page's button.
 */
function translator(locale: "ro" | "en") {
  return createTranslator({ locale, messages: locale === "ro" ? ro.Event : en.Event, namespace: undefined }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
}

const NOW = new Date("2026-09-24T10:00:00.000Z");

/** The fields the line reads; the rest of a public row is not consulted. */
function race(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    slug: "cros",
    timezone: "Europe/Bucharest",
    registrationMode: "INTERNAL",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-11-21T07:00:00.000Z"),
    registrationOpensAt: null,
    registrationClosesAt: new Date("2026-09-26T07:00:00.000Z"),
    publishedAt: new Date("2026-09-01T10:00:00.000Z"),
    externalRegistrationUrl: null,
    externalProvider: null,
    ...overrides,
  } as PublicEvent;
}

const known = (cta: Extract<RegistrationDoor, { kind: "KNOWN" }>["cta"], fill: { taken: number; capacity: number } | null = null): RegistrationDoor => ({
  kind: "KNOWN",
  cta,
  fill,
});

describe("§NNN cardRegistrationLine — the card's registration, in words", () => {
  it("says the window and the free places, in bold, with the page's register button", () => {
    const line = cardRegistrationLine(translator("ro"), "ro", race(), NOW, known({ kind: "OPEN", availablePlaces: 7 }, { taken: 3, capacity: 10 }));
    expect(line).toEqual({
      lead: "Înscrieri deschise până pe sâm., 26 sept. 2026, 10:00",
      detail: "7 locuri libere din 10",
      bold: true,
      button: { cta: { kind: "OPEN", availablePlaces: 7 }, label: "Înscrie-te la eveniment" },
    });
  });

  it("shows no number for an uncapped race, and still the button (BR-REQ-034-01 criterion 4)", () => {
    const line = cardRegistrationLine(translator("en"), "en", race(), NOW, known({ kind: "OPEN", availablePlaces: null }));
    expect(line.detail).toBeNull();
    expect(line.bold).toBe(true);
    expect(line.button?.label).toBe("Register for this event");
  });

  it("says the waiting list once the places are gone, with the waiting list's button", () => {
    const line = cardRegistrationLine(translator("ro"), "ro", race(), NOW, known({ kind: "FULL", waitlistRoom: null }, { taken: 10, capacity: 10 }));
    expect(line.detail).toBe("Lista de așteptare");
    expect(line.button?.label).toBe("Intră pe lista de așteptare");
  });

  it("says the window and no number, and offers no button, when the count could not be read (§281)", () => {
    const line = cardRegistrationLine(translator("ro"), "ro", race(), NOW, { kind: "UNKNOWN" });
    expect(line).toEqual({ lead: "Înscrieri deschise până pe sâm., 26 sept. 2026, 10:00", detail: null, bold: true, button: null });
  });

  it("offers no button on a full list, a closed window or one not open yet — as the page", () => {
    const say = translator("ro");
    for (const cta of [{ kind: "WAITLIST_FULL" }, { kind: "FULL_NO_WAITLIST" }, { kind: "NOT_YET_OPEN", opensAt: new Date("2026-10-01T15:00:00Z") }] as const) {
      const line = cardRegistrationLine(say, "ro", race(), NOW, known(cta));
      expect(line.button, cta.kind).toBeNull();
      expect(line.bold, cta.kind).toBe(true);
    }
    const closed = cardRegistrationLine(say, "ro", race({ registrationClosesAt: new Date(NOW.getTime() - 1) }), NOW, known({ kind: "CLOSED" }));
    expect(closed).toEqual({ lead: "Înscrierile s-au închis", detail: null, bold: false, button: null });
  });

  it("sends an event registered elsewhere to the organizer's page, in the page's words", () => {
    const event = race({ registrationMode: "EXTERNAL", externalRegistrationUrl: "https://entries.example.test/cros", externalProvider: "Entries" });
    const line = cardRegistrationLine(translator("ro"), "ro", event, NOW, known({ kind: "EXTERNAL", url: "https://entries.example.test/cros", provider: "Entries" }));
    expect(line.lead).toBe("Înscriere pe site-ul organizatorului");
    expect(line.button?.label).toBe("Înscrie-te pe Entries");
  });
});
