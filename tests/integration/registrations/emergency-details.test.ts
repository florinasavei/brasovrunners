import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { findRegistrationByCheckinCode } from "@/modules/registrations/admin-repository";
import { readEmergencyDetails, readEmergencySheet } from "@/modules/registrations/admin-service";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-031-05, BR-REQ-060-01 — the phone, the emergency contact and the health note are
 * readable by the people they are for, and by nobody else (§NNN).
 *
 * The form collected all four "for race day" and the backoffice could show none of them: the
 * club held a health note it could not read. Now whoever may read the registrations reads them —
 * the Organizer included (§289) — on the registration's page and on the emergency sheet, and
 * every read is recorded with the reader and no value. The desk, which every staff role works,
 * still carries a name, a state and a number and never these (`AGENTS.md` §15.11). A Voluntar,
 * a Redactor or a Tehnic is refused on the server.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");
const RACE_DAY = new Date("2026-10-01T09:00:00.000Z");

describe("BR-REQ-031-05 the emergency details, for the people they are for", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let eventId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: RACE_DAY, registrationMode: "INTERNAL", capacity: 10 })
      .returning();
    eventId = event.id;
  });

  async function staff(role: StaffRole): Promise<StaffUser> {
    const [user] = await db
      .insert(staffUsers)
      .values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role })
      .returning();
    return user;
  }

  async function seed(input: {
    email: string;
    name: string;
    status?: "CONFIRMED" | "WAITLISTED" | "CANCELLED";
    kind?: "REAL" | "TEST";
    bibNumber?: number | null;
    health?: string | null;
    checkinCode?: string | null;
  }): Promise<string> {
    const identity = canonicalizeEmail(input.email);
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: input.name,
      })
      .returning();
    const status = input.status ?? "CONFIRMED";
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        status,
        kind: input.kind ?? "REAL",
        locale: "ro",
        registeredName: input.name,
        displayName: input.name,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        confirmedAt: status === "CONFIRMED" ? NOW : null,
        waitlistedAt: status === "WAITLISTED" ? NOW : null,
        cancelledAt: status === "CANCELLED" ? NOW : null,
        cancellationSource: status === "CANCELLED" ? "PARTICIPANT" : null,
        bibNumber: input.bibNumber ?? null,
        checkinCode: input.checkinCode ?? null,
        phone: "+40711111111",
        emergencyContactName: "Ion Popescu",
        emergencyContactPhone: "+40722222222",
        healthNotes: input.health === undefined ? "alergie la penicilină" : input.health,
        healthConsentVersion: input.health === null ? null : 1,
        healthConsentAt: input.health === null ? null : NOW,
      })
      .returning();
    return registration.id;
  }

  describe("on the registration's page", () => {
    it.each(["MODERATOR", "ADMIN", "SUPERADMIN"] as const)("is read by a %s, and the read is recorded with no value", async (role) => {
      const reader = await staff(role);
      const id = await seed({ email: "ana@example.ro", name: "Ana Pop" });

      const details = await readEmergencyDetails(db, reader, id, NOW);

      expect(details).toMatchObject({
        phone: "+40711111111",
        emergencyContactName: "Ion Popescu",
        emergencyContactPhone: "+40722222222",
        healthNotes: "alergie la penicilină",
      });
      const trail = await db.select().from(auditLogs);
      expect(trail.map((entry) => [entry.action, entry.actorStaffUserId, entry.entityType, entry.entityId, entry.metadataJson])).toEqual([
        ["registration.health_viewed", reader.id, "registration", id, {}],
      ]);
      expect(JSON.stringify(trail)).not.toMatch(/penicilin|\+407/);
    });

    it.each(["CONTRIBUTOR", "COPYWRITER", "DEV"] as const)("is refused to a %s, who learns nothing and leaves no read", async (role) => {
      const reader = await staff(role);
      const id = await seed({ email: "ana@example.ro", name: "Ana Pop" });

      await expect(readEmergencyDetails(db, reader, id, NOW)).rejects.toSatisfy(
        (error: unknown) => isDomainError(error) && error.code === "FORBIDDEN",
      );
      // Refused before the lookup: an unknown id is refused the same way.
      await expect(readEmergencyDetails(db, reader, "00000000-0000-0000-0000-000000000000", NOW)).rejects.toSatisfy(
        (error: unknown) => isDomainError(error) && error.code === "FORBIDDEN",
      );
      expect(await db.select().from(auditLogs)).toHaveLength(0);
    });

    it("never rides on the desk's query, which every staff role reads (§15.11)", async () => {
      await seed({ email: "ana@example.ro", name: "Ana Pop", checkinCode: "ABC123" });

      const desk = await findRegistrationByCheckinCode(db, "ABC123", "ro");

      expect(desk).toBeDefined();
      for (const field of ["phone", "emergencyContactName", "emergencyContactPhone", "healthNotes", "healthConsentAt"]) {
        expect(Object.keys(desk ?? {}), `${field} is not on the desk row`).not.toContain(field);
      }
      expect(JSON.stringify(desk)).not.toMatch(/penicilin|\+407|Ion Popescu/);
    });
  });

  describe("on the emergency sheet", () => {
    it("lists every confirmed, real runner by number with the four details, and records the render", async () => {
      const organizer = await staff("MODERATOR");
      await seed({ email: "b@example.ro", name: "Bogdan", bibNumber: 12, health: null });
      await seed({ email: "a@example.ro", name: "Ana", bibNumber: 3 });
      await seed({ email: "w@example.ro", name: "Waiting", status: "WAITLISTED" });
      await seed({ email: "c@example.ro", name: "Cancelled", status: "CANCELLED" });
      await seed({ email: "t@example.ro", name: "Synthetic", kind: "TEST", bibNumber: 1 });

      const rows = await readEmergencySheet(db, organizer, eventId, NOW);

      expect(rows.map((row) => [row.bibNumber, row.registeredName, row.healthNotes])).toEqual([
        [3, "Ana", "alergie la penicilină"],
        [12, "Bogdan", null],
      ]);
      expect(rows[0]).toMatchObject({ phone: "+40711111111", emergencyContactName: "Ion Popescu", emergencyContactPhone: "+40722222222" });

      const [entry] = await db.select().from(auditLogs);
      expect([entry.action, entry.actorStaffUserId, entry.entityType, entry.entityId, entry.metadataJson]).toEqual([
        "event.emergency_sheet_viewed",
        organizer.id,
        "event",
        eventId,
        { rowCount: 2 },
      ]);
    });

    it.each(["CONTRIBUTOR", "COPYWRITER", "DEV"] as const)("is refused to a %s (BR-REQ-060-01)", async (role) => {
      const reader = await staff(role);
      await seed({ email: "a@example.ro", name: "Ana", bibNumber: 3 });

      await expect(readEmergencySheet(db, reader, eventId, NOW)).rejects.toSatisfy(
        (error: unknown) => isDomainError(error) && error.code === "FORBIDDEN",
      );
      expect(await db.select().from(auditLogs)).toHaveLength(0);
    });

    it("answers an unknown event with NOT_FOUND and records nothing", async () => {
      const admin = await staff("ADMIN");
      await expect(readEmergencySheet(db, admin, "00000000-0000-0000-0000-000000000000", NOW)).rejects.toSatisfy(
        (error: unknown) => isDomainError(error) && error.code === "NOT_FOUND",
      );
      expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.emergency_sheet_viewed"))).toHaveLength(0);
    });
  });
});
