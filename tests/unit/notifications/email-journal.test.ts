import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { catalogueOf } from "@/i18n/catalogue";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import type { EmailJournal as Journal, JournalLine, JournalPress } from "@/modules/notifications/journal";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Emailuri azi» (the design «telling the owner about every email a staff press sends», slice 1, its section 5, and
 * the Critic corrections 4, 5 and 11): the reader and the page's component, over PGlite.
 *
 * - **The club's day**: from midnight on the club's clock — a row sent at 23:59 the day before is not today's, one
 *   queued two days ago and sent at 00:01 is; a row still waiting is listed whatever day it was queued; a failure
 *   queued today and a refusal written today are listed, yesterday's are not.
 * - **By press**: one card per press id, its cause and who pressed; a job's run is «automat», a row no press
 *   queued is «de pe site»; a club copy folds under the message it copies, the archive under its press.
 * - **The names**: the registration's, the volunteer's (the parent's on the parent's link), a colleague's account
 *   found by its canonical address.
 * - **Repeats**: the same email to the same person twice or more today is listed — counted by the canonical
 *   address, the person's own mail only, on what left only (a waiting row may yet be withdrawn) — and each line
 *   says the person's day when it is three or more.
 * - **Test rows** are marked and counted nowhere (§12.6); the counts are the real rows'.
 */
