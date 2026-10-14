import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import TranslateProvider, { type TranslateAction } from "@/modules/translate/ui/TranslateProvider";
import type { PublicVolunteerRole, VolunteerItem, VolunteerRole } from "@/modules/volunteers/volunteers";
import { CLUB_NAME } from "@/theme/brand";

/**
 * §NNN — the «Voluntari» card and the public form «Vreau să fiu voluntar» as the server draws them: the card's
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
    requestVolunteerAgreementAction: noop,
    setVolunteerStateAction: noop,
    switchVolunteersAction: noop,
    switchVolunteersShirtsAction: noop,
  };
});
vi.mock("@/app/[locale]/events/[slug]/actions", () => ({ submitVolunteerAction: async () => {} }));

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

describe("§NNN «Primește voluntari pe pagină» is a real tick, never a toggle button", () => {
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

describe("§NNN «Oferim tricouri voluntarilor» is the same tick as «Primește voluntari pe pagină»", () => {
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

describe("§NNN the organizers' entry draws the profile boxes only while the notice in force names them", () => {
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

describe("§NNN the role's form: «Descrierea rolului» in the rich-text editor, with «Copiază și tradu tot»", () => {
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

  it("shows the role's first line on the card and folds the rest behind a glyphed «Tot textul»", async () => {
    const page = await drawCard();
    const header = /<li[^>]*data-testid="volunteer-role"[^>]*data-role-id="22222222[\s\S]*?<details[\s\S]*?<\/details>/.exec(page)?.[0] ?? "";
    expect(header).toContain('data-testid="volunteer-role-description-first"');
    expect(header).toContain("Stai la km 5.");
    expect(header).toMatch(/<summary[^>]*>.*Tot textul<\/summary>/);
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

describe("§NNN the people: small chips for the two claims, one line of the rest, the size only while there are shirts", () => {
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

describe("§NNN the public form while the notice names the profile", () => {
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

  it("brings back what was typed after a refusal, and says «cel puțin 18 ani» for an age under it, «scrie vârsta» for anything else", async () => {
    const typed = { name: "Maria", age: "17", sex: "FEMALE", city: "Brașov", volunteeredBefore: "on", clubMember: "on", shirtSize: "L" };
    const under = await drawBox({ outcome: "invalid", refused: ["age"], typed, shirts: true });
    expect(tagOf(under, "input", "age")).toContain('value="17"');
    expect(under).toMatch(/<option value="FEMALE" selected/);
    expect(tagOf(under, "input", "city")).toContain('value="Brașov"');
    expect(tagOf(under, "input", "volunteeredBefore")).toContain("checked");
    expect(tagOf(under, "input", "clubMember")).toContain("checked");
    expect(under).toMatch(/<option value="L" selected/);
    expect(under).toContain("Voluntarii trebuie să aibă cel puțin 18 ani.");
    const typo = await drawBox({ outcome: "invalid", refused: ["age"], typed: { ...typed, age: "abc" } });
    expect(typo).toContain("Scrie vârsta în ani întregi, de exemplu 34.");
    expect(typo).not.toContain("Voluntarii trebuie să aibă cel puțin");
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

describe("§NNN each role's description under its tick on the public form", () => {
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

  it("keeps the role's own count beside the box, as help", async () => {
    const page = await drawBox();
    expect(page).toContain("mai sunt necesare 3 persoane");
    expect(page).toContain("mai e nevoie de 1 persoană");
  });
});
