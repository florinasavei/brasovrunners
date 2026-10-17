import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { EditableEvent } from "@/modules/content/events/repository";
import type { LanguageEntry } from "@/modules/content/events/ui/boxes/box-kit";
import { blankTranslation } from "@/modules/content/events/ui/TranslationFields";
import { parseGpxElevation } from "@/modules/routes/elevation/parse";
import { elevationGpx } from "../../helpers/elevation-gpx";

/**
 * §802 (§NNN; the owner, 2026-10-17: «vreau și bifă pentru „arată profilul cursei”») — the event's own tick in «Traseul»,
 * «Arată profilul traseului pe pagină», as the editor draws it: a real tick box (never a toggle button) posted with its marker
 * `event.showRouteProfile.present` — as «Informații medicale» (§557) — checked for an event that says nothing, unchecked when the
 * club switched it off, its help under it, a note when there is no GPX file yet, both languages; nothing of it for a role that
 * may only read the settings. And the «Puncte de control» card's preview: the chart still drawn with one sentence when the tick
 * is off. The page's own gate is proved in `tests/integration/cms/event-draft-preview.test.ts`.
 */
let language: "ro" | "en" = "ro";
const messages = { ro, en };

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string | { namespace: string }) =>
      createTranslator({ locale: language, messages: messages[language] as never, namespace: (typeof namespace === "string" ? namespace : namespace.namespace) as never }),
    getLocale: async () => language,
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
const { default: CheckpointsCard, CheckpointForms } = await import("@/modules/content/events/ui/CheckpointsCard");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const GPX = { key: "test/route-gpx/0123abcd-0123-4abc-8def-0123456789ab/tampa.gpx", name: "tampa.gpx", size: 300, uploadedAt: "2026-10-11T10:00:00.000Z" };
const race = (over: Record<string, unknown> = {}) =>
  ({
    id: EVENT_ID,
    type: "RACE",
    eventStatus: "SCHEDULED",
    registrationMode: "INTERNAL",
    timezone: "Europe/Bucharest",
    startsAt: new Date("2027-05-15T06:00:00Z"),
    endsAt: null,
    surface: "TRAIL",
    distanceMeters: 9000,
    routeMaps: null,
    routeGpx: null,
    routeUrl: null,
    nightOverride: null,
    scheduleItems: null,
    showRouteProfile: true,
    ...over,
  }) as unknown as EditableEvent;

const entry = (locale: "ro" | "en"): LanguageEntry => ({ translation: { ...blankTranslation(locale), title: "Cursa" }, mayEdit: true, label: locale === "ro" ? "Română" : "English" });

async function html(element: ReactElement): Promise<string> {
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: language, messages: messages[language] } as unknown as ComponentProps<typeof NextIntlClientProvider>, element),
  );
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
}

const course = async (event: EditableEvent | null, mayEditSettings = true) =>
  html(createElement(CourseBox, { event, mayEditSettings, languages: mayEditSettings ? [entry("ro"), entry("en")] : [], checkpointCount: 0 }));

/** The tick's own `<input>`. */
const tickOf = (markup: string) => /<input\b[^>]*name="event\.showRouteProfile"[^>]*>/.exec(markup)?.[0] ?? "";

