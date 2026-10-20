import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventResults } from "@/db/schema/event-results";
import { eventVolunteerCategories, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationInterests } from "@/db/schema/registration-interests";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { deleteRegistrationByStaff } from "@/modules/registrations/admin-service";
import {
  canonicalLookupOf,
  exportPersonData,
  openPersonLookup,
  PERSON_LOOKUP_MINUTES,
  sealPersonLookup,
  viewPersonData,
} from "@/modules/registrations/person-data";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { mirrorRolesGiven } from "../../helpers/volunteer-roles";

/**
 * BR-REQ-070-01, BR-REQ-060-01 — everything held about one person, for an access request
 * (art. 15 GDPR) and before an erasure (§322).
 *
 * Looked up by the canonical address through the canonicalizer, never a raw compare (AGENTS.md
 * §10.4): a Gmail `+tag` and a capital letter find the same person, and the "Anunță-mă" list is
 * matched the same way. Administrator only. The address never travels in a URL: the lookup is
 * sealed, and a sealed lookup stops opening after half an hour. Viewing records a read of each
 * registration's emergency details; the file records an export with counts and no value.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

describe("BR-REQ-070-01 everything held about a person", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let eventId: string;
  let participantId: string;
  let registrationId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  async function staff(role: StaffRole): Promise<StaffUser> {
    const [user] = await db
      .insert(staffUsers)
      .values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role })
      .returning();
    return user;
  }

  beforeEach(async () => {
    await resetTables(db);
    await db.delete(registrationInterests);
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL" })
      .returning();
    eventId = event.id;
    const identity = canonicalizeEmail("Ana.Pop+club@Gmail.com");
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: "Ana Pop",
      })
      .returning();
    participantId = participant.id;
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId,
        status: "CANCELLED",
        cancelledAt: NOW,
        cancellationSource: "PARTICIPANT",
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 3,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: true,
        resultsConsentVersion: 3,
        city: "Brașov",
        healthNotes: "astm",
        healthConsentVersion: 3,
        healthConsentAt: NOW,
      })
      .returning();
    registrationId = registration.id;
    await db.insert(emailOutbox).values({
      participantId,
      registrationId,
      messageType: "REGISTRATION_CANCELLED",
      locale: "ro",
      recipientEmail: identity.deliveryEmail,
      payloadJson: {},
      idempotencyKey: "cancelled-1",
      status: "SENT",
      sentAt: NOW,
      deliveredAt: NOW,
    });
    const interest = canonicalizeEmail("ana.pop@gmail.com");
    await db.insert(registrationInterests).values({
      eventId,
      deliveryEmail: interest.deliveryEmail,
      canonicalEmail: interest.canonicalEmail,
      canonicalizationVersion: interest.canonicalizationVersion,
      locale: "ro",
    });
    // An offer to volunteer (§754) is found by the same canonical address, and is everything typed.
    const [volunteerRole] = await db.insert(eventVolunteerRoles).values({ eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 2 }).returning();
    const [finishRole] = await db.insert(eventVolunteerRoles).values({ eventId, nameRo: "Sosire", nameEn: "Finish", needed: 1, position: 1 }).returning();
    // §774: the same role name under two categories — «Direcționare» at the start and on the route — is two roles to read, so the
    // person's own copy names each with its category and never «Direcționare, Direcționare».
    const [startCategory, routeCategory] = await db
      .insert(eventVolunteerCategories)
      .values([
        { eventId, nameRo: "Start / Sosire", nameEn: "Start / Finish", sort: 0 },
        { eventId, nameRo: "Traseu", nameEn: "Route", sort: 1 },
      ])
      .returning();
    const [guideAtStart, guideOnRoute] = await db
      .insert(eventVolunteerRoles)
      .values([
        { eventId, categoryId: startCategory.id, nameRo: "Direcționare", nameEn: "Guidance", needed: 1, position: 2 },
        { eventId, categoryId: routeCategory.id, nameRo: "Direcționare", nameEn: "Guidance", needed: 1, position: 3 },
      ])
      .returning();
    // §761: an offer nobody has given a role yet, with the roles she ticked.
    const [offer] = await db.insert(eventVolunteers).values({
      eventId,
      roleId: null,
      name: "Ana Pop",
      email: interest.deliveryEmail,
      canonicalEmail: interest.canonicalEmail,
      canonicalizationVersion: interest.canonicalizationVersion,
      phone: "+40712345678",
      source: "PUBLIC",
      message: "Sunt liberă sâmbătă",
      privacyNoticeVersion: 3,
      // What she said about herself (§765): every answer is hers to see, as stored.
      age: 34,
      dateOfBirth: "1992-03-12",
      sex: "FEMALE",
      city: "Brașov",
      volunteeredBefore: true,
      clubMember: true,
      shirtSize: "M",
    }).returning();
    await db.insert(eventVolunteerRoleChoices).values([
      { volunteerId: offer.id, roleId: finishRole.id },
      { volunteerId: offer.id, roleId: volunteerRole.id },
      { volunteerId: offer.id, roleId: guideAtStart.id },
      { volunteerId: offer.id, roleId: guideOnRoute.id },
    ]);
  });

  it("names the role the organizers gave with its category, as every other place that names a role alone (§774)", async () => {
    const admin = await staff("ADMIN");
    const [route] = await db.select().from(eventVolunteerCategories).where(eq(eventVolunteerCategories.nameEn, "Route"));
    const [guide] = await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.categoryId, route.id));
    await db.update(eventVolunteers).set({ roleId: guide.id });
    await mirrorRolesGiven(db);

    const data = await viewPersonData(db, admin, canonicalLookupOf("ANA.POP+other@gmail.com"), NOW);

    expect(data.volunteerOffers[0]).toMatchObject({ roleNameRo: "Direcționare (Traseu)", roleNameEn: "Guidance (Route)" });
  });

  it("finds the person by the canonical address, whichever spelling was typed", async () => {
    const admin = await staff("ADMIN");

    const data = await viewPersonData(db, admin, canonicalLookupOf("ANA.POP+other@gmail.com"), NOW);

    expect(data.participant?.id).toBe(participantId);
    // Every registration in every status, with every stored column — the consents and their versions included.
    expect(data.registrations).toHaveLength(1);
    expect(data.registrations[0]).toMatchObject({
      id: registrationId,
      status: "CANCELLED",
      city: "Brașov",
      healthNotes: "astm",
      privacyNoticeVersion: 3,
      listOptOut: true,
    });
    expect(data.messages.map((message) => [message.messageType, message.status])).toEqual([["REGISTRATION_CANCELLED", "SENT"]]);
    // What the provider reported is the person's too (§670): the delivery, never the provider's words.
    expect(data.messages[0]).toMatchObject({ deliveredAt: NOW, rejectedAt: null, rejectionCause: null, laterDeliveredAt: null });
    expect(Object.keys(data.messages[0])).not.toContain("providerDetail");
    // The "Anunță-mă" address is matched the same way, and it is its own row: no participant.
    expect(data.announcementRequests).toHaveLength(1);
    // …and so is an offer to volunteer, with every column the platform keeps of it.
    expect(data.volunteerOffers).toMatchObject([
      {
        // No role given yet, and every role she ticked, in the club's order (§761).
        roleNameRo: null,
        roleNameEn: null,
        chosenRolesRo: ["Punct de apă", "Sosire", "Direcționare (Start / Sosire)", "Direcționare (Traseu)"],
        chosenRolesEn: ["Water point", "Finish", "Guidance (Start / Finish)", "Guidance (Route)"],
        state: "REGISTERED",
        source: "PUBLIC",
        name: "Ana Pop",
        phone: "+40712345678",
        message: "Sunt liberă sâmbătă",
        privacyNoticeVersion: 3,
        age: 34,
        // §773: the date of birth the age came from is hers too, every column of the row (art. 15 GDPR).
        dateOfBirth: "1992-03-12",
        sex: "FEMALE",
        city: "Brașov",
        volunteeredBefore: true,
        clubMember: true,
        shirtSize: "M",
      },
    ]);
    // The volunteer agreement's columns are hers too (§758): here none was accepted, and it says so.
    expect(data.volunteerOffers[0]).toMatchObject({ agreementVersion: null, agreementMethod: null, agreementAcceptedAt: null, declaredAdult: false });

    // Viewing is a read of the emergency details, recorded for each registration shown.
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.health_viewed"));
    expect(trail.map((entry) => [entry.actorStaffUserId, entry.entityId, entry.metadataJson])).toEqual([
      [admin.id, registrationId, { via: "PERSON_VIEW" }],
    ]);
  });

  /**
   * §808 — a race's results are personal data tied to the registration: the access answer lists them, every column as the platform stores
   * it (the race number, how it ended, the times, the places, the category, the note, whether the race's results are public), and the file
   * carries them too — an answer without them would be incomplete.
   */
  it("lists the results entered for the person's registrations, every column, in the page's data and the file", async () => {
    const admin = await staff("ADMIN");
    await db.insert(eventResults).values({ eventId, registrationId, bibNumber: 101, status: "FINISHED", gunTimeMs: 3_000_000, chipTimeMs: 2_990_000, positionOverall: 3, positionSex: 2, positionCategory: 1, categoryKey: "FEMALE:from30", note: "a venit cu bastoane" });
    await db.update(events).set({ resultsPublished: true }).where(eq(events.id, eventId));
    // Another person's result on the same race is not hers.
    await db.insert(eventResults).values({ eventId, bibNumber: 900, displayName: "Ion Vasile", status: "FINISHED", gunTimeMs: 2_900_000 });

    for (const data of [await viewPersonData(db, admin, canonicalLookupOf("ana.pop@gmail.com"), NOW), await exportPersonData(db, admin, canonicalLookupOf("ana.pop@gmail.com"), NOW)]) {
      expect(data.results).toHaveLength(1);
      expect(data.results[0]).toMatchObject({ registrationId, eventId, bibNumber: 101, status: "FINISHED", gunTimeMs: 3_000_000, chipTimeMs: 2_990_000, positionOverall: 3, positionSex: 2, positionCategory: 1, categoryKey: "FEMALE:from30", note: "a venit cu bastoane", published: true });
      expect(JSON.stringify(data.results)).not.toContain("Ion Vasile");
    }
    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.action, "participant.data_exported"));
    expect((entry.metadataJson as { results: number }).results).toBe(1);
  });

  it("records the file as an export, with counts and no value", async () => {
    const admin = await staff("SUPERADMIN");

    const data = await exportPersonData(db, admin, canonicalLookupOf("ana.pop@gmail.com"), NOW);

    expect(data.registrations).toHaveLength(1);
    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.action, "participant.data_exported"));
    expect([entry.actorStaffUserId, entry.entityType, entry.entityId]).toEqual([admin.id, "participant", participantId]);
    expect(entry.metadataJson).toEqual({ registrations: 1, declarationAcceptances: 0, messages: 1, announcementRequests: 1, rsvpAnswers: 0, askRefusals: 0, rememberedBrowsers: 0, volunteerInvitations: 0, volunteerOffers: 1, groupRunDeclarations: 0, results: 0, notes: 0, auditRows: 0 });
    expect(JSON.stringify(entry.metadataJson)).not.toMatch(/astm|gmail|Ana/);
  });

  /**
   * §322 — the export's row is about the person, so it carries their uuid in `entity_id` as well
   * as in `participant_id`. The foreign key nulls only the second when the participant row goes;
   * erasing the last registration must take the first as well.
   */
  it("forgets whose file it was when the erasure takes the person's last registration", async () => {
    const admin = await staff("ADMIN");
    await exportPersonData(db, admin, canonicalLookupOf("ana.pop@gmail.com"), NOW);

    await deleteRegistrationByStaff(db, admin, registrationId, "cerere de ștergere", NOW);

    expect(await db.select().from(participants).where(eq(participants.id, participantId))).toHaveLength(0);
    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.action, "participant.data_exported"));
    expect([entry.actorStaffUserId, entry.entityType, entry.participantId, entry.entityId]).toEqual([admin.id, "participant", null, null]);
    // The row still says a file was made, and of how much.
    expect(entry.metadataJson).toMatchObject({ registrations: 1 });
    const trail = await db.select().from(auditLogs);
    expect(JSON.stringify(trail)).not.toContain(participantId);
  });

  it.each(["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const)("is refused to a %s (BR-REQ-060-01)", async (role) => {
    const actor = await staff(role);
    const canonical = canonicalLookupOf("ana.pop@gmail.com");

    for (const call of [viewPersonData(db, actor, canonical, NOW), exportPersonData(db, actor, canonical, NOW)]) {
      await expect(call).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "FORBIDDEN");
    }
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses an address the canonicalizer refuses, as a field error", () => {
    expect(() => canonicalLookupOf("not an address")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });

  it("carries the address sealed, never readable, and only for half an hour", () => {
    const sealed = sealPersonLookup("ana.pop@gmail.com", NOW) ?? "";

    // Flaky before: `not.toContain("ana")` on a random base64url string (a fresh IV every seal) fails whenever the
    // ciphertext happens to spell «ana». The address is looked for whole, as text and inside the decoded bytes, where a
    // chance match is not possible.
    expect(sealed).not.toContain("ana.pop");
    expect(Buffer.from(sealed, "base64url").toString("utf8")).not.toContain("ana.pop");
    expect(openPersonLookup(sealed, NOW)).toBe("ana.pop@gmail.com");
    expect(openPersonLookup(sealed, new Date(NOW.getTime() + (PERSON_LOOKUP_MINUTES - 1) * 60_000))).toBe("ana.pop@gmail.com");
    expect(openPersonLookup(sealed, new Date(NOW.getTime() + (PERSON_LOOKUP_MINUTES + 1) * 60_000))).toBeNull();
    // Tampered or made for something else: nothing.
    // (One bit of the ciphertext flipped: replacing the last characters with «xx» changed nothing when the seal already
    // ended so, or only the unused bits of the final base64 character.)
    const bytes = Buffer.from(sealed, "base64url");
    bytes[bytes.length - 1] ^= 1;
    expect(openPersonLookup(bytes.toString("base64url"), NOW)).toBeNull();
    expect(openPersonLookup("ana.pop@gmail.com", NOW)).toBeNull();
  });
});
