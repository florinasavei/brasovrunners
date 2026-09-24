import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditableEvent } from "@/modules/content/events/repository";
import type { FoldNode } from "@/shared/ui/fold";

/**
 * §NNN (the event editor's first box, building on §350) — the owner, 2026-09-24, with a screenshot
 * of the editor: "these 3 cards should be in the first one, both on edit and create mode".
 *
 * "Starea evenimentului", "Traseul" and "Linkuri și fișiere" are named level-3 cards inside "Ce fel
 * de eveniment", under the type and its help, closed by default with their own closed lines — the
 * way "Participare și înscrieri" holds 8.1–8.5. The first box's closed line says a word or two of
 * each. On the create page the status card is read-only: "Programat", and that it can be changed
 * once the event exists.
 *
 * The boxes are async Server Components; each is awaited here into the element tree it hands
 * React, the cards are handed to the first box as the pages hand them, and the whole is rendered
 * to the HTML the server sends — because whether a card sits inside the box is exactly what the
 * markup says, and it is the only thing that decides what opens with JavaScript off.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Admin" }),
    getLocale: async () => currentLocale,
  };
});

const { default: KindBox } = await import("@/modules/content/events/ui/boxes/KindBox");
const { default: StatusBox } = await import("@/modules/content/events/ui/boxes/StatusBox");
const { default: CourseBox } = await import("@/modules/content/events/ui/boxes/CourseBox");
const { default: LinksBox } = await import("@/modules/content/events/ui/boxes/LinksBox");
const { revealField } = await import("@/shared/forms/ActionForm");

afterEach(() => {
  currentLocale = "ro";
});

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
/** The markup without the `<style>` tags Emotion writes beside each element on a server. */
const markup = (html: string): string => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

const GPX = ["https:/", "drive.example.test", "file", "d", "gpx", "view"].join("/");
const STRAVA = ["https:/", "strava.example.test", "clubs", "1", "group_events", "2"].join("/");

const EVENT = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "GROUP_RUN",
  eventStatus: "SCHEDULED",
  surface: "ASPHALT",
  difficulty: "EASY",
  distanceMeters: 10_000,
  elevationGainMeters: 120,
  routeUrl: "https://routes.example.test/tampa",
  stravaEventUrl: STRAVA,
  facebookEventUrl: null,
  links: [{ kind: "GPX", url: GPX, labelRo: "Traseul", labelEn: null }],
  timezone: "Europe/Bucharest",
} as unknown as EditableEvent;

const NOTICE = {
  labels: {
    notify: "Anunță participanții",
    notifyHelp: "",
    note: "Nota",
    noteHelp: "",
    cancelTitle: "Anulezi evenimentul",
    cancelIntro: "",
    cancelReason: "Motivul",
    cancelReasonHelp: "",
    cancelNotify: "Anunță-i",
    cancelNotifyHelp: "",
  },
  offerNotice: true,
  maxLength: 500,
};

/** The first box with its three cards, exactly as a page hands them in, rendered to HTML. */
async function firstBox(event: EditableEvent | null, locale: "ro" | "en" = "ro"): Promise<string> {
  currentLocale = locale;
  const box = { event, mayEditSettings: true } as const;
  const cards: ReactNode[] = [
    event ? await StatusBox({ ...box, notice: NOTICE }) : await StatusBox(box),
    await CourseBox(box),
    await LinksBox({ ...box, locale }),
  ];
  const element = (await KindBox({ ...box, locale, children: cards })) as ReactElement;
  return markup(renderToStaticMarkup(element));
}

/** Every `<details …>` opening tag, in document order. */
const foldTags = (html: string): string[] => html.match(/<details[^>]*>/g) ?? [];
const isOpen = (tag: string): boolean => /\sopen(=""|\s|>)/.test(tag);
const idOf = (tag: string): string | null => tag.match(/\sid="([^"]+)"/)?.[1] ?? null;

