import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import { standingOf } from "@/modules/volunteers/domain/volunteer";
import type { PublicVolunteerCategory, PublicVolunteerRole, VolunteerCategory, VolunteerItem, VolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §774 — the volunteer categories as the server draws them: the «Voluntari» card's «Categorii» fold, each role's «Categoria», the roles
 * under their headings and a role named alone as «Direcționare (Traseu)»; and the volunteers' page's form — a level-3 heading per category in the
 * club's order, only those with a role still needing people, «Alte activități» for the roles under none, and under a heading the contact
 * person as one line of `tel:` and `mailto:` links. Both languages.
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
      "addVolunteerRoleAction",
      "assignVolunteerAction",
      "deleteVolunteerAction",
      "deleteVolunteerCategoryAction",
      "deleteVolunteerRoleAction",
      "editVolunteerAction",
      "editVolunteerCategoryAction",
      "editVolunteerRoleAction",
      "moveVolunteerCategoryAction",
      "moveVolunteerRoleAction",
      "saveVolunteerCategoryContactAction",
      "recordPaperVolunteerAgreementAction",
      "recordPaperVolunteerGuardianAction",
      "requestVolunteerAgreementAction",
      "requestVolunteerGuardianAction",
      "setVolunteerStateAction",
      "switchVolunteersAction",
      "switchVolunteersShirtsAction",
      "switchVolunteersCountsAction",
    ].map((name) => [name, noop]),
  );
});
vi.mock("@/app/[locale]/events/[slug]/volunteers/actions", () => ({ submitVolunteerAction: async () => {} }));
vi.mock("@/shared/feedback/PublicFlash", async () => {
  const { createElement: element } = await import("react");
  return { default: ({ accept }: { accept: readonly string[] }) => element("div", { "data-testid": "public-flash", "data-accepts": accept.join(",") }) };
});

const { default: VolunteersCard } = await import("@/modules/volunteers/ui/VolunteersCard");
const { default: VolunteerBox } = await import("@/modules/volunteers/ui/VolunteerBox");

const translate: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });
const EVENT = "11111111-1111-4111-8111-111111111111";
const START_ID = "c1111111-1111-4111-8111-111111111111";
const ROUTE_ID = "c2222222-2222-4222-8222-222222222222";
const EMPTY_ID = "c3333333-3333-4333-8333-333333333333";
const AT = new Date("2026-10-14T08:00:00Z");

const category = (id: string, sort: number, nameRo: string, nameEn: string, contact: { name?: string; phone?: string; email?: string } = {}): VolunteerCategory => {
  const row = { contactName: contact.name ?? null, contactPhone: contact.phone ?? null, contactEmail: contact.email ?? null };
  return {
    id,
    eventId: EVENT,
    nameRo,
    nameEn,
    sort,
    ...row,
    contact: row.contactName === null && row.contactPhone === null && row.contactEmail === null ? null : { name: row.contactName, phone: row.contactPhone, email: row.contactEmail },
    createdAt: AT,
  };
};
const START = category(START_ID, 0, "Start / Sosire", "Start / Finish");
const ROUTE = category(ROUTE_ID, 1, "Traseu", "Route", { name: "Ana Popescu", phone: "+40712 345 678", email: "coordonator@club.test" });
const EMPTY = category(EMPTY_ID, 2, "Goală", "Empty");

const role = (id: string, categoryId: string | null, nameRo: string, nameEn: string, position: number): VolunteerRole => ({
  id,
  eventId: EVENT,
  nameRo,
  nameEn,
  needed: 2,
  descriptionRo: null,
  descriptionEn: null,
  descriptionRoJson: null,
  descriptionEnJson: null,
  colour: null,
  categoryId,
  position,
  createdAt: AT,
});
const AT_START = role("d1111111-1111-4111-8111-111111111111", START_ID, "Direcționare", "Guidance", 0);
const ON_ROUTE = role("d2222222-2222-4222-8222-222222222222", ROUTE_ID, "Direcționare", "Guidance", 1);
const ROUTE_WATER = role("d3333333-3333-4333-8333-333333333333", ROUTE_ID, "Punct de hidratare", "Water point", 2);
const LOOSE = role("d4444444-4444-4444-8444-444444444444", null, "Foto/Video", "Photo/Video", 3);
const ROLES = [AT_START, ON_ROUTE, ROUTE_WATER, LOOSE];

