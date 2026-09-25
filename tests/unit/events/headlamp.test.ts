import { readFileSync } from "node:fs";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { courseSummary, type SummaryWords } from "@/modules/content/events/ui/box-summaries";
import { calendarDescription, type CalendarEvent, type CalendarLabels } from "@/modules/events/ical";
import type { PublicEvent } from "@/modules/events/repository";
import { orderRoutePills, type Pill } from "@/modules/events/ui/route-pills";

/**
 * BR-REQ-020-01 and BR-REQ-050-02 (`DECISIONS.md` §382) — "Necesită frontală", a per-event mark.
 *
 * The owner, 2026-09-25: "I need an extra checkmark on the event editor and a headlamp icon for
 * the events that require a headlamp (e.g. the Wednesday 'Running up that hill' event during
 * autumn, winter and spring, as it is already dark at 19:00 when it starts)."
 *
 * A marked event wears a pill — a lit torch and "Frontală" / "Headlamp" — after the route's
 * numbers and before the cost, on the listing card, the hero and the event page; the calendar
 * entry names it after the place; the `.ics` carries a line. An unmarked event shows nothing.
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const roMessages = (await import("../../../messages/ro.json")).default;
  const enMessages = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? roMessages : enMessages, namespace: namespace as "Event" }),
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
  };
});

// The tooltip writes its title into the markup, so what it would say can be read from a static render.
vi.mock("@mui/material/Tooltip", async () => {
  const react = await import("react");
  return {
    default: ({ title, children }: { title: ReactNode; children: ReactElement }) =>
      react.createElement("span", { "data-tooltip": "" }, react.createElement("span", { "data-tooltip-title": "" }, title), children),
  };
});

const { default: EventFacts } = await import("@/modules/events/ui/EventFacts");
const { default: CalendarEventChip } = await import("@/modules/events/ui/CalendarEventChip");
const { default: EventCalendar } = await import("@/modules/events/ui/EventCalendar");
const { GLYPHS } = await import("@/modules/events/ui/glyphs");
const { default: FlashlightOnIcon } = await import("@mui/icons-material/FlashlightOn");

afterEach(() => {
  currentLocale = "ro";
});

const NOW = new Date("2026-09-24T09:00:00Z");

/** "Running up that hill": a Wednesday evening on the Tâmpa, 19:00 in Brașov. */
function event(overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    type: "GROUP_RUN",
    surface: "TRAIL",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-10-07T16:00:00Z"),
    endsAt: null,
    raceStartsAt: null,
    timezone: "Europe/Bucharest",
    mapUrl: null,
    routeUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    featured: false,
    isSpecial: false,
    distanceMeters: 8000,
    elevationGainMeters: 250,
    headlampRequired: true,
    registrationMode: "NONE",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    minAge: 14,
    slug: "running-up-that-hill",
    title: "Running up that hill",
    excerpt: null,
    locationName: "Stația de telecabină Tâmpa",
    locationAddress: null,
    locationToBeAnnounced: false,
    difficulty: "MODERATE",
    costType: "FREE",
    costAmount: null,
    costUrl: null,
    publishedAt: NOW,
    ...overrides,
  } as PublicEvent;
}

const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const text = (fragment: string) => fragment.replace(/<[^>]+>/g, "");

/** Every chip's label, in order. The difficulty pill (only) carries a `GlyphChip` `ariaLabel`,
 * which wraps the label in a visually-hidden accessible-name span (`srOnlySx`) followed by an
 * `aria-hidden` span holding the visible word — checked first, before falling back to the plain
 * text node every other closed set's pill still renders. */
function pillLabels(fragment: string): string[] {
  return [...withoutStyles(fragment).matchAll(/class="MuiChip-label[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/div>/g)].map(
    ([, labelInner]) => /<span class="MuiBox-root [^"]*" aria-hidden="true">([^<]*)<\/span>/.exec(labelInner)?.[1] ?? text(labelInner),
  );
}

/** The `<dl>`'s rows: each label with its `<dd>` markup. */
function rows(html: string) {
  return [...withoutStyles(html).matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt><dd\b[^>]*>([\s\S]*?)<\/dd>/g)].map(([, dt, dd]) => ({ label: text(dt), dd }));
}

describe("§382 orderRoutePills — the headlamp after the route's numbers", () => {
  const surface: Pill = { glyph: "surface:TRAIL", label: "Trail" };
  const difficulty: Pill = { glyph: "difficulty:MODERATE", label: "Mediu" };
  const distance: Pill = { glyph: "distance", label: "8 km" };
  const elevation: Pill = { glyph: "elevation", label: "250 m D+" };
  const headlamp: Pill = { glyph: "headlamp", label: "Frontală" };

  it("surface, difficulty, distance, elevation, then the headlamp — whatever order it is handed in", () => {
    expect(orderRoutePills({ headlamp, elevation, distance, difficulty, surface })).toEqual([surface, difficulty, distance, elevation, headlamp]);
  });

  it("keeps its place when the numbers are missing, and is absent when not handed", () => {
    expect(orderRoutePills({ headlamp, surface })).toEqual([surface, headlamp]);
    expect(orderRoutePills({ surface, elevation, headlamp: null })).toEqual([surface, elevation]);
  });
});

