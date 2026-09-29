import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationKind, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-038-01, §548 (and the review of it, §NNN) — the desk's single-bib picture,
 * `GET /api/admin/events/<id>/bibs/preview?registration=<id>`, draws a bib for a confirmed real
 * registration only: the sheet's own rule (`bibs.ts#bibScopeWhere`). A row that is not confirmed —
 * a restarted one still wearing its retired number, one on the waiting list, a cancelled one — and
 * a test registration answer 404, the same as a registration of another event.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { GET } = await import("@/app/api/admin/events/[id]/bibs/preview/route");

describe("§548 the single-bib preview draws a confirmed real registration only", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let volunteer: StaffUser;
  let eventId: string;
  let counter = 0;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [volunteer] = await db.insert(staffUsers).values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" }).returning();
    state.actor = volunteer;
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00Z"), registrationMode: "INTERNAL", locationName: "Start" })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", title: "Crosul Tâmpei", slug: "crosul-tampei" },
      { eventId: event.id, locale: "en", title: "The Tâmpa cross", slug: "tampa-cross" },
    ]);
    eventId = event.id;
  });

  async function register(status: RegistrationStatus, bibNumber: number | null, kind: RegistrationKind = "REAL") {
    counter += 1;
    const email = `bib-${counter}@example.test`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `Alergător ${counter}` })
      .returning();
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        status,
        kind,
        locale: "ro",
        registeredName: `Alergător ${counter}`,
        displayName: `Alergător ${counter}`,
        bibNumber,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: new Date("2026-09-01T00:00:00Z"),
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        submittedAt: new Date("2026-09-01T00:00:00Z"),
        confirmedAt: status === "CONFIRMED" ? new Date("2026-09-02T10:00:00Z") : null,
      })
      .returning();
    return row;
  }

  const preview = (registrationId: string) =>
    GET(new Request(`http://localhost/api/admin/events/${eventId}/bibs/preview?registration=${registrationId}&locale=ro`), {
      params: Promise.resolve({ id: eventId }),
    });

  it("draws the bib of a confirmed real registration", async () => {
    const confirmed = await register("CONFIRMED", 7);
    const response = await preview(confirmed.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
  });

  it.each<[string, RegistrationStatus, number | null, RegistrationKind]>([
    ["a restarted row still wearing its retired number", "PENDING_DECLARATION", 8, "REAL"],
    ["a row waiting for its email link", "PENDING_EMAIL_CONFIRMATION", null, "REAL"],
    ["a row on the waiting list", "WAITLISTED", null, "REAL"],
    ["a cancelled row that kept its number", "CANCELLED", 9, "REAL"],
    ["a confirmed test registration", "CONFIRMED", 10, "TEST"],
  ])("answers 404 for %s", async (_what, status, bibNumber, kind) => {
    const row = await register(status, bibNumber, kind);
    const response = await preview(row.id);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
  });
});