const person = (over: Partial<VolunteerItem>): VolunteerItem => ({
  id: "e1111111-1111-4111-8111-111111111111",
  eventId: EVENT,
  roleId: null,
  choiceIds: [],
  name: "Maria Test",
  email: "maria@example.test",
  phone: "+40712345678",
  state: "REGISTERED",
  source: "PUBLIC",
  message: null,
  note: null,
  age: null,
  dateOfBirth: null,
  sex: null,
  city: null,
  volunteeredBefore: false,
  clubMember: false,
  shirtSize: null,
  createdAt: AT,
  updatedAt: AT,
  agreementAcceptedAt: null,
  agreementMethod: null,
  agreementVersion: null,
  agreementRoleName: null,
  agreementLocale: null,
  agreementEventDate: null,
  agreementEventLocation: null,
  locale: "ro",
  agreementTokenExpiresAt: null,
  agreementRequestedAt: null,
  guardianName: null,
  guardianEmail: null,
  guardianAcceptedAt: null,
  guardianMethod: null,
  guardianVersion: null,
  guardianTokenExpiresAt: null,
  guardianRequestedAt: null,
  ...over,
});

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

async function drawCard(over: Partial<ComponentProps<typeof VolunteersCard>> = {}, language: "ro" | "en" = "ro") {
  locale = language;
  const roles = over.roles ?? ROLES;
  const people = over.volunteers ?? [];
  const drawn = (await VolunteersCard({
    locale: language,
    eventId: EVENT,
    acceptsVolunteers: false,
    volunteersShirts: false,
    volunteersShowCounts: false,
    eventDay: "2026-11-21",
    profileDescribed: false,
    minorsOpen: false,
    offerClosed: "off",
    roles,
    categories: [START, ROUTE, EMPTY],
    standings: roles.map((one) => standingOf(one, people)),
    volunteers: people,
    agreementInForce: true,
    agreementNoticeDescribes: true,
    agreementDocumentIds: {},
    agreementEvent: {},
    now: new Date("2026-10-14T10:00:00Z"),
    ...over,
  })) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Translate: messages[language].Translate, Admin: messages[language].Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer: { action: translate, setupHref: null } } as ComponentProps<typeof TranslateProvider>, drawn)));
}

const publicRole = (one: VolunteerRole, free: number | null = one.needed): PublicVolunteerRole => ({
  id: one.id,
  nameRo: one.nameRo,
  nameEn: one.nameEn,
  descriptionRo: null,
  descriptionEn: null,
  descriptionRoJson: null,
  descriptionEnJson: null,
  needed: one.needed,
  taken: one.needed === null || free === null ? 0 : one.needed - free,
  free,
  categoryId: one.categoryId,
});
const publicCategory = (one: VolunteerCategory): PublicVolunteerCategory => ({ id: one.id, nameRo: one.nameRo, nameEn: one.nameEn, contact: one.contact });

async function drawBox(over: Partial<ComponentProps<typeof VolunteerBox>> = {}, language: "ro" | "en" = "ro") {
  locale = language;
  const drawn = (await VolunteerBox({
    locale: language,
    slug: "cursa",
    roles: ROLES.map((one) => publicRole(one)),
    categories: [START, ROUTE, EMPTY].map(publicCategory),
    shirts: false,
    showCounts: true,
    eventDay: "2026-11-21",
    profile: false,
    minors: false,
    outcome: null,
    refused: [],
    typed: {},
    renderedAt: new Date("2026-10-14T10:00:00Z"),
    attempt: "attempt",
    ...over,
  })) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Event: messages[language].Event, Registration: messages[language].Registration } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, drawn));
}

/** The headings of the form, in the order drawn, as their words. */
const headings = (page: string) => [...page.matchAll(/<h3[^>]*data-testid="volunteer-category-heading"[^>]*>([^<]*)<\/h3>/g)].map((match) => match[1]);
/** The role boxes' ids in the order drawn: the ticks post `roleIds`. */
const optionIds = (page: string) => [...page.matchAll(/<input[^>]*name="roleIds"[^>]*>/g)].map((match) => /value="([^"]+)"/.exec(match[0])?.[1]);

