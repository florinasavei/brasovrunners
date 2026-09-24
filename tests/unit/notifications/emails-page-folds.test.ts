import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { NEVER_QUEUED_MESSAGE_TYPES } from "@/modules/notifications/domain/never-queued";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import ParticipantEmailsPanel, { type ParticipantEmailCard } from "@/modules/notifications/ui/ParticipantEmailsPanel";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §336 on `/admin/emails` (the owner, 2026-09-23): "the first card should also
 * be an accordion", "'Cine primește mesajele de contact' should be closed by default", and
 * "'Emailurile trimise participanților' should be a master card with smaller cards within".
 *
 * The card of cards is a Server Component with no data of its own, so it is rendered here as the
 * server sends it. The panels around it read the database and the session and are async; for
 * those the thing to pin is what they hand `Panel` — the same approach `boxed-disclosure.test.ts`
 * takes — and `shared/fold.test.ts` proves what `Panel` does with it.
 */
const ROOT = process.cwd();
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
const markup = (html: string): string => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

const TYPES = emailMessageType.enumValues as readonly EmailMessageType[];

/** The page fills the club's deadlines into the when-lines (§NNN); these are the unset ones' words. */
const DEADLINE_WORDS: Record<string, string> = { confirmation: "48 de ore", hold: "30 de minute", offer: "24 de ore", reminder: "2 zile" };
const filled = (template: string) => template.replace(/\{(\w+)\}/g, (whole, name: string) => DEADLINE_WORDS[name] ?? whole);

function card(type: EmailMessageType, justSaved = false, neverSent = false): ParticipantEmailCard {
  return {
    type,
    name: ro.Admin.emails.types[type],
    whenShort: filled(ro.Admin.emails.whenShort[type]),
    ...(neverSent ? { neverSent: ro.Admin.emails.neverSent } : {}),
    when: filled(ro.Admin.emails.when[type]),
    subjectLine: `Subiect: ${type}`,
    html: `<p>${type}</p>`,
    justSaved,
  };
}

function render(messages: ParticipantEmailCard[], openWhen?: FoldOpenWhen): string {
  return markup(
    renderToStaticMarkup(
      createElement(ParticipantEmailsPanel, {
        title: ro.Admin.emails.title,
        intro: ro.Admin.emails.intro,
        aside: `${messages.length} mesaje · Română`,
        languageLabel: ro.Admin.emails.langLabel,
        languages: [
          { href: "/ro/admin/emails?lang=ro#participant-emails", label: "Română", active: true },
          { href: "/ro/admin/emails?lang=en#participant-emails", label: "English" },
        ],
        messages,
        openWhen,
      }),
    ),
  );
}

/** Every `<details …>` opening tag, in document order. */
const foldTags = (html: string): string[] => html.match(/<details[^>]*>/g) ?? [];
const isOpen = (tag: string): boolean => /\sopen(=""|\s|>)/.test(tag);

