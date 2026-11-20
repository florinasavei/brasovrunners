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
import { listBibs } from "@/modules/registrations/bibs";
import { buildRegistrationsCsv } from "@/modules/registrations/csv";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { readSheet } from "../../helpers/xlsx";

/**
 * §664, BR-REQ-038-01, BR-REQ-037-03 — the members' race number from a real database, as §972 left it (the owner,
 * 2026-11-17: «că momentan nu se deosebesc cu nimic»):
 *
 * - «Vreau numărul de membru» is asked no more: every row the form or a staff entry writes stores false, whatever is
 *   posted, and «Modifică datele» refuses it by name — the column stays, read by nothing;
 * - the sheet prints the members' bib for a row whose person ticked «Sunt membru» while the event's design offers it —
 *   with a member account on «Echipa» or without one, the account alone never; a test row stays off the sheet as before;
 * - the export's «Member bib» reads yes / empty, and the «asked but not verified» filter is gone with the state.
 *
 * Every case §972 changed says so beside it; the rest are as §664 wrote them. The rule's own file is
 * `member-bib-declared.test.ts`.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

// The export route reads the database and the signed-in staff member through these two (§664).
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));
vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);
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

describe("§664 «Vreau numărul de membru» is asked no more (§972): every write stores false", () => {
  // §972: the public form stored the wish under the tick at an event offering the bib; a posted one is now ignored.
  it("stores false under the member tick at an event offering the members' bib, whatever the form posts", async () => {
    const event = await createEvent(true);
    await submitRegistration(db, event, submission({ clubMemberDeclared: true, memberBibWanted: true }), NOW);
    expect((await rowOf(event.id)).memberBibWanted).toBe(false);
    expect((await rowOf(event.id)).clubMemberDeclared).toBe(true);
  });

  it("stores false whatever a stale form posts: the design off, or the member tick off", async () => {
    const off = await createEvent(false);
    await submitRegistration(db, off, submission({ clubMemberDeclared: true, memberBibWanted: true }), NOW);
    expect((await rowOf(off.id)).memberBibWanted).toBe(false);

    const on = await createEvent(true);
    await submitRegistration(db, on, submission({ email: "b@example.ro", clubMemberDeclared: false, memberBibWanted: true }), NOW);
    expect((await rowOf(on.id)).memberBibWanted).toBe(false);
  });

  // §972: the staff entry asked it too and kept it where offered; it asks nothing now, and a stale caller's wish is dropped.
  it("asks it of the staff entry no more: a posted wish is dropped, the tick kept", async () => {
    // What a caller built for the old entry would post: the retired key beside the tick, not in the type any more.
    const staleDetails = { clubMemberDeclared: true, memberBibWanted: true } as unknown as { clubMemberDeclared: boolean };
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
        details: staleDetails,
      },
      NOW,
    );
    expect(await rowOf(event.id)).toMatchObject({ memberBibWanted: false, clubMemberDeclared: true });

    const other = await createEvent(false);
    await createRegistrationByStaff(
      db,
      admin,
      { eventId: other.id, firstName: "Desk", lastName: "Altul", email: "desk2@example.ro", locale: "ro", listOptOut: false, relayedByParticipantRequest: true, details: staleDetails },
      NOW,
    );
    expect((await rowOf(other.id)).memberBibWanted).toBe(false);
  });

  // §972: the staff form asked the wish where an event offered the bib; with nothing to ask, the list carries no flag.
  it("no longer tells the staff form which events offer it — the form asks nothing of it", async () => {
    const on = await createEvent(true);
    const listed = await listEventsAcceptingRegistrations(db, "ro");
    expect(listed.find((event) => event.id === on.id)).toBeDefined();
    expect(listed.find((event) => event.id === on.id)).not.toHaveProperty("offersMemberBib");
  });
});

describe("§664 «Modifică datele» and the members' bib (§972: the tick, not a wish)", () => {
  // §972: «Modifică datele» corrected the wish and clearing the tick cleared it; the wish is no answer now and the tick alone decides.
  it("refuses the retired wish by name, and a cleared tick writes no row for it — the next sheet follows the tick", async () => {
    const event = await createEvent(true);
    await submitRegistration(db, event, submission({ clubMemberDeclared: true }), NOW);
    const row = await rowOf(event.id);
    // A row from before §972 that still says yes: nothing reads it, and nothing rewrites it.
    await db.update(registrations).set({ memberBibWanted: true }).where(eq(registrations.id, row.id));

    await expect(editRegistrationAnswers(db, admin, row.id, { memberBibWanted: false }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["memberBibWanted"] });

    await editRegistrationAnswers(db, admin, row.id, { clubMemberDeclared: false }, NOW);
    const after = await rowOf(event.id);
    expect(after.clubMemberDeclared).toBe(false);
    expect(after.memberBibWanted).toBe(true);

    const trail = await db
      .select({ metadata: auditLogs.metadataJson })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "registration.answer_corrected"), eq(auditLogs.entityId, row.id)));
    const fields = trail.map((entry) => (entry.metadata as { field: string }).field);
    expect(fields).toContain("clubMemberDeclared");
    expect(fields).not.toContain("memberBibWanted");
  });

  it("keeps it false on an event that does not offer the members' bib: nothing changes, and says so", async () => {
    const event = await createEvent(false);
    await submitRegistration(db, event, submission({ clubMemberDeclared: true }), NOW);
    const row = await rowOf(event.id);
    await expect(editRegistrationAnswers(db, admin, row.id, { memberBibWanted: true }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await rowOf(event.id)).memberBibWanted).toBe(false);
  });
});

describe("§664 the sheet prints the members' bib for the member tick (§972), with or without an account", () => {
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

  // §972: the declared-only row printed the ordinary bib and the unasked one too; the tick alone prints it now.
  it("flags every row that ticked «Sunt membru» — a member account's address or not, asked or not; the TEST row stays off", async () => {
    const event = await createEvent(true);
    // A member account on «Echipa»: it verifies the chip (§662), and decides nothing of the bib any more (§972).
    await db.insert(staffUsers).values({ email: "membru@example.ro", displayName: "Membru", role: "MEMBER" });
    const verified = await confirmed(event.id, "membru@example.ro", { wanted: true });
    const declaredOnly = await confirmed(event.id, "declarat@example.ro", { wanted: true });
    const unasked = await confirmed(event.id, "admin@dev.test", { wanted: false });
    // An account and no tick: the account alone never prints it.
    await db.insert(staffUsers).values({ email: "cont@example.ro", displayName: "Cont", role: "MEMBER" });
    const accountOnly = await confirmed(event.id, "cont@example.ro", { wanted: false, declared: false });
    await confirmed(event.id, "test@example.ro", { wanted: true, kind: "TEST" });

    const sheet = await listBibs(db, event.id);
    expect(sheet.map((bib) => [bib.id, bib.member])).toEqual([
      [verified.id, true],
      [declaredOnly.id, true],
      [unasked.id, true],
      [accountOnly.id, false],
    ]);
    // The test row stays off the sheet, as every count the club is given (§30).
    expect(sheet).toHaveLength(4);
  });

  // §972: the «counts nobody unverified» half is gone with the unverified line; the switch half stands.
  it("prints nobody a member's bib while the event's switch is off", async () => {
    const event = await createEvent(false);
    await db.insert(staffUsers).values({ email: "membru@example.ro", displayName: "Membru", role: "MEMBER" });
    await confirmed(event.id, "membru@example.ro", { wanted: true });
    await confirmed(event.id, "declarat@example.ro", { wanted: false });
    expect((await listBibs(db, event.id)).every((bib) => !bib.member)).toBe(true);
  });

  // §972: with no member account a ticked row printed the ordinary bib; no account is read for the bib now.
  it("with no member account at all, still flags the row that ticked «Sunt membru»", async () => {
    await db.delete(staffUsers);
    const event = await createEvent(true);
    await confirmed(event.id, "a@example.ro", { wanted: true });
    await confirmed(event.id, "b@example.ro", { wanted: false, declared: false });
    expect((await listBibs(db, event.id)).map((bib) => bib.member)).toEqual([true, false]);
  });

  // §972: «asked» left the export with the state, and the bibs page's filter (`memberBibAsked`) with its line.
  it("reads «Member bib» in the export and tells the registration's page", async () => {
    const event = await createEvent(true);
    await db.insert(staffUsers).values({ email: "membru@example.ro", displayName: "Membru", role: "MEMBER" });
    const verified = await confirmed(event.id, "membru@example.ro", { wanted: true });
    const declared = await confirmed(event.id, "declarat@example.ro", { wanted: true });
    const nothing = await confirmed(event.id, "nimic@example.ro", { wanted: false, declared: false });
    // A test row that ticked: off the sheet and off the export (§30); in the list, read by the same rule as a real one.
    const probe = await confirmed(event.id, "proba@example.ro", { wanted: true, kind: "TEST" });

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
        clubRunner: false,
        memberBib: row.memberBib,
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
    // Before «Club runner» and «Partener», the last («Reconfirmat» sits beside «Status» since §1019).
    expect(lines[0].split(",").at(-3)).toBe("Member bib");
    const cellOf = (email: string) => lines.find((line) => line.includes(email))?.split(",").at(-3);
    expect(cellOf("membru@example.ro")).toBe("yes");
    expect(cellOf("declarat@example.ro")).toBe("yes");
    expect(cellOf("nimic@example.ro")).toBe("");

    // The list's rows read the rule in its one query, its count and its summary unchanged by it (no filter narrows by it any more).
    const byId = new Map(rows.map((row) => [row.id, row.memberBib]));
    expect([byId.get(verified.id), byId.get(declared.id), byId.get(nothing.id), byId.get(probe.id)]).toEqual([true, true, false, true]);
    expect(await countRegistrationsForAdmin(db, { eventId: event.id, status: "CONFIRMED" })).toBe(4);
    expect(await summariseRegistrationsForAdmin(db, { eventId: event.id })).toMatchObject({ real: 3, test: 1 });

    const page = await findRegistrationDetailForAdmin(db, verified.id);
    expect(page).toMatchObject({ memberBib: true, memberVerified: true });
    expect(await findRegistrationDetailForAdmin(db, declared.id)).toMatchObject({ memberBib: true, memberVerified: false });
    expect(await findRegistrationDetailForAdmin(db, nothing.id)).toMatchObject({ memberBib: false });
  });

  // §972: the declared row without an account read «asked»; it reads «yes» now, the export's words otherwise unchanged.
  it("the export route writes «Member bib» as yes or empty, in the CSV and in the workbook", async () => {
    const event = await createEvent(true);
    await db.insert(staffUsers).values({ email: "membru@example.ro", displayName: "Membru", role: "MEMBER" });
    await confirmed(event.id, "membru@example.ro", { wanted: true });
    await confirmed(event.id, "declarat@example.ro", { wanted: true });
    await confirmed(event.id, "nimic@example.ro", { wanted: false, declared: false });
    const expected = new Map([
      ["membru@example.ro", "yes"],
      ["declarat@example.ro", "yes"],
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
