import { readFileSync } from "node:fs";
import path from "node:path";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import CoHostRowsEditor from "@/modules/content/events/ui/CoHostRowsEditor";
import LinkRowsEditor from "@/modules/content/events/ui/LinkRowsEditor";
import ScheduleRowsEditor from "@/modules/content/events/ui/ScheduleRowsEditor";
import { revealField } from "@/shared/forms/ActionFormIsland";
import { RecallProvider } from "@/shared/forms/recall";
import type { FoldNode } from "@/shared/ui/fold";
import ro from "../../../messages/ro.json";

/**
 * §842's row fold, carried to the event editor's three remaining lists (the consistency audit's
 * second wave; the owner, 2026-10-21: «they look like they are from a different app, not consistent
 * at all»): «Linkuri și fișiere», «Parteneri» and the programme's timed rows. Each saved item is a
 * `<li>` of one `<details>` whose `<summary>` is the item in words, with the pencil; its boxes open
 * under it, inside the event's one save form. A row added in this sitting, and the spare line of an
 * empty list, is a fold that opens by itself.
 *
 * Rendered to the HTML the server sends, because that is what decides what is open with JavaScript
 * off; the pitfall of a box the browser refuses inside a closed fold is proved on the same markup.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const markup = (html: string): string => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const editor = ro.Admin.editor;
const words = editor.boxes.summary;

type Recalled = { values: Record<string, string[]>; fields: string[] };

/** One island, rendered as the editor's form hands it out: inside the kept form's recall, and the catalogue the time box reads. */
function render(element: ReactElement, recalled?: Recalled): string {
  const inner = recalled
    ? createElement(
        RecallProvider,
        { value: { values: recalled.values, fields: recalled.fields, generation: 1, fieldError: "Verifică acest câmp." } } as unknown as ComponentProps<typeof RecallProvider>,
        element,
      )
    : element;
  return markup(renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "ro", messages: ro } as unknown as ComponentProps<typeof NextIntlClientProvider>, inner)));
}

const LINK_KINDS = { GPX: "Traseul (GPX)", MAP: "Harta", DOCUMENT: "Document", PHOTOS: "Album", RESULTS: "Rezultate", OTHER: "Link" } as const;

const links = (initial: ComponentProps<typeof LinkRowsEditor>["initial"], recalled?: Recalled) =>
  render(
    createElement(LinkRowsEditor, {
      initial,
      kindLabels: LINK_KINDS,
      constraints: { url: { pattern: "[Hh][Tt][Tt][Pp][Ss]://.*", maxLength: 2048 }, label: { maxLength: 80 } },
      locale: "ro",
      labels: { ...editor.linkRows, uploadGpx: "", labelOneLanguage: words.links.labelOneLanguage },
    }),
    recalled,
  );

const partners = (initial: ComponentProps<typeof CoHostRowsEditor>["initial"]) =>
  render(
    createElement(CoHostRowsEditor, {
      initial,
      kindLabels: { SITE: "Site", EVENT: "Eveniment", REGISTRATION: "Înscriere", FACEBOOK: "Facebook", INSTAGRAM: "Instagram", STRAVA: "Strava", OTHER: "Link" },
      constraints: { url: { pattern: "[Hh][Tt][Tt][Pp][Ss]://.*" }, label: { maxLength: 80 }, description: { maxLength: 300 } },
      locale: "ro",
      labels: {
        ...editor.coHostRows,
        descriptionRo: "Română",
        descriptionEn: "English",
        identical: editor.identical.warning,
        linkCount: words.links.files,
        describedOneLanguage: words.coHosts.describedOneLanguage,
      },
    }),
  );

const programme = (initial: ComponentProps<typeof ScheduleRowsEditor>["initial"]) =>
  render(createElement(ScheduleRowsEditor, { initial, startDateName: "event.startsAtDate", startDate: "2027-05-10", locale: "ro", labels: editor.programmeRows }));

