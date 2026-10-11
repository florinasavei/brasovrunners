import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-041-01 (§714) — the home page's four sections as components: `StepsBand`, `WhyList`,
 * `PhotoStrip` and `NumbersBand`, rendered on the server as the page will render them, in both
 * languages, with the real catalogues.
 *
 * What is held: an empty box draws the platform's words and a club's text replaces them in the
 * reader's language; the quote is drawn only when the club wrote one; an unset strip and a band with
 * no figure draw nothing; the strip carries the ladder's `srcset`, scrolls inside itself and links
 * the Instagram as a link, never an embed; every link is a 44-pixel target; the sections are Server
 * Components that draw their glyphs themselves (no element crosses into a client component, §370).
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "HomeSections" }),
  };
});
vi.mock("@/i18n/navigation", () => {
  const path = (href: string | { pathname?: string; params?: { slug?: string } }) =>
    typeof href === "string" ? `/${currentLocale}${href}` : `/${currentLocale}${href.pathname ?? ""}`.replace("[slug]", href.params?.slug ?? "");
  return {
    getPathname: ({ href }: { href: string | { pathname?: string; params?: { slug?: string } } }) => path(href),
    Link: ({ href, children, ...rest }: { href: string | { pathname?: string; params?: { slug?: string } }; children: ReactNode; prefetch?: unknown }) => {
      delete rest.prefetch;
      return createElement("a", { href: path(href), ...rest }, children);
    },
  };
});

const { NextIntlClientProvider } = await import("next-intl");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;
const { default: StepsBand } = await import("@/modules/home/ui/StepsBand");
const { default: WhyList } = await import("@/modules/home/ui/WhyList");
const { default: PhotoStrip } = await import("@/modules/home/ui/PhotoStrip");
const { default: NumbersBand } = await import("@/modules/home/ui/NumbersBand");
const { EMPTY_STEPS } = await import("@/modules/home/domain/steps");
const { EMPTY_WHY } = await import("@/modules/home/domain/why");
const { stripPictures } = await import("@/modules/home/strip-pictures");
const { CLUB_NAME } = await import("@/theme/brand");

afterEach(() => {
  currentLocale = "ro";
});

