import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { type RegistrationKind, registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { deadlineReleaseDue } from "@/modules/registrations/domain/unsigned-release";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { sendHoldEmails } from "../../helpers/outbox";

vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: () => undefined,
}));

const { confirmEmail, signDeclaration, submitRegistration } = await import("@/modules/registrations/service");
type EventForRegistration = Parameters<typeof submitRegistration>[1];
const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");
const { inEmailPress } = await import("@/modules/notifications/press");
const { deadlineReleaseDueSql, findEventsNeedingMaintenance } = await import("@/modules/registrations/repository");
const { nextMaintenanceWork } = await import("@/modules/jobs/next-work");
const { forecastAutomaticEmails } = await import("@/modules/notifications/forecast");
const { DEFAULT_DEADLINES } = await import("@/modules/deadlines/domain/deadlines");

/**
 * «Eliberează singur locurile nesemnate la termen» (§914; the owner, 2026-11-04, for the 21 November race; BR-REQ-033-01,
 * BR-REQ-080-01) on a real database. One run, at the participation window's deadline, inside `expireStaleHolds`: every
 * declaration hold that holds a counted place and is past its own deadline goes, whoever waits — never a special guest's
 * («În afara locurilor») — the places go to nobody by themselves («Locurile libere le dau doar eu» ticked, audited), each
 * person released gets the lapsed-hold email saying the deadline, with no club copy, and each Administrator one
 * `UNSIGNED_RELEASED`; the memory column makes it once per deadline, a moved deadline arms it again. A signature that
 * reaches the deadline first is released with the rest (the same answer whichever transaction locks first); one before is
 * kept. Cancelled and started events, and the switch off, are as before. The job wakes at the deadline and selects the
 * event with nobody waiting; the forecast lists the release before it happens.
 *
 * Every date is relative to the real clock (`yarn test:clock`).
 */
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
const STARTS = new Date(NOW.getTime() + 30 * DAY);
/** The participation window: asked 7 days before, due 2 days before the start. */
const DEADLINE = new Date(STARTS.getTime() - 2 * DAY);
const after = (minutes: number) => new Date(DEADLINE.getTime() + minutes * MINUTE);

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  // Two who are told about the places, and an Organizer who is not.
  await db.insert(staffUsers).values([
    { email: "admin@dev.test", displayName: "Admin", role: "ADMIN", preferredLocale: "ro" },
    { email: "super@dev.test", displayName: "Super", role: "SUPERADMIN", preferredLocale: "en" },
    { email: "org@dev.test", displayName: "Org", role: "MODERATOR", preferredLocale: "ro" },
  ]);
});

/** A published race thirty days off, the window 7 and 2 days before, the release switched on unless told otherwise. */
async function createRace(capacity: number | null, over: Partial<typeof events.$inferInsert> = {}): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: STARTS,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(NOW.getTime() - DAY),
      capacity,
      waitlistAutoOffer: true,
      confirmationOpensDaysBefore: 7,
      confirmationDeadlineDaysBefore: 2,
      releaseUnsignedAtDeadline: true,
      locationName: "Parcul Tractorul",
      ...over,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul de toamnă" },
    { eventId: event.id, locale: "en", slug: `autumn-${event.id.slice(0, 8)}`, title: "Autumn race" },
  ]);
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity,
    raceId: null,
    publishedAt: event.publishedAt,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  };
}

