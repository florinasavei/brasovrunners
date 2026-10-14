import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { groupRunDeclarations } from "@/db/schema/group-run-declarations";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { renderGroupRunDeclarationPdf } from "@/modules/group-run-declarations/pdf";
import { findSignedGroupRunDeclaration } from "@/modules/group-run-declarations/repository";
import { eraseGroupRunDeclaration, type GroupRunSigningInput, signGroupRunDeclaration } from "@/modules/group-run-declarations/service";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { exportPersonData, viewPersonData } from "@/modules/registrations/person-data";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * BR-REQ-033-02 (§NNN, amending §393 and §769; the owner, 2026-10-14) — the trace of the electronic signature on a
 * group run's declaration: the caller's IP address and browser, written on the row of the signing (always
 * electronic: the run's page), printed small under the signature of the PDF — also a minor's, beside a parent's —
 * read back in «Toate datele unei persoane», and deleted with the row when an Administrator erases it.
 */
const NOW = new Date("2026-10-01T08:00:00.000Z");
const KEY: LegalDocumentKey = "GROUP_RUN_DECLARATION_TRAIL";
const TRACE = { ip: "198.51.100.23", userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0" };

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

async function approve(key: LegalDocumentKey) {
  const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES[key][locale] }));
  await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
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
      minAge: 14,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Tura pe munte", slug: `tura-${event.id.slice(0, 6)}` },
    { eventId: event.id, locale: "en", title: "The mountain loop", slug: `loop-${event.id.slice(0, 6)}` },
  ]);
  return event;
}

async function press(eventId: string, overrides: Partial<GroupRunSigningInput> = {}): Promise<GroupRunSigningInput> {
  const document = await findCurrentApprovedDocument(db, KEY, overrides.locale ?? "ro", NOW);
  if (!document) throw new Error("no approved trail declaration");
  return { eventId, documentId: document.id, contentSha256: document.contentSha256, accepted: true, typedName: "Ana Popescu", birthDate: "1990-05-17", email: "ana@example.ro", locale: "ro", ...overrides };
}

async function admin(): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "ADMIN", role: "ADMIN" }).returning();
  return row;
}

async function signed(overrides: Partial<GroupRunSigningInput> = {}) {
  await approve(KEY);
  await approve("PRIVACY_NOTICE");
  const event = await trailRun();
  await signGroupRunDeclaration(db, await press(event.id, overrides), NOW);
  const [row] = await db.select().from(groupRunDeclarations);
  return { event, row };
}

describe("§NNN the trace of the electronic signature on a group run's declaration", () => {
  it("writes the address and the browser of the press on the row", async () => {
    const { row } = await signed({ trace: TRACE });
    expect(row.ip).toBe(TRACE.ip);
    expect(row.userAgent).toBe(TRACE.userAgent);
  });

  it("leaves both null when the request carried neither header, or none was passed", async () => {
    const { row } = await signed({ trace: { ip: null, userAgent: null } });
    expect(row.ip).toBeNull();
    expect(row.userAgent).toBeNull();
    await db.delete(groupRunDeclarations);
    const { row: second } = await (async () => {
      const [event] = await db.select().from(events);
      await signGroupRunDeclaration(db, await press(event.id), NOW);
      const [r] = await db.select().from(groupRunDeclarations);
      return { row: r };
    })();
    expect(second.ip).toBeNull();
    expect(second.userAgent).toBeNull();
  });

  it("prints «Semnat electronic la … · IP … · …» under the signature of the PDF, small, and the version and the fingerprint after it", async () => {
    const { row } = await signed({ trace: TRACE });
    const found = await findSignedGroupRunDeclaration(db, row.id);
    const runs = await drawnRuns(() => renderGroupRunDeclarationPdf(db, found!, "participant", NOW));
    const line = runs.find((run) => run.text.startsWith("Semnat electronic la "));
    expect(line?.text).toBe(`Semnat electronic la 01.10.2026, 11:00:00 (ora României) · IP ${TRACE.ip} · ${TRACE.userAgent}`);
    expect(line?.size).toBe(8);
    expect(runs.some((run) => run.text.includes("sha256 "))).toBe(true);
  });

  it("prints the same block for a minor's declaration beside a parent's, once, with both typed names above it", async () => {
    const { row } = await signed({ trace: TRACE, minor: true, minorTypedName: "Ion Popescu", guardianAgrees: true, birthDate: "2012-03-01" });
    expect(row.minorTypedName).toBe("Ion Popescu");
    expect(row).toMatchObject({ ip: TRACE.ip, userAgent: TRACE.userAgent });
    const found = await findSignedGroupRunDeclaration(db, row.id);
    const runs = await drawnRuns(() => renderGroupRunDeclarationPdf(db, found!, "participant", NOW));
    const texts = runs.map((run) => run.text);
    expect(texts).toContain("Ion Popescu");
    expect(texts).toContain("Ana Popescu");
    expect(texts.filter((text) => text.startsWith("Semnat electronic la "))).toEqual([`Semnat electronic la 01.10.2026, 11:00:00 (ora României) · IP ${TRACE.ip} · ${TRACE.userAgent}`]);
  });

  it("draws today's block for a row from before the trace", async () => {
    const { row } = await signed();
    const found = await findSignedGroupRunDeclaration(db, row.id);
    const runs = await drawnRuns(() => renderGroupRunDeclarationPdf(db, found!, "participant", NOW));
    expect(runs.some((run) => run.text.startsWith("Semnat electronic la "))).toBe(false);
    expect(runs.some((run) => run.text.startsWith("Semnat electronic 01 oct") || run.text.startsWith("Semnat electronic "))).toBe(true);
  });

  it("lists the signing — and its trace — in «Toate datele unei persoane», found by the canonical address", async () => {
    // Typed in capitals, as people do: the row keeps it as typed and the lookup compares the canonical forms.
    const { event } = await signed({ trace: TRACE, email: "Ana@Example.RO" });
    const actor = await admin();
    for (const read of [viewPersonData, exportPersonData]) {
      const data = await read(db, actor, "ana@example.ro", NOW);
      expect(data.groupRunDeclarations).toHaveLength(1);
      expect(data.groupRunDeclarations[0]).toMatchObject({
        eventId: event.id,
        eventTitle: "Tura pe munte",
        typedName: "Ana Popescu",
        minorTypedName: null,
        ip: TRACE.ip,
        userAgent: TRACE.userAgent,
      });
      // Another person's address finds none.
      expect((await read(db, actor, "altcineva@example.ro", NOW)).groupRunDeclarations).toEqual([]);
    }
  });

  it("deletes the trace with the row when an Administrator erases the declaration", async () => {
    const { row } = await signed({ trace: TRACE });
    await eraseGroupRunDeclaration(db, await admin(), { id: row.id, reason: "asked to be erased" }, NOW);
    expect(await db.select().from(groupRunDeclarations).where(eq(groupRunDeclarations.id, row.id))).toHaveLength(0);
  });
});
