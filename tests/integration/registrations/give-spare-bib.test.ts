import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import {
  cancelRegistrationByStaff,
  createRegistrationByStaff,
  giveSpareBibByStaff,
  SPARE_BIB_FIELD,
  setBibNumberByStaff,
  spareBibRefusalCode,
} from "@/modules/registrations/admin-service";
import {
  bibNumberInUse,
  countBibs,
  freeSpareBibNumbers,
  givenSpareBibs,
  reserveSpareBibs,
  suggestFreeBibNumbers,
} from "@/modules/registrations/bibs";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-038-01, BR-REQ-037-07, BR-REQ-060-01 — «Dă-i un BIB gol» (the owner, 2026-11-19, holding the sheet of
 * spares: «trebuie să pot aloca numere dintre cele goale, adică astea — spre ex. 154 deja e la …»).
 *
 * A confirmed runner is given one of the event's free desk spares (§444) — the blank bib in their hand — printed or not:
 * the one way a printed number changes (amending §311), the old number retired as §548 retires a replaced one, so it is
 * never drawn again and no two people wear one number. The rest is the hand-typed number's one rule: the event row's
 * lock, a spare nobody wears and none retired, a confirmed real registration, replacing the Administrator's and filling
 * a gap any desk role's, the row marked printed, one audit row with the flags and never a name, and `BIB_ASSIGNED` by the
 * question's answer.
 *
 * PGlite is one connection, so «at the same moment» is two presses queued on it: the lock order and the re-checks under
 * the lock are what is proven here (the two-connection suite has no hand-typed number case to extend).
 */
const NOW = new Date("2026-11-19T08:00:00.000Z");
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
  admin = await staff("ADMIN");
  volunteer = await staff("CONTRIBUTOR");
});

let serial = 0;
async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: role, role }).returning();
  return user;
}

/** A race taking entries here; `spare` is a reservation already printed — its first and last number. */
async function createRace(spare: [number, number] | null = [154, 156]) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T08:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity: 50,
      bibStartNumber: 1,
      walkInBibStart: spare ? spare[0] : null,
      walkInBibCount: spare ? spare[1] - spare[0] + 1 : null,
    })
    .returning();
  return event;
}

