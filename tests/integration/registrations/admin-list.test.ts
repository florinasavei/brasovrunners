import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import {
  countRegistrationsForAdmin,
  listRegistrationsForAdmin,
} from "@/modules/registrations/admin-repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The backoffice list's own query: search by name, sort, and server-side pagination
 * (BR-REQ-041-01 criterion 7, BR-REQ-070-02).
 *
 * Rows are inserted directly rather than through `submitRegistration`, on purpose. What is
 * under test is the reading query — which rows come back, in what order, and how many — and
 * driving thirty of them through the allocator would be a slower test of the allocator instead.
 * Nothing here touches capacity, and nothing here may: §12.6.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;

/** Each participant needs a distinct canonical address; the name is not one, and may repeat. */
let participantCounter = 0;

async function addRegistration(
  name: string,
  overrides: { status?: RegistrationStatus; submittedAt?: Date } = {},
): Promise<void> {
  participantCounter += 1;
  const email = `participant-${participantCounter}@example.test`;
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: email,
      normalizedEmail: email,
      canonicalEmail: email,
      canonicalizationVersion: 1,
      defaultName: name,
    })
    .returning();

  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    status: overrides.status ?? "CONFIRMED",
    locale: "ro",
    registeredName: name,
    displayName: name,
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    submittedAt: overrides.submittedAt ?? NOW,
  });
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTables(db);
  const [event] = await db
    .insert(events)
    .values({
      kind: "COMMUNITY_RUN",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
    })
    .returning();
  eventId = event.id;
});

describe("search by name (BR-REQ-041-01 criterion 7)", () => {
  it("finds a participant by part of their name", async () => {
    await addRegistration("Ana Popescu");
    await addRegistration("Mihai Ionescu");

    const found = await listRegistrationsForAdmin(db, { search: "popescu" });

    expect(found.map((row) => row.registeredName)).toEqual(["Ana Popescu"]);
  });

  it("ignores case", async () => {
    await addRegistration("Ana Popescu");

    expect(await listRegistrationsForAdmin(db, { search: "ANA" })).toHaveLength(1);
  });

  it("finds a name written with diacritics when the organizer types it without", async () => {
    // Race morning: somebody says "Ștefan" out loud and an organizer types "stefan". Answering
    // "no results" there reads as "this person never registered", which is the worst possible
    // wrong answer at a start line.
    await addRegistration("Ștefan Țîrlea");

    expect(await listRegistrationsForAdmin(db, { search: "stefan" })).toHaveLength(1);
    expect(await listRegistrationsForAdmin(db, { search: "tirlea" })).toHaveLength(1);
  });

  it("finds a name written without diacritics when the organizer types them", async () => {
    await addRegistration("Stefan Tirlea");

    expect(await listRegistrationsForAdmin(db, { search: "ștefan" })).toHaveLength(1);
  });

  it("matches the cedilla spelling against the comma-below one", async () => {
    // `ş` and `ţ` are what older Romanian keyboard layouts still produce. A person who typed
    // one must be found by somebody typing the other.
    await addRegistration("Ştefan");

    expect(await listRegistrationsForAdmin(db, { search: "ștefan" })).toHaveLength(1);
  });

  it("treats a typed percent sign as a character, not as a wildcard", async () => {
    await addRegistration("Ana Popescu");

    expect(await listRegistrationsForAdmin(db, { search: "%" })).toHaveLength(0);
  });

  it("never searches the email address", async () => {
    // The address is the participant's identity, and a box anybody can type an address into is
    // a membership oracle. The name finds the row; the address is only shown once it has.
    await addRegistration("Ana Popescu");
    const [row] = await listRegistrationsForAdmin(db, {});

    expect(await listRegistrationsForAdmin(db, { search: row.participantEmail })).toHaveLength(0);
    expect(await listRegistrationsForAdmin(db, { search: "example.test" })).toHaveLength(0);
  });

  it("counts the same rows the list returns", async () => {
    await addRegistration("Ana Popescu");
    await addRegistration("Ana Marin");
    await addRegistration("Mihai Ionescu");

    expect(await countRegistrationsForAdmin(db, { search: "ana" })).toBe(2);
  });
});

