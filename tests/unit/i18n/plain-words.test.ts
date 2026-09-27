import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — Costuri's words are one plain sentence per field, and the details are behind a «?».
 *
 * The owner, 2026-09-27: the page answered a treasurer's question with paragraphs. Every string a
 * Costuri card shows on its own — an intro, a field's help, a fact, a warning, a row of the cost
 * table — is now one sentence, short enough to read at a glance; what explained it (the why, the
 * exceptions, the arithmetic, the history) moved into a sibling key ending in `More` (or a key
 * named `more`), which the page draws as the discreet «?» (`shared/ui/QuietHelp`), its words the
 * tooltip and the accessible name.
 *
 * This test is what keeps it so: a second sentence typed into one of these namespaces, in either
 * language, fails here and asks for a `…More` key instead.
 */

/** The namespaces Costuri (`/admin/tasks?panel=costs`) draws its cards from. */
const PLAIN_SCOPES = [
  "Admin.tasks.month",
  "Admin.tasks.database",
  "Admin.tasks.neonPlan",
  "Admin.tasks.neonLimits",
  "Admin.tasks.jobCadence",
  "Admin.tasks.translationBudget",
  "Admin.tasks.budgetThresholds",
  "Admin.tasks.costTitle",
  "Admin.tasks.costToday",
  "Admin.tasks.nextSpend",
  "Admin.tasks.currencyNote",
  "Admin.tasks.freshness",
  "Admin.tasks.servicesTitle",
  "Admin.tasks.servicesIntro",
  "Admin.tasks.freeVerdict",
  "Admin.tasks.registrationsLeft",
  "Admin.tasks.services",
  "Admin.tasks.field",
  "Admin.tasks.severity",
  "Admin.tasks.bump",
  "Admin.tasks.checkedOn",
  "Budget",
] as const;

/** A plain line's ceiling, in characters with each `{placeholder}` counted as a short word. */
const MAX_PLAIN = 160;
/** A «?»'s ceiling: a tooltip is read to the end, so it stays a paragraph, never a page. */
const MAX_MORE = 600;

type Catalogue = Record<string, unknown>;

/** Every string under a dotted path, with its full key. */
function leaves(catalogue: Catalogue, scope: string): Array<[string, string]> {
  const start = scope.split(".").reduce<unknown>((node, part) => (node as Catalogue | undefined)?.[part], catalogue);
  const out: Array<[string, string]> = [];
  const walk = (node: unknown, key: string) => {
    if (typeof node === "string") out.push([key, node]);
    else if (node && typeof node === "object" && !Array.isArray(node)) for (const [k, v] of Object.entries(node)) walk(v, `${key}.${k}`);
  };
  walk(start, scope);
  return out;
}

/** Whether a key holds a «?»'s words rather than a line on the screen. */
function isMore(key: string): boolean {
  const last = key.slice(key.lastIndexOf(".") + 1);
  return last === "more" || last.endsWith("More");
}

/** The text as a reader counts it: a placeholder is one short word. */
function readable(text: string): string {
  return text.replace(/\{[^}]+\}/g, "X").trim();
}

/** How many sentences follow the first: a full stop, a question or an exclamation followed by more words. */
function extraSentences(text: string): string[] {
  return readable(text).match(/[.!?](?=\s+\S)/g) ?? [];
}

describe("§NNN Costuri says one plain sentence per field, the rest behind «?»", () => {
  for (const [locale, catalogue] of [
    ["ro", ro],
    ["en", en],
  ] as const) {
    it(`finds every namespace it guards in the ${locale} catalogue`, () => {
      for (const scope of PLAIN_SCOPES) expect(leaves(catalogue, scope).length, scope).toBeGreaterThan(0);
    });

    it(`keeps every line one sentence of at most ${MAX_PLAIN} characters (${locale})`, () => {
      const offenders = PLAIN_SCOPES.flatMap((scope) => leaves(catalogue, scope))
        .filter(([key]) => !isMore(key))
        .filter(([, text]) => extraSentences(text).length > 0 || readable(text).length > MAX_PLAIN || text.includes("\n"))
        .map(([key, text]) => `${key} (${readable(text).length}): ${text}`);
      expect(offenders).toEqual([]);
    });

    it(`keeps every «?» a paragraph of at most ${MAX_MORE} characters (${locale})`, () => {
      const more = PLAIN_SCOPES.flatMap((scope) => leaves(catalogue, scope)).filter(([key]) => isMore(key));
      // The move happened: the details exist, rather than having been deleted to pass the rule above.
      expect(more.length).toBeGreaterThanOrEqual(40);
      const offenders = more.filter(([, text]) => readable(text).length > MAX_MORE).map(([key, text]) => `${key} (${readable(text).length})`);
      expect(offenders).toEqual([]);
    });
  }

  it("counts a second sentence, and not an abbreviation, a decimal or a file name", () => {
    expect(extraSentences("Până acum: {amount}.")).toEqual([]);
    expect(extraSentences("Lipsește {missing} pe acest mediu (SETUP.md §33).")).toEqual([]);
    expect(extraSentences("În medie ≈ 0,25 CU sau 0.25 CU.")).toEqual([]);
    expect(extraSentences("Setat {when}. Notă: {note}")).toHaveLength(1);
    expect(extraSentences("Nu. Da? Poate!")).toHaveLength(2);
  });
});

describe("§NNN the «?» itself", () => {
  const html = renderToStaticMarkup(createElement(QuietHelp, { text: "Un detaliu care nu încape pe rând." }));

  it("is a button that never submits, named by its words", () => {
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Un detaliu care nu încape pe rând."');
    expect(html).toContain('data-testid="quiet-help"');
  });

  it("draws a small glyph inside a 44-pixel hit area (BR-REQ-041-01 criterion 6)", () => {
    // 16 px of glyph and 14 px of invisible overlay on every side: 44 px for a thumb.
    expect(html).toMatch(/font-size:\s*16px|fontSize/);
    expect(html).toContain("inset:-14px");
  });

  it("follows a panel's one-sentence intro when the panel has more to say", () => {
    const panel = renderToStaticMarkup(createElement(Panel, { title: "Titlu", intro: "O propoziție.", introMore: "Restul explicației." }));
    expect(panel).toContain("O propoziție.");
    expect(panel).toContain('aria-label="Restul explicației."');
    const plain = renderToStaticMarkup(createElement(Panel, { title: "Titlu", intro: "O propoziție." }));
    expect(plain).not.toContain("quiet-help");
  });
});
