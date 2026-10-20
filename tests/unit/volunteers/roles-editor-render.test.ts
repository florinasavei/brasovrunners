import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import { standingOf } from "@/modules/volunteers/domain/volunteer";
import type { VolunteerCategory, VolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §791 — the event editor's «Roluri» card as the server draws it (the owner, 2026-10-16: «mai bine grupate … un Save All»; «taburi și traducere
 * automată cu AI din RO în EN»): a named sub-card per category with «4 roluri» and the contact person, one compact row per role, ONE form around
 * every row with ONE «Salvează toate rolurile», each role's delete a small form beside it (never nested), the blank row at the end of each
 * category, «Mai multe» inside the form with the description as one Română | English strip and the band's colour, the house's translate buttons.
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

const para = (text: string) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text }] });
const role = (id: string, categoryId: string | null, nameRo: string, nameEn: string, position: number, over: Partial<VolunteerRole> = {}): VolunteerRole => ({
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
  ...over,
});
const AT_START_ID = "d1111111-1111-4111-8111-111111111111";
const ON_ROUTE_ID = "d2222222-2222-4222-8222-222222222222";
const WATER_ID = "d3333333-3333-4333-8333-333333333333";
const LOOSE_ID = "d4444444-4444-4444-8444-444444444444";
const AT_START = role(AT_START_ID, START_ID, "Direcționare", "Guidance", 0);
const ON_ROUTE = role(ON_ROUTE_ID, ROUTE_ID, "Direcționare", "Guidance", 1, {
  descriptionRo: "Stai la kilometrul 3.",
  descriptionEn: "Stand at kilometre 3.",
  descriptionRoJson: { type: "doc", content: [para("Stai la kilometrul 3.")] },
  descriptionEnJson: { type: "doc", content: [para("Stand at kilometre 3.")] },
  colour: "#1b5e20",
});
const WATER = role(WATER_ID, ROUTE_ID, "Punct de hidratare", "Water point", 2);
const LOOSE = role(LOOSE_ID, null, "Foto/Video", "Photo/Video", 3, { needed: null });
const ROLES = [AT_START, ON_ROUTE, WATER, LOOSE];

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

async function drawCard(over: Partial<ComponentProps<typeof VolunteersCard>> = {}, language: "ro" | "en" = "ro", offer: ComponentProps<typeof TranslateProvider>["offer"] = { action: translate, setupHref: null }) {
  locale = language;
  const roles = over.roles ?? ROLES;
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
    standings: roles.map((one) => standingOf(one, [])),
    volunteers: [],
    agreementInForce: true,
    agreementNoticeDescribes: true,
    agreementDocumentIds: {},
    agreementEvent: {},
    now: new Date("2026-10-14T10:00:00Z"),
    ...over,
  })) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Translate: messages[language].Translate, Admin: messages[language].Admin } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return html(createElement(NextIntlClientProvider, intl, createElement(TranslateProvider, { offer } as ComponentProps<typeof TranslateProvider>, drawn)));
}

/** The one form of «Salvează toate rolurile»: from its tag to its closing tag — forms never nest, so the first `</form>` is its own. */
const formOf = (page: string) => /<form[^>]*data-testid="volunteer-roles-form"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";

