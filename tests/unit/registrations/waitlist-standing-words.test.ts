import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { waitlistStandingPhrase } from "@/modules/registrations/ui/waitlist-position-words";

/**
 * BR-REQ-035-01, BR-REQ-035-02 (§NNN) — «Ești pe locul 3 din 10 persoane de pe lista de așteptare»,
 * put together from the real catalogues.
 *
 * `createTranslator` builds the same `t` a page gets from `getTranslations("Registrations")`, so a
 * wrong key fails here exactly as it would on the page (`MISSING_MESSAGE`), instead of a fake `say`
 * echoing it back.
 */
function translator(locale: "ro" | "en") {
  const messages = locale === "ro" ? ro.Registrations : en.Registrations;
  return createTranslator({ locale, messages, namespace: undefined }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
}

describe("§NNN waitlistStandingPhrase — the place in the line and the line's length", () => {
  it("reads Romanian's three forms from the line's length: one, a few, and 'de' from twenty on", () => {
    const say = translator("ro");
    expect(waitlistStandingPhrase(say, "ro", { position: 1, length: 1, autoOffer: true })).toBe(
      "Ești pe locul 1 din 1 persoană de pe lista de așteptare. Locurile eliberate se oferă în ordine.",
    );
    expect(waitlistStandingPhrase(say, "ro", { position: 3, length: 10, autoOffer: true })).toBe(
      "Ești pe locul 3 din 10 persoane de pe lista de așteptare. Locurile eliberate se oferă în ordine.",
    );
    expect(waitlistStandingPhrase(say, "ro", { position: 19, length: 19, autoOffer: true })).toContain("din 19 persoane");
    expect(waitlistStandingPhrase(say, "ro", { position: 2, length: 20, autoOffer: true })).toContain("locul 2 din 20 de persoane");
    expect(waitlistStandingPhrase(say, "ro", { position: 2, length: 21, autoOffer: true })).toContain("din 21 de persoane");
    // The hundreds fall back under twenty, as the platform's own rule says (`countForm`).
    expect(waitlistStandingPhrase(say, "ro", { position: 2, length: 101, autoOffer: true })).toContain("din 101 persoane");
  });

  it("reads English with the same numbers", () => {
    const say = translator("en");
    expect(waitlistStandingPhrase(say, "en", { position: 3, length: 10, autoOffer: true })).toBe(
      "You are number 3 of 10 on the waiting list. Freed places are offered in order.",
    );
    expect(waitlistStandingPhrase(say, "en", { position: 1, length: 1, autoOffer: true })).toContain("number 1 of 1");
    expect(waitlistStandingPhrase(say, "en", { position: 4, length: 20, autoOffer: false })).toContain("number 4 of 20");
  });

  it("promises an order only when the event offers on its own (§615)", () => {
    const roSay = translator("ro");
    const auto = waitlistStandingPhrase(roSay, "ro", { position: 2, length: 5, autoOffer: true });
    const club = waitlistStandingPhrase(roSay, "ro", { position: 2, length: 5, autoOffer: false });
    expect(auto).toContain("Locurile eliberate se oferă în ordine.");
    expect(auto).not.toContain("Clubul alege");
    expect(club).toBe("Ești pe locul 2 din 5 persoane de pe lista de așteptare. Clubul alege cui oferă un loc eliberat.");
    expect(club).not.toContain("în ordine");

    const enSay = translator("en");
    expect(waitlistStandingPhrase(enSay, "en", { position: 2, length: 5, autoOffer: false })).toBe(
      "You are number 2 of 5 on the waiting list. The club chooses who is offered a freed place.",
    );
    expect(waitlistStandingPhrase(enSay, "en", { position: 2, length: 5, autoOffer: true })).not.toContain("club chooses");
  });

  it("carries the same numbers in both languages and no name", () => {
    const standing = { position: 7, length: 23, autoOffer: false };
    const numbers = (text: string) => text.match(/\d+/g);
    expect(numbers(waitlistStandingPhrase(translator("en"), "en", standing))).toEqual(numbers(waitlistStandingPhrase(translator("ro"), "ro", standing)));
    expect(numbers(waitlistStandingPhrase(translator("ro"), "ro", standing))).toEqual(["7", "23"]);
  });
});
