import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-060-01 (the backoffice's verbs), BR-REQ-041-01 (the public send buttons);
 * `DECISIONS.md` §170 and §318 — one glyph per verb, looked up by name.
 *
 * The owner, 2026-09-23: "I also need more icons, including on the Printing BID stuff", and
 * "butoanele de trimitere înscriere și contact trebuie să aibă și iconița cu un alergător". Every
 * backoffice button now names a glyph in `shared/ui/action-icons.ts`, and what has to stay true
 * is a property of the source tree rather than of one screen:
 *
 * - every name a component asks for is in the registry, and every name in the registry is asked
 *   for somewhere (a dead name is a glyph nobody sees, and the next person reuses it wrongly);
 * - the registry imports one file per glyph and never the barrel (§90);
 * - a label names the same glyph wherever it is written, and the verbs that are the same verb
 *   under different words — "Șterge definitiv" on four screens — wear the same glyph, while two
 *   different names never share one;
 * - the registry never reaches a public page: a lookup by a runtime key cannot be tree-shaken,
 *   so whatever imports it ships every glyph, and the public send buttons wear their runner
 *   through `SubmitButton`'s own flag instead.
 *
 * Source-level, like `held-press-is-sent.test.ts`: the suite runs in Node with no DOM, and the
 * rule is about what is written, not about what one render happens to produce. TypeScript
 * already refuses an unknown name at the call site; this is what catches the others.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const REGISTRY = "src/shared/ui/action-icons.ts";
const registry = read(REGISTRY);
const SOURCES = sourceFiles(path.join(ROOT, "src")).map((file) => ({
  file: path.relative(ROOT, file).split(path.sep).join("/"),
  text: readFileSync(file, "utf8").replace(/\r\n/g, "\n"),
}));

/** The names in `ActionIconName`, from the union itself. */
const typeNames = (() => {
  // Up to the quote-and-semicolon that ends the union: the comments inside it have semicolons.
  const union = registry.match(/export type ActionIconName =([\s\S]*?");/)?.[1] ?? "";
  const code = union.replace(/\/\/[^\n]*/g, "");
  return [...code.matchAll(/\|\s*"(\w+)"/g)].map((match) => match[1]);
})();

/** `name: GlyphIcon` for every entry of `ACTION_ICONS`. */
const entries = (() => {
  const body = registry.match(/export const ACTION_ICONS[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
  return [...body.matchAll(/^\s*(\w+):\s*(\w+),/gm)].map((match) => ({ name: match[1], glyph: match[2] }));
})();

/** `import GlyphIcon from "@mui/icons-material/Glyph";` */
const imports = [...registry.matchAll(/^import (\w+) from "(@mui\/icons-material[^"]*)";/gm)].map((match) => ({
  identifier: match[1],
  from: match[2],
}));

/** Every glyph name any source file asks the registry for, with where it asked. */
function namesUsedInSource(): Array<{ name: string; file: string }> {
  const found: Array<{ name: string; file: string }> = [];
  for (const { file, text } of SOURCES) {
    if (file === REGISTRY) continue;
    const add = (name: string) => found.push({ name, file });
    // A JSX attribute: icon="save".
    for (const match of text.matchAll(/\bicon="(\w+)"/g)) add(match[1]);
    // A menu item: icon: "delete", or icon: "delete" as const.
    for (const match of text.matchAll(/\bicon: "(\w+)"/g)) add(match[1]);
    // A ternary in braces: icon={checkedIn ? "undo" : "checkIn"} — and not an element, whose
    // `fontSize="small"` is a prop of the glyph, not a name (`AdminTabs`, MUI's own `icon`).
    for (const match of text.matchAll(/\bicon=\{([^{}<]*)\}/g)) {
      for (const literal of match[1].matchAll(/"(\w+)"/g)) add(literal[1]);
    }
    // A client island that makes the element itself: ACTION_ICONS.scan.
    for (const match of text.matchAll(/\bACTION_ICONS\.(\w+)/g)) add(match[1]);
    // The publication transitions, whose glyphs live beside their words.
    const transitions = text.match(/EDITORIAL_TRANSITION_ICON[^=]*=\s*\{([\s\S]*?)\};/)?.[1];
    if (transitions) for (const literal of transitions.matchAll(/:\s*"(\w+)"/g)) add(literal[1]);
  }
  return found;
}

/**
 * One label key and the glyph written beside it, for every button whose label is a single
 * catalogue key and whose glyph is a single literal. A label chosen by a ternary is skipped —
 * the two halves are two verbs, and each is checked where it is written alone.
 */
function labelledGlyphs(): Array<{ key: string; icon: string; file: string }> {
  const found: Array<{ key: string; icon: string; file: string }> = [];
  const LOOKUP = /^\s*\{?\s*t[a-zA-Z]*\("([\w.]+)"(?:,[^)]*)?\)\s*\}?\s*$/;

  for (const { file, text } of SOURCES) {
    // <GlyphSubmitButton label={t("x")} … icon="y" … />, and the same for the confirming button.
    for (const match of text.matchAll(/<(GlyphSubmitButton|ConfirmSubmitButton)\b([\s\S]*?)\/>/g)) {
      const props = match[2];
      const icon = props.match(/\bicon="(\w+)"/)?.[1];
      const label = props.match(/\blabel=\{(t[a-zA-Z]*\("[\w.]+"(?:,[^)]*)?\))\}/)?.[1];
      const key = label?.match(LOOKUP)?.[1];
      if (icon && key) found.push({ key, icon, file });
    }
    // <GlyphButton icon="y" …>{t("x")}</GlyphButton>, and the same for GlyphButtonLink.
    for (const match of text.matchAll(/<(GlyphButton|GlyphButtonLink)\b([^>]*?)>([\s\S]*?)<\/\1>/g)) {
      const icon = match[2].match(/\bicon="(\w+)"/)?.[1];
      const key = match[3].match(LOOKUP)?.[1];
      if (icon && key) found.push({ key, icon, file });
    }
    // A "⋮" item: { kind: "submit", icon: "y", label: t("x"), formId: … }, in either order.
    for (const match of text.matchAll(/kind: "(?:link|submit)"(?: as const)?,([\s\S]*?)(?:formId|href):/g)) {
      const icon = match[1].match(/\bicon: "(\w+)"/)?.[1];
      const key = match[1].match(/\blabel: t[a-zA-Z]*\("([\w.]+)"(?:,[^)]*)?\),/)?.[1];
      if (icon && key) found.push({ key, icon, file });
    }
  }
  return found;
}

