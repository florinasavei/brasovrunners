import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";
import type { LanguageEntry } from "@/modules/content/events/ui/boxes/box-kit";
import { blankTranslation } from "@/modules/content/events/ui/TranslationFields";
import type { Checkpoint } from "@/modules/event-checkpoints/domain/checkpoint";

/**
 * §NNN (amending §757 and §760; BR-REQ-050-02) — «Puncte de control» inside «Traseul», in the
 * document. The owner, with a screenshot of the editor on production: «Partea cu „Puncte de control”
 * ar trebui să fie băgată în cardul cu traseu (nested)». §760 drew the card above card 1; the test
 * that went with it measured exactly that, so it passed while the owner saw the card at the top.
 *
 * Rendered as the editor composes it — the card's two detached forms around the save form, «Traseul»
 * inside the save form, the card inside «Traseul» — and read as markup: the card is a descendant of
 * `#box-course` (and so of the save form), its two `<form>` elements are not, and every box and
 * button of the card names one of them with `form=`, so neither save can post the other's boxes.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Admin" }),
    getLocale: async () => "ro",
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return {
    Link: ({ href, children }: { href: unknown; children: unknown }) => h("a", { href: typeof href === "string" ? href : "/ro/admin/events/x" }, children as string),
    getPathname: () => "/ro/admin/events/x",
  };
});
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/app/[locale]/admin/events/[id]/checkpoint-actions", () => ({
  saveCheckpointsAction: async () => null,
  addGpxCheckpointsAction: async () => null,
}));

const { default: CourseBox } = await import("@/modules/content/events/ui/boxes/CourseBox");
const { default: CheckpointsCard, CheckpointForms, CHECKPOINTS_FORM, CHECKPOINTS_GPX_FORM } = await import("@/modules/content/events/ui/CheckpointsCard");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const RACE = {
  id: EVENT_ID,
  type: "RACE",
  eventStatus: "SCHEDULED",
  registrationMode: "INTERNAL",
  timezone: "Europe/Bucharest",
  startsAt: new Date("2027-05-15T06:00:00Z"),
  endsAt: null,
  surface: "TRAIL",
  distanceMeters: 21000,
  routeMaps: null,
  routeUrl: null,
  nightOverride: null,
  scheduleItems: null,
} as unknown as EditableEvent;

const language = (locale: "ro" | "en"): LanguageEntry => ({
  translation: { ...blankTranslation(locale), title: locale === "ro" ? "Crosul Tâmpei" : "Tampa Cross" },
  mayEdit: true,
  label: locale === "ro" ? "Română" : "English",
});

const POINT: Checkpoint = { id: "22222222-2222-4222-8222-222222222222", nameRo: "Cabana", nameEn: "The hut", km: 7.5, kinds: ["WATER"], cutoff: "11:00", noteRo: null, noteEn: null };

async function html(element: ReactElement): Promise<string> {
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, { locale: "ro", messages: ro } as unknown as ComponentProps<typeof NextIntlClientProvider>, element));
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
}

/** The editor's composition: the detached forms around the save form, «Traseul» in it, the card in «Traseul». */
async function editor(options: { mayEditSettings?: boolean; mayEditCheckpoints?: boolean; gpx?: boolean } = {}) {
  const { mayEditSettings = true, mayEditCheckpoints = true, gpx = false } = options;
  const card = createElement(CheckpointsCard, {
    locale: "ro",
    eventId: EVENT_ID,
    checkpoints: [POINT],
    mayEdit: mayEditCheckpoints,
    routeKm: 21,
    gpx: gpx ? { key: "test/route-gpx/00000000-0000-4000-8000-000000000000/t.gpx", offered: [{ name: "Izvor", km: 0.8, kinds: [], offMeters: 4, tooFar: false }], ignored: 0 } : null,
    previewOpen: gpx,
  });
  const course = createElement(CourseBox, {
    event: RACE,
    mayEditSettings,
    languages: mayEditSettings ? [language("ro"), language("en")] : [],
    checkpointCount: 1,
    checkpoints: card,
  });
  const saveForm = createElement(
    "form",
    { id: "event-save-form" },
    createElement("input", { type: "hidden", name: "eventId", value: EVENT_ID }),
    course,
    createElement("button", { type: "submit" }, "Salvează"),
  );
  return html(createElement(CheckpointForms, { locale: "ro", eventId: EVENT_ID, mayEdit: mayEditCheckpoints }, saveForm));
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** The elements open at `index` in the markup, outermost first: each tag's name and its opening tag. */
function ancestorsAt(markup: string, index: number): Array<{ name: string; tag: string }> {
  const stack: Array<{ name: string; tag: string }> = [];
  const tags = /<\/?([a-zA-Z][\w-]*)\b[^>]*>/g;
  for (let match = tags.exec(markup); match && match.index < index; match = tags.exec(markup)) {
    const [tag, rawName] = match;
    const name = rawName.toLowerCase();
    if (tag.startsWith("</")) {
      const at = stack.map((entry) => entry.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
    } else if (!VOID.has(name) && !tag.endsWith("/>")) stack.push({ name, tag });
  }
  return stack;
}

const idOf = (tag: string) => /\sid="([^"]*)"/.exec(tag)?.[1] ?? null;

/** The markup of the element whose id is given, from its opening tag to its closing one. */
function subtree(markup: string, id: string): string {
  const at = markup.indexOf(`id="${id}"`);
  expect(at, `#${id} is drawn`).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<", at);
  const depth = ancestorsAt(markup, start).length;
  const tags = /<\/?([a-zA-Z][\w-]*)\b[^>]*>/g;
  tags.lastIndex = start;
  for (let match = tags.exec(markup); match; match = tags.exec(markup)) {
    if (match[0].startsWith("</") && ancestorsAt(markup, match.index + match[0].length).length === depth) return markup.slice(start, match.index + match[0].length);
  }
  throw new Error(`#${id} is never closed`);
}

