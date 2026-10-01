import { createElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailDelay } from "@/modules/notifications/domain/email-delay";
import type { RegistrationDoor } from "@/modules/events/ui/registration-door";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — before anybody asks for an email: the event page's registration box and the form's send
 * button say it in one line, «Confirmarea pe email întârzie azi», while the club's emails are late —
 * under the club's own button only, never in the editor's preview — and nothing otherwise, the markup
 * byte for byte what it is without the line. The form is rendered as `form-helpers.test.ts` renders
 * it; the box as `registration-fill-render.test.ts` does, its door stood in for.
 */
const state = vi.hoisted(() => ({
  locale: "ro" as "ro" | "en",
  delay: null as EmailDelay | null,
  door: null as unknown,
}));

const EVENT = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "crosul-de-toamna",
  title: "Crosul de toamnă",
  startsAt: new Date("2026-11-21T08:00:00.000Z"),
  timezone: "Europe/Bucharest",
  registrationMode: "INTERNAL",
  eventStatus: "SCHEDULED",
  registrationOpensAt: new Date("2026-09-01T00:00:00.000Z"),
  registrationClosesAt: new Date("2026-11-20T00:00:00.000Z"),
  publishedAt: new Date("2026-09-01T00:00:00.000Z"),
  locationToBeAnnounced: false,
  locationName: "Parcul Tractorul",
  costType: "FREE",
  costAmount: null,
  costUrl: null,
  rulesJson: null,
  minAge: 14,
  participantListVisibility: "HIDDEN",
  confirmationOpensDaysBefore: 7,
  confirmationDeadlineDaysBefore: 2,
  reminderHoursBefore: null,
  askHealthNote: false,
};

