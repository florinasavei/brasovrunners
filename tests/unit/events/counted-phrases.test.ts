import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { confirmedPhrase, fillPhrase, startListHeadline, waitlistOfferPhrase, waitlistRoomPhrase } from "@/modules/events/ui/counted-phrases";

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

describe("§615 fillPhrase — the places held and not yet confirmed", () => {
  it("says the two parts in Romanian when some are in progress, and the plain line when none are", () => {
    const say = translator("ro");
    expect(fillPhrase(say, "ro", { taken: 105, capacity: 150, confirmed: 86 })).toBe("105 înscriși din 150 de locuri — 86 de confirmați, 19 în curs de confirmare");
    expect(fillPhrase(say, "ro", { taken: 12, capacity: 50, confirmed: 11 })).toBe("12 înscriși din 50 de locuri — 11 confirmați, 1 în curs de confirmare");
    expect(fillPhrase(say, "ro", { taken: 12, capacity: 50, confirmed: 1 })).toBe("12 înscriși din 50 de locuri — 1 confirmat, 11 în curs de confirmare");
    expect(fillPhrase(say, "ro", { taken: 12, capacity: 50, confirmed: 12 })).toBe("12 înscriși din 50 de locuri");
    expect(fillPhrase(say, "ro", { taken: 12, capacity: 50 })).toBe("12 înscriși din 50 de locuri");
  });

  it("names the places kept for the waiting list, with or without anybody in progress (§615)", () => {
    const say = translator("ro");
    expect(fillPhrase(say, "ro", { taken: 6, capacity: 10, confirmed: 4, kept: 4 })).toBe("6 înscriși din 10 locuri — 4 confirmați, 2 în curs de confirmare, 4 locuri păstrate pentru lista de așteptare");
    expect(fillPhrase(say, "ro", { taken: 6, capacity: 10, confirmed: 6, kept: 4 })).toBe("6 înscriși din 10 locuri — 4 locuri păstrate pentru lista de așteptare");
    expect(fillPhrase(say, "ro", { taken: 6, capacity: 30, confirmed: 6, kept: 1 })).toBe("6 înscriși din 30 de locuri — 1 loc păstrat pentru lista de așteptare");
    expect(fillPhrase(say, "ro", { taken: 6, capacity: 30, confirmed: 6, kept: 20 })).toBe("6 înscriși din 30 de locuri — 20 de locuri păstrate pentru lista de așteptare");
    const en = translator("en");
    expect(fillPhrase(en, "en", { taken: 6, capacity: 10, confirmed: 4, kept: 4 })).toBe("6 registered of 10 places — 4 confirmed, 2 completing their registration, 4 places kept for the waiting list");
    expect(fillPhrase(en, "en", { taken: 6, capacity: 10, confirmed: 6, kept: 4 })).toBe("6 registered of 10 places — 4 places kept for the waiting list");
  });

  it("says them in English, and the same numbers as Romanian", () => {
    const say = translator("en");
    expect(fillPhrase(say, "en", { taken: 105, capacity: 150, confirmed: 86 })).toBe("105 registered of 150 places — 86 confirmed, 19 completing their registration");
    expect(fillPhrase(say, "en", { taken: 12, capacity: 50, confirmed: 12 })).toBe("12 of 50 places taken");
    const fill = { taken: 105, capacity: 150, confirmed: 86 };
    const numbers = (text: string) => text.match(/\d+/g);
    expect(numbers(fillPhrase(say, "en", fill))).toEqual(numbers(fillPhrase(translator("ro"), "ro", fill)));
  });
});

