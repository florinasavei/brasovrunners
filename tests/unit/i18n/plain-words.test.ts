import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §511 — the backoffice's words: one plain sentence of help per field or card, the rest behind a
 * «?» or in the guide.
 *
 * The owner, 2026-09-27, of the Neon limits card: «nu înțeleg asta man… e prea mult AI slop
 * comments, prea multe detalii!!». A field or a card gets at most one plain sentence, in the
 * club's words, saying what happens when you change it — never a §-number, never a file name
 * (SETUP.md, DECISIONS), never a measurement history, never a parenthesis of caveats. What
 * explains it goes behind the discreet «?» (`shared/ui/QuietHelp`: a sibling `…More` key, a
 * Panel's `introMore`, a RecallField's `helpMore`) — short too — or into the guide.
 *
 * What this test holds, in both catalogues:
 * 1. every help, intro, description or helper text of the backoffice (`Admin.*`, the translate
 *    panel) and of the public forms (`Registration.*`, `Registrations.*`, `Event.*`) — the «?»
 *    texts included — is at most 200 characters, carries no forbidden reference and no
 *    parenthesis of more than 12 words;
 * 2. no string anywhere under `Admin.*` names a §-number, a repository file or a release number:
 *    those are for the people who build the platform, never for the club.
 *
 * `ALLOWED_LONG` names the few texts that are long on purpose, each with its reason.
 */

type Catalogue = Record<string, unknown>;

/** The namespaces whose help texts the rule covers. */
const HELP_SCOPES = ["Admin", "Translate", "Registration", "Registrations", "Event"] as const;

/** A help text by its key's last segment: `help`, `bodyHelp`, `intro`, `introMore`, `description`, `helperText`… */
const HELP_KEY = /(help|intro|description|helper)/i;

/** A help text's ceiling, in characters, each `{placeholder}` counted as one. */
const MAX_HELP = 200;

/** A parenthesis longer than this many words is a caveat that belongs behind the «?». */
const MAX_PAREN_WORDS = 12;

/**
 * What a screen never says: a §-number, a repository document, a source path, a release number.
 * A URL path such as `/admin/legal` or `/devs` is a place on the site the club can open, and stays.
 */
