import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ro from "../../../messages/ro.json";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { findRegistrationDetailForAdmin, listWorkbookDetails } from "@/modules/registrations/admin-repository";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { workbookExtras } from "@/modules/registrations/workbook";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: ro, namespace: namespace as "Admin" }),
}));

const { default: SexAndShirtLine } = await import("@/modules/registrations/ui/SexAndShirtLine");

/**
 * §NNN (amending §510 and §59) — «Sex» is «Masculin» or «Feminin», refused at every door otherwise,
 * and the T-shirt size is kept only for an event whose «Kit de participare» gives one. Real
 * PostgreSQL in process (PGlite): the rows are the ones the form, a staff entry and the desk write.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

async function approveLegalDocuments(db: TestDatabase) {
  const text: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS"] as const) {
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(text),
      translations: text,
      now: NOW,
    });
  }
}

async function createInternalEvent(db: TestDatabase, kitShirt: boolean): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: null, kitShirt })
    .returning();
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    capacity: null,
    raceId: null,
    publishedAt: NOW,
  };
}

function submissionInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    firstName: "Ana",
    lastName: "Pop",
    birthDate: "1990-05-17",
    sex: "FEMALE",
    nationality: "RO",
    country: "RO",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Contact Urgență",
    emergencyContactPhone: "+40722222222",
    email: "ana@example.org",
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    termsAccepted: true,
    rulesAcknowledged: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    ...overrides,
  };
}

/** The field names a refusal carries — what the §47 summary links to. */
async function refusedFields(promise: Promise<unknown>): Promise<string[]> {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return [...error.fields];
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("§NNN «Sex» at every door, and the T-shirt only when the event gives one", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approveLegalDocuments(db);
  });

  const rowsOf = (eventId: string) => db.select().from(registrations).where(eq(registrations.eventId, eventId));

  it("refuses a public form posting the retired «Prefer să nu spun», naming the box", async () => {
    const event = await createInternalEvent(db, false);
    expect(await refusedFields(submitRegistration(db, event, submissionInput({ sex: "UNSPECIFIED" }), NOW))).toEqual(["sex"]);
    expect(await rowsOf(event.id)).toHaveLength(0);
  });

  it("refuses a public form with no sex at all, naming the box", async () => {
    const event = await createInternalEvent(db, false);
    expect(await refusedFields(submitRegistration(db, event, submissionInput({ sex: undefined }), NOW))).toEqual(["sex"]);
    expect(await refusedFields(submitRegistration(db, event, submissionInput({ sex: "" }), NOW))).toEqual(["sex"]);
    expect(await rowsOf(event.id)).toHaveLength(0);
  });

  it("refuses the retired answer on a staff entry and the desk's walk-in too, which may leave the sex out", async () => {
    const event = await createInternalEvent(db, false);
    const staff = { source: "STAFF" as const, createdByStaffUserId: null };
    expect(await refusedFields(submitRegistration(db, event, submissionInput({ sex: "UNSPECIFIED" }), NOW, "REAL", staff))).toContain("sex");
    expect(
      await refusedFields(submitRegistration(db, event, submissionInput({ email: "desk@example.org", sex: "UNSPECIFIED" }), NOW, "REAL", { ...staff, atTheDesk: true })),
    ).toContain("sex");
    expect(await rowsOf(event.id)).toHaveLength(0);

    // A paper entry without an answer is kept (§510), with no sex.
    await submitRegistration(db, event, submissionInput({ sex: undefined }), NOW, "REAL", staff);
    const [row] = await rowsOf(event.id);
    expect(row.sex).toBeNull();
  });

  it("stores the two answers as given", async () => {
    const event = await createInternalEvent(db, false);
    await submitRegistration(db, event, submissionInput({ sex: "MALE" }), NOW);
    const [row] = await rowsOf(event.id);
    expect(row.sex).toBe("MALE");
  });

  it("shows a row stored with «Prefer să nu spun» as no answer: «—» on the backoffice page, an empty cell in the export", async () => {
    const event = await createInternalEvent(db, false);
    await submitRegistration(db, event, submissionInput(), NOW);
    const [stored] = await rowsOf(event.id);
    // A row from before the answer went: the enum keeps the value, nothing rewrote it.
    await db.update(registrations).set({ sex: "UNSPECIFIED" }).where(eq(registrations.id, stored.id));

    const detail = await findRegistrationDetailForAdmin(db, stored.id);
    expect(detail?.sex).toBe("UNSPECIFIED");
    const line = renderToStaticMarkup(await SexAndShirtLine({ sex: detail!.sex, tshirtSize: detail!.tshirtSize, kitShirt: detail!.eventKitShirt }));
    expect(line).toContain("Sex: —");
    expect(line).not.toContain("Prefer");

    const sheet = workbookExtras((await listWorkbookDetails(db, [stored.id])).get(stored.id));
    expect(sheet.sex).toBe("");

    await db.update(registrations).set({ sex: "FEMALE" }).where(eq(registrations.id, stored.id));
    expect(workbookExtras((await listWorkbookDetails(db, [stored.id])).get(stored.id)).sex).toBe("Female");
    const after = await findRegistrationDetailForAdmin(db, stored.id);
    expect(renderToStaticMarkup(await SexAndShirtLine({ sex: after!.sex, tshirtSize: after!.tshirtSize, kitShirt: after!.eventKitShirt }))).toContain("Sex: Feminin");
  });

  it("ignores a size posted for an event without a T-shirt: the row says NONE, the page and the export say nothing", async () => {
    const event = await createInternalEvent(db, false);
    await submitRegistration(db, event, submissionInput({ tshirtSize: "M" }), NOW);
    const [row] = await rowsOf(event.id);
    expect(row.tshirtSize).toBe("NONE");

    // Even a size left on a row from before the tick came off says nothing.
    await db.update(registrations).set({ tshirtSize: "L" }).where(eq(registrations.id, row.id));
    const details = (await listWorkbookDetails(db, [row.id])).get(row.id);
    expect(details?.eventKitShirt).toBe(false);
    expect(workbookExtras(details).tshirtSize).toBeNull();
    const detail = await findRegistrationDetailForAdmin(db, row.id);
    expect(renderToStaticMarkup(await SexAndShirtLine({ sex: detail!.sex, tshirtSize: detail!.tshirtSize, kitShirt: detail!.eventKitShirt }))).not.toContain("Tricou");
  });

  it("keeps the size for an event that gives a T-shirt, and the page and the export show it", async () => {
    const event = await createInternalEvent(db, true);
    await submitRegistration(db, event, submissionInput({ tshirtSize: "M" }), NOW);
    const [row] = await rowsOf(event.id);
    expect(row.tshirtSize).toBe("M");

    const details = (await listWorkbookDetails(db, [row.id])).get(row.id);
    expect(workbookExtras(details).tshirtSize).toBe("M");
    const detail = await findRegistrationDetailForAdmin(db, row.id);
    expect(renderToStaticMarkup(await SexAndShirtLine({ sex: detail!.sex, tshirtSize: detail!.tshirtSize, kitShirt: detail!.eventKitShirt }))).toContain("Sex: Feminin · Tricou: M");
  });

  it("follows the same switch on a staff entry: a size kept only for an event with a T-shirt", async () => {
    const staff = { source: "STAFF" as const, createdByStaffUserId: null };
    const without = await createInternalEvent(db, false);
    await submitRegistration(db, without, submissionInput({ tshirtSize: "S" }), NOW, "REAL", staff);
    expect((await rowsOf(without.id))[0].tshirtSize).toBe("NONE");

    const withShirt = await createInternalEvent(db, true);
    await submitRegistration(db, withShirt, submissionInput({ email: "b@example.org", tshirtSize: "S" }), NOW, "REAL", staff);
    expect((await rowsOf(withShirt.id))[0].tshirtSize).toBe("S");
  });

  it("decides from the locked row, never the caller's: the tick taken off after the page was read is honoured", async () => {
    const event = await createInternalEvent(db, true);
    await db.update(events).set({ kitShirt: false }).where(eq(events.id, event.id));
    await submitRegistration(db, event, submissionInput({ tshirtSize: "XL" }), NOW);
    expect((await rowsOf(event.id))[0].tshirtSize).toBe("NONE");
  });
});
