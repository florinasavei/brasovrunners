import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultFeedbackSettings, FEEDBACK_BRANCHES, RECOMMENDED_VIA } from "@/modules/feedback/domain/branches";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-070-04, `DECISIONS.md` §NNN (amends §772; the owner, 2026-10-15: «ar trebui în configs să scriu (recomandat)») — Mailgun is
 * the recommended road: marked as such on the choice, one line of why once for the card, a quiet caption under a form left on Gmail,
 * and the Gmail choice says plainly that a copy stays in the club's «Trimise». The same words, from the same component, on
 * «Scrie-ne»'s card.
 */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/ro.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: messages as typeof messages, namespace: namespace as "Admin" }),
    getLocale: async () => "ro",
  };
});
vi.mock("@/app/[locale]/admin/pages/contact/actions", () => ({ updateFeedbackFormsAction: async () => undefined, updateContactRecipientsAction: async () => undefined }));
vi.mock("@/shared/forms/refusal-messages", () => ({ refusalMessages: async () => ({}) }));
vi.mock("@/shared/forms/ActionForm", () => ({ default: ({ children }: { children: ReactNode }) => createElement("form", null, children) }));
vi.mock("@/shared/forms/recall", () => ({ default: () => null, useRecall: () => ({ value: () => undefined }) }));
vi.mock("@/shared/ui/CheckboxField", () => ({ default: () => null }));
vi.mock("@/shared/ui/GlyphSubmitButton", () => ({ default: () => createElement("button", { type: "submit", "data-testid": "save" }) }));

const { default: FeedbackFormsPanel } = await import("@/modules/feedback/ui/FeedbackFormsPanel");
const { default: ContactRecipientsPanel } = await import("@/modules/contact/ui/ContactRecipientsPanel");

const WHY_RO = "Pleacă de pe domeniul clubului, cu adresa persoanei ca Reply-To, fără nicio copie în căsuța clubului; Gmail rămâne drum de rezervă.";
const WHY_EN = "Sent from the club's own domain, with the person's address as Reply-To and no copy in the club's mailbox; Gmail stays as the backup road.";
const BOTH = { gmail: true, mailgun: true };
const GMAIL_ONLY = { gmail: true, mailgun: false };

type FormsState = Parameters<typeof FeedbackFormsPanel>[0]["state"];

const state = {
  howItWent: { on: true, to: "a@example.org", via: "gmail" },
  suggestion: { on: false, to: null, via: "mailgun" },
  complaint: { on: false, to: null, via: "gmail" },
  safety: { on: false, to: null, via: "mailgun", name: null },
  updatedAt: null,
} as unknown as FormsState;

async function formsHtml(roads = BOTH, saved: FormsState = state): Promise<string> {
  const element = await FeedbackFormsPanel({ locale: "ro", state: saved, noticeDescribes: true, mayEdit: true, roads, safetyGmailDescribed: true });
  return renderToStaticMarkup(element).replace(/<style[\s\S]*?<\/style>/g, "");
}

async function contactHtml(via: "gmail" | "mailgun", roads = BOTH, mayEdit = true): Promise<string> {
  const element = await ContactRecipientsPanel({
    locale: "ro",
    recipients: { to: ["club@example.org"], cc: [], bcc: [], holdBackSuspected: false, updatedAt: null },
    resolved: { to: ["club@example.org"], cc: [], bcc: [], source: "setting" },
    mayEdit,
    heldBack: 0,
    via,
    roads,
  });
  return renderToStaticMarkup(element).replace(/<style[\s\S]*?<\/style>/g, "");
}

