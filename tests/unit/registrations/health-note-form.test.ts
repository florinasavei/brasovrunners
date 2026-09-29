import { createElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { healthNoteKept, healthNoteShown, withoutHealthNote } from "@/modules/registrations/domain/health-note";

/**
 * §NNN (amending §85 by §554's pattern) — the registration form asks the health note only when the
 * event's «Condiții de participare» → «Informații medicale» is ticked (`events.ask_health_note`):
 * otherwise no fold, no field, no consent, in both languages. The page is rendered on the server as a
 * visitor meets it, with the database and the async parts not about the form stood in for —
 * `kit-shirt-form.test.ts`'s shape.
 */
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en", askHealthNote: false }));

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

const eventNow = () => ({ ...EVENT, kitShirt: false, askHealthNote: state.askHealthNote });

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

beforeEach(() => {
  state.locale = "ro";
  state.askHealthNote = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("§NNN the health note is asked only when the event asks it", () => {
  it("draws no health fold, field or consent on an event that does not ask it (ro, en)", async () => {
    const html = await render();
    expect(html).not.toContain('name="healthNotes"');
    expect(html).not.toContain('name="healthConsent"');
    expect(html).not.toContain("Informații medicale — opțional");
    expect(html).not.toContain('data-testid="MedicalServicesIcon"');
    // The emergency contact is not part of the switch.
    expect(html).toContain('name="emergencyContactName"');
    state.locale = "en";
    const english = await render();
    expect(english).not.toContain('name="healthNotes"');
    expect(english).not.toContain("Health information — optional");
  });

  it("draws the fold with its field, its words and its consent on an event that asks it (ro, en)", async () => {
    state.askHealthNote = true;
    const html = await render();
    expect(html).toContain('name="healthNotes"');
    expect(html).toContain('name="healthConsent"');
    expect(html).toContain("Informații medicale — opțional");
    expect(html).toContain('data-testid="MedicalServicesIcon"');
    state.locale = "en";
    const english = await render();
    expect(english).toContain('name="healthNotes"');
    expect(english).toContain("Health information — optional");
  });

  it("keeps a note only for an event that asks it, drops a posted one before the schema, and shows one only then", () => {
    const posted = { healthNotes: "astm", healthConsentVersion: 3, healthConsentAt: new Date(0) };
    expect(healthNoteKept(true, posted)).toEqual(posted);
    expect(healthNoteKept(false, posted)).toEqual({ healthNotes: null, healthConsentVersion: null, healthConsentAt: null });
    expect(withoutHealthNote({ firstName: "Ana", healthNotes: "astm", healthConsent: true })).toEqual({ firstName: "Ana", healthNotes: undefined, healthConsent: false });
    expect(withoutHealthNote(null)).toBeNull();
    expect(healthNoteShown(false, "astm")).toBeNull();
    expect(healthNoteShown(true, "")).toBeNull();
    expect(healthNoteShown(true, "astm")).toBe("astm");
  });
});
