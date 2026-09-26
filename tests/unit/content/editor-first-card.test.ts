import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditableEvent } from "@/modules/content/events/repository";
import type { RiskMark } from "@/modules/content/events/ui/boxes/box-kit";
import type { FoldNode } from "@/shared/ui/fold";

/**
 * The event editor's first box, and the cards that were inside it.
 *
 * §358 (2026-09-24) nested "Starea evenimentului", "Traseul" and "Linkuri și fișiere" inside "Ce fel
 * de eveniment". §406 (2026-09-25) laid the editor out as the page instead and moved all three out.
 * §448 (2026-09-26; the owner: "starea evenimentului ar trebui să apară pe primul card «Ce fel de
 * eveniment»") brings the status back into the first box as a named card — whole: the same field,
 * the same name, the same id — and the first box's closed line says it beside the type: «Alergare de
 * grup · Programat». The course and the links stay boxes of their own, where the page draws them.
 *
 * The create page's status is no longer read-only (§448, the owner's second message of 2026-09-26:
 * "ar trebui să pot crea un eveniment deja anulat din start"): the editor's same select, starting
 * at "Programat", with the reason's two boxes while "Anulat" is chosen and no "tell them" box.
 *
 * What §358 settled and still holds: a role that may only read the settings sees the first box's line and is told once; the
 * status wears the amber outline of a card whose change reaches people — and so does the box that
 * holds it (the count itself is said once, under the page map, §408); a refusal opens the folds it
 * sits in.
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
const { default: CourseBox } = await import("@/modules/content/events/ui/boxes/CourseBox");
const { default: LinksBox } = await import("@/modules/content/events/ui/boxes/LinksBox");
const { revealField } = await import("@/shared/forms/ActionFormIsland");

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

/** 23 real registrations: the amber outline a box that reaches people wears (§350, §408). */
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
type Boxes = { kind: string; course: string; links: string };

/**
 * The three boxes as the pages hand them their props, each rendered to HTML on its own: the editor
 * hands the first box the notice and the risk mark; the create page hands neither.
 */
