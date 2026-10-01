import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EmailDelay } from "@/modules/notifications/domain/email-delay";

/**
 * §NNN — the pages that wait for an email say when the club's emails are late, above their own wait
 * sentence, in both languages; and while nothing is late each page's markup is exactly the markup
 * without the notice (the late page with the notice cut out, byte for byte). Rendered with the real
 * catalogues; the delay itself is stood in for (`cachedEmailDelay`), the read is
 * `tests/integration/notifications/email-delay.test.ts`'s.
 */
const state = vi.hoisted(() => ({ lang: "ro" as "ro" | "en", delay: null as EmailDelay | null }));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    getLocale: async () => state.lang,
    setRequestLocale: () => {},
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: state.lang, messages: catalogues[state.lang], namespace: namespace as "Registration" }),
  };
});
vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");
  return {
    getPathname: ({ locale, href }: { locale: string; href: string }) => `/${locale}${typeof href === "string" ? href : "/x"}`,
    Link: ({ href, children }: { href: unknown; children: ReactNode }) => createElement("a", { href: typeof href === "string" ? href : "#" }, children),
  };
});
// The forms' server actions are never pressed here.
vi.mock("@/app/[locale]/registrations/resend/actions", () => ({ requestRegistrationLinkAction: async () => {} }));
vi.mock("@/app/[locale]/contact/actions", () => ({
  requestNewsletterManageLinkAction: async () => {},
  submitNewsletterAction: async () => {},
}));
vi.mock("@/app/[locale]/registrations/mine/actions", () => ({ requestMyRegistrationsLinkAction: async () => {} }));
vi.mock("@/app/[locale]/registrations/family/[token]/actions", () => ({
  confirmFamilyEntryAction: async () => {},
  confirmFamilySittingAction: async () => {},
  declineFamilyEntryAction: async () => {},
}));
vi.mock("@/app/[locale]/events/[slug]/actions", () => ({ registerInterestAction: async () => {} }));
vi.mock("@/modules/registrations/ui/RegistrationJourney", () => ({ default: () => null }));
// The two done pages (address confirmed, race declaration): no database, no cookies, no family pass.
vi.mock("@/modules/registrations/token-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/registrations/token-actions")>()),
  readConfirmedOnAddress: async () => [],
}));
vi.mock("@/modules/registrations/family-signing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/registrations/family-signing")>()),
  readFamilySigningPass: async () => null,
}));
vi.mock("@/shared/feedback/PublicFlash", () => ({ default: () => null }));
// The group run's declaration page: only its done branch is rendered, with a dated trail run.
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/resilience/event-copy", () => ({
  formEventBySlug: async () => ({ title: "Alergare de grup", slug: "alergare", groupRunDeclaration: "GROUP_RUN_DECLARATION_TRAIL", startsAt: new Date("2026-11-21T08:00:00Z") }),
}));
vi.mock("@/modules/events/members-only", () => ({ membersEventBySlug: async () => null }));
vi.mock("@/modules/events/domain/dated", () => ({ datedOrNull: (event: unknown) => event }));
vi.mock("@/modules/legal-documents/domain/keys", () => ({ offeredGroupRunDeclarationKey: () => "GROUP_RUN_DECLARATION_TRAIL" }));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedEmailDelay: async () => state.delay,
  cachedDeadlines: async () => ({ confirmationHours: 48, familySittingMinutes: 10 }),
  cachedEmailWaitMinutes: async () => 15,
  cachedEmailLeavesAt: async () => null,
  cachedCurrentApprovedDocument: async () => undefined,
  cachedBotCheckSiteKey: async () => undefined,
}));

const { default: CheckYourEmail } = await import("@/modules/registrations/ui/CheckYourEmail");
const { default: ResendPage } = await import("@/app/[locale]/registrations/resend/page");
const { default: MyRegistrationsRequestPage } = await import("@/app/[locale]/registrations/mine/page");
const { default: FamilyConfirmPage } = await import("@/app/[locale]/registrations/family/[token]/page");
const { default: GroupRunDeclarationPage } = await import("@/app/[locale]/events/[slug]/declaration/page");
const { default: ConfirmEmailPage } = await import("@/app/[locale]/registrations/confirm/[token]/page");
const { default: DeclarePage } = await import("@/app/[locale]/registrations/declare/[token]/page");
const { default: RegistrationInterestForm } = await import("@/modules/registrations/ui/RegistrationInterestForm");
const { default: NewsletterSignup } = await import("@/modules/newsletter/ui/NewsletterSignup");

