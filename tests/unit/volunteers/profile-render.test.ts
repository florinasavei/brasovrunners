import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import type { PublicVolunteerRole, VolunteerItem, VolunteerRole } from "@/modules/volunteers/volunteers";
import { CLUB_NAME } from "@/theme/brand";

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
    addVolunteerRoleAction: noop,
    assignVolunteerAction: noop,
    deleteVolunteerAction: noop,
    deleteVolunteerRoleAction: noop,
    editVolunteerAction: noop,
    editVolunteerRoleAction: noop,
    moveVolunteerRoleAction: noop,
    recordPaperVolunteerAgreementAction: noop,
    recordPaperVolunteerGuardianAction: noop,
    requestVolunteerAgreementAction: noop,
    requestVolunteerGuardianAction: noop,
    setVolunteerStateAction: noop,
    switchVolunteersAction: noop,
    switchVolunteersShirtsAction: noop,
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
    profileDescribed: true,
    minorsOpen: false,
    offerClosed: "off",
    roles: [ROLE, FINISH_ROLE, NO_DESCRIPTION],
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
  });
  const drawn = (await VolunteerBox({
    locale: language,
    slug: "cursa",
    roles: [publicRole(ROLE), publicRole(FINISH_ROLE), publicRole(NO_DESCRIPTION)],
    shirts: false,
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
  it("draws the age, the sex, the city, the two ticks and the size while it does, and none of them while it does not", async () => {
    const named = await drawCard({ profileDescribed: true, volunteersShirts: true });
    for (const box of ["age", "city", "volunteeredBefore", "clubMember"]) expect(named, box).toContain(`name="${box}"`);
    expect(named).toContain('name="shirtSize"');
    const unnamed = await drawCard({ profileDescribed: false, volunteersShirts: true });
    for (const box of ["age", "city", "volunteeredBefore", "clubMember", "shirtSize"]) expect(unnamed, box).not.toContain(`name="${box}"`);
    // The rest of the entry is there as ever.
    expect(unnamed).toContain('name="phone"');
    expect(unnamed).toContain(ro.Admin.volunteers.offer.profileOff);
  });
});

describe("§765 the role's form: «Descrierea rolului» in the rich-text editor, with «Copiază și tradu tot»", () => {
  it("draws, in the add form and in every role's edit form, the translate button, one editor per language and no one-line box", async () => {
    const page = await drawCard();
    // One button per form: «Adaugă un rol» and the three roles' «Modifică».
    expect((page.match(/data-testid="translate-all"/g) ?? []).length).toBe(4);
    expect((page.match(/name="descriptionRoBody"/g) ?? []).length).toBe(4);
    expect((page.match(/name="descriptionEnBody"/g) ?? []).length).toBe(4);
    expect(page).toContain("Descrierea rolului (Română, opțional)");
    expect(page).toContain("Descrierea rolului (English, opțional)");
    expect(page).toContain(ro.Admin.volunteers.role.descriptionHelp.replace("{max}", "2000"));
    // The old one-line box and its 200-character help are gone.
    expect(page).not.toMatch(/<input[^>]*name="descriptionRo"/);
    expect(page).not.toMatch(/<input[^>]*name="descriptionEn"/);
    expect(page).not.toContain('maxlength="200"');
    // The stored document is what the editor posts until it is opened.
    expect(page).toContain("Stai la km 5.");
  });

  it("says why the button is grey while the provider is off, like the editor's", async () => {
    const off = await drawCard({}, "ro", { action: null, setupHref: "/admin/tasks#translate" } as never);
    expect(off).toContain('data-translate-state="off"');
    expect((off.match(/data-translate-state="off"/g) ?? []).length).toBe(4);
    expect(off).toContain(ro.Translate.off);
  });

  it("shows the role's first line on the card and folds the rest behind a glyphed «Restul»", async () => {
    const page = await drawCard();
    const header = /<li[^>]*data-testid="volunteer-role"[^>]*data-role-id="22222222[\s\S]*?<details[\s\S]*?<\/details>/.exec(page)?.[0] ?? "";
    expect(header).toContain('data-testid="volunteer-role-description-first"');
    expect(header).toContain("Stai la km 5.");
    expect(header).toMatch(/<summary[^>]*>.*Restul<\/summary>/);
    // A one-line description has nothing to fold; none says nothing.
    const finish = /<li[^>]*data-testid="volunteer-role"[^>]*data-role-id="33333333[\s\S]*?<\/li>/.exec(page)?.[0] ?? "";
    expect(finish).toContain("Aplauze la sosire");
    expect(/<li[^>]*data-testid="volunteer-role"[^>]*data-role-id="44444444[\s\S]*?<\/li>/.exec(page)?.[0]).not.toContain('data-testid="volunteer-role-description"');
    // English, the English words.
    const english = await drawCard({}, "en");
    expect(english).toContain('data-testid="volunteer-role-description-first"');
    expect(english).toContain("Stand at km 5.");
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
    expect(maria).toMatch(/data-testid="volunteer-facts"[^>]*>Vârsta: 34 · Feminin · Oraș: Brașov · Tricou: M</);
    // Someone who said nothing has neither the chips nor the line.
    const ion = /<li[^>]*data-testid="volunteer-row"[^>]*data-volunteer-id="66666666[\s\S]*?<\/li>/.exec(page)?.[0] ?? "";
    expect(ion).not.toContain("volunteer-claims");
    expect(ion).not.toContain("volunteer-facts");
    // Without shirts the size is shown nowhere.
    const none = await drawCard({ volunteersShirts: false });
    expect(none).not.toContain("Tricou: M");
    expect(none).toMatch(/Vârsta: 34 · Feminin · Oraș: Brașov</);
  });

  it("speaks English", async () => {
    const page = await drawCard({ volunteersShirts: true }, "en");
    expect(page).toContain("Volunteered before");
    expect(page).toContain(`From the ${CLUB_NAME} group`);
    expect(page).toMatch(/Age: 34 · Female · City: Brașov · T-shirt: M/);
  });

  it("offers the entry's boxes: age, sex, city, the two claims — and the size only while the event gives shirts", async () => {
    const without = await drawCard({ volunteersShirts: false });
    for (const name of ["age", "sex", "city", "volunteeredBefore", "clubMember"]) expect(without, name).toContain(`name="${name}"`);
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
  it("asks the age, the sex (the registration form's own box), the city and the two ticks, and no tick «Am cel puțin 18 ani»", async () => {
    const page = await drawBox();
    const age = tagOf(page, "input", "age");
    expect(age).toContain("required");
    expect(age).toContain('inputMode="numeric"');
    expect(age).toContain('id="volunteer-age"');
    const sex = tagOf(page, "select", "sex");
    expect(sex).toContain("required");
    expect(page).toContain('<option value="FEMALE">Feminin</option>');
    expect(page).toContain('<option value="MALE">Masculin</option>');
    expect(tagOf(page, "input", "city")).toContain("required");
    expect(page).toContain("Vârsta");
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
    for (const name of ["age", "sex", "city", "volunteeredBefore", "clubMember", "shirtSize"]) expect(page, name).not.toContain(`name="${name}"`);
  });

  it("brings back what was typed after a refusal, and says one of three sentences for the age: no minors yet, «cel puțin 14 ani», «scrie vârsta»", async () => {
    const typed = { name: "Maria", age: "17", sex: "FEMALE", city: "Brașov", volunteeredBefore: "on", clubMember: "on", shirtSize: "L" };
    // Seventeen while the notice and the agreement do not describe minors: the club says it cannot take them yet (§NNN).
    const under = await drawBox({ outcome: "invalid", refused: ["age"], typed, shirts: true });
    expect(tagOf(under, "input", "age")).toContain('value="17"');
    expect(under).toMatch(/<option value="FEMALE" selected/);
    expect(tagOf(under, "input", "city")).toContain('value="Brașov"');
    expect(tagOf(under, "input", "volunteeredBefore")).toContain("checked");
    expect(tagOf(under, "input", "clubMember")).toContain("checked");
    expect(under).toMatch(/<option value="L" selected/);
    expect(under).toContain("Clubul nu primește încă voluntari sub 18 ani.");
    // Thirteen, where minors are taken: the floor is fourteen.
    const young = await drawBox({ outcome: "invalid", refused: ["age"], typed: { ...typed, age: "13" }, minors: true });
    expect(young).toContain("Voluntarii trebuie să aibă cel puțin 14 ani.");
    expect(young).not.toContain("Clubul nu primește încă");
    const typo = await drawBox({ outcome: "invalid", refused: ["age"], typed: { ...typed, age: "abc" } });
    expect(typo).toContain("Scrie vârsta în ani întregi, de exemplu 34.");
    expect(typo).not.toContain("Voluntarii trebuie să aibă cel puțin");
    expect(typo).not.toContain("Clubul nu primește încă");
    // The summary links to the box.
    expect(under).toContain('href="#volunteer-age"');
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
    const all = { age: 34, sex: "FEMALE" as const, city: "Brașov", volunteeredBefore: true, clubMember: true, shirtSize: "M" as const, ...noGuardian };
    locale = "ro";
    const page = await html(createElement("p", null, (await VolunteerAnswers({ offer: all })) as ReactElement));
    expect(page).toContain(" · Vârsta: 34 · Feminin · Oraș: Brașov · A mai fost voluntar · Din grupul " + CLUB_NAME + " · Tricou: M");
    locale = "en";
    const english = await html(createElement("p", null, (await VolunteerAnswers({ offer: all })) as ReactElement));
    expect(english).toContain("Age: 34");
    expect(english).toContain("Female");
    expect(english).toContain("T-shirt: M");
  });

  it("writes nothing for a row from before, for the retired «Prefer să nu spun» and for «Fără tricou»", async () => {
    const { default: VolunteerAnswers } = await import("@/modules/volunteers/ui/VolunteerAnswers");
    locale = "ro";
    const empty = { age: null, sex: null, city: null, volunteeredBefore: false, clubMember: false, shirtSize: null, guardianName: null, guardianEmail: null, guardianAcceptedAt: null, guardianMethod: null };
    expect(await html(createElement("p", null, (await VolunteerAnswers({ offer: empty })) as ReactElement))).toBe("<p></p>");
    const retired = await html(createElement("p", null, (await VolunteerAnswers({ offer: { ...empty, sex: "UNSPECIFIED", shirtSize: "NONE" } })) as ReactElement));
    expect(retired).toBe("<p></p>");
  });
});

/** A volunteer under eighteen on the card: fifteen, the parent named, with or without an address, accepted or not (§NNN). */
const MINOR: VolunteerItem = {
  ...PEOPLE[0],
  id: "77777777-7777-4777-8777-777777777777",
  name: "Dan Tânărul",
  email: "dan@example.test",
  age: 15,
  guardianName: "Maria Popescu",
  guardianEmail: "maria@example.test",
};

describe("§NNN the public form's block for a parent or guardian", () => {
  it("is drawn hidden — an adult never sees it flash — with no box required and no asterisk, a noscript rule opening it, inside the island that follows the age", async () => {
    const page = await drawBox({ minors: true });
    expect(page).toContain('data-testid="volunteer-guardian-block"');
    expect(page).toContain('data-testid="volunteer-guardian"');
    // Hidden in the markup before any age is typed (the island shows it from the age, after it hydrates), and scripts off open it.
    expect(/<div[^>]*data-testid="volunteer-guardian-block"[^>]*>/.exec(page)?.[0]).toContain("hidden");
    // (The helper strips every <style>, so the noscript rule is read from the island drawn on its own.)
    const GuardianFields = (await import("@/modules/volunteers/ui/GuardianFields")).default;
    const island = renderToStaticMarkup(createElement(GuardianFields, { ageInputId: "age", minimumAge: 14, adultAge: 18, startOpen: false, children: "x" }));
    expect(island).toContain('<noscript><style>[data-testid="volunteer-guardian-block"]{display:block !important}</style></noscript>');
    expect(page).toContain("<noscript>");
    // A minor's age typed back after a refusal draws it open from the first byte: nothing to hydrate into.
    const back = await drawBox({ minors: true, typed: { age: "16" } });
    expect(/<div[^>]*data-testid="volunteer-guardian-block"[^>]*>/.exec(back)?.[0]).not.toContain("hidden");
    const adultBack = await drawBox({ minors: true, typed: { age: "30" } });
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
    expect(page).toContain("Vârsta");
    expect(page).toContain("cel puțin 14 ani");
  });

  it("is not drawn while the club cannot take minors, and the age then says eighteen", async () => {
    const page = await drawBox({ minors: false });
    expect(page).not.toContain("volunteer-guardian-block");
    for (const name of ["guardianName", "guardianEmail", "guardianAware"]) expect(page, name).not.toContain(`name="${name}"`);
    expect(page).toContain("trebuie să ai cel puțin 18 ani");
  });

  it("is not drawn on §758's form, which asks no age: the tick says eighteen, never fourteen", async () => {
    const page = await drawBox({ profile: false, minors: true });
    expect(page).not.toContain("volunteer-guardian-block");
    expect(page).toContain("Am cel puțin 18 ani");
    expect(page).not.toContain("Am cel puțin 14 ani");
  });

  it("brings back the parent's name and address after a refusal — never the tick, the person's own act — and names the boxes it refused", async () => {
    const typed = { name: "Dan", age: "15", sex: "MALE", city: "Brașov", guardianName: "Maria Popescu", guardianEmail: "maria@example.test" };
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

  it("says «clubul nu primește încă» for an age under eighteen while minors are closed, and «cel puțin 14 ani» below fourteen where they are taken", async () => {
    const closed = await drawBox({ minors: false, outcome: "invalid", refused: ["age"], typed: { age: "15" } });
    expect(closed).toContain("Clubul nu primește încă voluntari sub 18 ani.");
    const young = await drawBox({ minors: true, outcome: "invalid", refused: ["age"], typed: { age: "13" } });
    expect(young).toContain("Voluntarii trebuie să aibă cel puțin 14 ani.");
    const english = await drawBox({ minors: false, outcome: "invalid", refused: ["age"], typed: { age: "15" } }, "en");
    expect(english).toContain("The club does not take volunteers under 18 yet.");
  });
});

describe("§NNN the form is the volunteers' own page's: the thank-you with its flash, and no fold", () => {
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

describe("§NNN the card: the parent's agreement, in words", () => {
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

describe("§NNN the event page keeps one line and one button", () => {
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
