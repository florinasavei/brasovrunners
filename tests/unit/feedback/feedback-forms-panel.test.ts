import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FEEDBACK_BRANCHES } from "@/modules/feedback/domain/branches";

/**
 * BR-REQ-070-04, `DECISIONS.md` §NNN — the backoffice card that switches «Spune-ne ceva»'s four forms
 * on and off: each form's glyph before its legend (as on the public contact page, §696), and a
 * separator between the four forms — three of them, and nothing before the save button.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: messages as typeof messages, namespace: namespace as "Admin" }),
    getLocale: async () => "ro",
  };
});
vi.mock("@/app/[locale]/admin/pages/contact/actions", () => ({ updateFeedbackFormsAction: async () => undefined }));
vi.mock("@/shared/forms/refusal-messages", () => ({ refusalMessages: async () => ({}) }));
vi.mock("@/shared/forms/ActionForm", () => ({ default: ({ children }: { children: ReactNode }) => createElement("form", null, children) }));
vi.mock("@/shared/forms/recall", () => ({ default: () => null }));
vi.mock("@/shared/ui/CheckboxField", () => ({ default: () => null }));
vi.mock("@/shared/ui/GlyphSubmitButton", () => ({ default: () => createElement("button", { type: "submit", "data-testid": "save" }) }));

const { default: FeedbackFormsPanel } = await import("@/modules/feedback/ui/FeedbackFormsPanel");

const state = {
  howItWent: { on: true, to: "a@example.org" },
  suggestion: { on: false, to: null },
  complaint: { on: false, to: null },
  safety: { on: false, to: null, name: null },
  updatedAt: null,
} as unknown as Parameters<typeof FeedbackFormsPanel>[0]["state"];

async function html(): Promise<string> {
  const element = await FeedbackFormsPanel({ locale: "ro", state, noticeDescribes: true, mayEdit: true });
  return renderToStaticMarkup(element);
}

describe("the backoffice card of the four forms", () => {
  it("draws a separator between the four forms — three — and none before the save button", async () => {
    const out = await html();
    expect(FEEDBACK_BRANCHES).toHaveLength(4);
    expect(out.match(/data-testid="feedback-branch-divider"/g)).toHaveLength(3);
    // Each divider sits between two forms, so the last form and the save button have none between them.
    const lastForm = out.lastIndexOf('data-testid="feedback-branch-safety"');
    const lastDivider = out.lastIndexOf('data-testid="feedback-branch-divider"');
    expect(lastDivider).toBeLessThan(lastForm);
    expect(out.indexOf('data-testid="save"')).toBeGreaterThan(lastForm);
  });

  it("draws each form's glyph, hidden from a screen reader, before its legend", async () => {
    const out = await html();
    const legends = [...out.matchAll(/<legend[^>]*>([\s\S]*?)<\/legend>/g)].map(([, inner]) => inner.replace(/<style[\s\S]*?<\/style>/g, ""));
    expect(legends).toHaveLength(4);
    for (const inner of legends) {
      expect(inner).toMatch(/^<svg[^>]*aria-hidden="true"/);
      expect(inner.match(/<svg/g)).toHaveLength(1);
    }
  });
});
