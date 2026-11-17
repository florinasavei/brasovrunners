import { createElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";
import { registrationSubmissionSchema, staffRegistrationSubmissionSchema } from "@/modules/registrations/fields";

/**
 * §972 (the owner, 2026-11-17: «că momentan nu se deosebesc cu nimic»; his choice: everyone who ticked at registration
 * that they are a member of the club, no second tick) — the public registration form asks «Sunt membru al grupului
 * {club}» and nothing under it: «Vreau numărul de membru» is gone, in Română and in English, even at an event whose
 * bib design offers the members' race number. A posted box is never read: the form's reading drops it and so do the
 * schemas. The page is rendered on the server as a visitor meets it, with the database and the async parts not about
 * the form stood in for — `kit-shirt-form.test.ts`'s shape.
 */
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en" }));

/** The moment the page is rendered at: registration open, the race ahead (the page reads the real clock, §712). */
const OPEN = new Date("2026-10-01T09:00:00.000Z");

/**
 * The race as an older read carried it: `offersMemberBib` on, the switch the form once asked the wish under, and the
 * bib design's own switch — an event that offers the members' bib in every way the page could ever have seen it.
 */
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
  kitShirt: false,
  offersMemberBib: true,
  bibDesign: { member: { enabled: true } },
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
  cachedEmailDelay: async () => null,
  cachedAddressCap: async () => ({ registrationsPerAddress: 4 }),
  cachedFamilyRegistrationOpen: async () => false,
  cachedCurrentApprovedDocument: async () => ({ version: 3 }),
  cachedListStatesDisclosed: async () => false,
  cachedListSocialsDisclosed: async () => false,
  cachedPublicAvailability: async () => null,
  cachedPublishedEventBySlug: async () => EVENT,
  cachedMemberDefinition: async () => null,
}));
vi.mock("@/modules/registrations/form-draft", () => ({
  // A refused press that brought the member tick back, as a draft once also brought the wish (§664).
  readFormDraft: async () => ({ clubMemberDeclared: "on", memberBibWanted: "on" }),
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
vi.mock("@/modules/registrations/ui/EmailDeliveryNotice", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/RegistrationJourney", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/RegistrationSteps", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/CheckYourEmail", () => ({ default: () => null }));
vi.mock("@/modules/registrations/family-sitting-cookie", () => ({ readFamilySittingCookie: async () => null }));
vi.mock("@/modules/registrations/ui/FamilySittingNext", () => ({ default: () => null }));
vi.mock("@/modules/resilience/ui/LastGoodNotice", () => ({ default: () => null }));

const { default: RegisterPage } = await import("@/app/[locale]/events/[slug]/register/page");
const { forgetLastGood } = await import("@/modules/resilience/last-good");

async function render(): Promise<string> {
  // A fresh copy per render: the last-good memory would otherwise hand back the previous event.
  forgetLastGood();
  return atTheClock(OPEN, async () => {
    const page = await RegisterPage({
      params: Promise.resolve({ locale: state.locale, slug: EVENT.slug }),
      searchParams: Promise.resolve({ error: "VALIDATION_ERROR" }),
    });
    return renderToStaticMarkup(page);
  });
}

beforeEach(() => {
  state.locale = "ro";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("§972 the public form asks the member tick alone", () => {
  it("draws «Sunt membru al grupului» and no «Vreau numărul de membru» under it, at an event that offers the members' bib (ro)", async () => {
    const html = await render();
    expect(html).toContain('name="clubMemberDeclared"');
    // The draft brought the member tick back ticked: the box is the person's, as before.
    expect(/<input[^>]*name="clubMemberDeclared"[^>]*checked/.test(html) || /<input[^>]*checked[^>]*name="clubMemberDeclared"/.test(html)).toBe(true);
    expect(html).not.toContain('name="memberBibWanted"');
    expect(html).not.toContain("Vreau numărul de membru");
    expect(html).not.toContain("f-memberBibWanted");
  });

  it("does the same in English", async () => {
    state.locale = "en";
    const html = await render();
    expect(html).toContain('name="clubMemberDeclared"');
    expect(html).not.toContain('name="memberBibWanted"');
    expect(html).not.toContain("I want the members' number");
  });

  it("never reads a posted «memberBibWanted»: the form's reading drops it, and neither schema keeps it", () => {
    const form = new FormData();
    form.set("clubMemberDeclared", "on");
    form.set("memberBibWanted", "on");
    const read = readRegistrationForm(form, "ro") as Record<string, unknown>;
    expect(read.clubMemberDeclared).toBe(true);
    expect(read).not.toHaveProperty("memberBibWanted");
    // A caller that posts it anyway past the form's reading: both schemas strip a key they do not name.
    for (const schema of [registrationSubmissionSchema, staffRegistrationSubmissionSchema]) {
      const parsed = schema.safeParse({ memberBibWanted: true });
      const issues = parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
      expect(issues).not.toContain("memberBibWanted");
      expect(parsed.success ? parsed.data : {}).not.toHaveProperty("memberBibWanted");
    }
  });
});