/** One person through the form and the address link at `at`, the declaration email sent: their row. */
async function join(event: EventForRegistration, name: string, at: Date = NOW, kind: RegistrationKind = "REAL") {
  await submitRegistration(
    db,
    event,
    {
      firstName: name,
      lastName: "Pop",
      birthDate: "1990-05-17",
      sex: "FEMALE",
      nationality: "RO",
      country: "RO",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Contact Urgență",
      emergencyContactPhone: "+40722222222",
      email: `${name.toLowerCase()}@example.ro`,
      locale: "ro",
      privacyAcknowledged: true,
      fitnessDeclared: true,
      termsAccepted: true,
      rulesAcknowledged: true,
      resultsNameConsent: true,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(at.getTime() - 10_000).toISOString(),
    },
    at,
    kind,
  );
  const [created] = await db.select().from(registrations).where(and(eq(registrations.eventId, event.id), eq(registrations.registeredName, `${name} Pop`)));
  const confirmed = await confirmEmail(db, event, created.id, at);
  await sendHoldEmails(db, at);
  return confirmed;
}

const statusOf = async (id: string) => (await db.select().from(registrations).where(eq(registrations.id, id)))[0].status;
const eventRow = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
const mail = (type: "DECLARATION_HOLD_EXPIRED" | "UNSIGNED_RELEASED" | "WAITLIST_SPOT_OFFER") =>
  db.select().from(emailOutbox).where(eq(emailOutbox.messageType, type)).orderBy(asc(emailOutbox.recipientEmail));
const trail = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(asc(auditLogs.createdAt));