describe("§774 the volunteers' page: the roles under their headings", () => {
  it("draws a level-3 heading per category in the club's order, each role under its own, and «Alte activități» for the roles under none — in both languages", async () => {
    const page = await drawBox();
    expect(headings(page)).toEqual(["Start / Sosire", "Traseu", "Alte activități"]);
    expect(page.match(/data-testid="volunteer-role-option"/g)).toHaveLength(4);
    // The roles in the order of their headings: the start's, the route's two, then the unfiled one.
    expect(optionIds(page)).toEqual([AT_START.id, ON_ROUTE.id, ROUTE_WATER.id, LOOSE.id]);
    expect(page).toContain("Punct de hidratare");
    const english = await drawBox({}, "en");
    expect(headings(english)).toEqual(["Start / Finish", "Route", "Other activities"]);
    expect(optionIds(english)).toEqual([AT_START.id, ON_ROUTE.id, ROUTE_WATER.id, LOOSE.id]);
    expect(english).toContain("Water point");
    // The group is named by its heading, for a screen reader.
    expect(page).toMatch(/role="group"[^>]*aria-labelledby="volunteer-category-c1111111-1111-4111-8111-111111111111"/);
  });

  it("does not draw a category with no role still needing people — the heading goes with the last role it had", async () => {
    // The page hands the form only the roles that still need people; a heading with none is not drawn.
    const page = await drawBox({ roles: [publicRole(ON_ROUTE), publicRole(LOOSE)] });
    expect(headings(page)).toEqual(["Traseu", "Alte activități"]);
    expect(page).not.toContain("Start / Sosire");
    expect(page).not.toContain("Goală");
  });

  it("draws no heading at all for an event with no category — the roles are listed as before — nor «Alte activități» alone", async () => {
    const flat = await drawBox({ categories: [], roles: ROLES.map((one) => publicRole({ ...one, categoryId: null })) });
    expect(headings(flat)).toEqual([]);
    expect(flat).not.toContain("Alte activități");
    expect(flat.match(/data-testid="volunteer-role-option"/g)).toHaveLength(4);
    // A cache entry written before the categories existed hands none.
    const old = await drawBox({ categories: undefined, roles: [publicRole(LOOSE)] });
    expect(headings(old)).toEqual([]);
    // Every category emptied but the loose role: one group, no headings.
    const onlyLoose = await drawBox({ roles: [publicRole(LOOSE)] });
    expect(headings(onlyLoose)).toEqual([]);
  });

  it("keeps each role's tick, description and count line exactly as before, under its heading", async () => {
    const page = await drawBox({ roles: [publicRole(ON_ROUTE, 1)], showCounts: true });
    expect(page).toContain("mai e nevoie de 1 persoană");
    expect(page).toContain(`value="${ON_ROUTE.id}"`);
    const hidden = await drawBox({ roles: [publicRole(ON_ROUTE, 1)], showCounts: false });
    expect(hidden).not.toContain("mai e nevoie de 1 persoană");
    expect(hidden).toContain(ro.Event.volunteers.needs.open);
  });
});

describe("§774 the contact person under a category's heading", () => {
  it("is one line «Întrebări? <name> · <phone> · <email>» with a tel: and a mailto: link, only for the category that has one", async () => {
    const page = await drawBox();
    expect((page.match(/data-testid="volunteer-contact"/g) ?? []).length).toBe(1);
    const line = /data-testid="volunteer-contact"[\s\S]*?<\/p>/.exec(page)?.[0] ?? "";
    expect(line).toContain("Întrebări?");
    expect(line).toContain("Ana Popescu");
    expect(line).toMatch(/href="tel:\+40712345678"[^>]*>\+40 712 345 678</);
    expect(line).toMatch(/href="mailto:coordonator@club\.test"[^>]*>coordonator@club\.test</);
    // Under the heading of its own category, not another's.
    const route = page.indexOf(">Traseu<");
    expect(page.indexOf('data-testid="volunteer-contact"')).toBeGreaterThan(route);
    expect(page.indexOf('data-testid="volunteer-contact"')).toBeLessThan(page.indexOf(">Alte activități<"));
    const english = await drawBox({}, "en");
    expect(english).toContain("Questions?");
  });

  it("gives each link a thumb's reach — the first above its words, a later one in its own 44 pixels — and the words alone where a box is empty", async () => {
    const page = await drawBox();
    const phone = /<a[^>]*data-testid="volunteer-contact-phone"[^>]*>/.exec(page)?.[0] ?? "";
    const email = /<a[^>]*data-testid="volunteer-contact-email"[^>]*>/.exec(page)?.[0] ?? "";
    expect(phone).toBeTruthy();
    expect(email).toBeTruthy();
    // Both are styled classes (Emotion): their rules are in the page's styles, not the tag; the test of the pixels is the browser's.
    expect(phone).toContain("class=");
    const nameOnly = await drawBox({ categories: [{ ...publicCategory(ROUTE), contact: { name: "Ana Popescu", phone: null, email: null } }, publicCategory(START)], roles: [publicRole(ON_ROUTE)] });
    expect(nameOnly).toContain("Ana Popescu");
    expect(nameOnly).not.toContain("tel:");
    expect(nameOnly).not.toContain("mailto:");
  });

  it("draws nothing for a category whose contact is not set, and for a contact whose three boxes are empty", async () => {
    const page = await drawBox({ categories: [START, ROUTE, EMPTY].map((one) => publicCategory({ ...one, contact: null })) });
    expect(page).not.toContain('data-testid="volunteer-contact"');
    const empty = await drawBox({ categories: [{ ...publicCategory(ROUTE), contact: { name: null, phone: null, email: null } }], roles: [publicRole(ON_ROUTE)] });
    expect(empty).not.toContain('data-testid="volunteer-contact"');
  });
});

