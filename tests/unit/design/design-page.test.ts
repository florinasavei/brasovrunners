import { existsSync, readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-060-01 (§692) — «Sistemul de design», the backoffice page that draws the site's look from
 * the code, rendered on the server as the page renders it, in both languages.
 *
 * What is held: every section anchor the contents row points at is on the page; every key of
 * `COLOR`, of `COLOR_DARK` and of `SITE_TINT`, every text/background pair, every name of the two
 * glyph registries, every rule, every decision and every phase of the plan appears — read from the
 * same constants the page imports, so a token or a glyph added to the code is asserted here without
 * a test change; and the route's layout answers a volunteer with `notFound()` and lets the Redactor
 * through. The catalogues are the real ones; Next's navigation and the staff session are stubbed.
 */
let currentLocale: "ro" | "en" = "ro";
let currentRole: StaffRole = "COPYWRITER";

vi.mock("next-intl/server", async () => {
  const { createFormatter, createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (arg: string | { namespace: string }) => {
      const namespace = typeof arg === "string" ? arg : arg.namespace;
      return createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Admin" });
    },
    getFormatter: async () => createFormatter({ locale: currentLocale, timeZone: "Europe/Bucharest" }),
    getLocale: async () => currentLocale,
    setRequestLocale: () => undefined,
  };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  unstable_rethrow: () => undefined,
  usePathname: () => `/${currentLocale}/admin/design`,
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => {
  const path = (href: string | { pathname?: string; params?: { slug?: string } }) =>
    typeof href === "string" ? `/${currentLocale}${href}` : `/${currentLocale}${href.pathname ?? "/events/[slug]"}`.replace("[slug]", href.params?.slug ?? "");
  return {
    getPathname: ({ href }: { href: string | { pathname?: string; params?: { slug?: string } } }) => path(href),
    Link: ({ href, children, ...rest }: { href: string | { pathname?: string; params?: { slug?: string } }; children: ReactNode }) =>
      createElement("a", { href: path(href), ...rest }, children),
  };
});
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => ({ id: "staff-1", email: "redactor@example.com", role: currentRole, displayName: "Redactor" }),
}));

const { NextIntlClientProvider } = await import("next-intl");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;
const { default: DesignSystem } = await import("@/modules/design/ui/DesignSystem");
const { default: DesignSectionLayout } = await import("@/app/[locale]/admin/design/layout");
const { DESIGN_SECTION_IDS } = await import("@/modules/design/ui/section");
const { DESIGN_RULES } = await import("@/modules/design/rules");
const { REDESIGN_DECISIONS, REDESIGN_PHASES } = await import("@/modules/design/redesign-plan");
const { COLOR, COLOR_DARK, SITE_TINT } = await import("@/theme/brand");
const { BRAND_PAIRS } = await import("@/theme/brand-pairs");
const { GLYPHS } = await import("@/modules/events/ui/glyphs");
const { ACTION_ICONS } = await import("@/shared/ui/action-icons");