describe("§791 the roles are grouped in a sub-card per category", () => {
  it("draws a named card per category in the club's order — an empty one too — with the glyph, «N roluri» beside the title and the contact person under it, «Alte roluri» last", async () => {
    const page = await drawCard();
    const cards = [...page.matchAll(/<section[^>]*id="box-volunteer-roles-([^"]*)"[^>]*data-testid="volunteer-role-group"[^>]*>([\s\S]*?)<\/section>/g)];
    expect(cards.map((card) => card[1])).toEqual([START_ID, ROUTE_ID, EMPTY_ID, "other"]);
    const heading = (index: number) => /<h4[^>]*>([\s\S]*?)<\/h4>/.exec(cards[index][2])?.[1] ?? "";
    expect(heading(0).replace(/<[^>]*>/g, "")).toBe("Start / Sosire1 rol");
    expect(heading(1).replace(/<[^>]*>/g, "")).toBe("Traseu2 roluri");
    expect(heading(2).replace(/<[^>]*>/g, "")).toBe("Goală0 roluri");
    expect(heading(3).replace(/<[^>]*>/g, "")).toBe("Alte roluri1 rol");
    // The volunteers' glyph before every title, never colour alone, and the count muted beside it.
    for (let index = 0; index < 4; index += 1) expect(heading(index)).toContain("<svg");
    // The contact person's line (§774) under the route's title — and under no other, which has none.
    expect(cards[1][2]).toContain("Persoana de contact: Ana Popescu · +40 712 345 678 · coordonator@club.test");
    expect(cards.filter((card) => card[2].includes("Persoana de contact:"))).toHaveLength(1);
    // The roles stand under their own card, the loose one in «Alte roluri».
    expect(cards[0][2]).toContain(`data-role-id="${AT_START_ID}"`);
    expect(cards[1][2]).toContain(`data-role-id="${ON_ROUTE_ID}"`);
    expect(cards[1][2]).toContain(`data-role-id="${WATER_ID}"`);
    expect(cards[3][2]).toContain(`data-role-id="${LOOSE_ID}"`);
    // Sub-cards of the roles' card, never a fold that could shut a required box away.
    expect(page).not.toMatch(/<details[^>]*data-testid="volunteer-role-group"/);
  });

  it("says the same in English", async () => {
    const page = await drawCard({}, "en");
    expect(page).toContain("Other roles");
    expect(page).toContain("Save all roles");
    expect(page).toMatch(/<h4[^>]*>[\s\S]*?Route[\s\S]*?2 roles<\/span>/);
    expect(page).toContain("Contact person: Ana Popescu");
    expect(page).toContain("Change what you like on any number of roles, then press “Save all roles” once.");
  });

  it("draws no sub-card while the event has no category: the rows are listed as they were, with the blank row last", async () => {
    const page = await drawCard({ categories: [], roles: ROLES.map((one) => ({ ...one, categoryId: null })) });
    expect(page).not.toContain('data-testid="volunteer-role-group"');
    expect((page.match(/data-testid="volunteer-role"/g) ?? []).length).toBe(4);
    expect((page.match(/data-testid="volunteer-role-new"/g) ?? []).length).toBe(1);
    expect(page).toContain("roles[new-none].nameRo");
  });
});

