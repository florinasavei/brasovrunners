import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { cancelRegistrationByStaff, createRegistrationByStaff } from "@/modules/registrations/admin-service";
import { UNDER_MINIMUM_AGE } from "@/modules/registrations/fields";
import { confirmEmail, type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — a participant is at least fourteen on the day of the event.
 *
 * The owner, 2026-09-23: "Min age must be 14". Every door a registration can come through is
 * tried here — the public form, a staff entry and the desk's walk-in, a TEST row, a restart of a
 * cancelled registration — because the rule sits in `submitRegistration`, the one door they all
 * share, and a rule proven on one caller is a rule the next caller can walk round.
 *
 * The race is on 21 November 2026 in Brașov. Somebody born on 21 November 2012 is fourteen that
 * morning and may enter; somebody born the day after is thirteen and may not. The guardian rule
 * is untouched (§108): fourteen to seventeen still register through a parent.
 */
const NOW = new Date("2026-09-23T10:00:00.000Z");
const RACE_START = new Date("2026-11-21T07:00:00.000Z"); // 09:00 in Brașov
const FOURTEEN_ON_RACE_DAY = "2012-11-21";
const FOURTEEN_THE_DAY_AFTER = "2012-11-22";

let db: TestDatabase;
let close: () => Promise<void>;
let volunteer: StaffUser;
let admin: StaffUser;

/*
  The staff form's action, for the one thing only the action decides: what the refusal says.
  Getters, resolved when the action calls them (`signature-name.test.ts` does the same): the
  database under test, and the Voluntar at the desk as the signed-in staff member.
*/
vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => volunteer,
  requireStaffRole: async () => admin,
}));

const { createRegistrationAction } = await import("@/app/[locale]/admin/registrations/actions");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

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
  [volunteer] = await db
    .insert(staffUsers)
    // The Voluntar (§103): the desk only, which is exactly who enters a walk-in on race morning.
    .values({ email: "voluntar@dev.test", displayName: "Voluntar", role: "CONTRIBUTOR" })
    .returning();
  [admin] = await db
    .insert(staffUsers)
    .values({ email: "superadmin@dev.test", displayName: "Admin", role: "ADMIN" })
    .returning();
});

async function createRace(startsAt = RACE_START, timezone = "Europe/Bucharest"): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt, timezone, registrationMode: "INTERNAL", capacity: 50 })
    .returning();
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity: event.capacity,
    raceId: null,
    publishedAt: NOW,
    timezone: event.timezone,
  };
}

const submission = (overrides: Record<string, unknown> = {}) => ({
  firstName: "Maria",
  lastName: "Popescu",
  birthDate: FOURTEEN_THE_DAY_AFTER,
  sex: "FEMALE",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Popescu",
  emergencyContactPhone: "+40722222222",
  guardianName: "Ion Popescu",
  email: "maria@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
  ...overrides,
});

/** The refusal's code and the names it carries back to the form, or null when nothing refused. */
async function refusal(promise: Promise<unknown>): Promise<{ code: string; fields: string[] } | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return { code: error.code, fields: [...error.fields] };
  }
}

async function nothingWritten() {
  expect(await db.select().from(registrations)).toHaveLength(0);
  expect(await db.select().from(participants)).toHaveLength(0);
  expect(await db.select().from(emailOutbox)).toHaveLength(0);
  // Refused before the throttle, so a mistyped year does not spend one of five attempts.
  expect(await db.select().from(rateLimitBuckets)).toHaveLength(0);
}

