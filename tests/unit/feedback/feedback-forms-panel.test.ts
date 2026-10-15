import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FEEDBACK_BRANCHES } from "@/modules/feedback/domain/branches";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-070-04, `DECISIONS.md` §716 — the backoffice card that switches «Spune-ne ceva»'s four forms
 * on and off: each form's glyph before its legend (as on the public contact page, §696), and a
 * separator between the four forms — three of them, and nothing before the save button.
 *
 * §772 (the owner, 2026-10-14: «aici trebuie să setăm prin ce trimitem mail (Mailgun sau Gmail)») — and
 * under each form «Prin ce trimitem»: two native radios, never a toggle, the form's own default checked,
 * a road the deployment lacks greyed with the sentence and the link to its steps, Girl Zone's note, and a
 * footer that says the road is chosen per form.
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
// `RadioField` reads the recall (§NNN): none here, no refusal has been answered.
vi.mock("@/shared/forms/recall", () => ({ default: () => null, useRecall: () => ({ value: () => undefined }) }));
vi.mock("@/shared/ui/CheckboxField", () => ({ default: () => null }));
vi.mock("@/shared/ui/GlyphSubmitButton", () => ({ default: () => createElement("button", { type: "submit", "data-testid": "save" }) }));

const { default: FeedbackFormsPanel } = await import("@/modules/feedback/ui/FeedbackFormsPanel");

const state = {
  howItWent: { on: true, to: "a@example.org", via: "gmail" },
  suggestion: { on: false, to: null, via: "mailgun" },
  complaint: { on: false, to: null, via: "gmail" },
  safety: { on: false, to: null, via: "mailgun", name: null },
  updatedAt: null,
} as unknown as Parameters<typeof FeedbackFormsPanel>[0]["state"];

const BOTH = { gmail: true, mailgun: true };

async function html(roads = BOTH, mayEdit = true, safetyGmailDescribed = true, saved: typeof state = state): Promise<string> {
  const element = await FeedbackFormsPanel({ locale: "ro", state: saved, noticeDescribes: true, mayEdit, roads, safetyGmailDescribed });
  return renderToStaticMarkup(element).replace(/<style[\s\S]*?<\/style>/g, "");
}

/** One form's «Prin ce trimitem» group, from its fieldset to the next form's. */
function viaGroup(out: string, branch: string): string {
  const from = out.indexOf(`data-testid="feedback-via-${branch}"`);
  expect(from, branch).toBeGreaterThan(-1);
  return out.slice(from, out.indexOf("</fieldset>", from));
}

const radios = (group: string) => [...group.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(([tag]) => tag);

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
    // The four forms' own legends: the road's group has a legend of its own, a plain sentence (§772).
    const legends = [...out.matchAll(/<legend(?![^>]*data-via-legend)[^>]*>([\s\S]*?)<\/legend>/g)].map(([, inner]) => inner);
    expect(legends).toHaveLength(4);
    for (const inner of legends) {
      expect(inner).toMatch(/^<svg[^>]*aria-hidden="true"/);
      expect(inner.match(/<svg/g)).toHaveLength(1);
    }
  });
});

