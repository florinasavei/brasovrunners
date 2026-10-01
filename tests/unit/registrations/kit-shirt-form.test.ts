import { createElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { SHIRT_SIZES, shirtSizeKept, shirtSizeShown } from "@/modules/registrations/domain/kit";

/**
 * §554 (amending §59) — the registration form asks the T-shirt size only when the event's «Kit de
 * participare» gives a shirt (`events.kit_shirt`); otherwise no box, and the optional fold's title
 * drops «tricou» in both languages. «Sex» is two radio cards with their glyphs. The page is rendered
 * on the server as a visitor meets it, with the database and the async parts not about the form
 * stood in for — `form-helpers.test.ts`'s shape.
 */
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en", kitShirt: false }));

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

const eventNow = () => ({ ...EVENT, kitShirt: state.kitShirt });

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
vi.mock("@/modules/events/repository", () => ({ findPublishedEventBySlug: async () => eventNow() }));
vi.mock("@/modules/diagnostics/neon-budget", () => ({
  readNeonBudget: async () => ({ level: "green", budget: { spent: false }, meter: null }),
  peekNeonBudgetLevel: () => "unknown",
}));
vi.mock("@/modules/registrations/bot-check", () => ({ activeBotCheckSiteKey: async () => undefined }));
vi.mock("@/modules/public-cache/reads", () => ({
  // The emails are on time (§623): the late notice draws nothing.
  cachedEmailDelay: async () => null,
  cachedAddressCap: async () => ({ registrationsPerAddress: 4 }),
  cachedFamilyRegistrationOpen: async () => false,
  cachedCurrentApprovedDocument: async () => ({ version: 3 }),
  cachedListStatesDisclosed: async () => false,
  cachedListSocialsDisclosed: async () => false,
  cachedPublicAvailability: async () => null,
  cachedPublishedEventBySlug: async () => eventNow(),
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
  const page = await RegisterPage({
    params: Promise.resolve({ locale: state.locale, slug: EVENT.slug }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(page);
}

/** The optional club fold's title, as the summary reads. */
function clubFoldTitle(html: string): string {
  const summaries = [...html.matchAll(/<summary[^>]*>(.*?)<\/summary>/g)].map(([, inner]) => inner.replace(/<style[^>]*>.*?<\/style>/g, "").replace(/<[^>]+>/g, "").trim());
  return summaries.find((text) => text.includes("Brașov Runners")) ?? "";
}

beforeEach(() => {
  state.locale = "ro";
  state.kitShirt = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("§554 the T-shirt size is asked only when the event gives a shirt", () => {
  it("draws no size box and no «tricou» in the fold's title on an event without a shirt (ro, en)", async () => {
    const html = await render();
    expect(html).not.toContain('name="tshirtSize"');
    expect(clubFoldTitle(html)).toBe("Membru Brașov Runners și club — opțional");
    state.locale = "en";
    const english = await render();
    expect(english).not.toContain('name="tshirtSize"');
    expect(clubFoldTitle(english)).toBe("Brașov Runners member and club — optional");
  });

  it("draws the size box, and «tricou» in the fold's title, on an event with a shirt (ro, en)", async () => {
    state.kitShirt = true;
    const html = await render();
    expect(html).toContain('name="tshirtSize"');
    expect(clubFoldTitle(html)).toBe("Membru Brașov Runners, club și tricou — opțional");
    expect(html).toContain("Mărime tricou");
    state.locale = "en";
    const english = await render();
    expect(english).toContain('name="tshirtSize"');
    expect(clubFoldTitle(english)).toBe("Brașov Runners member, club and t-shirt — optional");
  });

  it("draws «Sex» on the form itself as a dropdown, «Alege…» then Feminin then Masculin (§555)", async () => {
    const html = await render();
    const select = /<select[^>]*name="sex"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
    const values = [...select.matchAll(/<option[^>]*value="([A-Z]*)"/g)].map(([, value]) => value);
    expect(values).toEqual(["", "FEMALE", "MALE"]);
    expect(select).toContain("Alege…");
    expect(html).not.toMatch(/<input[^>]*type="radio"[^>]*name="sex"/);
    expect(html).not.toContain("Prefer să nu spun");
  });

  it("keeps a posted size only for an event with a shirt, and shows one only then", () => {
    expect(SHIRT_SIZES).toEqual(["XS", "S", "M", "L", "XL", "XXL"]);
    expect(shirtSizeKept(false, "M")).toBe("NONE");
    expect(shirtSizeKept(true, "M")).toBe("M");
    expect(shirtSizeKept(true, undefined)).toBe("NONE");
    expect(shirtSizeShown(false, "M")).toBeNull();
    expect(shirtSizeShown(true, "NONE")).toBeNull();
    expect(shirtSizeShown(true, "L")).toBe("L");
  });
});
