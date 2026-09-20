import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { cancelRegistrationByStaff, deleteRegistrationByStaff } from "@/modules/registrations/admin-service";
import { rowVerbsFor } from "@/modules/registrations/domain/row-verbs";
import { listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import {
  confirmEmail,
  type EventForRegistration,
  signDeclaration,
  submitRegistration,
} from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-06, BR-REQ-060-01 (§180) — erasing a participant from the registrations *list*.
 *
 * The owner asked three times: "vreau sa pot sterge si participantii". What was missing was
 * never the permission — he is the club's data controller — but the reach: erasure existed only
 * on a registration's own page, so clearing eighty test rows meant eighty round trips through a
 * list that re-sorts underneath you.
 *
 * The thing these tests exist to hold down is that reaching it from the list changed *nothing*
 * about what erasing means. There is one erase path, `deleteRegistrationByStaff`, and the list
 * hands it one extra argument: the row's name, typed, because a list row is one line from its
 * neighbour and "are you sure" is answered yes by reflex.
 *
 * So: the same audit row, the same release of the place through the allocator, the same removal
 * of the declaration acceptance — reached from the list, on a row the list actually returns, and
 * refused when the typed name names somebody else.
 */
const NOW = new Date("2026-09-05T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let volunteer: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTables(db);

  const body = { sections: [{ paragraphs: ["p"] }] };
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body },
    { locale: "en", title: "Document", body },
  ];
  for (const key of ["PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(pair),
      translations: pair,
      now: NOW,
    });
  }

  [admin] = await db
    .insert(staffUsers)
    .values({ email: "superadmin@dev.test", displayName: "Admin", role: "ADMIN" })
    .returning();
  [volunteer] = await db
    .insert(staffUsers)
    .values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" })
    .returning();
});

async function createInternalEvent(capacity: number | null): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "GROUP_RUN",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity,
    })
    .returning();

  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity,
    raceId: null,
    publishedAt: NOW,
  };
}

/** A public registration, taken as far as the participant's own email confirmation. */
async function registerPublicly(
  event: EventForRegistration,
  email: string,
  names: { firstName: string; lastName: string },
) {
  await submitRegistration(
    db,
    event,
    {
      ...names,
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
      resultsNameConsent: false,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    },
    NOW,
  );

  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.canonicalEmail, email.toLowerCase()));
  const [registration] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.participantId, participant.id));

  return confirmEmail(db, event, registration.id, NOW);
}

/**
 * What the list page does to decide the row's menu, and what the erase panel then submits —
 * without the React. The verbs come from the same pure function the page renders from, and the
 * erasure goes through the same service the Server Action calls, with the same argument.
 */
async function eraseFromTheList(
  actor: StaffUser,
  registrationId: string,
  reason: string,
  typedName: string,
): Promise<void> {
  await deleteRegistrationByStaff(db, actor, registrationId, reason, NOW, { confirmName: typedName });
}