describe("§772 «Prin ce trimitem» under each form", () => {
  it("is a pair of native radios per form — Gmail, then Mailgun — in a fieldset with its own legend, never a toggle", async () => {
    const out = await html();
    for (const branch of FEEDBACK_BRANCHES) {
      const group = viaGroup(out, branch);
      expect(group, branch).toContain(`>${ro.Admin.emails.feedbackForms.via.legend}</legend>`);
      const tags = radios(group);
      expect(tags, branch).toHaveLength(2);
      expect(tags[0]).toContain(`name="${branch}Via"`);
      expect(tags[0]).toContain('value="gmail"');
      expect(tags[1]).toContain(`name="${branch}Via"`);
      expect(tags[1]).toContain('value="mailgun"');
      expect(group, branch).toContain(ro.Admin.emails.feedbackForms.via.gmail);
      expect(group, branch).not.toMatch(/role="switch"|type="checkbox"/);
    }
    expect(ro.Admin.emails.feedbackForms.via.gmail).toBe("Gmail-ul clubului („Scrie-ne”)");
  });

  it("checks what the form has saved: the defaults are Gmail for the three and Mailgun for Girl Zone (§676), a choice made is shown as made", async () => {
    const out = await html();
    const checked = (branch: string) => radios(viaGroup(out, branch)).filter((tag) => /\schecked(=|\s|\/|>)/.test(tag)).map((tag) => /value="(\w+)"/.exec(tag)?.[1]);
    expect(checked("howItWent")).toEqual(["gmail"]);
    expect(checked("suggestion")).toEqual(["mailgun"]);
    expect(checked("complaint")).toEqual(["gmail"]);
    expect(checked("safety")).toEqual(["mailgun"]);
  });

  it("greys Girl Zone's Gmail alone until the notice in force names {{feedbackSafetyGmail}}, with a link to «Texte legale» — the other forms' Gmail is never gated (§772)", async () => {
    const out = await html(BOTH, true, false);
    const [gmail, mailgun] = radios(viaGroup(out, "safety"));
    expect(gmail).toMatch(/\sdisabled(=|\s|\/|>)/);
    expect(mailgun).not.toMatch(/\sdisabled(=|\s|\/|>)/);
    const group = viaGroup(out, "safety");
    expect(group).toContain(ro.Admin.emails.feedbackForms.via.gmailNotice);
    expect(group).toContain('href="/ro/admin/legal"');
    expect(group).not.toContain(ro.Admin.emails.feedbackForms.via.gmailMissing);
    for (const branch of ["howItWent", "suggestion", "complaint"]) {
      expect(radios(viaGroup(out, branch))[0], branch).not.toMatch(/\sdisabled(=|\s|\/|>)/);
    }
    // Named in the notice: nothing greyed, nothing explained.
    expect(await html(BOTH, true, true)).not.toContain("feedback-via-safety-gmail-notice");
    // A saved Gmail stays checked while greyed, so the card shows what the form does (and a save keeps it).
    const saved = { ...state, safety: { ...state.safety, via: "gmail" } } as typeof state;
    const kept = viaGroup(await html(BOTH, true, false, saved), "safety");
    expect(radios(kept)[0]).toMatch(/\schecked(=|\s|\/|>)/);
    expect(radios(kept)[0]).toMatch(/\sdisabled(=|\s|\/|>)/);
  });

  it("greys a road the deployment lacks, says why in words, and links the steps in «Sarcini» — never by colour alone", async () => {
    const out = await html({ gmail: false, mailgun: true });
    for (const branch of FEEDBACK_BRANCHES) {
      const group = viaGroup(out, branch);
      const [gmail, mailgun] = radios(group);
      expect(gmail, branch).toMatch(/\sdisabled(=|\s|\/|>)/);
      expect(mailgun, branch).not.toMatch(/\sdisabled(=|\s|\/|>)/);
      expect(group, branch).toContain(ro.Admin.emails.feedbackForms.via.gmailMissing);
      expect(group, branch).toContain('href="/ro/admin/tasks#task-contactForm"');
      expect(group, branch).not.toContain(ro.Admin.emails.feedbackForms.via.mailgunMissing);
    }
    const noMailgun = await html({ gmail: true, mailgun: false });
    const group = viaGroup(noMailgun, "safety");
    expect(radios(group)[1]).toMatch(/\sdisabled(=|\s|\/|>)/);
    expect(group).toContain(ro.Admin.emails.feedbackForms.via.mailgunMissing);
    expect(group).toContain('href="/ro/admin/tasks#task-liveEmail"');
    // Both there: nothing greyed, nothing explained.
    const both = await html();
    expect(both).not.toMatch(/<input[^>]*type="radio"[^>]*\sdisabled/);
    expect(both).not.toContain("feedback-via-howItWent-gmail-missing");
  });

  it("keeps a greyed road checked when it is what was saved, so the card shows what the form does", async () => {
    const out = await html({ gmail: false, mailgun: true });
    const [gmail] = radios(viaGroup(out, "howItWent"));
    expect(gmail).toMatch(/\schecked(=|\s|\/|>)/);
    expect(gmail).toMatch(/\sdisabled(=|\s|\/|>)/);
  });

  it("gives Girl Zone, and only Girl Zone, the one-line note that Gmail means the club's mailbox readers see the message", async () => {
    const out = await html();
    expect(viaGroup(out, "safety")).toContain(ro.Admin.emails.feedbackForms.via.safetyNote);
    for (const branch of ["howItWent", "suggestion", "complaint"]) expect(viaGroup(out, branch)).not.toContain(ro.Admin.emails.feedbackForms.via.safetyNote);
    expect(ro.Admin.emails.feedbackForms.via.safetyNote).toMatch(/Gmail/);
    expect(ro.Admin.emails.feedbackForms.via.safetyNote).toMatch(/Mailgun/);
    expect(en.Admin.emails.feedbackForms.via.safetyNote).toMatch(/Gmail/);
  });

  it("says in the footer that the road is chosen per form, and no longer that Girl Zone leaves by Mailgun alone", () => {
    for (const [catalogue, per] of [[ro, /fiecare formular în parte/], [en, /for each form on its own/]] as const) {
      expect(catalogue.Admin.emails.feedbackForms.roads).toMatch(per);
      expect(catalogue.Admin.emails.feedbackForms.roads).toMatch(/Gmail/);
      expect(catalogue.Admin.emails.feedbackForms.roads).toMatch(/Mailgun/);
      expect(JSON.stringify(catalogue.Admin.emails.feedbackForms)).not.toMatch(/Girl Zone doar prin Mailgun|Girl Zone only through Mailgun|Pleacă doar prin Mailgun|only through Mailgun/);
    }
    return html().then((out) => expect(out).toContain(ro.Admin.emails.feedbackForms.roads));
  });

  it("is read-only for anybody but the Administrator: the road shown as a word, no radio", async () => {
    const out = await html(BOTH, false);
    expect(radios(out)).toHaveLength(0);
    expect(out).toContain(`${ro.Admin.emails.feedbackForms.branches.howItWent}: ${ro.Admin.emails.feedbackForms.stateOn} · ${ro.Admin.emails.feedbackForms.via.stateGmail}`);
    expect(out).toContain(ro.Admin.emails.feedbackForms.via.stateMailgun);
  });

  it("has the same words in both catalogues", () => {
    expect(Object.keys(en.Admin.emails.feedbackForms.via).sort()).toEqual(Object.keys(ro.Admin.emails.feedbackForms.via).sort());
    for (const catalogue of [ro, en]) for (const [key, value] of Object.entries(catalogue.Admin.emails.feedbackForms.via)) expect(value.length, key).toBeGreaterThan(0);
  });
});
