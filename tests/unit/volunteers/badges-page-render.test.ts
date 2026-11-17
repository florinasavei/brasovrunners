import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { type BadgeDroppedKey, DEFAULT_BADGE_DESIGN } from "@/modules/volunteers/badges/badge-design";
import type { BadgeRole, BadgeSingleStart } from "@/modules/volunteers/badges/badges";
import { catalogueOf } from "@/i18n/catalogue";

// What a page reads: the platform's catalogue with this club's own sentences over it (§887).
const en = catalogueOf("en");
const ro = catalogueOf("ro");

/**
 * §764 — «Ecusoane pentru voluntari», its three cards as the server draws them (BR-REQ-050-02): the designer's
 * named folds top to bottom with the live preview's first address; each role's band colour with its state in
 * words, never by colour alone, and no palette colour that does not read; the print per role with the people
 * each needs, its spares, the badges «fără rol», the language and the download — in both languages.
 */
const messages = { ro, en } as const;
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    // The page's language by default; `{ locale, namespace }` for the words of a badge's own language (`badge-words.ts`).
    getTranslations: async (arg: string | { locale: "ro" | "en"; namespace: string }) =>
      typeof arg === "string"
        ? createTranslator({ locale, messages: messages[locale], namespace: arg as "Admin" })
        : createTranslator({ locale: arg.locale, messages: messages[arg.locale], namespace: arg.namespace as "Admin" }),
    getLocale: async () => locale,
  };
});
vi.mock("@/modules/media/storage", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/media/storage")>()), isStorageConfigured: () => false }));
vi.mock("@/db/client", () => ({ getDb: () => undefined }));
// The cards' Server Actions are the integration test's subject (`volunteers/badges.test.ts`); here they are only posted to.
vi.mock("@/app/[locale]/admin/events/[id]/badges/actions", () => ({ saveBadgeDesignAction: async () => null, saveBadgeRoleColoursAction: async () => null }));

const { default: BadgeDesignPanel } = await import("@/modules/volunteers/badges/ui/BadgeDesignPanel");
const { default: BadgeRoleColours } = await import("@/modules/volunteers/badges/ui/BadgeRoleColours");
const { default: BadgePrintPanel } = await import("@/modules/volunteers/badges/ui/BadgePrintPanel");

const EVENT = "11111111-1111-4111-8111-111111111111";
const ROLES: BadgeRole[] = [
  { id: "22222222-2222-4222-8222-222222222222", nameRo: "Punct de apă", nameEn: "Water point", needed: 3, assigned: 0, colour: "#c62828", position: 0, createdAt: new Date("2026-10-14T08:00:00Z"), categoryId: null, categoryRo: null, categoryEn: null, categoryPhone: null },
  { id: "33333333-3333-4333-8333-333333333333", nameRo: "Sosire", nameEn: "Finish", needed: 2, assigned: 0, colour: null, position: 1, createdAt: new Date("2026-10-14T08:00:00Z"), categoryId: null, categoryRo: null, categoryEn: null, categoryPhone: null },
  { id: "44444444-4444-4444-8444-444444444444", nameRo: "Fotograf", nameEn: "Photographer", needed: 1, assigned: 0, colour: "#808080", position: 2, createdAt: new Date("2026-10-14T08:00:00Z"), categoryId: null, categoryRo: null, categoryEn: null, categoryPhone: null },
];

async function html(draw: () => Promise<unknown>, language: "ro" | "en" = "ro"): Promise<string> {
  // The language first: a Server Component asks for its words as soon as it is called.
  locale = language;
  const drawn = await draw();
  const { NextIntlClientProvider } = await import("next-intl");
  const stream = await renderToReadableStream(
    createElement(NextIntlClientProvider, { locale: language, messages: messages[language] } as unknown as ComponentProps<typeof NextIntlClientProvider>, drawn as ReactElement),
  );
  await stream.allReady;
  return new Response(stream).text();
}

describe("§764 «Cum arată ecusonul»", () => {
  it("draws its six sections top to bottom as the badge prints, the preview's first address, and the save", async () => {
    const page = await html(() => BadgeDesignPanel({ eventId: EVENT, locale: "ro", design: DEFAULT_BADGE_DESIGN, sampleRole: ROLES[0].id, version: "abc" }));
    const order = ["badge-section-size", "badge-section-header", "badge-section-role", "badge-section-writing", "badge-section-phone", "badge-section-cut"].map((id) => page.indexOf(`data-testid="${id}"`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(page).toContain(`/api/admin/events/${EVENT}/badges/preview?`);
    expect(page).toMatch(/sample=1/);
    expect(page).toContain("90 × 35 mm — 16 pe o foaie A4");
    expect(page).toContain("100 × 40 mm — 14 pe o foaie A4");
    expect(page).toContain("Altă dimensiune");
    expect(page).toContain("Salvează ecusonul");
    // The badge prints no name: the writing area says so.
    expect(page).toContain("Nu se tipărește niciun nume.");
    // The design is kept per date, and the page says so.
    expect(page).toContain("fiecare dată a unei serii are ecusonul ei");
    // The preview is the page's own verb: the card opens by itself.
    expect(page).toMatch(/<details[^>]*id="box-badge-design"[^>]* open=""|<details[^>]* open=""[^>]*id="box-badge-design"/);
  });

  it("says beside a section that a stored value could not be read, and says nothing otherwise (§776)", async () => {
    const draw = (dropped: Array<"showFreeText" | "freeTextRo">) => html(() => BadgeDesignPanel({ eventId: EVENT, locale: "ro", design: DEFAULT_BADGE_DESIGN, sampleRole: ROLES[0].id, version: "abc", dropped }));
    const told = await draw(["showFreeText"]);
    expect(told).toContain('data-testid="badge-dropped"');
    expect(told).toContain("nu s-a putut citi și a fost lăsată deoparte");
    expect(await draw([])).not.toContain('data-testid="badge-dropped"');
  });

  it("shows the free-text line cut short in the closed section's heading, the Romanian only (§776)", async () => {
    const free = { ...DEFAULT_BADGE_DESIGN, showFreeText: true, freeTextRo: "Hidratează-te la fiecare punct de pe traseu, te rugăm", freeTextEn: "Drink water at every point along the course, please" };
    const page = await html(() => BadgeDesignPanel({ eventId: EVENT, locale: "ro", design: free, sampleRole: ROLES[0].id, version: "abc" }));
    expect(page).toContain("Hidratează-te la fiecare punct…");
    expect(page).not.toContain("Hidratează-te la fiecare punct de pe traseu, te rugăm /");
  });

  it("tells the picture's crop in the badge's words, never the race number's", () => {
    // The crop box lives in the client island and opens on a press, so what the page hands it is read from the source and the words.
    const source = readFileSync("src/modules/volunteers/badges/ui/BadgeDesignPanel.tsx", "utf8");
    expect(source).toContain('help: t("badges.design.headerPictureCropHelp")');
    expect(source).not.toContain("bibDesign.picture.cropHelp");
    expect(ro.Admin.badges.design.headerPictureCropHelp).toContain("pe toată lățimea ecusonului");
    expect(en.Admin.badges.design.headerPictureCropHelp).toContain("across the whole badge");
    for (const words of [ro.Admin.badges.design.headerPictureCropHelp, en.Admin.badges.design.headerPictureCropHelp]) expect(words).not.toMatch(/numărului|of the number/);
  });

  it("speaks English", async () => {
    const page = await html(() => BadgeDesignPanel({ eventId: EVENT, locale: "en", design: DEFAULT_BADGE_DESIGN, sampleRole: "none", version: "abc" }), "en");
    expect(page).toContain("What the badge looks like");
    expect(page).toContain("90 × 35 mm — 16 on an A4 sheet");
    // The sample is drawn without a role: the caption says so, not «the event's first role».
    expect(page).toContain("A sample badge, without a role.");
    expect(page).not.toContain("the event's first role");
    // Each box's placeholder is the word the badge prints in that box's language, whatever the page's.
    const placeholderOf = (name: string) => new RegExp(`<input[^>]*name="badge\\.design\\.${name}"[^>]*>`).exec(page)?.[0].match(/placeholder="([^"]*)"/)?.[1];
    expect(placeholderOf("labelRo")).toBe("VOLUNTAR");
    expect(placeholderOf("labelEn")).toBe("VOLUNTEER");
    expect(placeholderOf("phoneLabelRo")).toBe("Coordonator");
    expect(placeholderOf("phoneLabelEn")).toBe("Coordinator");
  });

  it("keeps a band colour from outside the palette as its own selected choice, so a save does not reset it", async () => {
    const design = { ...DEFAULT_BADGE_DESIGN, bandColour: "#0d47a1" };
    const page = await html(() => BadgeDesignPanel({ eventId: EVENT, locale: "ro", design, sampleRole: ROLES[0].id, version: "abc" }));
    expect(page).toMatch(/<option value="#0d47a1" selected="">Culoarea păstrată \(#0d47a1\)<\/option>/);
    // The closed fold names it too, never «Culoarea clubului».
    expect(page).toContain("Culoarea păstrată (#0d47a1) · ");
    // A palette colour is no extra choice.
    const palette = await html(() =>
      BadgeDesignPanel({ eventId: EVENT, locale: "ro", design: { ...DEFAULT_BADGE_DESIGN, bandColour: "#c62828" }, sampleRole: ROLES[0].id, version: "abc" }),
    );
    expect(palette).not.toContain("Culoarea păstrată");
    expect(palette).toMatch(/<option value="#c62828" selected="">/);
  });
});

describe("§764 «Culorile rolurilor»", () => {
  it("says each role's colour in words with its contrast, offers no colour that does not read, and says when a stored one does not", async () => {
    const page = await html(() => BadgeRoleColours({ eventId: EVENT, locale: "ro", roles: ROLES, design: DEFAULT_BADGE_DESIGN }));
    expect(page.match(/data-testid="badge-colour-row"/g)).toHaveLength(3);
    // Every line says the band is the badge's, so a contrast ratio on a role's row is never a riddle.
    expect(page).toContain("Banda pe ecuson: Roșu, contrast");
    expect(page).toContain("Banda pe ecuson: Portocaliul clubului, contrast");
    expect(page).toContain("Culoarea benzii pe ecuson");
    // The empty choice says it is the default, and is not mistaken for the palette's own orange.
    expect(page).toContain(">Implicit: portocaliul clubului</option>");
    expect(page).toContain("#808080, care nu se citește");
    // The palette's green does not carry its words at AA: not a choice.
    expect(page).not.toContain('value="#1b8a3a"');
    expect(page).toContain(">Altă culoare</option>");
    expect(page).toContain("Salvează culorile");
  });

  it("shows on each sample band the word the club typed, the one the badge prints", async () => {
    const design = { ...DEFAULT_BADGE_DESIGN, labelRo: "Staff", labelEn: "Crew" };
    const page = await html(() => BadgeRoleColours({ eventId: EVENT, locale: "ro", roles: ROLES, design }));
    expect(page.match(/>STAFF</g)).toHaveLength(3);
    expect(page).not.toContain(">VOLUNTAR<");
  });

  it("says where roles are made when the event has none", async () => {
    const page = await html(() => BadgeRoleColours({ eventId: EVENT, locale: "ro", roles: [], design: DEFAULT_BADGE_DESIGN }));
    expect(page).toContain('data-testid="badge-colours-empty"');
    expect(page).not.toContain("Salvează culorile");
  });
});

describe("§764 «Tipărire»", () => {
  it("posts its page's language, and says so when there is nothing to print", async () => {
    const page = await html(() => BadgePrintPanel({ eventId: EVENT, locale: "en", design: DEFAULT_BADGE_DESIGN, roles: [], eventTitle: "Crosul" }), "en");
    expect(page).toMatch(/<input[^>]*name="from"[^>]*value="en"|<input[^>]*value="en"[^>]*name="from"/);
    expect(page).toContain('data-testid="badge-print-nothing"');
    expect(page).toContain("Nothing to print: choose at least one badge.");
    expect(page).toContain("An A4 sheet holds 16 badges.");
    // With a role that needs people the boxes start above none: no such line.
    const withRoles = await html(() => BadgePrintPanel({ eventId: EVENT, locale: "ro", design: DEFAULT_BADGE_DESIGN, roles: ROLES, eventTitle: "Crosul" }));
    expect(withRoles).not.toContain('data-testid="badge-print-nothing"');
    expect(withRoles).toContain("Pe o foaie A4 încap 16 ecusoane.");
  });

  it("opens by itself when the route sent the numbers back refused", async () => {
    const opened = await html(() => BadgePrintPanel({ eventId: EVENT, locale: "ro", design: DEFAULT_BADGE_DESIGN, roles: ROLES, eventTitle: "Crosul", refused: true }));
    expect(opened).toMatch(/<details[^>]*id="box-badge-print"[^>]* open=""|<details[^>]* open=""[^>]*id="box-badge-print"/);
    const closed = await html(() => BadgePrintPanel({ eventId: EVENT, locale: "ro", design: DEFAULT_BADGE_DESIGN, roles: ROLES, eventTitle: "Crosul" }));
    expect(closed).not.toMatch(/<details[^>]*id="box-badge-print"[^>]* open=""/);
  });

  it("asks per role for the people it needs and its spares, the badges «fără rol» and the language, and posts to the sheet", async () => {
    const page = await html(() => BadgePrintPanel({ eventId: EVENT, locale: "ro", design: DEFAULT_BADGE_DESIGN, roles: ROLES, eventTitle: "Crosul" }));
    expect(page).toContain(`action="/api/admin/events/${EVENT}/badges"`);
    expect(page).toMatch(/method="get"/i);
    for (const role of ROLES) {
      expect(page).toContain(`name="n.${role.id}"`);
      expect(page).toContain(`name="x.${role.id}"`);
    }
    expect(page).toMatch(new RegExp(`name="n\\.${ROLES[0].id}"[^>]*value="3"|value="3"[^>]*name="n\\.${ROLES[0].id}"`));
    expect(page).toContain('name="none"');
    expect(page).toContain('name="locale"');
    expect(page).toContain("Descarcă ecusoanele (PDF)");
    expect(page).toContain("16 pe o foaie A4");
    // Each role's badge as saved, and the one «fără rol», stamped.
    expect(page.match(/badges\/preview\?locale=ro&amp;role=/g)).toHaveLength(4);
    // The limits are said before anyone meets them.
    expect(page).toContain("Cel mult 300 pe un rol și 1000 într-un fișier.");
  });

  it("starts a role that needs more than a pile holds at the most it prints, and names the club's own word", async () => {
    const many: BadgeRole = { ...ROLES[1], needed: 500 };
    const design = { ...DEFAULT_BADGE_DESIGN, labelRo: "Staff", labelEn: "Crew" };
    const page = await html(() => BadgePrintPanel({ eventId: EVENT, locale: "ro", design, roles: [many], eventTitle: "Crosul" }));
    const countBox = new RegExp(`<input[^>]*name="n\\.${many.id}"[^>]*>`).exec(page)?.[0] ?? "";
    expect(countBox).toContain('value="300"');
    expect(page).toContain("Doar „STAFF”, pentru cine vine fără rol.");
  });

  it("stamps a role's picture with its category's names too, so a category renamed is a new picture (§962)", async () => {
    const design = { ...DEFAULT_BADGE_DESIGN, mode: "perRole" as const };
    const onRoute: BadgeRole = { ...ROLES[0], categoryId: "55555555-5555-4555-8555-555555555555", categoryRo: "Traseu", categoryEn: "Route" };
    const pictureOf = async (one: BadgeRole) => {
      const page = await html(() => BadgePrintPanel({ eventId: EVENT, locale: "ro", design, roles: [one], eventTitle: "Crosul" }));
      return new RegExp(`badges/preview\\?locale=ro&amp;role=${one.id}&amp;v=([0-9a-f]+)`).exec(page)?.[1];
    };
    const under = await pictureOf(onRoute);
    const renamed = await pictureOf({ ...onRoute, categoryRo: "Pe traseu" });
    const renamedEn = await pictureOf({ ...onRoute, categoryEn: "On the route" });
    const none = await pictureOf(ROLES[0]);
    expect(under).toMatch(/^[0-9a-f]{8}$/);
    expect(new Set([under, renamed, renamedEn, none]).size).toBe(4);
  });
});

describe("§783 «Un singur ecuson» in the designer", () => {
  const draw = (design = DEFAULT_BADGE_DESIGN, language: "ro" | "en" = "ro", dropped: Array<"mode" | "singleColour"> = []) =>
    html(() => BadgeDesignPanel({ eventId: EVENT, locale: language, design, dropped, sampleRole: ROLES[0].id, version: "abc" }), language);
  const radio = (page: string, value: string) => new RegExp(`<input[^>]*name="badge\\.design\\.mode"[^>]*value="${value}"[^>]*>|<input[^>]*value="${value}"[^>]*name="badge\\.design\\.mode"[^>]*>`).exec(page)?.[0] ?? "";

  it("offers the two choices as radios — never a toggle — with the one badge for everyone chosen for a design that never chose", async () => {
    const page = await draw();
    expect(page).toContain('data-testid="badge-mode"');
    expect(page).toContain("Un singur ecuson pentru toți, fără rol");
    expect(page).toContain("Câte un ecuson pe rol");
    expect(radio(page, "single")).toContain('type="radio"');
    expect(radio(page, "single")).toContain('checked=""');
    expect(radio(page, "perRole")).toContain('type="radio"');
    expect(radio(page, "perRole")).not.toContain('checked=""');
    // The section comes first: it decides what the others mean. Its closed line says the choice in words.
    expect(page.indexOf('data-testid="badge-section-mode"')).toBeGreaterThan(-1);
    expect(page.indexOf('data-testid="badge-section-mode"')).toBeLessThan(page.indexOf('data-testid="badge-section-size"'));
    expect(page).toContain("Un singur ecuson");
  });

  it("checks the badge per role where the design chose it, and says so in the closed line", async () => {
    const page = await draw({ ...DEFAULT_BADGE_DESIGN, mode: "perRole" });
    expect(radio(page, "perRole")).toContain('checked=""');
    expect(radio(page, "single")).not.toContain('checked=""');
    expect(page).toContain("Pe roluri");
    expect(page).toContain('data-testid="badge-per-role-help"');
  });

  it("draws the one badge's band colour like a role's — the choice, the typed box, the state in words — with the limits said", async () => {
    const page = await draw();
    expect(page).toContain('data-testid="badge-single-colour"');
    expect(page).toContain('name="badge.design.singleColourChoice"');
    expect(page).toContain('name="badge.design.singleColourTyped"');
    // The state is told in words, with the contrast: never by colour alone.
    expect(page).toContain("Banda pe ecuson: Portocaliul clubului, contrast");
    expect(page).toContain(">Implicit: portocaliul clubului</option>");
    expect(page).toContain(">Altă culoare</option>");
    // The palette's green does not carry its words at AA: not a choice.
    expect(page).not.toContain('value="#1b8a3a"');
    // The limits in words, once.
    expect(page).toContain("contrast de cel puțin 4,5 la 1");
    // The one badge's own boxes are not a role's: no line about «only per role» under them.
    const single = /data-testid="badge-single-colour"[\s\S]*?<\/section>|data-testid="badge-single-colour"[\s\S]{0,6000}/.exec(page)?.[0] ?? "";
    expect(single).not.toContain('data-testid="badge-colour-per-role-only"');
  });

  it("keeps a palette colour chosen, and a typed one as «Altă culoare» with the colour in the box", async () => {
    const palette = await draw({ ...DEFAULT_BADGE_DESIGN, singleColour: "#6a1b9a" });
    expect(palette).toMatch(/<option value="#6a1b9a" selected="">/);
    expect(palette).toContain("Banda pe ecuson: Violet");
    const typed = await draw({ ...DEFAULT_BADGE_DESIGN, singleColour: "#0d47a1" });
    expect(typed).toMatch(/<option value="typed" selected="">Altă culoare<\/option>/);
    expect(typed).toMatch(/<input[^>]*name="badge\.design\.singleColourTyped"[^>]*value="#0d47a1"|<input[^>]*value="#0d47a1"[^>]*name="badge\.design\.singleColourTyped"/);
  });

  it("says «VOLUNTAR» is the band's word on the sample, and the club's own word when it typed one", async () => {
    expect(await draw()).toContain(">VOLUNTAR<");
    const staff = await draw({ ...DEFAULT_BADGE_DESIGN, labelRo: "Staff", labelEn: "Crew" });
    expect(staff).toContain(">STAFF<");
  });

  it("tells that a stored choice could not be read, beside its section, and nothing otherwise", async () => {
    expect(await draw(DEFAULT_BADGE_DESIGN, "ro", ["mode"])).toContain('data-testid="badge-dropped"');
    expect(await draw(DEFAULT_BADGE_DESIGN, "ro", [])).not.toContain('data-testid="badge-dropped"');
  });

  it("says on the telephone that the one badge needs the number typed, where the badges per role take their category's", async () => {
    const ticked = { ...DEFAULT_BADGE_DESIGN, showPhone: true };
    expect(await draw(ticked)).toContain("Scrie numărul");
    expect(await draw({ ...ticked, mode: "perRole" })).toContain("Din categoria rolului");
  });

  it("speaks English", async () => {
    const page = await draw(DEFAULT_BADGE_DESIGN, "en");
    expect(page).toContain("One badge for everyone, no role");
    expect(page).toContain("One badge per role");
    expect(page).toContain("Colour of the badge&#x27;s band");
    expect(page).toContain("Badge band: The club&#x27;s orange, contrast");
  });
});

describe("§965 «Logo-ul clubului jos, ca filigran» in the designer", () => {
  const draw = (design = DEFAULT_BADGE_DESIGN, language: "ro" | "en" = "ro", dropped: Array<"footerLogo"> = []) =>
    html(() => BadgeDesignPanel({ eventId: EVENT, locale: language, design, dropped, sampleRole: ROLES[0].id, version: "abc" }), language);
  const select = (page: string) => /<select[^>]*name="badge\.design\.footerLogo"[^>]*>[\s\S]*?<\/select>/.exec(page)?.[0] ?? "";
  const options = (page: string) => [...select(page).matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map(([, value, selected, words]) => ({ value, selected: Boolean(selected), words }));
  /** The logo's own fold (§969), from its heading to the next fold's. */
  const logoFold = (page: string) => page.slice(page.indexOf('data-testid="badge-section-footer-logo"'), page.indexOf('data-testid="badge-section-marker"'));

  it("is a native select of four choices in the logo's own fold (§969), with its help line, the platform's «Fără» chosen for a design that never chose", async () => {
    const page = await draw();
    expect(options(page)).toEqual([
      { value: "off", selected: true, words: "Fără" },
      { value: "faint", selected: false, words: "Puțin vizibil" },
      { value: "medium", selected: false, words: "Mediu" },
      { value: "strong", selected: false, words: "Bine vizibil" },
    ]);
    expect(page).toContain("Logo-ul clubului jos, ca filigran");
    expect(page).toContain("Logo-ul clubului mare și palid în partea de jos a ecusonului. Numele scris cu markerul se citește peste el.");
    // In the fold of its own, right after «Locul pentru nume», which no longer holds it (§969: the owner could not find it there).
    expect(logoFold(page)).toContain('name="badge.design.footerLogo"');
    const writing = page.slice(page.indexOf('data-testid="badge-section-writing"'), page.indexOf('data-testid="badge-section-footer-logo"'));
    expect(writing).toContain('name="badge.design.writingLine"');
    expect(writing).not.toContain('name="badge.design.footerLogo"');
    // Off is said as «Fără» in its own fold's closed line, never in the writing area's; the preview's first address says off.
    expect(page).not.toContain("Logo ca filigran");
    expect(page).toMatch(/badges\/preview\?[^"]*footerLogo=off/);
  });

  it("keeps the chosen level selected, says it in its fold's closed line — never in the writing area's — and draws the preview with it", async () => {
    const page = await draw({ ...DEFAULT_BADGE_DESIGN, footerLogo: "medium" });
    expect(options(page).filter((option) => option.selected).map((option) => option.value)).toEqual(["medium"]);
    // The share of the badge's width it is drawn at (§969): on the default strip §965's box is a quarter of it.
    expect(logoFold(page)).toContain("Mediu · 24% (cât încape)");
    expect(page).toMatch(/badges\/preview\?[^"]*footerLogo=medium/);
    // «Locul pentru nume» says its own look alone.
    expect(page).toContain("O linie subțire pentru nume");
    expect(page).not.toContain("O linie subțire pentru nume · ");
    expect(await draw({ ...DEFAULT_BADGE_DESIGN, footerLogo: "faint", writingLine: false })).not.toContain("Doar „Nume:” · ");
  });

  it("says beside its fold that a stored level could not be read", async () => {
    const told = await draw(DEFAULT_BADGE_DESIGN, "ro", ["footerLogo"]);
    expect(logoFold(told)).toContain('data-testid="badge-dropped"');
    const writing = told.slice(told.indexOf('data-testid="badge-section-writing"'), told.indexOf('data-testid="badge-section-footer-logo"'));
    expect(writing).not.toContain('data-testid="badge-dropped"');
    expect(await draw()).not.toContain('data-testid="badge-dropped"');
  });

  it("speaks English", async () => {
    const page = await draw({ ...DEFAULT_BADGE_DESIGN, footerLogo: "strong" }, "en");
    expect(options(page)).toEqual([
      { value: "off", selected: false, words: "None" },
      { value: "faint", selected: false, words: "Faint" },
      { value: "medium", selected: false, words: "Medium" },
      { value: "strong", selected: true, words: "Strong" },
    ]);
    expect(page).toContain("The club&#x27;s logo at the bottom, as a watermark");
    expect(page).toContain("The club&#x27;s logo, large and pale, at the bottom of the badge. The name written in marker reads over it.");
    expect(logoFold(page)).toContain("Strong · 24% (as much as fits)");
    expect(page).not.toContain("A thin line for the name · ");
  });
});

describe("§969 «Logo-ul clubului (filigran)», a fold of its own, with the logo's size, space and place", () => {
  const draw = (design = DEFAULT_BADGE_DESIGN, language: "ro" | "en" = "ro", dropped: BadgeDroppedKey[] = []) =>
    html(() => BadgeDesignPanel({ eventId: EVENT, locale: language, design, dropped, sampleRole: ROLES[0].id, version: "abc" }), language);
  const logoFold = (page: string) => page.slice(page.indexOf('data-testid="badge-section-footer-logo"'), page.indexOf('data-testid="badge-section-marker"'));
  /** The fold's own heading: its title and its closed line, before its first control. */
  const heading = (page: string) => logoFold(page).slice(0, logoFold(page).indexOf("<select"));
  /** One number box of the fold, by its key: the `<input>` as drawn. */
  const input = (page: string, key: string) => new RegExp(`<input[^>]*name="badge\\.design\\.${key}"[^>]*>`).exec(page)?.[0] ?? "";
  const attribute = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  const BOXES = [
    { key: "footerLogoSizePct", min: "10", max: "100", value: "67" },
    { key: "footerLogoPaddingMm", min: "0", max: "20", value: "0" },
    { key: "footerLogoOffsetXMm", min: "-100", max: "100", value: "0" },
    { key: "footerLogoOffsetYMm", min: "-100", max: "100", value: "0" },
  ] as const;

  it("comes right after «Locul pentru nume», with the image's glyph, and holds the select and the four number boxes, in that order", async () => {
    const page = await draw();
    const order = ["badge-section-writing", "badge-section-footer-logo", "badge-section-marker", "badge-section-phone"].map((id) => page.indexOf(`data-testid="${id}"`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The fold's own heading, folded like every section, with the glyph the house draws for a picture.
    expect(heading(page)).toContain("Logo-ul clubului (filigran)");
    expect(heading(page)).toContain('data-testid="ImageIcon"');
    const fold = logoFold(page);
    const controls = ["footerLogo", ...BOXES.map((box) => box.key)].map((key) => fold.indexOf(`name="badge.design.${key}"`));
    expect(controls.every((at) => at > -1)).toBe(true);
    expect([...controls].sort((a, b) => a - b)).toEqual(controls);
    // Nothing else is posted from it: five controls, no more.
    expect([...fold.matchAll(/name="badge\.design\.(\w+)"/g)].map((match) => match[1])).toEqual(["footerLogo", ...BOXES.map((box) => box.key)]);
  });

  it("draws each number as a native number box — whole steps within its bounds, the phone's digits keyboard where no number is negative — at the design's value, always enabled", async () => {
    const page = await draw();
    for (const { key, min, max, value } of BOXES) {
      const tag = input(page, key);
      expect(tag, key).not.toBe("");
      expect(attribute(tag, "type"), key).toBe("number");
      // The size and the space take the digits keyboard; the two moves none, so an iPhone gives them the keyboard with a minus key
      // (its digits pad has none, and a move left or up is negative).
      const keyboard = attribute(tag, "inputMode") ?? attribute(tag, "inputmode");
      if (Number(min) < 0) expect(keyboard, key).toBeUndefined();
      else expect(keyboard, key).toBe("numeric");
      expect(attribute(tag, "min"), key).toBe(min);
      expect(attribute(tag, "max"), key).toBe(max);
      expect(attribute(tag, "step"), key).toBe("1");
      expect(attribute(tag, "value"), key).toBe(value);
      // Posted whatever the level, «Fără» included: no box is disabled.
      expect(tag, key).not.toMatch(/\sdisabled=/);
    }
    // Said once more by name: the two moves are the boxes that take a minus sign, and neither asks for the digits pad.
    for (const key of ["footerLogoOffsetXMm", "footerLogoOffsetYMm"]) {
      expect(attribute(input(page, key), "min"), key).toBe("-100");
      expect(input(page, key), key).not.toMatch(/inputmode="numeric"/i);
    }
    const moved = await draw({ ...DEFAULT_BADGE_DESIGN, footerLogo: "strong", footerLogoSizePct: 90, footerLogoPaddingMm: 3, footerLogoOffsetXMm: -12, footerLogoOffsetYMm: 5 });
    expect(BOXES.map(({ key }) => attribute(input(moved, key), "value"))).toEqual(["90", "3", "-12", "5"]);
  });

  it("says each box's label and help line in Romanian", async () => {
    const fold = logoFold(await draw());
    for (const words of [
      "Mărimea logo-ului (% din lățimea ecusonului)",
      "Cât de lat e logo-ul, din lățimea ecusonului: urcă peste „Nume:” dacă e nevoie și se micșorează singur dacă nu încape în zona albă. La 67, cel implicit, rămâne sub „Nume:”.",
      "Spațiu în jurul logo-ului (mm)",
      "Spațiul păstrat liber în jurul logo-ului. Mai mult spațiu = logo mai mic.",
      "Deplasare stânga–dreapta (mm)",
      "Pozitiv = mai la dreapta, negativ = mai la stânga. Logo-ul rămâne în zona albă.",
      "Deplasare sus–jos (mm)",
      "Pozitiv = mai jos, negativ = mai sus. Logo-ul rămâne în zona albă.",
    ]) {
      expect(fold, words).toContain(words);
    }
  });

  it("says the level in its closed line and, while the logo is drawn, the share of the badge's width it is drawn at — never a size it is not", async () => {
    expect(heading(await draw())).toContain("Fără");
    expect(heading(await draw())).not.toContain("%");
    // The default 90 mm strip at 67: §965's box under «Nume:», a quarter of the width — the room keeps it under the size asked.
    expect(heading(await draw({ ...DEFAULT_BADGE_DESIGN, footerLogo: "medium" }))).toContain("Mediu · 24% (cât încape)");
    // A size typed is drawn as typed while the white holds it, and past the writing area's height as much as it holds.
    expect(heading(await draw({ ...DEFAULT_BADGE_DESIGN, footerLogo: "faint", footerLogoSizePct: 10 }))).toContain("Puțin vizibil · 10%");
    const typed = heading(await draw({ ...DEFAULT_BADGE_DESIGN, footerLogo: "medium", footerLogoSizePct: 30 }));
    expect(typed).toContain("Mediu · 30%");
    expect(typed).not.toContain("cât încape");
    expect(heading(await draw({ ...DEFAULT_BADGE_DESIGN, footerLogo: "strong", footerLogoSizePct: 90 }))).toContain("Bine vizibil · 36% (cât încape)");
    // A tall badge holds §965's two thirds at 67.
    expect(heading(await draw({ ...DEFAULT_BADGE_DESIGN, size: "custom", customWidthMm: 90, customHeightMm: 287, footerLogo: "medium" }))).toContain("Mediu · 67%");
    // A space that leaves less than a readable logo draws none, and the line says so.
    expect(heading(await draw({ ...DEFAULT_BADGE_DESIGN, footerLogo: "medium", footerLogoPaddingMm: 5 }))).toContain("Mediu · nu încape");
    // A size kept while the logo is off is not said: off draws nothing.
    expect(heading(await draw({ ...DEFAULT_BADGE_DESIGN, footerLogoSizePct: 40 }))).not.toContain("%");
  });

  it("draws the preview's first address with the four numbers, as the island redraws it", async () => {
    const page = await draw({ ...DEFAULT_BADGE_DESIGN, footerLogo: "medium", footerLogoSizePct: 80, footerLogoPaddingMm: 4, footerLogoOffsetXMm: -30, footerLogoOffsetYMm: 7 });
    const src = /badges\/preview\?[^"]*/.exec(page)?.[0].replaceAll("&amp;", "&") ?? "";
    const params = new URLSearchParams(src.slice(src.indexOf("?") + 1));
    expect([params.get("footerLogoSizePct"), params.get("footerLogoPaddingMm"), params.get("footerLogoOffsetXMm"), params.get("footerLogoOffsetYMm")]).toEqual(["80", "4", "-30", "7"]);
  });

  it("names the box beside a refusal by its label, and says beside the fold that a stored number could not be read", async () => {
    const source = readFileSync("src/modules/volunteers/badges/ui/BadgeDesignPanel.tsx", "utf8");
    for (const { key } of BOXES) expect(source, key).toContain(`[box("${key}")]: t("badges.design.${key}")`);
    for (const key of BOXES.map((box) => box.key)) {
      const told = await draw(DEFAULT_BADGE_DESIGN, "ro", [key]);
      expect(logoFold(told), key).toContain('data-testid="badge-dropped"');
    }
  });

  it("speaks English", async () => {
    const page = await draw({ ...DEFAULT_BADGE_DESIGN, footerLogo: "medium", footerLogoSizePct: 50 }, "en");
    expect(heading(page)).toContain("The club&#x27;s logo (watermark)");
    // 50 % of the default strip is more than its writing area's height holds: 36 %, as much as fits.
    expect(heading(page)).toContain("Medium · 36% (as much as fits)");
    expect(heading(await draw({ ...DEFAULT_BADGE_DESIGN, footerLogo: "medium", footerLogoPaddingMm: 5 }, "en"))).toContain("Medium · does not fit");
    const fold = logoFold(page);
    for (const words of [
      "Logo size (% of the badge&#x27;s width)",
      "How wide the logo is, of the badge&#x27;s width: it rises over “Name:” if it must, and shrinks by itself when the white area cannot hold it. At 67, the default, it stays under “Name:”.",
      "Space around the logo (mm)",
      "Room kept clear around the logo. More room = a smaller logo.",
      "Move left–right (mm)",
      "Positive = further right, negative = further left. The logo stays in the white area.",
      "Move up–down (mm)",
      "Positive = lower, negative = higher. The logo stays in the white area.",
    ]) {
      expect(fold, words).toContain(words);
    }
    expect(heading(await draw(DEFAULT_BADGE_DESIGN, "en"))).toContain("None");
  });
});

describe("§NNN «Spațiul pentru nume (% din înălțime)» in the designer", () => {
  const draw = (design = DEFAULT_BADGE_DESIGN, language: "ro" | "en" = "ro", dropped: Array<"nameSpacePct"> = []) =>
    html(() => BadgeDesignPanel({ eventId: EVENT, locale: language, design, dropped, sampleRole: ROLES[0].id, version: "abc" }), language);
  const numberBox = (page: string) => /<input[^>]*name="badge\.design\.nameSpacePct"[^>]*>/.exec(page)?.[0] ?? "";
  /** The fold «Locul pentru nume», from its start to the next fold's. */
  const writingFold = (page: string) => page.slice(page.indexOf('data-testid="badge-section-writing"'), page.indexOf('data-testid="badge-section-marker"'));

  it("is a native number box from 43 to 80, first among the fold's controls, with its help line, 43 for a design that never chose", async () => {
    const page = await draw();
    const input = numberBox(page);
    expect(input).toContain('type="number"');
    expect(input).toContain('min="43"');
    expect(input).toContain('max="80"');
    expect(input).toContain('step="1"');
    expect(input).toContain('inputMode="numeric"');
    expect(input).toContain('value="43"');
    const fold = writingFold(page);
    expect(fold).toContain("Spațiul pentru nume (% din înălțime)");
    expect(fold).toContain("Cât din înălțimea ecusonului rămâne albă pentru nume. Mai mult = benzile de sus mai mici. 43 = ca acum.");
    // First in the fold, before the line's tick and the watermark's select: the size of the place before what is drawn in it.
    const at = fold.indexOf('name="badge.design.nameSpacePct"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(fold.indexOf('name="badge.design.writingLine"'));
    expect(at).toBeLessThan(fold.indexOf('name="badge.design.footerLogo"'));
    expect(/<(input|select|textarea)\b[^>]*>/.exec(fold)?.[0]).toContain('name="badge.design.nameSpacePct"');
    // At 43 the closed line says nothing of it; the preview's first address says 43.
    expect(page).not.toContain("Spațiu pentru nume 43%");
    expect(page).toMatch(/badges\/preview\?[^"]*nameSpacePct=43/);
  });

  it("keeps the saved share in the box, says it in the closed line, and draws the preview with it", async () => {
    const page = await draw({ ...DEFAULT_BADGE_DESIGN, nameSpacePct: 60 });
    expect(numberBox(page)).toContain('value="60"');
    expect(page).toContain("Spațiu pentru nume 60% · O linie subțire pentru nume");
    expect(page).toMatch(/badges\/preview\?[^"]*nameSpacePct=60/);
    // The watermark has its own fold and its own closed line (the logo's controls): this one says the share and the line, the share first.
    const withLogo = await draw({ ...DEFAULT_BADGE_DESIGN, nameSpacePct: 80, writingLine: false, footerLogo: "faint" });
    expect(withLogo).toContain("Spațiu pentru nume 80% · Doar „Nume:”");
    expect(withLogo).not.toContain("Spațiu pentru nume 80% · Doar „Nume:” · ");
  });

  it("says beside its fold that a stored share could not be read, and names the box when a save refuses it", async () => {
    const told = await draw(DEFAULT_BADGE_DESIGN, "ro", ["nameSpacePct"]);
    expect(writingFold(told)).toContain('data-testid="badge-dropped"');
    expect(await draw()).not.toContain('data-testid="badge-dropped"');
    // The refusal's summary links the box under its label: the page hands the form the box's words.
    const source = readFileSync("src/modules/volunteers/badges/ui/BadgeDesignPanel.tsx", "utf8");
    expect(source).toContain('[box("nameSpacePct")]: t("badges.design.nameSpace")');
  });

  it("speaks English", async () => {
    const page = await draw({ ...DEFAULT_BADGE_DESIGN, nameSpacePct: 60 }, "en");
    expect(writingFold(page)).toContain("Space for the name (% of the height)");
    expect(page).toContain("How much of the badge&#x27;s height stays white for the name. More = smaller bands at the top. 43 = as today.");
    expect(page).toContain("Space for the name 60% · A thin line for the name");
    expect(numberBox(page)).toContain('value="60"');
  });
});

describe("§783 «Culorile rolurilor» serve the badges per role only", () => {
  it("says so in the closed line when the one badge is chosen, and keeps the colours", async () => {
    const single = await html(() => BadgeRoleColours({ eventId: EVENT, locale: "ro", roles: ROLES, design: DEFAULT_BADGE_DESIGN }));
    expect(single).toContain("Doar pe roluri");
    expect(single.match(/data-testid="badge-colour-row"/g)).toHaveLength(3);
    const perRole = await html(() => BadgeRoleColours({ eventId: EVENT, locale: "ro", roles: ROLES, design: { ...DEFAULT_BADGE_DESIGN, mode: "perRole" } }));
    expect(perRole).not.toContain("Doar pe roluri");
    expect(perRole).toContain("2 din 3 cu culoare proprie");
    // The intro says the colours are for the badge per role.
    expect(ro.Admin.badges.colours.intro).toContain("când ecusonul e pe roluri");
    expect(en.Admin.badges.colours.intro).toContain("when the badge is per role");
  });

  it("puts one line under a role's own colour boxes saying the colour serves the badge per role only, once on the badges' page (in its intro) and never under the one badge's", async () => {
    const { default: RoleColourFields } = await import("@/modules/volunteers/badges/ui/RoleColourFields");
    const names = { choice: "a", typed: "b" };
    const own = await html(() => RoleColourFields({ names, colour: null }));
    expect(own).toContain('data-testid="badge-colour-per-role-only"');
    expect(own).toContain("Culoarea se folosește doar când ecusonul e pe roluri.");
    expect(await html(() => RoleColourFields({ names, colour: null, perRoleHelp: false }))).not.toContain("badge-colour-per-role-only");
    expect(await html(() => RoleColourFields({ names, colour: null, forSingle: true }))).not.toContain("badge-colour-per-role-only");
    expect(await html(() => RoleColourFields({ names, colour: null }), "en")).toContain("The colour is used only when the badge is per role.");
    // The role's form in the «Voluntari» card draws the same boxes, so it says the same line.
    expect(readFileSync("src/modules/volunteers/ui/VolunteersCard.tsx", "utf8")).toContain("<RoleColourFields names={roleColourBoxesOf(key)}");
    // The badges' page's card shows every role's boxes, and keeps the line out of each of them.
    expect(readFileSync("src/modules/volunteers/badges/ui/BadgeRoleColours.tsx", "utf8")).toContain("perRoleHelp={false}");
  });
});

describe("§783 «Tipărire» of the one badge", () => {
  const single = (start: BadgeSingleStart, language: "ro" | "en" = "ro") =>
    html(() => BadgePrintPanel({ eventId: EVENT, locale: language, design: DEFAULT_BADGE_DESIGN, roles: ROLES, eventTitle: "Crosul", singleStart: start }), language);

  it("is one pile — «Câte ecusoane» and «În plus» — and no role's, no «Ecusoane fără rol»", async () => {
    const page = await single({ count: 37, basis: "confirmed" });
    expect(page.match(/data-testid="badge-print-row"/g)).toHaveLength(1);
    expect(page).toContain('data-role-id="all"');
    expect(page).toMatch(/<input[^>]*name="all"[^>]*value="37"|<input[^>]*value="37"[^>]*name="all"/);
    expect(page).toMatch(/<input[^>]*name="allx"[^>]*value="0"|<input[^>]*value="0"[^>]*name="allx"/);
    for (const role of ROLES) expect(page).not.toContain(`name="n.${role.id}"`);
    expect(page).not.toContain('name="none"');
    expect(page).not.toContain("Ecusoane fără rol");
    // The boxes take up to a file's worth: the whole pile is everyone.
    expect(page).toMatch(/<input[^>]*name="all"[^>]*max="1000"|<input[^>]*max="1000"[^>]*name="all"/);
    // The one picture, drawn without a role, and the download.
    expect(page.match(/badges\/preview\?locale=ro&amp;role=none/g)).toHaveLength(1);
    expect(page).not.toContain("role=22222222");
    expect(page).toContain("Descarcă ecusoanele (PDF)");
    expect(page).toContain("Ecusonul pentru toți");
    expect(page).toContain("Un singur ecuson pentru toți voluntarii. Pe o foaie A4 încap 16 ecusoane. Cel mult 1000 într-un fișier.");
  });

  it("says where the number starts: the confirmed volunteers, what the roles need, what they need with the people given a role without a number, or the fallback", async () => {
    expect(await single({ count: 37, basis: "confirmed" })).toContain("Începe de la voluntarii confirmați ai evenimentului: 37.");
    expect(await single({ count: 20, basis: "needed" })).toContain("Încă nu e niciun voluntar confirmat, așa că începe de la câți cer rolurile împreună: 20.");
    // §784: a role without a number adds the people it was given, and the help says so rather than call that what the roles «ask for».
    expect(await single({ count: 11, basis: "neededNoNumber" })).toContain("începe de la câți cer rolurile împreună și, pentru un rol fără număr, de la oamenii cărora le-ai dat rolul: 11.");
    expect(await single({ count: 11, basis: "neededNoNumber" }, "en")).toContain("and for a role with no limit at the people you gave it: 11.");
    expect(await single({ count: 10, basis: "fallback" })).toContain("niciun rol nu cere pe nimeni, așa că începe de la 10.");
    expect(await single({ count: 37, basis: "confirmed" }, "en")).toContain("It starts at the event&#x27;s confirmed volunteers: 37.");
  });

  it("is a pile per role, as before, while the design chooses the badges per role", async () => {
    const page = await html(() => BadgePrintPanel({ eventId: EVENT, locale: "ro", design: { ...DEFAULT_BADGE_DESIGN, mode: "perRole" }, roles: ROLES, eventTitle: "Crosul", singleStart: null }));
    expect(page.match(/data-testid="badge-print-row"/g)).toHaveLength(4);
    expect(page).not.toContain('name="all"');
    expect(page).toContain('name="none"');
  });
});
