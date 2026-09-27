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
 *    those are for the people who build the platform, never for the club;
 * 3. (§NNN, the plain-words pass over the whole backoffice) EVERY string the backoffice shows —
 *    `Admin.*`, the translate panel, the network page, the developers' page `/devs` (`Devs.*`),
 *    the Costuri budget card (`Budget.*`) and the backoffice's own error page (`STAFF_ERROR_KEYS`,
 *    named one by one because the rest of `Error.*` serves the public pages) — whatever its key is
 *    called (a notice, a dialog's body, an error, an email's «când pleacă», a task row, a «?»
 *    named `…More`, a guide's title or intro), keeps to the same 200 characters and no
 *    parenthesis of more than 6 words. Only the numbered steps keep their length: the guide's
 *    (`Admin.guide.sections.N.tasks.N.steps.N`) and a task row's «Cum» (`….how.N`,
 *    `….howBroken.N`), because the steps are where the detail lives. A short line that dropped a
 *    fact the club still needs keeps it in a sibling `…More` key, drawn as the line's «?» (an
 *    email's `emails.whenMore.*`, the queue's `simulateMore`), never deleted;
 * 4. (§NNN, the owner's two words) no string the backoffice shows says «platforma» / "the
 *    platform" — it names what acts: the site, the email, the job, «noi» — nor hedges with «de
 *    obicei», «în general», "usually", "generally": it says the fact. A numbered step is held to
 *    it too, except inside a quote («…», „…”, “…”), where it names the screen or the button to open.
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

/** A help text's parenthesis longer than this many words is a caveat that belongs behind the «?». */
const MAX_PAREN_WORDS = 12;

/** On a screen (rule 3) the limit is tighter: a bracket is a clarification, never a hiding place. */
const MAX_SCREEN_PAREN_WORDS = 6;

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
  // The registrations list's «Pași» column legend: the six steps of a registration, one line each,
  // drawn as the column's «?». Like the token legend, it IS the help; a step cut out is a step unexplained.
  "Admin.registrations.journey.legend": "the «Pași» column legend names each of a registration's six steps on its own line",
};

/** The namespaces the backoffice draws: every string in them, not only the help texts (rule 3). */
const SCREEN_SCOPES = ["Admin", "Translate", "Network", "Devs", "Budget"] as const;

/**
 * The staff-facing keys of `Error.*`, drawn by `AdminErrorPage` and `AdminRestingNotice`. Named one
 * by one: the namespace's other keys are the public error page's.
 */
const STAFF_ERROR_KEYS = ["staffTitle", "staffBody", "staffSettings"] as const;

/** The numbered steps, where the detail is meant to live: the guide's and a task row's «Cum». */
const STEP_KEYS: readonly RegExp[] = [/^Admin\.guide\.sections\.\d+\.tasks\.\d+\.steps\.\d+$/, /\.how(Broken)?\.\d+$/];

function isStep(key: string): boolean {
  return STEP_KEYS.some((pattern) => pattern.test(key));
}

/** Rule 4: the words a backoffice screen never says, per language. */
const FORBIDDEN_WORDS: Record<"ro" | "en", ReadonlyArray<[string, RegExp]>> = {
  ro: [
    ["«platforma»", /platform/i],
    ["«de obicei»", /de obicei/i],
    ["«în general»", /în general/i],
  ],
  en: [
    ["'the platform'", /platform/i],
    ["'usually'", /\busually\b/i],
    ["'generally'", /\bgenerally\b/i],
  ],
};

/** A step's quotes name a screen or a button, and are its words, not ours. */
function withoutQuotes(text: string): string {
  return text.replace(/«[^»]*»|„[^”]*”|“[^”]*”/g, "");
}

/** Which of rule 4's words a string says; a step is read without its quotes. */
function forbiddenWords(locale: "ro" | "en", key: string, text: string): string[] {
  const read = isStep(key) ? withoutQuotes(text) : text;
  return FORBIDDEN_WORDS[locale].filter(([, pattern]) => pattern.test(read)).map(([name]) => name);
}

