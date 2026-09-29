import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { deleteEvent } from "@/modules/content/events/service";
import { findSignedGroupRunDeclaration, listGroupRunDeclarations } from "@/modules/group-run-declarations/repository";
import { renderGroupRunDeclarationPdf } from "@/modules/group-run-declarations/pdf";
import { eraseGroupRunDeclaration, eraseGroupRunDeclarations, setGroupRunDeclarationHold, signGroupRunDeclaration } from "@/modules/group-run-declarations/service";
import { pruneExpiredRows } from "@/modules/jobs/retention";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { signedTextHash } from "@/modules/legal-documents/domain/signed-text";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import type { DeclarationPdfInput } from "@/modules/registrations/declaration-pdf";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-036-02, the group-run declaration (§556, amending §393, §503, §523) — the
 * proof of signing on a group run's self-declaration, and the hold. The row keeps the SHA-256 of the
 * exact text signed, the text its PDF prints; the PDF's proof line carries it on the signer's copy and
 * the club's archive copy alike. «Păstrează: reclamație / litigiu în curs» keeps the row through the
 * retention sweep and every erase — the signer's request, the batch, the run's last date deleted —
 * until an Administrator clears it; then the erase goes through, as the signer asked.
 */
const watched = vi.hoisted(() => ({ pdfInputs: [] as unknown[] }));
vi.mock("@/modules/registrations/declaration-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/registrations/declaration-pdf")>();
  return {
    ...actual,
    renderDeclarationPdf: async (input: Parameters<typeof actual.renderDeclarationPdf>[0]) => {
      watched.pdfInputs.push(input);
      return actual.renderDeclarationPdf(input);
    },
  };
});

const NOW = new Date("2026-10-01T08:00:00.000Z");
const MUCH_LATER = new Date("2031-10-01T08:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  watched.pdfInputs.length = 0;
});