describe("§791 one form for every role", () => {
  it("is ONE form around every row, with ONE submit button «Salvează toate rolurile» at its end", async () => {
    const page = await drawCard();
    const form = formOf(page);
    expect(form).not.toBe("");
    // Forms do not nest: no second `<form` between the opening tag and its end.
    expect(form.slice(1).includes("<form")).toBe(false);
    // Every role's boxes and every blank row's are in it.
    for (const id of [AT_START_ID, ON_ROUTE_ID, WATER_ID, LOOSE_ID, `new-${START_ID}`, `new-${ROUTE_ID}`, `new-${EMPTY_ID}`, "new-none"]) {
      expect(form, id).toContain(`name="roles[${id}].nameRo"`);
      expect(form, id).toContain(`name="roles[${id}].nameEn"`);
      expect(form, id).toContain(`name="roles[${id}].needed"`);
      expect(form, id).toContain(`name="roles[${id}].position"`);
      expect(form, id).toContain(`name="roles[${id}].categoryId"`);
    }
    // The only submit that belongs to it is the one at the bottom: the delete buttons name the small forms beside it.
    const submits = [...form.matchAll(/<button[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]).filter((button) => !/\sform="/.test(button));
    expect(submits).toHaveLength(1);
    expect(submits[0].replace(/<[^>]*>/g, "")).toBe("Salvează toate rolurile");
    expect(submits[0]).toContain("<svg");
    expect(form.lastIndexOf(submits[0])).toBeGreaterThan(form.lastIndexOf('name="roles['));
    // The old verbs are gone from the form: no arrows, no «Adaugă rolul», no «Modifică» fold with a save of its own.
    expect(form).not.toContain('name="direction"');
    expect(form).not.toContain("Adaugă rolul");
    expect(form).not.toContain("Mută mai sus");
    expect(page).not.toContain('data-testid="volunteer-role-add"');
  });

  it("keeps «Șterge rolul» out of it: a button per saved role naming a small hidden form of its own, which stands beside the big one, with the confirmation's words", async () => {
    const page = await drawCard();
    const form = formOf(page);
    const buttons = [...form.matchAll(/<button[^>]*data-testid="volunteer-role-delete"[^>]*>/g)].map((match) => match[0]);
    expect(buttons).toHaveLength(4);
    for (const id of [AT_START_ID, ON_ROUTE_ID, WATER_ID, LOOSE_ID]) {
      expect(buttons.some((tag) => tag.includes(`form="delete-role-${id}"`) && tag.includes('type="submit"')), id).toBe(true);
      // The form it names is not inside the big one — HTML forms do not nest — and is hidden, holding the role's id.
      expect(form).not.toContain(`id="delete-role-${id}"`);
      const small = new RegExp(`<form[^>]*id="delete-role-${id}"[^>]*>[\\s\\S]*?</form>`).exec(page)?.[0] ?? "";
      expect(small, id).toMatch(/\shidden(=|\s|>)/);
      expect(small, id).toContain(`name="roleId" value="${id}"`);
      expect(page.indexOf(small)).toBeGreaterThan(page.indexOf(form) + form.length - 1);
    }
    // The button says what it does and to whom, and the delete is destructive in the house's way (red, outlined, a glyph).
    expect(buttons[0]).toContain("aria-label=\"Șterge rolul: Direcționare (Start / Sosire)\"");
    expect(buttons[0]).toContain("MuiButton-colorError");
    expect(form).toContain("Șterge rolul");
    // Only the saved roles have one: not the blank rows.
    expect((page.match(/id="delete-role-/g) ?? []).length).toBe(4);
  });

  it("draws, per role, one line of boxes — «Nume (RO)», «Nume (EN)», «Câte persoane» with «Nelimitat», «Categoria», «Poziția» — with the chip and the band's sample beside the names", async () => {
    const page = await drawCard();
    const row = (id: string) => new RegExp(`<li[^>]*data-role-id="${id}"[\\s\\S]*?</li>`).exec(page)?.[0] ?? "";
    const water = row(WATER_ID);
    for (const label of ["Nume (RO)", "Nume (EN)", "Câte persoane", "Nelimitat", "Categoria", "Poziția"]) expect(water, label).toContain(label);
    // The names, as saved; both required on a saved role.
    expect(water).toMatch(new RegExp(`<input[^>]*name="roles\\[${WATER_ID}\\].nameRo"[^>]*value="Punct de hidratare"|<input[^>]*value="Punct de hidratare"[^>]*name="roles\\[${WATER_ID}\\].nameRo"`));
    expect(/<input[^>]*name="roles\[[^"]*\]\.nameRo"[^>]*>/.exec(water)?.[0]).toMatch(/\srequired(=|\s|>)/);
    // «Poziția» from 1 within its category: the route's two roles are 1 and 2.
    const position = (id: string) => new RegExp(`<input[^>]*name="roles\\[${id}\\].position"[^>]*>`).exec(page)?.[0] ?? "";
    expect(position(ON_ROUTE_ID)).toContain('value="1"');
    expect(position(WATER_ID)).toContain('value="2"');
    expect(position(AT_START_ID)).toContain('value="1"');
    // The number and the tick; ticked only on the role without a number.
    expect(/<input[^>]*name="roles\[[^"]*\]\.needed"[^>]*>/.exec(water)?.[0]).toContain('value="2"');
    expect(/<input[^>]*\.unlimited"[^>]*>/.exec(water)?.[0]).not.toMatch(/\schecked(=|\s|>)/);
    expect(/<input[^>]*\.unlimited"[^>]*>/.exec(row(LOOSE_ID))?.[0]).toMatch(/\schecked(=|\s|>)/);
    // «N din M» and the band's sample stay beside the names, in words.
    expect(water).toContain('data-testid="volunteer-role-standing"');
    expect(water).toContain('data-testid="volunteer-role-colour"');
    // The category: the role's own selected.
    expect(/<select[^>]*name="roles\[[^"]*\]\.categoryId"[\s\S]*?<\/select>/.exec(water)?.[0]).toMatch(new RegExp(`value="${ROUTE_ID}"[^>]*selected|selected[^>]*value="${ROUTE_ID}"`));
  });
});

describe("§791 the blank row adds a role", () => {
  it("ends every sub-card with one empty «Rol nou» row of the same boxes — no name, no tick, no delete — whose names are not required", async () => {
    const page = await drawCard();
    const cards = [...page.matchAll(/<section[^>]*id="box-volunteer-roles-([^"]*)"[^>]*data-testid="volunteer-role-group"[^>]*>([\s\S]*?)<\/section>/g)];
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      const blanks = card[2].match(/data-testid="volunteer-role-new"/g) ?? [];
      expect(blanks, card[1]).toHaveLength(1);
      // The last row of the card: nothing of a saved role comes after it.
      expect(card[2].lastIndexOf('data-testid="volunteer-role-new"')).toBeGreaterThan(card[2].lastIndexOf('data-testid="volunteer-role"'));
    }
    const blank = /<li[^>]*data-testid="volunteer-role-new"[\s\S]*?<\/li>/.exec(cards[1][2])?.[0] ?? "";
    expect(blank).toContain("Rol nou");
    expect(blank).toContain(`name="roles[new-${ROUTE_ID}].nameRo"`);
    expect(blank).toContain(`name="roles[new-${ROUTE_ID}].nameEn"`);
    expect(/<input[^>]*name="roles\[[^"]*\]\.nameRo"[^>]*>/.exec(blank)?.[0]).not.toMatch(/\srequired(=|\s|>)/);
    expect(/<input[^>]*name="roles\[[^"]*\]\.nameRo"[^>]*>/.exec(blank)?.[0]).toMatch(/value=""/);
    expect(/<input[^>]*name="roles\[[^"]*\]\.unlimited"[^>]*>/.exec(blank)?.[0]).not.toMatch(/\schecked(=|\s|>)/);
    // Its category starts on the card it ends, its position says it goes last, and it has no delete.
    expect(/<select[^>]*name="roles\[[^"]*\]\.categoryId"[\s\S]*?<\/select>/.exec(blank)?.[0]).toMatch(new RegExp(`value="${ROUTE_ID}"[^>]*selected|selected[^>]*value="${ROUTE_ID}"`));
    expect(/<input[^>]*name="roles\[[^"]*\]\.position"[^>]*>/.exec(blank)?.[0]).toContain('placeholder="ultimul"');
    expect(blank).not.toContain("volunteer-role-delete");
    // Its fold is there too, so a description and a colour can be typed with the name.
    expect(blank).toContain('data-testid="volunteer-role-more"');
  });
});

