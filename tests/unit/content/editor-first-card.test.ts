import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditableEvent } from "@/modules/content/events/repository";
import type { RiskMark } from "@/modules/content/events/ui/boxes/box-kit";
import type { FoldNode } from "@/shared/ui/fold";

/**
 * The event editor's first box, and the three cards that were inside it.
 *
 * §358 (2026-09-24; the owner: "these 3 cards should be in the first one, both on edit and create
 * mode") nested "Starea evenimentului", "Traseul" and "Linkuri și fișiere" inside "Ce fel de
 * eveniment". §NNN (2026-09-25; the owner: "am nevoie de mai multe căsuțe la editor ca să văd exact
 * ce flow am în pagină") lays the editor out as the page instead, card by card in the page's order,
 * and the three are drawn in three different places on the page — or, the status, nowhere — so
 * each is a box of its own again, moved whole: the same fields, the same names, the same ids, the
 * same closed lines. The first box is the type alone, and its closed line is the type.
 *
 * What §358 settled and still holds is kept here: the create page's status is read-only
 * ("Programat", nothing posted); a role that may only read the settings sees each box as its
 * heading and its line; the status box wears the amber outline of a box whose change reaches people
 * (the count itself is said once, under the page map, §NNN); a refusal
 * opens the box it names — one fold now, not two.
 *
 * The boxes are async Server Components; each is awaited into the element tree it hands React and
 * rendered to the HTML the server sends — the markup is what decides what opens with JavaScript off.
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

/*
  "Setările le schimbă…" is an async Server Component, drawn inside a box, and a string renderer
  cannot wait for one nested in a tree; the same words, drawn synchronously, and counted the same.
*/
vi.mock("@/modules/content/events/ui/boxes/box-kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/content/events/ui/boxes/box-kit")>();
  const { createElement } = await import("react");
  const ro = (await import("../../../messages/ro.json")).default;
  return { ...actual, SettingsReadOnly: () => createElement("p", null, ro.Admin.editor.boxes.settingsReadOnly) };
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
  links: [{ kind: "GPX", url: GPX, labelRo: "Traseul", labelEn: "The route" }],
  timezone: "Europe/Bucharest",
} as unknown as EditableEvent;

/** The same event with its link's label in Romanian only — what the next save refuses (§354). */
const ONE_LANGUAGE_LABEL = { ...EVENT, links: [{ kind: "GPX", url: GPX, labelRo: "Traseul", labelEn: null }] } as unknown as EditableEvent;

/** 23 real registrations: the amber outline a box that reaches people wears (§350, §NNN). */
const RISK: RiskMark = { count: 23 };

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
    languageRo: "Română",
    languageEn: "English",
    identical: "",
  },
  offerNotice: true,
  maxLength: 500,
};

type BoxOptions = { locale?: "ro" | "en"; mayEditSettings?: boolean; risk?: RiskMark | null };
type Boxes = { kind: string; status: string; course: string; links: string };

/**
 * The four boxes as the pages hand them their props, each rendered to HTML on its own: the editor
 * hands the status box its notice and the risk mark; the create page hands neither.
 */
async function boxes(event: EditableEvent | null, { locale = "ro", mayEditSettings = true, risk = null }: BoxOptions = {}): Promise<Boxes> {
  currentLocale = locale;
  const box = { event, mayEditSettings } as const;
  const html = (element: unknown) => markup(renderToStaticMarkup(element as ReactElement));
  return {
    kind: html(await KindBox({ ...box, registered: risk?.count ?? 0 })),
    status: html(event ? await StatusBox({ event, mayEditSettings, risk, notice: NOTICE }) : await StatusBox({ event: null, mayEditSettings })),
    course: html(await CourseBox({ ...box, languages: [] })),
    links: html(await LinksBox({ ...box, locale })),
  };
}

/** A box's own summary: what it shows while shut. */
const summaryOf = (html: string): string => html.slice(0, html.indexOf("</summary>"));

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

