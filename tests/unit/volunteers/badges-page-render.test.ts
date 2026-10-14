import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { DEFAULT_BADGE_DESIGN } from "@/modules/volunteers/badges/badge-design";
import type { BadgeRole } from "@/modules/volunteers/badges/badges";

/**
 * §NNN — «Ecusoane pentru voluntari», its three cards as the server draws them (BR-REQ-050-02): the designer's
 * named folds top to bottom with the live preview's first address; each role's band colour with its state in
 * words, never by colour alone, and no palette colour that does not read; the print per role with the people
 * each needs, its spares, the badges «fără rol», the language and the download — in both languages.
 */
const messages = { ro, en } as const;
let locale: "ro" | "en" = "ro";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale, messages: messages[locale], namespace: namespace as "Admin" }),
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

describe("§NNN «Cum arată ecusonul»", () => {
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
  });

  it("speaks English", async () => {
    const page = await html(() => BadgeDesignPanel({ eventId: EVENT, locale: "en", design: DEFAULT_BADGE_DESIGN, sampleRole: "none", version: "abc" }), "en");
    expect(page).toContain("What the badge looks like");
    expect(page).toContain("90 × 35 mm — 16 on an A4 sheet");
  });
});

describe("§NNN «Culorile rolurilor»", () => {
  it("says each role's colour in words with its contrast, offers no colour that does not read, and says when a stored one does not", async () => {
    const page = await html(() => BadgeRoleColours({ eventId: EVENT, locale: "ro", roles: ROLES }));
    expect(page.match(/data-testid="badge-colour-row"/g)).toHaveLength(3);
    expect(page).toContain("Acum: Roșu, contrast");
    expect(page).toContain("Acum: Culoarea temei (portocaliu), contrast");
    expect(page).toContain("#808080, care nu se citește");
    // The palette's green does not carry its words at AA: not a choice.
    expect(page).not.toContain('value="#1b8a3a"');
    expect(page).toContain("Altă culoare (scrisă alături)");
    expect(page).toContain("Salvează culorile");
  });

  it("says where roles are made when the event has none", async () => {
    const page = await html(() => BadgeRoleColours({ eventId: EVENT, locale: "ro", roles: [] }));
    expect(page).toContain('data-testid="badge-colours-empty"');
    expect(page).not.toContain("Salvează culorile");
  });
});

describe("§NNN «Tipărire»", () => {
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
  });
});