describe("§791 «Mai multe»: the description as one strip of two tabs, and the colour, inside the form", () => {
  it("holds, in each row's fold inside the one form, one Română | English strip over the two editors, and the band's colour outside the tabs", async () => {
    const page = await drawCard();
    const form = formOf(page);
    expect((form.match(/data-testid="volunteer-role-more"/g) ?? []).length).toBe(8);
    expect((page.match(/data-testid="volunteer-role-more"/g) ?? []).length).toBe(8);
    const row = new RegExp(`<li[^>]*data-role-id="${ON_ROUTE_ID}"[\\s\\S]*?</li>`).exec(page)?.[0] ?? "";
    const more = row.slice(row.indexOf('data-testid="volunteer-role-more"'));
    // The fold's title and, beside it, the description's first line.
    expect(more).toMatch(/<summary[\s\S]*?Mai multe[\s\S]*?Stai la kilometrul 3\./);
    // ONE strip: a tab row with two tabs, not two folds side by side.
    expect((more.match(/data-locale-tabs=""/g) ?? []).length).toBe(1);
    expect(more).toContain(`id="role-${ON_ROUTE_ID}-tab-ro"`);
    expect(more).toContain(`id="role-${ON_ROUTE_ID}-tab-en"`);
    expect((more.match(/role="tab"/g) ?? []).length).toBe(2);
    // The Romanian panel on top, the English one hidden but in the form (it posts), its editor a closed fold that mounts when opened (§96, §363).
    const panel = (language: string) => new RegExp(`<div[^>]*role="tabpanel"[^>]*id="role-${ON_ROUTE_ID}-panel-${language}"[^>]*>`).exec(more)?.[0] ?? "";
    expect(panel("ro")).not.toMatch(/\shidden(=|\s|>)/);
    expect(panel("en")).toMatch(/\shidden(=|\s|>)/);
    expect(more).toContain(`data-rich-text-fold="roles[${ON_ROUTE_ID}].descriptionRoBody"`);
    expect(more).toContain(`data-rich-text-fold="roles[${ON_ROUTE_ID}].descriptionEnBody"`);
    expect(more).toMatch(new RegExp(`<input type="hidden"[^>]*name="roles\\[${ON_ROUTE_ID}\\]\\.descriptionEnBody"[^>]*Stand at kilometre 3`));
    // Not mounted on the server: no editor's own toolbar for either language until its fold is opened.
    expect(more).not.toContain("tiptap");
    // The colour is the badge's two boxes, outside the strip.
    const afterTabs = more.slice(more.lastIndexOf("role-" + ON_ROUTE_ID + "-panel-en"));
    expect(afterTabs).toContain(`name="roles[${ON_ROUTE_ID}].colourChoice"`);
    expect(afterTabs).toContain(`name="roles[${ON_ROUTE_ID}].colourTyped"`);
    expect(more.slice(0, more.indexOf(`id="role-${ON_ROUTE_ID}-panel-ro"`))).not.toContain("colourChoice");
    // The description's tabs say the languages in their own words.
    expect(more).toContain("Română");
    expect(more).toContain("English");
  });

  it("names every editor's box by its role, in both languages, so the translate buttons find the twins and the two folds are one", async () => {
    const page = await drawCard();
    for (const id of [AT_START_ID, ON_ROUTE_ID, WATER_ID, LOOSE_ID, `new-${START_ID}`, "new-none"]) {
      expect(page, id).toContain(`name="roles[${id}].descriptionRoBody"`);
      expect(page, id).toContain(`name="roles[${id}].descriptionEnBody"`);
    }
    expect(page).toContain("Descrierea rolului (Română, opțional)");
    expect(page).toContain("Descrierea rolului (English, opțional)");
  });
});

