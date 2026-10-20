import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import { volunteersAdvertised } from "@/modules/volunteers/domain/access";
import type { VolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §835 — «Arată butonul „Vreau să fiu voluntar" pe pagina evenimentului» (BR-REQ-031-01, BR-REQ-050-02; the owner, 2026-10-20: «I want to be able to allow registration
 * for volunteers but I want to control if the button is visible on the website or not»): the rule that decides what the event's page advertises, and the
 * card's fifth tick with the volunteers' page link to copy. «Primește voluntari» keeps opening the sign-up; this only decides whether the public site
 * says so. The reads under the page are `own-page.test.ts`'s; the saving is `tests/integration/volunteers/button-shown.test.ts`.
 */
const messages = { ro, en } as const;
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (arg?: string | { locale: "ro" | "en"; namespace: string }) =>
      typeof arg === "object"
        ? createTranslator({ locale: arg.locale, messages: messages[arg.locale], namespace: arg.namespace as "Admin" })
        : createTranslator({ locale, messages: messages[locale], namespace: arg as "Admin" }),
    getLocale: async () => locale,
  };
});
vi.mock("@/db/client", () => ({ getDb: () => undefined }));
vi.mock("@/app/[locale]/admin/events/[id]/volunteer-actions", () => {
  const noop = async () => {};
  return Object.fromEntries(
    [
      "addVolunteerAction",
      "addVolunteerCategoryAction",
      "assignVolunteerAction",
      "deleteVolunteerAction",
      "deleteVolunteerCategoryAction",
      "deleteVolunteerRoleAction",
      "editVolunteerAction",
      "editVolunteerCategoryAction",
      "moveVolunteerCategoryAction",
      "saveVolunteerCategoryContactAction",
      "saveVolunteerRolesAction",
      "recordPaperVolunteerAgreementAction",
      "recordPaperVolunteerGuardianAction",
      "requestVolunteerAgreementAction",
      "requestVolunteerGuardianAction",
      "setVolunteerStateAction",
      "switchVolunteersAction",
      "switchVolunteersShirtsAction",
      "switchVolunteersCountsAction",
      "switchVolunteersListAction",
      "switchVolunteersButtonAction",
      "switchVolunteersAccessAction",
      "sendVolunteerInvitationsAction",
      "resendVolunteerInvitationAction",
      "withdrawVolunteerInvitationAction",
    ].map((name) => [name, noop]),
  );
});

const { default: VolunteersCard } = await import("@/modules/volunteers/ui/VolunteersCard");

const translate: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });
const EVENT = "11111111-1111-4111-8111-111111111111";
const WATER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-19T10:00:00Z");

const ROLE: VolunteerRole = {
  id: WATER,
  eventId: EVENT,
  nameRo: "Punct de apă",
  nameEn: "Water point",
  needed: 3,
  descriptionRo: null,
  descriptionEn: null,
  descriptionRoJson: null,
  descriptionEnJson: null,
  colour: null,
  categoryId: null,
  position: 0,
  createdAt: new Date("2026-10-14T08:00:00Z"),
};

const LINKS = {
  ro: "https://club.example.test/ro/evenimente/cursa/voluntari",
  en: "https://club.example.test/en/events/race/volunteers",
} as const;

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
}

async function drawCard(over: Partial<ComponentProps<typeof VolunteersCard>> = {}, language: "ro" | "en" = "ro") {
  locale = language;
  const drawn = (await VolunteersCard({
    locale: language,
    eventId: EVENT,
    acceptsVolunteers: true,
    volunteersShirts: false,
    volunteersShowCounts: false,
    eventDay: "2026-11-21",
    profileDescribed: true,
    minorsOpen: false,
    offerClosed: null,
    roles: [ROLE],
    categories: [],
    standings: [{ roleId: ROLE.id, needed: 3, taken: 0, confirmed: 0, free: 3 }],
    volunteers: [],
    agreementInForce: true,
    agreementNoticeDescribes: true,
    agreementDocumentIds: {},
    agreementEvent: {},
    now: NOW,
    ...over,
  })) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Translate: messages[language].Translate, Admin: messages[language].Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer: { action: translate, setupHref: null } } as ComponentProps<typeof TranslateProvider>, drawn)));
}

const buttonForm = (page: string) => /<form[^>]*data-testid="volunteer-button-form"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";

