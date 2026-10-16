import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { PublicVolunteerCategory, PublicVolunteerRole } from "@/modules/volunteers/volunteers";

/**
 * §800 — the volunteers' page tells the volunteer the steps and that the organizers will confirm them (the owner, 2026-10-16:
 * «trebuie să îi spunem voluntarului care sunt pașii și că urmează să îl aprobăm (similar cu flow-ul participanților)»; then «e prea
 * îngust tot formularul»): «Cum funcționează voluntariatul» — four steps with a glyph each, folded under the intro as the register page
 * folds its own, its summary saying that the organizers confirm — the thank-you with «Ce urmează» and the one sentence about the receipt
 * email that is true for every outcome of the post, the same words typed once, and a form that spans the
 * page: no 560-pixel cap, the boxes in two columns from `md` up as the registration form's.
 */
const messages = { ro, en } as const;
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (arg?: string | { locale: "ro" | "en"; namespace: string }) =>
      typeof arg === "object"
        ? createTranslator({ locale: arg.locale, messages: messages[arg.locale], namespace: arg.namespace as "Event" })
        : createTranslator({ locale, messages: messages[locale], namespace: arg as "Event" }),
    getLocale: async () => locale,
  };
});
vi.mock("@/db/client", () => ({ getDb: () => undefined }));
vi.mock("@/app/[locale]/events/[slug]/volunteers/actions", () => ({ submitVolunteerAction: async () => {} }));
vi.mock("@/shared/feedback/PublicFlash", async () => {
  const { createElement: element } = await import("react");
  return { default: ({ accept }: { accept: readonly string[] }) => element("div", { "data-testid": "public-flash", "data-accepts": accept.join(",") }) };
});

const { default: VolunteerBox } = await import("@/modules/volunteers/ui/VolunteerBox");
const { default: VolunteerDone } = await import("@/modules/volunteers/ui/VolunteerDone");
const { default: VolunteerSteps, VOLUNTEER_STEPS } = await import("@/modules/volunteers/ui/VolunteerSteps");

const ROUTE_ID = "c2222222-2222-4222-8222-222222222222";
const role = (id: string, categoryId: string | null, nameRo: string, nameEn: string): PublicVolunteerRole => ({
  id,
  nameRo,
  nameEn,
  descriptionRo: null,
  descriptionEn: null,
  descriptionRoJson: null,
  descriptionEnJson: null,
  needed: 2,
  taken: 0,
  free: 2,
  categoryId,
});
const WATER = role("d3333333-3333-4333-8333-333333333333", ROUTE_ID, "Punct de hidratare", "Water point");
const CATEGORY_WITH_CONTACT: PublicVolunteerCategory = { id: ROUTE_ID, nameRo: "Traseu", nameEn: "Route", contact: { name: "Ana Popescu", phone: "+40712345678", email: "coordonator@club.test" } };
const CATEGORY_WITHOUT: PublicVolunteerCategory = { id: ROUTE_ID, nameRo: "Traseu", nameEn: "Route", contact: null };

async function steps(over: Partial<ComponentProps<typeof VolunteerSteps>> = {}, language: "ro" | "en" = "ro") {
  locale = language;
  return renderToStaticMarkup((await VolunteerSteps({ minors: false, contact: false, ...over })) as ReactElement).replace(/<style[\s\S]*?<\/style>/g, "");
}