async function boxes(event: EditableEvent | null, { locale = "ro", mayEditSettings = true, risk = null }: BoxOptions = {}): Promise<Boxes> {
  currentLocale = locale;
  const box = { event, mayEditSettings } as const;
  const html = (element: unknown) => markup(renderToStaticMarkup(element as ReactElement));
  return {
    kind: html(await KindBox({ ...box, registered: risk?.count ?? 0, risk, ...(event ? { notice: NOTICE } : {}) })),
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
/** The named cards of a box: every fold with an id, the help lines left out. */
const namedFolds = (html: string): string[] => foldTags(html).map(idOf).filter((id): id is string => id !== null);

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

describe("§448 the first box holds the type and the status, and its line says both", () => {
  it("holds the status as a named card inside it — and neither the course nor the links", async () => {
    const { kind } = await boxes(EVENT);
    expect(namedFolds(kind)).toEqual(["box-kind", "box-status"]);
    expect(foldsAround(kind, "box-status")).toEqual(["box-kind"]);
    for (const id of ["box-course", "box-links"]) expect(kind).not.toContain(`id="${id}"`);
    expect(isOpen(foldTags(kind)[0])).toBe(false);
    expect(kind).toMatch(/<h3[^>]*>Starea evenimentului<span[^>]*>Programat<\/span>/);
    // The type select and "Ce înseamnă fiecare tip?" stay in it; the status select is inside it now.
    expect(kind).toContain('name="event.type"');
    expect(kind).toContain('name="event.eventStatus"');
    expect(kind).toContain("Ce înseamnă fiecare tip?");
  });

  it("says the type and the status on its closed line, in both catalogues", async () => {
    expect(summaryOf((await boxes(EVENT)).kind)).toMatch(/<h2[^>]*>Ce fel de eveniment<span[^>]*>Alergare de grup · Programat<\/span>/);
    const cancelled = { ...EVENT, type: "RACE", eventStatus: "CANCELLED" } as unknown as EditableEvent;
    expect(summaryOf((await boxes(cancelled)).kind)).toContain("Concurs · Anulat");
    expect(summaryOf((await boxes(EVENT, { locale: "en" })).kind)).toMatch(/<h2[^>]*>What kind of event<span[^>]*>Group run · Programat<\/span>/);
  });

  it("keeps the course and the links as closed level-2 boxes, with the ids and lines they always had", async () => {
    const drawn = await boxes(EVENT);
    for (const [key, id, name] of [
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
    expect(drawn.course).toContain("Asfalt · Ușor · 10 km · +120 m · de zi (automat) · traseu");
    expect(drawn.links).toContain("Strava · 1 link (Traseul (GPX))");
    const en = await boxes(EVENT, { locale: "en" });
    for (const name of ["The course", "Links and files"]) expect(`${en.course}${en.links}`).toMatch(new RegExp(`<h2[^>]*>${name}<span`));
    expect(en.kind).toMatch(/<h3[^>]*>Event status<span/);
  });

  it("posts the same names as before, each from its own box — and no declaration from «Traseul» (§448)", async () => {
    const drawn = await boxes(EVENT);
    for (const name of ["event.surface", "event.difficulty", "event.distanceMeters", "event.elevationGainMeters", "event.routeUrl"]) expect(drawn.course, name).toContain(`name="${name}"`);
    expect(drawn.course).not.toContain("group-run-declaration-field");
    for (const name of ["event.stravaEventUrl", "event.facebookEventUrl", "event.links[0].url"]) expect(drawn.links, name).toContain(`name="${name}"`);
  });

  it("says «etichetă într-o singură limbă» on the links box's own line, seen closed (§354)", async () => {
    expect(summaryOf((await boxes(EVENT)).links)).not.toContain("etichetă într-o singură limbă");
    expect(summaryOf((await boxes(ONE_LANGUAGE_LABEL)).links)).toContain("Strava · 1 link (Traseul (GPX)) · etichetă într-o singură limbă");
    expect(summaryOf((await boxes(ONE_LANGUAGE_LABEL, { locale: "en" })).links)).toContain("label in one language only");
  });
});

describe("§448 with people registered, the status card says so, and the first box wears the outline", () => {
  it("draws the sentence inside the status card, never the count, and nothing on the course or the links", async () => {
    const drawn = await boxes(EVENT, { risk: RISK });
    expect(drawn.kind).toContain('data-testid="risk-line"');
    expect(foldsAround(drawn.kind, "box-status")).toEqual(["box-kind"]);
    expect(drawn.kind.indexOf('data-testid="risk-line"')).toBeGreaterThan(drawn.kind.indexOf('id="box-status"'));
    // The number is said once, under the page map (§408) — on no box, shut or open.
    for (const key of ["kind", "course", "links"] as const) expect(drawn[key], key).not.toMatch(/\b23\b/);
    for (const key of ["course", "links"] as const) expect(drawn[key], key).not.toContain('data-testid="risk-line"');
    expect(read("src/modules/content/events/ui/boxes/StatusBox.tsx")).toContain('tone: risk ? "risk" : "default"');
    expect(read("src/modules/content/events/ui/boxes/KindBox.tsx")).toContain('tone={risk ? "risk" : "default"}');
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
  it("is told once, in the type's box, whose line still names the status; the other boxes are their heading and line", async () => {
    const drawn = await boxes(EVENT, { mayEditSettings: false, risk: RISK });
    expect(drawn.kind.match(/Setările le schimbă un Organizator sau un Administrator\./g)).toHaveLength(1);
    expect(summaryOf(drawn.kind)).toContain("Alergare de grup · Programat");
    expect(drawn.kind).not.toContain('id="box-status"');
    for (const [key, id, name, line] of [
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
    // No number anywhere — the page's one line says it (§408); nothing is posted or offered.
    expect(Object.values(drawn).join("")).not.toMatch(/\b23\b/);
    expect(Object.values(drawn).join("")).not.toMatch(/name="event\./);
  });
});

describe("§448 the create page's status is the editor's select", () => {
  it("opens the type's box and draws the status select in its card, at «Programat», posting SCHEDULED, with the line that says what the others do", async () => {
    const drawn = await boxes(null);
    expect(isOpen(foldTags(drawn.kind)[0])).toBe(true);
    expect(foldsAround(drawn.kind, "box-status")).toEqual(["box-kind"]);
    expect(drawn.kind).toContain('data-testid="status-on-create"');
    // The select itself: its posted input, named and at "Programat" — no disabled stand-in, no hidden field beside it.
    expect(drawn.kind).toMatch(/<input[^>]*name="event.eventStatus"[^>]*value="SCHEDULED"|<input[^>]*value="SCHEDULED"[^>]*name="event.eventStatus"/);
    expect(drawn.kind).not.toMatch(/<input[^>]*disabled[^>]*value="Programat"/);
    expect(drawn.kind).toContain("Programat");
    // While "Programat" is chosen, no cancellation block — and never a "tell them" box on a create.
    expect(drawn.kind).not.toContain('data-testid="cancel-fields"');
    expect(drawn.kind).not.toContain('name="cancel.notify"');
    expect(drawn.kind).toContain("De obicei Programat. Alege Anulat pentru un eveniment deja anulat");
    const en = await boxes(null, { locale: "en" });
    expect(en.kind).toContain("Usually Scheduled. Choose Cancelled for an event already called off");
  });

  it("offers all three statuses, and the cancellation's reason with nobody to tell", () => {
    const status = read("src/modules/content/events/ui/boxes/StatusBox.tsx");
    expect(status).toContain('const EVENT_STATUSES = ["SCHEDULED", "CANCELLED", "COMPLETED"] as const;');
    const start = status.indexOf("if (event === null) {");
    expect(start).toBeGreaterThan(-1);
    const createBranch = status.slice(start, status.indexOf("{risk && <RiskLine>", start));
    expect(createBranch).toContain('{select("SCHEDULED")}');
    expect(createBranch).toContain("<EventCancelFields");
    expect(createBranch).toContain("wasCancelled={false}");
    expect(createBranch).toContain("offerNotice={false}");
  });

  it("posts no hidden status on the create page, and no status box among the cards not on the page", () => {
    for (const page of ["src/app/[locale]/admin/events/new/page.tsx", "src/app/[locale]/admin/events/[id]/page.tsx"]) {
      const source = read(page);
      expect(source, page).not.toContain("<StatusBox");
      expect(source, page).not.toContain("<StatusCard");
    }
    expect(read("src/app/[locale]/admin/events/new/page.tsx")).not.toContain('name="event.eventStatus"');
    expect(read("src/app/[locale]/admin/events/[id]/page.tsx")).toMatch(/<KindBox \{\.\.\.box\}[^>]*risk=\{risk\} notice=\{notice\} \/>/);
  });
});

describe("§406 a refusal opens the folds it names", () => {
  it("opens «Traseul» for a refused route link, «Linkuri și fișiere» for a link, the first box and its status card for the status", async () => {
    const drawn = await boxes(EVENT);
    for (const [key, field, ids] of [
      ["course", "field-event.routeUrl", ["box-course"]],
      ["links", "field-event.links[0].url", ["box-links"]],
      ["links", "field-event.links[0].labelEn", ["box-links"]],
      ["links", "field-event.stravaEventUrl", ["box-links"]],
      ["kind", "field-event.eventStatus", ["box-kind", "box-status"]],
    ] as const) {
      const around = foldsAround(drawn[key], field);
      expect(around, field).toEqual(ids);
      const { node, details } = chain(around);
      revealField(node as unknown as HTMLElement);
      expect(details.every((fold) => fold.open), field).toBe(true);
    }
  });
});