describe("§NNN the first box is the type alone, and the three cards are boxes of their own", () => {
  it("holds no card: its only fold is itself, closed on the editor, with the type as its line", async () => {
    const { kind } = await boxes(EVENT);
    expect(foldTags(kind).filter((tag) => !/data-rich|help/.test(tag)).map(idOf)[0]).toBe("box-kind");
    for (const id of ["box-status", "box-course", "box-links"]) expect(kind).not.toContain(`id="${id}"`);
    expect(isOpen(foldTags(kind)[0])).toBe(false);
    expect(summaryOf(kind)).toMatch(/<h2[^>]*>Ce fel de eveniment<span[^>]*>Alergare de grup<\/span>/);
    // The type select and "Ce înseamnă fiecare tip?" stay in it.
    expect(kind).toContain('name="event.type"');
    expect(kind).toContain("Ce înseamnă fiecare tip?");
  });

  it("makes each of the three a closed level-2 box, headed by an h2, with the id it always had", async () => {
    const drawn = await boxes(EVENT);
    for (const [key, id, name] of [
      ["status", "box-status", "Starea evenimentului"],
      ["course", "box-course", "Traseul"],
      ["links", "box-links", "Linkuri și fișiere"],
    ] as const) {
      const html = drawn[key];
      const first = foldTags(html)[0];
      expect(idOf(first), key).toBe(id);
      expect(isOpen(first), key).toBe(false);
      expect(foldsAround(html, id), key).toEqual([]);
      expect(html, key).toMatch(new RegExp(`<h2[^>]*>${name}<span`));
    }
  });

  it("keeps each box's own closed line, in both catalogues", async () => {
    const ro = await boxes(EVENT);
    expect(ro.status).toMatch(/<h2[^>]*>Starea evenimentului<span[^>]*>Programat<\/span>/);
    expect(ro.course).toContain("Asfalt · Ușor · 10 km · +120 m · de zi (automat) · traseu");
    expect(ro.links).toContain("Strava · 1 link (Traseul (GPX))");
    const en = await boxes(EVENT, { locale: "en" });
    expect(en.kind).toMatch(/<h2[^>]*>What kind of event<span[^>]*>Group run<\/span>/);
    for (const name of ["Event status", "The course", "Links and files"]) expect(`${en.status}${en.course}${en.links}`).toMatch(new RegExp(`<h2[^>]*>${name}<span`));
  });

  it("posts the same names as before, each from its own box", async () => {
    const drawn = await boxes(EVENT);
    expect(drawn.status).toContain('name="event.eventStatus"');
    for (const name of ["event.surface", "event.difficulty", "event.distanceMeters", "event.elevationGainMeters", "event.routeUrl"]) expect(drawn.course, name).toContain(`name="${name}"`);
    for (const name of ["event.stravaEventUrl", "event.facebookEventUrl", "event.links[0].url"]) expect(drawn.links, name).toContain(`name="${name}"`);
  });

  it("says «etichetă într-o singură limbă» on the links box's own line, seen closed (§354)", async () => {
    expect(summaryOf((await boxes(EVENT)).links)).not.toContain("etichetă într-o singură limbă");
    expect(summaryOf((await boxes(ONE_LANGUAGE_LABEL)).links)).toContain("Strava · 1 link (Traseul (GPX)) · etichetă într-o singură limbă");
    expect(summaryOf((await boxes(ONE_LANGUAGE_LABEL, { locale: "en" })).links)).toContain("label in one language only");
  });
});

describe("§NNN with people registered, the status box says so itself", () => {
  it("wears the outline and its sentence on the status box, never the count, and neither on the type, the course or the links", async () => {
    const drawn = await boxes(EVENT, { risk: RISK });
    expect(drawn.status).toContain('data-testid="risk-line"');
    // The number is said once, under the page map (§NNN) — on no box, shut or open.
    for (const key of ["kind", "status", "course", "links"] as const) expect(drawn[key], key).not.toMatch(/\b23\b/);
    for (const key of ["kind", "course", "links"] as const) expect(drawn[key], key).not.toContain('data-testid="risk-line"');
    const status = read("src/modules/content/events/ui/boxes/StatusBox.tsx");
    expect(status).toContain('tone: risk ? "risk" : "default"');
    expect(status).not.toContain("badge");
    // The type's warning about switching to a group run still speaks of the registered.
    expect(read("src/modules/content/events/ui/boxes/KindBox.tsx")).toContain('t("editor.boxes.kind.groupRunWarning", { count: registered })');
  });

  it("wears nothing without real registrations, and nothing on the create page", async () => {
    for (const drawn of [await boxes(EVENT), await boxes(null)]) {
      const all = Object.values(drawn).join("");
      expect(all).not.toContain("23 înscriși");
      expect(all).not.toContain('data-testid="risk-line"');
    }
  });
});