vi.mock("@/db/client", () => ({
  getDb: () =>
    new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("the form read the database");
        },
      },
    ),
}));
vi.mock("@/modules/events/repository", () => ({ findPublishedEventBySlug: async () => EVENT }));
vi.mock("@/modules/diagnostics/neon-budget", () => ({
  readNeonBudget: async () => ({ level: "green", budget: { spent: false }, meter: null }),
  peekNeonBudgetLevel: () => "unknown",
}));
vi.mock("@/modules/registrations/bot-check", () => ({ activeBotCheckSiteKey: async () => undefined }));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedEmailDelay: async () => state.delay,
  cachedDeadlines: async () => ({ offerHours: 24, confirmationHours: 48 }),
  cachedAddressCap: async () => ({ registrationsPerAddress: 4 }),
  cachedFamilyRegistrationOpen: async () => false,
  cachedCurrentApprovedDocument: async () => ({ version: 3 }),
  cachedListStatesDisclosed: async () => false,
  cachedListSocialsDisclosed: async () => false,
  cachedPublicAvailability: async () => null,
  cachedPublishedEventBySlug: async () => EVENT,
}));
vi.mock("@/modules/registrations/form-draft", () => ({
  readFormDraft: async () => null,
  readSubmittedFacts: async () => null,
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => state.locale,
  setRequestLocale: () => {},
  getTranslations: async (namespace: string) => {
    const catalogue = (state.locale === "ro" ? ro : en) as Record<string, object>;
    return createTranslator({ locale: state.locale, messages: catalogue[namespace] as Record<string, string>, namespace: undefined });
  },
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string } }) => (typeof href === "string" ? href : href.pathname),
  Link: ({ children, style }: { children: ReactNode; style?: object }) => createElement("a", { style }, children),
}));
vi.mock("@/shared/ui/ButtonLink", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("@/modules/events/ui/registration-door", () => ({ readRegistrationDoor: async () => state.door }));
vi.mock("@/modules/registrations/ui/EmailDeliveryNotice", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/RegistrationJourney", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/RegistrationSteps", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/CheckYourEmail", () => ({ default: () => null }));
vi.mock("@/modules/registrations/family-sitting-cookie", () => ({ readFamilySittingCookie: async () => null }));
vi.mock("@/modules/registrations/ui/FamilySittingNext", () => ({ default: () => null }));
vi.mock("@/modules/resilience/ui/LastGoodNotice", () => ({ default: () => null }));

const { default: RegisterPage } = await import("@/app/[locale]/events/[slug]/register/page");
const { default: RegistrationCta } = await import("@/modules/events/ui/RegistrationCta");
const { forgetLastGood } = await import("@/modules/resilience/last-good");

const NOW = new Date("2026-10-01T09:30:00.000Z");
const LATE: EmailDelay = { late: true, reason: "allowance", queued: 140, oldestWaitMinutes: 35, estimateMinutes: 85 };
const LINE = {
  ro: "Confirmarea pe email întârzie azi; estimăm cel mult 85 de minute.",
  en: "The confirmation email is running late today; we estimate at most 85 minutes.",
} as const;

const OPEN: RegistrationDoor = { kind: "KNOWN", cta: { kind: "OPEN", availablePlaces: 12, waiting: 0 }, fill: null };
const FULL: RegistrationDoor = { kind: "KNOWN", cta: { kind: "FULL", waitlistRoom: null, waiting: 3 }, fill: null };
const CLOSED: RegistrationDoor = { kind: "KNOWN", cta: { kind: "CLOSED" } as never, fill: null };

const strip = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/&#x27;/g, "'");
const LINE_HTML = /<div[^>]*data-testid="email-delay"[^>]*data-variant="short"[^>]*>[\s\S]*?<div class="MuiAlert-message[^"]*">([\s\S]*?)<\/div><\/div>/;
const lineText = (html: string) => LINE_HTML.exec(html)?.[1].replace(/<[^>]+>/g, "") ?? null;

async function form(): Promise<string> {
  const page = await RegisterPage({ params: Promise.resolve({ locale: state.locale, slug: EVENT.slug }), searchParams: Promise.resolve({}) });
  return strip(renderToStaticMarkup(page));
}

async function box(door: unknown, preview = false): Promise<string> {
  state.door = door;
  const event = { ...EVENT, translations: [] } as unknown as Parameters<typeof RegistrationCta>[0]["event"];
  const element = await RegistrationCta({ event, now: NOW, ...(preview ? { previewDoor: { door: door as RegistrationDoor, word: "previzualizare" } } : {}) });
  return strip(renderToStaticMarkup(element ?? createElement("div")));
}

beforeEach(() => {
  forgetLastGood();
  vi.spyOn(console, "error").mockImplementation(() => {});
  // One clock for both renders: the form carries the instant it was drawn (`renderedAt`).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("§NNN one line before anybody presses", () => {
  for (const locale of ["ro", "en"] as const) {
    it(`under the form's send button, and nothing when the emails are on time (${locale})`, async () => {
      state.locale = locale;
      state.delay = LATE;
      const late = await form();
      expect(lineText(late)).toBe(LINE[locale]);
      expect(late.indexOf('data-testid="email-delay"')).toBeGreaterThan(late.lastIndexOf("<button"));

      state.delay = { ...LATE, late: false, reason: null };
      const quiet = await form();
      expect(quiet).not.toContain("email-delay");
      expect(quiet).toBe(late.replace(LINE_HTML, ""));
    });

    it(`under the event page's button, open or full, and nothing when the emails are on time (${locale})`, async () => {
      state.locale = locale;
      for (const door of [OPEN, FULL]) {
        state.delay = LATE;
        const late = await box(door);
        expect(lineText(late), door.kind === "KNOWN" ? door.cta.kind : "").toBe(LINE[locale]);
        state.delay = null;
        const quiet = await box(door);
        expect(quiet).not.toContain("email-delay");
        expect(quiet).toBe(late.replace(LINE_HTML, ""));
      }
    });
  }

  it("never where there is no button of the club's, nor in the editor's preview", async () => {
    state.locale = "ro";
    state.delay = LATE;
    expect(await box(CLOSED)).not.toContain("email-delay");
    expect(await box(OPEN, true)).not.toContain("email-delay");
  });

  it("without an estimate, says only that it is late", async () => {
    state.locale = "ro";
    state.delay = { ...LATE, estimateMinutes: null };
    expect(lineText(await box(OPEN))).toBe("Confirmarea pe email întârzie azi.");
    state.locale = "en";
    expect(lineText(await box(OPEN))).toBe("The confirmation email is running late today.");
  });
});
