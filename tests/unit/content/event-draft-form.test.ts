import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registrationCta } from "@/modules/events/domain/registration-cta";
import type { PublicEventPage } from "@/modules/events/repository";
import type { RegistrationDoor } from "@/modules/events/ui/registration-door";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { SECOND_ATTEMPT_FIELD } from "@/modules/registrations/fields";
import { formViewOf, listOptInStatesKey } from "@/modules/registrations/form-view";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §579 as amended by this change — «Formular» in the editor's «Previzualizare»: the register page's
 * own form, drawn from an unsaved draft (`content/events/draft-form.tsx` → `registrationForm`),
 * sending nothing. The owner, 2026-09-30: «adică preview card și pagină ȘI formular de înscriere».
 *
 * What is proved here, with the database and the async parts not about the form stood in for (the
 * shape of `kit-shirt-form.test.ts`): which boxes the draft's settings switch on — a race with a
 * minimum age, a shirt and a health note; a members' run; a group run offering its declaration; a
 * window not open yet; no terms approved — and the preview state itself: no action, no field the
 * service reads, no Turnstile markup, the send button disabled with «previzualizare». The render
 * through the real action, and that nothing is written, is `tests/integration/cms/event-draft-preview.test.ts`.
 */
const state = vi.hoisted(() => ({
  locale: "ro" as "ro" | "en",
  termsVersion: 3 as number | null,
  noticeDescribesEverything: true,
}));

vi.mock("next-intl/server", async () => {
  const { createTranslator: make } = await import("next-intl");
  const ro = (await import("../../../messages/ro.json")).default;
  const en = (await import("../../../messages/en.json")).default;
  const translator = (locale: "ro" | "en", namespace: string) =>
    make({ locale, messages: (locale === "ro" ? ro : en) as Record<string, object>, namespace: namespace as "Event" });
  return {
    getLocale: async () => state.locale,
    setRequestLocale: () => {},
    getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) =>
      typeof arg === "string" ? translator(state.locale, arg) : translator(arg.locale, arg.namespace),
  };
});
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string } }) => (typeof href === "string" ? href : href.pathname),
  Link: ({ children, style }: { children: ReactNode; style?: object }) => createElement("a", { style }, children),
}));
vi.mock("@/modules/legal-documents/repository", () => ({
  findCurrentApprovedDocument: async (_db: unknown, key: string) =>
    key === "TERMS" ? (state.termsVersion === null ? undefined : { version: state.termsVersion, body: {} }) : { version: 2, body: {} },
}));
vi.mock("@/modules/legal-documents/domain/merge-fields", () => ({
  describesListStates: () => state.noticeDescribesEverything,
  describesListSocials: () => state.noticeDescribesEverything,
  describesPromotionalMaterials: () => state.noticeDescribesEverything,
  describesPromotionalMaterialsShared: () => state.noticeDescribesEverything,
}));
vi.mock("@/modules/registrations/address-cap", () => ({ readAddressCap: async () => ({ cap: { registrationsPerAddress: 4 }, updatedAt: null }) }));
vi.mock("@/modules/registrations/ui/EmailDeliveryNotice", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/RegistrationJourney", () => ({ default: () => null }));
vi.mock("@/modules/registrations/ui/RegistrationSteps", () => ({ default: () => null }));

const { renderDraftForm } = await import("@/modules/content/events/draft-form");

const NOW = new Date("2026-10-01T10:00:00.000Z");

/** A race as the editor's draft reads (`previewPageOf`): open since September, 21 November. */
const RACE = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "crosul-de-toamna",
  title: "Crosul de toamnă",
  type: "RACE",
  startsAt: new Date("2026-11-21T08:00:00.000Z"),
  timezone: "Europe/Bucharest",
  dateToBeAnnounced: false,
  timeToBeAnnounced: false,
  registrationMode: "INTERNAL",
  eventStatus: "SCHEDULED",
  registrationOpensAt: new Date("2026-09-01T00:00:00.000Z"),
  registrationOpensSoon: false,
  registrationClosesAt: null,
  publishedAt: null,
  externalRegistrationUrl: null,
  externalProvider: null,
  locationToBeAnnounced: false,
  locationName: "Parcul Tractorul",
  costType: "PAID",
  costAmount: "80 lei",
  costUrl: null,
  rulesJson: null,
  kitShirt: false,
  askHealthNote: false,
  minAge: 14,
  participantListVisibility: "HIDDEN",
  confirmationOpensDaysBefore: 7,
  confirmationDeadlineDaysBefore: 2,
  reminderHoursBefore: null,
  membersOnly: false,
  offersGroupRunDeclaration: false,
} as const;

type Draft = { -readonly [K in keyof typeof RACE]: unknown };
const draft = (change: Partial<Draft> = {}) => ({ ...RACE, ...change }) as unknown as PublicEventPage;

/** The draft's door as `draftRegistrationDoor` answers it for an event nobody is registered for. */
const doorOf = (view: PublicEventPage): RegistrationDoor => ({ kind: "KNOWN", cta: registrationCta({ ...view, availablePlaces: null }, NOW), fill: null });

