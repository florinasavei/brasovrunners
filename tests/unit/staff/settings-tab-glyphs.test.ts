import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { CONFIGURATION_TAB, offersConfigurationTab, SETTINGS_TABS, visibleSettingsTabs } from "@/modules/staff-identity/domain/settings-tabs";

/**
 * §318 as amended, §516 — a glyph before every tab of «Setări»'s row (the owner, 2026-10-18:
 * «vreau și la subtaburi să am iconițe»). Rendered the way the server sends it: every tab the row
 * offers a role is an anchor whose words are preceded by an `aria-hidden` picture, so the row reads
 * as «Pagini»' does; «Configurație» and the panels `/devs` hands in take the same row.
 */
const lang = vi.hoisted(() => ({ current: "ro" as "ro" | "en" }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const all = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: lang.current, messages: all[lang.current], namespace: namespace as "Admin" }),
  };
});
vi.mock("@/i18n/navigation", () => ({ getPathname: ({ href }: { href: string }) => href }));

const { default: SettingsSubNav } = await import("@/modules/staff-identity/ui/SettingsSubNav");

type Props = Parameters<typeof SettingsSubNav>[0];

async function row(props: Props, locale: "ro" | "en" = "ro"): Promise<string> {
  lang.current = locale;
  return renderToStaticMarkup((await SettingsSubNav(props)) as ReactElement).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

/** Each anchor of the row: its attributes and its inner markup. */
function anchors(html: string): { inner: string; text: string }[] {
  return [...html.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({ inner: match[1], text: match[1].replace(/<[^>]+>/g, "") }));
}

describe("§318 / §516 a glyph on every sub-tab of «Setări»", () => {
  it("draws the six tabs an Administrator is offered, each with an aria-hidden picture before its words", async () => {
    const html = await row({ locale: "ro", role: "ADMIN", active: "deadlines" });
    const tabs = anchors(html);
    expect(tabs.map((tab) => tab.text)).toEqual(["Emailuri", "Termene", "Aspect", "Costuri", "Anti-robot", "Configurație"]);
    for (const tab of tabs) {
      expect(tab.inner, tab.text).toMatch(/^<span[^>]*aria-hidden="true"[^>]*><svg[^>]*aria-hidden="true"/);
      // One picture per tab, and the words still after it: the link's name is the words alone.
      expect(tab.inner.match(/<svg/g), tab.text).toHaveLength(1);
    }
  });

  it("gives each tab its own picture: mail, timer, palette, coin, shield, gear", async () => {
    const tabs = anchors(await row({ locale: "ro", role: "ADMIN", active: "emails" }));
    const icons = tabs.map((tab) => tab.inner.match(/data-testid="(\w+)Icon"/)?.[1]);
    expect(icons).toEqual(["Mail", "Timer", "Palette", "Paid", "Shield", "Settings"]);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("marks the current tab by aria-current, as before, and in English draws the same pictures", async () => {
    const html = await row({ locale: "en", role: "ADMIN", active: "costs" }, "en");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>[\s\S]*?data-testid="PaidIcon"[\s\S]*?Costs/);
    const tabs = anchors(html);
    expect(tabs.map((tab) => tab.text)).toEqual(Object.values(en.Admin.settingsTabs));
    for (const tab of tabs) expect(tab.inner, tab.text).toContain("<svg");
  });

  it("gives every tab a role is offered a picture — whatever the role", async () => {
    for (const role of STAFF_ROLES) {
      const offered = visibleSettingsTabs(role).length + (offersConfigurationTab(role) ? 1 : 0);
      if (offered === 0) continue;
      const tabs = anchors(await row({ locale: "ro", role, active: "emails" }));
      expect(tabs, role).toHaveLength(offered);
      for (const tab of tabs) expect(tab.inner, `${role}/${tab.text}`).toContain("<svg");
    }
  });

  it("draws a picture on «Configurație» and on every panel `/devs` hands in, never a bare word", async () => {
    const tabs = anchors(
      await row({
        locale: "ro",
        role: "ADMIN",
        active: CONFIGURATION_TAB,
        configurationPanels: [
          { href: "/devs", label: "Configurație", active: true },
          { href: "/devs?panel=general", label: "Configurație · General" },
          { href: "/devs?panel=email", label: "Configurație · Emailuri" },
        ],
      }),
    );
    expect(tabs.map((tab) => tab.text).slice(-3)).toEqual(["Configurație", "Configurație · General", "Configurație · Emailuri"]);
    expect(tabs).toHaveLength(SETTINGS_TABS.length + 3);
    for (const tab of tabs) expect(tab.inner, tab.text).toContain("<svg");
  });

  it("keeps the catalogue's tab words, so the picture changes nothing a screen reader hears", () => {
    expect(Object.values(ro.Admin.settingsTabs)).toEqual(["Emailuri", "Termene", "Aspect", "Costuri", "Anti-robot", "Configurație"]);
  });
});