/**
 * The folds an element sits inside, outermost first, read off the markup: every `<details>` opened
 * before the element's `id` and not yet closed. What `openFoldsAround` walks up, written down.
 */
function foldsAround(html: string, id: string): (string | null)[] {
  const at = html.indexOf(`id="${id}"`);
  expect(at, `${id} is in the markup`).toBeGreaterThan(-1);
  const stack: (string | null)[] = [];
  for (const match of html.slice(0, at).matchAll(/<(\/?)details\b[^>]*>/g)) {
    if (match[1] === "/") stack.pop();
    else stack.push(idOf(match[0]));
  }
  return stack;
}

/** The element as `revealField` reads it: a chain of parents, each a closed `<details>` or not. */
function chain(folds: (string | null)[]): { node: FoldNode & { dispatchEvent: () => boolean }; details: (FoldNode & { id: string | null })[] } {
  let parent: FoldNode | null = null;
  const details: (FoldNode & { id: string | null })[] = [];
  for (const id of folds) {
    const fold: FoldNode & { id: string | null } = { tagName: "DETAILS", open: false, parentElement: parent, id };
    details.push(fold);
    parent = fold;
  }
  return { node: { tagName: "INPUT", parentElement: parent, dispatchEvent: () => true }, details };
}

describe("§NNN the first box holds the status, the course and the links", () => {
  it("nests three named, closed level-3 cards inside «Ce fel de eveniment», after the type and its help", async () => {
    const html = await firstBox(EVENT);
    const folds = foldTags(html);
    expect(idOf(folds[0])).toBe("box-kind");
    // The whole markup is the one box: it opens first and closes last.
    expect(html.startsWith("<details")).toBe(true);
    expect(html.endsWith("</details>")).toBe(true);
    // Closed on the editor, and every card inside it closed too (§336).
    expect(folds.every((tag) => !isOpen(tag))).toBe(true);

    const cards = ["box-status", "box-course", "box-links"];
    for (const id of cards) expect(foldsAround(html, id), id).toEqual(["box-kind"]);
    // In this order, and after the type select and "Ce înseamnă fiecare tip?".
    const positions = cards.map((id) => html.indexOf(`id="${id}"`));
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
    expect(html.indexOf('name="event.type"')).toBeLessThan(positions[0]);
    expect(html.indexOf("Ce înseamnă fiecare tip?")).toBeLessThan(positions[0]);

    // Named: an h3 each under the box's h2, so the heading list has the screen's shape.
    expect(html).toMatch(/<h2[^>]*>Ce fel de eveniment/);
    for (const name of ["Starea evenimentului", "Traseul", "Linkuri și fișiere"]) expect(html).toMatch(new RegExp(`<h3[^>]*>${name}<span`));
  });

  it("keeps each card's own closed line, and says a word or two of each on the box's", async () => {
    const html = await firstBox(EVENT);
    expect(html).toContain("Alergare de grup · Programat · Asfalt · Ușor · 10 km · 2 linkuri");
    // The cards' own lines: the status, the whole course, which kinds of links.
    expect(html).toMatch(/<h3[^>]*>Starea evenimentului<span[^>]*>Programat<\/span>/);
    expect(html).toContain("Asfalt · Ușor · 10 km · +120 m · traseu");
    expect(html).toContain("Strava · 1 link (Traseul (GPX))");
  });

  it("says the same in English on the English backoffice", async () => {
    const html = await firstBox(EVENT, "en");
    expect(html).toContain("Group run · Programat · Asphalt · Easy · 10 km · 2 links");
    for (const name of ["Event status", "The course", "Links and files"]) expect(html).toMatch(new RegExp(`<h3[^>]*>${name}<span`));
  });

  it("posts the same names as before, from inside the cards", async () => {
    const html = await firstBox(EVENT);
    for (const name of ["event.eventStatus", "event.surface", "event.difficulty", "event.distanceMeters", "event.elevationGainMeters", "event.routeUrl", "event.stravaEventUrl", "event.facebookEventUrl", "event.links[0].url"]) {
      expect(html, name).toContain(`name="${name}"`);
    }
  });
});