/** Every string a backoffice screen draws: the screen scopes whole, and the staff error keys. */
function screenLeaves(catalogue: Catalogue): Array<[string, string]> {
  const errors = catalogue.Error as Record<string, string>;
  return [
    ...SCREEN_SCOPES.flatMap((scope) => leaves(catalogue, scope)),
    ...STAFF_ERROR_KEYS.map((key): [string, string] => [`Error.${key}`, errors[key]]),
  ];
}

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

/** The parentheses of more than `limit` words. */
function longParentheses(text: string, limit: number): string[] {
  return (text.match(/\(([^()]*)\)/g) ?? []).filter((group) => group.slice(1, -1).trim().split(/\s+/).filter(Boolean).length > limit);
}

/** Why a text breaks the rule, or an empty list; `parenLimit` is the screen's 6 or a help text's 12. */
function breaches(text: string, parenLimit: number = MAX_PAREN_WORDS): string[] {
  const why: string[] = [];
  if (readable(text).length > MAX_HELP) why.push(`${readable(text).length} characters`);
  for (const [name, pattern] of FORBIDDEN) if (pattern.test(text)) why.push(name);
  for (const group of longParentheses(text, parenLimit)) why.push(`a parenthesis of more than ${parenLimit} words: ${group}`);
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

    it(`keeps every string the backoffice shows to ${MAX_HELP} characters and no parenthesis over ${MAX_SCREEN_PAREN_WORDS} words, steps apart (${locale})`, () => {
      const offenders = screenLeaves(catalogue)
        .filter(([key]) => !isStep(key) && !(key in ALLOWED_LONG))
        .map(([key, text]) => [key, breaches(text, MAX_SCREEN_PAREN_WORDS)] as const)
        .filter(([, why]) => why.length > 0)
        .map(([key, why]) => `${key}: ${why.join("; ")}`);
      expect(offenders).toEqual([]);
    });

    it(`says neither «platforma» / "the platform" nor a hedge anywhere on the backoffice, steps' quotes apart (${locale})`, () => {
      const offenders = screenLeaves(catalogue)
        .map(([key, text]) => [key, forbiddenWords(locale, key, text)] as const)
        .filter(([, words]) => words.length > 0)
        .map(([key, words]) => `${key}: ${words.join(", ")}`);
      expect(offenders).toEqual([]);
    });

    it(`checks the backoffice's own error page, and only its staff keys (${locale})`, () => {
      const keys = screenLeaves(catalogue).map(([key]) => key);
      for (const key of STAFF_ERROR_KEYS) expect(keys).toContain(`Error.${key}`);
      // The public error page's words are not the backoffice's.
      expect(keys).not.toContain("Error.body");
      expect(screenLeaves(catalogue).every(([, text]) => typeof text === "string" && text.length > 0)).toBe(true);
    });

    it(`keeps its allowlist honest: every entry exists, is guarded, and is still long (${locale})`, () => {
      const all = new Map([...HELP_SCOPES.flatMap((scope) => leaves(catalogue, scope)), ...screenLeaves(catalogue)]);
      for (const [key, reason] of Object.entries(ALLOWED_LONG)) {
        expect(reason.length, key).toBeGreaterThan(20);
        expect(all.has(key), key).toBe(true);
        expect(isHelp(key) || (SCREEN_SCOPES.some((scope) => key.startsWith(`${scope}.`)) && !isStep(key)), key).toBe(true);
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

  it("keeps the facts a shortened line dropped in its `…More`, in both languages", () => {
    for (const catalogue of [ro, en]) {
      const { emails, queue } = catalogue.Admin;
      // How long the place is held, and the per-address limit: said behind the «?», never lost.
      expect(emails.whenMore.COMPLETE_DECLARATION).toContain("{hold}");
      expect(emails.whenMore.REGISTER_ANOTHER_PERSON).toContain("{people}");
      expect(queue.simulateMore).toContain("{hold}");
      // Only for the messages whose line had more to say, and each one a message that exists.
      expect(Object.keys(emails.whenMore).every((type) => type in emails.when)).toBe(true);
    }
    expect(ro.Admin.emails.whenMore.BIB_ASSIGNED).toMatch(/anulat/);
    expect(en.Admin.emails.whenMore.BIB_ASSIGNED).toMatch(/cancelled/);
  });

  it("exempts only the numbered steps from the whole-backoffice rule", () => {
    expect(isStep("Admin.guide.sections.4.tasks.2.steps.1")).toBe(true);
    expect(isStep("Admin.tasks.items.liveEmail.how.3")).toBe(true);
    expect(isStep("Admin.tasks.items.inviteKey.howBroken.3")).toBe(true);
    // The guide's titles, intros and lines are screen text like any other.
    expect(isStep("Admin.guide.intro")).toBe(false);
    expect(isStep("Admin.guide.familyPending")).toBe(false);
    expect(isStep("Admin.guide.sections.4.title")).toBe(false);
    expect(isStep("Admin.guide.sections.4.tasks.2.title")).toBe(false);
    // A task row's own sentence, an email's «când», a dialog's body are screen text, not steps.
    expect(isStep("Admin.tasks.items.liveEmail.todo")).toBe(false);
    expect(isStep("Admin.emails.when.ORGANIZER_MESSAGE")).toBe(false);
    expect(isStep("Admin.registrations.cancelBody")).toBe(false);
  });

  it("holds a screen's parenthesis to 6 words and a help text's to 12", () => {
    const seven = `Un câmp (${"cuvânt ".repeat(7).trim()}).`;
    expect(breaches(seven)).toEqual([]);
    expect(breaches(seven, MAX_SCREEN_PAREN_WORDS)[0]).toMatch(/more than 6 words/);
    expect(breaches(`Un câmp (${"cuvânt ".repeat(6).trim()}).`, MAX_SCREEN_PAREN_WORDS)).toEqual([]);
  });

  it("catches the owner's two words, and lets a step name the screen it opens", () => {
    expect(forbiddenWords("ro", "Admin.tasks.intro", "Ce lipsește ca platforma să primească înscrieri.")).toEqual(["«platforma»"]);
    expect(forbiddenWords("ro", "Admin.editor.bibStartNumberHelp", "De obicei 1.")).toEqual(["«de obicei»"]);
    expect(forbiddenWords("ro", "Admin.x", "În general merge.")).toEqual(["«în general»"]);
    expect(forbiddenWords("en", "Admin.x", "The platform picks one; usually tomorrow.")).toEqual(["'the platform'", "'usually'"]);
    expect(forbiddenWords("en", "Admin.x", "It generally works.")).toEqual(["'generally'"]);
    // A step that quotes a screen's own words is telling the reader where to go…
    expect(forbiddenWords("ro", "Admin.guide.sections.5.tasks.0.steps.1", "«Setări» → «Cât de des verifică platforma».")).toEqual([]);
    expect(forbiddenWords("en", "Admin.tasks.items.x.how.0", "Press “the platform's text”.")).toEqual([]);
    // …but its own sentence is held like any other, and a non-step gets no quote exemption.
    expect(forbiddenWords("ro", "Admin.guide.sections.5.tasks.0.steps.2", "Platforma trezește baza.")).toEqual(["«platforma»"]);
    expect(forbiddenWords("ro", "Admin.guide.sections.5.title", "«Setările platformei»")).toEqual(["«platforma»"]);
    // The words the site names instead pass.
    expect(forbiddenWords("ro", "Admin.x", "Site-ul trimite emailul; implicit 1.")).toEqual([]);
    expect(forbiddenWords("en", "Admin.x", "The site sends the email; 1 by default.")).toEqual([]);
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
    const panel = renderToStaticMarkup(createElement(Panel, { glyph: "help", title: "Titlu", intro: "O propoziție.", introMore: "Restul explicației." }));
    expect(panel).toContain("O propoziție.");
    expect(panel).toContain('aria-label="Restul explicației."');
    const plain = renderToStaticMarkup(createElement(Panel, { glyph: "help", title: "Titlu", intro: "O propoziție." }));
    expect(plain).not.toContain("quiet-help");
  });
});
