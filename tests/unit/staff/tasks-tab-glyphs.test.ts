import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { TASK_PANELS, visibleTaskPanels } from "@/modules/diagnostics/domain/task-panels";

/**
 * §318 as amended — a glyph before every tab of «Sarcini»' row (the owner, 2026-10-18: «vreau și la
 * subtaburi să am iconițe»), the same row on all three of the page's panels. Rendered the way the
 * server sends it: every tab is an anchor whose words are preceded by an `aria-hidden` picture, as
 * «Setări»' row's are (`settings-tab-glyphs.test.ts`).
 */
const lang = vi.hoisted(() => ({ current: "ro" as "ro" | "en" }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const all = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: lang.current, messages: all[lang.current], namespace: namespace as "Admin.tasks" }),
  };
});

const { default: TasksSubNav } = await import("@/modules/diagnostics/ui/TasksSubNav");

type Props = Parameters<typeof TasksSubNav>[0];

const PANEL_HREF = { club: "/ro/admin/tasks", todo: "/ro/admin/tasks?panel=todo", app: "/ro/admin/tasks?panel=app" } as const;

function props(overrides: Partial<Props> = {}): Props {
  return { role: "ADMIN", active: "club", openTodo: 0, panelHref: PANEL_HREF, devsPath: "/ro/devs", ...overrides };
}

async function row(given: Props, locale: "ro" | "en" = "ro"): Promise<string> {
  lang.current = locale;
  return renderToStaticMarkup((await TasksSubNav(given)) as ReactElement).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

/** Each anchor of the row: its address, its inner markup and its words. */
function anchors(html: string): { href: string; inner: string; text: string }[] {
  return [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({
    href: match[1],
    inner: match[2],
    text: match[2].replace(/<[^>]+>/g, ""),
  }));
}

describe("§318 a glyph on every sub-tab of «Sarcini»", () => {
  it("draws the four tabs an Administrator is offered, each with an aria-hidden picture before its words", async () => {
    const tabs = anchors(await row(props()));
    expect(tabs.map((tab) => tab.text)).toEqual(["Club", "De făcut", "Sistem", "Aplicația"]);
    for (const tab of tabs) {
      expect(tab.inner, tab.text).toMatch(/^<span[^>]*aria-hidden="true"[^>]*><svg[^>]*aria-hidden="true"/);
      // One picture per tab, and the words still after it: the link's name is the words alone.
      expect(tab.inner.match(/<svg/g), tab.text).toHaveLength(1);
    }
  });

  it("gives each tab its own picture: the checklist, the club's lines, the gear, the wrench", async () => {
    const tabs = anchors(await row(props()));
    const icons = tabs.map((tab) => tab.inner.match(/data-testid="(\w+)Icon"/)?.[1]);
    expect(icons).toEqual(["Checklist", "PlaylistAddCheck", "Settings", "Build"]);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("keeps the links where the page put them, «Sistem» leading to the configuration", async () => {
    const tabs = anchors(await row(props()));
    expect(tabs.map((tab) => tab.href)).toEqual([PANEL_HREF.club, PANEL_HREF.todo, "/ro/devs", PANEL_HREF.app]);
  });

  it("marks the current tab by aria-current alone, and shows the open count beside its picture", async () => {
    const html = await row(props({ active: "todo", openTodo: 3 }));
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>[\s\S]*?data-testid="PlaylistAddCheckIcon"[\s\S]*?De făcut \(3\)/);
  });

  it("draws the same pictures in English, under the same words as the catalogue", async () => {
    const tabs = anchors(await row(props(), "en"));
    const words = en.Admin.tasks.panel;
    expect(tabs.map((tab) => tab.text)).toEqual([words.club, words.todo, words.system, words.app]);
    for (const tab of tabs) expect(tab.inner, tab.text).toContain("<svg");
  });

  it("gives every tab a role is offered a picture — whatever the role", async () => {
    for (const role of STAFF_ROLES) {
      const offered = visibleTaskPanels(role);
      if (offered.length === 0) continue;
      const tabs = anchors(await row(props({ role, active: offered[0] })));
      // «Sistem» is drawn with «Aplicația», for the roles that open it.
      expect(tabs, role).toHaveLength(offered.length + (offered.includes("app") ? 1 : 0));
      for (const tab of tabs) expect(tab.inner, `${role}/${tab.text}`).toContain("<svg");
    }
  });

  it("keeps the catalogue's tab words, so the picture changes nothing a screen reader hears", () => {
    expect(ro.Admin.tasks.panel).toMatchObject({ club: "Club", todo: "De făcut", system: "Sistem", app: "Aplicația" });
  });

  it("is the one row the page draws on each of its three panels, and the page builds no other", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/tasks/page.tsx"), "utf8");
    expect(page.match(/<TasksSubNav\b/g)).toHaveLength(3);
    expect(page).not.toMatch(/<SubNav\b/);
    expect(TASK_PANELS).toEqual(["club", "todo", "app"]);
  });
});
