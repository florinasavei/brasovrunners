import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import type { PublicVolunteerRole, VolunteerItem, VolunteerRole } from "@/modules/volunteers/volunteers";
import { CLUB_NAME } from "@/theme/brand";
import { bornAgedOn } from "../../helpers/volunteer-birth";

/**
 * §765 — the «Voluntari» card and the public form «Vreau să fiu voluntar» as the server draws them: the card's
 * tick (a real checkbox with its words, scripts off), its shirts' checkbox, the role's editor with the translate
 * button, the people's small chips and facts; the form's age, sex, city, ticks and size while the notice names them,
 * §758's tick until then, and each role's description under its box, folded past three lines. Both languages.
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
  return {
    addVolunteerAction: noop,
    addVolunteerCategoryAction: noop,
    assignVolunteerAction: noop,
    deleteVolunteerAction: noop,
    deleteVolunteerCategoryAction: noop,
    deleteVolunteerRoleAction: noop,
    editVolunteerAction: noop,
    editVolunteerCategoryAction: noop,
    moveVolunteerCategoryAction: noop,
    saveVolunteerCategoryContactAction: noop,
    saveVolunteerRolesAction: noop,
    recordPaperVolunteerAgreementAction: noop,
    recordPaperVolunteerGuardianAction: noop,
    requestVolunteerAgreementAction: noop,
    requestVolunteerGuardianAction: noop,
    setVolunteerStateAction: noop,
    switchVolunteersAction: noop,
    switchVolunteersShirtsAction: noop,
    switchVolunteersCountsAction: noop,
  };
});
vi.mock("@/app/[locale]/events/[slug]/volunteers/actions", () => ({ submitVolunteerAction: async () => {} }));
// The flash toast (§427) is an async server component of its own: react-dom/server cannot draw one, so its slot is marked.
vi.mock("@/shared/feedback/PublicFlash", async () => {
  const { createElement: element } = await import("react");
  return { default: ({ accept }: { accept: readonly string[] }) => element("div", { "data-testid": "public-flash", "data-accepts": accept.join(",") }) };
});

const { default: VolunteersCard } = await import("@/modules/volunteers/ui/VolunteersCard");
const { default: VolunteerBox } = await import("@/modules/volunteers/ui/VolunteerBox");

const translate: TranslateAction = async () => ({ ok: false, reason: "notConfigured" });
const EVENT = "11111111-1111-4111-8111-111111111111";
const WATER = "22222222-2222-4222-8222-222222222222";
/** The day the ages are counted on (§773): the event's. */
const EVENT_DAY = "2026-11-21";
/** The last day of being `years` old on it, typed as the form posts it back. */
const aged = (years: number) => bornAgedOn(years, EVENT_DAY);
const FINISH = "33333333-3333-4333-8333-333333333333";

const para = (text: string) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text }] });
const docOf = (...lines: string[]) => ({ type: "doc" as const, content: lines.map(para) });

const ROLE: VolunteerRole = {
  id: WATER,
  eventId: EVENT,
  nameRo: "Punct de apă",
  nameEn: "Water point",
  needed: 3,
  descriptionRo: "Stai la km 5.\nDai apă de la 9:00.\nÎți dăm pahare.\nStrângi gunoiul.",
  descriptionEn: "Stand at km 5.\nHand out water from 9:00.\nWe give you cups.\nCollect the rubbish.",
  descriptionRoJson: docOf("Stai la km 5.", "Dai apă de la 9:00.", "Îți dăm pahare.", "Strângi gunoiul."),
  descriptionEnJson: docOf("Stand at km 5.", "Hand out water from 9:00.", "We give you cups.", "Collect the rubbish."),
  colour: null,
  categoryId: null,
  position: 0,
  createdAt: new Date("2026-10-14T08:00:00Z"),
};
const FINISH_ROLE: VolunteerRole = {
  ...ROLE,
  id: FINISH,
  nameRo: "Sosire",
  nameEn: "Finish",
  needed: 1,
  descriptionRo: "Aplauze la sosire",
  descriptionEn: "Cheer at the finish",
  descriptionRoJson: docOf("Aplauze la sosire"),
  descriptionEnJson: docOf("Cheer at the finish"),
  position: 1,
};
const NO_DESCRIPTION: VolunteerRole = { ...ROLE, id: "44444444-4444-4444-8444-444444444444", nameRo: "Masă", nameEn: "Desk", descriptionRo: null, descriptionEn: null, descriptionRoJson: null, descriptionEnJson: null, position: 2 };

const PEOPLE: VolunteerItem[] = [
  {
    id: "55555555-5555-4555-8555-555555555555",
    eventId: EVENT,
    roleId: null,
    choiceIds: [WATER],
    name: "Maria Test",
    email: "maria@example.test",
    phone: "+40712345678",
    state: "REGISTERED",
    source: "PUBLIC",
    message: null,
    note: null,
    age: 34,
    dateOfBirth: "1992-03-12",
    sex: "FEMALE",
    city: "Brașov",
    volunteeredBefore: true,
    clubMember: true,
    shirtSize: "M",
    createdAt: new Date("2026-10-14T09:00:00Z"),
    updatedAt: new Date("2026-10-14T09:00:00Z"),
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
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    eventId: EVENT,
    roleId: null,
    choiceIds: [FINISH],
    name: "Ion Test",
    email: "ion@example.test",
    phone: "+40712345679",
    state: "REGISTERED",
    source: "STAFF",
    message: null,
    note: null,
    age: null,
    dateOfBirth: null,
    sex: null,
    city: null,
    volunteeredBefore: false,
    clubMember: false,
    shirtSize: null,
    createdAt: new Date("2026-10-14T09:30:00Z"),
    updatedAt: new Date("2026-10-14T09:30:00Z"),
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
  },
];

/** One element's opening tag by its name, attributes in whatever order the server wrote them. */
const tagOf = (page: string, element: "input" | "select", name: string) => new RegExp(`<${element}\\b[^>]*\\bname="${name}"[^>]*>`).exec(page)?.[0] ?? "";

/** A page as the server streams it, Suspense settled (the rich-text editor loads lazily). */
async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  // Emotion's inline <style> blocks and React's text separators sit between the elements: out of the way of what is asserted.
  const text = (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
  return text;
}