async function render(view: PublicEventPage, door: RegistrationDoor = doorOf(view)): Promise<string> {
  const catalogue = state.locale === "ro" ? ro : en;
  const node = await renderDraftForm({} as never, {
    view,
    door,
    locale: state.locale,
    now: NOW,
    word: catalogue.Event.previewDoor,
    steps: { deadlines: DEFAULT_DEADLINES, familyOpen: true },
  });
  return renderToStaticMarkup(node);
}

beforeEach(() => {
  state.locale = "ro";
  state.termsVersion = 3;
  state.noticeDescribesEverything = true;
});

describe("§579 amended — which boxes the draft's settings switch on", () => {
  it("a race with a minimum age of 18, a shirt and a health note: the three are asked, and the age is said", async () => {
    const html = await render(draft({ minAge: 18, kitShirt: true, askHealthNote: true }));
    expect(html).toContain('data-testid="draft-preview-form"');
    expect(html).toContain('name="tshirtSize"');
    expect(html).toContain('name="healthNotes"');
    expect(html).toContain('name="healthConsent"');
    expect(html).toContain(ro.Registration.ageRule.minimumOnly.replace("{age}", "18 ani"));
    // The birth date's box: the latest date that still reaches 18 on race day, as the page computes it.
    expect(html).toContain(`max="${formViewOf(draft({ minAge: 18 }) as never, NOW).birthDate.latest}"`);
    expect(html).toContain('placeholder="ZZ.LL.AAAA"');
    // The cost, in the event page's words.
    expect(html).toContain("80 lei");
  });

  it("a plain race asks neither the shirt nor the health note", async () => {
    const html = await render(draft());
    expect(html).not.toContain('name="tshirtSize"');
    expect(html).not.toContain('name="healthNotes"');
    expect(html).toContain(ro.Registration.ageRule.minimumAndGuardian.replace("{age}", "14 ani"));
  });

  it("a members' run takes the account's address: named, not asked, and no family limit", async () => {
    const html = await render(draft({ type: "GROUP_RUN", membersOnly: true }));
    expect(html).toContain('data-testid="members-address"');
    expect(html).toContain(ro.Registration.preview.memberAddress);
    expect(html).not.toMatch(/name="email"/);
    expect(html).not.toContain('data-testid="address-cap-rule"');
  });

  it("a typed address says the club's limit per address (§576)", async () => {
    const html = await render(draft());
    expect(html).toContain('data-testid="address-cap-rule"');
    expect(html).toContain(ro.Registration.addressCap.people.few.replace("{count}", "4"));
  });

  it("a group run with no registration and its declaration offered: no form, and both said", async () => {
    const html = await render(draft({ type: "GROUP_RUN", registrationMode: "NONE", offersGroupRunDeclaration: true }));
    expect(html).toContain('data-testid="draft-preview-form-none"');
    expect(html).toContain(ro.Registration.preview.noForm);
    expect(html).toContain('data-testid="draft-preview-form-group-run"');
    expect(html).not.toContain("<form");
  });

  it("a window that has not opened: the line says when, in the event page's words, and the form is drawn under it", async () => {
    const html = await render(draft({ registrationOpensAt: new Date("2026-10-15T07:00:00.000Z") }));
    expect(html).toContain('data-testid="draft-preview-form-closed"');
    expect(html).toContain("Înscrierile se deschid");
    expect(html).toContain("<form");
  });

  it("a date still to be announced: no form, one line", async () => {
    const html = await render(draft({ startsAt: null, dateToBeAnnounced: true }));
    expect(html).toContain(ro.Registration.preview.dateLater);
    expect(html).not.toContain("<form");
  });

  it("a public list and a notice that describes it: the list's tick with its states, the socials and «oferte și beneficii»", async () => {
    const html = await render(draft({ participantListVisibility: "NAMES" }));
    expect(html).toContain('name="listOptIn"');
    expect(html).toContain('data-testid="list-opt-in-states"');
    expect(html).toContain('name="listSocials"');
    expect(html).toContain('name="promoConsent"');
    // «— opțional» on the optional boxes (§563).
    expect(html).toContain(ro.Registration.optionalSuffix);
  });

  it("a notice that describes none of it: no list states, no socials, no offers box", async () => {
    state.noticeDescribesEverything = false;
    const html = await render(draft({ participantListVisibility: "NAMES" }));
    expect(html).toContain('name="listOptIn"');
    expect(html).not.toContain('data-testid="list-opt-in-states"');
    expect(html).not.toContain('name="promoConsent"');
  });

  it("the terms in force are named by their version; none approved is the real form's own warning", async () => {
    expect(await render(draft())).toContain("(versiunea 3)");
    state.termsVersion = null;
    const html = await render(draft());
    expect(html).toContain('data-testid="registration-terms-missing"');
    expect(html).toContain("(versiunea —)");
  });

  it("the English form of the same draft is in English", async () => {
    state.locale = "en";
    const html = await render(draft({ kitShirt: true }));
    expect(html).toContain(en.Registration.tshirtSize);
    expect(html).toContain(`${en.Registration.submit} · ${en.Event.previewDoor}`);
    expect(html).not.toContain(ro.Registration.submit);
  });
});

