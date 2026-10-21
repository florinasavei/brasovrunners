import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §723 — «Tema v2»'s card as the Administrator opens it: beside the switch, «Culoarea de accent»
 * with a radio per preset, each drawn in miniature by day and after dark, and «Personalizat» with its
 * box, its picker and the derived shades; the accent in force is the one ticked and named. A role that
 * may not change it reads the accent in force and no form. Drawn from the real catalogues.
 */
let locale: "ro" | "en" = "ro";
// The dialogs' road line (§NNN) reads the club's roads once per request: no database here.
vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  const translator = (namespace: string) => createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Admin" });
  return {
    getLocale: async () => locale,
    getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) => translator(typeof arg === "string" ? arg : arg.namespace),
  };
});
vi.mock("@/app/[locale]/admin/settings/appearance/actions", () => ({ updateSiteLookAction: async () => ({}) }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", {}, children),
  getPathname: () => "/ro/admin/design",
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/admin/settings/appearance",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { default: SiteLookPanel } = await import("@/modules/appearance/ui/SiteLookPanel");
const { deriveAccentShades } = await import("@/modules/appearance/domain/accent-shades");
const { LOOK_ACCENT } = await import("@/theme/brand");
const ro = (await import("../../../messages/ro.json")).default;
const en = (await import("../../../messages/en.json")).default;

type Setting = Parameters<typeof SiteLookPanel>[0]["state"]["setting"];
const draw = async (setting: Setting, mayEdit = true) => renderToStaticMarkup(await SiteLookPanel({ locale, state: { setting, updatedAt: null }, mayEdit, openWhen: { primary: true } }));

/** The `<input>` of a radio by its value, as React writes it. */
const radio = (html: string, value: string) => html.match(new RegExp(`<input[^>]*name="accent"[^>]*value="${value}"[^>]*>`))?.[0] ?? "";

describe("§723 «Culoarea de accent» on the look's card", () => {
  it("offers every preset and «Personalizat» in both languages, the pink ticked and named when the club never chose", async () => {
    for (const language of ["ro", "en"] as const) {
      locale = language;
      const words = (language === "ro" ? ro : en).Admin.look.accent;
      const html = await draw({ on: true });
      expect(html).toContain('data-testid="site-look-accent"');
      for (const preset of ["pink", "blue", "orange"] as const) {
        expect(html, preset).toContain(`data-testid="site-look-accent-option-${preset}"`);
        expect(html, preset).toContain(words.presets[preset].name);
        // Each drawn in its own shades, by day and after dark.
        expect(html, preset).toContain(LOOK_ACCENT[preset].light.accentInk);
        expect(html, preset).toContain(LOOK_ACCENT[preset].dark.accentTint);
      }
      expect(html).toContain('data-testid="site-look-accent-option-custom"');
      expect(html).toContain('name="accentHex"');
      expect(html).toContain('type="color"');
      expect(html).toContain(words.rule.replace(/'/g, "&#x27;"));
      expect(radio(html, "pink")).toContain("checked");
      expect(radio(html, "custom")).not.toContain("checked");
      expect(html).toContain(words.current.replace("{accent}", words.presets.pink.name));
    }
    locale = "ro";
  });

  it("ticks and names a typed accent, its box filled and its derived shades written out", async () => {
    const html = await draw({ on: true, accent: "custom", hex: "#1f6feb" });
    expect(radio(html, "custom")).toContain("checked");
    expect(radio(html, "pink")).not.toContain("checked");
    expect(html).toContain('value="#1f6feb"');
    expect(html).toContain(`${ro.Admin.look.accent.custom.name} (#1f6feb)`);
    const shades = deriveAccentShades("#1f6feb");
    expect(html).toContain('data-testid="site-look-accent-shades"');
    for (const hex of [...Object.values(shades.light), ...Object.values(shades.dark)]) expect(html, hex).toContain(hex);
  });

  it("shows a role that may not change it the accent in force and no form", async () => {
    const html = await draw({ on: false, accent: "orange" }, false);
    expect(html).toContain(ro.Admin.look.accent.current.replace("{accent}", ro.Admin.look.accent.presets.orange.name));
    expect(html).not.toContain('data-testid="site-look-accent"');
    expect(html).not.toContain('name="accent"');
  });
});