describe("§791 the translate buttons are the house's own, once per level", () => {
  it("puts «Tradu cardul: RO → EN» once in the card's header, inside the form and its scope, and «Tradu din română» under each English name and description", async () => {
    const page = await drawCard();
    const form = formOf(page);
    expect((page.match(/data-testid="translate-card"/g) ?? []).length).toBe(1);
    expect(form).toContain('data-testid="translate-card"');
    // In the header row: before the first sub-card, after the scope opens.
    expect(form.indexOf('data-translate-scope="Roluri"')).toBeLessThan(form.indexOf('data-testid="translate-card"'));
    expect(form.indexOf('data-testid="translate-card"')).toBeLessThan(form.indexOf('data-testid="volunteer-role-group"'));
    for (const id of [AT_START_ID, ON_ROUTE_ID, WATER_ID, LOOSE_ID, `new-${ROUTE_ID}`]) {
      expect(form, id).toContain(`data-translate-for="roles[${id}].nameEn"`);
      expect(form, id).toContain(`data-translate-for="roles[${id}].descriptionEnBody"`);
    }
    // One strip per role never draws a card button of its own (`translateCard` is not set on them): only the header's, so it translates the whole card once.
    expect((page.match(/data-translate-card=""/g) ?? []).length).toBe(1);
  });

  it("greys them with the editor's own reason while the provider is off, and says it once for the card", async () => {
    const off = await drawCard({}, "ro", { action: null, setupHref: "/admin/tasks#translate" } as never);
    expect(off).toContain('data-testid="translate-card-off"');
    expect(off).toContain('data-reason="off"');
    expect(off).toContain(ro.Translate.off);
    expect((off.match(/data-testid="translate-card-off"/g) ?? []).length).toBe(1);
    expect(off).not.toContain('data-testid="translate-card"');
    expect(off).not.toContain("data-translate-for=");
    // The spent credit says so, with the same words as everywhere.
    const spent = await drawCard({}, "ro", { action: null, spent: true, setupHref: null, costsHref: "/admin/costs" } as never);
    expect(spent).toContain('data-reason="spent"');
  });

  it("names each row for the translate dialog, so «Nume (EN)» is told apart from row to row", async () => {
    const page = await drawCard();
    expect(page).toContain(`data-translate-row="Punct de hidratare"`);
    expect(page).toContain(`data-translate-row="Rol nou"`);
  });
});

describe("§791 the words", () => {
  it("says the new way under the title in both languages, plain words, no sentence over 200 characters, and the toast counts", () => {
    for (const words of [ro.Admin.volunteers.rolesIntro, en.Admin.volunteers.rolesIntro]) {
      for (const sentence of words.split(/(?<=[.!?”])\s+/)) expect(sentence.length).toBeLessThanOrEqual(200);
    }
    expect(ro.Admin.volunteers.rolesIntro).toContain("Poziția dă ordinea din categorie; un rând gol la final adaugă un rol.");
    expect(ro.Feedback.toast.volunteerRolesSaved).toEqual({ one: "Am salvat {count} rol.", few: "Am salvat {count} roluri.", other: "Am salvat {count} de roluri." });
    expect(ro.Feedback.toast.volunteerRolesUnchanged).toBe("Nimic de schimbat la roluri.");
    expect(en.Feedback.toast.volunteerRolesSaved.one).toBe("Saved {count} role.");
    expect(en.Admin.errors.VOLUNTEER_ROLE_INVALID).toContain("{role}");
    expect(ro.Admin.errors.VOLUNTEER_ROLE_INVALID).toBe("„{role}” din „{category}”: {problem}. Nimic nu s-a salvat.");
  });
});

