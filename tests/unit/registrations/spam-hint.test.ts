import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * §NNN — every page that tells somebody to wait for an email names Spam and Promotions in one
 * visible box, the same words everywhere: the screen after the registration form, and the two
 * "send me the link again" forms once sent (the registration's and «Înscrierile mele»). Rendered
 * with the real catalogues, in both languages.
 */
const lang = vi.hoisted(() => ({ current: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    getLocale: async () => lang.current,
    setRequestLocale: () => {},
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: lang.current, messages: catalogues[lang.current], namespace: namespace as "Registration" }),
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ href, children }: { href: unknown; children: ReactNode }) => createElement("a", { href: typeof href === "string" ? href : "#" }, children),
  };
});
vi.mock("@/modules/public-cache/reads", () => ({
  cachedDeadlines: async () => ({ confirmationHours: 48, familySittingMinutes: 10 }),
  cachedEmailWaitMinutes: async () => 15,
  cachedEmailLeavesAt: async () => null,
}));
// The forms' server actions are never pressed here.
vi.mock("@/app/[locale]/registrations/resend/actions", () => ({ requestRegistrationLinkAction: async () => {} }));
vi.mock("@/app/[locale]/registrations/mine/actions", () => ({ requestMyRegistrationsLinkAction: async () => {} }));

const { default: CheckYourEmail } = await import("@/modules/registrations/ui/CheckYourEmail");
const { default: ResendPage } = await import("@/app/[locale]/registrations/resend/page");
const { default: MyRegistrationsRequestPage } = await import("@/app/[locale]/registrations/mine/page");

const SPAM_RO = "Nu a venit în câteva minute? Caută în Spam și în Promoții și mută-ne în Inbox, ca să primești și următoarele.";
const SPAM_EN = "Nothing after a few minutes? Look in Spam and Promotions and move us to your inbox so the next ones arrive.";

function markup(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/&#x27;/g, "'");
}

/** The one box: an MUI info Alert carrying the sentence. */
function spamBox(html: string): string | null {
  const match = /<div[^>]*MuiAlert-colorInfo[^>]*data-testid="spam-hint"[^>]*>([\s\S]*?)<\/div><\/div>/.exec(html);
  return match ? match[1].replace(/<[^>]+>/g, "") : null;
}

async function checkYourEmail(locale: "ro" | "en"): Promise<string> {
  lang.current = locale;
  return markup(
    (await CheckYourEmail({
      eventTitle: "Crosul Tâmpei",
      whenLabel: "sâmbătă, 21 noiembrie 2026, la 10:00",
      eventHref: "/ro/evenimente/crosul-tampei",
      slug: "crosul-tampei",
      facts: { email: "ana@example.ro", firstName: "Ana" },
      window: null,
    })) as ReactElement,
  );
}

describe("§NNN the pages that wait for an email point at Spam and Promotions, visibly", () => {
  it("the screen after the registration form shows the box, in Romanian and in English", async () => {
    const ro = await checkYourEmail("ro");
    expect(spamBox(ro)).toContain(SPAM_RO);
    // The old grey line is gone: the box is the one telling.
    expect(ro).not.toContain("Nu a venit? Uită-te și în Spam.");

    const en = await checkYourEmail("en");
    expect(spamBox(en)).toContain(SPAM_EN);
  });

  it("the registration's resend form shows it under its sentence once sent, and not before", async () => {
    lang.current = "ro";
    const sent = markup(
      (await ResendPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ sent: "1" }) })) as ReactElement,
    );
    expect(sent).toContain("Dacă există o înscriere pe această adresă, linkul pleacă acolo");
    expect(spamBox(sent)).toContain(SPAM_RO);
    expect(sent.indexOf("Dacă există o înscriere")).toBeLessThan(sent.indexOf('data-testid="spam-hint"'));

    const form = markup(
      (await ResendPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({}) })) as ReactElement,
    );
    expect(form).not.toContain('data-testid="spam-hint"');

    lang.current = "en";
    const sentEn = markup(
      (await ResendPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ sent: "1" }) })) as ReactElement,
    );
    expect(spamBox(sentEn)).toContain(SPAM_EN);
  });

  it("«Înscrierile mele»'s request form shows it once sent", async () => {
    lang.current = "ro";
    const sent = markup(
      (await MyRegistrationsRequestPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ sent: "1" }) })) as ReactElement,
    );
    expect(sent).toContain("Dacă există înscrieri pe această adresă, linkul pleacă acolo");
    expect(spamBox(sent)).toContain(SPAM_RO);
  });
});