/**
 * The verbs that are one verb under several words. Each group must wear one glyph; the group's
 * glyph is named so a reader sees the decision, not only its consistency.
 */
const SAME_VERB: Array<{ glyph: string; keys: string[] }> = [
  {
    // Removing a person's record, or an event, for good — never the plain bin.
    glyph: "erase",
    keys: [
      "registrations.eraseAction",
      "registrations.deleteAction",
      "registrations.bulkEraseAction",
      "registrations.erase",
      "erase.action",
      "events.hardDelete",
      "legal.erase.action",
    ],
  },
  { glyph: "cancel", keys: ["registrations.cancelAction", "registrations.cancel", "registrations.bulkCancelAction"] },
  { glyph: "confirm", keys: ["desk.confirmHere", "desk.confirmOnPaper"] },
  { glyph: "place", keys: ["desk.givePlace"] },
  { glyph: "number", keys: ["desk.saveBib", "bibs.assign"] },
  { glyph: "markPrinted", keys: ["registrations.bibsMarkPrinted", "registrations.bibMarkPrinted"] },
  { glyph: "markUnprinted", keys: ["registrations.bibsMarkAllUnprinted", "registrations.bibMarkUnprinted"] },
  { glyph: "print", keys: ["registrations.bibsDownloadUnprinted", "registrations.downloadBib", "bibs.downloadOnePerPage"] },
  { glyph: "pdf", keys: ["registrations.bibsDownloadAll", "bibs.downloadAll", "bibs.download", "registrations.declarationsPdf"] },
  { glyph: "addPerson", keys: ["registrations.new", "registrations.create", "desk.walkIn", "staff.invite"] },
  {
    glyph: "save",
    keys: [
      "editor.save",
      "emails.plan.save",
      "emails.copy.save",
      "emails.contacts.save",
      "emails.clubNotices.save",
      "tasks.neonPlan.save",
    ],
  },
  { glyph: "send", keys: ["outbox.sendNow", "thanks.send", "registrations.sendReminder"] },
  // An email sent again, whoever it is for: a registration's, a staff invitation, a password reset.
  { glyph: "resend", keys: ["registrations.resend", "staff.resendInvite", "staff.passwordReset"] },
];

/**
 * The value imports of one file, as written: `import type` is erased and ships nothing, and so
 * is `import { type A, type B }`. A side-effect import names no binding and is skipped by the
 * pattern, which never crosses a quote or a semicolon.
 */