describe("pagination (BR-REQ-070-02)", () => {
  beforeEach(async () => {
    for (let index = 0; index < 30; index += 1) {
      await addRegistration(`Runner ${String(index).padStart(2, "0")}`, {
        submittedAt: new Date(NOW.getTime() + index * 1000),
      });
    }
  });

  it("returns only the page asked for", async () => {
    const page = await listRegistrationsForAdmin(db, {}, { limit: 10, offset: 0, sort: "name", dir: "asc" });

    expect(page).toHaveLength(10);
    expect(page[0].registeredName).toBe("Runner 00");
  });

  it("counts every matching row, not the page", async () => {
    expect(await countRegistrationsForAdmin(db, {})).toBe(30);
  });

  it("walks the pages without repeating or losing a row", async () => {
    const seen: string[] = [];
    for (let page = 0; page < 3; page += 1) {
      const rows = await listRegistrationsForAdmin(
        db,
        {},
        { limit: 10, offset: page * 10, sort: "status", dir: "asc" },
      );
      seen.push(...rows.map((row) => row.registeredName));
    }

    // Every row exactly once. Sorting by a column where all thirty rows tie is the case that
    // catches a missing tie-break: without a total order PostgreSQL may return a row on two
    // pages and another on none, purely from paging.
    expect(new Set(seen).size).toBe(30);
    expect(seen).toHaveLength(30);
  });

  it("gives the whole filtered set when no page is asked for, which is what the export needs", async () => {
    expect(await listRegistrationsForAdmin(db, {})).toHaveLength(30);
  });
});

describe("sorting", () => {
  beforeEach(async () => {
    await addRegistration("Zamfir", { submittedAt: new Date(NOW.getTime() + 1000) });
    await addRegistration("Andrei", { submittedAt: new Date(NOW.getTime() + 3000) });
    await addRegistration("Mircea", { submittedAt: new Date(NOW.getTime() + 2000) });
  });

  it("orders by name in both directions", async () => {
    const ascending = await listRegistrationsForAdmin(db, {}, { limit: 10, offset: 0, sort: "name", dir: "asc" });
    const descending = await listRegistrationsForAdmin(db, {}, { limit: 10, offset: 0, sort: "name", dir: "desc" });

    expect(ascending.map((row) => row.registeredName)).toEqual(["Andrei", "Mircea", "Zamfir"]);
    expect(descending.map((row) => row.registeredName)).toEqual(["Zamfir", "Mircea", "Andrei"]);
  });

  it("orders by when it was submitted", async () => {
    const rows = await listRegistrationsForAdmin(db, {}, { limit: 10, offset: 0, sort: "submitted", dir: "desc" });

    expect(rows.map((row) => row.registeredName)).toEqual(["Andrei", "Mircea", "Zamfir"]);
  });

  it("still defaults to newest first when no page is asked for", async () => {
    const rows = await listRegistrationsForAdmin(db, {});

    expect(rows.map((row) => row.registeredName)).toEqual(["Andrei", "Mircea", "Zamfir"]);
  });
});

describe("filters and search compose", () => {
  it("narrows by status and name together", async () => {
    await addRegistration("Ana Popescu", { status: "CONFIRMED" });
    await addRegistration("Ana Marin", { status: "CANCELLED" });

    const rows = await listRegistrationsForAdmin(db, { search: "ana", status: "CONFIRMED" });

    expect(rows.map((row) => row.registeredName)).toEqual(["Ana Popescu"]);
    expect(await countRegistrationsForAdmin(db, { search: "ana", status: "CONFIRMED" })).toBe(1);
  });
});