const LATE: EmailDelay = { late: true, reason: "backlog", queued: 23, oldestWaitMinutes: 47, estimateMinutes: 30 };
const NOT_LATE: EmailDelay = { late: false, reason: null, queued: 2, oldestWaitMinutes: 3, estimateMinutes: null };

/** Three shapes by what the page's email carries: a deadline from its send, a resend's, none. */
const WORDS = {
  full: {
    ro: "Emailurile noastre întârzie acum: 23 de mesaje așteaptă, cel mai vechi de 47 de minute; estimăm cel mult 30 de minute. Al tău pleacă la rând — termenul lui curge de când pleacă, nu de acum. Nu te înscrie din nou.",
    en: "Our emails are running late: 23 messages are waiting, the oldest for 47 minutes; we estimate at most 30 minutes. Yours leaves in its turn — its deadline runs from the moment it leaves, not from now. Do not register again.",
  },
  resend: {
    ro: "Emailurile noastre întârzie acum: 23 de mesaje așteaptă, cel mai vechi de 47 de minute; estimăm cel mult 30 de minute. Al tău pleacă la rând. Termenul din primul tău email curge de când a plecat acela, nu de acum.",
    en: "Our emails are running late: 23 messages are waiting, the oldest for 47 minutes; we estimate at most 30 minutes. Yours leaves in its turn. The deadline in your first email runs from when that one left, not from now.",
  },
  plain: {
    ro: "Emailurile noastre întârzie acum: 23 de mesaje așteaptă, cel mai vechi de 47 de minute; estimăm cel mult 30 de minute. Al tău pleacă la rând.",
    en: "Our emails are running late: 23 messages are waiting, the oldest for 47 minutes; we estimate at most 30 minutes. Yours leaves in its turn.",
  },
} as const;

function markup(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/&#x27;/g, "'");
}

/** The notice: an MUI warning Alert, its icon and its message. */
const NOTICE = /<div[^>]*data-testid="email-delay"[^>]*>[\s\S]*?<div class="MuiAlert-message[^"]*">([\s\S]*?)<\/div><\/div>/;

function noticeText(html: string): string | null {
  const match = NOTICE.exec(html);
  return match ? match[1].replace(/<[^>]+>/g, "") : null;
}

/**
 * One page, three ways: late (the notice says the words, above `above`), not late and unknown (the
 * markup is the late page's with the notice cut out, byte for byte).
 */
async function holds(name: string, render: () => Promise<string>, above?: string, variant: keyof typeof WORDS = "full") {
  for (const lang of ["ro", "en"] as const) {
    state.lang = lang;
    state.delay = LATE;
    const late = await render();
    expect(noticeText(late), `${name} ${lang}`).toBe(WORDS[variant][lang]);
    expect(late, `${name} ${lang}: a warning`).toMatch(/MuiAlert-colorWarning[^>]*data-testid="email-delay"|data-testid="email-delay"[^>]*MuiAlert-colorWarning/);
    if (above) expect(late.indexOf('data-testid="email-delay"'), `${name} ${lang}: above the page's wait`).toBeLessThan(late.indexOf(above));

    for (const quiet of [NOT_LATE, null]) {
      state.delay = quiet;
      const html = await render();
      expect(html, `${name} ${lang}`).not.toContain("email-delay");
      expect(html, `${name} ${lang}: byte-identical without the notice`).toBe(late.replace(NOTICE, ""));
    }
  }
}

const page = (element: unknown) => markup(element as ReactElement);

