import { createElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";

/**
 * §447, finding (2) of the fix round on `feat/neon-budget-governor`: the registration page while
 * the database is away. It read the event and the bot-check key straight from the database, so a
 * visitor met the error page instead of the resting notice the brief asked for («forms show the
 * notice and lose nothing»). Now the event comes with its last good copy behind it, and while the
 * database refuses the page is drawn from that copy: the notice, the form disabled — nothing can be
 * sent — and what the draft cookie brought back still in the boxes.
 *
 * The database is a stand-in whose every use throws Neon's quota refusal once a case says so, so a
 * read the resting page should have skipped fails the test. The event row comes through the
 * repository's own function, stubbed; the async parts of the page that are not about the outage
 * (the journey strip, the steps, the delivery notice) are stood in for, because `react-dom/server`
 * cannot render an async component.
 */
const QUOTA = new Error("Your project has exceeded the compute time quota. Upgrade your plan to increase limits.");
const state = vi.hoisted(() => ({ refusal: null as Error | null, draft: null as Record<string, string> | null }));

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
};

vi.mock("@/db/client", () => ({
  getDb: () =>
    new Proxy(
      {},
      {
        get: () => () => {
          throw state.refusal ?? new Error("the resting page read the database");
        },
      },
    ),
}));
vi.mock("@/modules/events/repository", () => ({
  findPublishedEventBySlug: async () => {
    if (state.refusal) throw Object.assign(new Error("Failed query: select … from events"), { cause: state.refusal });
    return EVENT;
  },
}));
vi.mock("@/modules/diagnostics/neon-budget", () => ({
  readNeonBudget: async () => ({ level: "red", budget: { spent: false }, meter: null }),
  peekNeonBudgetLevel: () => "unknown",
}));
vi.mock("@/modules/registrations/bot-check", () => ({
  activeBotCheckSiteKey: async () => {
    if (state.refusal) throw state.refusal;
    return undefined;
  },
}));
vi.mock("@/modules/public-cache/reads", () => ({
  cachedCurrentApprovedDocument: async () => {
    if (state.refusal) throw state.refusal;
    return { version: 3 };
  },
  cachedListStatesDisclosed: async () => false,
  cachedPublicAvailability: async () => null,
  cachedPublishedEventBySlug: async () => EVENT,
}));
vi.mock("@/modules/registrations/form-draft", () => ({
  readFormDraft: async () => state.draft,
  readSubmittedFacts: async () => null,
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "ro",
  setRequestLocale: () => {},
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "ro", messages: (ro as Record<string, object>)[namespace] as Record<string, string>, namespace: undefined }),
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string } }) => (typeof href === "string" ? href : href.pathname),
  Link: ({ children, style }: { children: ReactNode; style?: object }) => createElement("a", { style }, children),
}));
// The async parts not about the outage (see above).
vi.mock("@/modules/registrations/ui/EmailDeliveryNotice", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/RegistrationJourney", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/RegistrationSteps", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/CheckYourEmail", () => ({ default: () => null }));
vi.mock("@/modules/resilience/ui/LastGoodNotice", () => ({
  default: ({ read }: { read: { freshness: string } }) => (read.freshness === "live" ? null : createElement("div", { "data-testid": "resting-notice" })),
}));

const { default: RegisterPage } = await import("@/app/[locale]/events/[slug]/register/page");
const { forgetLastGood } = await import("@/modules/resilience/last-good");
const { resetBreaker } = await import("@/modules/resilience/breaker");

async function render(searchParams: Record<string, string> = {}, slug: string = EVENT.slug): Promise<string> {
  const page = await RegisterPage({
    params: Promise.resolve({ locale: "ro", slug }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(page);
}

beforeEach(() => {
  state.refusal = null;
  state.draft = null;
  forgetLastGood();
  resetBreaker();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("§447 the registration page while the database is away", () => {
  it("serves the event's last good copy with the resting notice and the form disabled, reading nothing else", async () => {
    // A visit while the database answered keeps the copy.
    const live = await render();
    expect(live).not.toContain('data-testid="registration-resting"');
    expect(live).toContain("Crosul de toamnă");

    state.refusal = QUOTA;
    state.draft = { firstName: "Ana", lastName: "Pop" };
    const resting = await render({ error: "DATABASE_AWAY", fields: "databaseAway" });

    expect(resting).toContain('data-testid="resting-notice"');
    expect(resting).toContain('data-testid="registration-resting"');
    expect(resting).toContain(ro.Registration.restingForm);
    // Nothing can be sent: the fields sit in a disabled fieldset and the button is disabled.
    expect(resting).toMatch(/<fieldset[^>]*disabled/);
    expect(resting).toMatch(/<button[^>]*disabled[^>]*data-testid="registration-submit-resting"|data-testid="registration-submit-resting"[^>]*disabled/);
    // Nothing typed is lost: the draft is back in the boxes.
    expect(resting).toContain('value="Ana"');
    // The refusal summary does not repeat what the notice says.
    expect(resting).not.toContain(ro.Registration.errors.databaseAwayTitle);
  });

  it("still fails honestly when there is no copy to serve", async () => {
    state.refusal = QUOTA;
    // A slug never served, so neither this instance's memory nor the store holds a copy of it.
    await expect(render({}, "alt-eveniment")).rejects.toThrow("Failed query");
  });
});