async function refusedCode(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("BR-REQ-033-01 «Eliberează singur locurile nesemnate la termen»: one release at the deadline (§914)", () => {
  it("before the deadline nothing; at it every counted unsigned hold goes, whoever waits — one stamp, the people told, one summary each, no offer, the tick audited", async () => {
    const event = await createRace(3);
    const ana = await join(event, "Ana");
    const bia = await join(event, "Bia");
    const tina = await join(event, "Tina", NOW, "TEST");
    expect([ana.status, bia.status, tina.status]).toEqual(["PENDING_DECLARATION", "PENDING_DECLARATION", "PENDING_DECLARATION"]);
    expect(ana.holdExpiresAt).toEqual(DEADLINE);
    const wally = await join(event, "Wally");
    expect(wally.status).toBe("WAITLISTED");
    // A special guest's hold («În afara locurilor», §643): no counted place, never the release's.
    const gina = await join(event, "Gina");
    await db.update(registrations).set({ status: "PENDING_DECLARATION", outsideCapacity: true, holdExpiresAt: DEADLINE, waitlistedAt: null }).where(eq(registrations.id, gina.id));
    const before = await eventRow(event.id);

    await runRegistrationMaintenance(db, after(-1));
    expect(await statusOf(ana.id)).toBe("PENDING_DECLARATION");
    expect((await eventRow(event.id)).unsignedReleasedFor).toBeNull();
    expect(await mail("DECLARATION_HOLD_EXPIRED")).toEqual([]);

    // As the job's route runs it: inside the job's own press.
    await inEmailPress("job.registrationMaintenance", () => runRegistrationMaintenance(db, after(1)));
    expect(await statusOf(ana.id)).toBe("EXPIRED");
    expect(await statusOf(bia.id)).toBe("EXPIRED");
    expect(await statusOf(tina.id)).toBe("EXPIRED");
    expect(await statusOf(gina.id)).toBe("PENDING_DECLARATION");
    // Nobody is given the freed places: the line waits, no offer leaves.
    expect(await statusOf(wally.id)).toBe("WAITLISTED");
    expect(await mail("WAITLIST_SPOT_OFFER")).toEqual([]);

    const row = await eventRow(event.id);
    expect(row.unsignedReleasedFor).toEqual(DEADLINE);
    expect(row.freePlacesByOfferOnly).toBe(true);
    // The tick moves the version once; the memory does not.
    expect(row.version).toBe(before.version + 1);
    const [ticked] = await trail("event.free_places_by_offer_only_changed");
    expect(ticked).toMatchObject({ actorStaffUserId: null, entityId: event.id, metadataJson: { from: false, to: true, via: "deadline" } });
    const [released] = await trail("event.unsigned_released");
    expect(released).toMatchObject({ actorStaffUserId: null, entityId: event.id });
    expect(released.metadataJson).toEqual({ deadline: DEADLINE.toISOString(), released: 2, test: 1, unsigned: 1, free: 3, waiting: 1, offerOnlyTicked: true, via: "deadline" });

    // Each person released told once, the window's deadline in the payload, no club copy.
    const people = await mail("DECLARATION_HOLD_EXPIRED");
    expect(people.map((item) => item.registrationId).sort()).toEqual([ana.id, bia.id, tina.id].sort());
    for (const item of people) expect(item.payloadJson).toMatchObject({ atDeadline: DEADLINE.toISOString(), toWaitlist: false });
    // One summary to each Administrator and Superadministrator, in their language; none to the Organizer.
    const summaries = await mail("UNSIGNED_RELEASED");
    expect(summaries.map((item) => [item.recipientEmail, item.locale])).toEqual([
      ["admin@dev.test", "ro"],
      ["super@dev.test", "en"],
    ]);
    expect(summaries[0].payloadJson).toMatchObject({ eventId: event.id, deadline: DEADLINE.toISOString(), released: 2, test: 1, unsigned: 1, capacity: 3 });
    // The release's emails under its own cause, one press for the people told and the summaries — not the job's upkeep.
    const releaseMail = [...people, ...summaries];
    expect(new Set(releaseMail.map((item) => item.cause))).toEqual(new Set(["job.deadlineRelease"]));
    expect(new Set(releaseMail.map((item) => item.pressId)).size).toBe(1);
    expect(releaseMail[0].pressId).not.toBeNull();

    // A second run, and a third: nothing more.
    await runRegistrationMaintenance(db, after(20));
    await runRegistrationMaintenance(db, after(60 * 24));
    expect(await mail("DECLARATION_HOLD_EXPIRED")).toHaveLength(3);
    expect(await mail("UNSIGNED_RELEASED")).toHaveLength(2);
    expect(await trail("event.unsigned_released")).toHaveLength(1);
    expect(await statusOf(wally.id)).toBe("WAITLISTED");
  });

  it("a signature before the deadline keeps its place; one whose press reaches the deadline first is released with the rest; one after is refused", async () => {
    const event = await createRace(5);
    const ana = await join(event, "Ana");
    const bia = await join(event, "Bia");
    const cora = await join(event, "Cora");

    expect((await signDeclaration(db, event, ana.id, await signingInput(db, after(-1), "Ana Pop"), after(-1))).status).toBe("CONFIRMED");

    // Bia signs a minute after the deadline, before any job: her press is the release — and she is released with Cora.
    const late = await signDeclaration(db, event, bia.id, await signingInput(db, after(1), "Bia Pop"), after(1));
    expect(late.status).toBe("EXPIRED");
    expect(await statusOf(cora.id)).toBe("EXPIRED");
    expect(await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, bia.id))).toEqual([]);
    expect((await eventRow(event.id)).unsignedReleasedFor).toEqual(DEADLINE);
    expect((await mail("DECLARATION_HOLD_EXPIRED")).map((item) => item.registrationId).sort()).toEqual([bia.id, cora.id].sort());

    // After the release, the link is refused; the signer before it is untouched.
    expect(await refusedCode(signDeclaration(db, event, cora.id, await signingInput(db, after(2), "Cora Pop"), after(2)))).toBe("CONFLICT");
    expect(await statusOf(ana.id)).toBe("CONFIRMED");
  });

  it("nothing unsigned at the deadline: the memory and the tick, and no summary", async () => {
    const event = await createRace(5);
    const ana = await join(event, "Ana");
    await signDeclaration(db, event, ana.id, await signingInput(db, NOW, "Ana Pop"), NOW);
    await runRegistrationMaintenance(db, after(1));
    const row = await eventRow(event.id);
    expect(row.unsignedReleasedFor).toEqual(DEADLINE);
    expect(row.freePlacesByOfferOnly).toBe(true);
    expect(await mail("UNSIGNED_RELEASED")).toEqual([]);
    expect((await trail("event.unsigned_released"))[0].metadataJson).toMatchObject({ released: 0, unsigned: 0 });
  });

  it("a moved window arms it again, once more", async () => {
    let event = await createRace(5);
    await join(event, "Ana");
    await runRegistrationMaintenance(db, after(1));
    expect(await mail("UNSIGNED_RELEASED")).toHaveLength(2);

    // The organizers move the deadline a day later and let the site give places again.
    await db.update(events).set({ confirmationDeadlineDaysBefore: 1, freePlacesByOfferOnly: false }).where(eq(events.id, event.id));
    event = { ...event, confirmationDeadlineDaysBefore: 1 };
    const later = new Date(STARTS.getTime() - DAY);
    const dora = await join(event, "Dora");
    expect(dora.holdExpiresAt).toEqual(later);
    await runRegistrationMaintenance(db, new Date(later.getTime() - MINUTE));
    expect(await statusOf(dora.id)).toBe("PENDING_DECLARATION");
    await runRegistrationMaintenance(db, new Date(later.getTime() + MINUTE));
    expect(await statusOf(dora.id)).toBe("EXPIRED");
    expect((await eventRow(event.id)).unsignedReleasedFor).toEqual(later);
    expect(await mail("UNSIGNED_RELEASED")).toHaveLength(4);
    expect(await trail("event.unsigned_released")).toHaveLength(2);
  });

  it("the switch off, a cancelled event and a started one behave as before", async () => {
    // Off: a lapsed hold nobody asks for is kept (§160).
    const off = await createRace(5, { releaseUnsignedAtDeadline: false });
    const kept = await join(off, "Ana");
    // Cancelled: untouched (§331).
    const cancelled = await createRace(5);
    const stays = await join(cancelled, "Bia");
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, cancelled.id));

    await runRegistrationMaintenance(db, after(1));
    expect(await statusOf(kept.id)).toBe("PENDING_DECLARATION");
    expect(await statusOf(stays.id)).toBe("PENDING_DECLARATION");
    expect((await eventRow(off.id)).unsignedReleasedFor).toBeNull();
    expect((await eventRow(cancelled.id)).unsignedReleasedFor).toBeNull();

    // Started with the release never run: the start is the end of every unsigned hold (§160), never this release.
    const started = await createRace(5);
    await join(started, "Cora");
    await runRegistrationMaintenance(db, new Date(STARTS.getTime() + MINUTE));
    expect((await eventRow(started.id)).unsignedReleasedFor).toBeNull();
    expect(await mail("DECLARATION_HOLD_EXPIRED")).toEqual([]);
    expect(await mail("UNSIGNED_RELEASED")).toEqual([]);
  });
});

