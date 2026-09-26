import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import {
  confirmRegistrationByStaff,
  createRegistrationByStaff,
  handedBibRefusalCode,
  setBibNumberByStaff,
} from "@/modules/registrations/admin-service";
import {
  assignBibNumbers,
  bibNumberInUse,
  countBibs,
  freeSpareBibNumbers,
  listBibs,
  nextSpareBibNumbers,
  settleBibNumbers,
  suggestFreeBibNumbers,
} from "@/modules/registrations/bibs";
import { confirmEmail, type EventForRegistration } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — spare bibs for on-the-spot entries: a band of numbers the club prints ahead with an empty
 * name line, which the allocator never hands to anybody who registered online, and which the desk
 * hands to a walk-in — suggested, the next free one.
 *
 * The property that carries the weight is the first block: every automatic draw — the provisional
 * number at submission, the recompaction at the close, a confirmation after it, the batch — steps
 * over the band. The second block is the desk: a spare handed with the paper is the runner's
 * settled number at once, marked printed, and refused when somebody else has it.
 */
const NOW = new Date("2026-09-05T10:00:00.000Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

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
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  [volunteer] = await db
    .insert(staffUsers)
    .values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" })
    .returning();
});

async function createRace(
  options: { capacity?: number | null; closed?: boolean; spare?: [number, number] | null; start?: number } = {},
): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity: options.capacity === undefined ? 50 : options.capacity,
      bibStartNumber: options.start ?? 1,
      bibSpareFrom: options.spare === null ? null : (options.spare?.[0] ?? 3),
      bibSpareTo: options.spare === null ? null : (options.spare?.[1] ?? 5),
      registrationClosesAt: options.closed ? new Date("2026-09-01T00:00:00.000Z") : null,
    })
    .returning();
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: null,
    registrationClosesAt: event.registrationClosesAt,
    capacity: event.capacity,
    raceId: null,
    publishedAt: NOW,
  };
}

async function enter(
  event: EventForRegistration,
  email: string,
  options: { fastTrack?: boolean; bibNumber?: number; at?: Date } = {},
) {
  await createRegistrationByStaff(
    db,
    volunteer,
    {
      eventId: event.id,
      firstName: "Desk",
      lastName: email,
      email,
      locale: "ro",
      listOptOut: false,
      relayedByParticipantRequest: true,
      fastTrack: options.fastTrack,
      bibNumber: options.bibNumber,
    },
    options.at ?? NOW,
  );
  return rowOf(email);
}

async function rowOf(email: string) {
  const [participant] = await db.select().from(participants).where(eq(participants.canonicalEmail, email.toLowerCase()));
  const [registration] = await db.select().from(registrations).where(eq(registrations.participantId, participant.id));
  return registration;
}

async function refusalOf(operation: Promise<unknown>): Promise<{ code: string; fields: string[] } | "no error"> {
  try {
    await operation;
    return "no error";
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, fields: [...error.fields] };
    throw error;
  }
}

describe("§NNN BR-REQ-038-01 the allocator never draws a desk spare", () => {
  it("steps over the band for the provisional number drawn at submission", async () => {
    const event = await createRace({ spare: [3, 5] });
    const a = await enter(event, "a@example.org");
    const b = await enter(event, "b@example.org", { at: later(1) });
    const c = await enter(event, "c@example.org", { at: later(2) });
    expect([a.provisionalBibNumber, b.provisionalBibNumber, c.provisionalBibNumber]).toEqual([1, 2, 6]);
  });

  it("closes the settled sequence around the band, as around a number typed by hand (§214)", async () => {
    const event = await createRace({ spare: [2, 3] });
    const ids: string[] = [];
    for (const [index, email] of ["a@example.org", "b@example.org", "c@example.org"].entries()) {
      const row = await enter(event, email, { at: later(index) });
      await confirmEmail(db, event, row.id, later(index));
      ids.push(row.id);
    }
    const settled = await db.transaction((tx) =>
      settleBibNumbers(tx, { eventId: event.id, bibStartNumber: 1, bibsSettledAt: null, now: later(10) }),
    );
    expect(settled.map((row) => row.bibNumber)).toEqual([1, 4, 5]);
  });

  it("draws a number after the close past the band when the desk hands none, and never adopts a provisional spare", async () => {
    const event = await createRace({ spare: [1, 3] });
    // Registered online before the close, holding a provisional number inside the band — as if
    // drawn before the club set it.
    const late = await enter(event, "late@example.org");
    expect(late.provisionalBibNumber).toBe(4);
    await db.update(registrations).set({ provisionalBibNumber: 2 }).where(eq(registrations.id, late.id));
    // The window shuts; confirmations draw final numbers now (§214).
    await db.update(events).set({ registrationClosesAt: new Date("2026-09-01T00:00:00.000Z") }).where(eq(events.id, event.id));

    // A walk-in confirmed with no number handed: the draw's own, past the spares.
    const walkIn = await enter(event, "walkin@example.org", { fastTrack: true, at: later(1) });
    expect(walkIn.status).toBe("CONFIRMED");
    expect(walkIn.bibNumber).toBe(4);

    // And the provisional spare is not adopted.
    const confirmed = await confirmRegistrationByStaff(db, volunteer, late.id, later(2));
    expect(confirmed.bibNumber).toBe(5);
    expect(confirmed.provisionalBibNumber).toBeNull();
  });

  it("does not keep a provisional spare in the batch, nor suggest a spare as a preferential number", async () => {
    const event = await createRace({ spare: [2, 4] });
    const a = await enter(event, "a@example.org", { fastTrack: true });
    expect(a.provisionalBibNumber).toBe(1);
    // As if the band had been set after this runner drew 3.
    await db.update(registrations).set({ provisionalBibNumber: 3 }).where(eq(registrations.id, a.id));
    await assignBibNumbers(db, { actor: admin, eventId: event.id, now: later(1) });
    const [numbered] = await db.select().from(registrations).where(eq(registrations.id, a.id));
    expect(numbered.bibNumber).toBe(1);

    expect(await suggestFreeBibNumbers(db, event.id, undefined, 3)).toEqual([5, 6, 7]);
  });
});