describe("§774 the card: «Categorii», «Categoria» and the roles under their headings", () => {
  it("draws the fold with a row per category — both names, the roles under it, the arrows only where a step is possible, «Modifică» and «Persoana de contact»", async () => {
    const page = await drawCard();
    expect(page).toContain('data-testid="volunteer-categories"');
    expect(page).toContain("Categorii");
    expect((page.match(/data-testid="volunteer-category"/g) ?? []).length).toBe(3);
    expect(page).toContain("Start / Sosire");
    expect(page).toContain("/ Start / Finish");
    // The contact line of a category that has one, and «Nicio persoană de contact încă» for the others.
    expect(page).toContain("Persoana de contact: Ana Popescu · +40 712 345 678 · coordonator@club.test");
    expect((page.match(/Nicio persoană de contact încă/g) ?? []).length).toBe(2);
    // Up on the first and down on the last are not drawn: the arrows of three categories are four, not six.
    const categories = /data-testid="volunteer-categories"[\s\S]*?data-testid="volunteer-roles"/.exec(page)?.[0] ?? "";
    expect((categories.match(/name="direction"/g) ?? []).length).toBe(4);
    // «Persoana de contact»: its own form with its three boxes and its own «Salvează»; the delete asks first and says why it may refuse.
    expect(categories).toContain('name="contactName"');
    expect(categories).toContain('name="contactPhone"');
    expect(categories).toContain('name="contactEmail"');
    expect(categories).toContain("Șterge categoria");
    expect(categories).toContain("Adaugă o categorie");
    expect(ro.Admin.volunteers.category.deleteBody).toContain("nu se poate șterge");
  });

  it("holds the arrows, the names and the contact boxes in the English card as well", async () => {
    const page = await drawCard({}, "en");
    expect(page).toContain("Categories");
    expect(page).toContain("Contact person: Ana Popescu");
    expect(page).toContain("No contact person yet.");
    expect(page).toContain("Add a category");
    expect(page).toContain("Delete the category");
  });

  it("offers «Categoria» as a native choice — «Alte activități» first, then each category — on the add form and every role's «Modifică», the role's own selected", async () => {
    const page = await drawCard();
    const selects = [...page.matchAll(/<select[^>]*name="categoryId"[^>]*>[\s\S]*?<\/select>/g)].map((match) => match[0]);
    // «Adaugă un rol» and the four roles' «Modifică».
    expect(selects).toHaveLength(5);
    for (const select of selects) {
      expect([...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((match) => match[1])).toEqual(["Alte activități", "Start / Sosire", "Traseu", "Goală"]);
    }
    expect(selects.filter((select) => new RegExp(`value="${ROUTE_ID}"[^>]*selected`).test(select) || new RegExp(`selected[^>]*value="${ROUTE_ID}"`).test(select))).toHaveLength(2);
    expect(page).toContain("Categoria");
    // Not a toggle: a choice of one among several, never a button that flips.
    expect(selects.join("")).not.toContain('role="checkbox"');
  });

  it("draws no «Categoria» box while the event has no category, so a save leaves every role where it is", async () => {
    const page = await drawCard({ categories: [], roles: ROLES.map((one) => ({ ...one, categoryId: null })) });
    expect(page).not.toContain('name="categoryId"');
    expect(page).toContain("Nicio categorie încă");
    expect(page).not.toContain('data-testid="volunteer-role-group-heading"');
  });

  it("lists the roles under their category's heading in the category order, the loose ones last, and moves only inside a heading", async () => {
    const page = await drawCard();
    const groups = [...page.matchAll(/data-testid="volunteer-role-group-heading"[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(groups).toEqual(["Start / Sosire", "Traseu", "Alte activități"]);
    // The route's two roles: «up» on the first and «down» on the last are not drawn; the start's single role and the loose one move nowhere.
    const roleList = /data-testid="volunteer-role-groups"[\s\S]*?data-testid="volunteer-role-add"/.exec(page)?.[0] ?? "";
    expect((roleList.match(/name="direction"/g) ?? []).length).toBe(2);
    // A role's own header stays its name; the category is the heading above it.
    expect(roleList).toContain("Punct de hidratare");
  });

  it("names a role alone with its category — the assignment buttons and select, the chips, the person's boxes, the group of its people — and the band's sample by the role only", async () => {
    const maria = person({ choiceIds: [ON_ROUTE.id, LOOSE.id] });
    const page = await drawCard({ volunteers: [maria] });
    // «Dă-i rolul …» on the offer, one per role ticked, with how it stands.
    expect(page).toContain("Direcționare (Traseu) · 0 din 2");
    expect(page).toContain("Foto/Video · 0 din 2");
    // The roles the person offered for, as chips.
    expect(page).toMatch(/data-testid="volunteer-choice"[^>]*>[\s\S]*?Direcționare \(Traseu\)/);
    // The select of the other roles and the person's boxes name every role with its heading, so the two «Direcționare» are told apart.
    expect(page).toContain("Direcționare (Start / Sosire)");
    // The people grouped by role: the heading names it with its category.
    expect(/<section[^>]*aria-label="Direcționare \(Traseu\)"[^>]*data-testid="volunteer-group"/.test(page)).toBe(true);
    // The badge's band shows the role only.
    expect(page).not.toMatch(/data-testid="volunteer-role-colour"[^>]*>[^<]*\(Traseu\)/);
    const english = await drawCard({ volunteers: [maria] }, "en");
    expect(english).toContain("Guidance (Route)");
    expect(english).toContain("Guidance (Start / Finish)");
  });
});

describe("§782 a role without a number", () => {
  const NO_NUMBER: VolunteerRole = { ...ROUTE_WATER, needed: null };
  const given = (state: "REGISTERED" | "CONFIRMED") => person({ roleId: NO_NUMBER.id, choiceIds: [NO_NUMBER.id], state });
  const standingChips = (page: string) => [...new Set([...page.matchAll(/data-testid="volunteer-role-standing"[^>]*>(?:<[^>]*>)*([^<]*)</g)].map((match) => match[1]))];
  const tickTags = (page: string) => [...page.matchAll(/<input[^>]*name="unlimited"[^>]*>/g)].map((match) => match[0]);

  it("reads «3 · fără număr» in its header where a numbered role reads «0 din 2», and is never drawn as full", async () => {
    const people = [given("CONFIRMED"), { ...given("REGISTERED"), id: "e2222222-2222-4222-8222-222222222222" }, { ...given("CONFIRMED"), id: "e3333333-3333-4333-8333-333333333333" }];
    const page = await drawCard({ roles: [AT_START, NO_NUMBER], volunteers: people });
    expect(standingChips(page)).toEqual(["0 din 2", "3 · fără număr"]);
    expect(standingChips(await drawCard({ roles: [AT_START, NO_NUMBER], volunteers: people }, "en"))).toEqual(["0 of 2", "3 · no limit"]);
  });

  it("counts only the numbered roles in the card's summary and adds «+ roluri fără număr» when there is any", async () => {
    const people = [given("CONFIRMED"), { ...given("CONFIRMED"), id: "e2222222-2222-4222-8222-222222222222" }, person({ id: "e4444444-4444-4444-8444-444444444444", roleId: AT_START.id, state: "CONFIRMED" })];
    const mixed = await drawCard({ roles: [AT_START, ON_ROUTE, NO_NUMBER], volunteers: people });
    expect(mixed).toContain("1 din 4 + roluri fără număr");
    expect(await drawCard({ roles: [AT_START, ON_ROUTE, NO_NUMBER], volunteers: people }, "en")).toContain("1 of 4 + roles with no limit");
    // No role without a number: the sentence is the old one, and says nothing of them.
    const numbered = await drawCard({ roles: [AT_START, ON_ROUTE], volunteers: people });
    expect(numbered).toContain("1 din 4");
    expect(numbered).not.toContain("fără număr");
    // Only roles without a number: the people in them, with no «din».
    const only = await drawCard({ roles: [NO_NUMBER], volunteers: people });
    expect(only).toContain("2 în roluri fără număr");
  });

  it("says «fără număr» beside the role's name where an organizer gives it to someone", async () => {
    const waiting = person({ id: "e5555555-5555-4555-8555-555555555555", roleId: null, choiceIds: [NO_NUMBER.id] });
    const page = await drawCard({ roles: [AT_START, NO_NUMBER], volunteers: [waiting, given("CONFIRMED")], acceptsVolunteers: true });
    expect(page).toContain("Punct de hidratare (Traseu) · 1 · fără număr");
    expect(page).toContain("Direcționare (Start / Sosire) · 0 din 2");
  });

  it("draws the tick «Fără număr — oricâți oameni» beside «Câți oameni trebuie» in every role form, ticked only on the role without a number, and the number box never required", async () => {
    const page = await drawCard({ roles: [AT_START, NO_NUMBER] });
    // «Adaugă un rol» and one «Modifică» per role: three forms, one tick each — a native checkbox, so a form without scripts posts it.
    const ticks = tickTags(page);
    expect(ticks).toHaveLength(3);
    expect(ticks.every((tag) => /type="checkbox"/.test(tag))).toBe(true);
    expect(ticks.filter((tag) => /\schecked(=|\s|>)/.test(tag))).toHaveLength(1);
    expect(page).toContain("Fără număr — oricâți oameni");
    expect((page.match(/data-testid="volunteer-role-needed-group"/g) ?? []).length).toBe(3);
    // The number box stays in the markup (scripts off: it is shown and ignored while the tick is on) and is not `required`.
    const boxes = [...page.matchAll(/<input[^>]*name="needed"[^>]*>/g)].map((match) => match[0]);
    expect(boxes).toHaveLength(3);
    expect(boxes.some((tag) => /\srequired(=|\s|>)/.test(tag))).toBe(false);
    // The help names both ways.
    expect(page).toContain("Cel puțin 1, sau bifează „Fără număr” mai jos.");
    expect(page).toContain("Nebifat, scrie mai sus un număr de cel puțin 1.");
    const english = await drawCard({ roles: [AT_START, NO_NUMBER] }, "en");
    expect(english).toContain("No limit — any number of people");
    expect(english).toContain("At least 1, or tick “No limit” below.");
  });

  it("hides the number box with the stylesheet alone while the tick is on, so no script is needed", async () => {
    locale = "ro";
    const drawn = (await VolunteersCard({
      locale: "ro",
      eventId: EVENT,
      acceptsVolunteers: false,
      volunteersShirts: false,
      volunteersShowCounts: false,
      eventDay: "2026-11-21",
      profileDescribed: false,
      minorsOpen: false,
      offerClosed: "off",
      roles: [NO_NUMBER],
      categories: [START, ROUTE, EMPTY],
      standings: [standingOf(NO_NUMBER, [])],
      volunteers: [],
      agreementInForce: true,
      agreementNoticeDescribes: true,
      agreementDocumentIds: {},
      agreementEvent: {},
      now: new Date("2026-10-14T10:00:00Z"),
    })) as ReactElement;
    const { NextIntlClientProvider } = await import("next-intl");
    const intl = { locale: "ro", messages: { Translate: messages.ro.Translate, Admin: messages.ro.Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
    const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer: { action: translate, setupHref: null } } as ComponentProps<typeof TranslateProvider>, drawn)), { onError: () => {} });
    await stream.allReady;
    const page = await new Response(stream).text();
    expect(page).toMatch(/:has\(input\[name=['"]?unlimited['"]?\]:checked\)\s*\[data-needed-box\]\{display:none/);
    expect(page).toContain("data-needed-box");
  });

  it("is offered on the volunteers' page whatever it was given, and says «mai sunt locuri» — never a number — even with the counts on", async () => {
    const page = await drawBox({ roles: [publicRole(ON_ROUTE, 1), publicRole(NO_NUMBER, null)], showCounts: true });
    expect(optionIds(page)).toEqual([ON_ROUTE.id, NO_NUMBER.id]);
    expect(page).toContain("mai e nevoie de 1 persoană");
    const tile = page.split('data-testid="volunteer-role-option"')[2] ?? "";
    expect(tile).toContain(ro.Event.volunteers.needs.open);
    expect(tile).not.toMatch(/mai (e|sunt) (nevoie|necesare)/);
    const english = await drawBox({ roles: [publicRole(NO_NUMBER, null)], showCounts: true }, "en");
    expect(english).toContain(en.Event.volunteers.needs.open);
    expect(english).not.toMatch(/more people needed|1 more person/);
  });
});
