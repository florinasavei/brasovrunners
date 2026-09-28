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
const state = vi.hoisted(() => ({
  refusal: null as Error | null,
  draft: null as Record<string, string> | null,
  sitting: null as null | {
    sittingId: string | null;
    seed?: null;
    joined?: boolean;
    eventId: string;
    email: string;
    people: { name: string; birthDate: string }[];
    heldUntil: Date;
    shared?: Record<string, string>;
    sameBirthDate?: { typed: string; kept: string } | null;
  },
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
// The short screen after the first form (§NNN) is CheckYourEmail's own, given the offer's data.
vi.mock("@/modules/registrations/ui/CheckYourEmail", () => ({
  default: ({ offer }: { offer?: { atOnce: boolean } }) =>
    createElement(
      "div",
      { "data-testid": "check-your-email" },
      offer ? createElement("div", { "data-testid": "family-sitting-offer", "data-at-once": offer.atOnce ? "yes" : "no" }) : null,
    ),
}));
// The family sitting's browser half (§519) and its async screen, stood in for like the parts above.
vi.mock("@/modules/registrations/family-sitting-cookie", () => ({ readFamilySittingCookie: async () => state.sitting }));
vi.mock("@/modules/registrations/ui/FamilySittingNext", () => ({
  default: ({ names, atOnce, sameBirthDate, releaseInMs }: { names: string[]; atOnce: boolean; sameBirthDate: { typed: string } | null; releaseInMs: number }) =>
    createElement("div", {
      "data-testid": "family-sitting",
      "data-names": names.join("|"),
      "data-at-once": atOnce ? "yes" : "no",
      "data-same": sameBirthDate?.typed ?? "",
      "data-release": releaseInMs > 0 ? "later" : "now",
    }),
}));
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
  state.sitting = null;
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

  it("§NNN after the first form, says to open the inbox with one question in it — no «Gata», nothing waits for a press", async () => {
    state.sitting = {
      sittingId: "00000000-0000-4000-8000-0000000000aa",
      seed: null,
      eventId: EVENT.id,
      email: "familia.pop@example.ro",
      people: [{ name: "Ana Pop", birthDate: "1985-03-02" }],
      heldUntil: new Date(Date.now() + 600_000),
      sameBirthDate: null,
    };
    const first = await render({ submitted: "1" });
    expect(first).toContain('data-testid="check-your-email"');
    expect(first).toContain('data-testid="family-sitting-offer"');
    expect(first).not.toContain('data-testid="family-sitting"');
    // Before «Da» there is no family form: `?family=1` is the ordinary form, the address asked twice.
    const plain = await render({ family: "1" });
    expect(plain).not.toContain('data-testid="family-sitting-address"');
    expect(plain).toContain('name="emailConfirm"');
  });

  it("§519 after «Da», every form's screen is the sitting's — the people so far, «Gata», the minutes left; after «Gata», says to open the inbox", async () => {
    state.sitting = {
      sittingId: "00000000-0000-4000-8000-0000000000aa",
      seed: null,
      joined: true,
      eventId: EVENT.id,
      email: "familia.pop@example.ro",
      people: [
        { name: "Ana Pop", birthDate: "1985-03-02" },
        { name: "Maria Pop", birthDate: "2010-07-11" },
      ],
      heldUntil: new Date(Date.now() + 600_000),
      sameBirthDate: { typed: "Ioana Pop", kept: "Maria Pop" },
    };
    const asking = await render({ submitted: "1" });
    expect(asking).toContain('data-testid="family-sitting"');
    expect(asking).toContain('data-names="Ana Pop|Maria Pop"');
    // The form not kept (§493) is said on the screen, and the open screen presses «Gata» when the window ends.
    expect(asking).toContain('data-same="Ioana Pop"');
    expect(asking).toContain('data-release="later"');
    expect(asking).toContain('data-at-once="no"');
    expect(asking).not.toContain('data-testid="check-your-email"');
    expect(asking).not.toContain('data-testid="family-sitting-offer"');

    const sent = await render({ submitted: "1", sent: "1" });
    expect(sent).toContain('data-testid="check-your-email"');
    expect(sent).not.toContain('data-testid="family-sitting"');

    // The window over: the sitting is no more, and the screen is the inbox's.
    state.sitting = { ...state.sitting, heldUntil: new Date(Date.now() - 1_000) };
    expect(await render({ submitted: "1" })).toContain('data-testid="check-your-email"');
  });

  it("§519 the next form of a sitting fixes the address — said back, not asked — and lists who was sent so far", async () => {
    state.sitting = {
      sittingId: "00000000-0000-4000-8000-0000000000aa",
      seed: null,
      joined: true,
      eventId: EVENT.id,
      email: "familia.pop@example.ro",
      people: [{ name: "Ana Pop", birthDate: "1985-03-02" }],
      heldUntil: new Date(Date.now() + 600_000),
      shared: { city: "Brașov", nationality: "MD", guardianName: "Ana Pop", emergencyContactName: "Dan Pop" },
    };
    const next = await render({ family: "1" });
    expect(next).toContain('data-testid="family-sitting-address"');
    expect(next).toContain("familia.pop@example.ro");
    expect(next).toContain('name="familySitting" value="1"');
    expect(next).not.toContain('name="emailConfirm"');
    expect(next).toContain('data-testid="family-sitting-intro"');
    expect(next).toContain("Până acum: Ana Pop.");
    // How long is left, on the server's clock at this render (§519): ten minutes from now.
    expect(next).toContain("pleacă singur peste 10 minute");
    // The way back to «Gata» without filling this one in (§519).
    expect(next).toContain(ro.Registration.sitting.formBack);
    // The boxes a family shares start filled (§519); the person's own start empty.
    expect(next).toMatch(/name="city"[^>]*value="Brașov"|value="Brașov"[^>]*name="city"/);
    expect(next).toMatch(/name="guardianName"[^>]*value="Ana Pop"|value="Ana Pop"[^>]*name="guardianName"/);
    expect(next).toMatch(/name="emergencyContactName"[^>]*value="Dan Pop"|value="Dan Pop"[^>]*name="emergencyContactName"/);
    // The citizenship picker draws the chosen country's flag: Moldova's, not the default Romania's alone.
    expect(next).toContain("/flags/md.svg");
    expect(next).not.toMatch(/name="firstName"[^>]*value="[^"]+"|value="[^"]+"[^>]*name="firstName"/);
    expect(next).not.toMatch(/name="birthDate"[^>]*value="[^"]+"|value="[^"]+"[^>]*name="birthDate"/);

    // Without a live sitting, `?family=1` is the ordinary form, the address asked twice.
    state.sitting = null;
    const plain = await render({ family: "1" });
    expect(plain).not.toContain('data-testid="family-sitting-address"');
    expect(plain).toContain('name="emailConfirm"');
    // …and nothing is prefilled from a sitting that is not there.
    expect(plain).not.toContain("/flags/md.svg");
    expect(plain).not.toMatch(/name="city"[^>]*value="Brașov"|value="Brașov"[^>]*name="city"/);
  });

  it("still fails honestly when there is no copy to serve", async () => {
    state.refusal = QUOTA;
    // A slug never served, so neither this instance's memory nor the store holds a copy of it.
    await expect(render({}, "alt-eveniment")).rejects.toThrow("Failed query");
  });
});
