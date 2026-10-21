import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §766 (amending §254, §282) — the anti-bot check and the honeypot are tick boxes, never buttons with a
 * toggle glyph (the owner, 2026-10-14: «nu mai folosi niciodată» that kind of element). Each is a plain
 * form whose submit is drawn as the checkbox, its words naming the setting, `role="checkbox"` and
 * `aria-checked` the state; a press still asks first, the confirm button says the verb, and the action
 * behind the form is the one it always was: the hidden `enabled` holds the state the press wants.
 */
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en" }));

// The dialogs' road line (§NNN) reads the club's roads once per request: no database here.
vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = { ro: (await import("../../../messages/ro.json")).default, en: (await import("../../../messages/en.json")).default };
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: state.locale, messages: catalogues[state.locale], namespace: namespace as "Admin" }),
    getLocale: async () => state.locale,
  };
});
vi.mock("@/app/[locale]/admin/settings/platform/actions", () => ({ updateBotCheckAction: async () => null }));

const { default: BotCheckPanel } = await import("@/modules/registrations/ui/BotCheckPanel");
type Props = Parameters<typeof BotCheckPanel>[0];

const ON = { enabled: true, honeypot: true, updatedAt: null };
const OFF = { enabled: false, honeypot: false, updatedAt: null };

async function panelElement(locale: "ro" | "en", overrides: Partial<Props> = {}): Promise<unknown> {
  state.locale = locale;
  return BotCheckPanel({ locale, state: ON, keysPresent: true, mayEdit: true, ...overrides });
}

async function render(locale: "ro" | "en", overrides: Partial<Props> = {}): Promise<string> {
  const element = await panelElement(locale, overrides);
  return renderToStaticMarkup(element as ReactElement).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

/** The element carrying `data-testid` in the panel's tree, before rendering: its props are what an island receives. */
function findByTestId(node: unknown, testId: string): { props: Record<string, unknown> } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child, testId);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const element = node as { props: Record<string, unknown> };
  if (element.props["data-testid"] === testId) return element;
  return findByTestId(element.props.children, testId);
}

const tick = (html: string, testId: string) => html.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>[\\s\\S]*?</button>`))?.[0] ?? "";
const formOf = (html: string, testId: string) => new RegExp(`<form[^>]*data-testid="${testId}"[\\s\\S]*?</form>`).exec(html)?.[0] ?? "";

describe("§766 the anti-bot check is a tick box", () => {
  it("draws both settings ticked while they are on: role, state, the setting's words, the state the press wants", async () => {
    const html = await render("ro");
    const check = tick(html, "bot-check-tick");
    expect(check).toContain('type="submit"');
    expect(check).toContain('role="checkbox"');
    expect(check).toContain('aria-checked="true"');
    expect(check).toContain('data-testid="CheckBoxIcon"');
    expect(check).toContain(`${ro.Admin.botCheck.tick}</button>`);
    // Pressing a ticked box unticks it: the form posts the other value, to the same action as ever.
    const checkForm = formOf(html, "bot-check-form");
    expect(checkForm).toContain('name="enabled" value="0"');
    expect(checkForm).not.toContain('name="which"');

    const trap = tick(html, "honeypot-tick");
    expect(trap).toContain('role="checkbox"');
    expect(trap).toContain('aria-checked="true"');
    expect(trap).toContain(`${ro.Admin.botCheck.honeypot.tick}</button>`);
    const trapForm = formOf(html, "honeypot-form");
    expect(trapForm).toContain('name="which" value="honeypot"');
    expect(trapForm).toContain('name="enabled" value="0"');
  });

  it("draws both empty while they are off, the words unchanged, and a press that asks to switch them on", async () => {
    const html = await render("ro", { state: OFF });
    const check = tick(html, "bot-check-tick");
    expect(check).toContain('aria-checked="false"');
    expect(check).toContain('data-testid="CheckBoxOutlineBlankIcon"');
    // The words name the setting the same either way: never the verb that would flip it.
    expect(check).toContain(`${ro.Admin.botCheck.tick}</button>`);
    expect(formOf(html, "bot-check-form")).toContain('name="enabled" value="1"');
    const trap = tick(html, "honeypot-tick");
    expect(trap).toContain('aria-checked="false"');
    expect(trap).toContain(`${ro.Admin.botCheck.honeypot.tick}</button>`);
    expect(formOf(html, "honeypot-form")).toContain('name="enabled" value="1"');
  });

  it("still asks first, and the confirm button carries the verb of the press", async () => {
    const asking = await panelElement("ro");
    const confirmOf = (testId: string, element: unknown) => findByTestId(element, testId)?.props.confirm as { confirmLabel: string; destructive?: boolean };
    expect(confirmOf("bot-check-form", asking)).toMatchObject({ confirmLabel: ro.Admin.botCheck.turnOff, destructive: true });
    expect(confirmOf("honeypot-form", asking)).toMatchObject({ confirmLabel: ro.Admin.botCheck.honeypot.turnOff, destructive: true });
    const off = await panelElement("ro", { state: OFF });
    expect(confirmOf("bot-check-form", off).confirmLabel).toBe(ro.Admin.botCheck.turnOn);
    expect(confirmOf("honeypot-form", off).confirmLabel).toBe(ro.Admin.botCheck.honeypot.turnOn);
  });

  it("has no toggle glyph and no button beside the tick in either form", async () => {
    for (const html of [await render("ro"), await render("ro", { state: OFF }), await render("en")]) {
      expect(html).not.toContain("ToggleOnIcon");
      expect(html).not.toContain("ToggleOffIcon");
      for (const form of ["bot-check-form", "honeypot-form"]) expect([...formOf(html, form).matchAll(/<button\b/g)]).toHaveLength(1);
    }
  });

  it("draws the check's tick only where the keys are, and neither for a reader who may not change it (§450)", async () => {
    const noKeys = await render("ro", { keysPresent: false });
    expect(noKeys).not.toContain("bot-check-tick");
    // The honeypot needs no keys (§282): its tick stays.
    expect(noKeys).toContain("honeypot-tick");
    const reader = await render("ro", { mayEdit: false });
    expect(reader).not.toContain('role="checkbox"');
    expect(reader).toContain("bot-check-read-only");
  });

  it("says the same in English", async () => {
    const html = await render("en", { state: OFF });
    expect(tick(html, "bot-check-tick")).toContain(`${en.Admin.botCheck.tick}</button>`);
    expect(tick(html, "honeypot-tick")).toContain(`${en.Admin.botCheck.honeypot.tick}</button>`);
    expect(en.Admin.botCheck.tick).not.toBe(ro.Admin.botCheck.tick);
  });
});
