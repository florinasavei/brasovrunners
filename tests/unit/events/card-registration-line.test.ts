import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { PublicEvent } from "@/modules/events/repository";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CardRegistration, { cardRegistrationLine, SLOT } from "@/modules/events/ui/CardRegistration";
import type { RegistrationDoor } from "@/modules/events/ui/registration-door";

/**
 * §409 — the listing card's registration line, as words: the pure half of `CardRegistration`,
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

describe("§409 cardRegistrationLine — the card's registration, in words", () => {
  it("says the window and the free places, in bold, with the page's register button", () => {
    const line = cardRegistrationLine(translator("ro"), "ro", race(), NOW, known({ kind: "OPEN", availablePlaces: 7, waiting: 0 }, { taken: 3, capacity: 10 }));
    expect(line).toEqual({
      lead: "Înscrieri deschise până sâm., 26 sept. 2026, la 10:00",
      leadParts: { before: "Înscrieri deschise până ", fact: "sâm., 26 sept. 2026, la 10:00", after: "" },
      detail: "7 locuri libere din 10",
      detailParts: { before: "", fact: "7 locuri libere", after: " din 10" },
      bold: true,
      button: { cta: { kind: "OPEN", availablePlaces: 7, waiting: 0 }, label: "Înscrie-te la eveniment" },
    });
  });

  it("shows no number for an uncapped race, and still the button (BR-REQ-034-01 criterion 4)", () => {
    const line = cardRegistrationLine(translator("en"), "en", race(), NOW, known({ kind: "OPEN", availablePlaces: null, waiting: 0 }));
    expect(line.detail).toBeNull();
    expect(line.bold).toBe(true);
    expect(line.button?.label).toBe("Register for this event");
  });

  it("§NNN says kindly that the places are taken and what the list does, the window quiet under it, with the waiting list's button", () => {
    const line = cardRegistrationLine(translator("ro"), "ro", race(), NOW, known({ kind: "FULL", waitlistRoom: null, waiting: 0 }, { taken: 10, capacity: 10 }));
    const thanks = "Mulțumim! Toate cele 10 locuri s-au ocupat. Fii primul pe lista de așteptare.";
    expect(line).toEqual({
      lead: thanks,
      leadParts: { before: "", fact: thanks, after: "" },
      detail: null,
      detailParts: null,
      note: "Intră pe lista de așteptare — te anunțăm pe email când se eliberează un loc.",
      quietLine: "Înscrieri deschise până sâm., 26 sept. 2026, la 10:00",
      bold: true,
      button: { cta: { kind: "FULL", waitlistRoom: null, waiting: 0 }, label: "Intră pe lista de așteptare" },
    });
    const en = cardRegistrationLine(translator("en"), "en", race(), NOW, known({ kind: "FULL", waitlistRoom: 3, waiting: 0 }));
    expect(en.lead).toBe("All places are taken.");
    const waiting = cardRegistrationLine(translator("en"), "en", race(), NOW, known({ kind: "FULL", waitlistRoom: 3, waiting: 4 }, { taken: 50, capacity: 50 }));
    expect(waiting.lead).toBe("Thank you! All 50 places are taken — 4 already waiting.");
    const ro50 = cardRegistrationLine(translator("ro"), "ro", race(), NOW, known({ kind: "FULL", waitlistRoom: null, waiting: 3 }, { taken: 50, capacity: 50 }));
    expect(ro50.lead).toBe("Mulțumim! Toate cele 50 de locuri s-au ocupat — 3 așteaptă deja un loc.");
    expect(en.note).toBe("Join the waiting list — we email you when a place frees up.");
    expect(en.quietLine).toMatch(/^Registration open until /);
    expect(en.button?.label).toBe("Join the waiting list");
  });

  it("§NNN says how many wait beside the free places, once anybody does", () => {
    const line = cardRegistrationLine(translator("ro"), "ro", race(), NOW, known({ kind: "OPEN", availablePlaces: 1, waiting: 2 }, { taken: 9, capacity: 10 }));
    expect(line.detail).toBe("1 loc liber din 10 · 2 pe lista de așteptare");
  });

  it("§NNN keeps the full event's words short enough for a phone", () => {
    for (const locale of ["ro", "en"] as const) {
      const say = translator(locale);
      for (const key of ["cta.fullLead", "cta.fullJoin", "cta.waitlistFull", "cta.fullNoWaitlist", "cta.fullThanks.other", "cta.fullThanksFirst.other", "cta.waitingCount"]) {
        expect(say(key).length, `${locale} ${key}`).toBeLessThanOrEqual(200);
        expect(say(key), `${locale} ${key}`).not.toMatch(/platform|de obicei/i);
      }
    }
  });

  it("says the window and no number, and offers no button, when the count could not be read (§281)", () => {
    const line = cardRegistrationLine(translator("ro"), "ro", race(), NOW, { kind: "UNKNOWN" });
    expect(line).toEqual({ lead: "Înscrieri deschise până sâm., 26 sept. 2026, la 10:00",
      leadParts: { before: "Înscrieri deschise până ", fact: "sâm., 26 sept. 2026, la 10:00", after: "" }, detail: null, detailParts: null, bold: true, button: null });
  });

  it("offers no button on a full list, a closed window or one not open yet — as the page", () => {
    const say = translator("ro");
    for (const cta of [{ kind: "WAITLIST_FULL" }, { kind: "FULL_NO_WAITLIST" }, { kind: "NOT_YET_OPEN", opensAt: new Date("2026-10-01T15:00:00Z") }] as const) {
      const line = cardRegistrationLine(say, "ro", race(), NOW, known(cta));
      expect(line.button, cta.kind).toBeNull();
      expect(line.bold, cta.kind).toBe(true);
    }
    const closed = cardRegistrationLine(say, "ro", race({ registrationClosesAt: new Date(NOW.getTime() - 1) }), NOW, known({ kind: "CLOSED" }));
    expect(closed).toEqual({ lead: "Înscrierile s-au închis", leadParts: null, detail: null, detailParts: null, bold: false, button: null });
  });

  it("sends the featured card's registered runners to the desk once the window closes in race week (§78, on the card since §470)", () => {
    const closedRace = race({ registrationClosesAt: new Date(NOW.getTime() - 1) });
    const ro = cardRegistrationLine(translator("ro"), "ro", closedRace, NOW, known({ kind: "CLOSED" }), true);
    expect(ro).toEqual({ lead: "Înscrierile s-au închis — vino la masă cu QR-ul din email.", leadParts: null, detail: null, detailParts: null, bold: true, button: null });
    const en = cardRegistrationLine(translator("en"), "en", closedRace, NOW, known({ kind: "CLOSED" }), true);
    expect(en.lead).toBe("Registration has closed — come to the desk with the QR from your email.");
    // Race week changes nothing but the closed sentence: an open window reads as it always did.
    const open = cardRegistrationLine(translator("ro"), "ro", race(), NOW, known({ kind: "OPEN", availablePlaces: null, waiting: 0 }), true);
    expect(open).toEqual(cardRegistrationLine(translator("ro"), "ro", race(), NOW, known({ kind: "OPEN", availablePlaces: null, waiting: 0 })));
  });

  it("says «soon», bold and with no button, when the opening has no date yet (§451)", () => {
    const ro = cardRegistrationLine(translator("ro"), "ro", race(), NOW, known({ kind: "NOT_YET_OPEN", opensAt: null }));
    expect(ro).toEqual({ lead: "Înscrierile se deschid în curând", leadParts: null, detail: null, detailParts: null, bold: true, button: null });
    const en = cardRegistrationLine(translator("en"), "en", race(), NOW, known({ kind: "NOT_YET_OPEN", opensAt: null }));
    expect(en.lead).toBe("Registration opens soon");
  });

  it("sends an event registered elsewhere to the organizer's page, in the page's words", () => {
    const event = race({ registrationMode: "EXTERNAL", externalRegistrationUrl: "https://entries.example.test/cros", externalProvider: "Entries" });
    const line = cardRegistrationLine(translator("ro"), "ro", event, NOW, known({ kind: "EXTERNAL", url: "https://entries.example.test/cros", provider: "Entries" }));
    expect(line.lead).toBe("Înscriere pe site-ul organizatorului");
    expect(line.button?.label).toBe("Înscrie-te pe Entries");
  });
});

describe("§472 CardRegistration — only the date, the hour and the free places in bold", () => {
  const strongs = (html: string) => [...html.matchAll(/<strong[^>]*>([^<]*)<\/strong>/g)].map((m) => m[1]);
  const text = (html: string) => html.replace(/<style[^>]*>[^<]*<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
  const render = (locale: "ro" | "en", door: RegistrationDoor, event = race(), raceWeek = false) =>
    renderToStaticMarkup(createElement(CardRegistration, { slug: "cros", line: { ...cardRegistrationLine(translator(locale), locale, event, NOW, door, raceWeek), button: null } }));
  // The button (a client island with its own intl context) is §409's, unchanged; the line is what is read here.

  it("bolds the closing date with its hour and «7 locuri libere», never the words around them (RO)", () => {
    const html = render("ro", known({ kind: "OPEN", availablePlaces: 7, waiting: 0 }, { taken: 3, capacity: 10 }));
    expect(strongs(html)).toEqual(["sâm., 26 sept. 2026, la 10:00", "7 locuri libere"]);
    expect(text(html)).toContain("Înscrieri deschise până sâm., 26 sept. 2026, la 10:00 · 7 locuri libere din 10");
  });

  it("does the same in English", () => {
    const html = render("en", known({ kind: "OPEN", availablePlaces: 1, waiting: 0 }, { taken: 9, capacity: 10 }));
    expect(strongs(html)).toHaveLength(2);
    expect(strongs(html)[1]).toBe("1 place left");
    expect(text(html)).toContain(`${strongs(html)[1]} out of 10`);
    expect(text(html)).toContain(`Registration open until ${strongs(html)[0]}`);
  });

  it("bolds the opening date alone", () => {
    const html = render("ro", known({ kind: "NOT_YET_OPEN", opensAt: new Date("2026-10-01T15:00:00Z") }));
    expect(strongs(html)).toHaveLength(1);
    expect(text(html)).toContain(`Înscrierile se deschid ${strongs(html)[0]}`);
  });

  it("bolds nothing in a sentence with no date or count, in either language", () => {
    const closed = race({ registrationClosesAt: new Date(NOW.getTime() - 1) });
    for (const locale of ["ro", "en"] as const) {
      for (const door of [known({ kind: "WAITLIST_FULL" }), known({ kind: "FULL_NO_WAITLIST" }), known({ kind: "NOT_YET_OPEN", opensAt: null })]) {
        expect(strongs(render(locale, door)), `${locale} ${door.kind === "KNOWN" && door.cta.kind}`).toEqual([]);
      }
      expect(strongs(render(locale, known({ kind: "CLOSED" }), closed, true))).toEqual([]);
      expect(strongs(render(locale, known({ kind: "CLOSED" }), closed))).toEqual([]);
    }
  });

  it("§NNN bolds «Locurile s-au ocupat.» alone on a full event, the list's sentence and the quiet window under it", () => {
    const html = render("ro", known({ kind: "FULL", waitlistRoom: null, waiting: 2 }, { taken: 10, capacity: 10 }));
    expect(strongs(html)).toEqual(["Mulțumim! Toate cele 10 locuri s-au ocupat — 2 așteaptă deja un loc."]);
    expect(text(html)).toContain(
      "Mulțumim! Toate cele 10 locuri s-au ocupat — 2 așteaptă deja un loc. Intră pe lista de așteptare — te anunțăm pe email când se eliberează un loc. Înscrieri deschise până sâm., 26 sept. 2026, la 10:00",
    );
    expect(html).toContain('data-testid="card-waitlist-note"');
    expect(html).not.toContain('data-testid="card-places"');
    expect(strongs(render("en", known({ kind: "FULL", waitlistRoom: null, waiting: 0 })))).toEqual(["All places are taken."]);
  });
});

describe("§472 the slot marker — printable, and in no catalogue sentence", () => {
  it("is visible text, and neither catalogue carries it anywhere", () => {
    expect(SLOT).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.stringify(ro)).not.toContain(SLOT);
    expect(JSON.stringify(en)).not.toContain(SLOT);
  });
});
