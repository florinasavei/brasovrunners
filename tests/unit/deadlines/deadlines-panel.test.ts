import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §377 — "Termene" on `/admin/emails`: the panel says the numbers in force, on its closed line and
 * in its boxes, each box carrying the bounds the service enforces; a reader who may not change
 * them reads the same numbers and no form. The catalogues carry a label and a help for every
 * deadline, in both languages, since the panel asks for them by a key it builds.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Admin" }),
    // The save's confirmation (`confirmWords`, §NNN) counts in the page's language.
    getLocale: async () => "ro",
  };
});
vi.mock("@/app/[locale]/admin/emails/actions", () => ({ updateDeadlinesAction: async () => null }));

const { default: DeadlinesPanel } = await import("@/modules/deadlines/ui/DeadlinesPanel");
const { DEADLINE_KEYS, DEADLINE_RULES, DEFAULT_DEADLINES } = await import("@/modules/deadlines/domain/deadlines");

async function render(mayEdit: boolean, deadlines = DEFAULT_DEADLINES): Promise<string> {
  const html = renderToStaticMarkup(
    (await DeadlinesPanel({ locale: "ro", state: { deadlines, updatedAt: new Date("2026-09-24T07:00:00Z") }, mayEdit })) as ReactElement,
  );
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

describe("§377 the 'Termene' panel", () => {
  it("says the four a participant meets most on its closed line, in words", async () => {
    const html = await render(true, { ...DEFAULT_DEADLINES, holdMinutes: 60, reminderHours: 72 });
    expect(html).toContain("Link 48 de ore · loc ținut o oră · ofertă 24 de ore · reminder 3 zile");
    expect(await render(false, { ...DEFAULT_DEADLINES, reminderHours: 0 })).toContain("reminder fără");
  });

  it("offers the Administrator one box per deadline, with the value in force and the service's bounds", async () => {
    const html = await render(true, { ...DEFAULT_DEADLINES, offerHours: 12 });
    for (const key of DEADLINE_KEYS) {
      const { min, max } = DEADLINE_RULES[key];
      const input = html.match(new RegExp(`<input[^>]*name="${key}"[^>]*>`))?.[0] ?? "";
      expect(input, key).toContain(`min="${min}"`);
      expect(input, key).toContain(`max="${max}"`);
      expect(input, key).toContain(`value="${key === "offerHours" ? 12 : DEFAULT_DEADLINES[key]}"`);
    }
    expect(html).toContain(ro.Admin.emails.deadlines.save);
    expect(html).toContain("Setat joi, 24 sept. 2026, 10:00.");
  });

  it("shows anybody else the numbers in force and no form", async () => {
    const html = await render(false, { ...DEFAULT_DEADLINES, holdMinutes: 20 });
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).toContain(ro.Admin.emails.deadlines.readOnly);
    expect(html).toMatch(/data-testid="deadline-holdMinutes"[^>]*>20</);
  });

  it("has a label and a help for every deadline, in both catalogues", () => {
    for (const messages of [ro, en]) {
      for (const key of DEADLINE_KEYS) {
        expect(messages.Admin.emails.deadlines.fields[key], key).toBeTruthy();
        expect(messages.Admin.emails.deadlines.help[key], key).toBeTruthy();
      }
    }
  });
});
