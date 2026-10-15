import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { DEFAULT_BADGE_DESIGN } from "@/modules/volunteers/badges/badge-design";
import type { BadgeRole, BadgeSingleStart } from "@/modules/volunteers/badges/badges";

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
    expect(readFileSync("src/modules/volunteers/ui/VolunteersCard.tsx", "utf8")).toContain("<RoleColourFields names={ROLE_FORM_COLOUR_BOXES}");
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
    // §NNN: a role without a number adds the people it was given, and the help says so rather than call that what the roles «ask for».
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