function valueImports(text: string): string[] {
  const specifiers: string[] = [];
  for (const match of text.matchAll(/^(?:import|export)\s+(type\s+)?([^;"]*?)\s+from\s+"([^"]+)";/gm)) {
    if (match[1]) continue;
    const clause = match[2].trim();
    const named = clause.match(/^\{([\s\S]*)\}$/)?.[1];
    const onlyTypes =
      named !== undefined &&
      named
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .every((part) => part.startsWith("type "));
    if (!onlyTypes) specifiers.push(match[3]);
  }
  for (const match of text.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) specifiers.push(match[1]);
  return specifiers;
}

const FILES = new Set(SOURCES.map((source) => source.file));

/** `@/x` and `./x` to the file under `src/` they name; a package, or JSON, is not followed. */
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) base = path.posix.join(path.posix.dirname(fromFile), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (FILES.has(candidate)) return candidate;
  }
  return null;
}

/** Who imports each file: the import graph, backwards. */
const IMPORTERS = (() => {
  const importers = new Map<string, Set<string>>();
  for (const { file, text } of SOURCES) {
    for (const specifier of valueImports(text)) {
      const target = resolveImport(file, specifier);
      if (!target) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target)?.add(file);
    }
  }
  return importers;
})();

/** Every file that reaches `start` through value imports, `start` included. */
function reaching(start: string): Set<string> {
  const reached = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const importer of IMPORTERS.get(current) ?? []) {
      if (reached.has(importer)) continue;
      reached.add(importer);
      queue.push(importer);
    }
  }
  return reached;
}

/**
 * The backoffice's routes: `/admin`, and `/devs`, which is staff-only inside the same shell
 * (§88). Everything else under `src/app/` is a page a visitor can open.
 */
const isBackofficeRoute = (file: string) => file.startsWith("src/app/[locale]/admin/") || file.startsWith("src/app/[locale]/devs/");

