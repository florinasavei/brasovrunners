import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PickerOption } from "@/modules/feedback/domain/event-picker";

/**
 * BR-REQ-070-04, `DECISIONS.md` §680 (amending §676) — the feedback page as the server draws it, with
 * the filtering island in front of a long picker.
 *
 * Whatever the list's length, the server's HTML still holds the native `<select name="event">` with the
 * same id, the same options in `pickerOrder`'s order and the same words — what a browser without
 * JavaScript posts. Over eight rows the page wraps it in `EventPickerFilter`, handing it plain data
 * only (the rows, the value chosen, the words — §370); eight or fewer, no island at all. And the island
 * itself, rendered on the server, draws nothing but the select it was given — and, when its chips will
 * be drawn, their row already, invisible and hidden from a screen reader, so the field does not jump as
 * the island takes over.
 */
let locale: "ro" | "en" = "ro";
let rows: { id: string; slug: string; title: string; type: string; startsAt: Date; timezone: string }[] = [];
const islandProps: Record<string, unknown>[] = [];

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    getTranslations: async (arg: string | { namespace: string }) =>
      createTranslator({
        locale,
        messages: catalogues[locale] as typeof catalogues.ro,
        namespace: (typeof arg === "string" ? arg : arg.namespace) as "Tell",
      }),
    getLocale: async () => locale,
    setRequestLocale: () => undefined,
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  unstable_rethrow: () => undefined,
  usePathname: () => "/ro/contact/spune-ne",
  useRouter: () => ({ push: () => undefined }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href: `/${locale}${href}`, ...rest }, children),
  getPathname: ({ href }: { href: string | { pathname: string } }) => `/${locale}${typeof href === "string" ? href : href.pathname}`,
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedBotCheckSiteKey: async () => null,
  cachedContactFormReaches: async () => true,
  cachedFeedbackFormsDescribed: async () => true,
  cachedFeedbackFormsNamedDescribed: async () => false,
  cachedFeedbackOffer: async () => ({
    howItWent: { on: true, to: "club@example.org" },
    suggestion: { on: false, to: null },
    complaint: { on: false, to: null },
    safety: { on: false, to: null, name: null },
  }),
  cachedPublishedEventsBetween: async () => rows,
}));
vi.mock("@/modules/contact/delivery", () => ({ contactSmtpRoadExists: () => true }));
vi.mock("@/modules/registrations/form-draft", () => ({ readFormDraft: async () => null }));
vi.mock("@/modules/registrations/ui/BotCheck", () => ({ default: () => null }));
vi.mock("@/app/[locale]/contact/feedback/actions", () => ({ submitFeedbackAction: async () => undefined }));
// The island as the page hands it over: its props recorded, its children — the native select — drawn.
vi.mock("@/modules/feedback/ui/EventPickerFilter", () => ({
  default: ({ children, ...props }: { children: ReactNode }) => {
    islandProps.push(props);
    return createElement("div", { "data-island": "event-filter" }, children);
  },
}));

const { NextIntlClientProvider } = await import("next-intl");
const catalogues = {
  ro: (await import("../../../messages/ro.json")).default,
  en: (await import("../../../messages/en.json")).default,
};
const { default: FeedbackPage } = await import("@/app/[locale]/contact/feedback/page");

const DAY_MS = 24 * 60 * 60_000;

/** `count` published events: a race every fourth, group runs between — all held in the last weeks. */
function events(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
    slug: index % 4 === 0 ? `crosul-brasovului-${index}` : `happy-monday-${index}`,
    title: index % 4 === 0 ? `Crosul Brașovului ${index}` : "Happy Monday",
    type: index % 4 === 0 ? "RACE" : "GROUP_RUN",
    startsAt: new Date(Date.now() - (index + 1) * 3 * DAY_MS),
    timezone: "Europe/Bucharest",
  }));
}

async function render(search: Record<string, string> = { tip: "cum-a-fost" }): Promise<string> {
  const page = (await FeedbackPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(search) })) as ReactElement;
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale, messages: catalogues[locale] } as unknown as ComponentProps<typeof NextIntlClientProvider>, page),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<!-- -->/g, "");
}

/** The native select's tag and its options, as drawn. */
function nativeSelect(html: string) {
  const select = /<select[^>]*>([\s\S]*?)<\/select>/.exec(html);
  expect(select, "the native select is drawn").not.toBeNull();
  const tag = /<select[^>]*>/.exec(select![0])![0];
  const options = [...select![1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)].map(([, value, text]) => ({ value, text }));
  return { tag, options };
}

beforeEach(() => {
  islandProps.length = 0;
  locale = "ro";
});

