import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import {
  countRegistrationsForAdmin,
  findRegistrationDetailForAdmin,
  listRegistrationsForAdmin,
} from "@/modules/registrations/admin-repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { journeyOf } from "@/modules/registrations/domain/journey";
import {
  confirmEmail,
  type EventForRegistration,
  signDeclaration,
  submitRegistration,
  unregister,
} from "@/modules/registrations/service";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The backoffice list's own query: search by name, sort, and server-side pagination
 * (BR-REQ-041-01 criterion 7, BR-REQ-070-02).
 *
 * Rows are inserted directly rather than through `submitRegistration`, on purpose. What is
 * under test is the reading query — which rows come back, in what order, and how many — and
 * driving thirty of them through the allocator would be a slower test of the allocator instead.
 * Nothing here touches capacity, and nothing here may: §12.6.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;

/** Each participant needs a distinct canonical address; the name is not one, and may repeat. */
let participantCounter = 0;

async function addRegistration(
  name: string,
  overrides: { status?: RegistrationStatus; submittedAt?: Date } = {},
): Promise<void> {
  participantCounter += 1;
  const email = `participant-${participantCounter}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: email,
      normalizedEmail: email,
      canonicalEmail: email,
      canonicalizationVersion: 1,
      defaultName: name,
    })
    .returning();

  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    status: overrides.status ?? "CONFIRMED",
    locale: "ro",
    registeredName: name,
    displayName: name,
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    submittedAt: overrides.submittedAt ?? NOW,
  });
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTables(db);
  const [event] = await db
    .insert(events)
    .values({
      type: "GROUP_RUN",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
    })
    .returning();
  eventId = event.id;
});

describe("search by name (BR-REQ-041-01 criterion 7)", () => {
  it("finds a participant by part of their name", async () => {
    await addRegistration("Ana Popescu");
    await addRegistration("Mihai Ionescu");

    const found = await listRegistrationsForAdmin(db, { search: "popescu" });

    expect(found.map((row) => row.registeredName)).toEqual(["Ana Popescu"]);
  });

  it("ignores case", async () => {
    await addRegistration("Ana Popescu");

    expect(await listRegistrationsForAdmin(db, { search: "ANA" })).toHaveLength(1);
  });

  it("finds a name written with diacritics when the organizer types it without", async () => {
    // Race morning: somebody says "Ștefan" out loud and an organizer types "stefan". Answering
    // "no results" there reads as "this person never registered", which is the worst possible
    // wrong answer at a start line.
    await addRegistration("Ștefan Țîrlea");

    expect(await listRegistrationsForAdmin(db, { search: "stefan" })).toHaveLength(1);
    expect(await listRegistrationsForAdmin(db, { search: "tirlea" })).toHaveLength(1);
  });

  it("finds a name written without diacritics when the organizer types them", async () => {
    await addRegistration("Stefan Tirlea");

    expect(await listRegistrationsForAdmin(db, { search: "ștefan" })).toHaveLength(1);
  });

  it("matches the cedilla spelling against the comma-below one", async () => {
    // `ş` and `ţ` are what older Romanian keyboard layouts still produce. A person who typed
    // one must be found by somebody typing the other.
    await addRegistration("Ştefan");

    expect(await listRegistrationsForAdmin(db, { search: "ștefan" })).toHaveLength(1);
  });

  it("treats a typed percent sign as a character, not as a wildcard", async () => {
    await addRegistration("Ana Popescu");

    expect(await listRegistrationsForAdmin(db, { search: "%" })).toHaveLength(0);
  });

  it("never searches the email address", async () => {
    // The address is the participant's identity, and a box anybody can type an address into is
    // a membership oracle. The name finds the row; the address is only shown once it has.
    await addRegistration("Ana Popescu");
    const [row] = await listRegistrationsForAdmin(db, {});

    expect(await listRegistrationsForAdmin(db, { search: row.participantEmail })).toHaveLength(0);
    expect(await listRegistrationsForAdmin(db, { search: "example.test" })).toHaveLength(0);
  });

  it("counts the same rows the list returns", async () => {
    await addRegistration("Ana Popescu");
    await addRegistration("Ana Marin");
    await addRegistration("Mihai Ionescu");

    expect(await countRegistrationsForAdmin(db, { search: "ana" })).toBe(2);
  });
});

describe("pagination (BR-REQ-070-02)", () => {
  beforeEach(async () => {
    for (let index = 0; index < 30; index += 1) {
      await addRegistration(`Runner ${String(index).padStart(2, "0")}`, {
        submittedAt: new Date(NOW.getTime() + index * 1000),
      });
    }
  });

  it("returns only the page asked for", async () => {
    const page = await listRegistrationsForAdmin(db, {}, { limit: 10, offset: 0, sort: "name", dir: "asc" });

    expect(page).toHaveLength(10);
    expect(page[0].registeredName).toBe("Runner 00");
  });

  it("counts every matching row, not the page", async () => {
    expect(await countRegistrationsForAdmin(db, {})).toBe(30);
  });

  it("walks the pages without repeating or losing a row", async () => {
    const seen: string[] = [];
    for (let page = 0; page < 3; page += 1) {
      const rows = await listRegistrationsForAdmin(
        db,
        {},
        { limit: 10, offset: page * 10, sort: "status", dir: "asc" },
      );
      seen.push(...rows.map((row) => row.registeredName));
    }

    // Every row exactly once. Sorting by a column where all thirty rows tie is the case that
    // catches a missing tie-break: without a total order PostgreSQL may return a row on two
    // pages and another on none, purely from paging.
    expect(new Set(seen).size).toBe(30);
    expect(seen).toHaveLength(30);
  });

  it("gives the whole filtered set when no page is asked for, which is what the export needs", async () => {
    expect(await listRegistrationsForAdmin(db, {})).toHaveLength(30);
  });
});

describe("sorting", () => {
  beforeEach(async () => {
    await addRegistration("Zamfir", { submittedAt: new Date(NOW.getTime() + 1000) });
    await addRegistration("Andrei", { submittedAt: new Date(NOW.getTime() + 3000) });
    await addRegistration("Mircea", { submittedAt: new Date(NOW.getTime() + 2000) });
  });

  it("orders by name in both directions", async () => {
    const ascending = await listRegistrationsForAdmin(db, {}, { limit: 10, offset: 0, sort: "name", dir: "asc" });
    const descending = await listRegistrationsForAdmin(db, {}, { limit: 10, offset: 0, sort: "name", dir: "desc" });

    expect(ascending.map((row) => row.registeredName)).toEqual(["Andrei", "Mircea", "Zamfir"]);
    expect(descending.map((row) => row.registeredName)).toEqual(["Zamfir", "Mircea", "Andrei"]);
  });

  it("orders by when it was submitted", async () => {
    const rows = await listRegistrationsForAdmin(db, {}, { limit: 10, offset: 0, sort: "submitted", dir: "desc" });

    expect(rows.map((row) => row.registeredName)).toEqual(["Andrei", "Mircea", "Zamfir"]);
  });

  it("still defaults to newest first when no page is asked for", async () => {
    const rows = await listRegistrationsForAdmin(db, {});

    expect(rows.map((row) => row.registeredName)).toEqual(["Andrei", "Mircea", "Zamfir"]);
  });
});

describe("filters and search compose", () => {
  it("narrows by status and name together", async () => {
    await addRegistration("Ana Popescu", { status: "CONFIRMED" });
    await addRegistration("Ana Marin", { status: "CANCELLED" });

    const rows = await listRegistrationsForAdmin(db, { search: "ana", status: "CONFIRMED" });

    expect(rows.map((row) => row.registeredName)).toEqual(["Ana Popescu"]);
    expect(await countRegistrationsForAdmin(db, { search: "ana", status: "CONFIRMED" })).toBe(1);
  });
});

/**
 * The journey column (`DECISIONS.md` §145, BR-REQ-037-03 criterion 5) reads the declaration
 * acceptance off the list row — one correlated probe on the acceptance index, never a query
 * per row — and the row is enough for `journeyOf` as it stands.
 */
describe("the list row carries the journey's columns", () => {
  it("names the latest declaration acceptance as a date, and null where there is none", async () => {
    await addRegistration("Ana Popescu", { status: "CONFIRMED" });
    await addRegistration("Mihai Ionescu", { status: "PENDING_DECLARATION" });
    const [ana] = await db.select({ id: registrations.id }).from(registrations).where(eq(registrations.registeredName, "Ana Popescu"));

    const declaration: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Particip pe proprie răspundere."] }] } },
      { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I take part at my own risk."] }] } },
    ];
    const legalDocumentId = await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00Z"),
      isApproved: true,
      contentSha256: computeContentHash(declaration),
      translations: declaration,
      now: NOW,
    });
    const signedAt = new Date("2026-09-04T11:00:00.000Z");
    await db.insert(declarationAcceptances).values([
      { registrationId: ana.id, legalDocumentId, declarationVersion: 1, contentSha256: computeContentHash(declaration), locale: "ro", typedName: "Ana Popescu", acceptedAt: new Date("2026-09-04T10:30:00.000Z") },
      { registrationId: ana.id, legalDocumentId, declarationVersion: 1, contentSha256: computeContentHash(declaration), locale: "ro", typedName: "Ana Popescu", acceptedAt: signedAt },
    ]);

    const rows = await listRegistrationsForAdmin(db, {}, { limit: 10, offset: 0, sort: "name", dir: "asc" });
    const [anaRow, mihaiRow] = rows;

    expect(anaRow.registeredName).toBe("Ana Popescu");
    expect(anaRow.declarationAcceptedAt).toBeInstanceOf(Date);
    expect(anaRow.declarationAcceptedAt).toEqual(signedAt);
    expect(mihaiRow.declarationAcceptedAt).toBeNull();
    expect(anaRow.emailVerifiedAt).toBeNull();

    // And the row feeds the derivation as it is: the same steps the page shows.
    expect(journeyOf(anaRow).steps.map((step) => step.state)).toEqual(["done", "done", "done", "done", "done", "current"]);
    expect(journeyOf(anaRow).steps[3].at).toEqual(signedAt);
    expect(journeyOf(mihaiRow).current).toBe("declarationSigned");
  });
});

/**
 * A restart reuses the row and clears nothing (`db/schema/registrations.ts`), so the journey
 * reads only what happened since `privacy_acknowledged_at`, the column every restart rewrites.
 * Driven through the service — register, confirm, sign, cancel, register again, cancel again —
 * so the row is what production would leave, not a hand-written one.
 */
describe("the journey of a restarted row is this cycle's, not the first one's", () => {
  const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

  async function approveLegalDocuments() {
    const privacy: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    const declaration: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["d"] }] } },
      { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["d"] }] } },
    ];
    for (const [key, translations] of [["PRIVACY_NOTICE", privacy], ["EVENT_DECLARATION", declaration]] as const) {
      await insertLegalDocumentVersion(db, {
        key,
        version: 1,
        effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
        isApproved: true,
        contentSha256: computeContentHash(translations),
        translations,
        now: NOW,
      });
    }
  }

  async function oneSeatEvent(): Promise<EventForRegistration> {
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: 1 })
      .returning();
    return {
      id: event.id,
      eventStatus: event.eventStatus,
      registrationMode: "INTERNAL",
      startsAt: event.startsAt,
      registrationOpensAt: event.registrationOpensAt,
      registrationClosesAt: event.registrationClosesAt,
      capacity: 1,
      raceId: null,
      publishedAt: NOW,
    };
  }

  function submission(email: string, firstName: string) {
    return {
      firstName,
      lastName: "Pop",
      birthDate: "1990-05-17",
      sex: "UNSPECIFIED",
      nationality: "RO",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Contact Urgență",
      emergencyContactPhone: "+40722222222",
      email,
      locale: "ro",
      privacyAcknowledged: true,
      fitnessDeclared: true,
      rulesAcknowledged: true,
      resultsNameConsent: true,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    };
  }

  it("confirmed once, cancelled, back on the waiting list, cancelled again: two done and no bib", async () => {
    await approveLegalDocuments();
    const event = await oneSeatEvent();

    // Cycle 1: Ana takes the one place, signs, and gives it back.
    await submitRegistration(db, event, submission("ana@example.ro", "Ana"), minutes(0));
    const [ana] = await db.select({ id: registrations.id }).from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, ana.id, minutes(1));
    const confirmed = await signDeclaration(db, event, ana.id, await signingInput(db, minutes(2), "Ana Pop"), minutes(2));
    expect(confirmed.status).toBe("CONFIRMED");
    await unregister(db, event, ana.id, "PARTICIPANT", minutes(3));

    // Somebody else takes it.
    await submitRegistration(db, event, submission("bogdan@example.ro", "Bogdan"), minutes(4));
    const rows = await db.select({ id: registrations.id }).from(registrations).where(eq(registrations.eventId, event.id));
    const bogdan = rows.find((row) => row.id !== ana.id)!;
    await confirmEmail(db, event, bogdan.id, minutes(5));
    await signDeclaration(db, event, bogdan.id, await signingInput(db, minutes(6), "Bogdan Pop"), minutes(6));

    // Cycle 2: Ana registers again, lands on the waiting list, and leaves it.
    await submitRegistration(db, event, submission("ana@example.ro", "Ana"), minutes(7));
    const [waitlisted] = await db.select({ status: registrations.status }).from(registrations).where(eq(registrations.id, ana.id));
    expect(waitlisted.status).toBe("WAITLISTED");
    await unregister(db, event, ana.id, "PARTICIPANT", minutes(8));

    const listed = (await listRegistrationsForAdmin(db, { eventId: event.id })).find((row) => row.id === ana.id)!;
    const detail = (await findRegistrationDetailForAdmin(db, ana.id))!;
    for (const journey of [journeyOf(listed), journeyOf(detail)]) {
      expect(journey.steps.map((step) => step.state)).toEqual(["done", "done", "skipped", "skipped", "skipped", "skipped"]);
      expect(journey.done).toBe(2);
      expect(journey.steps[0].at).toEqual(minutes(7));
      expect(journey.steps[1].at).toEqual(minutes(7));
      expect(journey.steps[4].detail).toBeUndefined();
      expect(journey.outcome).toBe("cancelled");
      expect(journey.outcomeAt).toEqual(minutes(8));
    }
  });
});