describe("BR-REQ-033-01 the job wakes at the deadline and selects the event with nobody waiting (§914)", () => {
  it("next-work names the armed deadline; the selection takes the event at it, once", async () => {
    const event = await createRace(5);
    expect(await nextMaintenanceWork(db, NOW)).toEqual(DEADLINE);
    expect(await findEventsNeedingMaintenance(db, after(-1))).not.toContain(event.id);
    expect(await findEventsNeedingMaintenance(db, after(1))).toContain(event.id);
    await runRegistrationMaintenance(db, after(1));
    expect(await findEventsNeedingMaintenance(db, after(2))).not.toContain(event.id);
    expect(await nextMaintenanceWork(db, NOW)).not.toEqual(DEADLINE);
  });

  it("the SQL twin agrees with the pure rule, event by event and instant by instant", async () => {
    const variants: Partial<typeof events.$inferInsert>[] = [
      {},
      { releaseUnsignedAtDeadline: false },
      { capacity: null },
      { eventStatus: "CANCELLED" },
      { confirmationDeadlineDaysBefore: 0 },
      { confirmationOpensDaysBefore: 0 },
      { confirmationOpensDaysBefore: 2, confirmationDeadlineDaysBefore: 2 },
      { unsignedReleasedFor: DEADLINE },
      { unsignedReleasedFor: new Date(DEADLINE.getTime() - DAY) },
    ];
    for (const over of variants) await createRace(5, over);
    const instants = [after(-1), DEADLINE, after(1), new Date(STARTS.getTime() - 1), STARTS, new Date(STARTS.getTime() + DAY)];
    const rows = await db.select().from(events);
    for (const at of instants) {
      const due = await db.select({ id: events.id, due: deadlineReleaseDueSql(at) }).from(events);
      for (const row of rows) {
        const sqlSays = due.find((item) => item.id === row.id)?.due === true;
        expect(sqlSays, `${JSON.stringify({ at, release: row.releaseUnsignedAtDeadline, capacity: row.capacity, status: row.eventStatus })}`).toBe(deadlineReleaseDue(row, at) !== null);
      }
    }
  });
});