/** Every `<details …>` opening tag with its testid, in document order. */
const folds = (html: string, testId: string): string[] => html.match(new RegExp(`<details[^>]*data-testid="${testId}"[^>]*>`, "g")) ?? [];
const isOpen = (tag: string): boolean => /\sopen(=""|\s|>)/.test(tag);
/** A row's summary: the line it shows while shut. */
const summaries = (html: string, testId: string): string[] =>
  [...html.matchAll(new RegExp(`<summary[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</summary>`, "g"))].map((match) => match[1].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, ""));

/**
 * The element as `revealField` reads it — the box the browser refused, inside the folds the markup
 * puts it in — so the proof walks the same chain `ActionForm`'s `onInvalidCapture` hands it.
 */
function refusedInside(html: string, name: string): { node: HTMLElement; folds: FoldNode[] } {
  const at = html.indexOf(`name="${name}"`);
  expect(at, `${name} is in the markup`).toBeGreaterThan(-1);
  const stack: boolean[] = [];
  for (const match of html.slice(0, at).matchAll(/<(\/?)details\b[^>]*>/g)) {
    if (match[1] === "/") stack.pop();
    else stack.push(isOpen(match[0]));
  }
  let parent: FoldNode | null = null;
  const chain: FoldNode[] = [];
  for (const open of stack) {
    const fold: FoldNode = { tagName: "DETAILS", open, parentElement: parent };
    chain.push(fold);
    parent = fold;
  }
  return { node: { tagName: "INPUT", parentElement: parent, dispatchEvent: () => true } as unknown as HTMLElement, folds: chain };
}

const GPX = ["https:/", "drive.example.test", "file", "d", "gpx"].join("/");
const ALBUM = ["https:/", "www.photos.example.test", "album"].join("/");

describe("§842 «Linkuri și fișiere»: each link is a row fold", () => {
  it("draws each saved link as a closed row whose line is its glyph, its label and its host, with the pencil", () => {
    const html = links([
      { kind: "GPX", url: GPX, labelRo: "Traseul oficial", labelEn: "The official route" },
      { kind: "PHOTOS", url: ALBUM, labelRo: "", labelEn: "" },
    ]);
    expect(html).toMatch(/<ul[^>]*>\s*<li/);
    const rows = folds(html, "link-row");
    expect(rows).toHaveLength(2);
    expect(rows.every((tag) => !isOpen(tag))).toBe(true);
    // The label in the editor's language and the host, never the whole address; no label is the kind's word, as the page says it.
    expect(summaries(html, "link-row-toggle")).toEqual(["Traseul oficial · drive.example.test", "Album · photos.example.test"]);
    expect(html).toContain(`title="${editor.linkRows.edit}"`);
    expect(html.match(/data-testid="EditIcon"/g)).toHaveLength(2);
    // The boxes are in the fold, posting as before; the verbs last, «Șterge linkul» in words.
    for (const box of ["kind", "url", "labelRo", "labelEn"]) expect(html).toContain(`name="event.links[1].${box}"`);
    expect(html).toMatch(/role="group" aria-label="Linkul 1"/);
    const first = html.slice(html.indexOf('aria-label="Linkul 1"'), html.indexOf('aria-label="Linkul 2"'));
    expect(first.indexOf('aria-label="Șterge linkul 1"')).toBeGreaterThan(first.indexOf('name="event.links[0].labelEn"'));
    expect(first).toMatch(/aria-label="Șterge linkul 1"[^>]*>[\s\S]*?Șterge linkul<\/button>/);
  });

  it("says «etichetă într-o singură limbă» on the line of a half-written label, the box's own words", () => {
    const html = links([{ kind: "GPX", url: GPX, labelRo: "Traseul", labelEn: "" }]);
    expect(summaries(html, "link-row-toggle")[0]).toContain(words.links.labelOneLanguage);
  });

  it("opens the spare line of an empty list by itself, reading «Link nou», with the add button under the list", () => {
    const html = links([]);
    const rows = folds(html, "link-row");
    expect(rows).toHaveLength(1);
    expect(isOpen(rows[0])).toBe(true);
    expect(summaries(html, "link-row-toggle")).toEqual([editor.linkRows.new]);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[\s\S]*?data-testid="AddIcon"[\s\S]*?Adaugă un link<\/button>/);
  });

  it("opens the row a refusal named, and marks only it", () => {
    const recalled = {
      values: {
        "event.links[0].kind": ["GPX"],
        "event.links[0].url": [GPX],
        "event.links[0].labelRo": ["Traseul"],
        "event.links[0].labelEn": [""],
        "event.links[1].kind": ["PHOTOS"],
        "event.links[1].url": [ALBUM],
        "event.links[1].labelRo": [""],
        "event.links[1].labelEn": [""],
      },
      fields: ["event.links[0].labelEn"],
    };
    const rows = folds(links([], recalled), "link-row");
    expect(rows.map(isOpen)).toEqual([true, false]);
  });
});