describe("§791 what each row remembers, how it is named, and what hides behind the «?»", () => {
  const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  const decode = (value: string) => JSON.parse(value.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as Record<string, unknown>;

  it("draws, in every saved role's row and in no blank row, a hidden «was» box holding the role as drawn — names, number, category, colour, its place among its category's roles — so a save can tell what the person touched", async () => {
    const page = await drawCard();
    const was = (id: string) => /<input[^>]*type="hidden"[^>]*name="roles\[[^"]*\]\.was"[^>]*>/.exec(new RegExp(`<li[^>]*data-role-id="${id}"[\\s\\S]*?</li>`).exec(page)?.[0] ?? "")?.[0] ?? "";
    const value = (tag: string) => /value="([^"]*)"/.exec(tag)?.[1] ?? "";
    expect(decode(value(was(ON_ROUTE_ID)))).toMatchObject({ nameRo: "Direcționare", nameEn: "Guidance", needed: 2, categoryId: ROUTE_ID, colour: "#1b5e20", rank: 1 });
    expect(decode(value(was(WATER_ID)))).toMatchObject({ nameRo: "Punct de hidratare", needed: 2, categoryId: ROUTE_ID, colour: null, rank: 2 });
    expect(decode(value(was(LOOSE_ID)))).toMatchObject({ needed: null, categoryId: null, rank: 1 });
    expect(page.match(/\.was"/g) ?? []).toHaveLength(ROLES.length);
    const blank = /<li[^>]*data-testid="volunteer-role-new"[\s\S]*?<\/li>/.exec(page)?.[0] ?? "";
    expect(blank).not.toContain(".was");
  });

  it("names each row's boxes as a group by its role, so a reader of the screen knows whose «Nume (RO)» it is", async () => {
    const page = await drawCard();
    const li = (id: string) => new RegExp(`<li[^>]*data-role-id="${id}"[\\s\\S]*?</li>`).exec(page)?.[0] ?? "";
    expect(li(WATER_ID)).toContain('role="group" aria-label="Punct de hidratare"');
    expect(li(LOOSE_ID)).toContain('role="group" aria-label="Foto/Video"');
    expect(page).toContain('role="group" aria-label="Rol nou"');
  });

  it("keeps the description's help, the blank row's hint and the number's sentence behind a «?», never as a caption — the number's once per card, beside «Nelimitat»", async () => {
    const page = await drawCard();
    const description = escaped(ro.Admin.volunteers.role.descriptionHelp.replace("{max}", "2000"));
    const hint = escaped(ro.Admin.volunteers.role.newRowHint);
    const needed = escaped(ro.Admin.volunteers.rolesNeededHelp);
    for (const text of [description, hint, needed]) {
      expect(page.split(`>${text}<`).length - 1, text.slice(0, 30)).toBe(0);
      expect(page).toContain(`aria-label="${text}"`);
    }
    // The description's sentence once per row (a «?» in each fold), the hint once per blank row, the number's once per card.
    expect(page.split(`aria-label="${description}"`).length - 1).toBe(ROLES.length + 4);
    expect(page.split(`aria-label="${hint}"`).length - 1).toBe(4);
    expect(page.split(`aria-label="${needed}"`).length - 1).toBe(4);
    const intro = /data-testid="volunteer-roles-intro"[\s\S]*?<\/p>/.exec(page)?.[0] ?? "";
    expect(intro).not.toContain("quiet-help");
    // Beside the tick of the first row of a card, not at the end of the intro.
    const first = new RegExp(`<li[^>]*data-role-id="${AT_START_ID}"[\\s\\S]*?</li>`).exec(page)?.[0] ?? "";
    expect(first.indexOf(needed)).toBeGreaterThan(first.indexOf("Nelimitat"));
    const second = new RegExp(`<li[^>]*data-role-id="${WATER_ID}"[\\s\\S]*?</li>`).exec(page)?.[0] ?? "";
    expect(second).not.toContain(needed);
  });
});