async function drawCard(over: Partial<ComponentProps<typeof VolunteersCard>> = {}, language: "ro" | "en" = "ro", offer: ComponentProps<typeof TranslateProvider>["offer"] = { action: translate, setupHref: null }) {
  locale = language;
  const drawn = (await VolunteersCard({
    locale: language,
    eventId: EVENT,
    acceptsVolunteers: false,
    volunteersShirts: false,
    volunteersShowCounts: false,
    eventDay: EVENT_DAY,
    profileDescribed: true,
    minorsOpen: false,
    offerClosed: "off",
    roles: [ROLE, FINISH_ROLE, NO_DESCRIPTION],
    categories: [],
    standings: [ROLE, FINISH_ROLE, NO_DESCRIPTION].map((role) => ({ roleId: role.id, needed: role.needed, taken: 0, confirmed: 0, free: role.needed })),
    volunteers: PEOPLE,
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

async function drawBox(over: Partial<ComponentProps<typeof VolunteerBox>> = {}, language: "ro" | "en" = "ro") {
  locale = language;
  const publicRole = (role: VolunteerRole): PublicVolunteerRole => ({
    id: role.id,
    nameRo: role.nameRo,
    nameEn: role.nameEn,
    descriptionRo: role.descriptionRo,
    descriptionEn: role.descriptionEn,
    descriptionRoJson: role.descriptionRoJson,
    descriptionEnJson: role.descriptionEnJson,
    needed: role.needed,
    taken: 0,
    free: role.needed,
    categoryId: role.categoryId,
  });
  const drawn = (await VolunteerBox({
    locale: language,
    slug: "cursa",
    roles: [publicRole(ROLE), publicRole(FINISH_ROLE), publicRole(NO_DESCRIPTION)],
    shirts: false,
    showCounts: true,
    eventDay: EVENT_DAY,
    profile: true,
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

describe("§765 «Primește voluntari pe pagină» is a real tick, never a toggle button", () => {
  it("is a plain form whose submit is the checkbox: role, state, words beside it, the state it wants posted", async () => {
    const off = await drawCard({ acceptsVolunteers: false });
    const form = /<form[^>]*data-testid="volunteer-switch-form"[\s\S]*?<\/form>/.exec(off)?.[0] ?? "";
    expect(form).toContain('type="submit"');
    expect(form).toContain('role="checkbox"');
    expect(form).toContain('aria-checked="false"');
    expect(form).toContain("Primește voluntari pe pagină");
    // The words are the button's own content, so its accessible name is the tick's words.
    expect(form).toMatch(/<button[^>]*data-testid="volunteer-switch-tick"[^>]*>[\s\S]*Primește voluntari pe pagină<\/button>/);
    // The box's glyph is decorative.
    expect(form).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="CheckBoxOutlineBlankIcon"/);
    expect(form).toContain('name="on" value="1"');

    const on = await drawCard({ acceptsVolunteers: true });
    const ticked = /<form[^>]*data-testid="volunteer-switch-form"[\s\S]*?<\/form>/.exec(on)?.[0] ?? "";
    expect(ticked).toContain('aria-checked="true"');
    expect(ticked).toMatch(/data-testid="CheckBoxIcon"/);
    expect(ticked).toContain('name="on" value="0"');
    // Scripts off: nothing but a form and a submit — no handler to wait for.
    expect(ticked).not.toContain("onclick");
  });

  it("says the same in English, and the card's source has no toggle glyph left", async () => {
    const page = await drawCard({ acceptsVolunteers: true }, "en");
    expect(page).toContain("Take volunteers on the page");
    expect(page).not.toContain("Stop taking volunteers");
    const source = readFileSync("src/modules/volunteers/ui/VolunteersCard.tsx", "utf8");
    expect(source).not.toMatch(/turnOn|turnOff/);
    expect(ro.Admin.volunteers).not.toHaveProperty("switchOff");
    expect(en.Admin.volunteers).not.toHaveProperty("switchOff");
  });

  it("keeps the 44-pixel row", async () => {
    const source = readFileSync("src/modules/volunteers/ui/VolunteersCard.tsx", "utf8");
    expect(source).toMatch(/TICK_ROW_SX = \{\s*minHeight: 44/);
  });
});

describe("§765 «Oferim tricouri voluntarilor» is the same tick as «Primește voluntari pe pagină»", () => {
  it("is a submit drawn as the checkbox with its one-line help, the state it wants posted, and no «Salvează» beside it", async () => {
    const off = await drawCard({ volunteersShirts: false });
    const form = /<form[^>]*data-testid="volunteer-shirts-form"[\s\S]*?<\/form>/.exec(off)?.[0] ?? "";
    expect(form).toContain('type="submit"');
    expect(form).toContain('role="checkbox"');
    expect(form).toContain('aria-checked="false"');
    expect(form).toMatch(/<button[^>]*data-testid="volunteer-shirts-tick"[^>]*>[\s\S]*Oferim tricouri voluntarilor<\/button>/);
    expect(form).toMatch(/data-testid="CheckBoxOutlineBlankIcon"/);
    expect(form).toContain('name="on" value="1"');
    expect(form).toContain(ro.Admin.volunteers.shirts.help);
    expect(form).not.toContain("Salvează");
    const on = await drawCard({ volunteersShirts: true });
    const ticked = /<form[^>]*data-testid="volunteer-shirts-form"[\s\S]*?<\/form>/.exec(on)?.[0] ?? "";
    expect(ticked).toContain('aria-checked="true"');
    expect(ticked).toMatch(/data-testid="CheckBoxIcon"/);
    expect(ticked).toContain('name="on" value="0"');
    const english = await drawCard({ volunteersShirts: true }, "en");
    expect(english).toContain("We give volunteers T-shirts");
  });
});

describe("§765 the organizers' entry draws the profile boxes only while the notice in force names them", () => {
  it("draws the date of birth, the sex, the city, the two ticks and the size while it does, and none of them while it does not", async () => {
    const named = await drawCard({ profileDescribed: true, volunteersShirts: true });
    for (const box of ["birthDate", "city", "volunteeredBefore", "clubMember"]) expect(named, box).toContain(`name="${box}"`);
    expect(named).toContain('name="shirtSize"');
    const unnamed = await drawCard({ profileDescribed: false, volunteersShirts: true });
    for (const box of ["birthDate", "age", "city", "volunteeredBefore", "clubMember", "shirtSize"]) expect(unnamed, box).not.toContain(`name="${box}"`);
    // The rest of the entry is there as ever.
    expect(unnamed).toContain('name="phone"');
    expect(unnamed).toContain(ro.Admin.volunteers.offer.profileOff);
  });
});

describe("§765 the role's row: «Descrierea rolului» in the rich-text editor, one Română | English strip, with «Tradu cardul» (§NNN)", () => {
  it("draws, in every role's row and in the blank row, one strip of two tabs, one editor per language and no one-line box", async () => {
    const page = await drawCard();
    // The three roles and the blank row: four strips, a Română tab and an English tab each — never two folds side by side.
    expect((page.match(/data-locale-tabs=""/g) ?? []).length).toBe(4);
    expect((page.match(/name="roles\[[^"]*\]\.descriptionRoBody"/g) ?? []).length).toBe(4);
    expect((page.match(/name="roles\[[^"]*\]\.descriptionEnBody"/g) ?? []).length).toBe(4);
    expect(page).toContain("Descrierea rolului (Română, opțional)");
    expect(page).toContain("Descrierea rolului (English, opțional)");
    expect(page).toContain(ro.Admin.volunteers.role.descriptionHelp.replace("{max}", "2000"));
    // The old one-line box and its 200-character help are gone.
    expect(page).not.toMatch(/<input[^>]*name="[^"]*descriptionRo"/);
    expect(page).not.toMatch(/<input[^>]*name="[^"]*descriptionEn"/);
    expect(page).not.toContain('maxlength="200"');
    // The stored document is what the editor posts until it is opened.
    expect(page).toContain("Stai la km 5.");
  });

  it("puts the translate buttons the house already has: the card's once in its header, the box's under every English name and description", async () => {
    const page = await drawCard();
    // «Tradu cardul: RO → EN» (§514) once for the whole card, «Tradu din română» (§464) under each English name and each English description.
    expect((page.match(/data-testid="translate-card"/g) ?? []).length).toBe(1);
    for (const id of [WATER, FINISH, "44444444-4444-4444-8444-444444444444", "new-none"]) {
      expect(page, id).toContain(`data-translate-for="roles[${id}].nameEn"`);
      expect(page, id).toContain(`data-translate-for="roles[${id}].descriptionEnBody"`);
    }
    // «Copiază și tradu tot» is left to the small forms that have no strips (the category's names), not the roles'.
    expect((page.match(/data-testid="translate-all"/g) ?? []).length).toBe(1);
    // The card's scope: its button is inside the form and names the card in the toast.
    expect(page).toContain('data-translate-scope="Roluri"');
  });

  it("says why the buttons are grey while the provider is off, like the editor's", async () => {
    const off = await drawCard({}, "ro", { action: null, setupHref: "/admin/tasks#translate" } as never);
    expect(off).toContain('data-testid="translate-card-off"');
    expect(off).toContain('data-reason="off"');
    expect(off).toContain(ro.Translate.off);
    // No «Tradu din română» under a box where nothing can translate: the card's greyed button carries the reason.
    expect(off).not.toContain("data-translate-for=");
  });

  it("shows the role's first line beside «Mai multe», which holds the description and the colour inside the one form", async () => {
    const page = await drawCard();
    const row = /<li[^>]*data-testid="volunteer-role"[^>]*data-role-id="22222222[\s\S]*?<\/li>/.exec(page)?.[0] ?? "";
    // From the fold's own tag to the end of the row: the editors inside it are folds too, so no tag closes it before the row does.
    const more = row.slice(row.indexOf('data-testid="volunteer-role-more"'));
    expect(more).not.toBe("");
    expect(more).toMatch(/<summary[^>]*>[\s\S]*Mai multe[\s\S]*Stai la km 5\./);
    expect(more).toContain('data-locale-tabs=""');
    expect(more).toContain("colourChoice");
    // None says nothing beside the title.
    const none = /<li[^>]*data-testid="volunteer-role"[^>]*data-role-id="44444444[\s\S]*?<\/li>/.exec(page)?.[0] ?? "";
    expect(/<details[^>]*data-testid="volunteer-role-more"[\s\S]*?<\/summary>/.exec(none)?.[0]).not.toMatch(/Stai|Aplauze/);
    // English, the English words.
    const english = await drawCard({}, "en");
    expect(/<details[^>]*data-testid="volunteer-role-more"[\s\S]*?<\/summary>/.exec(english)?.[0]).toContain("Stand at km 5.");
  });
});

describe("§765 the people: small chips for the two claims, one line of the rest, the size only while there are shirts", () => {
  it("draws «a mai fost voluntar» and the club's group as chips with the club's name from the constant, and the facts in one line", async () => {
    const page = await drawCard({ volunteersShirts: true });
    const maria = /<li[^>]*data-testid="volunteer-row"[^>]*data-volunteer-id="55555555[\s\S]*?<\/li>/.exec(page)?.[0] ?? "";
    expect(maria).toContain('data-testid="volunteer-before"');
    expect(maria).toContain("A mai fost voluntar");
    expect(maria).toContain('data-testid="volunteer-club"');
    expect(maria).toContain(`Din grupul ${CLUB_NAME}`);
    expect(maria).toMatch(/data-testid="volunteer-facts"[^>]*>34 de ani \(12\.03\.1992\) · Feminin · Oraș: Brașov · Tricou: M</);
    // Someone who said nothing has neither the chips nor the line.
    const ion = /<li[^>]*data-testid="volunteer-row"[^>]*data-volunteer-id="66666666[\s\S]*?<\/li>/.exec(page)?.[0] ?? "";
    expect(ion).not.toContain("volunteer-claims");
    expect(ion).not.toContain("volunteer-facts");
    // Without shirts the size is shown nowhere.
    const none = await drawCard({ volunteersShirts: false });
    expect(none).not.toContain("Tricou: M");
    expect(none).toMatch(/34 de ani \(12\.03\.1992\) · Feminin · Oraș: Brașov</);
  });

  it("speaks English", async () => {
    const page = await drawCard({ volunteersShirts: true }, "en");
    expect(page).toContain("Volunteered before");
    expect(page).toContain(`From the ${CLUB_NAME} group`);
    expect(page).toMatch(/34 years \(12\.03\.1992\) · Female · City: Brașov · T-shirt: M/);
  });

  it("offers the entry's boxes: date of birth, sex, city, the two claims — and the size only while the event gives shirts", async () => {
    const without = await drawCard({ volunteersShirts: false });
    for (const name of ["birthDate", "sex", "city", "volunteeredBefore", "clubMember"]) expect(without, name).toContain(`name="${name}"`);
    expect(without).not.toContain('name="shirtSize"');
    const withShirts = await drawCard({ volunteersShirts: true });
    expect(withShirts).toContain('name="shirtSize"');
    for (const size of ["XS", "S", "M", "L", "XL", "XXL"]) expect(withShirts).toContain(`<option value="${size}"`);
    expect(withShirts).toContain("A mai fost voluntar în trecut la alte curse");
    expect(withShirts).toContain(`Face parte din grupul ${CLUB_NAME}`);
  });

  it("says which form the page draws: only the tick until the notice names the answers", async () => {
    expect(await drawCard({ profileDescribed: false })).toContain('data-testid="volunteer-profile-off"');
    expect(await drawCard({ profileDescribed: true })).not.toContain('data-testid="volunteer-profile-off"');
  });
});

describe("§765 the public form while the notice names the profile", () => {
  it("asks the date of birth (the registration form's own box), the sex (its own box), the city and the two ticks, and no tick «Am cel puțin 18 ani»", async () => {
    const page = await drawBox();
    const birth = tagOf(page, "input", "birthDate");
    expect(birth).toContain("required");
    expect(birth).toContain('inputMode="numeric"');
    expect(birth).toContain('id="volunteer-birthDate"');
    // Typed day first, the registration form's own placeholder and plain-text pattern (the box works with scripts off), and no age box.
    expect(birth).toContain('placeholder="ZZ.LL.AAAA"');
    expect(birth).toMatch(/pattern="[^"]*\\d\{4\}-\\d\{2\}-\\d\{2\}/);
    expect(birth).toContain('autoComplete="bday"');
    expect(page).not.toContain('name="age"');
    const sex = tagOf(page, "select", "sex");
    expect(sex).toContain("required");
    expect(page).toContain('<option value="FEMALE">Feminin</option>');
    expect(page).toContain('<option value="MALE">Masculin</option>');
    expect(tagOf(page, "input", "city")).toContain("required");
    expect(page).toContain("Data nașterii");
    expect(page).not.toContain("Vârsta");
    expect(page).toContain("Orașul");
    // The owner's own sentences, the club's name from the constant.
    expect(page).toContain("Am mai fost voluntar în trecut la alte curse");
    expect(page).toContain(`Fac parte din grupul ${CLUB_NAME}`);
    expect(tagOf(page, "input", "volunteeredBefore")).toContain('type="checkbox"');
    expect(tagOf(page, "input", "clubMember")).toContain('type="checkbox"');
    // Both ticks are optional: not required.
    expect(tagOf(page, "input", "volunteeredBefore")).not.toContain("required");
    expect(tagOf(page, "input", "clubMember")).not.toContain("required");
    // The age answers the old tick.
    expect(page).not.toContain('name="adult"');
    expect(page).not.toContain('data-testid="volunteer-adult"');
    // Still the consent and the agreement.
    expect(page).toContain('name="consent"');
    expect(page).toContain('name="agreement"');
  });

  it("asks the T-shirt's size only while the event gives T-shirts, from the kit's sizes with «Fără tricou» first", async () => {
    expect(await drawBox({ shirts: false })).not.toContain('name="shirtSize"');
    const page = await drawBox({ shirts: true });
    expect(tagOf(page, "select", "shirtSize")).not.toBe("");
    expect(page).toContain("Mărimea tricoului");
    const select = new RegExp('<select\\b[^>]*\\bname="shirtSize"[^>]*>([\\s\\S]*?)</select>').exec(page)?.[1] ?? "";
    const options = [...select.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((match) => [match[1], match[2]]);
    expect(options).toEqual([["", "Fără tricou"], ["XS", "XS"], ["S", "S"], ["M", "M"], ["L", "L"], ["XL", "XL"], ["XXL", "XXL"]]);
    // The size is optional: nothing forces one.
    expect(tagOf(page, "select", "shirtSize")).not.toContain("required");
  });

  it("is §758's form while it does not: the tick, and none of the new boxes", async () => {
    const page = await drawBox({ profile: false, shirts: true });
    expect(page).toContain('name="adult"');
    expect(page).toContain("Am cel puțin 18 ani");
    for (const name of ["birthDate", "age", "sex", "city", "volunteeredBefore", "clubMember", "shirtSize"]) expect(page, name).not.toContain(`name="${name}"`);
  });

  it("brings back what was typed after a refusal, and says one of three sentences for the date: no minors yet, «cel puțin 14 ani», «scrie data nașterii»", async () => {
    const typed = { name: "Maria", birthDate: aged(17), sex: "FEMALE", city: "Brașov", volunteeredBefore: "on", clubMember: "on", shirtSize: "L" };
    // Seventeen while the notice and the agreement do not describe minors: the club says it cannot take them yet (§768).
    const under = await drawBox({ outcome: "invalid", refused: ["birthDate"], typed, shirts: true });
    // Shown day first, as the registration form shows what it was given back.
    expect(tagOf(under, "input", "birthDate")).toContain('value="21.11.2009"');
    expect(under).toMatch(/<option value="FEMALE" selected/);
    expect(tagOf(under, "input", "city")).toContain('value="Brașov"');
    expect(tagOf(under, "input", "volunteeredBefore")).toContain("checked");
    expect(tagOf(under, "input", "clubMember")).toContain("checked");
    expect(under).toMatch(/<option value="L" selected/);
    expect(under).toContain("Clubul nu primește încă voluntari sub 18 ani.");
    // Thirteen, where minors are taken: the floor is fourteen.
    const young = await drawBox({ outcome: "invalid", refused: ["birthDate"], typed: { ...typed, birthDate: aged(13) }, minors: true });
    expect(young).toContain("Voluntarii trebuie să aibă cel puțin 14 ani în ziua evenimentului.");
    expect(young).not.toContain("Clubul nu primește încă");
    const typo = await drawBox({ outcome: "invalid", refused: ["birthDate"], typed: { ...typed, birthDate: "abc" } });
    expect(typo).toContain("Scrie data ca zi, lună, an: 11.05.1990.");
    expect(typo).not.toContain("Voluntarii trebuie să aibă cel puțin");
    expect(typo).not.toContain("Clubul nu primește încă");
    // A date after the event day is negative: the minimum's sentence, not the minors' one, while minors are closed.
    const future = await drawBox({ outcome: "invalid", refused: ["birthDate"], typed: { ...typed, birthDate: "2030-01-01" } });
    expect(future).toContain("Voluntarii trebuie să aibă cel puțin 14 ani în ziua evenimentului.");
    expect(future).not.toContain("Clubul nu primește încă");
    // A day that does not exist is the registration form's «scrie data», not an age sentence.
    const noDay = await drawBox({ outcome: "invalid", refused: ["birthDate"], typed: { ...typed, birthDate: "1990-02-30" } });
    expect(noDay).toContain("Scrie data ca zi, lună, an: 11.05.1990.");
    // The summary links to the box.
    expect(under).toContain('href="#volunteer-birthDate"');
    const missing = await drawBox({ outcome: "invalid", refused: ["sex", "city"], typed: {} });
    expect(missing).toContain("Alege sexul din listă.");
    expect(missing).toContain("Scrie orașul tău.");
  });

  it("speaks English", async () => {
    const page = await drawBox({ shirts: true }, "en");
    expect(page).toContain("I have volunteered at other races before");
    expect(page).toContain(`I belong to the ${CLUB_NAME} group`);
    expect(page).toContain("T-shirt size");
    expect(page).toContain('<option value="FEMALE">Female</option>');
    expect(page).toContain("No t-shirt");
  });
});

describe("§765 each role's description under its tick on the public form", () => {
  it("draws the document under the role's box, never the other language's, and nothing for a role with none", async () => {
    const page = await drawBox();
    // One block per role, in the club's order: Punct de apă, Sosire, Masă.
    const [water, , desk] = page.split('data-testid="volunteer-role-option"').slice(1);
    expect(water).toContain("Punct de apă");
    expect(water).toContain("Stai la km 5.");
    expect(water).not.toContain("Stand at km 5.");
    expect(desk).toContain("Masă");
    expect(desk).not.toContain("volunteer-role-description");
    const english = await drawBox({}, "en");
    expect(english).toContain("Stand at km 5.");
    expect(english).not.toContain("Stai la km 5.");
  });

  it("folds a description past about three lines behind «Detalii» and shows a short one as it is", async () => {
    const page = await drawBox();
    // The four-line description is folded, in a native <details> with the glyphed summary.
    const [water, finish] = page.split('data-testid="volunteer-role-option"').slice(1);
    expect(water).toMatch(/<details[^>]*data-testid="volunteer-role-description"[^>]*data-folded="true"/);
    expect(water).toMatch(/<summary[^>]*><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg>Detalii<\/summary>/);
    expect((page.match(/data-folded="true"/g) ?? []).length).toBe(1);
    // The one-line one is plain text under the box, not a fold.
    expect(finish).toContain("Aplauze la sosire");
    expect(finish).not.toContain("<details");
    expect(finish).toMatch(/<div[^>]*data-testid="volunteer-role-description"/);
    const english = await drawBox({}, "en");
    expect(english).toContain(">Details</summary>");
  });

  it("ties the description to the role's tick: the box names the description's id in aria-describedby, folded or not, and a role with none names nothing", async () => {
    const page = await drawBox();
    const [water, finish, desk] = page.split('data-testid="volunteer-role-option"').slice(1);
    for (const block of [water, finish]) {
      const id = /id="(volunteer-role-[^"]+-description)"/.exec(block)?.[1] ?? "";
      expect(id).not.toBe("");
      expect(/<input[^>]*type="checkbox"[^>]*>/.exec(block)?.[0] ?? "").toContain(id);
    }
    expect(/<input[^>]*type="checkbox"[^>]*>/.exec(desk)?.[0] ?? "").not.toContain("-description");
  });

  it("keeps the role's own count beside the box, as help", async () => {
    const page = await drawBox();
    expect(page).toContain("mai sunt necesare 3 persoane");
    expect(page).toContain("mai e nevoie de 1 persoană");
  });
});

describe("§765 «Toate datele unei persoane» lists the six answers of a volunteer", () => {
  it("writes the age, the sex, the city, the two claims and the size after the organizers' note, in the reader's language", async () => {
    const { default: VolunteerAnswers } = await import("@/modules/volunteers/ui/VolunteerAnswers");
    const noGuardian = { guardianName: null, guardianEmail: null, guardianAcceptedAt: null, guardianMethod: null };
    const all = { age: 34, dateOfBirth: "1992-03-12", sex: "FEMALE" as const, city: "Brașov", volunteeredBefore: true, clubMember: true, shirtSize: "M" as const, ...noGuardian };
    locale = "ro";
    const page = await html(createElement("p", null, (await VolunteerAnswers({ offer: all })) as ReactElement));
    expect(page).toContain(" · Vârsta: 34 · Data nașterii: 12.03.1992 · Feminin · Oraș: Brașov · A mai fost voluntar · Din grupul " + CLUB_NAME + " · Tricou: M");
    locale = "en";
    const english = await html(createElement("p", null, (await VolunteerAnswers({ offer: all })) as ReactElement));
    expect(english).toContain("Age: 34 · Date of birth: 12.03.1992");
    expect(english).toContain("Female");
    expect(english).toContain("T-shirt: M");
  });

  it("writes nothing for a row from before, for the retired «Prefer să nu spun» and for «Fără tricou»", async () => {
    const { default: VolunteerAnswers } = await import("@/modules/volunteers/ui/VolunteerAnswers");
    locale = "ro";
    const empty = { age: null, dateOfBirth: null, sex: null, city: null, volunteeredBefore: false, clubMember: false, shirtSize: null, guardianName: null, guardianEmail: null, guardianAcceptedAt: null, guardianMethod: null };
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: empty })) as ReactElement))).toBe("<p></p>");
    const retired = await html(createElement("p", null, (await VolunteerAnswers({ offer: { ...empty, sex: "UNSPECIFIED", shirtSize: "NONE" } })) as ReactElement));
    expect(retired).toBe("<p></p>");
  });
});

/** A volunteer under eighteen on the card: fifteen, the parent named, with or without an address, accepted or not (§768). */
const MINOR: VolunteerItem = {
  ...PEOPLE[0],
  id: "77777777-7777-4777-8777-777777777777",
  name: "Dan Tânărul",
  email: "dan@example.test",
  age: 15,
  dateOfBirth: aged(15),
  guardianName: "Maria Popescu",
  guardianEmail: "maria@example.test",
};

describe("§768 the public form's block for a parent or guardian", () => {
  it("is drawn hidden — an adult never sees it flash — with no box required and no asterisk, a noscript rule opening it, inside the island that follows the date of birth", async () => {
    const page = await drawBox({ minors: true });
    expect(page).toContain('data-testid="volunteer-guardian-block"');
    expect(page).toContain('data-testid="volunteer-guardian"');
    // Hidden in the markup before any age is typed (the island shows it from the age, after it hydrates), and scripts off open it.
    expect(/<div[^>]*data-testid="volunteer-guardian-block"[^>]*>/.exec(page)?.[0]).toContain("hidden");
    // (The helper strips every <style>, so the noscript rule is read from the island drawn on its own.)
    const GuardianFields = (await import("@/modules/volunteers/ui/GuardianFields")).default;
    const island = renderToStaticMarkup(createElement(GuardianFields, { birthDateId: "volunteer-birthDate", eventDay: EVENT_DAY, minimumAge: 14, adultAge: 18, startOpen: false } as ComponentProps<typeof GuardianFields>, "x"));
    expect(island).toContain('<noscript><style>[data-testid="volunteer-guardian-block"]{display:block !important}</style></noscript>');
    expect(page).toContain("<noscript>");
    // A minor's age typed back after a refusal draws it open from the first byte: nothing to hydrate into.
    const back = await drawBox({ minors: true, typed: { birthDate: aged(16) } });
    expect(/<div[^>]*data-testid="volunteer-guardian-block"[^>]*>/.exec(back)?.[0]).not.toContain("hidden");
    const adultBack = await drawBox({ minors: true, typed: { birthDate: aged(30) } });
    expect(/<div[^>]*data-testid="volunteer-guardian-block"[^>]*>/.exec(adultBack)?.[0]).toContain("hidden");
    // The server draws no asterisk: an adult must ignore none of the three boxes.
    expect(/<label[^>]*for="volunteer-guardianName"[^>]*>[\s\S]*?<\/label>/.exec(page)?.[0]).not.toContain("*");
    expect(/<label[^>]*for="volunteer-guardianEmail"[^>]*>[\s\S]*?<\/label>/.exec(page)?.[0]).not.toContain("*");
    for (const name of ["guardianName", "guardianEmail", "guardianAware"]) {
      const tag = tagOf(page, "input", name);
      expect(tag, name).not.toBe("");
      expect(tag, name).not.toContain("required");
    }
    expect(tagOf(page, "input", "guardianEmail")).toContain('type="email"');
    expect(tagOf(page, "input", "guardianAware")).toContain('type="checkbox"');
    // The owner's words, in the form's own labels (the notice quotes the first two).
    for (const words of ["Dacă ai sub 18 ani", "Numele părintelui sau tutorelui", "Emailul părintelui sau tutorelui", "Părintele sau tutorele meu știe și e de acord"]) {
      expect(page, words).toContain(words);
    }
    expect(page).toContain("Data nașterii");
    expect(page).toContain("Cel puțin 14 ani în ziua evenimentului");
  });

  it("is not drawn while the club cannot take minors, and the age then says eighteen", async () => {
    const page = await drawBox({ minors: false });
    expect(page).not.toContain("volunteer-guardian-block");
    for (const name of ["guardianName", "guardianEmail", "guardianAware"]) expect(page, name).not.toContain(`name="${name}"`);
    expect(page).toContain("Trebuie să ai cel puțin 18 ani în ziua evenimentului");
  });

  it("is not drawn on §758's form, which asks no age: the tick says eighteen, never fourteen", async () => {
    const page = await drawBox({ profile: false, minors: true });
    expect(page).not.toContain("volunteer-guardian-block");
    expect(page).toContain("Am cel puțin 18 ani");
    expect(page).not.toContain("Am cel puțin 14 ani");
  });

  it("brings back the parent's name and address after a refusal — never the tick, the person's own act — and names the boxes it refused", async () => {
    const typed = { name: "Dan", birthDate: aged(15), sex: "MALE", city: "Brașov", guardianName: "Maria Popescu", guardianEmail: "maria@example.test" };
    const page = await drawBox({ minors: true, outcome: "invalid", refused: ["guardianEmail", "guardianAware"], typed });
    expect(tagOf(page, "input", "guardianName")).toContain('value="Maria Popescu"');
    expect(tagOf(page, "input", "guardianEmail")).toContain('value="maria@example.test"');
    expect(tagOf(page, "input", "guardianAware")).not.toContain("checked");
    expect(page).toContain("Adresa de email a părintelui sau tutorelui nu pare validă.");
    expect(page).toContain("Bifează că părintele sau tutorele tău știe și e de acord.");
    // The summary links to each box.
    expect(page).toContain('href="#volunteer-guardianEmail"');
    expect(page).toContain('href="#volunteer-guardianAware"');
  });

  it("says in English what the Romanian says", async () => {
    const page = await drawBox({ minors: true }, "en");
    for (const words of ["If you are under 18", "Parent&#x27;s or guardian&#x27;s name", "Parent&#x27;s or guardian&#x27;s email", "My parent or guardian knows and agrees"]) {
      expect(page, words).toContain(words);
    }
  });

  it("says «clubul nu primește încă» for a date that gives under eighteen on the event's day while minors are closed, and «cel puțin 14 ani» below fourteen where they are taken", async () => {
    const closed = await drawBox({ minors: false, outcome: "invalid", refused: ["birthDate"], typed: { birthDate: aged(15) } });
    expect(closed).toContain("Clubul nu primește încă voluntari sub 18 ani.");
    const young = await drawBox({ minors: true, outcome: "invalid", refused: ["birthDate"], typed: { birthDate: aged(13) } });
    expect(young).toContain("Voluntarii trebuie să aibă cel puțin 14 ani în ziua evenimentului.");
    const english = await drawBox({ minors: false, outcome: "invalid", refused: ["birthDate"], typed: { birthDate: aged(15) } }, "en");
    expect(english).toContain("The club does not take volunteers under 18 yet.");
  });
});

describe("§768 the form is the volunteers' own page's: the thank-you with its flash, and no fold", () => {
  it("says «am primit» in a banner with the flash toast's slot — and, where minors are taken, the same line about the parent for everybody", async () => {
    const page = await drawBox({ outcome: "done", minors: true });
    expect(page).toContain('data-testid="volunteer-done"');
    expect(page).toContain("Am primit oferta ta");
    expect(page).toMatch(/data-testid="public-flash"[^>]*data-accepts="volunteerSent"|data-accepts="volunteerSent"[^>]*data-testid="public-flash"/);
    expect(page).toContain('data-testid="volunteer-done-guardian"');
    expect(page).toContain("părintele sau tutorele tău primește un email");
    // Where minors are not taken the page does not speak of a parent.
    expect(await drawBox({ outcome: "done", minors: false })).not.toContain("volunteer-done-guardian");
    expect(page).not.toContain("<details");
    expect(page).not.toContain("<summary");
  });

  it("draws the form itself with no fold around it: the roles, the boxes and the one button", async () => {
    const page = await drawBox({ minors: true });
    expect(page).toContain('data-testid="volunteer-form"');
    expect(page).not.toMatch(/<details[^>]*data-testid="volunteer-box"/);
    expect(page).toContain("Ce ești dispus(ă) să faci");
    expect(page).toContain("Mă ofer voluntar");
  });
});

describe("§768 the card: the parent's agreement, in words", () => {
  const lost = { ...MINOR, id: "88888888-8888-4888-8888-888888888888", name: "Vlad Tânărul", guardianName: "Elena Popescu", guardianEmail: null };
  const accepted = {
    ...MINOR,
    id: "99999999-9999-4999-8999-999999999999",
    name: "Ana Tânăra",
    guardianAcceptedAt: new Date("2026-10-14T09:45:00Z"),
    guardianMethod: "LINK" as const,
    guardianVersion: 1,
  };
  const rowOf = (page: string, id: string) => new RegExp(`<li[^>]*data-testid="volunteer-row"[^>]*data-volunteer-id="${id.slice(0, 8)}[\\s\\S]*?</li>`).exec(page)?.[0] ?? "";

  it("says «Acordul părintelui lipsește» for a minor whose parent has not accepted, «primit» for one whose parent has — and nothing for an adult", async () => {
    const page = await drawCard({ minorsOpen: true, volunteers: [...PEOPLE, MINOR, accepted] });
    const waiting = rowOf(page, MINOR.id);
    expect(waiting).toMatch(/data-testid="volunteer-guardian-state"[\s\S]*?Acordul părintelui lipsește/);
    expect(rowOf(page, accepted.id)).toContain("Acordul părintelui primit");
    expect(rowOf(page, PEOPLE[0].id)).not.toContain("volunteer-guardian-state");
    // The parent's name and address, small, on the row; the address a link a thumb can press.
    expect(waiting).toContain("Părinte sau tutore: Maria Popescu");
    expect(waiting).toContain('href="mailto:maria@example.test"');
  });

  it("says how a parent's consent is got once for the card, not on every minor's row — and marks a parent's address that is the volunteer's own", async () => {
    const other = { ...MINOR, id: "88888888-8888-4888-8888-888888888888", name: "Ion Tânărul", email: "ion@example.test", guardianEmail: "ION@example.test" };
    const page = await drawCard({ minorsOpen: true, volunteers: [MINOR, other] });
    expect(page.match(/data-testid="volunteer-guardian-note"/g)).toHaveLength(1);
    expect(rowOf(page, MINOR.id)).not.toContain("volunteer-guardian-note");
    // Only the row whose guardian shares the volunteer's mailbox (through the canonicalizer) says so.
    expect(rowOf(page, other.id)).toContain('data-testid="volunteer-guardian-same-address"');
    expect(rowOf(page, other.id)).toContain("Aceeași adresă ca a voluntarului");
    expect(rowOf(page, MINOR.id)).not.toContain("volunteer-guardian-same-address");
    // Nothing waits on a parent: no note at all.
    const none = await drawCard({ minorsOpen: true, volunteers: PEOPLE });
    expect(none).not.toContain("volunteer-guardian-note");
  });

  it("keeps saying «Acordul părintelui lipsește» while a link is live in the parent's mailbox — «Link trimis părintelui» is a second, smaller chip", async () => {
    const sent = { ...MINOR, guardianTokenExpiresAt: new Date("2026-10-20T10:00:00Z"), guardianRequestedAt: new Date("2026-10-14T09:10:00Z") };
    const page = await drawCard({ minorsOpen: true, volunteers: [sent] });
    const row = rowOf(page, MINOR.id);
    expect(row).toMatch(/data-testid="volunteer-guardian-state"[\s\S]*?Acordul părintelui lipsește/);
    expect(row).toMatch(/data-testid="volunteer-guardian-link"[\s\S]*?Link trimis părintelui/);
    // The button then says «again», with when it was last sent.
    expect(row).toContain("Trimite din nou linkul părintelui");
    expect(row).toContain("Ultimul link trimis părintelui");
    // A link past its expiry is no link: the second chip goes, the first stays.
    const expired = await drawCard({ minorsOpen: true, volunteers: [{ ...sent, guardianTokenExpiresAt: new Date("2026-10-14T09:59:00Z") }] });
    expect(rowOf(expired, MINOR.id)).not.toContain("volunteer-guardian-link");
    expect(rowOf(expired, MINOR.id)).toContain("Acordul părintelui lipsește");
  });

  it("offers the link, the sheet to sign and the paper record while the texts describe minors; the link only with an address", async () => {
    const page = await drawCard({ minorsOpen: true, volunteers: [MINOR, lost], agreementDocumentIds: { ro: "doc-1" } });
    const withAddress = rowOf(page, MINOR.id);
    expect(withAddress).toContain('data-testid="volunteer-guardian-send-form"');
    expect(withAddress).toContain("Trimite linkul părintelui");
    expect(withAddress).toMatch(/href="\/api\/admin\/events\/[^"]+\/volunteers\/77777777[^"]*\/agreement\?for=guardian"/);
    expect(withAddress).toContain("Acordul părintelui pe hârtie");
    // What the sheet printed rides with the record, the service refuses a stale one.
    expect(withAddress).toContain('name="agreementDocumentId" value="doc-1"');
    expect(withAddress).toContain('name="agreementRoles" value="choices:');
    // No address: no link to send, and the card says the consent is taken on paper.
    const noAddress = rowOf(page, lost.id);
    expect(noAddress).not.toContain('data-testid="volunteer-guardian-send-form"');
    expect(noAddress).toContain('data-testid="volunteer-guardian-no-email"');
    expect(noAddress).toContain("Acordul părintelui pe hârtie");
  });

  it("says the link and the paper wait while the notice or the agreement does not describe minors", async () => {
    const page = await drawCard({ minorsOpen: false, volunteers: [MINOR] });
    const waiting = rowOf(page, MINOR.id);
    // The sentence is said once for the whole card, never on every row.
    expect(page.match(/data-testid="volunteer-guardian-closed"/g)).toHaveLength(1);
    expect(waiting).not.toContain('data-testid="volunteer-guardian-closed"');
    expect(waiting).not.toContain('data-testid="volunteer-guardian-send-form"');
    expect(waiting).not.toContain('data-testid="volunteer-guardian"');
    expect(waiting).not.toContain('data-testid="volunteer-guardian-pdf-to-sign"');
    // The state is still told: the minor is on the list and cannot be confirmed.
    expect(waiting).toContain("Acordul părintelui lipsește");
    // And the entry does not draw the guardian's boxes for a new person, only the sentence.
    expect(page).toContain('data-testid="volunteer-minors-off-field"');
  });

  it("draws the entry's guardian boxes — a named card, open for a minor — while the club takes minors", async () => {
    const page = await drawCard({ minorsOpen: true, volunteers: [MINOR] });
    expect(page).toContain('data-testid="volunteer-guardian-field"');
    for (const name of ["guardianName", "guardianEmail"]) expect(page, name).toContain(`name="${name}"`);
    expect(page).toContain("Părintele sau tutorele (sub 18 ani)");
    expect(page).not.toContain('data-testid="volunteer-minors-off-field"');
  });

  it("shows when and how the parent accepted, with the sheet as a PDF to keep — in English too", async () => {
    const page = await drawCard({ minorsOpen: true, volunteers: [accepted] });
    expect(rowOf(page, accepted.id)).toContain("Părintele sau tutorele Maria Popescu: versiunea 1 · din linkul trimis pe email");
    expect(rowOf(page, accepted.id)).toContain('data-testid="volunteer-guardian-pdf"');
    const english = await drawCard({ minorsOpen: true, volunteers: [MINOR] }, "en");
    expect(english).toContain("Parent&#x27;s consent missing");
    expect(english).toContain("Send the parent&#x27;s link");
  });
});

describe("§768 the event page keeps one line and one button", () => {
  it("draws «Căutăm voluntari: …» and a 44-pixel button to the volunteers' page — in both languages", async () => {
    const { default: VolunteerCallout } = await import("@/modules/volunteers/ui/VolunteerCallout");
    const { NextIntlClientProvider } = await import("next-intl");
    for (const [language, line, href] of [
      ["ro", "Căutăm voluntari: Punct de apă, Sosire", "/ro/evenimente/crosul/voluntari"],
      ["en", "We are looking for volunteers: Water point, Finish", "/en/events/the-cross/volunteers"],
    ] as const) {
      locale = language;
      const slug = language === "ro" ? "crosul" : "the-cross";
      const drawn = (await VolunteerCallout({ slug, roleNames: language === "ro" ? ["Punct de apă", "Sosire"] : ["Water point", "Finish"] })) as ReactElement;
      const intl = { locale: language, messages: { Event: messages[language].Event } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
      const page = await html(createElement(NextIntlClientProvider, intl, drawn));
      expect(page, language).toContain(line);
      expect(page, language).toContain(`href="${href}"`);
      expect(page, language).toContain(language === "ro" ? "Vreau să fiu voluntar" : "I want to volunteer");
      expect(page, language).toContain('data-testid="volunteer-callout-button"');
      // A glyph before the words, decorative.
      expect(page, language).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="VolunteerActivismIcon"/);
    }
  });

  it("holds the 44-pixel rule and carries no form: the event page's view imports the callout and not the form", () => {
    const callout = readFileSync("src/modules/volunteers/ui/VolunteerCallout.tsx", "utf8");
    expect(callout).toMatch(/TAP_TARGET/);
    const view = readFileSync("src/modules/events/ui/EventPageView.tsx", "utf8");
    expect(view).toContain("VolunteerCallout");
    expect(view).not.toMatch(/ui\/VolunteerBox/);
    const page = readFileSync("src/app/[locale]/events/[slug]/page.tsx", "utf8");
    // The static event page reads no query for the form and no draft cookie: the form is the volunteers' page's.
    expect(page).not.toMatch(/readVolunteerDraft|volunteerOutcome|vfields|parseVolunteerBoxes/);
    expect(readFileSync("src/i18n/live-twin.ts", "utf8")).not.toMatch(/"volunteer", "vfields"/);
  });
});

describe("§773 «Arată public câți voluntari mai sunt necesari» is the card's third tick, the same as the other two", () => {
  it("is a submit drawn as the checkbox with its one-line help, the state it wants posted, and no «Salvează» beside it", async () => {
    const off = await drawCard({ volunteersShowCounts: false });
    const form = /<form[^>]*data-testid="volunteer-counts-form"[\s\S]*?<\/form>/.exec(off)?.[0] ?? "";
    expect(form).toContain('type="submit"');
    expect(form).toContain('role="checkbox"');
    expect(form).toContain('aria-checked="false"');
    expect(form).toMatch(/<button[^>]*data-testid="volunteer-counts-tick"[^>]*>[\s\S]*Arată public câți voluntari mai sunt necesari<\/button>/);
    expect(form).toMatch(/data-testid="CheckBoxOutlineBlankIcon"/);
    expect(form).toContain('name="on" value="1"');
    expect(form).toContain(ro.Admin.volunteers.counts.help);
    expect(form).not.toContain("Salvează");
    // Scripts off: nothing but a form and a submit.
    expect(form).not.toContain("onclick");
    const on = await drawCard({ volunteersShowCounts: true });
    const ticked = /<form[^>]*data-testid="volunteer-counts-form"[\s\S]*?<\/form>/.exec(on)?.[0] ?? "";
    expect(ticked).toContain('aria-checked="true"');
    expect(ticked).toMatch(/data-testid="CheckBoxIcon"/);
    expect(ticked).toContain('name="on" value="0"');
    const english = await drawCard({ volunteersShowCounts: true }, "en");
    expect(english).toContain("Show publicly how many volunteers are still needed");
  });

  it("sits in the «Voluntari» card's own switches, after the T-shirts' tick, and the card still shows the numbers whichever way it is", async () => {
    for (const volunteersShowCounts of [false, true]) {
      const page = await drawCard({ volunteersShowCounts });
      expect(page.indexOf('data-testid="volunteer-shirts-form"')).toBeGreaterThan(0);
      expect(page.indexOf('data-testid="volunteer-counts-form"')).toBeGreaterThan(page.indexOf('data-testid="volunteer-shirts-form"'));
      // The backoffice always has the counts: «0 din 3» on a role's chip, whatever the public page says.
      expect(page, String(volunteersShowCounts)).toMatch(/data-testid="volunteer-role-standing"[^>]*>[\s\S]*?0 din 3/);
    }
  });

  it("is a button with no toggle glyph: the card's source and the tick's markup carry none", async () => {
    const source = readFileSync("src/modules/volunteers/ui/VolunteersCard.tsx", "utf8");
    expect(source).not.toMatch(/turnOn|turnOff|ToggleOn|ToggleOff|\bSwitch\b/);
    expect(source).toMatch(/switchVolunteersCountsAction/);
  });
});

describe("§773 the public page says how many people a role needs only while the club ticked it", () => {
  it("says only that a role still takes people while the tick is off, in both languages — and no number anywhere on the page", async () => {
    for (const [language, open, counted] of [
      ["ro", "mai sunt locuri", /mai sunt necesare|mai e nevoie de/],
      ["en", "spots still open", /more people needed|more person needed/],
    ] as const) {
      const page = await drawBox({ showCounts: false }, language);
      expect((page.match(new RegExp(open, "g")) ?? []).length, language).toBe(3);
      expect(page, language).not.toMatch(counted);
      // No number is said about a role: no figure in any role's help line.
      for (const help of page.split('data-testid="volunteer-role-option"').slice(1)) {
        expect(/<span[^>]*class="[^"]*MuiFormHelperText[^"]*"[^>]*>([^<]*)</.exec(help)?.[1] ?? "", language).not.toMatch(/\d/);
      }
    }
  });

  it("says the number while the tick is on, as it always did: «mai sunt necesare 3 persoane», «mai e nevoie de 1 persoană»", async () => {
    const page = await drawBox({ showCounts: true });
    expect(page).toContain("mai sunt necesare 3 persoane");
    expect(page).toContain("mai e nevoie de 1 persoană");
    expect(page).not.toContain("mai sunt locuri");
    const english = await drawBox({ showCounts: true }, "en");
    expect(english).toContain("3 more people needed");
    expect(english).toContain("1 more person needed");
    expect(english).not.toContain("spots still open");
  });

  it("offers the same roles either way: a role that is full is not on the page, with the number said or not", async () => {
    const full: PublicVolunteerRole = { id: FINISH, nameRo: "Sosire", nameEn: "Finish", descriptionRo: null, descriptionEn: null, descriptionRoJson: null, descriptionEnJson: null, needed: 1, taken: 1, free: 0, categoryId: null };
    // The page hands the form only the roles that still need people (`volunteerBoxRoles`); the form never invents one.
    for (const showCounts of [false, true]) {
      const page = await drawBox({ showCounts, roles: [{ ...full, id: WATER, nameRo: "Punct de apă", nameEn: "Water point", needed: 3, taken: 1, free: 2 }] });
      expect(page.split('data-testid="volunteer-role-option"')).toHaveLength(2);
      expect(page).not.toContain("Sosire");
    }
  });

  it("keeps the line in the source one flag: the form asks `showCounts` and nothing else says a number about volunteers publicly", () => {
    const box = readFileSync("src/modules/volunteers/ui/VolunteerBox.tsx", "utf8");
    expect(box).toMatch(/showCounts \?/);
    // The callout names the roles only; the page and the callout never print `free`, `taken` or `needed` on their own.
    const callout = readFileSync("src/modules/volunteers/ui/VolunteerCallout.tsx", "utf8");
    expect(callout).not.toMatch(/\.free|\.taken|\.needed|countForm/);
    const page = readFileSync("src/app/[locale]/events/[slug]/volunteers/page.tsx", "utf8");
    expect(page).not.toMatch(/\.free|\.taken|\.needed|countForm/);
  });
});

describe("§773 the owner's note under the roles' list", () => {
  const NOTE_RO = "În funcție de numărul de doritori, există posibilitatea să fie nevoie să acoperi o altă responsabilitate. Mulțumim pentru dorința de a ajuta. Te vom contacta curând.";
  const NOTE_EN = "Depending on how many people sign up, you may be asked to cover a different responsibility. Thank you for wanting to help. We will contact you soon.";

  it("carries the owner's words, verbatim with diacritics and the typo fixed, in both catalogues", () => {
    expect(ro.Event.volunteers.choicesNote).toBe(NOTE_RO);
    expect(en.Event.volunteers.choicesNote).toBe(NOTE_EN);
    // The short instruction stays as it was, above the roles.
    expect(ro.Event.volunteers.choicesHelp).toBe("Bifează tot ce ai face, cel puțin un rol.");
  });

  it("is drawn right under the last role's box, before the next field, and the short instruction stays above the roles", async () => {
    for (const [language, note, instruction] of [
      ["ro", NOTE_RO, "Bifează tot ce ai face, cel puțin un rol."],
      ["en", NOTE_EN, "Tick everything you would do, at least one role."],
    ] as const) {
      const page = await drawBox({}, language);
      const at = page.indexOf('data-testid="volunteer-roles-note"');
      expect(at, language).toBeGreaterThan(0);
      expect(page.slice(at)).toContain(note.replace("'", "&#x27;"));
      // After the last role's block and before the name box.
      expect(at).toBeGreaterThan(page.lastIndexOf('data-testid="volunteer-role-option"'));
      expect(at).toBeLessThan(page.indexOf('name="name"'));
      // The instruction is above the roles, not the note.
      const help = page.indexOf(instruction);
      expect(help, language).toBeGreaterThan(0);
      expect(help).toBeLessThan(page.indexOf('data-testid="volunteer-role-option"'));
      // A caption in the form's own style, read with the group: the fieldset names it.
      expect(page).toMatch(/<fieldset[^>]*aria-describedby="[^"]*volunteer-roleIds-note/);
      expect(/<p[^>]*id="volunteer-roleIds-note"[^>]*class="[^"]*MuiTypography-body2/.test(page) || /<p[^>]*class="[^"]*MuiTypography-body2[^"]*"[^>]*id="volunteer-roleIds-note"/.test(page)).toBe(true);
    }
  });

  it("is on the form while it is asked and not on the answer pages", async () => {
    expect(await drawBox({ outcome: "done" })).not.toContain('data-testid="volunteer-roles-note"');
    expect(await drawBox({ outcome: "invalid", refused: ["roleIds"] })).toContain('data-testid="volunteer-roles-note"');
    expect(await drawBox({ roles: [] })).not.toContain('data-testid="volunteer-roles-note"');
  });
});