describe("§358 a role that may only read the settings", () => {
  it("is told once, in the type's box, and sees each other box as its heading and its line, with nothing to open", async () => {
    const drawn = await boxes(EVENT, { mayEditSettings: false, risk: RISK });
    expect(drawn.kind.match(/Setările le schimbă un Organizator sau un Administrator\./g)).toHaveLength(1);
    for (const [key, id, name, line] of [
      ["status", "box-status", "Starea evenimentului", "Programat"],
      ["course", "box-course", "Traseul", "Asfalt · Ușor · 10 km · +120 m · de zi (automat) · traseu"],
      ["links", "box-links", "Linkuri și fișiere", "Strava · 1 link (Traseul (GPX))"],
    ] as const) {
      const html = drawn[key];
      expect(foldTags(html), key).toEqual([]);
      const section = html.match(new RegExp(`<section[^>]*id="${id}"[^>]*>([\\s\\S]*?)</section>`))?.[1] ?? "";
      expect(section, id).toMatch(new RegExp(`^<h2[^>]*>${name}`));
      expect(section, id).toContain(line);
      expect(section.replace(/<h2[\s\S]*<\/h2>/, ""), id).toBe("");
    }
    // The status box wears the amber outline and no number — the page's one line says it (§NNN);
    // nothing is posted or offered.
    expect(drawn.status).not.toMatch(/\b23\b/);
    expect(Object.values(drawn).join("")).not.toMatch(/name="event\./);
  });
});

describe("§358 the create page's status is read-only", () => {
  it("opens the type's box and shows «Programat», no select, nothing posted, with the line that says when it can change", async () => {
    const drawn = await boxes(null);
    expect(isOpen(foldTags(drawn.kind)[0])).toBe(true);
    expect(drawn.status).toContain('data-testid="status-on-create"');
    expect(drawn.status).toMatch(/<input[^>]*disabled[^>]*value="Programat"|<input[^>]*value="Programat"[^>]*disabled/);
    expect(drawn.status).not.toContain('name="event.eventStatus"');
    expect(drawn.status).not.toContain("Anulat");
    expect(drawn.status).not.toContain("Încheiat");
    expect(drawn.status).toContain("Un eveniment nou pornește ca Programat; starea se poate schimba după ce evenimentul e creat.");
    const en = await boxes(null, { locale: "en" });
    expect(en.status).toContain("A new event starts as scheduled (Programat); its status can be changed once the event exists.");
  });

  it("keeps the hidden SCHEDULED on the create page, and the status box among the cards not on the page", () => {
    const create = read("src/app/[locale]/admin/events/new/page.tsx");
    expect(create).toContain('<input type="hidden" name="event.eventStatus" value="SCHEDULED" />');
    expect(create).toMatch(/t\("editor\.groups\.offPage"\)[\s\S]*<StatusBox \{\.\.\.box\} \/>/);
  });
});

describe("§NNN a refusal opens the box it names", () => {
  it("opens «Traseul» for a refused route link, «Linkuri și fișiere» for a link, «Starea evenimentului» for the status", async () => {
    const drawn = await boxes(EVENT);
    for (const [key, field, id] of [
      ["course", "field-event.routeUrl", "box-course"],
      ["links", "field-event.links[0].url", "box-links"],
      ["links", "field-event.links[0].labelEn", "box-links"],
      ["links", "field-event.stravaEventUrl", "box-links"],
      ["status", "field-event.eventStatus", "box-status"],
    ] as const) {
      const around = foldsAround(drawn[key], field);
      expect(around, field).toEqual([id]);
      const { node, details } = chain(around);
      revealField(node as unknown as HTMLElement);
      expect(details.every((fold) => fold.open), field).toBe(true);
    }
  });
});
