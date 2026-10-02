import { createElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §546 — fewer words on the registration form. The owner, 2026-09-28: «sunt prea multe descrieri
 * la fiecare label!». A helper under a field stays only where it says what the label cannot: a
 * format the runner would get wrong, a legal reason, a consequence. The consents, the race's rules
 * box (§422), the birth date read back in words (§467) and the «Mai lipsesc:» list are not helpers
 * and are not counted here.
 *
 * The page is rendered on the server as a visitor meets it (no JavaScript, every fold in the
 * markup), in both languages, and two things are held:
 * - which help texts it draws — named one by one, so a new one is a decision, not a drift;
 * - how many field helpers MUI draws under a box at rest (`MuiFormHelperText-root`): one per field
 *   at most, and only on the fields named below.
 *
 * Before this pass the plain form drew 19 help texts, 12 of them under a box; after it, 10, and 6
 * under a box. The database and the async parts not about the words are stood in for, the
 * `register-page-resting.test.ts` shape.
 */
/** `waitlist`: the event's «Lista de așteptare e publică» (§628), on unless a test says otherwise. */
/** `refusal`: the terms in force carry the club's right to refuse (§NNN), off unless a test says otherwise. */
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en", list: false, familyOpen: false, waitlist: true, refusal: false }));

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
  // It asks the health note (§557), so the fold's own sentence is among the words counted here.
  askHealthNote: true,
};