describe("§842 «Parteneri»: each partner is a row fold", () => {
  it("draws each saved partner as a closed row: its name and a chip counting the links with an address", () => {
    const html = partners([
      {
        name: "Salvamont Brașov",
        descriptionRo: "Siguranța pe traseu.",
        descriptionEn: "",
        links: [
          { kind: "SITE", url: "https://salvamont.example.test", labelRo: "", labelEn: "" },
          { kind: "FACEBOOK", url: "https://facebook.example.test/salvamont", labelRo: "", labelEn: "" },
        ],
      },
      { name: "Clubul Prietenilor", descriptionRo: "", descriptionEn: "", links: [] },
    ]);
    const rows = folds(html, "co-host-row");
    expect(rows).toHaveLength(2);
    expect(rows.every((tag) => !isOpen(tag))).toBe(true);
    const lines = summaries(html, "co-host-row-toggle");
    expect(lines[0]).toBe(`Salvamont Brașov2 linkuri${words.coHosts.describedOneLanguage}`);
    // The spare link a partner with none opens on is no link: no chip.
    expect(lines[1]).toBe("Clubul Prietenilor");
    expect(html).toContain(`title="${editor.coHostRows.edit}"`);
    // The name, the description, the links — and the partner's verbs last, «Șterge partenerul» in words.
    const first = html.slice(0, html.indexOf('data-testid="co-host-row"', html.indexOf('data-testid="co-host-row"') + 1));
    expect(first.indexOf('aria-label="Șterge partenerul 1"')).toBeGreaterThan(first.indexOf('name="event.coHosts[0].links[1].labelEn"'));
    expect(first).toMatch(/aria-label="Șterge partenerul 1"[^>]*>[\s\S]*?Șterge partenerul<\/button>/);
    // A partner's link still says whose it is (§347).
    expect(first).toContain('aria-label="Linkul 2 al partenerului 1"');
  });

  it("opens the spare card of an empty list by itself, reading «Partener nou»", () => {
    const html = partners([]);
    const rows = folds(html, "co-host-row");
    expect(rows).toHaveLength(1);
    expect(isOpen(rows[0])).toBe(true);
    expect(summaries(html, "co-host-row-toggle")).toEqual([editor.coHostRows.partnerNew]);
  });
});