describe("BR-REQ-070-04 «Evenimentul»: the native select stays, the island stands in front of a long one (§680)", () => {
  it("draws the same native select, id, name and options, with no island for eight rows or fewer", async () => {
    rows = events(7);
    const html = await render();
    const { tag, options } = nativeSelect(html);
    expect(tag).toContain('name="event"');
    expect(tag).toContain('id="f-event"');
    expect(options[0]).toEqual({ value: "", text: "Altceva / în general" });
    // The held ones first, the most recent first (`pickerOrder`), each «title — day».
    expect(options.slice(1).map((option) => option.value)).toEqual(rows.map((row) => row.slug));
    expect(options[1].text).toMatch(/^Crosul Brașovului 0 — \S/);
    expect(options).toHaveLength(8);
    expect(islandProps).toHaveLength(0);
    expect(html).not.toContain('data-island="event-filter"');
  });

  it("over eight rows, wraps the same native select in the island and hands it plain data only", async () => {
    rows = events(12);
    const html = await render({ tip: "cum-a-fost", eveniment: "happy-monday-5" });
    const { tag, options } = nativeSelect(html);
    expect(tag).toContain('name="event"');
    expect(tag).toContain('id="f-event"');
    expect(options.map((option) => option.value)).toEqual(["", ...rows.map((row) => row.slug)]);
    // The select sits inside the island, and nothing else posts an `event`.
    expect(html).toMatch(/data-island="event-filter"[^>]*>[\s\S]*?<select[^>]*name="event"/);
    expect(html.match(/name="event"/g)).toHaveLength(1);

    expect(islandProps).toHaveLength(1);
    const props = islandProps[0] as { id: string; name: string; selected: string; error: boolean; options: PickerOption[]; words: Record<string, unknown> };
    expect(props.id).toBe("f-event");
    expect(props.name).toBe("event");
    expect(props.selected).toBe("happy-monday-5");
    expect(props.error).toBe(false);
    // Plain data: it survives JSON whole — no element, no function, no Date (§370).
    expect(JSON.parse(JSON.stringify(props))).toEqual(props);
    expect(props.options[0]).toEqual({ value: "", label: "Altceva / în general", kind: "other", day: null, when: null });
    expect(props.options.slice(1).map((option) => option.kind)).toEqual(rows.map((row) => (row.type === "RACE" ? "race" : "group")));
    expect(props.options[1].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The island's rows say what the native options say.
    expect(props.options.map((option) => (option.when ? `${option.label} — ${option.when}` : option.label))).toEqual(options.map((option) => option.text));
    expect(props.words).toEqual({
      label: "Evenimentul",
      search: "Scrie o parte din nume sau din dată",
      noMatch: "Niciun eveniment găsit",
      open: "Deschide lista evenimentelor",
      close: "Închide lista evenimentelor",
      kinds: "Arată",
      chips: { all: "Toate", special: "Evenimente speciale", group: "Alergări de grup" },
    });
  });

  it("speaks English on /en", async () => {
    locale = "en";
    rows = events(12);
    await render();
    const props = islandProps[0] as { words: Record<string, unknown>; options: PickerOption[] };
    expect(props.options[0].label).toBe("Something else / in general");
    expect(props.words).toMatchObject({ label: "The event", noMatch: "No event found", chips: { all: "All", special: "Special events", group: "Group runs" } });
  });
});

describe("EventPickerFilter on the server draws only the select it was given", () => {
  const SELECT = '<select id="f-event" name="event"><option value="">Altceva / în general</option></select>';
  const GENERAL_ROW: PickerOption = { value: "", label: "Altceva / în general", kind: "other", day: null, when: null };

  async function serverHtml(options: PickerOption[]): Promise<string> {
    const { default: Island } = await vi.importActual<typeof import("@/modules/feedback/ui/EventPickerFilter")>("@/modules/feedback/ui/EventPickerFilter");
    const props: Omit<ComponentProps<typeof Island>, "children"> = {
      id: "f-event",
      name: "event",
      options,
      selected: "",
      error: false,
      words: { label: "Evenimentul", search: "", noMatch: "", open: "", close: "", kinds: "Arată", chips: { all: "Toate", special: "Evenimente speciale", group: "Alergări de grup" } },
    };
    return renderToStaticMarkup(
      createElement(
        Island,
        props as ComponentProps<typeof Island>,
        createElement("select", { id: "f-event", name: "event" }, createElement("option", { value: "" }, "Altceva / în general")),
      ),
    );
  }

  it("renders its children — the native select — until it runs in a browser", async () => {
    expect(await serverHtml([GENERAL_ROW])).toBe(SELECT);
  });

  it("holds the chips' row above it when they will be drawn — invisible, unread, unpressable — so the field does not jump", async () => {
    const html = await serverHtml([
      GENERAL_ROW,
      { value: "crosul", label: "Crosul", kind: "race", day: "2026-10-04", when: "4 oct." },
      { value: "happy", label: "Happy Monday", kind: "group", day: "2026-10-05", when: "5 oct." },
    ]);
    expect(html.endsWith(SELECT)).toBe(true);
    // Emotion's own <style> tags aside, the row is one hidden <div> before the select.
    const reserved = html.slice(0, html.length - SELECT.length).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    expect(reserved).toMatch(/^<div[^>]*aria-hidden="true"[^>]*>/);
    expect(html).toMatch(/visibility:hidden;\}@media \(scripting: none\)\{\.css-[\w-]+\{display:none;\}\}/);
    for (const words of ["Toate", "Evenimente speciale", "Alergări de grup"]) expect(reserved).toContain(words);
    // Each chip wears its glyph (§NNN), hidden from a screen reader: the words are its name.
    for (const glyph of ["EventIcon", "EmojiEventsIcon", "GroupsIcon"]) expect(reserved).toContain(`data-testid="${glyph}"`);
    // Nothing a reader or a test could take for the chips themselves.
    expect(reserved).not.toContain('role="group"');
    expect(reserved).not.toContain('role="button"');
    expect(reserved).not.toContain("aria-pressed");
    // The glyphs carry MUI's own test ids; the chips' own are not there.
    expect(reserved).not.toContain('data-testid="feedback-event-chip');
  });
});