describe("§336 the emails participants receive: one card of cards", () => {
  it("is one closed fold holding one closed fold per message type", () => {
    const html = render(TYPES.map((type) => card(type)));
    const folds = foldTags(html);
    expect(folds).toHaveLength(TYPES.length + 1);
    expect(folds[0]).toContain('id="participant-emails"');
    expect(folds.every((tag) => !isOpen(tag))).toBe(true);
    // Every inner card is inside the outer one: the outer closes last.
    expect(html.startsWith("<details")).toBe(true);
    expect(html.endsWith("</details>")).toBe(true);
    for (const type of TYPES) expect(html).toContain(`id="email-${type}"`);
  });

  it("titles each inner card with the message's name and when it goes out, as an h3 under the card's h2", () => {
    const html = render([card("EVENT_REMINDER")]);
    expect(html).toMatch(/<summary[^>]*><h2[^>]*>Emailurile trimise participanților<span[^>]*>1 mesaje · Română<\/span><\/h2><\/summary>/);
    expect(html).toMatch(
      /<summary[^>]*><h3[^>]*>Reminderul dinaintea startului<span[^>]*>cu 2 zile înainte de start<\/span><\/h3><\/summary>/,
    );
    // The body: the full sentence, the subject, the preview.
    expect(html).toContain(filled(ro.Admin.emails.when.EVENT_REMINDER));
    expect(html).toContain("Subiect: EVENT_REMINDER");
    expect(html).toMatch(/<iframe[^>]*sandbox=""[^>]*title="Reminderul dinaintea startului"/);
  });

  it("puts the language switch inside the card, first, under the line that says what it switches", () => {
    const html = render([card("VERIFY_REGISTRATION_EMAIL")]);
    const outerSummaryEnd = html.indexOf("</summary>");
    const label = html.indexOf(ro.Admin.emails.langLabel);
    const nav = html.indexOf("<nav");
    const firstInner = html.indexOf('id="email-VERIFY_REGISTRATION_EMAIL"');
    expect(outerSummaryEnd).toBeGreaterThan(0);
    expect(label).toBeGreaterThan(outerSummaryEnd);
    expect(nav).toBeGreaterThan(label);
    expect(firstInner).toBeGreaterThan(nav);
    expect(html).toContain('href="/ro/admin/emails?lang=en#participant-emails"');
    expect(html).toMatch(/aria-current="page"[^>]*>Română|>Română<\/a>/);
  });

  it("opens the card, and only the message whose words were just saved", () => {
    const html = render([card("VERIFY_REGISTRATION_EMAIL"), card("EVENT_REMINDER", true), card("EVENT_THANKS")], { saved: true });
    const folds = foldTags(html);
    expect(folds.map(isOpen)).toEqual([true, false, true, false]);
  });

  it("opens the card while a language is chosen in it, and leaves the messages closed", () => {
    const folds = foldTags(render([card("VERIFY_REGISTRATION_EMAIL"), card("EVENT_REMINDER")], { inUse: true }));
    expect(folds.map(isOpen)).toEqual([true, false, false]);
  });

  it("has a short 'when' for every message type, in both languages", () => {
    for (const type of TYPES) {
      expect(ro.Admin.emails.whenShort[type], type).toBeTruthy();
      expect(en.Admin.emails.whenShort[type], type).toBeTruthy();
    }
  });

  /**
   * §331 × §336: the two messages the event notices added are cards like every other — one inner
   * fold each, with the short "when" in the closed summary and the full sentence, the subject and
   * the preview inside — and the three types nothing queues any more say so on the closed card.
   */
  it("holds a card for each of the event notices' two messages, like the others", () => {
    expect(TYPES).toEqual(expect.arrayContaining(["EVENT_UPDATE_NOTICE", "EVENT_CANCELLED"]));
    const html = render(TYPES.map((type) => card(type)));
    expect(foldTags(html)).toHaveLength(TYPES.length + 1);
    for (const type of ["EVENT_UPDATE_NOTICE", "EVENT_CANCELLED"] as const) {
      expect(html).toContain(`id="email-${type}"`);
      expect(html).toMatch(
        new RegExp(`<h3[^>]*>${escape(ro.Admin.emails.types[type])}<span[^>]*>${escape(ro.Admin.emails.whenShort[type])}</span></h3>`),
      );
      expect(html).toContain(filled(ro.Admin.emails.when[type]));
      expect(html).toContain(`Subiect: ${type}`);
      expect(html).toMatch(new RegExp(`<iframe[^>]*title="${escape(ro.Admin.emails.types[type])}"`));
    }
  });

  it("says 'not sent any more' on the closed card of exactly the three types nothing queues", () => {
    const html = render(TYPES.map((type) => card(type, false, NEVER_QUEUED_MESSAGE_TYPES.has(type))));
    expect(html.match(/data-testid="participant-email-never-sent"/g) ?? []).toHaveLength(NEVER_QUEUED_MESSAGE_TYPES.size);
    for (const type of NEVER_QUEUED_MESSAGE_TYPES) {
      const start = html.indexOf(`id="email-${type}"`);
      const summary = html.slice(start, html.indexOf("</summary>", start));
      expect(summary).toContain(ro.Admin.emails.neverSent);
      expect(summary).toContain(filled(ro.Admin.emails.whenShort[type]));
    }
    const reminder = html.indexOf('id="email-EVENT_REMINDER"');
    expect(html.slice(reminder, html.indexOf("</summary>", reminder))).not.toContain(ro.Admin.emails.neverSent);
  });
});