describe("§318 one glyph per verb, by name", () => {
  it("declares every name once, in the type and in the table alike", () => {
    expect(typeNames.length).toBeGreaterThan(40);
    expect(new Set(typeNames).size).toBe(typeNames.length);
    expect(entries.map((entry) => entry.name).sort()).toEqual([...typeNames].sort());
  });

  it("imports one file per glyph from @mui/icons-material, never the barrel", () => {
    for (const { from } of imports) expect(from, from).toMatch(/^@mui\/icons-material\/[A-Z]\w+$/);
    const paths = imports.map((entry) => entry.from);
    expect(new Set(paths).size, "a glyph file imported twice").toBe(paths.length);
    const identifiers = new Set(imports.map((entry) => entry.identifier));
    for (const { name, glyph } of entries) expect(identifiers.has(glyph), `${name}: ${glyph}`).toBe(true);
    // And nothing imported that no entry uses.
    const used = new Set(entries.map((entry) => entry.glyph));
    for (const { identifier } of imports) expect(used.has(identifier), identifier).toBe(true);
  });

  it("never gives two names one glyph", () => {
    // Checking in and the registrations list both wore the person with the tick: a view and a
    // verb a reader could not tell apart in one row. One name, one picture.
    const byGlyph = new Map<string, string[]>();
    for (const { name, glyph } of entries) byGlyph.set(glyph, [...(byGlyph.get(glyph) ?? []), name]);
    const shared = [...byGlyph].filter(([, names]) => names.length > 1).map(([glyph, names]) => `${glyph}: ${names.join(", ")}`);
    expect(shared).toEqual([]);
  });

  it("resolves every name used in src/", () => {
    const known = new Set(typeNames);
    const used = namesUsedInSource();
    expect(used.length).toBeGreaterThan(60);
    const unknown = used.filter((entry) => !known.has(entry.name));
    expect(unknown).toEqual([]);
  });

  it("has no name that nothing uses", () => {
    const used = new Set(namesUsedInSource().map((entry) => entry.name));
    expect(typeNames.filter((name) => !used.has(name))).toEqual([]);
  });

  it("gives a label the same glyph wherever it is written", () => {
    const byKey = new Map<string, Set<string>>();
    const pairs = labelledGlyphs();
    // Enough pairs that a parser gone blind would fail here rather than pass on nothing.
    expect(pairs.length).toBeGreaterThan(50);
    for (const { key, icon } of pairs) byKey.set(key, (byKey.get(key) ?? new Set()).add(icon));
    const split = [...byKey].filter(([, icons]) => icons.size > 1).map(([key, icons]) => `${key}: ${[...icons].join(", ")}`);
    expect(split).toEqual([]);
  });

  it("gives the verbs that are one verb one glyph", () => {
    const pairs = labelledGlyphs();
    for (const { glyph, keys } of SAME_VERB) {
      for (const key of keys) {
        const written = pairs.filter((pair) => pair.key === key);
        expect(written.length, `${key} is on no button any more — drop it from the table`).toBeGreaterThan(0);
        for (const pair of written) expect(pair.icon, `${key} in ${pair.file}`).toBe(glyph);
      }
    }
  });

  it("makes the element on the client, from the name, in the backoffice's buttons", () => {
    // The whole reason for the registry: a Server Component passes a string, the client
    // component looks the glyph up. None of these may take an element-valued icon prop.
    for (const file of [
      "src/shared/ui/GlyphButton.tsx",
      "src/shared/ui/GlyphButtonLink.tsx",
      "src/shared/ui/GlyphSubmitButton.tsx",
      "src/shared/ui/ConfirmSubmitButton.tsx",
      "src/shared/ui/RowMenu.tsx",
      "src/modules/registrations/ui/RegistrationRowMenu.tsx",
    ]) {
      const text = read(file);
      expect(text.split("\n")[0], file).toMatch(/^"use client";/);
      expect(text, file).toContain("ACTION_ICONS[");
      expect(text, file).toContain("ActionIconName");
    }
  });

  it("never reaches a public page, through anything", () => {
    /*
      The review of §318: `ButtonLink` and `SubmitButton` once looked names up here, and a lookup
      by a runtime key cannot be tree-shaken — so the landing page, every event page, the
      register, contact and not-found pages shipped every backoffice glyph, used or not. The
      walk goes backwards from the registry through every value import in `src/`; a route it
      reaches outside `/admin` is a page a visitor downloads it on.
    */
    const reached = reaching(REGISTRY);
    const routes = [...reached].filter((file) => file.startsWith("src/app/"));
    expect(routes.filter((file) => !isBackofficeRoute(file))).toEqual([]);

    // The walk is not blind: it finds the backoffice's glyph buttons and the pages that use them.
    for (const file of ["src/shared/ui/GlyphButton.tsx", "src/shared/ui/GlyphButtonLink.tsx", "src/shared/ui/GlyphSubmitButton.tsx"]) {
      expect(reached.has(file), file).toBe(true);
    }
    expect(routes).toContain("src/app/[locale]/admin/registrations/(list)/page.tsx");
    // And it does see a public page when there is a road to one: the send button is on them.
    const fromSubmitButton = [...reaching("src/shared/ui/SubmitButton.tsx")];
    expect(fromSubmitButton).toContain("src/app/[locale]/events/[slug]/register/page.tsx");
    expect(fromSubmitButton).toContain("src/app/[locale]/contact/page.tsx");

    // The components a public page renders import no registry, directly or at all.
    for (const file of ["src/shared/ui/ButtonLink.tsx", "src/shared/ui/SubmitButton.tsx", "src/shared/ui/RunnerLoader.tsx"]) {
      expect(reached.has(file), file).toBe(false);
    }
  });

  it("gives the public send buttons the runner through SubmitButton's flag", () => {
    // The owner: "butoanele de trimitere înscriere și contact trebuie să aibă și iconița cu un
    // alergător". The registration's send, its "send again" after a refusal, and the contact
    // form's send — each a `SubmitButton` with `runner`, and no name looked up anywhere.
    const register = read("src/app/[locale]/events/[slug]/register/page.tsx");
    const contact = read("src/app/[locale]/contact/page.tsx");
    // The props with their comments taken out, so "the club's runner" in a comment is not the flag.
    const runners = (text: string) =>
      [...text.matchAll(/<SubmitButton\b([\s\S]*?)\/>/g)]
        .map((match) => match[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""))
        .filter((props) => /\brunner\b/.test(props))
        .map((props) => props.match(/label=\{t\("([\w.]+)"\)\}/)?.[1]);
    expect(runners(register).sort()).toEqual(["errors.tooFastResend", "submit"]);
    expect(runners(contact)).toEqual(["submit"]);
    expect(registry).not.toMatch(/DirectionsRun/);
  });

  it("keeps the send button's pending runner, sized to the glyph it replaces (§304 untouched)", () => {
    const button = read("src/shared/ui/SubmitButton.tsx");
    expect(button).toMatch(/pending \? \(\s*<RunnerLoader size=\{GLYPH_PX\[size\]\} color="inherit" \/>/);
    expect(button).toContain("const GLYPH_PX = { small: 18, medium: 20, large: 22 } as const;");
    // The runner the public buttons wear at rest is the figure RunnerLoader animates (§166): one
    // file, imported directly by both, so the send button costs no glyph it did not already carry.
    const runnerImport = /import DirectionsRunIcon from "@mui\/icons-material\/DirectionsRun";/;
    expect(button).toMatch(runnerImport);
    expect(read("src/shared/ui/RunnerLoader.tsx")).toMatch(runnerImport);
    expect(button).toContain("const Glyph = glyph ?? (runner ? DirectionsRunIcon : null);");
  });
});