describe("§NNN the public form", () => {
  it("refuses somebody who is thirteen on the race day, names the birth date, and writes nothing", async () => {
    const event = await createRace();
    const refused = await refusal(submitRegistration(db, event, submission(), NOW));
    expect(refused?.code).toBe("VALIDATION_ERROR");
    // The field, so the summary links to it, and the marker, so it says which rule (§231's shape).
    expect(refused?.fields).toEqual(["birthDate", UNDER_MINIMUM_AGE]);
    await nothingWritten();
  });

  it("names every other field at once, rather than the age first and the rest a round trip later", async () => {
    const event = await createRace();
    const refused = await refusal(submitRegistration(db, event, submission({ city: "" }), NOW));
    expect(refused?.fields).toEqual(expect.arrayContaining(["city", "birthDate", UNDER_MINIMUM_AGE]));
    await nothingWritten();
  });

  it("accepts somebody whose fourteenth birthday is the race day — still through a parent", async () => {
    const event = await createRace();
    expect(await refusal(submitRegistration(db, event, submission({ birthDate: FOURTEEN_ON_RACE_DAY }), NOW))).toBeNull();
    const [row] = await db.select().from(registrations);
    expect(row.birthDate).toBe(FOURTEEN_ON_RACE_DAY);
    expect(row.guardianName).toBe("Ion Popescu");
  });

  it("keeps the guardian rule as it was: fourteen to seventeen without a parent is refused for the parent", async () => {
    const event = await createRace();
    const refused = await refusal(
      submitRegistration(db, event, submission({ birthDate: "2011-05-17", guardianName: undefined }), NOW),
    );
    expect(refused?.fields).toEqual(["guardianName"]);
  });

  it("counts the day in the race's own zone, not in UTC", async () => {
    // 00:30 in Brașov on 21 November is 22:30 UTC on the 20th. On the start line it is the 21st,
    // the fourteenth birthday, so the entry stands — by the UTC date it would have been refused.
    const midnightRace = await createRace(new Date("2026-11-20T22:30:00.000Z"));
    expect(
      await refusal(submitRegistration(db, midnightRace, submission({ birthDate: FOURTEEN_ON_RACE_DAY }), NOW)),
    ).toBeNull();

    // The same instant read in UTC is the 20th, and then the same child is thirteen.
    const utcRace = await createRace(new Date("2026-11-20T22:30:00.000Z"), "UTC");
    const refused = await refusal(
      submitRegistration(db, utcRace, submission({ birthDate: FOURTEEN_ON_RACE_DAY, email: "alta@example.ro" }), NOW),
    );
    expect(refused?.fields).toEqual(["birthDate", UNDER_MINIMUM_AGE]);
  });
});

describe("§NNN a TEST registration is refused exactly like a real one (AGENTS.md §12.6)", () => {
  it("refuses a thirteen-year-old TEST row and writes nothing", async () => {
    const event = await createRace();
    const refused = await refusal(submitRegistration(db, event, submission(), NOW, "TEST"));
    expect(refused).toEqual({ code: "VALIDATION_ERROR", fields: ["birthDate", UNDER_MINIMUM_AGE] });
    await nothingWritten();
  });
});