describe("§NNN the create page's first box looks the same", () => {
  it("is open, holds the same three cards, and says «Programat» on its closed line", async () => {
    const html = await firstBox(null);
    const folds = foldTags(html);
    expect(idOf(folds[0])).toBe("box-kind");
    expect(isOpen(folds[0])).toBe(true);
    for (const id of ["box-status", "box-course", "box-links"]) {
      expect(foldsAround(html, id), id).toEqual(["box-kind"]);
      expect(isOpen(folds.find((tag) => idOf(tag) === id) ?? ""), id).toBe(false);
    }
    expect(html).toContain("Alergare de grup · Programat");
  });

  it("shows the status read-only — «Programat», no select, nothing posted — with the line that says when it can change", async () => {
    const html = await firstBox(null);
    const status = html.slice(html.indexOf('id="box-status"'), html.indexOf('id="box-course"'));
    expect(status).toContain('data-testid="status-on-create"');
    expect(status).toMatch(/<input[^>]*disabled[^>]*value="Programat"|<input[^>]*value="Programat"[^>]*disabled/);
    // The page's hidden `SCHEDULED` posts; the card posts nothing and offers nothing else.
    expect(status).not.toContain('name="event.eventStatus"');
    expect(status).not.toContain("Anulat");
    expect(status).not.toContain("Încheiat");
    expect(status).toContain("Un eveniment nou pornește ca Programat; starea se poate schimba după ce evenimentul e creat.");
  });

  it("says so in English too", async () => {
    const html = await firstBox(null, "en");
    expect(html).toContain("A new event starts as scheduled (Programat); its status can be changed once the event exists.");
    expect(html).toContain("Group run · Programat");
  });

  it("keeps the hidden SCHEDULED on the create page, beside the card", () => {
    const create = read("src/app/[locale]/admin/events/new/page.tsx");
    expect(create).toContain('<input type="hidden" name="event.eventStatus" value="SCHEDULED" />');
    expect(create).toMatch(/<KindBox \{\.\.\.box\} locale=\{locale\}>\s*<StatusBox \{\.\.\.box\} \/>/);
  });
});

describe("§NNN a refusal inside a card opens the box and the card", () => {
  it("opens «Ce fel de eveniment» and «Traseul» for a refused route link", async () => {
    const html = await firstBox(EVENT);
    const around = foldsAround(html, "field-event.routeUrl");
    expect(around).toEqual(["box-kind", "box-course"]);
    const { node, details } = chain(around);
    revealField(node as unknown as HTMLElement);
    expect(details.map((fold) => [fold.id, fold.open])).toEqual([
      ["box-kind", true],
      ["box-course", true],
    ]);
  });

  it("opens the box and «Linkuri și fișiere» for a link row's address or a one-sided label", async () => {
    const html = await firstBox(EVENT);
    for (const field of ["field-event.links[0].url", "field-event.links[0].labelEn", "field-event.stravaEventUrl"]) {
      const around = foldsAround(html, field);
      expect(around, field).toEqual(["box-kind", "box-links"]);
      const { node, details } = chain(around);
      revealField(node as unknown as HTMLElement);
      expect(details.every((fold) => fold.open), field).toBe(true);
    }
  });

  it("opens the box and «Starea evenimentului» for the status", async () => {
    const html = await firstBox(EVENT);
    expect(foldsAround(html, "field-event.eventStatus")).toEqual(["box-kind", "box-status"]);
  });

  it("keeps the ids a deep link or a publish check's link lands on", async () => {
    const html = await firstBox(EVENT);
    for (const id of ["box-kind", "box-status", "box-course", "box-links"]) expect(html).toContain(`id="${id}"`);
  });
});