afterEach(() => {
  currentLocale = "ro";
  currentRole = "COPYWRITER";
});

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(
      NextIntlClientProvider,
      { locale: currentLocale, messages: currentLocale === "ro" ? ro : en, timeZone: "Europe/Bucharest" } as unknown as ComponentProps<typeof NextIntlClientProvider>,
      element,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

/** The page's content for the reader's language; the gate is the layout's and `page.tsx`'s. */
const page = () => html(createElement(DesignSystem, { locale: currentLocale }));

describe("BR-REQ-060-01 «Sistemul de design» draws the look from the code", () => {
  it("has every section's anchor and its heading in the contents, in both languages", async () => {
    for (const locale of ["ro", "en"] as const) {
      currentLocale = locale;
      const markup = await page();
      const words = (locale === "ro" ? ro : en).Admin.design;
      expect(markup).toContain(words.title);
      for (const id of DESIGN_SECTION_IDS) {
        expect(markup, `${locale}: section ${id}`).toContain(`id="${id}"`);
        expect(markup, `${locale}: contents link ${id}`).toContain(`href="#${id}"`);
        expect(markup, `${locale}: heading ${id}`).toContain(words.sections[id]);
      }
    }
  });

  it("names every colour token, every tint and every asserted pair with its ratio", async () => {
    const markup = await page();
    for (const key of Object.keys(COLOR)) expect(markup, `COLOR.${key}`).toContain(`>${key}<`);
    for (const key of Object.keys(COLOR_DARK)) expect(markup, `COLOR_DARK.${key}`).toContain(`>${key}<`);
    for (const [key, hex] of Object.entries(SITE_TINT)) {
      expect(markup, `SITE_TINT.${key}`).toContain(`· ${key}<`);
      expect(markup, `SITE_TINT.${key} hex`).toContain(hex);
    }
    for (const pair of BRAND_PAIRS) {
      expect(markup, pair.foreground.name).toContain(`>${pair.foreground.name}<`);
      expect(markup, pair.background.name).toContain(`>${pair.background.name}<`);
    }
    // A ratio per pair, two decimals (React writes a comment between the number and « : 1»), and
    // only AA levels: the brand test holds every pair at 4.5 : 1.
    expect(markup.match(/\d+\.\d\d(<!-- -->)? : 1/g)?.length ?? 0).toBeGreaterThanOrEqual(BRAND_PAIRS.length);
    expect(markup).not.toContain(ro.Admin.design.colours.below);
  });

  it("draws every glyph of both registries by name, with the counts", async () => {
    const markup = await page();
    for (const name of Object.keys(GLYPHS)) expect(markup, `glyph ${name}`).toContain(`>${name}</div>`);
    for (const name of Object.keys(ACTION_ICONS)) expect(markup, `action icon ${name}`).toContain(`>${name}</div>`);
    expect(markup).toContain(`· ${Object.keys(GLYPHS).length}<`);
    expect(markup).toContain(`· ${Object.keys(ACTION_ICONS).length}<`);
  });

  it("lists every rule with where it lives, and every decision and phase of the plan with a status", async () => {
    const markup = await page();
    for (const rule of DESIGN_RULES) {
      expect(markup, rule.id).toContain(`data-rule="${rule.id}"`);
      expect(markup, rule.id).toContain(ro.Admin.design.rules.items[rule.id as keyof typeof ro.Admin.design.rules.items]);
      for (const where of rule.where) expect(markup, `${rule.id}: ${where}`).toContain(`>${where}</code>`);
    }
    for (const decision of REDESIGN_DECISIONS) {
      expect(markup).toContain(`data-decision="${decision.id}"`);
      expect(markup).toContain(ro.Admin.design.plan.decisions[String(decision.id) as "1"].title);
    }
    for (const phase of REDESIGN_PHASES) {
      expect(markup).toContain(`data-phase="${phase.id}"`);
      expect(markup).toContain(ro.Admin.design.plan.phases[String(phase.id) as "0"].title);
    }
    expect(markup).toContain(">docs/REDESIGN.md<");
    expect(markup).toContain(ro.Admin.design.plan.statuses.default);
    expect(markup).toContain(ro.Admin.design.plan.statuses.planned);
    expect(markup).toContain(ro.Admin.design.plan.statuses.decided);
  });

  it("names no person and no real event in its samples", async () => {
    const markup = await page();
    expect(markup).toContain("Alergare de probă");
    expect(markup).toContain("Membru A");
    expect(markup.replace(/<style[\s\S]*?<\/style>/g, "")).not.toMatch(/[\w.-]+@[\w-]+/);
    // Every fixture name is a placeholder, never a person's or a real event's.
    const fixtures = readFileSync("src/modules/design/fixtures.ts", "utf8");
    const names = [...fixtures.matchAll(/\b(?:name|run|race|partner):\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name, name).toMatch(/^(Membru A|Member A)$|probă|Sample/);
    // Markup people-like words are the fixtures' only: the one sample member's name.
    expect([...markup.matchAll(/(?:Membru|Member) [A-Z]/g)].every((m) => /^(Membru|Member) A$/.test(m[0]))).toBe(true);
  });

  it("holds every rule the brief names, in both catalogues", () => {
    const ids = DESIGN_RULES.map((rule) => rule.id);
    for (const id of ["staticPages", "lightDefault", "pageTint", "fontSize"]) expect(ids).toContain(id);
    expect(ids.length).toBe(21);
    for (const catalogue of [ro, en]) expect(Object.keys(catalogue.Admin.design.rules.items).sort()).toEqual([...ids].sort());
    for (const rule of DESIGN_RULES) for (const where of rule.where) expect(existsSync(where.replace(/\/$/, "")), where).toBe(true);
  });
});

describe("BR-REQ-060-01 the gate of /admin/design is the layout's", () => {
  it("answers a volunteer with notFound and lets the Redactor and up through", async () => {
    for (const role of ["MEMBER", "CONTRIBUTOR"] as const) {
      currentRole = role;
      await expect(DesignSectionLayout({ children: null })).rejects.toThrow("NEXT_NOT_FOUND");
    }
    for (const role of ["COPYWRITER", "MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      currentRole = role;
      await expect(DesignSectionLayout({ children: null })).resolves.toBeTruthy();
    }
  });
});
