import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-060-01 (the backoffice's verbs), BR-REQ-041-01 (the public send buttons);
 * `DECISIONS.md` §170 and §NNN — one glyph per verb, looked up by name.
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
 *   under different words — "Șterge definitiv" on four screens — wear the same glyph.
 *
 * Source-level, like `held-press-is-sent.test.ts`: the suite runs in Node with no DOM, and the
 * rule is about what is written, not about what one render happens to produce. TypeScript
 * already refuses an unknown name at the call site; this is what catches the other two.
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
    // <SubmitButton label={t("x")} … icon="y" … />, and the same for the confirming button.
    for (const match of text.matchAll(/<(SubmitButton|ConfirmSubmitButton)\b([\s\S]*?)\/>/g)) {
      const props = match[2];
      const icon = props.match(/\bicon="(\w+)"/)?.[1];
      const label = props.match(/\blabel=\{(t[a-zA-Z]*\("[\w.]+"(?:,[^)]*)?\))\}/)?.[1];
      const key = label?.match(LOOKUP)?.[1];
      if (icon && key) found.push({ key, icon, file });
    }
    // <GlyphButton icon="y" …>{t("x")}</GlyphButton>, and the same for ButtonLink.
    for (const match of text.matchAll(/<(GlyphButton|ButtonLink)\b([^>]*?)>([\s\S]*?)<\/\1>/g)) {
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
  { glyph: "runner", keys: ["submit", "errors.tooFastResend"] },
];

describe("§NNN one glyph per verb, by name", () => {
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

  it("makes the element on the client, from the name, in the shared buttons", () => {
    // The whole reason for the registry: a Server Component passes a string, the client
    // component looks the glyph up. None of these may take an element-valued icon prop.
    for (const file of ["src/shared/ui/GlyphButton.tsx", "src/shared/ui/SubmitButton.tsx", "src/shared/ui/ButtonLink.tsx", "src/shared/ui/ConfirmSubmitButton.tsx", "src/shared/ui/RowMenu.tsx", "src/modules/registrations/ui/RegistrationRowMenu.tsx"]) {
      const text = read(file);
      expect(text.split("\n")[0], file).toMatch(/^"use client";/);
      expect(text, file).toContain("ACTION_ICONS[");
      expect(text, file).toContain("ActionIconName");
    }
  });

  it("keeps the send button's pending runner, sized to the glyph it replaces (§304 untouched)", () => {
    const button = read("src/shared/ui/SubmitButton.tsx");
    expect(button).toMatch(/pending \? \(\s*<RunnerLoader size=\{GLYPH_PX\[size\]\} color="inherit" \/>/);
    expect(button).toContain("const GLYPH_PX = { small: 18, medium: 20, large: 22 } as const;");
    // The runner the public buttons wear at rest is the figure RunnerLoader animates (§166).
    expect(registry).toMatch(/import DirectionsRunIcon from "@mui\/icons-material\/DirectionsRun";/);
    expect(read("src/shared/ui/RunnerLoader.tsx")).toMatch(/import DirectionsRunIcon from "@mui\/icons-material\/DirectionsRun";/);
    expect(registry).toMatch(/runner: DirectionsRunIcon,/);
  });
});
