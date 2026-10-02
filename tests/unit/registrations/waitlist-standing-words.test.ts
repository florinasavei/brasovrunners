import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { waitlistStandingPhrase } from "@/modules/registrations/ui/waitlist-position-words";

/**
 * BR-REQ-035-01, BR-REQ-035-02 (§629) — „Ești pe locul 3 din 10” while offers go out in order, the count
 * of the others while the club chooses, put together from the real catalogues.
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

describe("§629 waitlistStandingPhrase — the place in the line and the line's length", () => {
  it("reads Romanian's forms from the line's length: a few, and 'de' from twenty on", () => {
    const say = translator("ro");
    expect(waitlistStandingPhrase(say, "ro", { position: 1, length: 2, autoOffer: true })).toBe(
      "Ești pe locul 1 din 2 persoane de pe lista de așteptare. Locurile eliberate se oferă în ordine.",
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
    expect(waitlistStandingPhrase(say, "en", { position: 1, length: 2, autoOffer: true })).toContain("number 1 of 2");
    expect(waitlistStandingPhrase(say, "en", { position: 4, length: 20, autoOffer: true })).toContain("number 4 of 20");
  });

  it("with offers handed out by hand, says no position: only how many others wait, and that the club chooses", () => {
    const say = translator("ro");
    expect(waitlistStandingPhrase(say, "ro", { position: 3, length: 10, autoOffer: false })).toBe(
      "Ești pe lista de așteptare, împreună cu alte 9 persoane. Clubul alege cui oferă un loc eliberat.",
    );
    const club = waitlistStandingPhrase(say, "ro", { position: 2, length: 5, autoOffer: false });
    expect(club).not.toContain("locul");
    expect(club).not.toContain("în ordine");
    expect(club).not.toContain("din 5");
    // Romanian's forms agree with the number of others: one, a few, and 'de' from twenty on.
    expect(waitlistStandingPhrase(say, "ro", { position: 2, length: 2, autoOffer: false })).toBe(
      "Ești pe lista de așteptare, împreună cu o altă persoană. Clubul alege cui oferă un loc eliberat.",
    );
    expect(waitlistStandingPhrase(say, "ro", { position: 1, length: 20, autoOffer: false })).toContain("împreună cu alte 19 persoane.");
    expect(waitlistStandingPhrase(say, "ro", { position: 1, length: 21, autoOffer: false })).toContain("împreună cu alte 20 de persoane.");
    expect(waitlistStandingPhrase(say, "ro", { position: 1, length: 102, autoOffer: false })).toContain("împreună cu alte 101 persoane.");
    // Alone on the line.
    expect(waitlistStandingPhrase(say, "ro", { position: 1, length: 1, autoOffer: false })).toBe(
      "Ești singura persoană pe lista de așteptare. Clubul alege cui oferă un loc eliberat.",
    );
  });

  it("alone in the line, says so in both readings of the setting, never «locul 1 din 1 persoană»", () => {
    const alone = { position: 1, length: 1 };
    expect(waitlistStandingPhrase(translator("ro"), "ro", { ...alone, autoOffer: true })).toBe(
      "Ești singura persoană pe lista de așteptare. Locurile eliberate se oferă în ordine.",
    );
    expect(waitlistStandingPhrase(translator("ro"), "ro", { ...alone, autoOffer: false })).toBe(
      "Ești singura persoană pe lista de așteptare. Clubul alege cui oferă un loc eliberat.",
    );
    expect(waitlistStandingPhrase(translator("en"), "en", { ...alone, autoOffer: true })).toBe(
      "You are the only person on the waiting list. Freed places are offered in order.",
    );
    expect(waitlistStandingPhrase(translator("ro"), "ro", { ...alone, autoOffer: true })).not.toContain("locul 1");
  });

  it("says the same in English", () => {
    const say = translator("en");
    expect(waitlistStandingPhrase(say, "en", { position: 3, length: 10, autoOffer: false })).toBe(
      "You are on the waiting list, with 9 others. The club chooses whom to offer a freed place.",
    );
    expect(waitlistStandingPhrase(say, "en", { position: 2, length: 2, autoOffer: false })).toBe(
      "You are on the waiting list, with 1 other. The club chooses whom to offer a freed place.",
    );
    expect(waitlistStandingPhrase(say, "en", { position: 1, length: 1, autoOffer: false })).toBe(
      "You are the only person on the waiting list. The club chooses whom to offer a freed place.",
    );
  });

  it("promises an order only when the event offers on its own (§615)", () => {
    const roSay = translator("ro");
    const auto = waitlistStandingPhrase(roSay, "ro", { position: 2, length: 5, autoOffer: true });
    expect(auto).toBe("Ești pe locul 2 din 5 persoane de pe lista de așteptare. Locurile eliberate se oferă în ordine.");
    expect(auto).not.toContain("Clubul alege");
    expect(waitlistStandingPhrase(translator("en"), "en", { position: 2, length: 5, autoOffer: true })).not.toContain("club chooses");
  });

  it("carries the same numbers in both languages and no name", () => {
    const numbers = (text: string) => text.match(/\d+/g);
    const auto = { position: 7, length: 23, autoOffer: true };
    expect(numbers(waitlistStandingPhrase(translator("en"), "en", auto))).toEqual(numbers(waitlistStandingPhrase(translator("ro"), "ro", auto)));
    expect(numbers(waitlistStandingPhrase(translator("ro"), "ro", auto))).toEqual(["7", "23"]);
    // The club's choice reveals the line's size and nothing of the order: the position is nowhere in it.
    const club = { position: 7, length: 23, autoOffer: false };
    expect(numbers(waitlistStandingPhrase(translator("ro"), "ro", club))).toEqual(["22"]);
    expect(numbers(waitlistStandingPhrase(translator("en"), "en", club))).toEqual(["22"]);
  });
});