describe("§629 fillPhrase — the people waiting, the places line's last part", () => {
  it("adds «N pe lista de așteptare» after the other parts, or alone, when anybody waits", () => {
    const say = translator("ro");
    expect(fillPhrase(say, "ro", { taken: 150, capacity: 150, confirmed: 133, waitlisted: 10 })).toBe(
      "150 de înscriși din 150 de locuri — 133 de confirmați, 17 în curs de confirmare, 10 pe lista de așteptare",
    );
    expect(fillPhrase(say, "ro", { taken: 150, capacity: 150, confirmed: 133, kept: 4, waitlisted: 10 })).toBe(
      "150 de înscriși din 150 de locuri — 133 de confirmați, 17 în curs de confirmare, 4 locuri păstrate pentru lista de așteptare, 10 pe lista de așteptare",
    );
    expect(fillPhrase(say, "ro", { taken: 12, capacity: 50, confirmed: 12, waitlisted: 3 })).toBe("12 înscriși din 50 de locuri — 3 pe lista de așteptare");
    // No confirmed count at all (a cache entry from before it): the plain line, then the line's length.
    expect(fillPhrase(say, "ro", { taken: 12, capacity: 50, waitlisted: 1 })).toBe("12 înscriși din 50 de locuri — 1 pe lista de așteptare");
    const en = translator("en");
    expect(fillPhrase(en, "en", { taken: 12, capacity: 50, confirmed: 12, waitlisted: 3 })).toBe("12 registered of 50 places — 3 on the waiting list");
    expect(fillPhrase(en, "en", { taken: 12, capacity: 50, confirmed: 10, waitlisted: 3 })).toBe(
      "12 registered of 50 places — 10 confirmed, 2 completing their registration, 3 on the waiting list",
    );
  });

  it("adds nothing when nobody waits, and the line is as it was", () => {
    const say = translator("ro");
    expect(fillPhrase(say, "ro", { taken: 12, capacity: 50, confirmed: 12 })).toBe("12 înscriși din 50 de locuri");
    expect(fillPhrase(say, "ro", { taken: 12, capacity: 50, confirmed: 12, waitlisted: 0 })).toBe("12 înscriși din 50 de locuri");
    expect(fillPhrase(say, "ro", { taken: 12, capacity: 50, confirmed: 10, waitlisted: 0 })).toBe(
      "12 înscriși din 50 de locuri — 10 confirmați, 2 în curs de confirmare",
    );
  });

  it("leaves the number out when the page asks (the full state's lead already says it, §587)", () => {
    const say = translator("ro");
    expect(fillPhrase(say, "ro", { taken: 150, capacity: 150, confirmed: 150, waitlisted: 10 }, { withWaiting: false })).toBe("150 de înscriși din 150 de locuri");
    expect(fillPhrase(say, "ro", { taken: 150, capacity: 150, confirmed: 150, waitlisted: 10 }, { withWaiting: true })).toContain("10 pe lista de așteptare");
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

  it("§587 has the two sentences a full line and an event with no list say, kindly, in both catalogues", () => {
    expect(translator("ro")("cta.waitlistFull")).toBe("Locurile s-au ocupat și lista de așteptare e plină — ne pare rău.");
    expect(translator("en")("cta.waitlistFull")).toBe("All places are taken and the waiting list is full — sorry.");
    expect(translator("ro")("cta.fullNoWaitlist")).toBe("Locurile s-au ocupat, iar acest eveniment nu are listă de așteptare.");
    expect(translator("en")("cta.fullNoWaitlist")).toBe("All places are taken, and this event has no waiting list.");
  });
});

describe("§587 waitlistOfferPhrase — how an offer works, with the club's own hours", () => {
  it("says the offer window the club set, in the site's hour words", () => {
    const ro = translator("ro");
    expect(waitlistOfferPhrase(ro, "ro", 24)).toBe(
      "Când se eliberează un loc, primești un email și ai 24 de ore să confirmi — altfel locul trece mai departe.",
    );
    expect(waitlistOfferPhrase(ro, "ro", 12)).toContain("ai 12 ore să confirmi");
    expect(waitlistOfferPhrase(ro, "ro", 48)).toContain("ai 48 de ore să confirmi");
    const en = translator("en");
    expect(waitlistOfferPhrase(en, "en", 24)).toBe("When a place frees up, you get an email and 24 hours to confirm — then it passes on.");
    expect(waitlistOfferPhrase(en, "en", 6)).toContain("6 hours to confirm");
  });

  it("stays under 200 characters at the longest window the club may set", () => {
    for (const locale of ["ro", "en"] as const) expect(waitlistOfferPhrase(translator(locale), locale, 72).length).toBeLessThanOrEqual(200);
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

describe("§632 startListHeadline — the «Cine vine» title and line count everyone with a place", () => {
  it("adds those completing their registration on a capped event, and says the split, in Romanian", () => {
    const say = translator("ro");
    // The owner's race of 2026-10-02.
    expect(startListHeadline(say, "ro", { confirmed: 134, named: 120 }, { taken: 150, capacity: 150, confirmed: 134 })).toEqual({
      count: 150,
      inProgress: 16,
      line: "150 de înscriși — 134 de confirmați (120 cu numele afișat), 16 în curs de confirmare",
    });
    expect(startListHeadline(say, "ro", { confirmed: 4, named: 3 }, { taken: 6, capacity: 10, confirmed: 4 }).line).toBe(
      "6 înscriși — 4 confirmați (3 cu numele afișat), 2 în curs de confirmare",
    );
    expect(startListHeadline(say, "ro", { confirmed: 1, named: 1 }, { taken: 2, capacity: 10, confirmed: 1 }).line).toBe(
      "2 înscriși — 1 confirmat (1 cu numele afișat), 1 în curs de confirmare",
    );
  });

  it("says the same in English", () => {
    const say = translator("en");
    expect(startListHeadline(say, "en", { confirmed: 134, named: 120 }, { taken: 150, capacity: 150, confirmed: 134 }).line).toBe(
      "150 registered — 134 confirmed (120 with their name shown), 16 completing their registration",
    );
  });

  it("is today's title and line with nothing in progress, on an uncapped event, and from an entry without the counts", () => {
    for (const locale of ["ro", "en"] as const) {
      const say = translator(locale);
      const counts = { confirmed: 134, named: 120 };
      const today = { count: 134, inProgress: 0, line: confirmedPhrase(say, locale, counts) };
      expect(startListHeadline(say, locale, counts, { taken: 134, capacity: 150, confirmed: 134 })).toEqual(today);
      expect(startListHeadline(say, locale, counts, null)).toEqual(today);
      expect(startListHeadline(say, locale, counts, { taken: 150, capacity: 150 })).toEqual(today);
    }
  });
});

describe("§NNN startListHeadline — «Numără și lista ascunsă» adds the hidden list's holds to «în curs»", () => {
  it("adds them where the places line is known, and never on an uncapped event", () => {
    const say = translator("ro");
    // 134 counted confirmed + 2 on the hidden list; 16 counted in progress + 1 hidden-list hold.
    expect(startListHeadline(say, "ro", { confirmed: 136, named: 121 }, { taken: 150, capacity: 150, confirmed: 134 }, 1)).toEqual({
      count: 153,
      inProgress: 17,
      line: "153 de înscriși — 136 de confirmați (121 cu numele afișat), 17 în curs de confirmare",
    });
    // Uncapped: no head count of held places (§32), the hidden list's neither.
    expect(startListHeadline(say, "ro", { confirmed: 3, named: 3 }, null, 2)).toEqual({ count: 3, inProgress: 0, line: confirmedPhrase(say, "ro", { confirmed: 3, named: 3 }) });
    // 0 is today's reading.
    expect(startListHeadline(say, "ro", { confirmed: 4, named: 3 }, { taken: 6, capacity: 10, confirmed: 4 }, 0)).toEqual(
      startListHeadline(say, "ro", { confirmed: 4, named: 3 }, { taken: 6, capacity: 10, confirmed: 4 }),
    );
  });
});
