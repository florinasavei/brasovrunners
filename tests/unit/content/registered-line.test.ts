import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * §408 — the registrants' count is said once in the event editor (BR-REQ-050-02; the owner,
 * 2026-09-25: "informația «3 înscriși» se repetă de prea multe ori pe fiecare card").
 *
 * It was a chip on each of the five boxes a change reaches (§350, §358). Now: one line under the
 * page map, with the count, a "?" naming the marked cards and a button to the registrations list;
 * the boxes keep their amber outline from the same predicate (`riskMark`), and wear no chip.
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

const { default: RegisteredLine, MARKED_BOXES } = await import("@/modules/content/events/ui/RegisteredLine");
const { riskMark } = await import("@/modules/content/events/ui/boxes/box-kit");

afterEach(() => {
  currentLocale = "ro";
});

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const markup = (html: string): string => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
const HREF = "/ro/admin/registrations?eventId=11111111-1111-1111-1111-111111111111";

async function line(count: number, { locale = "ro", href = HREF }: { locale?: "ro" | "en"; href?: string | null } = {}): Promise<string> {
  currentLocale = locale;
  const element = await RegisteredLine({ count, locale, registrationsHref: href });
  return element === null ? "" : markup(renderToStaticMarkup(element as ReactElement));
}

/** The text a reader sees, tags gone and entities read. */
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");

describe("§408 the line under the page map", () => {
  it("says the count once, in each language's counted form", async () => {
    expect(text(await line(1))).toContain("1 înscris · o schimbare în cardurile cu margine portocalie ajunge la ei");
    expect(text(await line(3))).toContain("3 înscriși · ");
    expect(text(await line(23))).toContain("23 de înscriși · ");
    expect(text(await line(3, { locale: "en" }))).toContain("3 registered · a change in the cards with an orange edge reaches them");
    expect(text(await line(1, { locale: "en" }))).toContain("1 registered · ");
  });

  it("names the marked cards in its tooltip, by the titles their headings wear", async () => {
    const html = await line(3);
    const ro = (await import("../../../messages/ro.json")).default.Admin.editor.boxes as unknown as Record<string, { title: string }>;
    // The "?" carries the text as its accessible name, so a screen reader hears it without the hover.
    const label = html.match(/aria-label="([^"]*)"/)?.[1] ?? "";
    expect(label).toContain("Cardurile cu margine portocalie, unde o schimbare ajunge la cei înscriși:");
    for (const box of MARKED_BOXES) expect(label, box).toContain(`– ${ro[box].title}`);
    expect(MARKED_BOXES).toEqual(["when", "place", "registration", "programme", "status"]);
  });

  it("links to this event's registrations for a role that may read them, a 44-pixel target, and not otherwise", async () => {
    const html = await line(3);
    expect(html).toContain(`href="${HREF}"`);
    expect(text(html)).toContain("Vezi înscrierile");
    expect(text(await line(3, { locale: "en" }))).toContain("See the registrations");
    expect(read("src/modules/content/events/ui/RegisteredLine.tsx")).toContain("sx={{ minHeight: 44 }}");
    const withoutLink = await line(3, { href: null });
    expect(withoutLink).not.toContain("href=");
    expect(text(withoutLink)).toContain("3 înscriși");
  });

  it("says nothing when nobody real is registered — as no box wears the outline", async () => {
    expect(await line(0)).toBe("");
    expect(riskMark(0)).toBeNull();
    expect(riskMark(3)).toEqual({ count: 3 });
  });
});

describe("§408 the count is said nowhere else in the editor", () => {
  it("draws no chip on any box: Panel has no badge, and no box passes one", () => {
    expect(read("src/shared/ui/Panel.tsx")).not.toMatch(/\bbadge\b/);
    const dir = "src/modules/content/events/ui/boxes";
    for (const file of readdirSync(path.join(ROOT, dir))) expect(read(`${dir}/${file}`), file).not.toMatch(/\bbadge\b|risk\.chip|risk\?\.chip/);
  });

  it("keeps the outline on the same five boxes, from the same predicate", () => {
    for (const box of ["WhenBox", "PlaceBox", "RegistrationBox", "ProgrammeBox", "StatusBox"]) {
      expect(read(`src/modules/content/events/ui/boxes/${box}.tsx`), box).toMatch(/tone[=:] ?\{? ?risk \? "risk" : "default"/);
    }
  });

  it("the edit page draws the line once, under the page map, with the real count; the create page not at all", () => {
    const edit = read("src/app/[locale]/admin/events/[id]/page.tsx");
    expect(edit.match(/<RegisteredLine\b/g)).toHaveLength(1);
    const map = edit.indexOf("<SectionMap ");
    const lineAt = edit.indexOf("<RegisteredLine");
    expect(map).toBeGreaterThan(-1);
    expect(lineAt).toBeGreaterThan(map);
    expect(edit.slice(lineAt, edit.indexOf("/>", lineAt))).toContain("count={realCount}");
    expect(edit).toContain("const risk = riskMark(realCount);");
    expect(read("src/app/[locale]/admin/events/new/page.tsx")).not.toContain("RegisteredLine");
  });

  it("the boxes' own sentences no longer repeat the number", async () => {
    for (const locale of ["ro", "en"] as const) {
      const risk = (await import(`../../../messages/${locale}.json`)).default.Admin.editor.risk as Record<string, unknown>;
      expect(risk.chip, locale).toBeUndefined();
      for (const [key, sentence] of Object.entries(risk)) expect(sentence, `${locale}.${key}`).not.toContain("{count}");
    }
  });
});
