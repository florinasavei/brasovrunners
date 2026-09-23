/**
 * Which of a counted phrase's three wordings a number takes (§NNN).
 *
 * Romanian puts "de" between a number and its noun from twenty on — "12 înscriși", "20 de
 * înscriși" — except where the last two digits fall back under twenty: "101 înscriși", "120 de
 * înscriși". One is singular, and nought reads with the plural: "0 înscriși". The catalogues
 * carry no ICU plurals (`docs/VIBECODING.md`), so a counted phrase is three keys — `one`,
 * `few`, `other` — and this says which one a number reads with.
 *
 * Those three names are CLDR's categories for Romanian, and `Intl.PluralRules` is CLDR: the
 * platform already knows the rule, including the hundreds, so it is asked rather than written
 * out again here. English has only `one` and `other`, and its `few` key is simply never chosen
 * — it still exists in `en.json`, because the two catalogues carry the same keys.
 */
export type NumberForm = "one" | "few" | "other";

const rules = new Map<string, Intl.PluralRules>();

export function numberForm(locale: string, count: number): NumberForm {
  let rule = rules.get(locale);
  if (!rule) {
    rule = new Intl.PluralRules(locale);
    rules.set(locale, rule);
  }
  const category = rule.select(count);
  // `zero`, `two` and `many` exist in other languages' rules and in neither of these two.
  return category === "one" || category === "few" ? category : "other";
}