describe("§835 what the event's page advertises: the rule", () => {
  it("advertises an open offer to anyone or to the members while the tick is on, and nothing once it is off", () => {
    expect(volunteersAdvertised({ access: "ANYONE", buttonShown: true })).toBe(true);
    expect(volunteersAdvertised({ access: "MEMBERS", buttonShown: true })).toBe(true);
    expect(volunteersAdvertised({ access: "ANYONE", buttonShown: false })).toBe(false);
    expect(volunteersAdvertised({ access: "MEMBERS", buttonShown: false })).toBe(false);
  });

  it("never advertises a closed offer (null) or a by-invitation one, whatever the tick says", () => {
    expect(volunteersAdvertised(null)).toBe(false);
    expect(volunteersAdvertised({ access: "INVITED", buttonShown: true })).toBe(false);
    expect(volunteersAdvertised({ access: "INVITED", buttonShown: false })).toBe(false);
  });
});

describe("§835 the card's fifth tick: «Arată butonul „Vreau să fiu voluntar” pe pagina evenimentului»", () => {
  it("is ticked by default, a submit drawn as the checkbox that posts the state it wants, with its help and no «Salvează»", async () => {
    const page = await drawCard();
    const form = buttonForm(page);
    expect(form).toContain('type="submit"');
    expect(form).toContain('role="checkbox"');
    expect(form).toContain('aria-checked="true"');
    expect(form).toMatch(/data-testid="CheckBoxIcon"/);
    expect(form).toContain('name="on" value="0"');
    expect(form).toMatch(/<button[^>]*data-testid="volunteer-button-tick"[^>]*>[\s\S]*Arată butonul „Vreau să fiu voluntar” pe pagina evenimentului<\/button>/);
    expect(form).toContain(ro.Admin.volunteers.button.help);
    expect(form).not.toContain("Salvează");
    expect(form).not.toContain("onclick");
  });

  it("is drawn empty when the club unticked it, and posts «1» to tick it again", async () => {
    const form = buttonForm(await drawCard({ volunteersButtonShown: false }));
    expect(form).toContain('aria-checked="false"');
    expect(form).toMatch(/data-testid="CheckBoxOutlineBlankIcon"/);
    expect(form).toContain('name="on" value="1"');
  });

  it("says the same in English", async () => {
    const page = await drawCard({ volunteersButtonShown: false }, "en");
    expect(page).toContain("Show the “I want to volunteer” button on the event page");
    expect(page).toContain(en.Admin.volunteers.button.help);
  });

  it("sits with the card's other ticks, after the public-count tick", async () => {
    const page = await drawCard();
    expect(page.indexOf('data-testid="volunteer-button-form"')).toBeGreaterThan(page.indexOf('data-testid="volunteer-counts-form"'));
  });

  it("changes the open-state sentence: with the tick off the page is open but the event's page does not link to it", async () => {
    expect(await drawCard()).toContain(ro.Admin.volunteers.offer.open);
    const hidden = await drawCard({ volunteersButtonShown: false });
    expect(hidden).toContain(ro.Admin.volunteers.offer.openHidden);
    expect(hidden).not.toContain(ro.Admin.volunteers.offer.open);
    expect(await drawCard({ access: "MEMBERS", volunteersButtonShown: false })).toContain(ro.Admin.volunteers.offer.openMembersHidden);
    expect(await drawCard({ access: "MEMBERS" })).toContain(ro.Admin.volunteers.offer.openMembers);
    // By invitation the event's page says nothing either way: one sentence.
    expect(await drawCard({ access: "INVITED", volunteersButtonShown: false })).toContain(ro.Admin.volunteers.offer.openInvited);
    // A closed offer says why, not that the tick is off.
    expect(await drawCard({ offerClosed: "noRoles" as never, volunteersButtonShown: false })).not.toContain(ro.Admin.volunteers.offer.openHidden);
  });
});

