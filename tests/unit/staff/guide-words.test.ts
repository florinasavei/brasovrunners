import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-060-01 criterion 34 — the guide's «words» are the screen's words (§NNN).
 *
 * The guide was rewritten as numbered steps "with the exact button words" for the colleagues who
 * run the backoffice while the owner is away. The previous one had drifted: it sent the desk to
 * press "Prezent", "Confirmă aici" and "Descarcă foaia (PDF)", none of which any screen said any
 * more. A guide read with a phone in one hand fails at exactly the word that does not exist.
 *
 * So every «…» in a step, a task title, a section line or the intro must be a string the
 * backoffice (or the public page, or an email's button) actually shows, in that language:
 * - a catalogue value of the same locale, whole — or its text before the first `{placeholder}`,
 *   or without a trailing "({count})", an arrow or an ellipsis;
 * - or one of the backoffice's Romanian-only labels (`staff-labels.ts`, §35), which the English
 *   guide quotes in Romanian because that is what the English screen says too;
 * - or an email's button (`templates.ts`, `action: "…"`).
 * A quote ending in "…" names the start of a longer label, as the guide abbreviates a long tick.
 */

type Catalogue = Record<string, unknown>;
type GuideTask = { title: string; steps: string[] };
type GuideSection = { key?: string; title: string; who: string; roles: string[]; tasks: GuideTask[] };
type Guide = { intro: string; sections: GuideSection[] };

const root = process.cwd();

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const child of Object.values(value)) strings(child, out);
  return out;
}

/** Every way a label may be quoted: whole, before its first placeholder, without its decorations. */
function shapes(label: string): string[] {
  const whole = label.trim();
  const beforePlaceholder = whole.split("{")[0].trim();
  const withoutCount = whole.replace(/\s*\(\{[^}]*\}\)/g, "").trim();
  return [whole, beforePlaceholder, withoutCount]
    .flatMap((shape) => [shape, shape.replace(/^←\s*/, "").replace(/\s*→$/, "").replace(/…$/, "").trim()])
    .filter((shape) => shape.length > 0);
}

const sourceLabels = (() => {
  const staffLabels = readFileSync(path.join(root, "src/modules/staff-identity/domain/staff-labels.ts"), "utf8");
  const templates = readFileSync(path.join(root, "src/modules/notifications/templates.ts"), "utf8");
  return [
    // The repository is CRLF on Windows and LF on CI: `\r?` before the line's end.
    ...[...staffLabels.matchAll(/^\s+[A-Z_]+: "([^"]+)",\r?$/gm)].map((match) => match[1]),
    ...[...templates.matchAll(/^\s+action: "([^"]+)",\r?$/gm)].map((match) => match[1]),
  ];
})();

function screenWords(catalogue: Catalogue): { exact: Set<string>; all: string[] } {
  // The guide itself is not the screen: a quote may never be vouched for by the guide's own lines.
  const { guide: _guide, ...admin } = catalogue.Admin as Record<string, unknown>;
  void _guide;
  const all = [...strings({ ...catalogue, Admin: admin }), ...sourceLabels];
  return { exact: new Set(all.flatMap(shapes)), all };
}

function quotes(text: string): string[] {
  return [...text.matchAll(/«([^»]+)»/g)].map((match) => match[1]);
}

function guideOf(catalogue: Catalogue): Guide {
  return (catalogue.Admin as { guide: Guide }).guide;
}

/** Not the intro: it shows the notation itself, «like this», and quotes no screen. */
function everyText(guide: Guide): { where: string; text: string }[] {
  return [
    ...guide.sections.flatMap((section, s) => [
      { where: `section ${s} title`, text: section.title },
      { where: `section ${s} who`, text: section.who },
      ...section.tasks.flatMap((task, k) => [
        { where: `section ${s} task ${k} title`, text: task.title },
        ...task.steps.map((step, n) => ({ where: `section ${s} task ${k} step ${n + 1}`, text: step })),
      ]),
    ]),
  ];
}

const locales = { ro: ro as Catalogue, en: en as Catalogue };

describe("BR-REQ-060-01 criterion 34 the guide quotes the screen's own words", () => {
  for (const [locale, catalogue] of Object.entries(locales)) {
    it(`${locale}: every «…» is a label the backoffice shows`, () => {
      const guide = guideOf(catalogue);
      const { exact, all } = screenWords(catalogue);
      const unknown: string[] = [];
      let quoted = 0;
      for (const { where, text } of everyText(guide)) {
        for (const quote of quotes(text)) {
          quoted += 1;
          const found = quote.endsWith("…")
            ? all.some((label) => label.startsWith(quote.slice(0, -1).trim()))
            : exact.has(quote);
          if (!found) unknown.push(`${where}: «${quote}»`);
        }
      }
      // The guide is made of button words; a rewrite that dropped them would pass vacuously.
      expect(quoted).toBeGreaterThan(200);
      expect(unknown).toEqual([]);
    });
  }

  it("each task is a title and at least one numbered step, in every section", () => {
    for (const catalogue of Object.values(locales)) {
      const guide = guideOf(catalogue);
      expect(guide.sections.length).toBeGreaterThan(0);
      for (const section of guide.sections) {
        expect(section.tasks.length, section.title).toBeGreaterThan(0);
        for (const task of section.tasks) {
          expect(task.title.trim(), section.title).not.toBe("");
          expect(task.steps.length, task.title).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the two languages are the same guide: sections, roles, tasks, steps, quotes and placeholders", () => {
    const [roGuide, enGuide] = [guideOf(locales.ro), guideOf(locales.en)];
    expect(enGuide.sections.map((section) => [section.key ?? null, section.roles])).toEqual(
      roGuide.sections.map((section) => [section.key ?? null, section.roles]),
    );
    roGuide.sections.forEach((section, s) => {
      const other = enGuide.sections[s];
      expect(other.tasks.map((task) => task.steps.length), section.title).toEqual(section.tasks.map((task) => task.steps.length));
      section.tasks.forEach((task, k) => {
        task.steps.forEach((step, n) => {
          const twin = other.tasks[k].steps[n];
          const where = `${section.title} / ${task.title} / step ${n + 1}`;
          expect(quotes(twin).length, where).toBe(quotes(step).length);
          const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
          expect(placeholders(twin), where).toEqual(placeholders(step));
        });
      });
    });
  });

  it("names only roles that exist, and gives every role at least one section of its own", () => {
    const guide = guideOf(locales.ro);
    for (const section of guide.sections) for (const role of section.roles) expect(STAFF_ROLES).toContain(role);
    for (const role of STAFF_ROLES) expect(guide.sections.some((section) => section.roles.includes(role)), role).toBe(true);
  });

  it("keeps the family section the page appends its pending line to (§389)", () => {
    for (const catalogue of Object.values(locales)) {
      expect(guideOf(catalogue).sections.filter((section) => section.key === "family")).toHaveLength(1);
    }
  });
});
