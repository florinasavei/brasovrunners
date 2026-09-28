import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §NNN — the approved legal text's PDF, the copy the club archives and hands to counsel, says the
 * version line as the public pages do: «În vigoare din 28 septembrie 2026» — the whole date, the
 * month in words, no weekday. The backoffice's own three places (the list, the document's page,
 * the delete confirmation) read the same helper.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const captured = vi.hoisted(() => ({ labels: null as null | { effectiveFrom: string } }));

vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => ({ id: "s1", role: "ADMIN" }),
}));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/legal-documents/repository", () => ({
  findVersionWithTranslations: async () => ({
    key: "TERMS",
    version: 6,
    isApproved: true,
    // 28 September 2026, 00:30 in Bucharest — still the 27th in UTC: the club's zone decides.
    effectiveAt: new Date("2026-09-27T21:30:00Z"),
    contentSha256: "0".repeat(64),
    translations: [
      { locale: "ro", title: "Termeni", body: { sections: [{ heading: "1", paragraphs: ["Text."] }] } },
      { locale: "en", title: "Terms", body: { sections: [{ heading: "1", paragraphs: ["Text."] }] } },
    ],
  }),
}));
vi.mock("@/modules/legal-documents/pdf", () => ({
  renderLegalDocumentPdf: async (input: { labels: { effectiveFrom: string } }) => {
    captured.labels = input.labels;
    return new Uint8Array([37, 80, 68, 70]);
  },
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const catalogues = {
    ro: (await import("../../../messages/ro.json")).default,
    en: (await import("../../../messages/en.json")).default,
  };
  return {
    getTranslations: async ({ locale, namespace }: { locale: "ro" | "en"; namespace: string }) =>
      createTranslator({ locale, messages: catalogues[locale] as typeof catalogues.ro, namespace: namespace as "Admin" }),
  };
});

const { GET } = await import("@/app/api/admin/legal/[id]/pdf/route");

async function effectiveFrom(locale: "ro" | "en"): Promise<string> {
  captured.labels = null;
  const response = await GET(new Request(`http://localhost/api/admin/legal/${DOCUMENT_ID}/pdf?locale=${locale}`), {
    params: Promise.resolve({ id: DOCUMENT_ID }),
  });
  expect(response.status).toBe(200);
  const labels = captured.labels as null | { effectiveFrom: string };
  return labels?.effectiveFrom ?? "";
}

describe("§NNN the legal text's PDF says the version date in words, with no weekday", () => {
  beforeEach(() => {
    captured.labels = null;
  });

  it("reads «În vigoare din 28 septembrie 2026» / «Effective from 28 September 2026»", async () => {
    expect(await effectiveFrom("ro")).toBe("În vigoare din 28 septembrie 2026");
    expect(await effectiveFrom("en")).toBe("Effective from 28 September 2026");
  });

  it("the backoffice list, the document's page and the delete confirmation use the same helper", () => {
    for (const file of [
      "src/app/[locale]/admin/legal/(list)/page.tsx",
      "src/app/[locale]/admin/legal/[id]/page.tsx",
      "src/app/[locale]/admin/legal/[id]/delete/page.tsx",
    ]) {
      const source = read(file);
      expect(source).toMatch(/formatDateInWords\((?:version|document)\.effectiveAt, \{ locale, timeZone: CLUB_TIME_ZONE \}\)/);
      expect(source).not.toMatch(/formatDay\((?:version|document)\.effectiveAt/);
    }
  });
});
