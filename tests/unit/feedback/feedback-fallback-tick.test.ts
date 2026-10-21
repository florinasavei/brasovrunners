import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fallbackAllowedFor, DEFAULT_FEEDBACK_SETTINGS, type FeedbackSettings, sendsToItself } from "@/modules/feedback/domain/branches";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §778 (amending §772) — «Dacă Mailgun pică, trimite prin Gmail-ul clubului»: Girl Zone's own tick, a real checkbox, off by default,
 * with the note that the club's mailbox readers see her message; greyed with its reason while Gmail is missing or the notice in
 * force does not say her messages may leave by it. And the card's warning when a form's recipient is the very Gmail account that
 * sends — Gmail may keep such a message in Sent only. And the rule itself: which messages the other road may carry.
 */
// The dialogs' road line (§841) reads the club's roads once per request: no database here.
vi.mock("@/shared/feedback/email-roads-request", () => ({ emailRoadsForThisRequest: async () => ({ groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" }, gmail: false }) }));
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
vi.mock("@/shared/forms/recall", () => ({ default: () => null, useRecall: () => ({ value: () => undefined }) }));
// A box that shows what the panel handed it: its name, whether it is ticked or greyed, and its help line.
vi.mock("@/shared/ui/CheckboxField", () => ({
  default: ({ name, defaultChecked, disabled, help, children }: { name: string; defaultChecked?: boolean; disabled?: boolean; help?: string; children: ReactNode }) =>
    createElement("label", { "data-box": name, "data-checked": String(Boolean(defaultChecked)), "data-disabled": String(Boolean(disabled)) }, children, help ? createElement("small", null, help) : null),
}));
vi.mock("@/shared/ui/GlyphSubmitButton", () => ({ default: () => createElement("button", { type: "submit" }) }));
vi.mock("@/shared/ui/RadioField", () => ({ default: ({ children }: { children: ReactNode }) => createElement("span", null, children) }));

const { default: FeedbackFormsPanel } = await import("@/modules/feedback/ui/FeedbackFormsPanel");

const state = (over: Partial<FeedbackSettings["safety"]> = {}, howTo: string | null = "club@example.org") =>
  ({
    ...DEFAULT_FEEDBACK_SETTINGS,
    howItWent: { on: true, to: howTo, via: "gmail" },
    safety: { ...DEFAULT_FEEDBACK_SETTINGS.safety, on: true, to: "safety@example.org", name: "Maria", ...over },
    updatedAt: null,
  }) as unknown as Parameters<typeof FeedbackFormsPanel>[0]["state"];

async function html(saved: ReturnType<typeof state>, over: { gmail?: boolean; described?: boolean; account?: string | null } = {}): Promise<string> {
  const element = await FeedbackFormsPanel({
    locale: "ro",
    state: saved,
    noticeDescribes: true,
    mayEdit: true,
    roads: { gmail: over.gmail ?? true, mailgun: true },
    safetyGmailDescribed: over.described ?? true,
    gmailAccount: over.account ?? null,
  });
  return renderToStaticMarkup(element).replace(/<style[\s\S]*?<\/style>/g, "");
}

describe("§778 Girl Zone's «dacă Mailgun pică» tick", () => {
  it("is a real checkbox in Girl Zone's group only, off by default, with the readers' note", async () => {
    const out = await html(state());
    expect(out.match(/data-box="safetyFallbackToGmail"/g)).toHaveLength(1);
    expect(out).toMatch(/data-box="safetyFallbackToGmail" data-checked="false" data-disabled="false"/);
    expect(out).toContain(ro.Admin.emails.feedbackForms.via.fallback);
    // The words of the box, and the note that whoever reads the club's mailbox sees it.
    expect(ro.Admin.emails.feedbackForms.via.fallbackHelp).toContain("cei care o citesc");
    expect(en.Admin.emails.feedbackForms.via.fallbackHelp).toContain("whoever reads");
    expect(out).toContain(ro.Admin.emails.feedbackForms.via.fallbackHelp);
    // It sits inside Girl Zone's branch, not beside the other three.
    const safety = out.indexOf('data-testid="feedback-branch-safety"');
    expect(out.indexOf('data-box="safetyFallbackToGmail"')).toBeGreaterThan(safety);
  });

  it("is ticked when saved ticked", async () => {
    expect(await html(state({ fallbackToGmail: true }))).toMatch(/data-box="safetyFallbackToGmail" data-checked="true"/);
  });

  it("is greyed while the notice in force does not say her messages may leave by Gmail — with the reason and a link to the texts — and keeps what is saved in a hidden field", async () => {
    const out = await html(state({ fallbackToGmail: true }), { described: false });
    expect(out).toMatch(/data-box="safetyFallbackToGmail"[^>]*data-disabled="true"/);
    expect(out).toContain(ro.Admin.emails.feedbackForms.via.fallbackNotice);
    expect(out).toContain('data-testid="feedback-fallback-notice"');
    // A greyed box posts nothing; the saved tick travels so a save does not turn it off by omission.
    expect(out).toMatch(/<input type="hidden" name="safetyFallbackToGmail" value="on"\/>/);
    // Not saved ticked: nothing to carry.
    expect(await html(state({ fallbackToGmail: false }), { described: false })).not.toMatch(/type="hidden" name="safetyFallbackToGmail"/);
  });

  it("is greyed too where Gmail is not on this deployment, with the steps", async () => {
    const out = await html(state(), { gmail: false });
    expect(out).toMatch(/data-box="safetyFallbackToGmail"[^>]*data-disabled="true"/);
    expect(out).toContain('data-testid="feedback-fallback-missing"');
  });

  it("has its words in both languages, each sentence short", () => {
    for (const catalogue of [ro, en]) {
      const via = catalogue.Admin.emails.feedbackForms.via;
      for (const text of [via.fallback, via.fallbackHelp, via.fallbackNotice, catalogue.Admin.emails.feedbackForms.selfRecipient, catalogue.Admin.emails.feedbackForms.roads]) {
        expect(text.length).toBeGreaterThan(10);
        for (const sentence of text.split(/(?<=[.!?])\s+/)) expect(sentence.length, sentence).toBeLessThanOrEqual(260);
      }
    }
  });
});

describe("§778 a form whose recipient is the sending Gmail account", () => {
  it("says so beside the box, by the canonicalizer — a dotted or tagged spelling is the same inbox — and only for a form that leaves by Gmail", async () => {
    const out = await html(state({}, "Club.Runners+site@gmail.com"), { account: "clubrunners@gmail.com" });
    expect(out).toContain('data-testid="feedback-self-howItWent"');
    expect(out).toContain(ro.Admin.emails.feedbackForms.selfRecipient);
    expect(out.match(/data-testid="feedback-self-/g)).toHaveLength(1);
    // The same address on a form that leaves by Mailgun is no warning: Mailgun sends from its own domain.
    const mailgun = { ...state({}, "clubrunners@gmail.com"), howItWent: { on: true, to: "clubrunners@gmail.com", via: "mailgun" } } as unknown as ReturnType<typeof state>;
    expect(await html(mailgun, { account: "clubrunners@gmail.com" })).not.toContain("feedback-self-");
    // No account on this deployment, no warning.
    expect(await html(state({}, "club@example.org"), { account: null })).not.toContain("feedback-self-");
  });

  it("compares inboxes, never raw strings", () => {
    expect(sendsToItself("a.b@gmail.com", "ab@gmail.com")).toBe(true);
    expect(sendsToItself("ab+x@gmail.com", "ab@gmail.com")).toBe(true);
    expect(sendsToItself("other@example.org", "ab@gmail.com")).toBe(false);
    expect(sendsToItself(null, "ab@gmail.com")).toBe(false);
    expect(sendsToItself("ab@gmail.com", null)).toBe(false);
    expect(sendsToItself("not an address", "ab@gmail.com")).toBe(false);
  });
});

describe("§778 which messages the other road may carry when the chosen one is down", () => {
  const settings = (over: Partial<FeedbackSettings["safety"]>): FeedbackSettings => ({ ...DEFAULT_FEEDBACK_SETTINGS, safety: { ...DEFAULT_FEEDBACK_SETTINGS.safety, ...over } });

  it("every message for the club's mailbox, by default: both roads are named in the notice for it", () => {
    expect(fallbackAllowedFor(settings({}), "club", false)).toBe(true);
    expect(fallbackAllowedFor(settings({}), "club", true)).toBe(true);
  });

  it("a message for Girl Zone's person goes by Gmail only with the tick AND the notice's words", () => {
    expect(fallbackAllowedFor(settings({ via: "mailgun", fallbackToGmail: false }), "person", true)).toBe(false);
    expect(fallbackAllowedFor(settings({ via: "mailgun", fallbackToGmail: true }), "person", false)).toBe(false);
    expect(fallbackAllowedFor(settings({ via: "mailgun", fallbackToGmail: true }), "person", true)).toBe(true);
  });

  it("and Mailgun may take over from the Gmail the club chose for her: Mailgun is the road the notice promised her", () => {
    expect(fallbackAllowedFor(settings({ via: "gmail", fallbackToGmail: false }), "person", true)).toBe(true);
  });
});