describe("§NNN the pages that wait for an email say when the club's emails are late", () => {
  it("the screen after the registration form, full and short", async () => {
    const screen = (offer: boolean) => async () =>
      page(
        await CheckYourEmail({
          eventTitle: "Crosul Tâmpei",
          whenLabel: "sâmbătă, 21 noiembrie 2026, la 10:00",
          eventHref: "/ro/evenimente/crosul-tampei",
          slug: "crosul-tampei",
          facts: { email: "ana@example.ro", firstName: "Ana" },
          window: null,
          ...(offer
            ? { offer: { email: "ana@example.ro", atOnce: false, leavesAt: null, submittedAt: new Date(), windowMinutes: 10, continueAction: async () => {} } }
            : {}),
        }),
      );
    await holds("check your email", screen(false), 'id="check-email-next"');
    await holds("the short screen", screen(true), 'data-testid="check-email-leaves"');
  });

  it("the registration's resend form and «Înscrierile mele», once sent — and never on the form itself", async () => {
    const resend = (sent: boolean) => async () =>
      page(await ResendPage({ params: Promise.resolve({ locale: state.lang }), searchParams: Promise.resolve(sent ? { sent: "1" } : {}) }));
    const mine = (sent: boolean) => async () =>
      page(await MyRegistrationsRequestPage({ params: Promise.resolve({ locale: state.lang }), searchParams: Promise.resolve(sent ? { sent: "1" } : {}) }));
    await holds("resend", resend(true), "MuiAlert-colorSuccess", "resend");
    await holds("mine", mine(true), "MuiAlert-colorSuccess");
    state.delay = LATE;
    expect(await resend(false)()).not.toContain("email-delay");
    expect(await mine(false)()).not.toContain("email-delay");
  });

  it("the family's confirmation page, under each answer that sends", async () => {
    for (const done of ["declare", "waitlist", "family"]) {
      await holds(`family ${done}`, async () =>
        page(await FamilyConfirmPage({ params: Promise.resolve({ locale: state.lang, token: "t" }), searchParams: Promise.resolve({ done }) })),
        "MuiAlert-colorSuccess",
      );
    }
  });

  it("the group run's declaration, once signed", async () => {
    await holds("group run", async () =>
      page(await GroupRunDeclarationPage({ params: Promise.resolve({ locale: state.lang, slug: "alergare" }), searchParams: Promise.resolve({ done: "1" }) })),
      'data-testid="group-run-declaration-done"',
      "plain",
    );
  });

  it("the address-confirmed page and the race declaration's done page", async () => {
    await holds("confirm", async () =>
      page(await ConfirmEmailPage({ params: Promise.resolve({ locale: state.lang, token: "t" }), searchParams: Promise.resolve({ done: "1" }) })),
      "MuiAlert-colorSuccess",
    );
    for (const done of ["confirmed", "waitlisted"]) {
      await holds(`declare ${done}`, async () =>
        page(await DeclarePage({ params: Promise.resolve({ locale: state.lang, token: "t" }), searchParams: Promise.resolve({ done }) })),
        "MuiAlert-colorSuccess",
        "plain",
      );
    }
  });

  it("the event page's interest form says nothing: no email waits for that address yet", async () => {
    state.delay = LATE;
    expect(page(await RegistrationInterestForm({ locale: state.lang, slug: "crosul-tampei", renderedAt: new Date(), outcome: "done" }))).not.toContain("email-delay");
  });

  it("the newsletter's two answers, and not the form before them", async () => {
    const render = (outcome: "sent" | null, leaveOutcome: "sent" | null) => async () =>
      page(
        await NewsletterSignup({
          locale: state.lang,
          outcome,
          refused: [],
          typed: {},
          siteKey: undefined,
          renderedAt: "2026-10-01T09:00:00.000Z",
          attempt: "a",
          leaveOutcome,
          leaveTyped: undefined,
        }),
      );
    await holds("newsletter sent", render("sent", null), 'data-testid="newsletter-sent"');
    await holds("newsletter leave", render(null, "sent"), 'data-testid="newsletter-leave-sent"', "plain");
    state.delay = LATE;
    expect(await render(null, null)()).not.toContain("email-delay");
  });

  it("says a long wait in whole hours, never in hundreds of minutes", async () => {
    state.delay = { late: true, reason: "allowance", queued: 40, oldestWaitMinutes: 247, estimateMinutes: 1385 };
    state.lang = "ro";
    expect(noticeText(page(await ResendPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ sent: "1" }) })))).toContain(
      "cel mai vechi de peste 4 ore; estimăm cel mult 24 de ore.",
    );
    state.lang = "en";
    expect(noticeText(page(await ResendPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ sent: "1" }) })))).toContain(
      "the oldest for over 4 hours; we estimate at most 24 hours.",
    );
  });

  it("says no estimate when it has none, and a single message in the singular", async () => {
    state.lang = "ro";
    state.delay = { late: true, reason: "paused", queued: 1, oldestWaitMinutes: 0, estimateMinutes: null };
    const ro = page(await ResendPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ sent: "1" }) }));
    expect(noticeText(ro)).toBe(
      "Emailurile noastre întârzie acum: 1 mesaj așteaptă, cel mai vechi de un minut. Al tău pleacă la rând. Termenul din primul tău email curge de când a plecat acela, nu de acum.",
    );
    state.lang = "en";
    const en = page(await ResendPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ sent: "1" }) }));
    expect(noticeText(en)).toBe(
      "Our emails are running late: 1 message is waiting, the oldest for one minute. Yours leaves in its turn. The deadline in your first email runs from when that one left, not from now.",
    );
  });
});
