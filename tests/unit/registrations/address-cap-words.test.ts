import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { countForm } from "@/i18n/count-form";
import { ADDRESS_CAP_MERGE_FIELD, addressCapMergeValues, mergeLegalBody, mergeFieldsIn } from "@/modules/legal-documents/domain/merge-fields";
import { termsEn, termsRo } from "@/modules/legal-documents/templates/terms";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";

/**
 * BR-REQ-032-03 — the club's limit per address, said wherever a participant meets it (§389, §576;
 * the owner, 2026-09-30: up to four people on one email address, and the limit stated). The words
 * come from the catalogues in both languages, counted with the site's count words (`countForm`, no
 * ICU plurals), and the terms' template names the limit as a merge field, never a literal.
 */
const catalogues = { ro, en } as const;
const translator = (locale: "ro" | "en", namespace: "Registration" | "Registrations") =>
  createTranslator({ locale, messages: catalogues[locale] as typeof ro, namespace });

function people(locale: "ro" | "en", count: number): string {
  return translator(locale, "Registration")(`addressCap.people.${countForm(count, locale)}` as "addressCap.people.few", { count });
}

describe("§576 the limit per address in words", () => {
  it("the rule under the form's address box, in both languages", () => {
    expect(translator("ro", "Registration")("addressCap.rule", { people: people("ro", 4) })).toBe(
      "Cu aceeași adresă de email se pot înscrie cel mult 4 persoane la un eveniment, de exemplu o familie. Fiecare își semnează singură declarația.",
    );
    expect(translator("en", "Registration")("addressCap.rule", { people: people("en", 4) })).toBe(
      "One email address may register at most 4 people for an event, a family for instance. Each person signs their own declaration.",
    );
    expect(people("ro", 20)).toBe("20 de persoane");
    expect(people("ro", 1)).toBe("o persoană");
  });

  it("«N din 4» on the family's screen, and the rule at the limit", () => {
    const t = translator("ro", "Registration");
    expect(t(`sitting.count.${countForm(4, "ro")}` as "sitting.count.few", { count: 2, max: 4 })).toBe("2 din 4 persoane cu această adresă");
    expect(translator("en", "Registration")(`sitting.count.${countForm(4, "en")}` as "sitting.count.other", { count: 2, max: 4 })).toBe("2 of 4 people on this address");
    expect(t("sitting.atCap", { people: people("ro", 4) })).toContain("cel mult 4 persoane la un eveniment");
    expect(t("errors.sittingAtCap", { people: people("ro", 4) })).toContain("cel mult 4 persoane la un eveniment");
    expect(translator("en", "Registration")("errors.sittingAtCap", { people: people("en", 4) })).toContain("at most 4 people for an event");
  });

  it("«Înscrierile mele»: how many on this address at the event, out of the limit", () => {
    expect(translator("ro", "Registrations")(`mine.perAddress.${countForm(4, "ro")}` as "mine.perAddress.few", { count: 1, max: 4 })).toBe(
      "Cu această adresă, la acest eveniment: 1 din cel mult 4 persoane.",
    );
    expect(translator("en", "Registrations")(`mine.perAddress.${countForm(4, "en")}` as "mine.perAddress.other", { count: 3, max: 4 })).toBe(
      "On this address, for this event: 3 of at most 4 people.",
    );
  });

  it("the terms' paragraph about registering another person names the limit as a merge field, filled from the setting", () => {
    for (const body of [termsRo, termsEn]) expect(mergeFieldsIn(body).has(ADDRESS_CAP_MERGE_FIELD)).toBe(true);
    const merged = mergeLegalBody(termsRo, addressCapMergeValues("ro", 4)).sections.flatMap((section) => section.paragraphs).join("\n");
    expect(merged).toContain("cel mult 4 persoane cu aceeași adresă la un eveniment");
    expect(merged).not.toContain("{{registrationsPerAddress}}");
    const mergedEn = mergeLegalBody(termsEn, addressCapMergeValues("en", 3)).sections.flatMap((section) => section.paragraphs).join("\n");
    expect(mergedEn).toContain("at most 3 people on one address for one event");
    // The editors' legend names it, with an unset setting's words.
    expect(DECLARATION_TOKENS.find((entry) => entry.token === "{{registrationsPerAddress}}")?.example).toEqual({ ro: "4 persoane", en: "4 people" });
  });
});