/** A runner entered at the desk: confirmed on the spot (fast track) unless `confirmed: false`, drawing the next number. */
async function enter(eventId: string, name: string, options: { confirmed?: boolean; bibNumber?: number; at?: Date } = {}) {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.org`;
  await createRegistrationByStaff(
    db,
    volunteer,
    {
      eventId,
      firstName: name.split(" ")[0],
      lastName: name.split(" ").slice(1).join(" ") || "Pop",
      email,
      locale: "ro",
      listOptOut: false,
      relayedByParticipantRequest: true,
      fastTrack: options.confirmed !== false,
      bibNumber: options.bibNumber,
    },
    options.at ?? NOW,
  );
  const [participant] = await db.select().from(participants).where(eq(participants.canonicalEmail, email));
  const [registration] = await db.select().from(registrations).where(eq(registrations.participantId, participant.id));
  return registration;
}

/** A confirmed runner whose named bib is already printed: the owner's case. */
async function printedRunner(eventId: string, name: string, at?: Date) {
  const runner = await enter(eventId, name, { at });
  await db.update(registrations).set({ bibPrintedAt: NOW }).where(eq(registrations.id, runner.id));
  return reread(runner.id);
}

async function reread(id: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
  return row;
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

async function bibAudits(registrationId: string) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "registration.bib_set"), eq(auditLogs.entityId, registrationId)));
  return rows.map((row) => row.metadataJson);
}

async function bibEmails(registrationId: string) {
  const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, registrationId));
  return rows.filter((row) => row.messageType === "BIB_ASSIGNED").map((row) => row.payloadJson);
}

describe("§NNN BR-REQ-038-01 «Dă-i un BIB gol» replaces a printed number with a free spare", () => {
  it("gives a printed runner the spare, marks it printed, retires the old number for good and tells the runner", async () => {
    const event = await createRace();
    const radu = await printedRunner(event.id, "Radu Pop");
    expect([radu.bibNumber, radu.bibPrintedAt]).toEqual([1, NOW]);

    const given = await giveSpareBibByStaff(db, admin, radu.id, 154, later(1));
    expect(given.bibNumber).toBe(154);
    // The blank bib in his hand is on paper: the next «unprinted» sheet does not print a second 154 with his name.
    expect(given.bibPrintedAt).toEqual(later(1));
    expect(await countBibs(db, event.id)).toEqual({ total: 1, unprinted: 0 });

    // One audit row, the numbers and the flags, never a name.
    const audits = await bibAudits(radu.id);
    expect(audits).toEqual([{ eventId: event.id, from: 1, to: 154, spare: true, printedReplaced: true }]);
    expect(JSON.stringify(audits)).not.toContain("Radu");
    expect(await bibEmails(radu.id)).toEqual([{ bibNumber: 154 }]);

    // 1 is retired: never drawn, suggested or typed again — the next runner is 2, and nobody is handed 154 twice.
    expect(await bibNumberInUse(db, { eventId: event.id, number: 1 })).toBe(true);
    expect(await suggestFreeBibNumbers(db, event.id, undefined, 3)).toEqual([2, 3, 4]);
    const next = await enter(event.id, "Bianca Pop", { at: later(2) });
    expect(next.bibNumber).toBe(2);
    expect(await refusalOf(setBibNumberByStaff(db, admin, next.id, 1, later(3)))).toMatchObject({ code: "CONFLICT" });
    expect(await freeSpareBibNumbers(db, event.id)).toEqual({ band: { from: 154, to: 156 }, free: [155, 156] });

    // The card's list: 154 → Radu Pop.
    expect(await givenSpareBibs(db, event.id)).toEqual([
      { registrationId: radu.id, bibNumber: 154, raceNumberFormat: "plain", registeredName: radu.registeredName, status: "CONFIRMED" },
    ]);
  });

  it("gives a runner whose number is not printed a spare the same way, and a confirmed row with no number its first one", async () => {
    const event = await createRace();
    const plain = await enter(event.id, "Ana Pop");
    expect(plain.bibPrintedAt).toBeNull();
    expect((await giveSpareBibByStaff(db, admin, plain.id, 155, later(1))).bibNumber).toBe(155);
    expect(await bibAudits(plain.id)).toEqual([{ eventId: event.id, from: 1, to: 155, spare: true, printedReplaced: false }]);

    // A row confirmed before §87 drew a number: the gap, filled from the spares.
    const gap = await enter(event.id, "Dan Pop", { at: later(2) });
    await db.update(registrations).set({ bibNumber: null }).where(eq(registrations.id, gap.id));
    const filled = await giveSpareBibByStaff(db, volunteer, gap.id, 154, later(3));
    expect([filled.bibNumber, filled.bibPrintedAt]).toEqual([154, later(3)]);
    expect(await bibAudits(gap.id)).toEqual([{ eventId: event.id, from: null, to: 154, spare: true, printedReplaced: false }]);
  });

  it("asks nothing twice: the spare the runner already wears writes nothing more", async () => {
    const event = await createRace();
    const radu = await printedRunner(event.id, "Radu Pop");
    await giveSpareBibByStaff(db, admin, radu.id, 154, later(1));
    const again = await giveSpareBibByStaff(db, admin, radu.id, 154, later(2));
    expect(again.bibNumber).toBe(154);
    expect(await bibAudits(radu.id)).toHaveLength(1);
    expect(await bibEmails(radu.id)).toHaveLength(1);
  });
});

describe("§NNN only the event's free spares are accepted, on the server", () => {
  it("refuses a number that is not one of the spares, naming the select, and the typed box still never moves a printed number", async () => {
    const event = await createRace();
    const radu = await printedRunner(event.id, "Radu Pop");
    for (const number of [40, 153, 157]) {
      expect(await refusalOf(giveSpareBibByStaff(db, admin, radu.id, number, later(1)))).toEqual({ code: "VALIDATION_ERROR", fields: [SPARE_BIB_FIELD] });
    }
    // Not a whole number, or none chosen: refused the same way.
    expect(await refusalOf(giveSpareBibByStaff(db, admin, radu.id, 154.5, later(1)))).toEqual({ code: "VALIDATION_ERROR", fields: [SPARE_BIB_FIELD] });
    expect(await refusalOf(giveSpareBibByStaff(db, admin, radu.id, null, later(1)))).toEqual({ code: "VALIDATION_ERROR", fields: [SPARE_BIB_FIELD] });
    // «Schimbă numărul» keeps its own rule (§311): a printed number is not its to move, a spare included.
    expect(await refusalOf(setBibNumberByStaff(db, admin, radu.id, 155, later(1)))).toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await reread(radu.id)).bibNumber).toBe(1);
    expect(await bibAudits(radu.id)).toEqual([]);
  });

  it("refuses an event with no spares reserved, and a number a print stepped over", async () => {
    const plainRace = await createRace(null);
    const runner = await enter(plainRace.id, "Ana Pop");
    expect(await refusalOf(giveSpareBibByStaff(db, admin, runner.id, 154, later(1)))).toEqual({ code: "VALIDATION_ERROR", fields: [SPARE_BIB_FIELD] });

    // A print, a number typed by hand right after it, a second print stepping over it (§444): 4 was never printed blank,
    // so it is no spare — not even once that runner no longer wears it.
    const race = await createRace(null);
    const first = await enter(race.id, "Bogdan Pop");
    await reserveSpareBibs(db, { actor: admin, eventId: race.id, count: 2, now: later(1) });
    const typed = await enter(race.id, "Cristi Pop", { bibNumber: 4, at: later(2) });
    expect(typed.bibNumber).toBe(4);
    await reserveSpareBibs(db, { actor: admin, eventId: race.id, count: 2, now: later(3) });
    await db.update(registrations).set({ bibNumber: null }).where(eq(registrations.id, typed.id));
    expect((await freeSpareBibNumbers(db, race.id)).free).toEqual([2, 3, 5, 6]);
    expect(await refusalOf(giveSpareBibByStaff(db, admin, first.id, 4, later(4)))).toEqual({ code: "VALIDATION_ERROR", fields: [SPARE_BIB_FIELD] });
    expect((await reread(first.id)).bibNumber).toBe(1);
  });

  it("refuses a spare somebody wears, and one retired, in its own words", async () => {
    const event = await createRace();
    // Bianca was handed 154 at the desk with the paper (§444).
    const bianca = await enter(event.id, "Bianca Pop", { bibNumber: 154 });
    expect(bianca.bibNumber).toBe(154);
    const radu = await printedRunner(event.id, "Radu Pop", later(1));

    let caught: unknown;
    try {
      await giveSpareBibByStaff(db, admin, radu.id, 154, later(2));
    } catch (error) {
      caught = error;
    }
    expect(isDomainError(caught) && caught.code).toBe("CONFLICT");
    expect(spareBibRefusalCode(caught)).toBe("SPARE_BIB_TAKEN");
    expect(spareBibRefusalCode(new Error("anything else"))).toBeNull();

    // Cristi takes 155, then 156: 155 is retired with the change, and nobody is given it again.
    const cristi = await enter(event.id, "Cristi Pop", { at: later(3) });
    await giveSpareBibByStaff(db, admin, cristi.id, 155, later(4));
    await giveSpareBibByStaff(db, admin, cristi.id, 156, later(5));
    try {
      await giveSpareBibByStaff(db, admin, radu.id, 155, later(6));
      caught = null;
    } catch (error) {
      caught = error;
    }
    expect(spareBibRefusalCode(caught)).toBe("SPARE_BIB_TAKEN");
    expect((await reread(radu.id)).bibNumber).toBe(1);
    expect(await freeSpareBibNumbers(db, event.id)).toEqual({ band: { from: 154, to: 156 }, free: [] });
  });
});

describe("§NNN the event row's lock: two presses for one spare", () => {
  it("gives the spare to one runner and tells the other press it was taken, nothing written for it", async () => {
    const event = await createRace();
    const radu = await printedRunner(event.id, "Radu Pop");
    const bianca = await printedRunner(event.id, "Bianca Pop", later(1));
    const other = await staff("ADMIN");

    const presses = await Promise.allSettled([
      giveSpareBibByStaff(db, admin, radu.id, 154, later(2)),
      giveSpareBibByStaff(db, other, bianca.id, 154, later(2)),
    ]);
    const won = presses.filter((press) => press.status === "fulfilled");
    const refused = presses.filter((press): press is PromiseRejectedResult => press.status === "rejected");
    expect(won).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(spareBibRefusalCode(refused[0].reason)).toBe("SPARE_BIB_TAKEN");

    const wearers = (await db.select().from(registrations).where(eq(registrations.eventId, event.id))).filter((row) => row.bibNumber === 154);
    expect(wearers).toHaveLength(1);
    const loser = wearers[0].id === radu.id ? bianca : radu;
    // The other runner keeps the number they wore, printed, and no audit row or email was written for them.
    expect((await reread(loser.id)).bibNumber).toBe(loser.bibNumber);
    expect(await bibAudits(loser.id)).toEqual([]);
    expect(await bibEmails(loser.id)).toEqual([]);
  });

  it("retires a runner's old number once when two spares are pressed for them at once", async () => {
    const event = await createRace();
    const radu = await printedRunner(event.id, "Radu Pop");
    const other = await staff("ADMIN");

    const presses = await Promise.allSettled([
      giveSpareBibByStaff(db, admin, radu.id, 154, later(1)),
      giveSpareBibByStaff(db, other, radu.id, 155, later(1)),
    ]);
    // Either the second press met a number changed a moment ago (CONFLICT), or it replaced the one the first wrote:
    // never two rows saying `from: 1`, so no number is retired by nobody.
    for (const press of presses) if (press.status === "rejected") expect(isDomainError(press.reason) && press.reason.code).toBe("CONFLICT");
    const audits = (await bibAudits(radu.id)) as { from: number | null; to: number }[];
    expect(audits.filter((audit) => audit.from === 1)).toHaveLength(1);
    const wears = (await reread(radu.id)).bibNumber as number;
    expect([154, 155]).toContain(wears);
    // Every number the runner wore on the way is out of every draw.
    for (const audit of audits) expect(await bibNumberInUse(db, { eventId: event.id, number: audit.from as number })).toBe(true);
  });
});

describe("§NNN BR-REQ-060-01 who may give a blank bib, asserted on the server", () => {
  it("lets only an Administrator replace a number; any desk role fills a row with none; a member is no staff", async () => {
    const event = await createRace();
    const radu = await printedRunner(event.id, "Radu Pop");
    // The Organizer, Tehnic, the Redactor and the desk volunteer meet the replace refusal; a member meets the desk's door.
    for (const role of ["MODERATOR", "DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      expect(await refusalOf(giveSpareBibByStaff(db, await staff(role), radu.id, 154, later(1)))).toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await reread(radu.id)).bibNumber).toBe(1);
    expect(await bibAudits(radu.id)).toEqual([]);

    // Filling a gap: the Organizer, Tehnic and the desk volunteer may; a member may not.
    const rows = [];
    for (const name of ["Bianca Pop", "Cristi Pop", "Dana Pop", "Emil Pop"]) {
      const row = await enter(event.id, name, { at: later(rows.length + 2) });
      await db.update(registrations).set({ bibNumber: null }).where(eq(registrations.id, row.id));
      rows.push(row);
    }
    expect(await refusalOf(giveSpareBibByStaff(db, await staff("MEMBER"), rows[0].id, 154, later(9)))).toMatchObject({ code: "FORBIDDEN" });
    expect((await giveSpareBibByStaff(db, await staff("MODERATOR"), rows[0].id, 154, later(10))).bibNumber).toBe(154);
    expect((await giveSpareBibByStaff(db, await staff("DEV"), rows[1].id, 155, later(11))).bibNumber).toBe(155);
    expect((await giveSpareBibByStaff(db, volunteer, rows[2].id, 156, later(12))).bibNumber).toBe(156);

    // The Superadministrator replaces as the Administrator does.
    const fresh = await createRace([200, 201]);
    const runner = await printedRunner(fresh.id, "Ion Pop", later(13));
    expect((await giveSpareBibByStaff(db, await staff("SUPERADMIN"), runner.id, 200, later(14))).bibNumber).toBe(200);
  });

  it("refuses a test registration, a cancelled one and one not confirmed yet, the spare left free", async () => {
    const event = await createRace();
    const pending = await enter(event.id, "Ana Pop", { confirmed: false });
    expect(pending.status).not.toBe("CONFIRMED");
    expect(await refusalOf(giveSpareBibByStaff(db, admin, pending.id, 154, later(1)))).toEqual({ code: "VALIDATION_ERROR", fields: [SPARE_BIB_FIELD] });

    const gone = await printedRunner(event.id, "Bogdan Pop", later(2));
    await cancelRegistrationByStaff(db, admin, gone.id, "nu mai vine", later(3));
    expect(await refusalOf(giveSpareBibByStaff(db, admin, gone.id, 154, later(4)))).toEqual({ code: "VALIDATION_ERROR", fields: [SPARE_BIB_FIELD] });

    // A test registration never wears a number (§30), confirmed or not.
    const test = await enter(event.id, "Test Pop", { at: later(5) });
    await db.update(registrations).set({ kind: "TEST", bibNumber: null }).where(eq(registrations.id, test.id));
    expect(await refusalOf(giveSpareBibByStaff(db, admin, test.id, 154, later(6)))).toEqual({ code: "VALIDATION_ERROR", fields: [SPARE_BIB_FIELD] });

    expect((await freeSpareBibNumbers(db, event.id)).free).toEqual([154, 155, 156]);
    for (const row of [pending, gone, test]) expect(await bibAudits(row.id)).toEqual([]);
  });
});

describe("§NNN §976 the email is the answer pressed", () => {
  it("queues BIB_ASSIGNED for «… și trimite emailul» and nothing for «… fără email», the change written either way", async () => {
    const event = await createRace();
    const sent = await printedRunner(event.id, "Radu Pop");
    const kept = await printedRunner(event.id, "Bianca Pop", later(1));

    await giveSpareBibByStaff(db, admin, sent.id, 154, later(2), { sendEmail: true });
    await giveSpareBibByStaff(db, admin, kept.id, 155, later(3), { sendEmail: false });

    expect(await bibEmails(sent.id)).toEqual([{ bibNumber: 154 }]);
    expect(await bibEmails(kept.id)).toEqual([]);
    expect((await reread(kept.id)).bibNumber).toBe(155);
    expect(await bibAudits(kept.id)).toEqual([{ eventId: event.id, from: 2, to: 155, spare: true, printedReplaced: true, emailSkipped: true }]);
  });
});

describe("§NNN the spares given, for the card", () => {
  it("lists every real wearer of the reservation lowest first, a cancelled one with its state, and nothing outside it", async () => {
    const event = await createRace([154, 158]);
    const radu = await printedRunner(event.id, "Radu Pop");
    await giveSpareBibByStaff(db, admin, radu.id, 156, later(1));
    const walkIn = await enter(event.id, "Bianca Pop", { bibNumber: 154, at: later(2) });
    const gone = await enter(event.id, "Cristi Pop", { bibNumber: 155, at: later(3) });
    await cancelRegistrationByStaff(db, admin, gone.id, "nu mai vine", later(4));
    // A runner outside the reservation is not a spare's.
    await enter(event.id, "Dan Pop", { at: later(5) });

    expect((await givenSpareBibs(db, event.id)).map((line) => [line.bibNumber, line.registrationId, line.status])).toEqual([
      [154, walkIn.id, "CONFIRMED"],
      [155, gone.id, "CANCELLED"],
      [156, radu.id, "CONFIRMED"],
    ]);
    expect((await freeSpareBibNumbers(db, event.id)).free).toEqual([157, 158]);
    expect(await givenSpareBibs(db, (await createRace(null)).id)).toEqual([]);
  });
});
