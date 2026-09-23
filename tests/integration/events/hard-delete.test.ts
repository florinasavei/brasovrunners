import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { hardDeleteEvent } from "@/modules/content/events/service";
import { readEventErasurePlan } from "@/modules/content/events/repository";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import { countOccupied } from "@/modules/registrations/repository";
import { addTestRegistrations } from "@/modules/registrations/test-registrations";
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
 * BR-REQ-037-06 — erasure, applied to a whole event.
 * BR-REQ-060-01 — authorization is asserted on the server, never by hiding the screen.
 *
 * The verb exists because the club's own data controller had an archived event carrying two
 * registrations he had entered himself, and `deleteEvent` refuses any event with a registration
 * against it. "We cannot delete this" is not an answer a controller can be given about his own
 * records — so the answer is yes, and it behaves like an erasure rather than like a delete
 * button: the title typed by hand, a reason, one audit row per person that never says who they
 * were, one for the event that says how many there were, and all of it in one transaction.
 *
 * Six properties, and each one is a test below:
 *
 *   1. It erases the event, every registration on it, their declarations and their addresses.
 *   2. A wrong title destroys nothing — not "destroys less", nothing.
 *   3. A missing reason destroys nothing, because the reason is the only thing that survives.
 *   4. A role below Administrator is refused, and the refusal is about the role.
 *   5. The audit rows outlive what they describe and carry no participant's name or address.
 *   6. No place is left occupied: every registration goes through the allocator on its way out.
 */
const NOW = new Date("2026-09-05T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let editor: StaffUser;
let dev: StaffUser;

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
    .values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" })
    .returning();
  [editor] = await db
    .insert(staffUsers)
    .values({ email: "moderator@dev.test", displayName: "Editor", role: "MODERATOR" })
    .returning();
  // DEV is the interesting refusal: it is *above* MODERATOR in the hierarchy and still below
  // the personal-data line, which is exactly the boundary this verb sits on.
  [dev] = await db
    .insert(staffUsers)
    .values({ email: "dev@dev.test", displayName: "Dev", role: "DEV" })
    .returning();
});

const TITLE_RO = "Crosul de toamnă";
const TITLE_EN = "Autumn cross";

async function seedEvent(capacity: number | null): Promise<EventForRegistration> {
  const [row] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity,
      editorialStatus: "ARCHIVED",
    })
    .returning();

  await db.insert(eventTranslations).values([
    { eventId: row.id, locale: "ro", slug: "crosul-de-toamna", title: TITLE_RO },
    { eventId: row.id, locale: "en", slug: "autumn-cross", title: TITLE_EN },
  ]);

  return {
    id: row.id,
    eventStatus: row.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: row.startsAt,
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity,
    raceId: null,
    publishedAt: NOW,
  };
}

/** A public registration, taken as far as the participant's own email confirmation. */
async function registerPublicly(event: EventForRegistration, email: string) {
  await submitRegistration(
    db,
    event,
    {
      firstName: "Runner",
      lastName: email,
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
      // Required of a public entry since §171 — this fixture predates it.
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

async function codeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "no error";
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
}

/** The code and the boxes a refusal names, as the erase form's summary shows them (§315). */
async function refusalOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "no error";
  } catch (error) {
    if (isDomainError(error)) return `${error.code} ${error.fields.join(",")}`;
    throw error;
  }
}

const rowsFor = (eventId: string) =>
  db.select().from(registrations).where(eq(registrations.eventId, eventId));