/** A catalogue string as a literal inside a pattern. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("§336 the page hands every message to the card, and the panels fold", () => {
  const page = read("src/app/[locale]/admin/emails/page.tsx");

  it("renders the card of cards from every message type, with the language switch inside it", () => {
    expect(page).toContain("<ParticipantEmailsPanel");
    // Every type from the enum, the three nothing queues any more last and said so (§331).
    expect(page).toMatch(/const types = \[\s*\.\.\.\(emailMessageType\.enumValues/);
    expect(page).toMatch(/filter\(\(type\) => !NEVER_QUEUED\.has\(type\)\)[\s\S]*?filter\(\(type\) => NEVER_QUEUED\.has\(type\)\)/);
    expect(page).toMatch(/NEVER_QUEUED\.has\(messageType\) \? \{ neverSent: t\("emails\.neverSent"\) \}/);
    expect(page).toMatch(/messages=\{types\.map\(/);
    expect(page).toMatch(/languages=\{routing\.locales\.map\(/);
    // No preview or switch is drawn on the page outside the card any more.
    expect(page).not.toContain('component="details"');
    expect(page).not.toContain("<SubNav");
    expect(page).toMatch(/openWhen=\{\{ saved: copySaved, inUse: lang !== undefined \}\}/);
  });

  it("makes the Mailgun plan a fold, with the plan and the day's figure in its summary", () => {
    const panel = read("src/modules/notifications/ui/EmailPlanPanel.tsx");
    const tag = panel.slice(panel.indexOf("<Panel"), panel.indexOf(">\n", panel.indexOf("<Panel")) + 1 || undefined);
    expect(tag).toMatch(/\bcollapsible\b/);
    expect(tag).toMatch(/aside=\{t\(`emails\.plan\.aside\.\$\{volume\.period\}`/);
    expect(tag).toContain('id="email-plan"');
    expect(ro.Admin.emails.plan.aside.day).toBe("Planul {plan} · {sent} din {allowance} azi");
  });

  it("keeps the contact recipients closed unless their own save just landed", () => {
    const panel = read("src/modules/contact/ui/ContactRecipientsPanel.tsx");
    expect(panel).toMatch(/<Panel[\s\S]*?\bcollapsible\b[\s\S]*?openWhen=\{openWhen\}[\s\S]*?id="contact-recipients"/);
    // The page's only reason is the save — no warning, no default — so it arrives closed.
    expect(page).toMatch(/<ContactRecipientsPanel[\s\S]*?openWhen=\{\{ saved: saved === "contactRecipients" \}\}\s*\/>/);
    expect(panel).toMatch(/aside=\{t\("emails\.contacts\.aside"/);
  });

  it("names where each save lands, so its own panel opens and no other", () => {
    expect(page).toContain('openWhen={{ saved: saved === "emailPlan" }}');
    expect(page).toContain('openWhen={{ saved: saved === "outboxSent", refused: Boolean(error) }}');
    expect(page).toContain('openWhen={{ saved: saved === "clubNotices" }}');
    // The words' save names its message on the way back, so that message's card opens.
    expect(read("src/app/[locale]/admin/emails/actions.ts")).toMatch(/&message=\$\{messageType\}#admin-alert/);
  });
});