describe("§842 the programme: each timed row is a row fold", () => {
  it("draws each saved row as a closed line: its hours and its words, the day and the place beside them", () => {
    const html = programme([
      { date: "2027-05-10", time: "08:00", endTime: "09:30", ro: "Ridicarea kiturilor", en: "Race kit pickup", place: "Cortul de start" },
      { date: "2027-05-10", time: "10:00", endTime: "", ro: "Startul", en: "The start", place: "" },
    ]);
    const rows = folds(html, "programme-row");
    expect(rows).toHaveLength(2);
    expect(rows.every((tag) => !isOpen(tag))).toBe(true);
    expect(summaries(html, "programme-row-toggle")).toEqual(["08:00–09:30 Ridicarea kiturilor10.05.2027 · Cortul de start", "10:00 Startul10.05.2027"]);
    expect(html).toContain(`title="${editor.programmeRows.edit}"`);
    // The grid of §405 inside the fold, the bin still last and still a 44-pixel square beside the times.
    const row = html.slice(html.indexOf('role="group" aria-label="Rândul 1"'));
    expect(row.indexOf('aria-label="Șterge rândul 1"')).toBeGreaterThan(row.indexOf('name="event.schedule[0].en"'));
  });

  it("opens the spare line of an empty programme by itself, on the event's day, reading «Rând nou»", () => {
    const html = programme([]);
    const rows = folds(html, "programme-row");
    expect(rows).toHaveLength(1);
    expect(isOpen(rows[0])).toBe(true);
    expect(summaries(html, "programme-row-toggle")).toEqual([`${editor.programmeRows.new}10.05.2027`]);
  });
});

describe("§842 a box the browser refuses inside a closed row is never a silent «Salvează»", () => {
  it("puts no `required` on any box of a row: a saved row can be emptied, and a blank one is dropped on save", () => {
    const html = [
      links([{ kind: "GPX", url: GPX, labelRo: "", labelEn: "" }]),
      partners([{ name: "Salvamont", descriptionRo: "", descriptionEn: "", links: [{ kind: "SITE", url: "https://salvamont.example.test", labelRo: "", labelEn: "" }] }]),
      programme([{ date: "2027-05-10", time: "10:00", endTime: "", ro: "Startul", en: "The start", place: "" }]),
    ].join("");
    const boxes = html.match(/<(?:input|textarea)[^>]*name="event\.(?:links|coHosts|schedule)\[[^>]*>/g) ?? [];
    expect(boxes.length).toBeGreaterThan(10);
    for (const box of boxes) expect(box, box).not.toMatch(/\srequired(=|\s|>)/);
  });

  it("opens the closed row around a box the browser refuses by its pattern (an address, a time), through the form's `onInvalidCapture`", () => {
    for (const [html, name] of [
      [links([{ kind: "GPX", url: GPX, labelRo: "", labelEn: "" }]), "event.links[0].url"],
      [partners([{ name: "Salvamont", descriptionRo: "", descriptionEn: "", links: [{ kind: "SITE", url: "https://salvamont.example.test", labelRo: "", labelEn: "" }] }]), "event.coHosts[0].links[0].url"],
      [programme([{ date: "2027-05-10", time: "10:00", endTime: "", ro: "Startul", en: "The start", place: "" }]), "event.schedule[0].time"],
    ] as const) {
      expect(html.match(new RegExp(`<input[^>]*name="${name.replace(/[[\].]/g, "\\$&")}"[^>]*>`))?.[0], name).toMatch(/\spattern="/);
      const { node, folds: around } = refusedInside(html, name);
      expect(around.length, name).toBe(1);
      expect(around[0].open, name).toBe(false);
      revealField(node);
      expect(around[0].open, name).toBe(true);
    }
    // The event's save form is an `ActionForm`, whose form hands every refused box to `revealField` during the event.
    const form = read("src/shared/forms/ActionFormIsland.tsx");
    expect(form).toContain("onInvalidCapture={onInvalidCapture}");
    expect(form).toMatch(/const onInvalidCapture = \(event: FormEvent<HTMLFormElement>\) => \{\s*revealField\(event\.target as HTMLElement\);/);
    expect(read("src/app/[locale]/admin/events/[id]/page.tsx")).toMatch(/<ActionForm action=\{saveEventAndTranslationsAction\}/);
  });

  it("keeps the one form: no list draws a form of its own", () => {
    for (const file of ["LinkRowsEditor", "CoHostRowsEditor", "ScheduleRowsEditor"]) {
      const source = read(`src/modules/content/events/ui/${file}.tsx`);
      expect(source, file).not.toMatch(/<form\b|component="form"|<(?:Detached)?ActionForm\b/);
      expect(source.match(/sx=\{SUMMARY_SX\}/g), file).toHaveLength(1);
    }
  });
});
