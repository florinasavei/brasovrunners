import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { emailCopyPrefill } from "@/modules/notifications/email-copy-fields";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — the «Emailuri» editor of the two messages whose default words follow the event's waiting-list settings
 * (`WAITLIST_JOINED`: who gives the places; `WAITLIST_SPOT_OFFER`: what happens to the place after its deadline) says,
 * under the box, that a text saved there replaces those words whatever the settings are. Every other message's editor
 * says nothing of it. The real catalogues; the form island and the rich-text editor are stubbed.
 */
const ui = vi.hoisted(() => ({ locale: "ro" as "ro" | "en" }));

vi.mock("@/shared/feedback/email-roads-request", () => ({
  emailRoadsForThisRequest: async () => ({
    groups: { links: "mailgun", confirmations: "mailgun", reminders: "mailgun", announcements: "mailgun", club: "gmail", newsletter: "mailgun" },
    gmail: false,
  }),
}));
vi.mock("@/app/[locale]/admin/settings/emails/actions", () => ({ updateEmailCopyAction: async () => undefined }));
vi.mock("@/modules/content/rich-text/ui/RichTextEditor", () => ({ default: () => null }));
vi.mock("@/shared/forms/ActionForm", () => ({ default: ({ children }: { children: ReactNode }) => createElement("form", null, children) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    getTranslations: async (arg: string | { namespace: string }) =>
      createTranslator({ locale: ui.locale, messages: catalogues[ui.locale], namespace: (typeof arg === "string" ? arg : arg.namespace) as "Admin" }),
    getLocale: async () => ui.locale,
  };
});

const { default: EmailCopyEditor } = await import("@/modules/notifications/ui/EmailCopyEditor");

async function render(messageType: EmailMessageType, locale: "ro" | "en"): Promise<string> {
  ui.locale = locale;
  const element = (await EmailCopyEditor({ locale, emailLocale: locale, messageType, written: null, shipped: emailCopyPrefill(messageType, locale), samples: [] })) as ReactElement;
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

describe("§NNN «Emailuri»: a saved text replaces the words that follow the waiting-list settings", () => {
  it("says so under the box of WAITLIST_JOINED and WAITLIST_SPOT_OFFER, in both languages", async () => {
    for (const messageType of ["WAITLIST_JOINED", "WAITLIST_SPOT_OFFER"] as const) {
      for (const [locale, words] of [["ro", ro], ["en", en]] as const) {
        const html = await render(messageType, locale);
        expect(html, `${messageType} ${locale}`).toContain('data-testid="email-copy-follows-settings"');
        expect(html).toContain(words.Admin.emails.copy.followsSettings);
      }
    }
  });

  it("names the two settings by their labels in the event's editor, and says nothing of them on another message", async () => {
    for (const words of [ro, en]) {
      expect(words.Admin.emails.copy.followsSettings).toContain(`«${words.Admin.editor.waitlistAutoOffer}»`);
      expect(words.Admin.emails.copy.followsSettings).toContain(`«${words.Admin.editor.freePlacesByOfferOnly}»`);
    }
    expect(await render("REGISTRATION_CONFIRMED", "ro")).not.toContain('data-testid="email-copy-follows-settings"');
  });
});
