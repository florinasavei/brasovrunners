import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — "Termene" shows the recommended value of every deadline (the default of `DEADLINE_RULES`,
 * never a number in the catalogue) and offers the Administrator one press that posts them all to
 * the same save; nothing to press when every deadline already has it, and no form for a reader.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages, namespace: namespace as "Admin" }),
    getLocale: async () => "ro",
  };
});
vi.mock("@/app/[locale]/admin/emails/actions", () => ({ updateDeadlinesAction: async () => null, updateAddressCapAction: async () => null }));

const { default: DeadlinesPanel } = await import("@/modules/deadlines/ui/DeadlinesPanel");
const { DEADLINE_KEYS, DEFAULT_DEADLINES } = await import("@/modules/deadlines/domain/deadlines");

async function render(mayEdit: boolean, deadlines = DEFAULT_DEADLINES): Promise<string> {
  const html = renderToStaticMarkup(
    (await DeadlinesPanel({ locale: "ro", state: { deadlines, updatedAt: null }, mayEdit })) as ReactElement,
  );
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

describe("§NNN the recommended deadlines", () => {
  it("posts every default in one form when a deadline differs", async () => {
    const html = await render(true, { ...DEFAULT_DEADLINES, holdMinutes: 60 });
    const form = html.match(/<form[^>]*data-testid="deadlines-recommended-form"[\s\S]*?<\/form>/)?.[0] ?? "";
    for (const key of DEADLINE_KEYS) {
      expect(form, key).toMatch(new RegExp(`<input[^>]*type="hidden"[^>]*name="${key}"[^>]*value="${DEFAULT_DEADLINES[key]}"`));
    }
    expect(form).toContain(ro.Admin.emails.deadlines.applyRecommended);
    expect(html).toContain("recomandat " + DEFAULT_DEADLINES.holdMinutes);
  });

  it("offers nothing to press when every deadline is recommended", async () => {
    const html = await render(true);
    expect(html).not.toContain("deadlines-recommended-form");
    expect(html).toContain(ro.Admin.emails.deadlines.recommendedInForce);
  });

  it("shows a reader the recommended value beside each one, and no form", async () => {
    const html = await render(false, { ...DEFAULT_DEADLINES, offerHours: 12 });
    expect(html).not.toContain("deadlines-recommended-form");
    expect(html).toContain(`(recomandat ${DEFAULT_DEADLINES.offerHours})`);
  });

  it("keeps the numbers out of the catalogues, in both languages", () => {
    for (const words of [ro.Admin.emails.deadlines, en.Admin.emails.deadlines]) {
      for (const key of ["recommendedShort", "recommendedIntro", "recommendedInForce", "applyRecommended"] as const) {
        expect(words[key], key).not.toMatch(/\d/);
      }
    }
  });
});
