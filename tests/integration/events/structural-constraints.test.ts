import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-034-01 / BR-REQ-034-02 — capacity is a real, storable value.
 *
 * The pilot guard that once made any capacity value physically impossible
 * (`events_capacity_must_be_null_during_pilot`) is gone: `modules/registrations/service.ts`'s
 * locked capacity transaction exists and `tests/concurrency/capacity.test.ts` proves it holds
 * under real concurrent load, which is what WEEKEND.md and CLAUDE.md named as the condition
 * for removing it. An uncapped event — `capacity IS NULL` — is still a supported, ordinary
 * case (AGENTS.md §10.1: "absent capacity means unlimited"), not a constraint-enforced one.
 *
 * Note the `registrationMode: "INTERNAL"` in every case. Capacity on a NONE-mode event is
 * refused by a *different* constraint (below), so without it these tests would prove nothing
 * about capacity itself.
 */
describe("BR-REQ-034-01 capacity is a real, internal-only value", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  const internalEvent = {
    kind: "COMMUNITY_RUN" as const,
    startsAt: new Date("2026-10-04T07:00:00Z"),
    registrationMode: "INTERNAL" as const,
  };

  it("accepts an uncapped event — absent capacity means unlimited", async () => {
    const [row] = await db.insert(events).values(internalEvent).returning();
    expect(row.capacity).toBeNull();
  });

  it.each([1, 30, 1000])("accepts and stores capacity %i on an internal event", async (capacity) => {
    const [row] = await db.insert(events).values({ ...internalEvent, capacity }).returning();
    expect(row.capacity).toBe(capacity);
  });

  /**
   * AGENTS.md §12.3 lists "positive capacity" among the checks, and it could not be written
   * while the pilot guard forced the column to stay NULL. It matters now that an organizer
   * types the number into a form: capacity 0 would read as "unlimited is off, and nobody may
   * enter", which is what `registration_mode = NONE` already says honestly.
   */
  it.each([0, -1])("refuses capacity %i, which is not a number of places", async (capacity) => {
    await expectViolation(db.insert(events).values({ ...internalEvent, capacity }), {
      code: SQLSTATE.CHECK_VIOLATION,
      constraint: "events_capacity_positive",
    });
  });

  it("accepts a capacity added by a later update, not only at insert", async () => {
    const [row] = await db.insert(events).values(internalEvent).returning();
    const [updated] = await db
      .update(events)
      .set({ capacity: 30 })
      .where(eq(events.id, row.id))
      .returning();
    expect(updated.capacity).toBe(30);
  });
});

/** BR-REQ-030-01 criterion 4 — capacity and declarations are internal-registration only. */
describe("BR-REQ-030-01 registration mode constraints", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  const base = {
    kind: "COMMUNITY_RUN" as const,
    startsAt: new Date("2026-10-04T07:00:00Z"),
  };

  it("refuses a declaration on an event that takes no registrations", async () => {
    await expectViolation(
      db.insert(events).values({
        ...base,
        registrationMode: "NONE",
        declarationDocumentId: "00000000-0000-0000-0000-000000000001",
      }),
      {
        code: SQLSTATE.CHECK_VIOLATION,
        constraint: "events_capacity_and_declaration_are_internal_only",
      },
    );
  });

  it("refuses an external registration URL that is not HTTPS", async () => {
    await expectViolation(
      db.insert(events).values({
        ...base,
        registrationMode: "EXTERNAL",
        externalRegistrationUrl: "http://insecure.example.test/signup",
      }),
      {
        code: SQLSTATE.CHECK_VIOLATION,
        constraint: "events_external_fields_external_only",
      },
    );
  });

  it("refuses external fields on a non-external event", async () => {
    await expectViolation(
      db.insert(events).values({
        ...base,
        registrationMode: "NONE",
        externalRegistrationUrl: "https://provider.example.test/signup",
      }),
      {
        code: SQLSTATE.CHECK_VIOLATION,
        constraint: "events_external_fields_external_only",
      },
    );
  });

  it("accepts a well-formed external event", async () => {
    const [row] = await db
      .insert(events)
      .values({
        ...base,
        registrationMode: "EXTERNAL",
        externalProvider: "Example Timing",
        externalRegistrationUrl: "https://provider.example.test/signup",
      })
      .returning();
    expect(row.registrationMode).toBe("EXTERNAL");
  });
});

/** Structural rules from AGENTS.md §12.3 that are cheap now and expensive to retrofit. */
describe("event structural constraints", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  const base = {
    kind: "COMMUNITY_RUN" as const,
    startsAt: new Date("2026-10-04T07:00:00Z"),
  };

  it("refuses an end before its start", async () => {
    await expectViolation(
      db.insert(events).values({ ...base, endsAt: new Date("2026-10-04T06:00:00Z") }),
      { code: SQLSTATE.CHECK_VIOLATION, constraint: "events_end_after_start" },
    );
  });

  it("refuses a negative distance", async () => {
    await expectViolation(db.insert(events).values({ ...base, distanceMeters: -1 }), {
      code: SQLSTATE.CHECK_VIOLATION,
      constraint: "events_non_negative_measurements",
    });
  });

  it("refuses a race_id on an event that is not a RACE", async () => {
    await expectViolation(
      db.insert(events).values({
        ...base,
        kind: "MEETUP",
        raceId: "00000000-0000-0000-0000-000000000001",
      }),
      { code: SQLSTATE.CHECK_VIOLATION, constraint: "events_race_id_implies_race_kind" },
    );
  });

  it("defaults the timezone to Europe/Bucharest", async () => {
    const [row] = await db.insert(events).values(base).returning();
    expect(row.timezone).toBe("Europe/Bucharest");
  });
});

/** BR-REQ-010-01 criterion 3 — an unsupported kind is rejected by the database itself. */
describe("BR-REQ-010-01 event kinds", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  it("refuses a kind outside the documented set", async () => {
    await expectViolation(
      db.insert(events).values({
        // Deliberately invalid: the enum is the guard, not application validation alone.
        kind: "PUB_QUIZ" as never,
        startsAt: new Date("2026-10-04T07:00:00Z"),
      }),
      { code: SQLSTATE.INVALID_ENUM_INPUT },
    );
  });
});
