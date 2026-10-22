import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BACK_ARROWS } from "./guards-allowlist";
import { ROOT } from "./scan";

/**
 * §NNN (the consistency audit's fourth wave) — the backoffice says one word per verb, as §844 settled it, in both
 * catalogues. Read over every value of the backoffice's namespaces (`Admin`, `Devs`):
 *
 * 1. Moving a row is «Mai sus» / «Mai jos» («Move up» / «Move down») — never «Sus», «Mută mai sus», «Urcă», an arrow.
 * 2. Taking a file away is «Descarcă …» («Download …») — never «Exportă Excel» / «Export CSV». («Exportă evenimentul
 *    (JSON)» stays: it makes a file to bring the event into another site, the import's pair, not a list to read.)
 * 3. A link back to where the reader came from says «Înapoi la …» with no «←»: the link's glyph is the arrow (§844 took
 *    three off). Today's five, read as a key `…back` / `…backTo…`, are pinned in `guards-allowlist.ts`'s `BACK_ARROWS`.
 * 4. A page («Pagini») leaves the site by «Scoate pagina de pe site» — never «Retrage pagina» or a bare «Scoate de pe
 *    site» (a team member's «Scoate de pe site» is another thing, and keeps its words).
 *
 * A failure names the catalogue, the key and the value. The remedy is the house's word, never a new entry.
 */
type Catalogue = Record<string, unknown>;
const read = (locale: string): Catalogue => JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as Catalogue;

function* values(node: unknown, key: string): Generator<[string, string]> {
  if (typeof node === "string") yield [key, node];
  else if (node && typeof node === "object") for (const [name, child] of Object.entries(node)) yield* values(child, key ? `${key}.${name}` : name);
}

const BACKOFFICE_NAMESPACES = ["Admin", "Devs"];
const RULES: Record<"ro" | "en", { name: string; refused: RegExp; house: string; within?: RegExp }[]> = {
  ro: [
    { name: "move", refused: /^(?:Mută (?:mai )?(?:sus|jos)|Sus|Jos|Urcă|Coboară|↑|↓)$/i, house: "«Mai sus» / «Mai jos»" },
    { name: "download", refused: /^Exportă (?:Excel|CSV|PDF|lista)\b/, house: "«Descarcă …»" },
    { name: "unpublish", refused: /^(?:Retrage pagina|Scoate de pe site)$/, house: "«Scoate pagina de pe site»", within: /^Admin\.pages\./ },
  ],
  en: [
    { name: "move", refused: /^(?:Up|Down|Raise|Lower|↑|↓)$/i, house: "«Move up» / «Move down»" },
    { name: "download", refused: /^Export (?:Excel|CSV|PDF|the list)\b/, house: "«Download …»" },
  ],
};
const BACK_KEY = /\.back(?:To\w*)?$/;

function offences(locale: "ro" | "en", catalogue: Catalogue) {
  const found: string[] = [];
  const arrows: string[] = [];
  for (const namespace of BACKOFFICE_NAMESPACES) {
    for (const [key, value] of values(catalogue[namespace], namespace)) {
      for (const rule of RULES[locale]) if ((rule.within?.test(key) ?? true) && rule.refused.test(value.trim())) found.push(`${locale}: ${key} = «${value}» — ${rule.name}: the house says ${rule.house}`);
      if (BACK_KEY.test(key) && /^\s*←/.test(value)) arrows.push(key);
    }
  }
  return { found, arrows };
}

describe("§NNN the backoffice's verbs are one word each", () => {
  for (const locale of ["ro", "en"] as const) {
    const catalogue = read(locale);

    it(`${locale}: reads the backoffice's namespaces`, () => {
      for (const namespace of BACKOFFICE_NAMESPACES) expect([...values(catalogue[namespace], namespace)].length, namespace).toBeGreaterThan(50);
    });

    it(`${locale}: moves, downloads and takes a page off the site in the house's words`, () => {
      expect(offences(locale, catalogue).found).toEqual([]);
    });

    it(`${locale}: puts no «←» on a link back, but the pinned ones`, () => {
      const { arrows } = offences(locale, catalogue);
      const pinned = BACK_ARROWS.map((entry) => entry.key);
      expect(arrows.filter((key) => !pinned.includes(key)), "a new «←» on a link back: drop the arrow, the link's glyph says it (§844)").toEqual([]);
      expect(pinned.filter((key) => !arrows.includes(key)), "a pinned key has lost its arrow: delete its entry from BACK_ARROWS").toEqual([]);
    });
  }

  it("pins each back arrow once, with a reason", () => {
    const keys = BACK_ARROWS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of BACK_ARROWS) expect(entry.reason.length, entry.key).toBeGreaterThan(10);
    expect(keys.length, "the list only shrinks: lower this number with the entry you delete").toBe(5);
  });

  it("the tripwires see each refused word, and let the house's words through", () => {
    const sample = (value: string, locale: "ro" | "en" = "ro") => offences(locale, { Admin: { pages: { back: value, word: value } }, Devs: {} });
    expect(sample("Sus").found).toHaveLength(2);
    expect(sample("Mută mai jos").found).toHaveLength(2);
    expect(sample("Exportă Excel").found).toHaveLength(2);
    expect(sample("Retrage pagina").found).toHaveLength(2);
    expect(sample("Up", "en").found).toHaveLength(2);
    expect(sample("Export CSV", "en").found).toHaveLength(2);
    expect(sample("← Înapoi la listă").arrows).toEqual(["Admin.pages.back"]);
    expect(sample("Mai sus").found).toEqual([]);
    expect(sample("Descarcă Excel").found).toEqual([]);
    expect(sample("Exportă evenimentul (JSON)").found).toEqual([]);
    expect(sample("Înapoi la eveniment").arrows).toEqual([]);
    expect(sample("Move up", "en").found).toEqual([]);
  });
});