describe("§802 the tick «Arată profilul traseului pe pagină» in «Traseul»", () => {
  it("is a real checkbox posted with its marker, checked for an event that says nothing of it, with its help under it — in Română", async () => {
    language = "ro";
    const markup = await course(race({ routeGpx: GPX }));
    const tick = tickOf(markup);
    expect(tick).toContain('type="checkbox"');
    expect(tick).toContain("checked");
    expect(markup).toContain('<input type="hidden" name="event.showRouteProfile.present" value="1"/>');
    expect(markup).toContain("Arată profilul traseului pe pagină");
    expect(markup).toContain('data-testid="show-route-profile-help"');
    expect(markup).toContain("Debifat, pagina nu desenează profilul din GPX; tabelul «Puncte de control» și hărțile rămân.");
    expect(markup).toContain("Numărul de concurs are setarea lui în „Cum arată numărul de concurs”.");
    // Never a toggle button: the setting is the box.
    expect(markup).not.toMatch(/role="switch"/);
    // A saved file: nothing to apologise for.
    expect(markup).not.toContain('data-testid="show-route-profile-no-gpx"');
  });

  it("says the same in English", async () => {
    language = "en";
    const markup = await course(race({ routeGpx: GPX }));
    expect(tickOf(markup)).toContain("checked");
    expect(markup).toContain("Show the route profile on the page");
    expect(markup).toContain("Unticked, the page draws no profile from the GPX; the «Checkpoints» table and the maps stay.");
    expect(markup).toContain("The race number has its own setting in “What the race number looks like”.");
    language = "ro";
  });

  it("comes back unticked when the club switched it off", async () => {
    language = "ro";
    const tick = tickOf(await course(race({ routeGpx: GPX, showRouteProfile: false })));
    expect(tick).toContain('type="checkbox"');
    expect(tick).not.toMatch(/\schecked/);
  });

  it("starts ticked on the create page, where there is no event yet, and says nothing of a missing file", async () => {
    language = "ro";
    const markup = await course(null);
    expect(tickOf(markup)).toContain("checked");
    expect(markup).not.toContain('data-testid="show-route-profile-no-gpx"');
  });

  it("with no GPX saved still offers the box, and says there is nothing to draw until one is uploaded in «Linkuri și fișiere» — in both languages", async () => {
    language = "ro";
    const markup = await course(race());
    expect(tickOf(markup)).toContain('type="checkbox"');
    expect(markup).toContain('data-testid="show-route-profile-no-gpx"');
    expect(markup).toContain("Încă nu e salvat un fișier GPX, deci nu e nimic de desenat: încarcă unul la «Linkuri și fișiere» și salvează.");
    language = "en";
    expect(await course(race())).toContain("No GPX file is saved yet, so there is nothing to draw: upload one in «Links and files» and save.");
    language = "ro";
  });

  it("is not drawn, nor its marker posted, for a role that may only read the settings", async () => {
    language = "ro";
    const markup = await course(race({ routeGpx: GPX }), false);
    expect(markup).not.toContain("event.showRouteProfile");
    expect(markup).not.toContain("Arată profilul traseului pe pagină");
  });
});

describe("§802 the «Puncte de control» card's preview when the tick is off", () => {
  const PROFILE = parseGpxElevation(elevationGpx())!;
  const base = { locale: "ro" as const, eventId: EVENT_ID, checkpoints: [], mayEdit: true, routeKm: 9, profile: PROFILE, distanceMeters: 9000, gpx: null, previewOpen: false };
  const card = async (over: Partial<ComponentProps<typeof CheckpointsCard>> = {}) => html(createElement(CheckpointForms, { locale: base.locale, eventId: EVENT_ID, mayEdit: true }, await CheckpointsCard({ ...base, ...over })));

  it("draws the chart and no sentence while the page shows it (and for a caller that does not say)", async () => {
    language = "ro";
    for (const over of [{ profileShown: true }, {}]) {
      const markup = await card(over);
      expect(markup).toContain('data-testid="elevation-chart"');
      expect(markup).not.toContain('data-testid="checkpoints-preview-off"');
    }
  });

  it("still draws the chart when the tick is off, and says in one sentence that the page does not — in both languages", async () => {
    language = "ro";
    const off = await card({ profileShown: false });
    expect(off).toContain('data-testid="elevation-chart"');
    expect(off).toContain('data-testid="checkpoints-preview-off"');
    expect(off).toContain("Profilul e oprit pe pagină: vezi „Arată profilul traseului pe pagină” în «Traseul».");
    language = "en";
    const english = await html(createElement(CheckpointForms, { locale: "en", eventId: EVENT_ID, mayEdit: true }, await CheckpointsCard({ ...base, locale: "en", profileShown: false })));
    expect(english).toContain('data-testid="elevation-chart"');
    expect(english).toContain("The profile is off on the page: see “Show the route profile on the page” in «The course».");
    language = "ro";
  });

  it("with no usable profile as well, says only that the tick is off, never the missing-file line beside it, in both languages", async () => {
    language = "ro";
    const off = await card({ profileShown: false, profile: null });
    expect(off).toContain('data-testid="checkpoints-preview-off"');
    expect(off).not.toContain('data-testid="checkpoints-preview-none"');
    expect(off).not.toContain('data-testid="elevation-chart"');
    // Ticked, with no profile, the missing-file line is the only sentence.
    const on = await card({ profileShown: true, profile: null });
    expect(on).toContain('data-testid="checkpoints-preview-none"');
    expect(on).not.toContain('data-testid="checkpoints-preview-off"');
    language = "en";
    const english = await html(createElement(CheckpointForms, { locale: "en", eventId: EVENT_ID, mayEdit: true }, await CheckpointsCard({ ...base, locale: "en", profileShown: false, profile: null })));
    expect(english).toContain('data-testid="checkpoints-preview-off"');
    expect(english).not.toContain('data-testid="checkpoints-preview-none"');
    expect(english).not.toContain('data-testid="elevation-chart"');
    language = "ro";
  });

  it("says it to a reader too, who sees the preview and no form", async () => {
    language = "ro";
    const markup = await html(await CheckpointsCard({ ...base, mayEdit: false, profileShown: false }));
    expect(markup).toContain('data-testid="checkpoints-preview-off"');
  });
});
