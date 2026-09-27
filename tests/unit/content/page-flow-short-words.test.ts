import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { BLANK_PAGE_SECTION_DATA, cardStates } from "@/modules/events/domain/page-sections";

/**
 * BR-REQ-050-02 criterion 79 (§406, §481, §NNN) — the page map's chips read `Admin.editor.pageFlow.short.<id>`
 * for every card `cardStates` returns, a key built at run time that the catalogue checker cannot
 * follow. So the catalogue holds exactly those words: none missing (a chip would print its key),
 * none left over. A section asked inside another card (the cost §466, the place and the rules
 * §481) has no chip, and its short word went with it.
 */
describe("the page map's short words are exactly the cards' (§NNN)", () => {
  const cardIds = cardStates(BLANK_PAGE_SECTION_DATA)
    .map((section) => section.id)
    .sort();

  for (const [locale, messages] of [
    ["ro", ro],
    ["en", en],
  ] as const) {
    it(`${locale}: one short word per card, nothing orphaned`, () => {
      const short = messages.Admin.editor.pageFlow.short as Record<string, string>;
      expect(Object.keys(short).sort()).toEqual(cardIds);
      for (const id of cardIds) expect(short[id].trim(), id).not.toBe("");
    });
  }
});