describe("BR-REQ-037-06 erasing a registration from the list", () => {
  it("offers erase on a row the list actually returns, in whatever state it is in", async () => {
    const event = await createInternalEvent(10);
    const registration = await registerPublicly(event, "listed@example.ro", {
      firstName: "Ana",
      lastName: "Popescu",
    });

    const [row] = await listRegistrationsForAdmin(
      db,
      { eventId: event.id },
      { limit: 25, offset: 0, sort: "submitted", dir: "desc" },
    );
    expect(row.id).toBe(registration.id);

    // The menu the page would draw for this row, from the same function.
    const verbs = rowVerbsFor(row.status, admin.role, { checkedIn: row.checkedInAt !== null });
    expect(verbs).toContain("erase");
    expect(verbs.at(-1)).toBe("erase");

    // And the name the panel asks to have typed is the name the row shows, not a second
    // derivation that could disagree with it.
    await eraseFromTheList(admin, row.id, "cerere de ștergere", row.registeredName);
    expect(await db.select().from(registrations).where(eq(registrations.id, row.id))).toHaveLength(0);
  });

  it("reaches the same service: the audit row, the declaration and the participant all go", async () => {
    const event = await createInternalEvent(10);
    const registration = await registerPublicly(event, "erased@example.ro", {
      firstName: "Ana",
      lastName: "Popescu",
    });
    await signDeclaration(db, event, registration.id, await signingInput(db, NOW, "Ana Popescu"), NOW);

    expect(
      await db
        .select()
        .from(declarationAcceptances)
        .where(eq(declarationAcceptances.registrationId, registration.id)),
    ).toHaveLength(1);

    await eraseFromTheList(admin, registration.id, "cerere de ștergere", "Ana Popescu");

    expect(await db.select().from(registrations).where(eq(registrations.id, registration.id))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(declarationAcceptances)
        .where(eq(declarationAcceptances.registrationId, registration.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(participants).where(eq(participants.id, registration.participantId)),
    ).toHaveLength(0);

    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, registration.id));
    expect(entry.action).toBe("registration.deleted_by_staff");
    expect(entry.actorStaffUserId).toBe(admin.id);
    expect(entry.metadataJson).toMatchObject({ reason: "cerere de ștergere" });
    /*
      The audit row names who and why and never who was erased (§15.11, §67). Worth asserting
      again on this path and not only on the detail page's: the list is where the typed name
      arrives, and the typed name is the person's name. It must not travel into the trail with
      the reason.
    */
    const recorded = JSON.stringify(entry.metadataJson);
    expect(recorded).not.toContain("Ana Popescu");
    expect(recorded).not.toContain("erased@example.ro");
  });

  it("releases the place through the allocator when there was one to release", async () => {
    const event = await createInternalEvent(1);
    const holder = await registerPublicly(event, "holder@example.ro", {
      firstName: "Ana",
      lastName: "Popescu",
    });
    const waiting = await registerPublicly(event, "waiting@example.ro", {
      firstName: "Ion",
      lastName: "Ionescu",
    });
    expect(waiting.status).toBe("WAITLISTED");

    await eraseFromTheList(admin, holder.id, "cerere de ștergere", "Ana Popescu");

    const [promoted] = await db.select().from(registrations).where(eq(registrations.id, waiting.id));
    // The reason erasure goes through the allocator rather than straight to DELETE: the place
    // belongs to whoever was waiting for it, not to whoever registers next.
    expect(promoted.status).toBe("WAITLIST_OFFERED");
  });

  /**
   * The row this whole change is about, and the one §179 could not erase: already cancelled.
   * It holds no place, so nothing is released — and it must still erase cleanly rather than
   * throwing on the way through the allocator.
   */
  it("erases a cancelled row, which holds no place, without disturbing the queue", async () => {
    const event = await createInternalEvent(1);
    const holder = await registerPublicly(event, "cancelled@example.ro", {
      firstName: "Ana",
      lastName: "Popescu",
    });

    // Cancelled the way a cancellation actually happens, not by UPDATE: the schema keeps the
    // cancellation columns together, and a row forced into CANCELLED by hand is not the row this
    // test is about.
    await cancelRegistrationByStaff(db, admin, holder.id, "s-a răzgândit", NOW);
    // The place it held is free again, and the next person takes it.
    const later = await registerPublicly(event, "next@example.ro", {
      firstName: "Ion",
      lastName: "Ionescu",
    });
    const before = later.status;

    await eraseFromTheList(admin, holder.id, "rând de test", "Ana Popescu");

    expect(await db.select().from(registrations).where(eq(registrations.id, holder.id))).toHaveLength(0);
    const [untouched] = await db.select().from(registrations).where(eq(registrations.id, later.id));
    // Nothing was released, because a cancelled row holds nothing. Had erasure tried to release
    // a place here it would have handed this person a second one.
    expect(untouched.status).toBe(before);
  });

  it("refuses when the typed name is somebody else, and erases nothing", async () => {
    const event = await createInternalEvent(10);
    const registration = await registerPublicly(event, "kept@example.ro", {
      firstName: "Ana",
      lastName: "Popescu",
    });

    await expect(
      eraseFromTheList(admin, registration.id, "greșeală", "Ion Ionescu"),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isDomainError(error) && error.code === "VALIDATION_ERROR" && error.fields.includes("confirmName"),
    );

    expect(await db.select().from(registrations).where(eq(registrations.id, registration.id))).toHaveLength(1);
    // And nothing was written on the way to refusing: a refused erasure is not an event.
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, registration.id))).toHaveLength(0);
  });

  it("refuses an empty confirmation, which is a form submitted without one", async () => {
    const event = await createInternalEvent(10);
    const registration = await registerPublicly(event, "empty@example.ro", {
      firstName: "Ana",
      lastName: "Popescu",
    });

    await expect(eraseFromTheList(admin, registration.id, "x", "   ")).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR",
    );
    expect(await db.select().from(registrations).where(eq(registrations.id, registration.id))).toHaveLength(1);
  });

  it("accepts the name as a Romanian keyboard actually types it", async () => {
    const event = await createInternalEvent(10);
    const registration = await registerPublicly(event, "diacritics@example.ro", {
      firstName: "Ștefan",
      lastName: "Tănase",
    });

    // Without the diacritics, and in lower case — the club would otherwise have rows it could
    // not erase from a phone.
    await eraseFromTheList(admin, registration.id, "cerere", "stefan tanase");
    expect(await db.select().from(registrations).where(eq(registrations.id, registration.id))).toHaveLength(0);
  });

  /**
   * BR-REQ-060-01. The typed name is a slip guard, never an authorization one — a correct
   * transcription must not buy a Volunteer an erasure, and the role is checked before the name
   * is even looked at. `rowVerbsFor` withholds the verb from that role too, but that is a
   * courtesy: this is the gate.
   */
  it("refuses a role below Administrator even with the name typed perfectly", async () => {
    const event = await createInternalEvent(10);
    const registration = await registerPublicly(event, "guarded@example.ro", {
      firstName: "Ana",
      lastName: "Popescu",
    });

    expect(rowVerbsFor(registration.status, volunteer.role, { checkedIn: false })).not.toContain("erase");

    await expect(
      eraseFromTheList(volunteer, registration.id, "no", "Ana Popescu"),
    ).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "FORBIDDEN");

    expect(await db.select().from(registrations).where(eq(registrations.id, registration.id))).toHaveLength(1);
  });

  /**
   * A mistyped name must not become a way of asking "does this id exist?". `NOT_FOUND` comes
   * first, so an unknown id answers the same whatever was typed into the box.
   */
  it("answers NOT_FOUND for an unknown row rather than complaining about the name", async () => {
    await expect(
      eraseFromTheList(admin, "00000000-0000-0000-0000-000000000000", "x", "anything at all"),
    ).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "NOT_FOUND");
  });

  /**
   * The detail page still erases with a ticked box and no typed name, and must keep doing so:
   * you reached it by choosing that person. Leaving the argument out is not an error.
   */
  it("leaves the registration's own page alone: no typed name, same erasure", async () => {
    const event = await createInternalEvent(10);
    const registration = await registerPublicly(event, "detail@example.ro", {
      firstName: "Ana",
      lastName: "Popescu",
    });

    await deleteRegistrationByStaff(db, admin, registration.id, "from the detail page", NOW);

    expect(await db.select().from(registrations).where(eq(registrations.id, registration.id))).toHaveLength(0);
  });
});