async function html(element: ReactElement | null | Promise<ReactElement | null>): Promise<string> {
  const resolved = await element;
  if (!resolved) return "";
  const stream = await renderToReadableStream(
    createElement(
      NextIntlClientProvider,
      { locale: currentLocale, messages: currentLocale === "ro" ? ro : en, timeZone: "Europe/Bucharest" } as unknown as ComponentProps<typeof NextIntlClientProvider>,
      resolved,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
const words = () => (currentLocale === "ro" ? ro : en).HomeSections;

describe("§714 «Prima dată» — StepsBand", () => {
  it("draws the platform's heading, sentence and five numbered steps while the club wrote nothing, in both languages", async () => {
    for (const locale of ["ro", "en"] as const) {
      currentLocale = locale;
      const markup = await html(StepsBand({ content: EMPTY_STEPS, locale, href: null }));
      expect(markup).toContain('aria-labelledby="home-steps-title"');
      expect(markup).toContain(escaped(words().steps.title));
      expect(markup).toContain(escaped(words().steps.lead));
      expect(markup.match(/<li[^>]*data-step="/g)).toHaveLength(5);
      for (const n of ["1", "2", "3", "4", "5"] as const) {
        expect(markup).toContain(escaped(words().steps.items[n].title));
        expect(markup).toContain(escaped(words().steps.items[n].body));
      }
      expect(markup).toMatch(/<ol/);
      // Five glyphs, drawn here as decoration.
      expect(markup.match(/<svg[^>]*aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(5);
      // No target page, no button.
      expect(markup).not.toContain('data-testid="home-steps-link"');
    }
  });

  it("draws the club's words in the reader's language, and «Cum funcționează» to the page it names, 44 pixels tall", async () => {
    const steps = EMPTY_STEPS.steps.map((step, index) => (index === 0 ? { title: { ro: "Luni", en: "Monday" }, body: { ro: "Alege luni", en: "Pick a Monday" } } : step));
    const content = { ...EMPTY_STEPS, title: { ro: "Nou aici?", en: "New here?" }, steps };
    currentLocale = "en";
    const markup = await html(StepsBand({ content, locale: "en", href: { pathname: "/pages/[slug]", params: { slug: "how" } } }));
    expect(markup).toContain("New here?");
    expect(markup).not.toContain("Nou aici?");
    expect(markup).toContain("Pick a Monday");
    expect(markup).toContain("Monday");
    expect(markup).toContain(escaped(en.HomeSections.steps.items["2"].title));
    expect(markup).toContain(escaped(en.HomeSections.steps.items["2"].body));
    expect(markup).toMatch(/<a[^>]*href="\/en\/pages\/how"/);
    expect(markup).toContain(escaped(en.HomeSections.steps.link));
    expect(markup).toMatch(/min-height:\s*44px/);
  });
});

describe("§714 «De ce» — WhyList", () => {
  it("draws four reasons with their glyphs, and no quote until the club writes one", async () => {
    for (const locale of ["ro", "en"] as const) {
      currentLocale = locale;
      const markup = await html(WhyList({ content: EMPTY_WHY, locale }));
      expect(markup).toContain(escaped(words().why.title));
      expect(markup.match(/<li[^>]*data-why="/g)).toHaveLength(4);
      for (const n of ["1", "2", "3", "4"] as const) {
        expect(markup).toContain(escaped(words().why.items[n].title));
        expect(markup).toContain(escaped(words().why.items[n].body));
      }
      expect(markup).not.toContain('data-testid="home-why-quote"');
      expect(markup).not.toContain("<blockquote");
    }
  });

  it("draws the club's quote as a quotation in the handwriting face, with who said it", async () => {
    currentLocale = "ro";
    const content = { ...EMPTY_WHY, quote: { ro: "Vin pentru oameni.", en: "I come for the people." }, quoteBy: { ro: "Membru A", en: "Member A" } };
    const markup = await html(WhyList({ content, locale: "ro" }));
    expect(markup).toContain("<figure");
    expect(markup).toContain("<blockquote");
    expect(markup).toContain("„Vin pentru oameni.”");
    expect(markup).toMatch(/<figcaption[^>]*>— Membru A<\/figcaption>/);
    expect(markup).toContain("var(--font-signature)");
    // Without a quote, no author is drawn on its own.
    const orphan = await html(WhyList({ content: { ...EMPTY_WHY, quoteBy: { ro: "Membru A", en: "Member A" } }, locale: "ro" }));
    expect(orphan).not.toContain("Membru A");
  });
});

describe("§714 the photo strip — PhotoStrip", () => {
  const LADDER = "0b6f3f9e-2a41-8c3d-9e5f-1a2b3c4d5e6f";
  const instagram = { network: "instagram" as const, href: "https://example.org/club", label: "Instagram" };

  it("draws nothing at all while no picture is chosen (an unset strip is not drawn)", async () => {
    expect(await PhotoStrip({ content: { title: null }, pictures: [], instagram, locale: "ro" })).toBeNull();
  });

  it("draws the chosen pictures in a row that scrolls inside itself, with the ladder's srcset, lazy", async () => {
    currentLocale = "en";
    const pictures = stripPictures([
      { id: "a", keyPrefix: LADDER, width: 2400, height: 1600, alt: "The start" },
      { id: "b", keyPrefix: "0b6f3f9e-2a41-4c3d-9e5f-1a2b3c4d5e6f", width: 1200, height: 1200, alt: "" },
    ]);
    const markup = await html(PhotoStrip({ content: { title: { ro: "Poze", en: "Photos" } }, pictures, instagram, locale: "en" }));
    expect(markup).toContain(">Photos<");
    expect(markup.match(/<img /g)).toHaveLength(2);
    expect(markup).toMatch(/<img[^>]*srcSet="[^"]*480w\.webp 480w/);
    expect(markup).toMatch(/<img[^>]*alt="The start"/);
    expect(markup).toMatch(/<img[^>]*alt=""/);
    expect(markup.match(/loading="lazy"/g)).toHaveLength(2);
    // A named region a keyboard reaches, which scrolls sideways and snaps: no script.
    expect(markup).toMatch(/role="region"[^>]*aria-label="[^"]+"[^>]*tabindex="0"|tabindex="0"[^>]*role="region"/i);
    expect(markup).toMatch(/scroll-snap-type:\s*x mandatory/);
    expect(markup).toMatch(/overflow-x:\s*auto/);
    expect(markup).not.toContain('data-testid="home-strip-empty"');
  });

  it("links the club's Instagram as a link in a new tab and the gallery, never an embed; no Instagram, no link", async () => {
    currentLocale = "ro";
    const pictures = stripPictures([{ id: "a", keyPrefix: LADDER, width: 2400, height: 1600, alt: "" }]);
    const markup = await html(PhotoStrip({ content: { title: null }, pictures, instagram, locale: "ro" }));
    expect(markup).toMatch(/<a[^>]*href="https:\/\/example\.org\/club"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    expect(markup).toContain(escaped(ro.HomeSections.strip.instagram));
    expect(markup).toMatch(/<a[^>]*href="\/ro\/gallery"/);
    expect(markup).not.toMatch(/<iframe|<script/);
    // Both links are thumb-sized.
    expect(markup.match(/min-height:\s*44px/g)?.length).toBeGreaterThanOrEqual(2);
    const without = await html(PhotoStrip({ content: { title: null }, pictures, instagram: null, locale: "ro" }));
    expect(without).not.toContain('data-testid="home-strip-instagram"');
  });

  it("draws empty places only when the design page asks, and never alongside a picture", async () => {
    const empty = await html(PhotoStrip({ content: { title: null }, pictures: [], instagram: null, locale: "ro", emptySlots: 6 }));
    expect(empty.match(/data-testid="home-strip-empty"/g)).toHaveLength(6);
    expect(empty).not.toContain("<img");
    const pictures = stripPictures([{ id: "a", keyPrefix: LADDER, width: 2400, height: 1600, alt: "" }]);
    const both = await html(PhotoStrip({ content: { title: null }, pictures, instagram: null, locale: "ro", emptySlots: 6 }));
    expect(both).not.toContain('data-testid="home-strip-empty"');
  });
});

describe("§714 the numbers band — NumbersBand", () => {
  it("draws nothing when no figure has its fact", async () => {
    expect(await NumbersBand({ figures: [], locale: "ro" })).toBeNull();
  });

  it("draws each figure with its words, Romanian counts in their three forms, and the club's name for a screen reader", async () => {
    currentLocale = "ro";
    const markup = await html(
      NumbersBand({
        figures: [
          { id: "years", count: 10 },
          { id: "runners", count: 120 },
          { id: "perWeek", count: 2 },
          { id: "free", count: 100 },
        ],
        locale: "ro",
      }),
    );
    expect(markup).toContain(escaped(`${CLUB_NAME} în cifre`));
    expect(markup).toContain(">10<");
    expect(markup).toContain(ro.HomeSections.numbers.years.few);
    expect(markup).toContain(">120<");
    expect(markup).toContain(ro.HomeSections.numbers.runners.other);
    expect(markup).toContain(">2×<");
    expect(markup).toContain(ro.HomeSections.numbers.perWeek.few);
    expect(markup).toContain(">100%<");
    expect(markup).toContain(ro.HomeSections.numbers.free.label);

    const one = await html(NumbersBand({ figures: [{ id: "years", count: 1 }], locale: "ro" }));
    expect(one).toContain(ro.HomeSections.numbers.years.one);
    expect(one.match(/data-figure="/g)).toHaveLength(1);
  });

  it("formats a large count for the reader's language", async () => {
    currentLocale = "en";
    const markup = await html(NumbersBand({ figures: [{ id: "runners", count: 1200 }], locale: "en" }));
    expect(markup).toContain(">1,200<");
    expect(markup).toContain(en.HomeSections.numbers.runners.other);
  });
});

const { createTranslator } = await import("next-intl");
const { sampleHome } = await import("@/modules/design/home-fixtures");
const { default: HomePage } = await import("@/modules/home/ui/HomePage");

describe("§714 the home page draws the four under the run sections, each only while the club switched it on", () => {
  const props = () => {
    const words = (namespace: "Home" | "Event") => {
      const translate = createTranslator({ locale: "ro", messages: ro, namespace });
      return (key: string, values?: Record<string, string>) => translate(key as never, values as never);
    };
    return sampleHome("ro", words("Home"), words("Event"));
  };
  const order = (markup: string) =>
    [...markup.matchAll(/data-testid="(home-hero|home-next-run|home-weekly|home-special|home-steps|home-why|home-strip|home-numbers)"/g)].map((match) => match[1]);

  it("leaves the four off by default: the page the club had before it switched any on", async () => {
    currentLocale = "ro";
    const markup = await html(createElement(HomePage, props()));
    expect(order(markup)).toEqual(["home-hero", "home-next-run", "home-weekly", "home-special"]);
  });

  it("draws them in the plan's order once switched on, the strip only with a picture and the band only with a figure", async () => {
    currentLocale = "ro";
    const on = { steps: true, why: true, strip: true, numbers: true };
    const markup = await html(createElement(HomePage, { ...props(), show: on }));
    // No picture chosen in the sample: the strip is not drawn, though its switch is on.
    expect(order(markup)).toEqual(["home-hero", "home-next-run", "home-weekly", "home-special", "home-steps", "home-why", "home-numbers"]);
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup.match(/<main\b/g)).toHaveLength(1);

    const pictures = stripPictures([{ id: "a", keyPrefix: "0b6f3f9e-2a41-8c3d-9e5f-1a2b3c4d5e6f", width: 2400, height: 1600, alt: "" }]);
    const withStrip = await html(createElement(HomePage, { ...props(), show: on, strip: { ...props().strip, pictures }, numbers: { figures: [], locale: "ro" } }));
    expect(order(withStrip)).toEqual(["home-hero", "home-next-run", "home-weekly", "home-special", "home-steps", "home-why", "home-strip"]);
    // Only the hero's picture is ever eager: the strip's tiles wait.
    expect(withStrip).not.toMatch(/<img[^>]*loading="eager"[^>]*thumb/);
  });
});

describe("§714 the sections stay Server Components on the house's primitives", () => {
  it("has no client directive, no colour literal, no MUI button, and draws icons by registry name", () => {
    for (const name of ["StepsBand", "WhyList", "PhotoStrip", "NumbersBand"]) {
      const source = readFileSync(`src/modules/home/ui/${name}.tsx`, "utf8");
      expect(source, name).not.toMatch(/^["']use client["']/m);
      expect(source, name).not.toMatch(/@mui\/icons-material/);
      expect(source, name).not.toMatch(/@mui\/material\/(Button|IconButton|Chip)["']/);
      expect(source, name).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
  });
});