const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
  ["a §-number", /§/],
  ["SETUP.md", /SETUP\.md/i],
  ["DECISIONS", /DECISIONS/],
  ["a repository document", /\b[\w-]+\.md\b/i],
  ["a repository folder", /(^|[\s(`])(docs|src|tests|scripts)\//],
  ["a release number", /\bBR-V\d/],
];

/**
 * Help texts that are long on purpose. Each entry says why; a new one needs a reason as good.
 */
const ALLOWED_LONG: Record<string, string> = {
  // The legal editor's token legend: every token the declaration may carry and what fills it.
  // It IS the help — cutting a token out leaves the club typing one nobody explained.
  "Admin.legal.tokensHelp": "the legal editor's token legend lists every declaration token with what fills it",
  // The photographs amendment's upload rule, verbatim as the privacy notice words it
  // (`event-photos-notice.test.ts` holds the two to the letter): a legal text is not shortened here.
  "Admin.gallery.uploadHelp": "ends with the photographs amendment's upload rule, verbatim, as the notice words it",
};

/** Every string under a namespace, with its full dotted key. */
function leaves(catalogue: Catalogue, scope: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (node: unknown, key: string) => {
    if (typeof node === "string") out.push([key, node]);
    else if (node && typeof node === "object" && !Array.isArray(node)) for (const [k, v] of Object.entries(node)) walk(v, `${key}.${k}`);
  };
  walk(catalogue[scope], scope);
  return out;
}

/** The text as a reader counts it: a placeholder is one character. */
function readable(text: string): string {
  return text.replace(/\{[^}]+\}/g, "X").trim();
}

function isHelp(key: string): boolean {
  return HELP_KEY.test(key.slice(key.lastIndexOf(".") + 1));
}

/** The parentheses of more than `MAX_PAREN_WORDS` words. */
function longParentheses(text: string): string[] {
  return (text.match(/\(([^()]*)\)/g) ?? []).filter((group) => group.slice(1, -1).trim().split(/\s+/).filter(Boolean).length > MAX_PAREN_WORDS);
}

/** Why a text breaks the rule, or an empty list. */
function breaches(text: string): string[] {
  const why: string[] = [];
  if (readable(text).length > MAX_HELP) why.push(`${readable(text).length} characters`);
  for (const [name, pattern] of FORBIDDEN) if (pattern.test(text)) why.push(name);
  for (const group of longParentheses(text)) why.push(`a parenthesis of more than ${MAX_PAREN_WORDS} words: ${group}`);
  return why;
}

describe("§511 the backoffice says one plain sentence per field, the rest behind «?»", () => {
  for (const [locale, catalogue] of [
    ["ro", ro as Catalogue],
    ["en", en as Catalogue],
  ] as const) {
    const helpTexts = HELP_SCOPES.flatMap((scope) => leaves(catalogue, scope)).filter(([key]) => isHelp(key));

    it(`finds the help texts it guards (${locale})`, () => {
      // Every scope is present, and the walk is not silently empty.
      for (const scope of HELP_SCOPES) expect(leaves(catalogue, scope).length, scope).toBeGreaterThan(0);
      expect(helpTexts.length).toBeGreaterThan(200);
    });

    it(`keeps every help, intro, description and helper to ${MAX_HELP} characters, no references and no long parenthesis (${locale})`, () => {
      const offenders = helpTexts
        .filter(([key]) => !(key in ALLOWED_LONG))
        .map(([key, text]) => [key, breaches(text)] as const)
        .filter(([, why]) => why.length > 0)
        .map(([key, why]) => `${key}: ${why.join("; ")}`);
      expect(offenders).toEqual([]);
    });

    it(`names no §-number, repository file or release number anywhere on the backoffice (${locale})`, () => {
      const offenders = leaves(catalogue, "Admin")
        .flatMap(([key, text]) => FORBIDDEN.filter(([, pattern]) => pattern.test(text)).map(([name]) => `${key}: ${name}`));
      expect(offenders).toEqual([]);
    });

    it(`keeps its allowlist honest: every entry exists, is a help text, and is still long (${locale})`, () => {
      const all = new Map(HELP_SCOPES.flatMap((scope) => leaves(catalogue, scope)));
      for (const [key, reason] of Object.entries(ALLOWED_LONG)) {
        expect(reason.length, key).toBeGreaterThan(20);
        expect(all.has(key), key).toBe(true);
        expect(isHelp(key), key).toBe(true);
        // An entry that now passes the rule is an entry to delete.
        expect(breaches(all.get(key) ?? "").length, key).toBeGreaterThan(0);
      }
    });
  }

  it("fails on the texts the owner quoted, and passes a plain sentence", () => {
    expect(breaches("Lipsește {missing} pe acest mediu (SETUP.md §33).")).toEqual(expect.arrayContaining(["a §-number", "SETUP.md", "a repository document"]));
    expect(breaches("SETUP.md §40. Producția a consumat cam 4 ore-CU pe zi.")).toContain("SETUP.md");
    expect(breaches("Datele de acces: docs/RUNBOOKS.md § Staff sign-in.")).toEqual(expect.arrayContaining(["a repository folder", "a repository document"]));
    expect(breaches("Vezi DECISIONS.md.")).toContain("DECISIONS");
    expect(breaches("De la BR-V1.94 fluxul e pornit.")).toContain("a release number");
    expect(breaches(`Un câmp (${"cuvânt ".repeat(13).trim()}).`)[0]).toMatch(/parenthesis/);
    expect(breaches("x".repeat(201))).toEqual(["201 characters"]);
    // A URL path is a place the club opens; a short parenthesis is a clarification.
    expect(breaches("Deschide /admin/legal (caseta „Într-un pas”).")).toEqual([]);
    expect(breaches("Când se atinge, Neon oprește baza până la începutul perioadei următoare. Recomandat: {hours}.")).toEqual([]);
  });
});

describe("§511 the «?» itself", () => {
  const html = renderToStaticMarkup(createElement(QuietHelp, { text: "Un detaliu care nu încape pe rând." }));

  it("is a button that never submits, named by its words", () => {
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Un detaliu care nu încape pe rând."');
    expect(html).toContain('data-testid="quiet-help"');
  });

  it("draws a small glyph inside a 44-pixel hit area (BR-REQ-041-01 criterion 6)", () => {
    // 16 px of glyph and 14 px of invisible overlay on every side: 44 px for a thumb.
    expect(html).toContain("inset:-14px");
    // The weather line's own 14 px (§473) reaches the same 44 px with 15 px of overlay.
    const weather = renderToStaticMarkup(createElement(QuietHelp, { text: "Prognoză.", size: 14, testId: "event-weather-help" }));
    expect(weather).toContain("inset:-15px");
    expect(weather).toContain('data-testid="event-weather-help"');
  });

  it("follows a panel's one-sentence intro when the panel has more to say", () => {
    const panel = renderToStaticMarkup(createElement(Panel, { title: "Titlu", intro: "O propoziție.", introMore: "Restul explicației." }));
    expect(panel).toContain("O propoziție.");
    expect(panel).toContain('aria-label="Restul explicației."');
    const plain = renderToStaticMarkup(createElement(Panel, { title: "Titlu", intro: "O propoziție." }));
    expect(plain).not.toContain("quiet-help");
  });
});