describe("§835 the volunteers' page link, to copy", () => {
  it("draws the address in each language in the house's read-only box with «Copiază» beside it, while the event takes volunteers", async () => {
    for (const volunteersButtonShown of [true, false]) {
      const page = await drawCard({ pageLinks: LINKS, volunteersButtonShown });
      const block = /data-testid="volunteer-page-links"[\s\S]*$/.exec(page)?.[0] ?? "";
      expect(block, String(volunteersButtonShown)).toContain(ro.Admin.volunteers.link.title);
      for (const language of ["ro", "en"] as const) {
        const box = new RegExp(`<input[^>]*id="volunteer-page-link-${language}"[^>]*>`).exec(block)?.[0] ?? "";
        expect(box, language).toMatch(/read-?only/i);
        expect(box, language).toContain(`value="${LINKS[language]}"`);
        expect(box, language).toContain(`aria-label="${ro.Admin.volunteers.link.label[language]}"`);
      }
      expect(block.match(/data-testid="copy-code"/g)).toHaveLength(2);
      expect(block).toContain("Copiază");
    }
  });

  it("is in English in the English card", async () => {
    const page = await drawCard({ pageLinks: LINKS }, "en");
    expect(page).toContain(en.Admin.volunteers.link.title);
    expect(page).toContain(`aria-label="${en.Admin.volunteers.link.label.ro}"`);
    expect(page).toContain("Copy");
  });

  it("is drawn only while «Primește voluntari» is ticked and the event has a page: no page, no address", async () => {
    expect(await drawCard({ pageLinks: LINKS, acceptsVolunteers: false })).not.toContain('data-testid="volunteer-page-links"');
    expect(await drawCard({ pageLinks: {} })).not.toContain('data-testid="volunteer-page-links"');
    // An event with a Romanian page only offers the Romanian address only.
    const onlyRomanian = await drawCard({ pageLinks: { ro: LINKS.ro } });
    expect(onlyRomanian).toContain('id="volunteer-page-link-ro"');
    expect(onlyRomanian).not.toContain('id="volunteer-page-link-en"');
  });

  it("takes its address from the caller (APP_BASE_URL), never from a literal in the card", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/modules/volunteers/ui/VolunteersCard.tsx", "utf8");
    expect(source).not.toMatch(/https?:\/\/[a-z]/);
    const page = readFileSync("src/app/[locale]/admin/events/[id]/page.tsx", "utf8");
    expect(page).toMatch(/pageLinks:[\s\S]{0,700}env\.APP_BASE_URL/);
  });
});

describe("§835 every public entry point to the volunteers' page asks the same rule", () => {
  /** Every source file under `src/` that names the volunteers' page's route. */
  async function filesNamingTheRoute(): Promise<string[]> {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(path, "utf8").includes('"/events/[slug]/volunteers"')) found.push(path);
      }
    };
    walk("src");
    return found.sort();
  }

  it("lists every place that links to the volunteers' page: a new one has to be decided here, advertised or not", async () => {
    expect(await filesNamingTheRoute()).toEqual(
      [
        // The routing map itself, and the language switch that keeps a visitor on the page they are on.
        "src/i18n/routing.ts",
        "src/modules/events/locale-switch.ts",
        // Public and advertised: the event page's box (`VolunteerCallout`, drawn only when the event page passes `visit.volunteers`, i.e. `volunteersAdvertised`).
        "src/modules/volunteers/ui/VolunteerCallout.tsx",
        // Not advertising: the page's own form posts back to it; the members' sign-in returns to it; an invitation's email carries its personal link.
        "src/app/[locale]/events/[slug]/volunteers/actions.ts",
        "src/app/[locale]/admin/actions.ts",
        "src/app/[locale]/sign-in/page.tsx",
        "src/modules/notifications/render.ts",
        // The public cache's list of routes it files its pages under — not a link.
        "src/modules/public-cache/reads.ts",
        // The backoffice card's copy-link box builds the address with the same route.
        "src/app/[locale]/admin/events/[id]/page.tsx",
      ].sort(),
    );
  });

  it("the event page draws the box and the list's sentence only for an advertised offer — one rule, `volunteersAdvertised`", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/[locale]/events/[slug]/page.tsx", "utf8");
    expect(page).toMatch(/const advertised = volunteersAdvertised\(volunteerOffer\)/);
    expect(page).toMatch(/offerOpen: advertised/);
    expect(page).toMatch(/volunteers: volunteerRoleNames\.length > 0 && volunteerOffer && advertised \?/);
    // The volunteers' own page does not ask it: it is the one that must keep working.
    const own = readFileSync("src/app/[locale]/events/[slug]/volunteers/page.tsx", "utf8");
    expect(own).not.toMatch(/buttonShown|volunteersAdvertised/);
  });

  it("the only component that draws the box is the event page's view, and it draws it from the page's `visit.volunteers`", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = `${dir}/${name}`;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(path, "utf8").includes("import VolunteerCallout from")) users.push(path);
      }
    };
    walk("src");
    expect(users).toEqual(["src/modules/events/ui/EventPageView.tsx"]);
    expect(readFileSync(users[0], "utf8")).toMatch(/visit\?\.volunteers && !membersOnly && <VolunteerCallout/);
  });
});