describe("§382 the glyph crosses the boundary by name", () => {
  it("names the lit torch `headlamp`, one file from @mui/icons-material", () => {
    expect(GLYPHS.headlamp).toBe(FlashlightOnIcon);
  });
});

describe("§382 the event page's facts", () => {
  it("puts «Frontală» last in the route's pills, with its glyph, and the cost stays in its own row", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, stacked: true }));
    const route = rows(html).find((row) => row.label === "Traseu");
    expect(route).toBeDefined();
    expect(pillLabels(route!.dd)).toEqual(["Trail", "Mediu", "8 km", "250 m D+", "Frontală"]);
    expect(route!.dd).toContain('data-testid="FlashlightOnIcon"');
    expect(pillLabels(rows(html).find((row) => row.label === "Cost")!.dd)).toEqual(["Gratuit"]);
  });

  it("says «Headlamp» in English", async () => {
    currentLocale = "en";
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, stacked: true }));
    expect(pillLabels(rows(html).find((row) => row.label === "Route")!.dd)).toEqual(["Trail", "Moderate", "8 km", "250 m climb", "Headlamp"]);
  });

  it("makes a route row on its own when it is the only fact of the route — it is not the overline again", async () => {
    const html = renderToStaticMarkup(
      await EventFacts({ event: event({ distanceMeters: null, elevationGainMeters: null, difficulty: null }), now: NOW, stacked: true }),
    );
    expect(pillLabels(rows(html).find((row) => row.label === "Traseu")!.dd)).toEqual(["Trail", "Frontală"]);
  });

  it("shows nothing at all on an unmarked event", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event({ headlampRequired: false }), now: NOW, stacked: true }));
    expect(html).not.toContain("Frontală");
    expect(html).not.toContain("FlashlightOnIcon");
  });
});

describe("§382 the listing card and the hero", () => {
  it("the card's pills: the route, the headlamp, then the cost", async () => {
    const html = renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, variant: "compact" }));
    expect(pillLabels(html)).toEqual(["Trail", "Mediu", "8 km", "250 m D+", "Frontală", "Gratuit"]);
    expect(html).toContain('data-testid="FlashlightOnIcon"');
  });

  it("the card in English, and nothing on an unmarked card", async () => {
    currentLocale = "en";
    expect(pillLabels(renderToStaticMarkup(await EventFacts({ event: event(), now: NOW, variant: "compact" })))).toContain("Headlamp");
    const plain = renderToStaticMarkup(await EventFacts({ event: event({ headlampRequired: false }), now: NOW, variant: "compact" }));
    expect(plain).not.toContain("Headlamp");
    expect(plain).not.toContain("FlashlightOnIcon");
  });

  it("the hero's route line says it after the climb and before the cost, with its glyph", async () => {
    const html = withoutStyles(renderToStaticMarkup(await EventFacts({ event: event(), now: NOW })));
    const route = text(rows(html).find((row) => row.label === "Traseu")!.dd);
    expect(route.indexOf("250 m diferență de nivel")).toBeLessThan(route.indexOf("Frontală"));
    expect(route.indexOf("Frontală")).toBeLessThan(route.indexOf("Gratuit"));
    expect(html).toContain('data-testid="FlashlightOnIcon"');
    const plain = renderToStaticMarkup(await EventFacts({ event: event({ headlampRequired: false }), now: NOW }));
    expect(plain).not.toContain("Frontală");
  });
});

