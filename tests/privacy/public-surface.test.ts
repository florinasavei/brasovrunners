import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { listPublicStartList } from "@/modules/registrations/repository";
import { expectViolation, SQLSTATE } from "../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../helpers/db";

/**
 * BR-REQ-039-01 — the public start list, and the four things it must never contain.
 * BR-REQ-070-01 — no participant email reaches a public surface.
 * BR-REQ-034-01 — a public page reads derived availability, never the raw capacity.
 *
 * This file is a boundary test, not a feature test: it asks what the *public* queries can
 * return, so that a later join, a widened select list or a helpful new column cannot quietly
 * start publishing something nobody decided to publish. It may be extended. It must not be
 * weakened — every assertion here is a disclosure that was deliberately refused.
 */
const NOW = new Date("2026-09-05T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await resetTables(db);
});

async function createEvent(overrides: Partial<typeof events.$inferInsert> = {}) {
  const [event] = await db
    .insert(events)
    .values({
      kind: "COMMUNITY_RUN",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      ...overrides,
    })
    .returning();
  return event;
}

/**
 * A registration written straight to the table.
 *
 * The lifecycle is proved elsewhere; what is under test here is what a *read* exposes, and
 * inserting the end state directly is what lets one test hold a confirmed row, a test row, an
 * opted-out row and an unconfirmed one side by side.
 */
async function createRegistration(
  eventId: string,
  input: {
    name: string;
    email: string;
    status?: typeof registrations.$inferInsert.status;
    kind?: "REAL" | "TEST";
    listOptOut?: boolean;
    confirmedAt?: Date;
  },
) {
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: input.email,
      normalizedEmail: input.email.toLowerCase(),
      canonicalEmail: input.email.toLowerCase(),
      canonicalizationVersion: 1,
      defaultName: input.name,
      preferredLocale: "ro",
    })
    .returning();

  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    status: input.status ?? "CONFIRMED",
    kind: input.kind ?? "REAL",
    locale: "ro",
    registeredName: input.name,
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    listOptOut: input.listOptOut ?? false,
    confirmedAt: input.confirmedAt ?? NOW,
  });
}

describe("BR-REQ-039-01 the start list is off until somebody turns it on", () => {
  it("defaults every event to HIDDEN", async () => {
    const event = await createEvent();
    expect(event.participantListVisibility).toBe("HIDDEN");
  });

  it("refuses NAMES for an event this platform does not register", async () => {
    // No participants exist to list for a NONE event, and for EXTERNAL the people who entered
    // are the other organizer's. The database refuses it, not only the service.
    await expectViolation(
      createEvent({ registrationMode: "NONE", participantListVisibility: "NAMES" }),
      { code: SQLSTATE.CHECK_VIOLATION, constraint: "events_participant_list_internal_only" },
    );
  });
});

describe("BR-REQ-039-01 what the start list may contain", () => {
  it("lists only confirmed participants who did not opt out, in confirmation order", async () => {
    const event = await createEvent();
    await createRegistration(event.id, {
      name: "Ana Popescu",
      email: "ana@example.org",
      confirmedAt: new Date("2026-09-02T08:00:00.000Z"),
    });
    await createRegistration(event.id, {
      name: "Bogdan Ionescu",
      email: "bogdan@example.org",
      confirmedAt: new Date("2026-09-01T08:00:00.000Z"),
    });

    // Everything below must be absent, each for its own reason.
    await createRegistration(event.id, {
      name: "Nu Vreau",
      email: "optout@example.org",
      listOptOut: true,
    });
    await createRegistration(event.id, {
      name: "Test Runner",
      email: "queue-demo@test.invalid",
      kind: "TEST",
    });
    await createRegistration(event.id, {
      name: "Inca Nu",
      email: "pending@example.org",
      status: "PENDING_DECLARATION",
      confirmedAt: undefined,
    });
    await createRegistration(event.id, {
      name: "Pe Lista",
      email: "waiting@example.org",
      status: "WAITLISTED",
    });
    await createRegistration(event.id, {
      name: "S-a Retras",
      email: "cancelled@example.org",
      status: "CANCELLED",
    });

    const listed = await listPublicStartList(db, event.id);

    // Bogdan confirmed first, so Bogdan is first — the order is a fact about the people, not
    // about insertion.
    expect(listed.map((row) => row.registeredName)).toEqual(["Bogdan Ionescu", "Ana Popescu"]);
  });

  it("returns the name and nothing else — no email, no status, no identifier", async () => {
    const event = await createEvent();
    await createRegistration(event.id, { name: "Ana Popescu", email: "ana@example.org" });

    const [row] = await listPublicStartList(db, event.id);

    // The select list is the guarantee. A future join that widened it would fail here rather
    // than on the day somebody's address appeared on a race page.
    expect(Object.keys(row)).toEqual(["registeredName"]);
    expect(JSON.stringify(row)).not.toContain("@");
  });

  it("does not list a TEST registration even when it is the only confirmed one", async () => {
    // AGENTS.md §12.6: a synthetic row occupies a place like anybody else, and appears on no
    // page a person reads.
    const event = await createEvent();
    await createRegistration(event.id, {
      name: "Test Runner",
      email: "queue-demo@test.invalid",
      kind: "TEST",
    });

    expect(await listPublicStartList(db, event.id)).toEqual([]);
  });
});

describe("BR-REQ-070-01 the public event query", () => {
  it("carries no email, no capacity and no declaration identifier", async () => {
    const event = await createEvent({ editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 20 });
    await db.insert(eventTranslations).values({
      eventId: event.id,
      locale: "ro",
      slug: "alergare",
      title: "Alergare",
      locationName: "Parc",
    });
    await createRegistration(event.id, { name: "Ana Popescu", email: "ana@example.org" });

    const row = await findPublishedEventBySlug(db, "ro", "alergare");

    expect(row).toBeDefined();
    const keys = Object.keys(row as object);
    // Capacity is deliberately absent: a public page reads the derived availability
    // (BR-REQ-034-01), never the raw number, and there is no column here to leak it from.
    expect(keys).not.toContain("capacity");
    expect(keys).not.toContain("declarationDocumentId");
    expect(keys.filter((key) => /email/i.test(key))).toEqual([]);
    expect(JSON.stringify(row)).not.toContain("@");
  });
});