describe("§NNN a staff entry and the desk's walk-in", () => {
  const staffEntry = (event: EventForRegistration, birthDate: string | undefined, fastTrack = false) => ({
    eventId: event.id,
    firstName: "Andrei",
    lastName: "Ionescu",
    details: birthDate ? { birthDate } : {},
    email: `andrei-${birthDate ?? "none"}-${fastTrack}@example.ro`,
    locale: "ro" as const,
    listOptOut: true,
    relayedByParticipantRequest: true,
    fastTrack,
  });

  it("refuses a birth date under fourteen on the race day, at the desk as on the telephone", async () => {
    const event = await createRace();
    for (const fastTrack of [false, true]) {
      const refused = await refusal(
        createRegistrationByStaff(db, volunteer, staffEntry(event, FOURTEEN_THE_DAY_AFTER, fastTrack), NOW),
      );
      // The marker is what the backoffice turns into its own sentence (`UNDER_MINIMUM_AGE`).
      expect(refused?.code).toBe("VALIDATION_ERROR");
      expect(refused?.fields).toContain(UNDER_MINIMUM_AGE);
    }
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("does not refuse fourteen on the race day for age", async () => {
    const event = await createRace();
    /*
      Not accepted outright, and not because of this rule: the staff schema carries the guardian
      rule of §108 too, and the staff form has no field for the parent's name — so any minor
      entered *with* a birth date is refused for `guardianName`, as it was before this change.
      That is reported to the owner rather than changed here. What this proves is that the age
      rule itself lets the fourteenth birthday through, and an adult's entry goes all the way.
    */
    const refused = await refusal(createRegistrationByStaff(db, volunteer, staffEntry(event, FOURTEEN_ON_RACE_DAY, true), NOW));
    expect(refused?.fields ?? []).not.toContain(UNDER_MINIMUM_AGE);
    expect(await refusal(createRegistrationByStaff(db, volunteer, staffEntry(event, "1990-05-17", true), NOW))).toBeNull();
    const [row] = await db.select().from(registrations);
    expect(row.birthDate).toBe("1990-05-17");
  });

  it("accepts an entry that gives no birth date: nothing to count, and BR-REQ-031-04 criterion 5 stands", async () => {
    const event = await createRace();
    expect(await refusal(createRegistrationByStaff(db, volunteer, staffEntry(event, undefined), NOW))).toBeNull();
    const [row] = await db.select().from(registrations);
    expect(row.birthDate).toBeNull();
  });

  it("comes back to the staff form with the rule's own sentence, the birth date named, and every box kept", async () => {
    /*
      The form keeps what was typed (§315) through `refused`, which carries the service's code
      and field names as they are — so without the action's own mapping the volunteer would read
      the generic VALIDATION_ERROR, and the summary would list the rule's marker as if it were a
      box, under its raw name. The sentence is `Admin.errors.UNDER_MINIMUM_AGE`; the marker is
      not a box, so it is not a link.
    */
    const event = await createRace();
    const form = new FormData();
    for (const [name, value] of Object.entries({
      uiLocale: "ro",
      back: "desk",
      eventId: event.id,
      firstName: "Andrei",
      lastName: "Ionescu",
      birthDate: FOURTEEN_THE_DAY_AFTER,
      city: "Brașov",
      email: "andrei@example.ro",
      participantLocale: "ro",
      relayedByParticipantRequest: "on",
    })) {
      form.set(name, value);
    }

    const outcome = await createRegistrationAction(null, form);

    expect(outcome?.error).toBe("UNDER_MINIMUM_AGE");
    expect(outcome?.fields).toContain("birthDate");
    expect(outcome?.fields).not.toContain(UNDER_MINIMUM_AGE);
    // `guardianName` is named as well today — §108's rule, and a box the staff form does not
    // have (see "does not refuse fourteen" above); `toContain`, so the follow-up that settles
    // it does not have to rewrite this.
    expect(outcome?.values).toMatchObject({
      eventId: [event.id],
      firstName: ["Andrei"],
      birthDate: [FOURTEEN_THE_DAY_AFTER],
      city: ["Brașov"],
      email: ["andrei@example.ro"],
    });
    expect(await db.select().from(registrations)).toHaveLength(0);
  });
});

describe("§NNN a restart of a cancelled registration", () => {
  it("is refused under fourteen, and the cancelled row keeps what it had", async () => {
    const event = await createRace();
    await submitRegistration(db, event, submission({ birthDate: "1990-05-17", guardianName: undefined }), NOW);
    const [first] = await db.select().from(registrations);
    // A pending email confirmation expires rather than being cancelled; one step on, it can be.
    await confirmEmail(db, event, first.id, NOW);
    await cancelRegistrationByStaff(db, admin, first.id, "a doua încercare", NOW);

    // The same address, back with a child's birth date: the one door is the same door.
    const later = new Date(NOW.getTime() + 60_000);
    const refused = await refusal(
      submitRegistration(db, event, submission({ renderedAt: new Date(later.getTime() - 10_000).toISOString() }), later),
    );
    expect(refused?.fields).toEqual(["birthDate", UNDER_MINIMUM_AGE]);

    const [after] = await db.select().from(registrations).where(eq(registrations.id, first.id));
    expect(after.status).toBe("CANCELLED");
    expect(after.birthDate).toBe("1990-05-17");
  });
});