describe("§NNN BR-REQ-037-07 the desk hands a spare", () => {
  it("suggests the lowest free spare, and none where the club set no band", async () => {
    const event = await createRace({ spare: [900, 902] });
    const plain = await createRace({ spare: null });
    expect(await nextSpareBibNumbers(db, [event.id, plain.id])).toEqual({ [event.id]: 900, [plain.id]: null });
    expect(await freeSpareBibNumbers(db, plain.id)).toEqual({ band: null, free: [] });
  });

  it("gives a walk-in the spare handed with the paper: settled at once, marked printed, audited, and the next one suggested", async () => {
    const event = await createRace({ spare: [900, 902] });
    const walkIn = await enter(event, "walkin@example.org", { fastTrack: true, bibNumber: 900 });

    expect(walkIn.status).toBe("CONFIRMED");
    // Settled although the window is open: the bib is already in the runner's hand.
    expect(walkIn.bibNumber).toBe(900);
    expect(walkIn.provisionalBibNumber).toBeNull();
    // On paper already, so the next "unprinted" sheet does not print a second 900 with the name.
    expect(walkIn.bibPrintedAt).toEqual(NOW);
    expect(await listBibs(db, event.id, { only: "unprinted" })).toEqual([]);
    expect(await countBibs(db, event.id)).toEqual({ total: 1, unprinted: 0 });

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.confirmed_by_staff"));
    expect(audit.metadataJson).toMatchObject({ to: "CONFIRMED", bibNumber: 900 });

    expect(await freeSpareBibNumbers(db, event.id)).toEqual({ band: { from: 900, to: 902 }, free: [901, 902] });
    expect(await nextSpareBibNumbers(db, [event.id])).toEqual({ [event.id]: 901 });
  });

  it("refuses a spare somebody already has before anything is written, and a number without the fast track", async () => {
    const event = await createRace({ spare: [900, 902] });
    await enter(event, "first@example.org", { fastTrack: true, bibNumber: 900 });

    const taken = createRegistrationByStaff(
      db,
      volunteer,
      { eventId: event.id, firstName: "Second", lastName: "Walk", email: "second@example.org", locale: "ro", listOptOut: false, relayedByParticipantRequest: true, fastTrack: true, bibNumber: 900 },
      later(1),
    );
    expect(await refusalOf(taken)).toEqual({ code: "CONFLICT", fields: ["bibNumber"] });
    const [{ count }] = await db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(registrations);
    expect(count).toBe(1);

    const unticked = createRegistrationByStaff(
      db,
      volunteer,
      { eventId: event.id, firstName: "Phone", lastName: "Call", email: "phone@example.org", locale: "ro", listOptOut: false, relayedByParticipantRequest: true, fastTrack: false, bibNumber: 901 },
      later(2),
    );
    expect(await refusalOf(unticked)).toEqual({ code: "VALIDATION_ERROR", fields: ["bibNumber", "fastTrack"] });
  });

  it("names the refusal for the desk, and tells an entry left unconfirmed apart", async () => {
    const event = await createRace({ spare: [900, 902] });
    await enter(event, "first@example.org", { fastTrack: true, bibNumber: 900 });
    let caught: unknown;
    try {
      await enter(event, "second@example.org", { fastTrack: true, bibNumber: 900, at: later(1) });
    } catch (error) {
      caught = error;
    }
    expect(handedBibRefusalCode(caught)).toBe("BIB_NUMBER_TAKEN");
    expect(handedBibRefusalCode(new Error("anything else"))).toBeNull();
  });

  it("gives a walk-in at a full race no number: the waiting list, and the spare stays in the box", async () => {
    const event = await createRace({ capacity: 1, spare: [900, 902] });
    await enter(event, "first@example.org", { fastTrack: true });
    const second = await enter(event, "second@example.org", { fastTrack: true, bibNumber: 900, at: later(1) });
    expect(second.status).toBe("WAITLISTED");
    expect(second.bibNumber).toBeNull();
    expect((await freeSpareBibNumbers(db, event.id)).free).toEqual([900, 901, 902]);
  });

  it("confirms a pending registration on paper with a spare, releasing the provisional number it held", async () => {
    const event = await createRace({ spare: [900, 902] });
    const pending = await enter(event, "pending@example.org");
    expect(pending.provisionalBibNumber).toBe(1);

    const confirmed = await confirmRegistrationByStaff(db, volunteer, pending.id, later(1), { bibNumber: 901 });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.bibNumber).toBe(901);
    expect(confirmed.provisionalBibNumber).toBeNull();
    // The released 1 goes to the next person (§214).
    const next = await enter(event, "next@example.org", { at: later(2) });
    expect(next.provisionalBibNumber).toBe(1);

    // Any free number may be handed, not only a spare — then nothing is marked printed.
    const other = await enter(event, "other@example.org", { at: later(3) });
    const typed = await confirmRegistrationByStaff(db, volunteer, other.id, later(4), { bibNumber: 77 });
    expect(typed.bibNumber).toBe(77);
    expect(typed.bibPrintedAt).toBeNull();

    // And a number somebody holds — settled or provisional — is refused, nothing written.
    const third = await enter(event, "third@example.org", { at: later(5) });
    expect(await refusalOf(confirmRegistrationByStaff(db, volunteer, third.id, later(6), { bibNumber: 1 }))).toEqual({
      code: "CONFLICT",
      fields: ["bibNumber"],
    });
    const [still] = await db.select().from(registrations).where(eq(registrations.id, third.id));
    expect(still.status).toBe("PENDING_EMAIL_CONFIRMATION");
  });

  it("marks a spare typed by hand as printed, and refuses a number somebody holds provisionally", async () => {
    const event = await createRace({ spare: [900, 902] });
    const a = await enter(event, "a@example.org", { fastTrack: true });
    // A legacy confirmed row with no number, the one case a confirmed runner may be numbered.
    await db.update(registrations).set({ bibNumber: null, provisionalBibNumber: null }).where(eq(registrations.id, a.id));
    const numbered = await setBibNumberByStaff(db, volunteer, a.id, 902, NOW);
    expect(numbered.bibNumber).toBe(902);
    expect(numbered.bibPrintedAt).toEqual(NOW);

    // Before this, 5 typed here while somebody looked at a provisional 5 went through — and failed
    // on the unique index when that runner was confirmed and adopted it (§220).
    const holder = await enter(event, "holder@example.org", { at: later(1) });
    const typist = await enter(event, "typist@example.org", { at: later(2) });
    expect(holder.provisionalBibNumber).not.toBeNull();
    expect(
      await refusalOf(setBibNumberByStaff(db, volunteer, typist.id, holder.provisionalBibNumber as number, later(3))),
    ).toEqual({ code: "CONFLICT", fields: ["bibNumber"] });
    expect(await bibNumberInUse(db, { eventId: event.id, number: holder.provisionalBibNumber as number })).toBe(true);
    expect(
      await bibNumberInUse(db, { eventId: event.id, number: holder.provisionalBibNumber as number, exceptRegistrationId: holder.id }),
    ).toBe(false);
  });
});

describe("§NNN the band itself", () => {
  it("is both ends or neither, in order, and at most 500 numbers, at the database", async () => {
    const insert = (bibSpareFrom: number | null, bibSpareTo: number | null) =>
      db.insert(events).values({ type: "RACE", startsAt: NOW, registrationMode: "INTERNAL", capacity: 10, bibSpareFrom, bibSpareTo });
    await expect(insert(900, null)).rejects.toThrow();
    await expect(insert(null, 900)).rejects.toThrow();
    await expect(insert(910, 900)).rejects.toThrow();
    await expect(insert(1, 501)).rejects.toThrow();
    await expect(insert(1, 500)).resolves.toBeDefined();
    await expect(insert(null, null)).resolves.toBeDefined();
  });
});
