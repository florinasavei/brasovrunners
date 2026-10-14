import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { DEFAULT_BADGE_DESIGN } from "@/modules/volunteers/badges/badge-design";
import type { BadgeRole } from "@/modules/volunteers/badges/badges";

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
  { id: "22222222-2222-4222-8222-222222222222", nameRo: "Punct de apă", nameEn: "Water point", needed: 3, colour: "#c62828", position: 0, createdAt: new Date("2026-10-14T08:00:00Z") },
  { id: "33333333-3333-4333-8333-333333333333", nameRo: "Sosire", nameEn: "Finish", needed: 2, colour: null, position: 1, createdAt: new Date("2026-10-14T08:00:00Z") },
  { id: "44444444-4444-4444-8444-444444444444", nameRo: "Fotograf", nameEn: "Photographer", needed: 1, colour: "#808080", position: 2, createdAt: new Date("2026-10-14T08:00:00Z") },
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