describe("§914 «Emailuri»: the forecast lists the release and honours the places kept for the club", () => {
  it("an armed race: one lapsed-hold email per counted unsigned hold at the deadline, the Administrators' summary, and no offer", async () => {
    const event = await createRace(2);
    await join(event, "Ana");
    await join(event, "Bia");
    await join(event, "Wally");
    const rows = await forecastAutomaticEmails(db, { now: new Date(DEADLINE.getTime() - DAY), deadlines: DEFAULT_DEADLINES });
    const ofEvent = rows.filter((row) => row.eventId === event.id);
    const lapsed = ofEvent.find((row) => row.send === "holdLapsed");
    expect(lapsed).toMatchObject({ at: DEADLINE, recipients: 2, type: "DECLARATION_HOLD_EXPIRED" });
    expect(ofEvent.find((row) => row.send === "unsignedReleased")).toMatchObject({ at: DEADLINE, recipients: 2, type: "UNSIGNED_RELEASED" });
    expect(ofEvent.some((row) => row.send === "nextInLine")).toBe(false);
  });

  it("«Nu» forecasts no offer; with the kept places in use, an offer only once they are made up", async () => {
    // «Nu»: the line is never offered by itself — the release is foreseen, the offer is not.
    const byHand = await createRace(1, { releaseUnsignedAtDeadline: false, waitlistAutoOffer: false });
    await join(byHand, "Ana");
    await join(byHand, "Wally");
    // K = 1 of 3, with the club's kept place given: three taken, the site's room is −1 — the first release makes it up.
    const kept = await createRace(3, { releaseUnsignedAtDeadline: false, placesKeptForClub: 1 });
    const holds = [await join(kept, "Bia"), await join(kept, "Cora")];
    const staff = await join(kept, "Dana");
    await db.update(registrations).set({ status: "CONFIRMED", holdExpiresAt: null, confirmedAt: NOW, waitlistedAt: null }).where(eq(registrations.id, staff.id));
    const waiters = [await join(kept, "Ema"), await join(kept, "Fana")];
    expect(holds.map((row) => row.status)).toEqual(["PENDING_DECLARATION", "PENDING_DECLARATION"]);
    expect(waiters.map((row) => row.status)).toEqual(["WAITLISTED", "WAITLISTED"]);

    const rows = await forecastAutomaticEmails(db, { now: new Date(DEADLINE.getTime() - DAY), deadlines: DEFAULT_DEADLINES });
    expect(rows.filter((row) => row.eventId === byHand.id).map((row) => row.send)).not.toContain("nextInLine");
    const keptRows = rows.filter((row) => row.eventId === kept.id);
    // Two holds released for the two waiting; only one place reaches the site's room: one offer.
    expect(keptRows.find((row) => row.send === "holdLapsed")?.recipients).toBe(2);
    expect(keptRows.find((row) => row.send === "nextInLine")?.recipients).toBe(1);
  });
});
