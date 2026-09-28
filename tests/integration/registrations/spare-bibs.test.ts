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
  reserveSpareBibs,
  spareCardState,
  spareStates,
  suggestFreeBibNumbers,
} from "@/modules/registrations/bibs";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import type { EventForRegistration } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §444 — spare bibs for on-the-spot entries: numbers the club prints ahead with an empty name line,
 * reserved by the print, which the allocator never hands to anybody who registered online, and
 * which the desk hands to a walk-in — suggested, the next free one.
 *
 * The first block is the print: what it reserves, and that it never lands on a number somebody
 * has. The second carries the weight: every automatic draw — a confirmation (the only moment a
 * number is drawn, §NNN), the batch, the suggestions — steps over the reservation. The third is the
 * desk: a spare handed with the paper is the number the confirmation gives, marked printed, and
 * refused when somebody else has it. They replace the three
 * Playwright cases the brief named (the owner cut the browser runs on 2026-09-26).
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
  /** `spare` is a reservation already made — its first and last number — as a print leaves it. */
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
      walkInBibStart: options.spare ? options.spare[0] : null,
      walkInBibCount: options.spare ? options.spare[1] - options.spare[0] + 1 : null,
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

describe("§444 the print reserves the spares", () => {
  it("reserves after the highest number anybody has, prints them blank, and extends on a second print", async () => {
    const event = await createRace({ spare: null });
    await enter(event, "a@example.org");
    await enter(event, "b@example.org", { at: later(1) });
    // A number typed by hand, far up: the spares start after it, never inside the sequence.
    const c = await enter(event, "c@example.org", { fastTrack: true, bibNumber: 40, at: later(2) });
    expect(c.bibNumber).toBe(40);

    const card = await spareCardState(db, event.id);
    expect(card.band).toBeNull();
    expect(card.candidates.slice(0, 3)).toEqual([41, 42, 43]);

    const first = await reserveSpareBibs(db, { actor: admin, eventId: event.id, count: 3, expectFrom: 41, now: later(3) });
    expect(first).toEqual({ from: 41, to: 43, count: 3, band: { from: 41, to: 43 } });
    const [row] = await db.select().from(events).where(eq(events.id, event.id));
    expect([row.walkInBibStart, row.walkInBibCount]).toEqual([41, 3]);

    // The sheet the banner links to: three numbered bibs, each with an empty name line.
    const { free } = await freeSpareBibNumbers(db, event.id);
    expect(free).toEqual([41, 42, 43]);
    const pdf = await renderBibSheet({
      rows: free.map((bibNumber) => ({ bibNumber, registeredName: null })),
      eventTitle: "Crosul",
      eventDate: "1 octombrie 2026",
      generatedAt: NOW,
      blankMark: "înscris la fața locului",
    });
    // Three A5 bibs, two to an A4: two pages.
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(2);

    // A second print extends the same reservation after its end.
    const second = await reserveSpareBibs(db, { actor: admin, eventId: event.id, count: 2, now: later(4) });
    expect(second).toEqual({ from: 44, to: 45, count: 2, band: { from: 41, to: 45 } });

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.bib_spares_reserved"));
    expect(audits.map((audit) => audit.metadataJson)).toEqual([
      { from: 41, to: 43, count: 3, reservedFrom: 41, reservedCount: 3, skipped: [] },
      { from: 44, to: 45, count: 2, reservedFrom: 41, reservedCount: 5, skipped: [] },
    ]);
  });

  it("steps over a number somebody took past the reservation's end when it extends", async () => {
    const event = await createRace({ spare: null });
    await enter(event, "a@example.org", { fastTrack: true });
    await reserveSpareBibs(db, { actor: admin, eventId: event.id, count: 2, now: later(1) });
    // Somebody typed 4 by hand for a runner, right after the reservation 2–3.
    const typed = await enter(event, "typed@example.org", { fastTrack: true, bibNumber: 4, at: later(2) });
    expect(typed.bibNumber).toBe(4);
    const more = await reserveSpareBibs(db, { actor: admin, eventId: event.id, count: 2, now: later(3) });
    expect([more.from, more.to]).toEqual([5, 6]);
    // 4 sits inside the reservation now and stays that runner's: never printed blank, never suggested.
    expect((await freeSpareBibNumbers(db, event.id)).free).toEqual([2, 3, 5, 6]);
  });

  it("is the Administrator's alone, asks for one to the per-print maximum, and refuses a start that moved since the question", async () => {
    const event = await createRace({ spare: null });
    expect(await refusalOf(reserveSpareBibs(db, { actor: volunteer, eventId: event.id, count: 3 }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await refusalOf(reserveSpareBibs(db, { actor: admin, eventId: event.id, count: 0 }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["spareCount"],
    });
    expect(await refusalOf(reserveSpareBibs(db, { actor: admin, eventId: event.id, count: 51 }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["spareCount"],
    });
    // The question named 1; somebody was confirmed in between and took it.
    await enter(event, "a@example.org", { fastTrack: true });
    expect(await refusalOf(reserveSpareBibs(db, { actor: admin, eventId: event.id, count: 3, expectFrom: 1 }))).toEqual({
      code: "CONFLICT",
      fields: ["spareFrom"],
    });
    const [row] = await db.select().from(events).where(eq(events.id, event.id));
    expect(row.walkInBibStart).toBeNull();
  });
});

describe("§444 BR-REQ-038-01 the allocator never draws a desk spare", () => {
  it("gives an online registration a number outside the reservation, after a print", async () => {
    const event = await createRace({ spare: null });
    const a = await enter(event, "a@example.org", { fastTrack: true });
    await reserveSpareBibs(db, { actor: admin, eventId: event.id, count: 3, now: later(1) });
    const b = await enter(event, "b@example.org", { at: later(2) });
    // Sent, not confirmed: no number yet (§NNN).
    expect(b.bibNumber).toBeNull();
    const confirmed = await confirmRegistrationByStaff(db, volunteer, b.id, later(3));
    expect([a.bibNumber, confirmed.bibNumber]).toEqual([1, 5]);
  });

  it("steps over the band for the number drawn at the confirmation", async () => {
    const event = await createRace({ spare: [3, 5] });
    const a = await enter(event, "a@example.org", { fastTrack: true });
    const b = await enter(event, "b@example.org", { fastTrack: true, at: later(1) });
    const c = await enter(event, "c@example.org", { fastTrack: true, at: later(2) });
    expect([a.bibNumber, b.bibNumber, c.bibNumber]).toEqual([1, 2, 6]);
  });

  it("keeps a runner's number the extension reached as theirs, and never suggests an unprinted number as a spare", async () => {
    const event = await createRace({ spare: null });
    const a = await enter(event, "a@example.org", { fastTrack: true });
    // First print: 2–3, blank.
    const first = await reserveSpareBibs(db, { actor: admin, eventId: event.id, count: 2, now: later(1) });
    expect([first.from, first.to]).toEqual([2, 3]);
    // Two runners confirmed at the desk; the draw steps over 2–3.
    const b = await enter(event, "b@example.org", { fastTrack: true, at: later(2) });
    const c = await enter(event, "c@example.org", { fastTrack: true, at: later(3) });
    expect([a.bibNumber, b.bibNumber, c.bibNumber]).toEqual([1, 4, 5]);

    // Second print: the reservation grows over 4 and 5 to reach 6 and 7, and says it stepped over them.
    const second = await reserveSpareBibs(db, { actor: admin, eventId: event.id, count: 2, now: later(5) });
    expect(second).toEqual({ from: 6, to: 7, count: 2, band: { from: 2, to: 7 } });
    const printed = [2, 3, 6, 7];
    // Every spare the desk is offered is one printed blank: 4 and 5 are B's and C's.
    expect((await freeSpareBibNumbers(db, event.id)).free).toEqual(printed);
    expect((await spareCardState(db, event.id)).free).toBe(4);
    expect(await spareStates(db, [event.id])).toEqual({ [event.id]: { kind: "free", next: 2 } });

    // A walk-in handed no number draws past the whole reservation.
    const walkIn = await enter(event, "walkin@example.org", { fastTrack: true, at: later(11) });
    expect(walkIn.bibNumber).toBe(8);
    // A walk-in handed the desk's spares takes them one by one, and the last spare is 7.
    for (const [index, number] of printed.entries()) {
      const handed = await enter(event, `spare${index}@example.org`, { fastTrack: true, bibNumber: number, at: later(12 + index) });
      expect(handed.bibNumber).toBe(number);
    }
    expect(await spareStates(db, [event.id])).toEqual({ [event.id]: { kind: "out" } });

    // No number worn twice.
    const worn = (await db.select({ bib: registrations.bibNumber }).from(registrations).where(eq(registrations.eventId, event.id)))
      .map((row) => row.bib)
      .filter((bib): bib is number => bib !== null);
    expect(new Set(worn).size).toBe(worn.length);
    expect(worn.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("draws a number past the reservation when the desk hands none, in the order of confirmation", async () => {
    const event = await createRace({ spare: [1, 3] });
    const late = await enter(event, "late@example.org");
    expect(late.bibNumber).toBeNull();

    // A walk-in confirmed first, with no number handed: the draw's own, past the spares.
    const walkIn = await enter(event, "walkin@example.org", { fastTrack: true, at: later(1) });
    expect(walkIn.status).toBe("CONFIRMED");
    expect(walkIn.bibNumber).toBe(4);

    // The one who registered first is confirmed second, and gets the next number.
    const confirmed = await confirmRegistrationByStaff(db, volunteer, late.id, later(2));
    expect(confirmed.bibNumber).toBe(5);
  });

  it("numbers the batch past the reservation, and never suggests a spare as a preferential number", async () => {
    const event = await createRace({ spare: [2, 4] });
    const a = await enter(event, "a@example.org", { fastTrack: true });
    const b = await enter(event, "b@example.org", { fastTrack: true, at: later(1) });
    expect([a.bibNumber, b.bibNumber]).toEqual([1, 5]);
    // Two confirmed rows with no number (confirmed before §87): the batch draws, and steps over 2–4.
    await db.update(registrations).set({ bibNumber: null }).where(eq(registrations.eventId, event.id));
    await assignBibNumbers(db, { actor: admin, eventId: event.id, now: later(2) });
    const numbered = await db.select({ bib: registrations.bibNumber }).from(registrations).where(eq(registrations.eventId, event.id));
    expect(numbered.map((row) => row.bib).sort()).toEqual([1, 5]);

    expect(await suggestFreeBibNumbers(db, event.id, undefined, 3)).toEqual([6, 7, 8]);
  });
});

describe("§444 BR-REQ-037-07 the desk hands a spare", () => {
  it("suggests the first spare to the walk-in, nothing where none are reserved, and says when they ran out", async () => {
    const event = await createRace({ spare: null });
    await reserveSpareBibs(db, { actor: admin, eventId: event.id, count: 2, now: NOW });
    const plain = await createRace({ spare: null });
    expect(await spareStates(db, [event.id, plain.id])).toEqual({ [event.id]: { kind: "free", next: 1 }, [plain.id]: { kind: "none" } });
    expect(await freeSpareBibNumbers(db, plain.id)).toEqual({ band: null, free: [] });

    await enter(event, "one@example.org", { fastTrack: true, bibNumber: 1, at: later(1) });
    await enter(event, "two@example.org", { fastTrack: true, bibNumber: 2, at: later(2) });
    expect(await spareStates(db, [event.id])).toEqual({ [event.id]: { kind: "out" } });
  });

  it("gives a walk-in the spare handed with the paper: settled at once, marked printed, audited, and the next one suggested", async () => {
    const event = await createRace({ spare: [900, 902] });
    const walkIn = await enter(event, "walkin@example.org", { fastTrack: true, bibNumber: 900 });

    expect(walkIn.status).toBe("CONFIRMED");
    // The number the confirmation gives: the bib already in the runner's hand.
    expect(walkIn.bibNumber).toBe(900);
    // On paper already, so the next "unprinted" sheet does not print a second 900 with the name.
    expect(walkIn.bibPrintedAt).toEqual(NOW);
    expect(await listBibs(db, event.id, { only: "unprinted" })).toEqual([]);
    expect(await countBibs(db, event.id)).toEqual({ total: 1, unprinted: 0 });

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.confirmed_by_staff"));
    expect(audit.metadataJson).toMatchObject({ to: "CONFIRMED", bibNumber: 900 });

    expect(await freeSpareBibNumbers(db, event.id)).toEqual({ band: { from: 900, to: 902 }, free: [901, 902] });
    expect(await spareStates(db, [event.id])).toEqual({ [event.id]: { kind: "free", next: 901 } });
  });

  it("refuses a spare somebody already has before anything is written, and ignores the box without the fast track", async () => {
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
    // The box is prefilled at the desk; unticking the fast track must not trap the volunteer.
    expect(await refusalOf(unticked)).toBe("no error");
    const phone = await rowOf("phone@example.org");
    expect(phone.bibNumber).toBeNull();
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

  it("confirms a pending registration on paper with a spare, which is the number its confirmation gives", async () => {
    const event = await createRace({ spare: [900, 902] });
    const pending = await enter(event, "pending@example.org");
    expect(pending.bibNumber).toBeNull();

    const confirmed = await confirmRegistrationByStaff(db, volunteer, pending.id, later(1), { bibNumber: 901 });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.bibNumber).toBe(901);
    // The next confirmation with no number handed draws from the event's first number (§173).
    const next = await enter(event, "next@example.org", { fastTrack: true, at: later(2) });
    expect(next.bibNumber).toBe(1);

    // Any free number may be handed, not only a spare — then nothing is marked printed.
    const other = await enter(event, "other@example.org", { at: later(3) });
    const typed = await confirmRegistrationByStaff(db, volunteer, other.id, later(4), { bibNumber: 77 });
    expect(typed.bibNumber).toBe(77);
    expect(typed.bibPrintedAt).toBeNull();

    // And a number somebody wears is refused, nothing written.
    const third = await enter(event, "third@example.org", { at: later(5) });
    expect(await refusalOf(confirmRegistrationByStaff(db, volunteer, third.id, later(6), { bibNumber: 1 }))).toEqual({
      code: "CONFLICT",
      fields: ["bibNumber"],
    });
    const [still] = await db.select().from(registrations).where(eq(registrations.id, third.id));
    expect(still.status).toBe("PENDING_EMAIL_CONFIRMATION");
  });

  it("hands a spare to an online runner confirmed at the desk too, and refuses one for a row that wears a number or a printed bib", async () => {
    const event = await createRace({ spare: [900, 902] });
    // An online registration: nobody has a number before the confirmation (§NNN), so the spare in
    // the volunteer's hand is the one it gets.
    const online = await enter(event, "online@example.org");
    await db.update(registrations).set({ source: "PUBLIC", createdByStaffUserId: null }).where(eq(registrations.id, online.id));
    const handed = await confirmRegistrationByStaff(db, volunteer, online.id, later(1), { bibNumber: 900 });
    expect(handed.bibNumber).toBe(900);

    // A row that already wears a number (a cancelled confirmed registration that restarted) keeps it.
    const worn = await enter(event, "worn@example.org", { at: later(2) });
    await db.update(registrations).set({ bibNumber: 50 }).where(eq(registrations.id, worn.id));
    expect(await refusalOf(confirmRegistrationByStaff(db, volunteer, worn.id, later(3), { bibNumber: 901 }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["bibNumber"],
    });
    const [kept] = await db.select().from(registrations).where(eq(registrations.id, worn.id));
    expect(kept.status).toBe("PENDING_EMAIL_CONFIRMATION");
    // Without a handed number the desk confirms it with the number it wears.
    expect((await confirmRegistrationByStaff(db, volunteer, worn.id, later(4))).bibNumber).toBe(50);

    // A bib on paper already stays that bib.
    const printed = await enter(event, "printed@example.org", { at: later(5) });
    await db.update(registrations).set({ bibPrintedAt: later(5) }).where(eq(registrations.id, printed.id));
    expect(await refusalOf(confirmRegistrationByStaff(db, volunteer, printed.id, later(6), { bibNumber: 901 }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["bibNumber"],
    });
    expect((await freeSpareBibNumbers(db, event.id)).free).toEqual([901, 902]);
  });

  it("marks a spare typed by hand as printed, and refuses a number another runner wears", async () => {
    const event = await createRace({ spare: [900, 902] });
    const a = await enter(event, "a@example.org", { fastTrack: true });
    // A legacy confirmed row with no number, given one by hand.
    await db.update(registrations).set({ bibNumber: null }).where(eq(registrations.id, a.id));
    const numbered = await setBibNumberByStaff(db, volunteer, a.id, 902, NOW);
    expect(numbered.bibNumber).toBe(902);
    expect(numbered.bibPrintedAt).toEqual(NOW);

    const holder = await enter(event, "holder@example.org", { fastTrack: true, at: later(1) });
    const typist = await enter(event, "typist@example.org", { fastTrack: true, at: later(2) });
    expect(holder.bibNumber).not.toBeNull();
    expect(await refusalOf(setBibNumberByStaff(db, volunteer, typist.id, holder.bibNumber as number, later(3)))).toEqual({
      code: "CONFLICT",
      fields: ["bibNumber"],
    });
    expect(await bibNumberInUse(db, { eventId: event.id, number: holder.bibNumber as number })).toBe(true);
    expect(await bibNumberInUse(db, { eventId: event.id, number: holder.bibNumber as number, exceptRegistrationId: holder.id })).toBe(false);
  });
});

describe("§444 the reservation itself", () => {
  it("is a start and a count or neither, the count from 1 to 500, within five digits, at the database", async () => {
    const insert = (walkInBibStart: number | null, walkInBibCount: number | null) =>
      db.insert(events).values({ type: "RACE", startsAt: NOW, registrationMode: "INTERNAL", capacity: 10, walkInBibStart, walkInBibCount });
    await expect(insert(900, null)).rejects.toThrow();
    await expect(insert(null, 5)).rejects.toThrow();
    await expect(insert(900, 0)).rejects.toThrow();
    await expect(insert(1, 501)).rejects.toThrow();
    await expect(insert(99_999, 2)).rejects.toThrow();
    await expect(insert(1, 500)).resolves.toBeDefined();
    await expect(insert(null, null)).resolves.toBeDefined();
  });
});