const state = vi.hoisted(() => ({ locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", async () => {
  const { createTranslator: translator } = await import("next-intl");
  const { catalogueOf: catalogue } = await import("@/i18n/catalogue");
  return {
    getTranslations: async (namespace: string) => translator({ locale: state.locale, messages: catalogue(state.locale), namespace: namespace as "Admin" }),
  };
});

const { groupEmailJournal, JOURNAL_ROW_LIMIT, readEmailJournal } = await import("@/modules/notifications/journal");
const { default: EmailJournal } = await import("@/modules/notifications/ui/EmailJournal");
const { departureContextOf } = await import("@/modules/notifications/ui/departure-words");
const { submitRegistration } = await import("@/modules/registrations/service");

// 12:00 in Brașov on 1 October 2026 (UTC+3); the club's day began at 2026-09-30T21:00Z.
const NOW = new Date("2026-10-01T09:00:00.000Z");
const DAY_START = new Date("2026-09-30T21:00:00.000Z");
const at = (iso: string) => new Date(iso);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;
let maria: string;
let tudor: string;
let vlad: string;
let journalRo: Journal;

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

async function register(event: EventInput, firstName: string, email: string, kind: "REAL" | "TEST"): Promise<string> {
  await submitRegistration(
    db,
    event,
    {
      firstName,
      lastName: "Pop",
      birthDate: "1985-03-02",
      sex: "FEMALE",
      nationality: "RO",
      country: "RO",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Ion Vecinul",
      emergencyContactPhone: "+40722222222",
      email,
      locale: "ro",
      privacyAcknowledged: true,
      fitnessDeclared: true,
      termsAccepted: true,
      rulesAcknowledged: true,
      resultsNameConsent: false,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(NOW.getTime() - 30_000).toISOString(),
    },
    NOW,
    kind,
    { source: "PUBLIC", createdByStaffUserId: null },
  );
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${firstName} Pop`));
  return row.id;
}

type Row = typeof emailOutbox.$inferInsert;

/** One outbox row as the worker leaves it: sent unless a status says otherwise. */
function row(key: string, fields: Partial<Row>): Row {
  const status = fields.status ?? "SENT";
  return {
    participantId: null,
    registrationId: null,
    messageType: "REGISTRATION_CANCELLED",
    locale: "ro",
    recipientEmail: "nobody@example.ro",
    payloadJson: {},
    idempotencyKey: key,
    status,
    attemptCount: status === "PENDING" ? 0 : 1,
    createdAt: at("2026-10-01T08:00:00.000Z"),
    sentAt: status === "SENT" || status === "BOUNCED" ? (fields.sentAt ?? at("2026-10-01T08:00:00.000Z")) : null,
    transport: status === "SENT" ? "mailgun" : null,
    recipientCount: status === "SENT" ? 1 : null,
    ...fields,
  };
}

const PRESS = { cancel: randomUUID(), rolesFirst: randomUUID(), roles: randomUUID(), job: randomUUID(), guardian: randomUUID(), invite: randomUUID() };

beforeEach(async () => {
  await resetTables(db);
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Ana Admin", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "olga@example.ro", displayName: "Olga Organizatoarea", role: "MODERATOR" }).returning();
  await db.insert(staffUsers).values({ email: "mihai.membru@example.ro", displayName: "Mihai Membru", role: "MEMBER" });

  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50, locationName: "Parcul Tractorul", editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul de toamnă", slug: "crosul-de-toamna" },
    { eventId: event.id, locale: "en", title: "The autumn cross", slug: "the-autumn-cross" },
  ]);
  const input = {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    waitlistCapacity: event.waitlistCapacity,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: null,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
  } as EventInput;
  maria = await register(input, "Maria", "maria.pop@gmail.com", "REAL");
  tudor = await register(input, "Tudor", "test-1@test.invalid", "TEST");
  [{ id: vlad }] = await db
    .insert(eventVolunteers)
    .values({ eventId: event.id, name: "Vlad Voluntar", email: "vlad@example.ro", canonicalEmail: "vlad@example.ro", canonicalizationVersion: 2, phone: "+40712345678", source: "STAFF", guardianName: "Gina Părinte", guardianEmail: "gina@example.ro" })
    .returning({ id: eventVolunteers.id });
  // The public door's own emails are not this test's: the rows below are.
  await db.delete(emailOutbox);

  await db.insert(emailOutbox).values([
    // «Anulează înscrierea», pressed by the Administrator: the person's message, the club's copy of it, the archive.
    row("k:cancel", { registrationId: maria, recipientEmail: "maria.pop@gmail.com", cause: "registrations.cancel", pressId: PRESS.cancel, requestedByStaffUserId: admin.id }),
    row("k:cancel:club-copy:copii@club.test", { registrationId: maria, recipientEmail: "copii@club.test", payloadJson: { clubCopy: true }, cause: "registrations.cancel", pressId: PRESS.cancel, requestedByStaffUserId: admin.id }),
    row("k:archive", { messageType: "DECLARATION_ARCHIVE", registrationId: maria, recipientEmail: "arhiva@club.test", cause: "registrations.cancel", pressId: PRESS.cancel, requestedByStaffUserId: admin.id }),
    // «Dă-i un rol», three times to the same person by three spellings: two left — the same email twice today — and
    // the third waits, counted nowhere: the sending withdraws a roles email a later press made stale (`render.ts`).
    row("k:role0", { messageType: "VOLUNTEER_ROLE_ASSIGNED", recipientEmail: "VLAD@example.ro", payloadJson: { volunteerId: vlad }, cause: "volunteers.assign", pressId: PRESS.rolesFirst, requestedByStaffUserId: admin.id, createdAt: at("2026-10-01T06:30:00.000Z"), sentAt: at("2026-10-01T06:31:00.000Z") }),
    row("k:role1", { messageType: "VOLUNTEER_ROLE_ASSIGNED", recipientEmail: "vlad@example.ro", payloadJson: { volunteerId: vlad }, cause: "volunteers.assign", pressId: PRESS.roles, requestedByStaffUserId: admin.id, createdAt: at("2026-10-01T07:00:00.000Z"), sentAt: at("2026-10-01T07:02:00.000Z") }),
    row("k:role2", { messageType: "VOLUNTEER_ROLE_ASSIGNED", status: "PENDING", recipientEmail: "Vlad@Example.ro", payloadJson: { volunteerId: vlad }, cause: "volunteers.assign", pressId: PRESS.roles, requestedByStaffUserId: admin.id, createdAt: at("2026-10-01T08:58:00.000Z") }),
    // The maintenance job's reminder, and the site's verification email to the same person by another spelling.
    row("k:reminder", { messageType: "EVENT_REMINDER", registrationId: maria, recipientEmail: "maria.pop@gmail.com", cause: "job.registrationMaintenance", pressId: PRESS.job, createdAt: at("2026-10-01T06:00:00.000Z"), sentAt: at("2026-10-01T06:01:00.000Z") }),
    row("k:verify", { messageType: "VERIFY_REGISTRATION_EMAIL", registrationId: maria, recipientEmail: "Maria.Pop+cros@gmail.com", createdAt: at("2026-10-01T05:00:00.000Z"), sentAt: at("2026-10-01T05:00:30.000Z") }),
    // A test registration's email: marked, counted nowhere.
    row("k:test", { messageType: "COMPLETE_DECLARATION", registrationId: tudor, recipientEmail: "test-1@test.invalid", createdAt: at("2026-10-01T08:30:00.000Z"), sentAt: at("2026-10-01T08:30:20.000Z") }),
    // The parent's link, waiting since two days ago.
    row("k:guardian", { messageType: "VOLUNTEER_GUARDIAN_REQUEST", status: "PENDING", recipientEmail: "gina@example.ro", payloadJson: { volunteerId: vlad }, cause: "volunteers.guardianLink", pressId: PRESS.guardian, requestedByStaffUserId: organizer.id, createdAt: at("2026-09-29T09:00:00.000Z") }),
    // A member added by hand: the name from the account, found by the canonical address.
    row("k:member", { messageType: "MEMBER_INVITATION", recipientEmail: "Mihai.Membru@Example.ro", cause: "club.staffInvite", pressId: PRESS.invite, requestedByStaffUserId: admin.id, createdAt: at("2026-10-01T07:30:00.000Z"), sentAt: at("2026-10-01T07:30:10.000Z") }),
    // The day's edges.
    row("k:yesterday", { recipientEmail: "ieri@example.ro", createdAt: at("2026-09-30T20:50:00.000Z"), sentAt: at("2026-09-30T20:59:00.000Z") }),
    row("k:midnight", { recipientEmail: "noaptea@example.ro", createdAt: at("2026-09-29T12:00:00.000Z"), sentAt: at("2026-09-30T21:01:00.000Z"), recipientCount: 0 }),
    row("k:failed-old", { status: "FAILED", recipientEmail: "esuat@example.ro", createdAt: at("2026-09-30T10:00:00.000Z"), lastError: "550 old" }),
    row("k:failed", { status: "FAILED", recipientEmail: "esuat@example.ro", createdAt: at("2026-10-01T03:00:00.000Z"), lastError: "550 mailbox unavailable" }),
    row("k:bounced", { status: "BOUNCED", recipientEmail: "refuzat@example.ro", createdAt: at("2026-09-30T17:00:00.000Z"), sentAt: at("2026-09-30T18:00:00.000Z"), rejectedAt: at("2026-10-01T02:00:00.000Z") }),
    row("k:bounced-old", { status: "BOUNCED", recipientEmail: "vechi@example.ro", createdAt: at("2026-09-30T17:00:00.000Z"), sentAt: at("2026-09-30T18:00:00.000Z"), rejectedAt: at("2026-09-30T19:00:00.000Z") }),
  ]);
  journalRo = await readEmailJournal(db, NOW, "ro");
});

const everyRow = (journal: Journal) =>
  [...journal.waiting, ...journal.departed].flatMap((press) => [...press.lines.flatMap((line) => [line.id, ...line.copies.map((copy) => copy.id)]), ...press.club.map((club) => club.id)]);
const idOf = async (key: string) => (await db.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.idempotencyKey, key)))[0].id;
const pressOf = (presses: readonly JournalPress[], key: string) => presses.find((press) => press.key === key);
const lineOf = async (journal: Journal, key: string): Promise<JournalLine | undefined> => {
  const id = await idOf(key);
  return [...journal.waiting, ...journal.departed].flatMap((press) => press.lines).find((line) => line.id === id);
};

describe("«Emailuri azi» reads the club's day", () => {
  it("starts at midnight on the club's clock: yesterday's last minute out, a row queued two days ago and sent at 00:01 in", async () => {
    expect(journalRo.dayStart).toEqual(DAY_START);
    const listed = new Set(everyRow(journalRo));
    for (const key of ["k:midnight", "k:cancel", "k:failed", "k:bounced", "k:guardian", "k:role0", "k:role2"]) expect(listed.has(await idOf(key)), key).toBe(true);
    for (const key of ["k:yesterday", "k:failed-old", "k:bounced-old"]) expect(listed.has(await idOf(key)), key).toBe(false);
  });

  it("lists what waits now, whatever day it was queued, apart from what left", async () => {
    const waiting = new Set(journalRo.waiting.flatMap((press) => press.lines.map((line) => line.id)));
    expect(waiting).toEqual(new Set([await idOf("k:role2"), await idOf("k:guardian")]));
    // The oldest waiting press first, as the queue reads.
    expect(journalRo.waiting.map((press) => press.key)).toEqual([PRESS.guardian, PRESS.roles]);
  });

  it("counts the real rows only: left today, waiting now, failed today — the test row in none", () => {
    expect(journalRo.counts).toEqual({ sent: 9, waiting: 2, failed: 1 });
  });
});

describe("«Emailuri azi» groups by press", () => {
  it("gives a press its cause and who pressed, the club's copy under the message it copies and the archive under the press", async () => {
    const cancel = pressOf(journalRo.departed, PRESS.cancel);
    expect(cancel).toMatchObject({ cause: "registrations.cancel", by: "Ana Admin" });
    expect(cancel?.lines.map((line) => line.recipientEmail)).toEqual(["maria.pop@gmail.com"]);
    expect(cancel?.lines[0].copies.map((copy) => copy.recipientEmail)).toEqual(["copii@club.test"]);
    expect(cancel?.club.map((club) => [club.messageType, club.recipientEmail])).toEqual([["DECLARATION_ARCHIVE", "arhiva@club.test"]]);
  });

  it("names a job's run as automatic and puts what no press queued under the site", async () => {
    expect(pressOf(journalRo.departed, PRESS.job)).toMatchObject({ cause: "job.registrationMaintenance", by: null });
    const site = pressOf(journalRo.departed, "site");
    expect(site?.cause).toBeNull();
    expect(new Set(site?.lines.map((line) => line.id))).toEqual(new Set(await Promise.all(["k:verify", "k:test", "k:midnight", "k:failed", "k:bounced"].map(idOf))));
    // A press made by one colleague and seen in both sections keeps one card in each.
    expect(pressOf(journalRo.departed, PRESS.roles)?.lines).toHaveLength(1);
    expect(pressOf(journalRo.waiting, PRESS.roles)?.lines).toHaveLength(1);
  });

  it("resolves the names: the registration's, the volunteer's, the parent's on the parent's link, a member's account by its canonical address", async () => {
    expect((await lineOf(journalRo, "k:cancel"))?.personName).toBe("Maria Pop");
    expect((await lineOf(journalRo, "k:role1"))?.personName).toBe("Vlad Voluntar");
    expect((await lineOf(journalRo, "k:guardian"))?.personName).toBe("Gina Părinte");
    expect((await lineOf(journalRo, "k:member"))?.personName).toBe("Mihai Membru");
    expect((await lineOf(journalRo, "k:midnight"))?.personName).toBeNull();
    // The event in the reader's language.
    expect((await lineOf(journalRo, "k:cancel"))?.eventTitle).toBe("Crosul de toamnă");
    expect((await lineOf(await readEmailJournal(db, NOW, "en"), "k:cancel"))?.eventTitle).toBe("The autumn cross");
  });

  it("links each person line to the person's own page (§NNN): the registration's, the volunteer's for theirs and their parent's link, none for a colleague", async () => {
    expect((await lineOf(journalRo, "k:cancel"))?.person).toEqual({ kind: "registration", id: maria });
    expect((await lineOf(journalRo, "k:verify"))?.person).toEqual({ kind: "registration", id: maria });
    expect((await lineOf(journalRo, "k:role1"))?.person).toEqual({ kind: "volunteer", id: vlad });
    expect((await lineOf(journalRo, "k:guardian"))?.person).toEqual({ kind: "volunteer", id: vlad });
    expect((await lineOf(journalRo, "k:member"))?.person).toBeNull();
    expect((await lineOf(journalRo, "k:midnight"))?.person).toBeNull();
  });

  it("keeps a failed row's sanitized reason, and only a failed row's", async () => {
    expect((await lineOf(journalRo, "k:failed"))?.lastError).toBe("550 mailbox unavailable");
    expect((await lineOf(journalRo, "k:cancel"))?.lastError).toBeNull();
  });
});

describe("«Emailuri azi» marks repeats and test rows", () => {
  it("lists the same email to the same person twice today, by the canonical address, counting what left", async () => {
    // Two left, the third waits: «de 2 ori», never 3, and the address as the latest row that left spelled it.
    expect(journalRo.repeats).toEqual([{ personName: "Vlad Voluntar", recipientEmail: "vlad@example.ro", messageType: "VOLUNTEER_ROLE_ASSIGNED", count: 2 }]);
    expect((await lineOf(journalRo, "k:role0"))?.sameTypeCount).toBe(2);
    expect((await lineOf(journalRo, "k:role1"))?.sameTypeCount).toBe(2);
    expect((await lineOf(journalRo, "k:role2"))?.sameTypeCount).toBe(0);
    expect((await lineOf(journalRo, "k:cancel"))?.sameTypeCount).toBe(1);
  });

  it("never warns of what waits: one that left and one waiting are no repeat, three waiting none either — the sending may withdraw them", async () => {
    await db.delete(emailOutbox).where(eq(emailOutbox.idempotencyKey, "k:role0"));
    const pair = await readEmailJournal(db, NOW, "ro");
    expect(pair.repeats).toEqual([]);
    expect((await lineOf(pair, "k:role1"))?.sameTypeCount).toBe(1);
    expect(await lineOf(pair, "k:role2")).toMatchObject({ sameTypeCount: 0, dayCount: 0 });

    // Three roles given in three presses, all three waiting (the hold after the last press, §901, then the next run): the person gets one.
    await db.delete(emailOutbox).where(eq(emailOutbox.idempotencyKey, "k:role1"));
    await db.insert(emailOutbox).values(
      ["k:role3", "k:role4"].map((key, index) =>
        row(key, { messageType: "VOLUNTEER_ROLE_ASSIGNED", status: "PENDING", recipientEmail: "vlad@example.ro", payloadJson: { volunteerId: vlad }, cause: "volunteers.assign", pressId: randomUUID(), requestedByStaffUserId: admin.id, createdAt: at(`2026-10-01T08:5${8 + index}:30.000Z`) }),
      ),
    );
    const waiting = await readEmailJournal(db, NOW, "ro");
    expect(waiting.waiting.flatMap((press) => press.lines).filter((line) => line.messageType === "VOLUNTEER_ROLE_ASSIGNED")).toHaveLength(3);
    expect(waiting.repeats).toEqual([]);
  });

  it("says a person's day on each of their lines — three emails by three spellings of one address — never the club's, never a waiting line", async () => {
    for (const key of ["k:cancel", "k:reminder", "k:verify"]) expect((await lineOf(journalRo, key))?.dayCount, key).toBe(3);
    expect((await lineOf(journalRo, "k:member"))?.dayCount).toBe(1);
    // The parent's link has not left: it counts for nobody's day yet.
    expect((await lineOf(journalRo, "k:guardian"))?.dayCount).toBe(0);
  });

  it("marks a test registration's row and counts it nowhere", async () => {
    const test = await lineOf(journalRo, "k:test");
    expect(test).toMatchObject({ test: true, dayCount: 0, sameTypeCount: 0 });
    expect((await lineOf(journalRo, "k:cancel"))?.test).toBe(false);
  });

  it("caps the page at its limit and says how many more there are", async () => {
    await db.insert(emailOutbox).values(
      Array.from({ length: JOURNAL_ROW_LIMIT + 1 }, (_, index) =>
        row(`k:bulk:${index}`, { messageType: "NEWSLETTER", recipientEmail: `abonat${index}@example.ro`, createdAt: at("2026-10-01T08:40:00.000Z"), sentAt: at("2026-10-01T08:45:00.000Z") }),
      ),
    );
    const journal = await readEmailJournal(db, NOW, "ro");
    const drawn = everyRow(journal).length;
    expect(drawn).toBe(JOURNAL_ROW_LIMIT);
    // Every row of the day, minus the ones drawn.
    expect(journal.more).toBe(JOURNAL_ROW_LIMIT + 1 + 14 - JOURNAL_ROW_LIMIT);
  });

  it("groups the rows it is given the same way without the database", () => {
    const grouped = groupEmailJournal([], [], { dayStart: DAY_START, counts: { sent: 0, waiting: 0, failed: 0 }, more: 0 });
    expect(grouped).toEqual({ dayStart: DAY_START, waiting: [], departed: [], counts: { sent: 0, waiting: 0, failed: 0 }, repeats: [], more: 0 });
  });
});

describe("the «Emailuri azi» page draws the day", () => {
  const delivery = {
    timing: "scheduled" as const,
    pending: 2,
    waitMinutes: 15,
    scheduledWait: { day: 15, night: 60 },
    nextTickAt: "2026-10-01T09:15:00.000Z",
    lastRunAt: "2026-10-01T08:45:00.000Z",
    holds: { pingerMinutes: 15, intervalMinutes: 0, governorFloorMinutes: 0 },
    overdueCadenceMinutes: 0,
  };
  const volume = {
    period: "day",
    waitingMessages: 2,
    sentMessages: 8,
    sentThisMonth: 8,
    allowance: 100,
    remaining: 92,
    planName: "Free",
    hourPaceHolds: false,
    whileStopped: { road: "mailgun" },
  } as unknown as Parameters<typeof EmailJournal>[0]["volume"];

  async function html(locale: "ro" | "en", journal: Journal): Promise<string> {
    state.locale = locale;
    const element = await EmailJournal({ locale, journal, volume, departure: departureContextOf({ now: NOW, delivery, volume }), now: NOW });
    return renderToStaticMarkup(element as ReactElement).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
  }

  it("says the counts, the repeats, each press and each line's state, in Romanian", async () => {
    const page = await html("ro", journalRo);
    const ro = catalogueOf("ro") as unknown as { Admin: { emails: { today: Record<string, string> } } };
    expect(page).toContain("Emailuri azi");
    expect(page).toContain("Plecate: 9 · Așteaptă: 2 · Eșuate: 1");
    // The address as the latest of the two rows spelled it: one person, whichever spelling.
    expect(page).toMatch(/Vlad Voluntar · vlad@example\.ro — „Rolul tău de voluntar”, de 2 ori azi/i);
    expect(page).toMatch(/11:00 · Anulează înscrierea · de Ana Admin/);
    expect(page).toContain("automat: întreținerea înscrierilor");
    expect(page).toContain("De pe site");
    expect(page).toContain("+ 1 pentru căsuțele clubului");
    expect(page).toContain("Nu a ajuns la nimeni (QA)");
    expect(page).toContain(">Refuzat<");
    expect(page).toContain(">Eșuat<");
    expect(page).toContain("A plecat la 11:00");
    expect(page).toContain("3 emailuri azi");
    expect(page).toContain('data-test-row="true"');
    // The waiting rows say when they leave in the queue's own words, the parent's link late after two days.
    expect(page).toContain("Pleacă: 12:15 (estimat).");
    expect(page).toContain("Întârziat: trebuia să fi plecat deja.");
    expect(page).toContain(ro.Admin.emails.today.footnote);
    expect(page).not.toMatch(/emails\.(today|causes|types)\./);
    // A person's name opens their own page (§NNN), a plain anchor a thumb reaches; a colleague's does not.
    expect(page).toMatch(new RegExp(`<a [^>]*href="/ro/admin/registrations/${maria}"[^>]*data-testid="email-journal-person"[^>]*>Maria Pop</a>`));
    expect(page).toMatch(new RegExp(`<a [^>]*href="/ro/admin/volunteers/${vlad}"[^>]*>Vlad Voluntar</a>`));
    expect(page).toMatch(new RegExp(`<a [^>]*href="/ro/admin/volunteers/${vlad}"[^>]*>Gina Părinte</a>`));
    expect(page).not.toMatch(/<a [^>]*>Mihai Membru<\/a>/);
  });

  it("says the same in English", async () => {
    const page = await html("en", await readEmailJournal(db, NOW, "en"));
    expect(page).toContain("Today&#x27;s emails");
    expect(page).toContain("Sent: 9 · Waiting: 2 · Failed: 1");
    expect(page).toContain("From the site");
    expect(page).toContain("automatic: the registrations&#x27; upkeep");
    expect(page).toContain("by Ana Admin");
    expect(page).toContain("+ 1 to the club&#x27;s mailboxes");
    expect(page).toContain("2 times today");
    expect(page).not.toMatch(/emails\.(today|causes|types)\./);
  });

  it("says nothing waits and nothing left on an empty day", async () => {
    const empty = groupEmailJournal([], [], { dayStart: DAY_START, counts: { sent: 0, waiting: 0, failed: 0 }, more: 0 });
    const page = await html("ro", empty);
    expect(page).toContain("Nu așteaptă niciun email.");
    expect(page).toContain("Niciun email nu a plecat azi.");
    expect(page).not.toContain('data-testid="email-journal-repeats"');
  });

  it("folds more than five lines of one email in one press behind a line that says how many", () => {
    const t = createTranslator({ locale: "ro", messages: catalogueOf("ro"), namespace: "Admin" });
    expect(t("emails.today.toMany", { type: "x", people: t("emails.today.people.few", { count: 6 }) })).toBe("„x” către 6 persoane");
  });
});
