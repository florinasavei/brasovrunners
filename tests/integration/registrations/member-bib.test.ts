import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationKind, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import {
  countRegistrationsForAdmin,
  findRegistrationDetailForAdmin,
  listEventsAcceptingRegistrations,
  listRegistrationsForAdmin,
  summariseRegistrationsForAdmin,
} from "@/modules/registrations/admin-repository";
import { createRegistrationByStaff, editRegistrationAnswers } from "@/modules/registrations/admin-service";
import { countUnverifiedMemberBibs, listBibs } from "@/modules/registrations/bibs";
import { buildRegistrationsCsv } from "@/modules/registrations/csv";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { readSheet } from "../../helpers/xlsx";

/**
 * §664, BR-REQ-038-01, BR-REQ-037-03 — the members' race number from a real database:
 *
 * - «Vreau numărul de membru» is stored only while the event's bib design offers it and under the
 *   member tick, whatever the form posts — on the public form and on a staff entry alike;
 * - the sheet prints the members' bib only for a row that asked AND whose canonical address is a
 *   member account's (§662): never the tick alone; a test row stays off the sheet as before;
 * - «Modifică datele» changes the wish, audited; clearing the member tick clears it;
 * - the export's «Member bib» reads yes / asked / empty, and the list's filter keeps the asked.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

// The export route reads the database and the signed-in staff member through these two (§664).
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function approveLegalDocuments() {
  const text: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
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

beforeEach(async () => {
  await resetTables(db);
  await approveLegalDocuments();
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  state.actor = admin;
});

async function createEvent(memberBib: boolean): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      locationName: "Start",
      bibDesign: memberBib ? { member: { enabled: true, bandColour: "#6a1b9a", label: "Membru BVR" } } : null,
    })
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

function submission(overrides: Record<string, unknown> = {}) {
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
    email: "ana@example.ro",
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    termsAccepted: true,
    rulesAcknowledged: true,
    resultsNameConsent: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    ...overrides,
  };
}

const rowOf = async (eventId: string) => (await db.select().from(registrations).where(eq(registrations.eventId, eventId)))[0];

describe("§664 «Vreau numărul de membru» is kept only where it means something", () => {
  it("stores the wish under the member tick while the event offers the members' bib", async () => {
    const event = await createEvent(true);
    await submitRegistration(db, event, submission({ clubMemberDeclared: true, memberBibWanted: true }), NOW);
    expect((await rowOf(event.id)).memberBibWanted).toBe(true);
  });

  it("stores false whatever a stale form posts: the design off, or the member tick off", async () => {
    const off = await createEvent(false);
    await submitRegistration(db, off, submission({ clubMemberDeclared: true, memberBibWanted: true }), NOW);
    expect((await rowOf(off.id)).memberBibWanted).toBe(false);

    const on = await createEvent(true);
    await submitRegistration(db, on, submission({ email: "b@example.ro", clubMemberDeclared: false, memberBibWanted: true }), NOW);
    expect((await rowOf(on.id)).memberBibWanted).toBe(false);
  });

  it("asks it of the staff entry too, by the same rule", async () => {
    const event = await createEvent(true);
    await createRegistrationByStaff(
      db,
      admin,
      {
        eventId: event.id,
        firstName: "Desk",
        lastName: "Membru",
        email: "desk@example.ro",
        locale: "ro",
        listOptOut: false,
        relayedByParticipantRequest: true,
        details: { clubMemberDeclared: true, memberBibWanted: true },
      },
      NOW,
    );
    expect((await rowOf(event.id)).memberBibWanted).toBe(true);

    const other = await createEvent(false);
    await createRegistrationByStaff(
      db,
      admin,
      { eventId: other.id, firstName: "Desk", lastName: "Altul", email: "desk2@example.ro", locale: "ro", listOptOut: false, relayedByParticipantRequest: true, details: { clubMemberDeclared: true, memberBibWanted: true } },
      NOW,
    );
    expect((await rowOf(other.id)).memberBibWanted).toBe(false);
  });

  it("tells the staff form which events offer it", async () => {
    const on = await createEvent(true);
    const off = await createEvent(false);
    const listed = await listEventsAcceptingRegistrations(db, "ro");
    expect(listed.find((event) => event.id === on.id)?.offersMemberBib).toBe(true);
    expect(listed.find((event) => event.id === off.id)?.offersMemberBib).toBe(false);
  });
});

describe("§664 «Modifică datele» corrects the wish, audited", () => {
  it("changes it under the member tick, and clearing the tick clears it with its own row", async () => {
    const event = await createEvent(true);
    await submitRegistration(db, event, submission({ clubMemberDeclared: true, memberBibWanted: false }), NOW);
    const row = await rowOf(event.id);

    await editRegistrationAnswers(db, admin, row.id, { memberBibWanted: true }, NOW);
    expect((await rowOf(event.id)).memberBibWanted).toBe(true);

    await editRegistrationAnswers(db, admin, row.id, { clubMemberDeclared: false }, NOW);
    const after = await rowOf(event.id);
    expect(after.clubMemberDeclared).toBe(false);
    expect(after.memberBibWanted).toBe(false);

    const trail = await db
      .select({ metadata: auditLogs.metadataJson })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "registration.answer_corrected"), eq(auditLogs.entityId, row.id)));
    const fields = trail.map((entry) => entry.metadata as { field: string; from: unknown; to: unknown });
    expect(fields).toContainEqual({ field: "memberBibWanted", from: false, to: true });
    expect(fields).toContainEqual({ field: "memberBibWanted", from: true, to: false });
  });

  it("keeps it false on an event that does not offer the members' bib: nothing changes, and says so", async () => {
    const event = await createEvent(false);
    await submitRegistration(db, event, submission({ clubMemberDeclared: true }), NOW);
    const row = await rowOf(event.id);
    await expect(editRegistrationAnswers(db, admin, row.id, { memberBibWanted: true }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await rowOf(event.id)).memberBibWanted).toBe(false);
  });
});

describe("§664 the sheet prints the members' bib for wanted AND verified only", () => {
  let counter = 0;
  async function confirmed(eventId: string, email: string, options: { wanted: boolean; declared?: boolean; kind?: RegistrationKind }) {
    counter += 1;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: email })
      .returning();
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        status: "CONFIRMED",
        kind: options.kind ?? "REAL",
        locale: "ro",
        registeredName: email,
        displayName: email,
        clubMemberDeclared: options.declared ?? true,
        memberBibWanted: options.wanted,
        // A number on every row, the TEST one too: the sheet and the filter keep it out by its kind, not by a missing number.
        bibNumber: counter,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        submittedAt: NOW,
        confirmedAt: NOW,
      })
      .returning();
    return row;
  }

  it("flags the verified member who asked; the declared-only and the unasked print the ordinary bib", async () => {
    const event = await createEvent(true);
    // A member account on «Echipa»: the address verifies (§662).
    await db.insert(staffUsers).values({ email: "membru@example.ro", displayName: "Membru", role: "MEMBER" });
    const verified = await confirmed(event.id, "membru@example.ro", { wanted: true });
    const declaredOnly = await confirmed(event.id, "declarat@example.ro", { wanted: true });
    const unasked = await confirmed(event.id, "admin@dev.test", { wanted: false });
    await confirmed(event.id, "test@example.ro", { wanted: true, kind: "TEST" });

    const sheet = await listBibs(db, event.id);
    expect(sheet.map((bib) => [bib.id, bib.member])).toEqual([
      [verified.id, true],
      [declaredOnly.id, false],
      [unasked.id, false],
    ]);
    // The test row stays off the sheet, as every count the club is given (§30).
    expect(sheet).toHaveLength(3);
    // The bibs page's line: one asked and is no member account's.
    expect(await countUnverifiedMemberBibs(db, event.id)).toBe(1);
  });

  it("prints nobody a member's bib while the event's switch is off, and counts nobody unverified", async () => {
    const event = await createEvent(false);
    await db.insert(staffUsers).values({ email: "membru@example.ro", displayName: "Membru", role: "MEMBER" });
    await confirmed(event.id, "membru@example.ro", { wanted: true });
    expect((await listBibs(db, event.id)).every((bib) => !bib.member)).toBe(true);
    expect(await countUnverifiedMemberBibs(db, event.id)).toBe(0);
  });

  it("with no member account at all, asks no `IN ()` and flags nobody", async () => {
    await db.delete(staffUsers);
    const event = await createEvent(true);
    await confirmed(event.id, "a@example.ro", { wanted: true });
    expect((await listBibs(db, event.id)).map((bib) => bib.member)).toEqual([false]);
    expect(await countUnverifiedMemberBibs(db, event.id)).toBe(1);
  });

  it("reads «Member bib» in the export, keeps the asked in the list's filter, and tells the registration's page", async () => {
    const event = await createEvent(true);
    await db.insert(staffUsers).values({ email: "membru@example.ro", displayName: "Membru", role: "MEMBER" });
    const verified = await confirmed(event.id, "membru@example.ro", { wanted: true });
    const asked = await confirmed(event.id, "declarat@example.ro", { wanted: true });
    await confirmed(event.id, "nimic@example.ro", { wanted: false, declared: false });
    // A test row that asked: off the sheet, so off the line and off the list it links to.
    await confirmed(event.id, "proba@example.ro", { wanted: true, kind: "TEST" });

    const rows = await listRegistrationsForAdmin(db, { eventId: event.id });
    const csv = buildRegistrationsCsv(
      rows.map((row) => ({
        eventTitle: "x",
        registeredName: row.registeredName,
        firstName: "",
        lastName: "",
        idDocument: "",
        email: row.participantEmail,
        status: row.status,
        clubMemberDeclared: row.clubMemberDeclared,
        memberVerified: row.memberVerified,
        memberBibOffered: row.memberBibOffered,
        memberBibWanted: row.memberBibWanted,
        fitnessDeclaredAt: null,
        stravaUrl: "",
        guardianName: "",
        guardianIdDocument: "",
        instagramHandle: "",
        submittedAt: "",
        confirmedAt: "",
        checkedInAt: "",
        emailBounced: false,
      })),
    );
    const lines = csv.split("\r\n");
    expect(lines[0].split(",").at(-1)).toBe("Member bib");
    const cellOf = (email: string) => lines.find((line) => line.includes(email))?.split(",").at(-1);
    expect(cellOf("membru@example.ro")).toBe("yes");
    expect(cellOf("declarat@example.ro")).toBe("asked");
    expect(cellOf("nimic@example.ro")).toBe("");

    const filtered = await listRegistrationsForAdmin(db, { eventId: event.id, memberBibAsked: true });
    expect(filtered.map((row) => row.id)).toEqual([asked.id]);
    /*
      The list page reads the count and the summary under the same filter, and neither joins
      `events`: the event's switch is the condition's own subquery, never the caller's join.
    */
    const askedFilter = { eventId: event.id, status: "CONFIRMED" as const, memberBibAsked: true };
    expect(await countRegistrationsForAdmin(db, askedFilter)).toBe(1);
    expect(await summariseRegistrationsForAdmin(db, askedFilter)).toMatchObject({ real: 1, test: 0 });
    // The bibs page's line and the list it links to count the same set.
    expect(await countUnverifiedMemberBibs(db, event.id)).toBe(1);

    const page = await findRegistrationDetailForAdmin(db, verified.id);
    expect(page).toMatchObject({ memberBibWanted: true, eventOffersMemberBib: true, memberVerified: true });
  });

  it("the export route writes «Member bib» as yes, asked or empty, in the CSV and in the workbook", async () => {
    const event = await createEvent(true);
    await db.insert(staffUsers).values({ email: "membru@example.ro", displayName: "Membru", role: "MEMBER" });
    await confirmed(event.id, "membru@example.ro", { wanted: true });
    await confirmed(event.id, "declarat@example.ro", { wanted: true });
    await confirmed(event.id, "nimic@example.ro", { wanted: false, declared: false });
    const expected = new Map([
      ["membru@example.ro", "yes"],
      ["declarat@example.ro", "asked"],
      ["nimic@example.ro", ""],
    ]);

    const csv = await (await exportRegistrations(new Request(`http://localhost/api/admin/registrations/export?eventId=${event.id}`))).text();
    const [header, ...lines] = csv.split("\r\n").filter((line) => line !== "");
    const at = header.split(",").indexOf("Member bib");
    expect(at).toBeGreaterThan(-1);
    for (const [email, cell] of expected) {
      expect(lines.find((line) => line.includes(email))?.split(",")[at], `CSV ${email}`).toBe(cell);
    }

    const response = await exportRegistrations(new Request(`http://localhost/api/admin/registrations/export?eventId=${event.id}&format=xlsx`));
    expect(response.status).toBe(200);
    const { rows } = readSheet(Buffer.from(await response.arrayBuffer()));
    const column = rows[0].indexOf("Member bib");
    expect(column).toBeGreaterThan(-1);
    for (const [email, cell] of expected) {
      const row = rows.find((cells) => cells.includes(email));
      expect(row, `workbook ${email}`).toBeDefined();
      // An empty cell is written as no cell at all, or as an empty string.
      expect(row?.[column] ?? "", `workbook ${email}`).toBe(cell);
    }
  });
});