function group(out: string, testId: string): string {
  const from = out.indexOf(`data-testid="${testId}"`);
  expect(from, testId).toBeGreaterThan(-1);
  return out.slice(from, out.indexOf("</fieldset>", from));
}
const radios = (html: string) => [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(([tag]) => tag);
const checkedOf = (html: string) => radios(html).filter((tag) => /\schecked(=|\s|\/|>)/.test(tag)).map((tag) => /value="(\w+)"/.exec(tag)?.[1]);
const escape = (sentence: string) => sentence.replace(/'/g, "&#x27;");

describe("§NNN Mailgun is the recommended road", () => {
  it("is the platform's recommendation, named once in code", () => {
    expect(RECOMMENDED_VIA).toBe("mailgun");
  });

  it("reads «Mailgun (recomandat)» and «Mailgun (recommended)» on the choice, under every form", async () => {
    expect(ro.Admin.emails.feedbackForms.via.mailgun).toBe("Mailgun (recomandat)");
    expect(en.Admin.emails.feedbackForms.via.mailgun).toBe("Mailgun (recommended)");
    const out = await formsHtml();
    for (const branch of FEEDBACK_BRANCHES) expect(group(out, `feedback-via-${branch}`), branch).toContain("Mailgun (recomandat)");
  });

  it("says why once for the card — never once per form — in both languages, in a sentence short enough to read in one breath", async () => {
    expect(ro.Admin.emails.feedbackForms.via.why).toBe(WHY_RO);
    expect(en.Admin.emails.feedbackForms.via.why).toBe(WHY_EN);
    for (const sentence of [WHY_RO, WHY_EN]) expect(sentence.length).toBeLessThanOrEqual(200);
    const out = await formsHtml();
    expect(out.match(/data-testid="feedback-via-why"/g)).toHaveLength(1);
    expect(out.split(escape(WHY_RO)).length - 1).toBe(1);
    // Under the four pairs, before the save button.
    expect(out.indexOf('data-testid="feedback-via-why"')).toBeGreaterThan(out.lastIndexOf('data-testid="feedback-branch-safety"'));
    expect(out.indexOf('data-testid="feedback-via-why"')).toBeLessThan(out.indexOf('data-testid="save"'));
  });

  it("says plainly on the Gmail choice that a copy stays in the club's «Trimise» folder, in both languages", () => {
    expect(ro.Admin.emails.feedbackForms.via.gmailHint).toContain("o copie a mesajului rămâne în folderul „Trimise” al clubului");
    expect(en.Admin.emails.feedbackForms.via.gmailHint).toContain("a copy of the message stays in the club's “Sent” folder");
  });

  it("puts the quiet caption «Prin Gmail rămâne o copie în căsuța clubului.» next to a form left on Gmail, and only there", async () => {
    expect(ro.Admin.emails.feedbackForms.via.gmailCopy).toBe("Prin Gmail rămâne o copie în căsuța clubului.");
    expect(en.Admin.emails.feedbackForms.via.gmailCopy).toBe("Through Gmail, a copy stays in the club's mailbox.");
    const caption = ro.Admin.emails.feedbackForms.via.gmailCopy;
    const out = await formsHtml();
    // The state: «Cum a fost» and «O reclamație» on Gmail, «O sugestie» and Girl Zone on Mailgun.
    expect(group(out, "feedback-via-howItWent")).toContain(caption);
    expect(group(out, "feedback-via-complaint")).toContain(caption);
    expect(group(out, "feedback-via-suggestion")).not.toContain(caption);
    expect(group(out, "feedback-via-safety")).not.toContain(caption);
    // Girl Zone has her own, stronger note (§772): a caption would say it twice.
    const onGmail = { ...state, safety: { ...state.safety, via: "gmail" } } as FormsState;
    const safety = group(await formsHtml(BOTH, onGmail), "feedback-via-safety");
    expect(safety).not.toContain(caption);
    expect(safety).toContain(ro.Admin.emails.feedbackForms.via.safetyNote);
    // A form moved to Mailgun loses the caption.
    const moved = { ...state, howItWent: { ...state.howItWent, via: "mailgun" } } as FormsState;
    expect(group(await formsHtml(BOTH, moved), "feedback-via-howItWent")).not.toContain(caption);
  });

  it("shows a form with no saved road on Mailgun where it transmits and on Gmail where it does not, Girl Zone on Mailgun either way", async () => {
    const fresh = { ...defaultFeedbackSettings(BOTH), updatedAt: null } as unknown as FormsState;
    const withMailgun = await formsHtml(BOTH, fresh);
    for (const branch of FEEDBACK_BRANCHES) expect(checkedOf(group(withMailgun, `feedback-via-${branch}`)), branch).toEqual(["mailgun"]);
    const gmailFresh = { ...defaultFeedbackSettings(GMAIL_ONLY), updatedAt: null } as unknown as FormsState;
    const withoutMailgun = await formsHtml(GMAIL_ONLY, gmailFresh);
    expect(FEEDBACK_BRANCHES.map((branch) => checkedOf(group(withoutMailgun, `feedback-via-${branch}`))[0])).toEqual(["gmail", "gmail", "gmail", "mailgun"]);
    // What was saved is what the state says, whatever the default now is: a saved Gmail stays Gmail with Mailgun transmitting.
    expect(checkedOf(group(await formsHtml(BOTH), "feedback-via-howItWent"))).toEqual(["gmail"]);
  });
});

describe("§NNN «Scrie-ne» has the same pair, the same words and the same default", () => {
  it("draws «Prin ce trimitem» once, in «Cine primește mesajele de contact», Mailgun recommended, with the one line of why", async () => {
    const out = await contactHtml("mailgun");
    const pair = group(out, "contact-via");
    expect(pair).toContain(`>${ro.Admin.emails.feedbackForms.via.legend}</legend>`);
    const tags = radios(pair);
    expect(tags).toHaveLength(2);
    expect(tags[0]).toContain('name="via"');
    expect(tags[0]).toContain('value="gmail"');
    expect(tags[1]).toContain('value="mailgun"');
    expect(pair).toContain("Mailgun (recomandat)");
    expect(pair).not.toMatch(/role="switch"|type="checkbox"/);
    expect(out.match(/data-testid="contact-via-why"/g)).toHaveLength(1);
    expect(out).toContain(escape(WHY_RO));
  });

  it("checks the road it is given — the saved one, else the default — and shows the caption only on Gmail", async () => {
    const mailgun = await contactHtml("mailgun");
    expect(checkedOf(group(mailgun, "contact-via"))).toEqual(["mailgun"]);
    expect(mailgun).not.toContain("contact-via-gmail-copy");
    const gmail = await contactHtml("gmail");
    expect(checkedOf(group(gmail, "contact-via"))).toEqual(["gmail"]);
    expect(group(gmail, "contact-via")).toContain(ro.Admin.emails.feedbackForms.via.gmailCopy);
  });

  it("greys a road the deployment lacks, with the sentence and the link to its steps, and keeps a saved one checked", async () => {
    const out = await contactHtml("gmail", { gmail: false, mailgun: true });
    const pair = group(out, "contact-via");
    const [gmail, mailgun] = radios(pair);
    expect(gmail).toMatch(/\sdisabled(=|\s|\/|>)/);
    expect(gmail).toMatch(/\schecked(=|\s|\/|>)/);
    expect(mailgun).not.toMatch(/\sdisabled(=|\s|\/|>)/);
    expect(pair).toContain(ro.Admin.emails.feedbackForms.via.gmailMissing);
    expect(pair).toContain('href="/ro/admin/tasks#task-contactForm"');
    const noMailgun = group(await contactHtml("gmail", GMAIL_ONLY), "contact-via");
    expect(radios(noMailgun)[1]).toMatch(/\sdisabled(=|\s|\/|>)/);
    expect(noMailgun).toContain('href="/ro/admin/tasks#task-liveEmail"');
  });

  it("is read-only for anybody but the Administrator: the road as a word, no radio", async () => {
    const out = await contactHtml("mailgun", BOTH, false);
    expect(radios(out)).toHaveLength(0);
    expect(out).toContain(`${ro.Admin.emails.feedbackForms.via.legend}: ${ro.Admin.emails.feedbackForms.via.stateMailgun}`);
  });
});
