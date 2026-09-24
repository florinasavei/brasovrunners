import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { confirmedPhrase, fillPhrase } from "@/modules/events/ui/counted-phrases";

/**
 * §NNN — the two counted sentences an event page can show, assembled from the real catalogues.
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

describe("§NNN fillPhrase — 'taken of capacity', in each language's own wording", () => {
  it("reads Romanian's 'de' rule on both halves of the sentence", () => {
    const say = translator("ro");
    expect(fillPhrase(say, "ro", { taken: 12, capacity: 50 })).toBe("12 înscriși din 50 de locuri");
    expect(fillPhrase(say, "ro", { taken: 1, capacity: 1 })).toBe("1 înscris din 1 loc");
    expect(fillPhrase(say, "ro", { taken: 0, capacity: 50 })).toBe("0 înscriși din 50 de locuri");
    expect(fillPhrase(say, "ro", { taken: 20, capacity: 21 })).toBe("20 de înscriși din 21 de locuri");
  });

  it("reads English without a plural split on the noun", () => {
    const say = translator("en");
    expect(fillPhrase(say, "en", { taken: 12, capacity: 50 })).toBe("12 registered of 50 places");
    expect(fillPhrase(say, "en", { taken: 1, capacity: 1 })).toBe("1 registered of 1 place");
  });
});

describe("§NNN confirmedPhrase — the start list's own header line", () => {
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
