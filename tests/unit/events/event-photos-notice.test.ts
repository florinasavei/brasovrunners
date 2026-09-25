import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The photographs amendment's item 6 (`fix/legal-texts-prod-ready`,
 * `src/modules/legal-documents/templates/privacy-notice.ts` TODO(legal-code)): every event page —
 * a race and a group run alike — carries a line about photographs, with a way to ask for one to
 * be taken down and a link to the privacy notice that describes the processing (§323).
 */
let currentLocale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: currentLocale, messages: currentLocale === "ro" ? ro : en, namespace: namespace as "Event" }),
  };
});

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const { default: EventPhotosNotice } = await import("@/modules/events/ui/EventPhotosNotice");

afterEach(() => {
  currentLocale = "ro";
});

describe("EventPhotosNotice", () => {
  it("names a way to object and links the privacy notice — Romanian", async () => {
    const html = renderToStaticMarkup(await EventPhotosNotice());
    expect(html).toContain("fotografii");
    // The contact page: the way to ask for a photo to be taken down.
    expect(html).toContain('href="/contact"');
    // The privacy notice, opened in a new tab like the registration form's own links (§197).
    expect(html).toContain('href="/legal/privacy"');
    expect(html).toContain('target="_blank"');
  });

  it("names a way to object and links the privacy notice — English", async () => {
    currentLocale = "en";
    const html = renderToStaticMarkup(await EventPhotosNotice());
    expect(html).toContain("Photos");
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/legal/privacy"');
  });

  it("renders the same notice whatever the event type — a race and a group run alike", async () => {
    // The component takes no event-type prop: it is unconditional on every event page, race and
    // group run, which is the point of the finding — it must not be gated on `type`.
    const race = renderToStaticMarkup(await EventPhotosNotice());
    const groupRun = renderToStaticMarkup(await EventPhotosNotice());
    expect(race).toBe(groupRun);
  });
});