describe("§773 the event page's button opens the volunteers' page in a new tab", () => {
  async function drawCallout(language: "ro" | "en") {
    const { default: VolunteerCallout } = await import("@/modules/volunteers/ui/VolunteerCallout");
    const { NextIntlClientProvider } = await import("next-intl");
    locale = language;
    const slug = language === "ro" ? "crosul" : "the-cross";
    const drawn = (await VolunteerCallout({ slug, roleNames: language === "ro" ? ["Punct de apă", "Sosire"] : ["Water point", "Finish"] })) as ReactElement;
    const intl = { locale: language, messages: { Event: messages[language].Event } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
    return html(createElement(NextIntlClientProvider, intl, drawn));
  }

  it("is a link with target _blank and rel noopener, the house's new-tab mark and the words that say it — in both languages", async () => {
    for (const language of ["ro", "en"] as const) {
      const page = await drawCallout(language);
      const link = /<a\b[^>]*data-testid="volunteer-callout-button"[^>]*>/.exec(page)?.[0] ?? "";
      expect(link, language).toContain('target="_blank"');
      expect(link, language).toContain('rel="noopener"');
      expect(link, language).toContain(language === "ro" ? 'href="/ro/evenimente/crosul/voluntari"' : 'href="/en/events/the-cross/volunteers"');
      // The words of the button, then the new-tab mark; the accessible name says where it goes, like the legal links'.
      expect(link, language).toContain(language === "ro" ? 'aria-label="Vreau să fiu voluntar — se deschide într-o filă nouă"' : 'aria-label="I want to volunteer — opens in a new tab"');
      const button = /<a\b[^>]*data-testid="volunteer-callout-button"[\s\S]*?<\/a>/.exec(page)?.[0] ?? "";
      expect(button, language).toMatch(/VolunteerActivismIcon[\s\S]*Vreau să fiu voluntar|VolunteerActivismIcon[\s\S]*I want to volunteer/);
      expect(button, language).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-testid="volunteer-callout-new-tab"|<svg[^>]*data-testid="volunteer-callout-new-tab"[^>]*aria-hidden="true"/);
    }
  });

  it("keeps the glyph before the words, the 44 pixels, and says no number: the line names the roles only", async () => {
    const page = await drawCallout("ro");
    expect(page).toContain("Căutăm voluntari: Punct de apă, Sosire");
    expect(/data-testid="volunteer-callout-line"[^>]*>([^<]*)</.exec(page)?.[1] ?? "").not.toMatch(/\d/);
    expect(readFileSync("src/modules/volunteers/ui/VolunteerCallout.tsx", "utf8")).toMatch(/TAP_TARGET/);
    // Not the volunteers' own page's back link: that one stays in the same tab.
    expect(readFileSync("src/app/[locale]/events/[slug]/volunteers/page.tsx", "utf8")).not.toMatch(/target="_blank"/);
  });
});