/** Every control that posts (a named input, select, textarea or a submit button) in a piece of markup. */
function controls(markup: string): string[] {
  const named = [...markup.matchAll(/<(input|select|textarea)\b[^>]*\sname="[^"]*"[^>]*>/g)].map((match) => match[0]);
  const submits = [...markup.matchAll(/<button\b[^>]*type="submit"[^>]*>/g)].map((match) => match[0]);
  return [...named, ...submits];
}

describe("§NNN «Puncte de control» is a card of «Traseul», in the document", () => {
  it("draws the card inside #box-course, inside the save form, as a closed level-3 card after the route's fields", async () => {
    const markup = await editor();
    const at = markup.indexOf('id="box-checkpoints"');
    const ids = ancestorsAt(markup, at).map((entry) => idOf(entry.tag));
    expect(ids).toContain("box-course");
    expect(ids).toContain("event-save-form");
    // Its own fold: a `<details>`, closed, its heading a level under «Traseul»'s.
    const opening = markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
    expect(opening.startsWith("<details")).toBe(true);
    expect(opening).not.toMatch(/\sopen(=|\s|>)/);
    expect(/<(h[2-5])\b/.exec(markup.slice(at))?.[1]).toBe("h3");
    // After the route's fields: the Strava box and the description's tabs come first.
    expect(at).toBeGreaterThan(markup.indexOf('name="event.routeStrava"'));
    expect(at).toBeGreaterThan(markup.indexOf('id="course-tab-ro"'));
    // No link to a card elsewhere, and no sentence that sends the reader above card 1.
    expect(markup).not.toContain("course-checkpoints-link");
    expect(markup).not.toContain("deasupra cardului 1");
  });

  it("keeps the card's two <form> elements beside the save form, after it, never inside it", async () => {
    const markup = await editor();
    for (const form of [CHECKPOINTS_FORM, CHECKPOINTS_GPX_FORM]) {
      const at = markup.indexOf(`<form id="${form}"`) >= 0 ? markup.indexOf(`<form id="${form}"`) : markup.indexOf(`id="${form}"`);
      expect(at, form).toBeGreaterThan(-1);
      const ids = ancestorsAt(markup, at).map((entry) => idOf(entry.tag));
      expect(ids, form).not.toContain("event-save-form");
      expect(at, form).toBeGreaterThan(markup.indexOf("</form>"));
      expect(markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1), form).toMatch(/\shidden(=|\s|>)/);
    }
    // The whole markup has no form inside a form.
    const forms = [...markup.matchAll(/<form\b/g)].map((match) => match.index ?? 0);
    for (const at of forms) expect(ancestorsAt(markup, at).some((entry) => entry.name === "form")).toBe(false);
  });

  it("names its form on every box and button of the card, so «Salvează» never posts a point and «Salvează punctele» nothing of the event", async () => {
    const markup = await editor({ gpx: true });
    const card = subtree(markup, "box-checkpoints");
    const posting = controls(card);
    // The saved point's boxes, three spare rows, the GPX preview's ticks and names, the two buttons.
    expect(posting.length).toBeGreaterThan(30);
    for (const control of posting) expect(control, control).toMatch(new RegExp(`\\sform="(${CHECKPOINTS_FORM}|${CHECKPOINTS_GPX_FORM})"`));
    // Each button posts its own form: the list's save and the preview's «Adaugă punctele alese».
    const preview = subtree(markup, "box-checkpoints-gpx");
    for (const control of controls(preview)) expect(control, control).toContain(`form="${CHECKPOINTS_GPX_FORM}"`);
    const listButton = [...card.matchAll(/<button\b[^>]*type="submit"[^>]*>[^]*?<\/button>/g)].map((match) => match[0]).find((button) => button.includes("Salvează punctele"));
    expect(listButton).toContain(`form="${CHECKPOINTS_FORM}"`);
    // «Traseul»'s own boxes carry no `form`: they post with the save form around them, as before.
    const course = subtree(markup, "box-course").replace(card, "");
    const own = controls(course);
    expect(own.some((control) => control.includes('name="event.distanceMeters"'))).toBe(true);
    for (const control of own) expect(control, control).not.toMatch(/\sform="/);
  });

  it("draws the card inside «Traseul» for a role that writes the points and not the route (the Organizer, §757)", async () => {
    const markup = await editor({ mayEditSettings: false });
    const at = markup.indexOf('id="box-checkpoints"');
    expect(ancestorsAt(markup, at).map((entry) => idOf(entry.tag))).toContain("box-course");
    // «Traseul» folds now, since it holds something to open.
    const course = markup.slice(markup.lastIndexOf("<", markup.indexOf('id="box-course"')), markup.indexOf(">", markup.indexOf('id="box-course"')) + 1);
    expect(course.startsWith("<details")).toBe(true);
    for (const control of controls(subtree(markup, "box-checkpoints"))) expect(control).toMatch(/\sform="checkpoints-(gpx-)?form"/);
  });

  it("is a reader's list inside «Traseul» with no form at all for a role that may only read the points", async () => {
    const markup = await editor({ mayEditSettings: false, mayEditCheckpoints: false });
    const at = markup.indexOf('id="box-checkpoints"');
    expect(ancestorsAt(markup, at).map((entry) => idOf(entry.tag))).toContain("box-course");
    expect(markup).toContain('data-testid="checkpoints-read-only"');
    expect(markup).not.toContain(`id="${CHECKPOINTS_FORM}"`);
    expect(controls(subtree(markup, "box-checkpoints"))).toEqual([]);
  });
});