describe("BR-REQ-037-06 an Administrator erases an event and everyone registered for it", () => {
  it("removes the event, its translations, every registration, every declaration and every address", async () => {
    const event = await seedEvent(10);
    const one = await registerPublicly(event, "one@example.ro");
    await registerPublicly(event, "two@example.ro");
    await signDeclaration(db, event, one.id, await signingInput(db, NOW, "Runner"), NOW);

    expect(
      await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, one.id)),
    ).toHaveLength(1);

    const result = await hardDeleteEvent(db, {
      actor: admin,
      eventId: event.id,
      typedTitle: TITLE_RO,
      reason: "eveniment creat din greșeală",
      now: NOW,
    });

    expect(result.registrationsErased).toBe(2);
    expect(await db.select().from(events).where(eq(events.id, event.id))).toHaveLength(0);
    // `event_translations` cascades; proving it here is what says the row really went.
    expect(
      await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, event.id)),
    ).toHaveLength(0);
    expect(await rowsFor(event.id)).toHaveLength(0);
    expect(
      await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, one.id)),
    ).toHaveLength(0);
    // The addresses, and every queued email that carried one, go with the participants.
    expect(await db.select().from(participants)).toHaveLength(0);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
  });

  it("accepts either language's title, because the organizer types the one on their screen", async () => {
    const event = await seedEvent(10);
    await registerPublicly(event, "en@example.ro");

    await hardDeleteEvent(db, {
      actor: admin,
      eventId: event.id,
      typedTitle: TITLE_EN,
      reason: "duplicate of another event",
      now: NOW,
    });

    expect(await db.select().from(events).where(eq(events.id, event.id))).toHaveLength(0);
  });

  it("refuses a title that is not the event's, and destroys nothing at all", async () => {
    const event = await seedEvent(10);
    const registration = await registerPublicly(event, "safe@example.ro");

    // Near misses, not nonsense: the whole point of the field is that half-remembering the
    // title is not enough. Case and whitespace are part of "exact"; the id is not a title.
    // Each refusal names the box it is about, so the summary links to the title (§315).
    for (const typed of ["crosul de toamnă", "Crosul de toamna", "Crosul", "", event.id]) {
      expect(
        await refusalOf(
          hardDeleteEvent(db, {
            actor: admin,
            eventId: event.id,
            typedTitle: typed,
            reason: "a plausible reason",
            now: NOW,
          }),
        ),
        `typed "${typed}"`,
      ).toBe("VALIDATION_ERROR typedTitle");
    }

    expect(await db.select().from(events).where(eq(events.id, event.id))).toHaveLength(1);
    expect(await rowsFor(event.id)).toHaveLength(1);
    expect((await rowsFor(event.id))[0].status).toBe(registration.status);
    expect(await db.select().from(participants)).toHaveLength(1);
    // Not even the audit row: a refusal is not an event that happened.
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses a missing reason, because the reason is the only thing that survives the erasure", async () => {
    const event = await seedEvent(10);
    await registerPublicly(event, "reason@example.ro");

    for (const reason of ["", "   ", "x"]) {
      expect(
        await refusalOf(
          hardDeleteEvent(db, { actor: admin, eventId: event.id, typedTitle: TITLE_RO, reason, now: NOW }),
        ),
        `reason "${reason}"`,
      ).toBe("VALIDATION_ERROR reason");
    }

    expect(await db.select().from(events).where(eq(events.id, event.id))).toHaveLength(1);
    expect(await rowsFor(event.id)).toHaveLength(1);
  });

  it("refuses every role below Administrator, and refuses on the role before anything else", async () => {
    const event = await seedEvent(10);
    await registerPublicly(event, "guarded@example.ro");

    for (const actor of [editor, dev]) {
      // With a *correct* title and a good reason, so the refusal can only be about the role
      // (BR-REQ-060-01: the screen is hidden from these roles as a courtesy; this is the guard).
      expect(
        await codeOf(
          hardDeleteEvent(db, {
            actor,
            eventId: event.id,
            typedTitle: TITLE_RO,
            reason: "I would like this gone",
            now: NOW,
          }),
        ),
        `role ${actor.role}`,
      ).toBe("FORBIDDEN");
    }

    expect(await db.select().from(events).where(eq(events.id, event.id))).toHaveLength(1);
    expect(await rowsFor(event.id)).toHaveLength(1);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses an unknown event rather than reporting a silent success", async () => {
    expect(
      await codeOf(
        hardDeleteEvent(db, {
          actor: admin,
          eventId: "00000000-0000-0000-0000-000000000000",
          typedTitle: TITLE_RO,
          reason: "nothing to erase",
          now: NOW,
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("leaves one audit row per person and one for the event, and not one of them says who", async () => {
    const event = await seedEvent(10);
    const one = await registerPublicly(event, "ana.pop@example.ro");
    const two = await registerPublicly(event, "ion.marin@example.ro");

    await hardDeleteEvent(db, {
      actor: admin,
      eventId: event.id,
      typedTitle: TITLE_RO,
      reason: "cererea proprietarului",
      now: NOW,
    });

    const trail = await db.select().from(auditLogs).orderBy(asc(auditLogs.id));

    const erasures = trail.filter((row) => row.action === "registration.deleted_by_staff");
    expect(erasures).toHaveLength(2);
    expect(erasures.map((row) => row.entityId).sort()).toEqual([one.id, two.id].sort());
    for (const row of erasures) {
      expect(row.actorStaffUserId).toBe(admin.id);
      // `participant_id` is ON DELETE SET NULL, and the participants are gone: the row says
      // that somebody was erased and never which somebody.
      expect(row.participantId).toBeNull();
    }

    const [forEvent] = trail.filter((row) => row.action === "event.hard_deleted");
    expect(forEvent).toBeDefined();
    expect(forEvent.entityId).toBe(event.id);
    expect(forEvent.actorStaffUserId).toBe(admin.id);
    // The event's own row is the one that may name a thing, because an event is not a person:
    // the title, the date and how many registrations went with it (criterion 5).
    expect(forEvent.metadataJson).toMatchObject({
      title: TITLE_RO,
      startsAt: event.startsAt.toISOString(),
      registrations: 2,
      confirmed: 0,
      real: 2,
      test: 0,
      reason: "cererea proprietarului",
    });

    // The whole trail, read as text: no name, no address, no identity document.
    const text = JSON.stringify(trail);
    for (const secret of ["ana.pop@example.ro", "ion.marin@example.ro", "Runner", "Contact Urgență", "+40711111111"]) {
      expect(text, `the audit trail must not contain ${secret}`).not.toContain(secret);
    }
  });

  it("leaves no place occupied: every registration goes out through the allocator", async () => {
    const event = await seedEvent(1);
    await registerPublicly(event, "holder@example.ro");
    const waiting = await registerPublicly(event, "waiting@example.ro");
    expect(waiting.status).toBe("WAITLISTED");
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);

    await hardDeleteEvent(db, {
      actor: admin,
      eventId: event.id,
      typedTitle: TITLE_RO,
      reason: "cursa nu mai are loc",
      now: NOW,
    });

    // Nothing is left holding the place, and nothing was left behind holding one either: the
    // count is over the rows, and there are none. A registration deleted straight out of the
    // table would satisfy the first half of that and not the second.
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(0);
    expect(await rowsFor(event.id)).toHaveLength(0);
    expect(await db.select().from(participants)).toHaveLength(0);
  });

  it("does not touch another event's registrations, or a participant who has one", async () => {
    const doomed = await seedEvent(10);
    const [other] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-11-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: 10 })
      .returning();
    const survivor: EventForRegistration = {
      id: other.id,
      eventStatus: other.eventStatus,
      registrationMode: "INTERNAL",
      startsAt: other.startsAt,
      registrationOpensAt: null,
      registrationClosesAt: null,
      capacity: 10,
      raceId: null,
      publishedAt: NOW,
    };

    await registerPublicly(doomed, "both@example.ro");
    await registerPublicly(survivor, "both@example.ro");

    await hardDeleteEvent(db, {
      actor: admin,
      eventId: doomed.id,
      typedTitle: TITLE_RO,
      reason: "wrong date, entered twice",
      now: NOW,
    });

    expect(await rowsFor(survivor.id)).toHaveLength(1);
    // The person still has a registration, so the person stays (`DECISIONS.md` §88).
    expect(await db.select().from(participants)).toHaveLength(1);
  });
});

describe("BR-REQ-037-06 the screen says what would be destroyed before anything is pressed", () => {
  it("counts the registrations, the confirmed ones, and the real people among them", async () => {
    const event = await seedEvent(10);
    const confirmed = await registerPublicly(event, "real@example.ro");
    await signDeclaration(db, event, confirmed.id, await signingInput(db, NOW, "Runner"), NOW);
    await addTestRegistrations(db, admin, { eventId: event.id, count: 2, locale: "ro", now: NOW });

    const plan = await readEventErasurePlan(db, event.id);

    expect(plan).toBeDefined();
    expect(plan?.titles).toEqual([
      { locale: "ro", title: TITLE_RO },
      { locale: "en", title: TITLE_EN },
    ]);
    expect(plan?.startsAt).toEqual(event.startsAt);
    expect(plan?.total).toBe(3);
    expect(plan?.confirmed).toBe(1);
    // The number that decides whether this is tidying up or destroying a season (§30).
    expect(plan?.real).toBe(1);
    expect(plan?.test).toBe(2);
  });

  it("says nothing at all about an event that does not exist", async () => {
    expect(await readEventErasurePlan(db, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });
});