describe("§773 the date of birth on the card's entry and on the public form", () => {
  it("draws the registration form's own box on the entry: day first, its placeholder, the echo's template, no age box — and a row's date as it was typed", async () => {
    const page = await drawCard({ profileDescribed: true });
    const box = tagOf(page, "input", "birthDate");
    expect(box).not.toBe("");
    expect(box).toContain('placeholder="ZZ.LL.AAAA"');
    expect(box).toContain('inputMode="numeric"');
    expect(page).not.toContain('name="age"');
    // Maria's row: her date, shown day first.
    const maria = /<li[^>]*data-testid="volunteer-row"[^>]*data-volunteer-id="55555555[\s\S]*?<\/li>/.exec(page)?.[0] ?? "";
    expect(tagOf(maria, "input", "birthDate")).toContain('value="12.03.1992"');
    // Ion's row has no date: an empty box.
    const ion = /<li[^>]*data-testid="volunteer-row"[^>]*data-volunteer-id="66666666[\s\S]*?<\/li>/.exec(page)?.[0] ?? "";
    expect(tagOf(ion, "input", "birthDate")).not.toMatch(/value="[^"]/);
  });

  it("says a row from before the date keeps its age until a date is typed, and shows «16 ani» alone for it", async () => {
    const old: VolunteerItem = { ...PEOPLE[1], id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Vlad Vechi", age: 16, dateOfBirth: null, guardianName: "Maria Popescu" };
    const page = await drawCard({ minorsOpen: true, volunteers: [old] });
    const row = /<li[^>]*data-testid="volunteer-row"[^>]*data-volunteer-id="aaaaaaaa[\s\S]*?<\/li>/.exec(page)?.[0] ?? "";
    expect(row).toContain("Rândul are doar vârsta: 16 ani");
    expect(row).toMatch(/data-testid="volunteer-facts"[^>]*>16 ani</);
    expect(tagOf(row, "input", "birthDate")).not.toMatch(/value="[^"]/);
  });

  it("shows «17 ani (12.03.2009)» on a row with its date, in both languages", async () => {
    const minor: VolunteerItem = { ...PEOPLE[1], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Dan Tânăr", age: 17, dateOfBirth: "2009-03-12", sex: null, city: null };
    const ro_ = await drawCard({ minorsOpen: true, volunteers: [minor] });
    expect(ro_).toMatch(/data-testid="volunteer-facts"[^>]*>17 ani \(12\.03\.2009\)</);
    const en_ = await drawCard({ minorsOpen: true, volunteers: [minor] }, "en");
    expect(en_).toMatch(/data-testid="volunteer-facts"[^>]*>17 years \(12\.03\.2009\)</);
  });

  it("draws the public box with the registration form's words and nothing hand-rolled: the box, its label, the echo and the unreadable sentence are the registration form's own", async () => {
    const page = await drawBox({ profile: true });
    expect(page).toContain(ro.Registration.birthDate);
    expect(tagOf(page, "input", "birthDate")).toContain('placeholder="' + ro.Registration.birthDatePlaceholder + '"');
    const source = readFileSync("src/modules/volunteers/ui/VolunteerBox.tsx", "utf8");
    expect(source).toMatch(/from "@\/modules\/registrations\/ui\/BirthDateField"/);
    expect(source).not.toMatch(/maskito|inputMode: "numeric", pattern: "\[0-9\]\*"/i);
    const card = readFileSync("src/modules/volunteers/ui/VolunteerBirthDateField.tsx", "utf8");
    expect(card).toMatch(/from "@\/modules\/registrations\/ui\/BirthDateField"/);
    // The mask is Maskito's, in the one place the registration form keeps it.
    expect(readFileSync("src/modules/registrations/ui/BirthDateField.tsx", "utf8")).toMatch(/useMaskito/);
  });

  it("works with scripts off: the box is a plain text box with the plain date pattern, and the guardian's block is opened by a noscript rule", async () => {
    const page = await drawBox({ profile: true, minors: true });
    const box = tagOf(page, "input", "birthDate");
    // The registration form's pattern: day first, eight digits or the posted shape — the server reads every one of them.
    expect(box).toContain('pattern="');
    expect(box).toContain('type="text"');
    expect(box).not.toContain('type="date"');
    expect(page).toContain("<noscript>");
  });
});
