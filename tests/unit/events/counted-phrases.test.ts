import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { confirmedPhrase, fillPhrase, freePlacesPhrase, waitlistRoomPhrase } from "@/modules/events/ui/counted-phrases";

/**
 * §346 — the two counted sentences an event page can show, assembled from the real catalogues.
 *
 * `createTranslator` (not `next-intl/server`, which needs a live request) builds the same `t`
 * a page gets from `getTranslations("Event")`, against the actual `messages/*.json` content —
 * so a typo in a key here fails exactly as it would on the page, via next-intl's own
 * `MISSING_MESSAGE` error, rather than a fake `say` that would happily echo back a wrong key.
 */
function translator(locale: "ro" | "en") {
  const messages = locale === "ro" ? ro.Event : en.Event;
  return createTranslator({ locale, messages, namespace: undefined }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
}

describe("§346 fillPhrase — 'taken of capacity', in each language's own wording", () => {
  it("reads Romanian's 'de' rule on both halves of the sentence", () => {
    const say = translator("ro");
    expect(fillPhrase(say, "ro", { taken: 12, capacity: 50 })).toBe("12 înscriși din 50 de locuri");
    expect(fillPhrase(say, "ro", { taken: 1, capacity: 1 })).toBe("1 înscris din 1 loc");
    expect(fillPhrase(say, "ro", { taken: 0, capacity: 50 })).toBe("0 înscriși din 50 de locuri");
    expect(fillPhrase(say, "ro", { taken: 20, capacity: 21 })).toBe("20 de înscriși din 21 de locuri");
  });

  /**
   * Integration review (§346 public fill count): "12 registered of 50 places" is Romanian word
   * order in English. The English sentence is the natural one — "12 of 50 places taken" — built
   * from the same two numbers and the same keys, only the catalogue's words differ.
   */
  it("reads natural English: 'N of M places taken', the noun agreeing with the capacity", () => {
    const say = translator("en");
    expect(fillPhrase(say, "en", { taken: 12, capacity: 50 })).toBe("12 of 50 places taken");
    expect(fillPhrase(say, "en", { taken: 1, capacity: 1 })).toBe("1 of 1 place taken");
    expect(fillPhrase(say, "en", { taken: 0, capacity: 50 })).toBe("0 of 50 places taken");
    expect(fillPhrase(say, "en", { taken: 20, capacity: 21 })).toBe("20 of 21 places taken");
    expect(fillPhrase(say, "en", { taken: 12, capacity: 50 })).not.toContain("registered of");
  });

  it("says the same two numbers in both languages", () => {
    for (const fill of [{ taken: 12, capacity: 50 }, { taken: 1, capacity: 1 }, { taken: 20, capacity: 21 }]) {
      const numbers = (text: string) => text.match(/\d+/g);
      expect(numbers(fillPhrase(translator("en"), "en", fill))).toEqual(numbers(fillPhrase(translator("ro"), "ro", fill)));
    }
  });
});

describe("§348 waitlistRoomPhrase — the room a capped waiting list has left", () => {
  it("reads Romanian's singular, its plural and its 'de' from twenty on", () => {
    const say = translator("ro");
    expect(waitlistRoomPhrase(say, "ro", 1)).toBe("Mai este 1 loc pe lista de așteptare");
    expect(waitlistRoomPhrase(say, "ro", 19)).toBe("Mai sunt 19 locuri pe lista de așteptare");
    expect(waitlistRoomPhrase(say, "ro", 20)).toBe("Mai sunt 20 de locuri pe lista de așteptare");
    expect(waitlistRoomPhrase(say, "ro", 21)).toBe("Mai sunt 21 de locuri pe lista de așteptare");
    // The hundreds fall back under twenty, as the platform's own rule says.
    expect(waitlistRoomPhrase(say, "ro", 101)).toBe("Mai sunt 101 locuri pe lista de așteptare");
  });

  it("reads English with one singular and one plural", () => {
    const say = translator("en");
    expect(waitlistRoomPhrase(say, "en", 1)).toBe("1 place left on the waiting list");
    expect(waitlistRoomPhrase(say, "en", 19)).toBe("19 places left on the waiting list");
    expect(waitlistRoomPhrase(say, "en", 20)).toBe("20 places left on the waiting list");
    expect(waitlistRoomPhrase(say, "en", 21)).toBe("21 places left on the waiting list");
  });

  it("has the two sentences a full line and a closed event say, in both catalogues", () => {
    expect(translator("ro")("cta.waitlistFull")).toBe("Locurile și lista de așteptare sunt pline.");
    expect(translator("en")("cta.waitlistFull")).toBe("The places and the waiting list are full.");
    expect(translator("ro")("cta.fullNoWaitlist")).not.toMatch(/așteptare/);
    expect(translator("en")("cta.fullNoWaitlist")).not.toMatch(/waiting/);
  });
});

describe("§409 freePlacesPhrase — the listing card's free places, out of the event's size", () => {
  it("reads Romanian's singular, its plural and its 'de' from twenty on, the free number choosing", () => {
    const say = translator("ro");
    expect(freePlacesPhrase(say, "ro", 1, 10)).toBe("1 loc liber din 10");
    expect(freePlacesPhrase(say, "ro", 7, 10)).toBe("7 locuri libere din 10");
    expect(freePlacesPhrase(say, "ro", 19, 50)).toBe("19 locuri libere din 50");
    expect(freePlacesPhrase(say, "ro", 20, 50)).toBe("20 de locuri libere din 50");
    expect(freePlacesPhrase(say, "ro", 101, 150)).toBe("101 locuri libere din 150");
  });

  it("reads natural English, the noun agreeing with the free number", () => {
    const say = translator("en");
    expect(freePlacesPhrase(say, "en", 1, 10)).toBe("1 place left out of 10");
    expect(freePlacesPhrase(say, "en", 7, 10)).toBe("7 places left out of 10");
    expect(freePlacesPhrase(say, "en", 20, 50)).toBe("20 places left out of 50");
  });
});

describe("§346 confirmedPhrase — the start list's own header line", () => {
  it("names the total and how many of them are named, in Romanian", () => {
    const say = translator("ro");
    expect(confirmedPhrase(say, "ro", { confirmed: 42, named: 39 })).toBe(
      "42 de participanți confirmați — 39 cu numele afișat",
    );
    expect(confirmedPhrase(say, "ro", { confirmed: 1, named: 0 })).toBe(
      "1 participant confirmat — 0 cu numele afișat",
    );
  });

  it("names the total and how many of them are named, in English", () => {
    const say = translator("en");
    expect(confirmedPhrase(say, "en", { confirmed: 42, named: 39 })).toBe(
      "42 confirmed participants — 39 with their name shown",
    );
    expect(confirmedPhrase(say, "en", { confirmed: 1, named: 1 })).toBe(
      "1 confirmed participant — 1 with their name shown",
    );
  });
});