async function approve(key: LegalDocumentKey) {
  const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES[key][locale] }));
  await insertLegalDocumentVersion(db, {
    key,
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

async function trailRun() {
  const [event] = await db
    .insert(events)
    .values({
      type: "GROUP_RUN",
      surface: "TRAIL",
      offersGroupRunDeclaration: true,
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      startsAt: new Date("2026-10-07T16:00:00.000Z"),
      registrationMode: "NONE",
      locationName: "Stația de telecabină",
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Tura pe munte", slug: `tura-${event.id.slice(0, 6)}` },
    { eventId: event.id, locale: "en", title: "The mountain loop", slug: `loop-${event.id.slice(0, 6)}` },
  ]);
  return event;
}

async function staff(role: StaffUser["role"]): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
  return row;
}

async function sign(locale: "ro" | "en" = "ro") {
  await approve("GROUP_RUN_DECLARATION_TRAIL");
  await approve("PRIVACY_NOTICE");
  const run = await trailRun();
  const document = await findCurrentApprovedDocument(db, "GROUP_RUN_DECLARATION_TRAIL", locale, NOW);
  const outcome = await signGroupRunDeclaration(
    db,
    { eventId: run.id, documentId: document!.id, contentSha256: document!.contentSha256, accepted: true, typedName: "Ana Popescu", birthDate: "1990-05-17", email: "ana@example.ro", locale },
    NOW,
  );
  if (outcome.outcome !== "signed") throw new Error("not signed");
  const [row] = await db.select().from(groupRunDeclarations).where(eq(groupRunDeclarations.id, outcome.id));
  return { run, row };
}

describe("the proof of signing on a group run's declaration (§556)", () => {
  it("keeps the SHA-256 of the exact text signed — the text its PDF prints — in both languages", async () => {
    for (const locale of ["ro", "en"] as const) {
      await resetTables(db);
      watched.pdfInputs.length = 0;
      const { row } = await sign(locale);
      expect(row.textHash, locale).toMatch(/^[0-9a-f]{64}$/);
      expect(row.textHash).not.toBe(row.contentSha256);
      const signed = await findSignedGroupRunDeclaration(db, row.id);
      await renderGroupRunDeclarationPdf(db, signed!, "participant", NOW);
      const [entry] = (watched.pdfInputs[0] as DeclarationPdfInput).entries;
      expect(signedTextHash({ title: entry.title, body: entry.body, values: entry.values ?? {} }), locale).toBe(row.textHash);
      expect(entry.textHash).toBe(row.textHash);
      expect(entry.signature?.acceptedAt.getTime()).toBe(NOW.getTime());
    }
  });

  it("prints the same proof line on the archive copy, and none of a hash for a row from before it", async () => {
    const { row } = await sign();
    const signed = await findSignedGroupRunDeclaration(db, row.id);
    await renderGroupRunDeclarationPdf(db, signed!, "club", NOW);
    const [archive] = (watched.pdfInputs[0] as DeclarationPdfInput).entries;
    expect(archive.textHash).toBe(row.textHash);
    await db.update(groupRunDeclarations).set({ textHash: null }).where(eq(groupRunDeclarations.id, row.id));
    await renderGroupRunDeclarationPdf(db, (await findSignedGroupRunDeclaration(db, row.id))!, "participant", NOW);
    const input = watched.pdfInputs[1] as DeclarationPdfInput;
    expect(input.entries[0].textHash).toBeNull();
    expect(input.labels.proofLine(1, "01.10.2026, 11:00:00", null)).toBe("Versiunea 1 · Semnat la 01.10.2026, 11:00:00 (ora României)");
  });

  it("lists the hash for the backoffice beside who and when", async () => {
    const { run, row } = await sign();
    const [listed] = await listGroupRunDeclarations(db, run.id);
    expect(listed).toMatchObject({ id: row.id, textHash: row.textHash, retentionHold: false, retentionHoldByName: null });
  });
});

describe("«Păstrează: reclamație / litigiu în curs» on a group run's declaration (§556)", () => {
  it("survives the sweep and every erase while held; once cleared, the signer's erase goes through", async () => {
    const { run, row } = await sign();
    const administrator = await staff("ADMIN");
    await setGroupRunDeclarationHold(db, administrator, { eventId: run.id, id: row.id, hold: true, reason: "Reclamație deschisă" }, NOW);
    // Read before the sweep, which takes audit rows older than its own three years.
    const [set] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "event.group_run_declaration_hold_set"), eq(auditLogs.entityId, run.id)));

    await pruneExpiredRows(db, MUCH_LATER);
    const [kept] = await db.select().from(groupRunDeclarations).where(eq(groupRunDeclarations.id, row.id));
    expect(kept).toMatchObject({ retentionHold: true, retentionHoldReason: "Reclamație deschisă", retentionHoldByStaffUserId: administrator.id });
    await expect(eraseGroupRunDeclaration(db, administrator, { id: row.id, reason: "cererea semnatarului" }, NOW)).rejects.toMatchObject({ code: "DECLARATION_HELD" });
    await expect(eraseGroupRunDeclarations(db, administrator, { eventId: run.id, ids: [row.id], reason: "cererea semnatarului" }, NOW)).rejects.toMatchObject({ code: "DECLARATION_HELD" });
    // The run's only date deleted would cascade it away: refused while held, with its own code.
    await expect(deleteEvent(db, { actor: administrator, eventId: run.id })).rejects.toMatchObject({ code: "DECLARATION_HELD" });
    expect(await db.select().from(groupRunDeclarations).where(eq(groupRunDeclarations.id, row.id))).toHaveLength(1);
    const [listed] = await listGroupRunDeclarations(db, run.id);
    expect(listed).toMatchObject({ retentionHold: true, retentionHoldReason: "Reclamație deschisă", retentionHoldByName: "ADMIN" });

    await setGroupRunDeclarationHold(db, administrator, { eventId: run.id, id: row.id, hold: false, reason: "Reclamație închisă" }, NOW);
    await eraseGroupRunDeclaration(db, administrator, { id: row.id, reason: "cererea semnatarului" }, NOW);
    expect(await db.select().from(groupRunDeclarations).where(eq(groupRunDeclarations.id, row.id))).toHaveLength(0);

    const [cleared] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "event.group_run_declaration_hold_cleared"), eq(auditLogs.entityId, run.id)));
    expect(set?.metadataJson).toEqual({ groupRunDeclarationId: row.id, reason: "Reclamație deschisă" });
    expect(cleared?.metadataJson).toEqual({ groupRunDeclarationId: row.id, reason: "Reclamație închisă" });
    for (const entry of [set, cleared]) {
      expect(entry?.actorStaffUserId).toBe(administrator.id);
      expect(JSON.stringify(entry?.metadataJson)).not.toMatch(/Ana|Popescu|ana@example/);
    }
  });

  it("is the Administrator's alone, and asks why", async () => {
    const { run, row } = await sign();
    const organizer = await staff("MODERATOR");
    await expect(setGroupRunDeclarationHold(db, organizer, { eventId: run.id, id: row.id, hold: true, reason: "x" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const administrator = await staff("ADMIN");
    await expect(setGroupRunDeclarationHold(db, administrator, { eventId: run.id, id: row.id, hold: true, reason: "" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["reason"] });
    const [unchanged] = await db.select().from(groupRunDeclarations).where(eq(groupRunDeclarations.id, row.id));
    expect(unchanged.retentionHold).toBe(false);
  });
});