describe("§579 amended — the preview state: nothing can be sent", () => {
  it("has no action, no field the service reads, and a disabled send button marked «previzualizare»", async () => {
    const html = await render(draft({ kitShirt: true, askHealthNote: true, participantListVisibility: "NAMES" }));
    const form = html.match(/<form[^>]*>/)?.[0] ?? "";
    expect(form).toContain('id="registration-form"');
    expect(form).toContain('data-preview="true"');
    expect(form).not.toContain("action=");
    for (const name of ["honeypot", "renderedAt", "slug", "locale", "termsVersionShown", SECOND_ATTEMPT_FIELD]) expect(html).not.toContain(`name="${name}"`);
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="registration-submit-preview"/);
    expect(html).toContain(`${ro.Registration.submit} · ${ro.Event.previewDoor}`);
    // The boxes are there, empty, to be typed in.
    expect(html).toContain('name="firstName"');
    expect(html).toContain('name="emailConfirm"');
  });

  it("draws no Turnstile: no widget container, no script, no token field (§577)", async () => {
    const html = await render(draft());
    expect(html).not.toMatch(/turnstile|challenges\.cloudflare|cf-turnstile-response/i);
    expect(html).not.toContain('id="f-captcha"');
    expect(html).not.toContain(ro.Legal.botCheckNotice);
  });

  it("is the register page's form, not a second one: one drawing, one reading of the event", () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    const page = read("src/app/[locale]/events/[slug]/register/page.tsx");
    const draftForm = read("src/modules/content/events/draft-form.tsx");
    for (const source of [page, draftForm]) {
      expect(source).toContain('from "@/modules/registrations/ui/registration-form"');
      expect(source).toMatch(/await registrationForm\(\{/);
      expect(source).toContain("formViewOf(");
    }
    // The preview reads nothing through the public cache, and never the bot check's key.
    expect(draftForm).not.toMatch(/cached[A-Z]|activeBotCheckSiteKey|BotCheck/);
    const form = read("src/modules/registrations/ui/registration-form.tsx");
    expect(form).not.toContain('"use client"');
    expect(form).toContain("const siteKey = preview ? undefined : settings.siteKey;");
  });
});

describe("§579 amended — formViewOf, what the form takes from the event", () => {
  it("reads the boxes, the minimum age and the bounds from the event's own settings", () => {
    const view = formViewOf(draft({ minAge: 18, kitShirt: true, askHealthNote: true, participantListVisibility: "NAMES" }) as never, NOW);
    expect(view).toMatchObject({ minAge: 18, askShirt: true, askHealth: true, publishesList: true, hasRules: false, eventDay: "2026-11-21" });
    expect(view.birthDate.latest).toBe("2008-11-21");
    expect(view.birthDate.earliest).toBe("1906-10-01");
    // A week before the race is still ahead: the steps say «confirm a week before».
    expect(view.stepsWindow).toEqual({ opensDays: 7, deadlineDays: 2 });
  });

  it("§NNN names the waiting-list stage under the tick only where the published list shows it", () => {
    const on = formViewOf(draft({ participantListVisibility: "NAMES", waitlistPublic: true } as Partial<Draft>) as never, NOW);
    expect(on.listShowsWaitlist).toBe(true);
    expect(listOptInStatesKey(on)).toBe("listOptInStates");
    const off = formViewOf(draft({ participantListVisibility: "NAMES", waitlistPublic: false } as Partial<Draft>) as never, NOW);
    expect(off.listShowsWaitlist).toBe(false);
    expect(listOptInStatesKey(off)).toBe("listOptInStatesNoWaitlist");
    // A row from before the column, and a stored truth beside a hidden list, promise nothing either.
    expect(formViewOf(draft({ participantListVisibility: "NAMES" }) as never, NOW).listShowsWaitlist).toBe(false);
    expect(formViewOf(draft({ participantListVisibility: "HIDDEN", waitlistPublic: true } as Partial<Draft>) as never, NOW).listShowsWaitlist).toBe(false);
  });

  it("never under fourteen, and no box a copy without the columns cannot answer", () => {
    const view = formViewOf(draft({ minAge: 0, kitShirt: undefined, askHealthNote: undefined }) as never, NOW);
    expect(view.minAge).toBe(14);
    expect(view.askShirt).toBe(false);
    expect(view.askHealth).toBe(false);
  });
});

describe("§579 amended — the words, both languages", () => {
  it("has every preview word in Română and English, short, plain", () => {
    expect(Object.keys(en.Registration.preview).sort()).toEqual(Object.keys(ro.Registration.preview).sort());
    for (const catalogue of [ro, en]) {
      for (const text of [...Object.values(catalogue.Registration.preview), catalogue.Admin.editor.draftPreview.form]) {
        expect(text.length).toBeLessThanOrEqual(200);
        expect(text).not.toMatch(/platform|de obicei/i);
      }
    }
    expect(ro.Admin.editor.draftPreview.form).toBe("Formular");
    expect(en.Admin.editor.draftPreview.form).toBe("Form");
  });
});