describe("§382 the calendar entry names it after the place", () => {
  function chip(values: Partial<Parameters<typeof CalendarEventChip>[0]> = {}) {
    return renderToStaticMarkup(
      createElement(CalendarEventChip, {
        href: "/ro/evenimente/running-up-that-hill",
        time: "19:00",
        title: "Running up that hill",
        glyphs: ["type:GROUP_RUN", "surface:TRAIL"],
        filled: false,
        cancelled: false,
        note: null,
        partner: null,
        dense: true,
        ...values,
      }),
    );
  }

  it("the tooltip's lines: the time and title, the place's note, the headlamp, the partner", () => {
    const moved = { kind: "moved" as const, text: "Nu în locul obișnuit: Stația de telecabină Tâmpa" };
    const html = chip({ note: moved, headlamp: "Frontală necesară", partner: "Colaborare" });
    const tooltip = html.slice(html.indexOf("data-tooltip-title"), html.indexOf("<a "));
    const lines = [...tooltip.matchAll(/<span class="[^"]*">([^<]+)<\/span>/g)].map((match) => match[1]);
    expect(lines).toEqual(["19:00 Running up that hill", moved.text, "Frontală necesară", "Colaborare"]);
  });

  it("the calendar hands the words in the reader's language, and none to an unmarked date", async () => {
    for (const [locale, words] of [
      ["ro", "Frontală necesară"],
      ["en", "Headlamp required"],
    ] as const) {
      currentLocale = locale;
      const html = renderToStaticMarkup(
        await EventCalendar({
          view: { kind: "month", month: { year: 2026, month: 10 } },
          events: [
            event(),
            event({ id: "22222222-2222-2222-2222-222222222222", slug: "happy-monday", title: "Happy Monday", startsAt: new Date("2026-10-05T15:30:00Z"), headlampRequired: false }),
          ],
          now: NOW,
          layout: "grid",
        }),
      );
      const anchors = [...html.matchAll(/<a [^>]*aria-label="([^"]*)"[^>]*>/g)].map((match) => match[1]);
      expect(anchors).toContain(`19:00 Running up that hill. ${words}`);
      expect(anchors).toContain("18:30 Happy Monday");
    }
  });
});

describe("§382 the calendar file's description", () => {
  function translator(catalogue: { Event: Record<string, unknown> }): CalendarLabels["t"] {
    return (key, values) => {
      const message = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue.Event);
      if (typeof message !== "string") throw new Error(`missing Event.${key}`);
      return Object.entries(values ?? {}).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), message);
    };
  }
  const calendarEvent: CalendarEvent = {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Running up that hill",
    startsAt: new Date("2026-10-07T16:00:00Z"),
    endsAt: null,
    locationName: "Stația de telecabină Tâmpa",
    excerpt: null,
    scheduleJson: null,
    distanceMeters: 8000,
    url: "https://example.test/ro/evenimente/running-up-that-hill",
    updatedAt: null,
    headlampRequired: true,
  };

  it("carries «Frontală necesară» on a line of its own under the facts, in the reader's language", () => {
    const roLines = calendarDescription(calendarEvent, { locale: "ro", t: translator(ro) }).split("\n");
    expect(roLines).toContain("Frontală necesară");
    expect(roLines.indexOf("Frontală necesară")).toBe(roLines.findIndex((line) => line.includes("8 km")) + 1);
    expect(calendarDescription(calendarEvent, { locale: "en", t: translator(en) }).split("\n")).toContain("Headlamp required");
  });

  it("says nothing about a headlamp on an unmarked event", () => {
    expect(calendarDescription({ ...calendarEvent, headlampRequired: false }, { locale: "ro", t: translator(ro) })).not.toContain("Frontală");
    expect(calendarDescription({ ...calendarEvent, headlampRequired: undefined }, { locale: "en", t: translator(en) })).not.toContain("Headlamp");
  });
});

describe("§382 the migration", () => {
  it("adds one column with a default, and nothing else (AGENTS.md §7.6: expand only)", () => {
    const sql = readFileSync("src/db/migrations/0070_headlamp_required.sql", "utf8").trim();
    expect(sql).toBe('ALTER TABLE "events" ADD COLUMN "headlamp_required" boolean DEFAULT false NOT NULL;');
    const journal = JSON.parse(readFileSync("src/db/migrations/meta/_journal.json", "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.find((entry) => entry.idx === 70)?.tag).toBe("0070_headlamp_required");
  });

  it("the editor's box posts the checkbox by the name the action reads (the integration suite proves the save)", () => {
    expect(readFileSync("src/modules/content/events/ui/boxes/CourseBox.tsx", "utf8")).toContain('name="event.headlampRequired"');
  });
});

describe("§382 the editor's «Traseul» box says it while shut", () => {
  it("«frontală» after the climb in the box's line, in both languages", () => {
    const course = { distanceMeters: 8000, elevationGainMeters: 250, routeUrl: null, headlampRequired: true };
    expect(courseSummary(ro.Admin.editor.boxes.summary as SummaryWords, course, { surface: "Trail", difficulty: "Mediu" })).toBe(
      "Trail · Mediu · 8 km · +250 m · frontală",
    );
    expect(courseSummary(en.Admin.editor.boxes.summary as SummaryWords, course, { surface: "Trail", difficulty: "Moderate" })).toContain("headlamp");
    expect(courseSummary(ro.Admin.editor.boxes.summary as SummaryWords, { ...course, headlampRequired: false }, { surface: null, difficulty: null })).not.toContain(
      "frontală",
    );
  });

  it("carries the checkbox's words and its help line in both catalogues", () => {
    expect(ro.Admin.editor.headlampRequired).toBe("Necesită frontală");
    expect(en.Admin.editor.headlampRequired).toBe("Headlamp required");
    expect(ro.Admin.editor.headlampRequiredHelp).toBe("Se arată pe card, pe pagina evenimentului și în calendar.");
    expect(en.Admin.editor.headlampRequiredHelp).toBe("Shown on the event's card, page and calendar.");
  });
});