vi.mock("@/db/client", () => ({
  getDb: () =>
    new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("the form's words read the database");
        },
      },
    ),
}));
vi.mock("@/modules/events/repository", () => ({
  findPublishedEventBySlug: async () => ({ ...EVENT, participantListVisibility: state.list ? "NAMES" : "HIDDEN", waitlistPublic: state.waitlist }),
}));
vi.mock("@/modules/diagnostics/neon-budget", () => ({
  readNeonBudget: async () => ({ level: "green", budget: { spent: false }, meter: null }),
  peekNeonBudgetLevel: () => "unknown",
}));
vi.mock("@/modules/registrations/bot-check", () => ({ activeBotCheckSiteKey: async () => undefined }));
vi.mock("@/modules/public-cache/reads", () => ({
  // The emails are on time (§623): the late notice draws nothing.
  cachedEmailDelay: async () => null,
  cachedAddressCap: async () => ({ registrationsPerAddress: 4 }),
  cachedFamilyRegistrationOpen: async () => state.familyOpen,
  cachedCurrentApprovedDocument: async () => ({ version: 3 }),
  cachedListStatesDisclosed: async () => state.list,
  cachedListSocialsDisclosed: async () => state.list,
  cachedRefusalDisclosed: async () => state.refusal,
  cachedPublicAvailability: async () => null,
  cachedPublishedEventBySlug: async () => ({ ...EVENT, participantListVisibility: state.list ? "NAMES" : "HIDDEN", waitlistPublic: state.waitlist }),
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
  const page = await RegisterPage({
    params: Promise.resolve({ locale: state.locale, slug: EVENT.slug }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(page);
}

/** What a reader reads: the markup's text, its entities decoded. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
}

type Leaf = [key: string, text: string];
function leaves(node: unknown, prefix: string): Leaf[] {
  if (typeof node === "string") return [[prefix, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
}

/** A help text by its key: `…Help`, `…Note`, `…Intro`, the legend, the banner, the list's states line. */
const HELP_KEY = /(Help|HelpList|Note|Intro|Legend|Banner|BannerWithList|States)$/;

/** The help texts of `Registration.*` the rendered form shows, by key. */
function helpShown(html: string, catalogue: typeof ro): string[] {
  const text = textOf(html);
  return leaves(catalogue.Registration, "")
    .filter(([key]) => HELP_KEY.test(key.split(".").pop() ?? ""))
    .filter(([, value]) => {
      // The words before a placeholder — enough to find the sentence without its values.
      const fixed = value.split("{")[0].trim();
      return fixed.length >= 12 && text.includes(fixed);
    })
    .map(([key]) => key)
    .sort();
}

/** The field helpers MUI draws under a box, at rest, by the id of the box they describe. */
function fieldHelpers(html: string): string[] {
  return [...html.matchAll(/<p[^>]*class="[^"]*MuiFormHelperText-root[^"]*"[^>]*id="([^"]+)-helper-text"/g)].map((match) => match[1]).sort();
}

/** The form's help texts, and nothing else: each one says what its label cannot. */
const PLAIN_FORM_HELP = [
  "guardianHelp", // under 18 only: required, who signs, whose email may it be
  "healthIntro", // who sees the note and when it is deleted
  "phoneHelp", // the format: the country code is chosen on the left
  "preferredLocaleHelp", // both languages come anyway; this one first
  "privacyBanner", // GDPR art. 13 at the point of collection (§323)
  "requiredLegend", // what the asterisk means
  "sexHelp", // why it is asked
  "emergencyContactHelp", // tell them, when they are rung, when it is deleted (§421)
  "socialsHelp", // the purpose, a tag is public, how to withdraw (§323)
  "stravaUrlHelp", // where the link is found in the app
];

/**
 * The field helpers under a box at rest. Gone (§546): the birth date's, the city's, the email's, the
 * club's «Opțional», the Instagram's and the health note's; the guardian's block sentence is its box's
 * one helper now.
 */
const PLAIN_FIELD_HELPERS = ["f-emergencyContactName", "f-guardianName", "f-phone", "f-preferredLocale", "f-sex", "f-stravaUrl"];

beforeEach(() => {
  state.list = false;
  state.waitlist = true;
  state.familyOpen = false;
  state.refusal = false;
  forgetLastGood();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("§546 the registration form says only what a label cannot", () => {
  for (const [locale, catalogue] of [["ro", ro], ["en", en]] as const) {
    it(`draws ${PLAIN_FORM_HELP.length} help texts on a plain event, and one helper at most under a box (${locale})`, async () => {
      state.locale = locale;
      const html = await render();
      const helpers = fieldHelpers(html);
      expect(helpShown(html, catalogue)).toEqual([...PLAIN_FORM_HELP].sort());
      expect(helpers).toEqual(PLAIN_FIELD_HELPERS);
      expect(new Set(helpers).size, "two helpers under one box").toBe(helpers.length);
    });

    it(`adds only the list's own lines on an event that publishes one (${locale})`, async () => {
      state.locale = locale;
      state.list = true;
      const html = await render();
      const shown = helpShown(html, catalogue);
      // The banner names the list's exception, the socials say how they reach it, the list tick says its states.
      expect(shown).toEqual(
        [...PLAIN_FORM_HELP.filter((key) => key !== "privacyBanner" && key !== "socialsHelp"), "privacyBannerWithList", "socialsHelpList", "listOptInStates", "listSocialsHelp"].sort(),
      );
    });
  }

  /*
    §628 — the tick's caption never promises a stage the list will not print: on an event whose waiting
    list is not public, it names the pending and the confirmed stages only.
  */
  for (const [locale, catalogue] of [["ro", ro], ["en", en]] as const) {
    it(`names the waiting-list stage under «Vreau să apar» only where the waiting list is public (${locale})`, async () => {
      state.locale = locale;
      state.list = true;
      const words = catalogue.Event.startList.states;
      const fill = (sentence: string) =>
        sentence.replace("{pending}", words.pending).replace("{waitlisted}", words.waitlisted).replace("{confirmed}", words.confirmed);
      const on = textOf(await render());
      expect(on).toContain(fill(catalogue.Registration.listOptInStates));
      state.waitlist = false;
      const off = textOf(await render());
      expect(off).toContain(fill(catalogue.Registration.listOptInStatesNoWaitlist));
      expect(off).not.toContain(fill(catalogue.Registration.listOptInStates));
      expect(catalogue.Registration.listOptInStatesNoWaitlist).not.toContain("{waitlisted}");
    });
  }

  it("states the club's limit per address under the address box once a family may register (BR-REQ-032-03, §576)", async () => {
    state.locale = "ro";
    expect(await render()).not.toContain('data-testid="address-cap-rule"');
    state.familyOpen = true;
    const html = await render();
    expect(html).toContain('data-testid="address-cap-rule"');
    expect(textOf(html)).toContain("Cu aceeași adresă de email se pot înscrie cel mult 4 persoane la un eveniment, de exemplu o familie.");
    // Under the box, never as one of its helpers (§546): the helpers under a box are unchanged.
    expect(fieldHelpers(html)).toEqual(PLAIN_FIELD_HELPERS);
    state.locale = "en";
    expect(textOf(await render())).toContain("One email address may register at most 4 people for an event, a family for instance.");
  });

  /*
    §NNN — the express box names the club refusing or cancelling a registration only while the terms in
    force carry it; otherwise §421's words, exactly. The version the tick names and the hidden field
    that posts it are the same either way, and no help text is added.
  */
  for (const [locale, catalogue] of [["ro", ro], ["en", en]] as const) {
    it(`names the club's refusal in the express box only while the terms in force carry it (${locale})`, async () => {
      state.locale = locale;
      const words = (key: "accept" | "acceptWithRefusal") => catalogue.Registration.terms[key].replace(/<\/?terms>/g, "").replace("{version}", "3");
      const off = await render();
      expect(textOf(off)).toContain(words("accept"));
      expect(textOf(off)).not.toContain(words("acceptWithRefusal"));
      state.refusal = true;
      const on = await render();
      expect(textOf(on)).toContain(words("acceptWithRefusal"));
      expect(on).toContain('name="termsVersionShown" value="3"');
      expect(helpShown(on, catalogue)).toEqual(helpShown(off, catalogue));
    });
  }

  it("keeps the words the form lost out of both catalogues, so nothing is left to drift", () => {
    for (const catalogue of [ro, en]) {
      const registration = catalogue.Registration as Record<string, unknown>;
      for (const gone of ["confidentialNote", "contactNote", "birthDateHelp", "originHelp", "emailHelp", "optional", "instagramHandleHelp", "healthNotesHelp"]) {
        expect(registration[gone], `Registration.${gone} is orphaned`).toBeUndefined();
      }
    }
  });

  it("says what is deleted in the emergency help, and who collects a minor's kit in the guardian's (§553)", () => {
    // «ne-ai dat numărul ei» then «Le ștergem…» was a plural for one number; the kit left the guardian's sentence in §546.
    expect(ro.Registration.emergencyContactHelp).toContain("Ștergem numele și numărul la șapte zile după eveniment.");
    expect(ro.Registration.emergencyContactHelp).not.toMatch(/\bLe ștergem\b/);
    expect(en.Registration.emergencyContactHelp).toContain("We delete the name and number seven days after the event.");
    expect(ro.Registration.guardianHelp).toContain("ridici kitul");
    expect(en.Registration.guardianHelp).toContain("collect the kit");
    for (const catalogue of [ro, en]) {
      expect(catalogue.Registration.emergencyContactHelp.length).toBeLessThanOrEqual(200);
      expect(catalogue.Registration.guardianHelp.length).toBeLessThanOrEqual(200);
    }
  });

  it("never hedges or begs in a text the form draws", () => {
    for (const [locale, catalogue] of [["ro", ro], ["en", en]] as const) {
      const registration = catalogue.Registration as Record<string, unknown>;
      for (const key of [...PLAIN_FORM_HELP, "privacyBannerWithList", "socialsHelpList", "listSocialsHelp", "clubNameFromMembership"]) {
        const text = registration[key] as string;
        expect(text, `${locale} ${key}`).not.toMatch(locale === "ro" ? /de obicei|vă rugăm|pur și simplu|platform/i : /usually|please|simply|platform/i);
      }
    }
  });
});
