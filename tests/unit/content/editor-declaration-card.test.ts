import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { EditableEvent } from "@/modules/content/events/repository";
import type { SummaryWords } from "@/modules/content/events/ui/box-summaries";

/**
 * §448 — one place for declarations, under «Regulamentul» (the owner, 2026-09-26: "declarația la
 * alergările de grup ar trebui să apară sub secțiunea «Regulament»; momentan nu văd unde selectez
 * declarația"). The rules box holds a named card, «Declarația pe propria răspundere»: a group run's
 * optional self-declaration (§393) — the surface it reads from «Traseul», the tick, the approved
 * text in force for that surface — or a race's declaration select (§39), while it registers on the
 * site. The rules box's closed line says which.
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

// The locale-aware link needs the request's router; a plain anchor draws the same words.
vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");
  return { Link: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as string), getPathname: () => "/" };
});

const { default: DeclarationCard, declarationLine } = await import("@/modules/content/events/ui/boxes/DeclarationCard");
const WORDS = (await import("../../../messages/ro.json")).default.Admin.editor.boxes.summary as unknown as SummaryWords;
const WORDS_EN = (await import("../../../messages/en.json")).default.Admin.editor.boxes.summary as unknown as SummaryWords;

afterEach(() => {
  currentLocale = "ro";
});

const markup = (html: string): string => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const summaryOf = (html: string): string => html.slice(0, html.indexOf("</summary>"));
const idOf = (tag: string): string | null => tag.match(/\sid="([^"]+)"/)?.[1] ?? null;
const namedFolds = (html: string): string[] => (html.match(/<details[^>]*>/g) ?? []).map(idOf).filter((id): id is string => id !== null);

const DECLARATIONS = [
  { id: "22222222-2222-2222-2222-222222222222", version: 3, title: "Declarația concursului" },
  { id: "33333333-3333-3333-3333-333333333333", version: 2, title: "Declarația veche" },
];

const TRAIL_RUN = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "GROUP_RUN",
  eventStatus: "SCHEDULED",
  registrationMode: "NONE",
  surface: "TRAIL",
  offersGroupRunDeclaration: true,
  declarationDocumentId: null,
  timezone: "Europe/Bucharest",
} as unknown as EditableEvent;

const RACE = { ...TRAIL_RUN, type: "RACE", registrationMode: "INTERNAL", surface: "ASPHALT", offersGroupRunDeclaration: false, declarationDocumentId: DECLARATIONS[0].id } as unknown as EditableEvent;

async function rules(event: EditableEvent | null, options: { mayEditSettings?: boolean; locale?: "ro" | "en"; trail?: { version: number } | null } = {}) {
  currentLocale = options.locale ?? "ro";
  const element = await DeclarationCard({
    words: currentLocale === "ro" ? WORDS : WORDS_EN,
    event,
    mayEditSettings: options.mayEditSettings ?? true,
    groupRunDeclarations: { ASPHALT: null, TRAIL: options.trail === undefined ? { version: 2 } : options.trail },
    declarations: DECLARATIONS,
  });
  return markup(renderToStaticMarkup(element as ReactElement));
}

describe("§448 the declaration card sits under «Regulamentul»", () => {
  it("is a named level-3 card, on the create page too, drawn inside the rules box after its tabs", async () => {
    for (const event of [TRAIL_RUN, RACE, null]) {
      const html = await rules(event);
      expect(namedFolds(html)).toEqual(["box-declaration"]);
      expect(html).toMatch(/<h3[^>]*>Declarația pe propria răspundere<span/);
    }
    expect(await rules(TRAIL_RUN, { locale: "en" })).toMatch(/<h3[^>]*>Self-declaration<span/);
    // The rules box awaits the card and draws it under its language tabs, its line joined to its own.
    const text = readFileSync(path.join(process.cwd(), "src/modules/content/events/ui/boxes/TextBoxes.tsx"), "utf8");
    const box = text.slice(text.indexOf("export async function RulesBox"), text.indexOf("export async function AddressBox"));
    expect(box).toContain("await DeclarationCard({");
    expect(box.indexOf("<LanguageTabs")).toBeLessThan(box.indexOf("{declaration}"));
    expect(box).toContain("openWhen={{ attention: line.missing }}");
    // Neither «Traseul» nor «Condiții de participare» asks any more.
    const course = readFileSync(path.join(process.cwd(), "src/modules/content/events/ui/boxes/CourseBox.tsx"), "utf8");
    const registration = readFileSync(path.join(process.cwd(), "src/modules/content/events/ui/boxes/RegistrationBox.tsx"), "utf8");
    expect(course).not.toContain("<GroupRunDeclarationField");
    expect(registration).not.toContain('name="event.declarationDocumentId"');
  });

  it("gives the rules box's line its part: the offered surface, the chosen version, the gap, or nothing", async () => {
    expect((await declarationLine(TRAIL_RUN, DECLARATIONS, WORDS)).text).toBe("declarație pentru Trail");
    expect(await declarationLine(RACE, DECLARATIONS, WORDS)).toEqual({ text: "declarația v3", missing: false });
    expect((await declarationLine({ ...RACE, declarationDocumentId: null } as unknown as EditableEvent, DECLARATIONS, WORDS)).missing).toBe(true);
    expect(await declarationLine({ ...RACE, registrationMode: "EXTERNAL" } as unknown as EditableEvent, DECLARATIONS, WORDS)).toEqual({ text: null, missing: false });
    expect((await declarationLine(null, DECLARATIONS, WORDS)).missing).toBe(false);
  });

  it("offers a group run's tick with the surface from «Traseul» and the text in force for it", async () => {
    const html = await rules(TRAIL_RUN);
    expect(html).toContain('name="event.offersGroupRunDeclaration"');
    expect(html).toContain("Suprafața, din cardul «Traseul»: Trail");
    expect(html).toContain("Textul în vigoare pentru Trail: „Declarație pe propria răspundere (alergare de grup, trail)”, v2.");
    expect(summaryOf(html)).toContain("declarație pentru Trail");
  });

  it("says no text is in force, and disables the tick, when the club approved none for the surface", async () => {
    const html = await rules(TRAIL_RUN, { trail: null });
    expect(html).not.toContain('data-testid="group-run-declaration-in-force"');
    expect(html).toMatch(/<input[^>]*name="event.offersGroupRunDeclaration"[^>]*disabled|<input[^>]*disabled[^>]*name="event.offersGroupRunDeclaration"/);
    expect(html).toContain("Clubul nu are încă o versiune aprobată");
  });

  it("holds a race's declaration select, the newest approved version named, and says the chosen one on the rules line", async () => {
    const html = await rules(RACE);
    expect(html).toContain('name="event.declarationDocumentId"');
    expect(html).toContain("Cea mai nouă versiune aprobată: v3 · Declarația concursului.");
    expect(summaryOf(html)).toContain("declarația v3");
    expect(html).not.toContain('name="event.offersGroupRunDeclaration"');
  });

  it("opens the rules box and the card while a race registering on the site has no declaration", async () => {
    const html = await rules({ ...RACE, declarationDocumentId: null } as unknown as EditableEvent);
    expect(summaryOf(html)).toContain("Lipsește declarația");
    for (const tag of (html.match(/<details[^>]*>/g) ?? []).filter((tag) => idOf(tag) !== null)) expect(tag).toMatch(/\sopen(=""|\s|>)/);
  });

  it("is the heading and its line for a role that may only read the settings", async () => {
    const html = await rules(RACE, { mayEditSettings: false });
    expect(html).toContain('id="box-declaration"');
    expect(html).not.toMatch(/name="event\./);
  });
});