/** The whole form as the server draws it, with the styles left in when a test reads the CSS. */
async function draw(over: Partial<ComponentProps<typeof VolunteerBox>> = {}, language: "ro" | "en" = "ro", { styles = false } = {}) {
  locale = language;
  const drawn = (await VolunteerBox({
    locale: language,
    slug: "cursa",
    eventTitle: "Crosul de toamnă",
    whenInSentence: "sâmbătă, 21 nov. 2026, la 09:00",
    sent: null,
    roles: [WATER],
    categories: [CATEGORY_WITHOUT],
    shirts: false,
    showCounts: false,
    eventDay: "2026-11-21",
    profile: true,
    minors: true,
    outcome: null,
    refused: [],
    typed: {},
    renderedAt: new Date("2026-10-14T10:00:00Z"),
    attempt: "attempt",
    ...over,
  })) as ReactElement;
  const { NextIntlClientProvider } = await import("next-intl");
  const intl = { locale: language, messages: { Event: messages[language].Event, Registration: messages[language].Registration } } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, drawn), { onError: () => {} });
  await stream.allReady;
  const page = (await new Response(stream).text()).replace(/<!-- -->/g, "");
  return styles ? page : page.replace(/<style[\s\S]*?<\/style>/g, "");
}

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("§800 «Cum funcționează voluntariatul»: four steps, a glyph each, in both languages", () => {
  it("lists the four steps in order — the form, the receipt email, the role and the confirmation, the day — each with its glyph and its number", async () => {
    const open = await steps();
    expect(open).toContain('data-testid="volunteer-steps"');
    expect(open).toContain("Cum funcționează voluntariatul");
    expect([...open.matchAll(/data-testid="volunteer-step-(\w+)"/g)].map((match) => match[1])).toEqual(["form", "email", "role", "day"]);
    expect(VOLUNTEER_STEPS.map((step) => step.key)).toEqual(["form", "email", "role", "day"]);
    const titles = ["1. Completezi formularul", "2. Primești emailul de primire", "3. Organizatorii îți aleg rolul și te confirmă", "4. În ziua evenimentului"];
    let at = -1;
    for (const title of titles) {
      const found = open.indexOf(title);
      expect(found, title).toBeGreaterThan(at);
      at = found;
    }
    for (const glyph of ["PersonAddIcon", "MarkEmailReadIcon", "AssignmentIndIcon", "EventAvailableIcon"]) expect(open, glyph).toContain(`data-testid="${glyph}"`);
    // The glyph is decoration; the number and the words say the step.
    expect(open.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(4);
    // Open: a section with a level-2 heading, not a fold.
    expect(open).not.toContain("<details");
    expect(open).toMatch(/<h2[^>]*>Cum funcționează voluntariatul<\/h2>/);
  });

  it("says in the third step that the organizers choose the role and confirm by email, that nothing is owed until then — and names no deadline", async () => {
    const third = /data-testid="volunteer-step-role"[\s\S]*?<\/li>/.exec(await steps())?.[0] ?? "";
    expect(text(third)).toContain("Îți scriem pe email rolul tău, cu data și locul");
    expect(text(third)).toContain("Până atunci nu ai nimic de făcut");
    // A volunteer owes nothing in a number of hours or days: none is promised.
    expect(text(await steps())).not.toMatch(/\d+\s*(ore|zile|minute|h\b)|în cel mult|în maximum/i);
  });

  it("adds the parent's consent that comes first to the third step only where the club takes minors", async () => {
    const withMinors = /data-testid="volunteer-step-role"[\s\S]*?<\/li>/.exec(await steps({ minors: true }))?.[0] ?? "";
    expect(text(withMinors)).toContain("Dacă ai sub 18 ani, părintele sau tutorele tău primește un email");
    const without = await steps({ minors: false });
    expect(without).not.toContain("sub 18 ani");
    expect(without).not.toContain("părintele");
    const english = /data-testid="volunteer-step-role"[\s\S]*?<\/li>/.exec(await steps({ minors: true }, "en"))?.[0] ?? "";
    expect(text(english)).toContain("If you are under 18, your parent or guardian is emailed a link");
    expect(await steps({ minors: false }, "en")).not.toContain("under 18");
  });

  it("points the last step to the contact person under the categories only when a drawn category has one", async () => {
    const last = (markup: string) => text(/data-testid="volunteer-step-day"[\s\S]*?<\/li>/.exec(markup)?.[0] ?? "");
    expect(last(await steps({ contact: true }))).toContain("persoanei de contact scrisă la categoria rolului, mai jos");
    expect(last(await steps({ contact: false }))).not.toContain("persoanei de contact");
    expect(last(await steps({ contact: true }, "en"))).toContain("the contact person under the category of your role, below");
  });

  it("names no category on the thank-you, where the cards are gone: the contact sentence points to the receipt email and says no «below»", async () => {
    const { volunteerStepWords } = await import("@/modules/volunteers/ui/VolunteerSteps");
    for (const language of ["ro", "en"] as const) {
      locale = language;
      const words = await volunteerStepWords("day", { minors: false, contact: true, where: "done" });
      expect(words.body, language).not.toMatch(/mai jos|below|categoria|category/);
      expect(words.body, language).toMatch(language === "ro" ? /din emailul de primire/ : /in the receipt email/);
    }
    // The form's own sentence is unchanged by it, and a page with no contact says nothing of one on either screen.
    locale = "ro";
    expect((await volunteerStepWords("day", { minors: false, contact: false, where: "done" })).body).not.toContain("persoanei de contact");
    expect((await volunteerStepWords("day", { minors: false, contact: true })).body).toContain("mai jos");
  });

  it("reads in English with the same four steps", async () => {
    const english = await steps({}, "en");
    for (const title of ["1. You fill in the form", "2. You get the receipt email", "3. The organizers choose your role and confirm you", "4. On the day of the event"]) {
      expect(english).toContain(title);
    }
    expect(english).toContain("How volunteering works");
  });

  it("folds the way the register page folds its own: a closed details whose summary has the list glyph and says that the organizers confirm, the list inside", async () => {
    const folded = await steps({ folded: true });
    expect(folded).toMatch(/^<details[^>]*data-testid="volunteer-steps"/);
    expect(folded).not.toMatch(/<details[^>]* open/);
    // The one fact a visitor wants before the form is in the closed fold's summary — the intro no longer says it.
    expect(folded).toMatch(/<summary[^>]*data-testid="volunteer-steps-summary"[^>]*>[\s\S]*FormatListNumberedIcon[\s\S]*Cum funcționează: organizatorii îți aleg rolul și te confirmă<\/summary>/);
    expect(folded).toContain('data-testid="volunteer-step-day"');
    expect(await steps({ folded: true }, "en")).toMatch(/<summary[^>]*>[\s\S]*How it works: the organizers choose your role and confirm you<\/summary>/);
  });
});

describe("§800 the steps stand on the volunteers' form, under the intro and above the roles — and the intro does not say it twice", () => {
  it("draws the intro, then the open steps, then «Ce ești dispus(ă) să faci»", async () => {
    const page = await draw();
    const intro = page.indexOf("Evenimentul are nevoie de ajutor");
    const fold = page.indexOf('data-testid="volunteer-steps"');
    const roles = page.indexOf("Ce ești dispus(ă) să faci");
    expect(intro).toBeGreaterThan(-1);
    expect(fold).toBeGreaterThan(intro);
    expect(roles).toBeGreaterThan(fold);
  });

  it("says «Organizatorii îți aleg rolul și te confirmă» in the third step only — open, no summary; never in the intro — and the intro keeps «nu ține loc»", async () => {
    const page = await draw();
    // The step's title (capital) once; the page is the form, so the steps are open and no lower-case fold summary repeats it.
    expect(page.match(/Organizatorii îți aleg rolul și te confirmă/g)).toHaveLength(1);
    expect(page.match(/organizatorii îți aleg rolul și te confirmă/g)).toBeNull();
    expect(page).not.toContain("<details data-testid=\"volunteer-steps\"");
    expect(page).toContain('data-testid="volunteer-step-role"');
    expect(page).toContain("Nu e o înscriere la cursă și nu ține loc.");
    expect(ro.Event.volunteers.intro).not.toMatch(/te confirmă/);
    expect(en.Event.volunteers.intro).not.toMatch(/confirm you/);
    const english = await draw({}, "en");
    expect(english.match(/The organizers choose your role and confirm you/g)).toHaveLength(1);
    expect(english.match(/the organizers choose your role and confirm you/g)).toBeNull();
  });

  it("passes the minors and the contact to the steps: the parent's sentence only with minors, the contact sentence only with a contact", async () => {
    const full = await draw({ minors: true, categories: [CATEGORY_WITH_CONTACT] });
    expect(full).toContain("Dacă ai sub 18 ani, părintele sau tutorele tău primește un email");
    expect(full).toContain("persoanei de contact scrisă la categoria rolului");
    // Neither on a page without minors and without a contact; the guardian block is not drawn either.
    const bare = await draw({ minors: false, profile: true, categories: [CATEGORY_WITHOUT] });
    expect(bare).not.toContain("sub 18 ani, părintele");
    expect(bare).not.toContain("persoanei de contact");
  });
});

describe("§800 the form spans the page: no 560-pixel cap, the boxes in two columns from md up", () => {
  it("has no 560-pixel cap on the form, and the roles' cards are not capped either", async () => {
    const page = await draw({}, "ro", { styles: true });
    expect(page).not.toMatch(/max-width:\s*560px/);
    const form = /<form[^>]*data-testid="volunteer-form"/.exec(page)?.[0] ?? "";
    expect(form).not.toBe("");
    const formClass = /class="([^"]*)"/.exec(form)?.[1]?.split(" ").pop() ?? "";
    // The form's own rule (its class) holds no max-width at all.
    const rule = new RegExp(`\\.${formClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{[^}]*\\}`).exec(page)?.[0] ?? "";
    expect(rule).not.toBe("");
    expect(rule).not.toMatch(/max-width/);
  });

  it("pairs the boxes as the registration form does: one column on a phone, two from md up, the telephone and the profile in different columns", async () => {
    const page = await draw({}, "ro", { styles: true });
    const grid = /data-testid="volunteer-fields"/.exec(page);
    expect(grid).not.toBeNull();
    expect(page).toMatch(/grid-template-columns:1fr;/);
    expect(page).toMatch(/@media \(min-width:900px\)\{[^}]*grid-template-columns:1fr 1fr/);
    const plain = page.replace(/<style[\s\S]*?<\/style>/g, "");
    const fields = plain.slice(plain.indexOf('data-testid="volunteer-fields"'));
    // Left column: name, email, phone; right column: the profile — then the optional message at full width, then the consents: every required box first.
    const order = ["volunteer-name", "volunteer-email", "volunteer-phone", 'data-testid="volunteer-profile"', "volunteer-message", 'data-testid="volunteer-consent"'].map((marker) => fields.indexOf(marker));
    expect(order.every((position) => position > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("draws no grid, no half-width column beside nothing, when the notice asks nothing about the person (no profile): the three boxes take the whole width", async () => {
    const page = await draw({ profile: false }, "ro", { styles: true });
    const open = /<div[^>]*data-testid="volunteer-fields"/.exec(page)?.[0] ?? "";
    expect(open).not.toBe("");
    const boxClass = /class="([^"]*)"/.exec(open)?.[1]?.split(" ").pop() ?? "";
    const rule = new RegExp(`\\.${boxClass}\\{[^}]*\\}`).exec(page)?.[0] ?? "";
    expect(rule).not.toMatch(/display:grid|grid-template-columns/);
    expect(page).not.toContain('data-testid="volunteer-profile"');
    // The message still closes the form's boxes, after the three.
    const plain = page.replace(/<style[\s\S]*?<\/style>/g, "");
    expect(plain.indexOf("volunteer-phone")).toBeLessThan(plain.indexOf("volunteer-message"));
  });
});

describe("§800 the thank-you: «Mulțumim, Ana!», the lead, when the receipt leaves and «Ce urmează»", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 10:00 in Brașov (UTC+3 in October 2026).
    vi.setSystemTime(new Date("2026-10-16T07:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  const done = async (over: Partial<ComponentProps<typeof VolunteerDone>> = {}, language: "ro" | "en" = "ro") => {
    locale = language;
    return renderToStaticMarkup((await VolunteerDone({ eventTitle: "Crosul de toamnă", when: "sâmbătă, 21 nov. 2026, la 09:00", sent: null, minors: false, contact: false, ...over })) as ReactElement);
  };
  const SENT = { firstName: "Ana", email: "ana@example.test" };

  it("is a status panel with the test id, a green-disc heading with the first name, and the lead naming the event and its date", async () => {
    const panel = await done({ sent: SENT });
    expect(panel).toMatch(/role="status"[^>]*data-testid="volunteer-done"|data-testid="volunteer-done"[^>]*role="status"/);
    expect(panel).toMatch(/<h2[^>]*>Mulțumim, Ana!<\/h2>/);
    expect(panel).toContain('data-testid="CelebrationIcon"');
    // The date is the sentence's own: lower-case weekday, «la» before the hour (§452).
    expect(text(panel)).toContain("Am primit oferta ta pentru Crosul de toamnă, sâmbătă, 21 nov. 2026, la 09:00.");
    expect(panel).not.toContain("<details");
  });

  it("greets nobody by name when the browser kept none, and leaves the date out when it is held back", async () => {
    const panel = await done({ when: null, sent: null });
    expect(panel).toMatch(/<h2[^>]*>Mulțumim!<\/h2>/);
    expect(text(panel)).toContain("Am primit oferta ta pentru Crosul de toamnă.");
    expect(text(panel)).not.toContain("Crosul de toamnă,");
    // No address kept: the receipt is said to come to the address written.
    expect(text(panel)).toContain("Emailul de primire vine la adresa pe care ai scris-o; dacă ai mai trimis oferta pentru acest eveniment, l-ai primit deja pe primul.");
    expect(text(panel)).not.toMatch(/pleacă|a plecat/);
  });

  it("says one thing about the receipt email that is true for every outcome of the post — it comes to the address typed, and a repeat has the first — with no hour and no «a plecat»", async () => {
    // A repeat of the same person, the loser of a race and a honeypot hit queue no email: the screen cannot tell them from a first offer, so it names no send time and no state.
    const line = async (language: "ro" | "en") =>
      text(/data-testid="volunteer-done-email-line"[^>]*>[\s\S]*?<\/p>/.exec(await done({ sent: SENT }, language))?.[0] ?? "");
    expect(await line("ro")).toContain("Emailul de primire vine la ana@example.test; dacă ai mai trimis oferta pentru acest eveniment, l-ai primit deja pe primul.");
    expect(await line("en")).toContain("The receipt email comes to ana@example.test; if you already sent an offer for this event, you got the first one.");
    for (const language of ["ro", "en"] as const) expect(await line(language), language).not.toMatch(/pleacă|a plecat|leaves|is leaving|has left|\d{2}:\d{2}/);
    // The messages carry no leaving-time key any more.
    for (const key of ["doneLeavesNow", "doneLeavesToday", "doneLeavesOn", "doneLeft"]) {
      expect(ro.Event.volunteers, key).not.toHaveProperty(key);
      expect(en.Event.volunteers, key).not.toHaveProperty(key);
    }
  });

  it("lists «Ce urmează» as three items with a glyph each, no numbers as the registration's — the receipt email, the role and the confirmation, the day — in the steps' own words", async () => {
    const panel = await done({ sent: SENT });
    const next = /data-testid="volunteer-done-next"[\s\S]*$/.exec(panel)?.[0] ?? "";
    expect(next).toMatch(/<h3[^>]*>Ce urmează<\/h3>/);
    expect([...next.matchAll(/<li[^>]*data-testid="volunteer-done-(\w+)"/g)].map((match) => match[1])).toEqual(["email", "role", "day"]);
    expect(next).toContain("Primești emailul de primire");
    expect(next).toContain("Organizatorii îți aleg rolul și te confirmă");
    expect(next).toContain("În ziua evenimentului");
    // The page's own list numbers its steps from the form; this one, which has no form step, carries no number at all.
    expect(text(next)).not.toMatch(/\b[1-4]\. /);
    // One text: every title and body is the steps' (the same message keys), not retyped.
    const list = await steps();
    for (const key of ["email", "role", "day"] as const) {
      const title = ro.Event.volunteers.steps[key].title;
      const body = ro.Event.volunteers.steps[key].body;
      expect(text(list), key).toContain(title);
      expect(text(list), key).toContain(body);
      expect(text(next), key).toContain(title);
      expect(text(next), key).toContain(body);
    }
    // The form is behind them: it is not on the list.
    expect(next).not.toContain("Completezi formularul");
  });

  it("puts the parent's consent second, on its own item, where the club takes minors — and nowhere else", async () => {
    const withMinors = await done({ minors: true });
    expect([...withMinors.matchAll(/<li[^>]*data-testid="volunteer-done-(\w+)"/g)].map((match) => match[1])).toEqual(["email", "guardian", "role", "day"]);
    const guardian = /data-testid="volunteer-done-guardian"[\s\S]*?<\/li>/.exec(withMinors)?.[0] ?? "";
    expect(text(guardian)).toContain("Părintele sau tutorele își dă acordul");
    expect(text(guardian)).toContain("părintele sau tutorele tău primește un email cu un link prin care își dă acordul");
    // The same sentence is not said a second time in the role's item.
    expect(text(/data-testid="volunteer-done-role"[\s\S]*?<\/li>/.exec(withMinors)?.[0] ?? "")).not.toContain("părintele");
    const without = await done({ minors: false });
    expect(without).not.toContain("volunteer-done-guardian");
    expect(without).not.toContain("părintele");
  });

  it("never points «below» on the thank-you, even where a category has a contact: the cards are gone, so it points to the receipt email", async () => {
    for (const language of ["ro", "en"] as const) {
      const panel = await done({ sent: SENT, contact: true }, language);
      expect(text(panel), language).not.toMatch(/mai jos|below/);
      expect(text(panel), language).toContain(language === "ro" ? "persoanei de contact din emailul de primire" : "the contact person named in the receipt email");
    }
    // The box after a send draws the same, with a contact on the page.
    const page = await draw({ outcome: "done", categories: [CATEGORY_WITH_CONTACT], sent: SENT });
    expect(text(page)).not.toMatch(/mai jos/);
    expect(text(page)).toContain("persoanei de contact din emailul de primire");
  });

  it("reads in English", async () => {
    const panel = await done({ sent: SENT, minors: true }, "en");
    expect(panel).toMatch(/<h2[^>]*>Thank you, Ana!<\/h2>/);
    expect(text(panel)).toContain("We received your offer for Crosul de toamnă, sâmbătă, 21 nov. 2026, la 09:00.");
    expect(panel).toMatch(/<h3[^>]*>What happens next<\/h3>/);
    expect(text(panel)).toContain("Your parent or guardian gives consent");
    expect(text(panel)).toContain("On the day of the event");
  });

  it("is what the form's box draws after a send, with the flash toast beside it and no fold", async () => {
    const page = await draw({
      outcome: "done",
      minors: false,
      sent: { firstName: "Ana", email: "ana@example.test" },
    });
    expect(page).toContain('data-testid="volunteer-done"');
    expect(page).toContain("Mulțumim, Ana!");
    expect(page).toContain('data-accepts="volunteerSent"');
    expect(page).not.toContain("<details");
    expect(page).not.toContain('data-testid="volunteer-form"');
  });
});
