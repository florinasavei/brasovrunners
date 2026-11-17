import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { EMAIL_OUTCOMES, type EmailOutcome } from "@/modules/notifications/domain/email-outcome";
import { readEmailHistory } from "@/modules/notifications/email-history";
import { EMAIL_SUMMARY_LINES, EMAIL_SUMMARY_PEOPLE_MAX, type EmailSummary, readEmailSummaries } from "@/modules/notifications/email-summaries";
import { resolveDisplayName } from "@/modules/registrations/names";
import { PER_PAGE_OPTIONS } from "@/modules/staff-identity/domain/admin-list-query";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the lists' «Emailuri» column reads a page of people at once (`email-summaries.ts#readEmailSummaries`): for
 * each registration, or each volunteer by the id their payload names, the person's own emails counted and the three
 * newest as «which · when · what became of it» — over PGlite, a real PostgreSQL:
 *
 * - **who** (BR-REQ-060-01): the Administrator and the Superadministrator; the desk's Volunteer, the Redactor, the
 *   Organizer, the Tehnic role and a member are refused FORBIDDEN before anything is read, never handed an empty map;
 * - **whose**: each person's own rows and nobody else's; the club's side — a copy, the archive, a notice — neither
 *   counted nor drawn, exactly as the person's own fold counts them (§915);
 * - **what**: the three newest — by the moment each line shows — and the total, which is the fold's own count; each
 *   outcome of the fold's one judgement;
 * - **the cost**: one statement a page, none for no ids; ids that are not uuids never reach PostgreSQL; a stated cap
 *   on the people asked about; three rows a person however many emails they have;
 * - **what is never read**: the statement names no address, no `last_error`, nothing of the provider's words and of the
 *   payload only the volunteer's id and the club-copy flag — held here against the statement PostgreSQL is sent.
 */

// 12:00 in Brașov on 1 October 2026 (UTC+3).
const NOW = new Date("2026-10-01T09:00:00.000Z");
const at = (iso: string) => new Date(iso);
/** Words a row carries that the column must never read: the payload's, the provider's, the last answer's. */
const PAYLOAD_WORDS = "Cuvintele mesajului, niciodată în coloană";
const PROVIDER_WORDS = "smtp.receiver said something private";
const LAST_ANSWER = "550 mailbox unavailable";

let db: TestDatabase;
let close: () => Promise<void>;
const staff = new Map<StaffRole, StaffUser>();
let eventId: string;
let maria: string;
let ion: string;
let nimeni: string;
let vlad: string;
let vera: string;
let vio: string;

/** Every statement PostgreSQL is sent, with its parameters, in order. */
let statements: Array<{ text: string; params: unknown[] }> = [];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  // Drizzle keeps the PGlite it was given on the database object; the helper's type leaves it out (`query-counts.test.ts`).
  const client = (db as TestDatabase & { $client: PGlite }).$client;
  const query = client.query.bind(client);
  client.query = (async (...args: Parameters<typeof query>) => {
    statements.push({ text: String(args[0]), params: (args[1] ?? []) as unknown[] });
    return query(...args);
  }) as typeof client.query;
});
afterAll(async () => close());

let serial = 0;
async function register(name: string): Promise<string> {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
    .returning();
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: name,
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: true,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      bibNumber: serial,
      confirmedAt: NOW,
    })
    .returning({ id: registrations.id });
  return row.id;
}

type Row = typeof emailOutbox.$inferInsert;

/** One outbox row as the worker leaves it: sent after one try unless a status says otherwise. */
function row(key: string, fields: Partial<Row>): Row {
  const status = fields.status ?? "SENT";
  return {
    participantId: null,
    registrationId: null,
    messageType: "REGISTRATION_CONFIRMED",
    locale: "ro",
    recipientEmail: "maria.pop@example.org",
    payloadJson: { note: PAYLOAD_WORDS },
    idempotencyKey: key,
    status,
    attemptCount: status === "PENDING" ? 0 : 1,
    createdAt: at("2026-10-01T08:00:00.000Z"),
    sentAt: status === "SENT" || status === "BOUNCED" ? (fields.sentAt ?? at("2026-10-01T08:00:30.000Z")) : null,
    transport: status === "SENT" ? "mailgun" : null,
    recipientCount: status === "SENT" ? 1 : null,
    ...fields,
  };
}

beforeEach(async () => {
  await resetTables(db);
  staff.clear();
  for (const [role, name] of [
    ["MEMBER", "Mara Membră"],
    ["CONTRIBUTOR", "Dan Desk"],
    ["COPYWRITER", "Rada Redactor"],
    ["MODERATOR", "Olga Organizatoarea"],
    ["DEV", "Tudor Tehnic"],
    ["ADMIN", "Ana Admin"],
    ["SUPERADMIN", "Sorin Super"],
  ] as const) {
    const [account] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.org`, displayName: name, role }).returning();
    staff.set(role, account);
  }
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", title: "Crosul de toamnă", slug: "crosul-de-toamna" },
    { eventId, locale: "en", title: "The autumn cross", slug: "the-autumn-cross" },
  ]);
  maria = await register("Maria Pop");
  ion = await register("Ion Ionescu");
  nimeni = await register("Nimeni Netrimis");
  const volunteers = await db
    .insert(eventVolunteers)
    .values([
      { eventId, name: "Vlad Voluntar", email: "vlad@example.org", canonicalEmail: "vlad@example.org", canonicalizationVersion: 2, phone: "+40712345678", source: "STAFF", guardianName: "Gina Părinte", guardianEmail: "gina@example.org" },
      { eventId, name: "Vera Alta", email: "vera@example.org", canonicalEmail: "vera@example.org", canonicalizationVersion: 2, phone: "+40712345679", source: "PUBLIC" },
      { eventId, name: "Vio Fără", email: "vio@example.org", canonicalEmail: "vio@example.org", canonicalizationVersion: 2, phone: "+40712345670", source: "PUBLIC" },
    ])
    .returning({ id: eventVolunteers.id });
  [vlad, vera, vio] = volunteers.map((volunteer) => volunteer.id);

  await db.insert(emailOutbox).values([
    // Maria's journey, oldest first: refused by her mailbox, the verification delivered, the confirmation resent by hand
    // with the club's copy of it, the declaration's archive (the club's), the reminder waiting, a number's email failed
    // for good, and the declaration's email queued a minute ago.
    row("k:joined", { messageType: "WAITLIST_JOINED", status: "BOUNCED", registrationId: maria, createdAt: at("2026-09-27T07:00:00.000Z"), sentAt: at("2026-09-27T07:00:30.000Z"), rejectedAt: at("2026-09-27T07:05:00.000Z"), rejectionCause: "mailbox-full", providerCode: "552", providerDetail: PROVIDER_WORDS, lastError: PROVIDER_WORDS }),
    row("k:verify", { messageType: "VERIFY_REGISTRATION_EMAIL", registrationId: maria, createdAt: at("2026-09-28T07:00:00.000Z"), sentAt: at("2026-09-28T07:00:20.000Z"), deliveredAt: at("2026-09-28T07:00:40.000Z") }),
    row("k:archive", { messageType: "DECLARATION_ARCHIVE", registrationId: maria, recipientEmail: "arhiva@club.test", createdAt: at("2026-09-29T07:00:00.000Z"), sentAt: at("2026-09-29T07:00:30.000Z") }),
    row("k:confirm", { registrationId: maria, attemptCount: 3, isManualResend: true, requestedByStaffUserId: staff.get("ADMIN")?.id, createdAt: at("2026-09-30T07:00:00.000Z"), sentAt: at("2026-09-30T07:20:00.000Z") }),
    row("k:confirm:club-copy:copii@club.test", { registrationId: maria, recipientEmail: "copii@club.test", payloadJson: { clubCopy: true, note: PAYLOAD_WORDS }, createdAt: at("2026-09-30T07:00:00.000Z"), sentAt: at("2026-09-30T07:20:05.000Z") }),
    row("k:reminder", { messageType: "EVENT_REMINDER", status: "PENDING", registrationId: maria, attemptCount: 3, nextAttemptAt: at("2026-10-01T09:30:00.000Z"), lastError: "421 try again later", createdAt: at("2026-10-01T06:00:00.000Z") }),
    row("k:bib", { messageType: "BIB_ASSIGNED", status: "FAILED", registrationId: maria, attemptCount: 20, lastError: LAST_ANSWER, createdAt: at("2026-10-01T07:00:00.000Z") }),
    row("k:declaration", { messageType: "COMPLETE_DECLARATION", status: "PENDING", registrationId: maria, createdAt: at("2026-10-01T08:59:00.000Z") }),
    // Ion's one email: never in Maria's lines, never in her count.
    row("k:ion", { registrationId: ion, recipientEmail: "ion@example.org", createdAt: at("2026-10-01T08:30:00.000Z"), sentAt: at("2026-10-01T08:31:00.000Z"), deliveredAt: at("2026-10-01T08:31:20.000Z") }),
    // Vlad's: the role from a press, his parent's link, and the colleagues' notice about him — the club's.
    row("k:role", { messageType: "VOLUNTEER_ROLE_ASSIGNED", recipientEmail: "vlad@example.org", payloadJson: { volunteerId: vlad, note: PAYLOAD_WORDS }, createdAt: at("2026-09-30T10:00:00.000Z"), sentAt: at("2026-09-30T10:01:00.000Z"), deliveredAt: at("2026-09-30T10:01:30.000Z") }),
    row("k:guardian", { messageType: "VOLUNTEER_GUARDIAN_REQUEST", recipientEmail: "gina@example.org", payloadJson: { volunteerId: vlad }, createdAt: at("2026-09-30T11:00:00.000Z"), sentAt: at("2026-09-30T11:00:30.000Z") }),
    row("k:vnotice", { messageType: "VOLUNTEER_CLUB_NOTICE", recipientEmail: "olga@example.org", payloadJson: { volunteerId: vlad }, createdAt: at("2026-10-01T08:00:00.000Z"), sentAt: at("2026-10-01T08:00:30.000Z") }),
    row("k:role:club-copy:copii@club.test", { messageType: "VOLUNTEER_ROLE_ASSIGNED", recipientEmail: "copii@club.test", payloadJson: { volunteerId: vlad, clubCopy: true }, createdAt: at("2026-09-30T10:00:00.000Z"), sentAt: at("2026-09-30T10:01:05.000Z") }),
    // Vera's, still waiting: never in Vlad's lines.
    row("k:vera", { messageType: "VOLUNTEER_POINT", status: "PENDING", recipientEmail: "vera@example.org", payloadJson: { volunteerId: vera }, createdAt: at("2026-09-30T12:00:00.000Z") }),
  ]);
  statements = [];
});

const admin = () => staff.get("ADMIN") as StaffUser;
const idOf = async (key: string) => (await db.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.idempotencyKey, key)))[0].id;
const ids = (keys: string[]) => Promise.all(keys.map(idOf));
const said = (summary: EmailSummary | undefined) => summary?.lines.map((line) => [line.messageType, line.outcome, line.at.toISOString()]);

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "read";
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code) return code;
    throw error;
  }
}

/** The statements `work` sends, and what it answered. */
async function sent<R>(work: () => Promise<R>): Promise<{ answer: R; statements: typeof statements }> {
  statements = [];
  const answer = await work();
  const made = statements;
  statements = [];
  return { answer, statements: made };
}

describe("BR-REQ-060-01 the lists' «Emailuri» is the Administrator's and the Superadministrator's alone (§NNN)", () => {
  it("refuses the desk's Volunteer, the Redactor, the Organizer, the Tehnic role and a member with FORBIDDEN — for registrations and for volunteers — and reads nothing", async () => {
    for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const) {
      for (const actor of [staff.get(role) as StaffUser, role]) {
        const refused = await sent(async () => [
          await codeOf(readEmailSummaries(db, actor, { registrationIds: [maria] })),
          await codeOf(readEmailSummaries(db, actor, { volunteerIds: [vlad] })),
        ]);
        expect(refused.answer, role).toEqual(["FORBIDDEN", "FORBIDDEN"]);
        // Refused before the database is asked anything: no statement at all.
        expect(refused.statements, role).toEqual([]);
      }
    }
  });

  it("reads for the Administrator and the Superadministrator, by the account or by the role alone", async () => {
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      for (const actor of [staff.get(role) as StaffUser, role]) {
        expect((await readEmailSummaries(db, actor, { registrationIds: [maria] })).get(maria)?.total, role).toBe(6);
        expect((await readEmailSummaries(db, actor, { volunteerIds: [vlad] })).get(vlad)?.total, role).toBe(2);
      }
    }
  });
});

describe("§NNN a page of registrations", () => {
  it("gives each registration its own three newest emails and its own count — another person's never, the club's copy and archive neither counted nor drawn", async () => {
    const summaries = await readEmailSummaries(db, admin(), { registrationIds: [maria, ion, nimeni] });
    expect([...summaries.keys()].sort()).toEqual([maria, ion, nimeni].sort());

    // Maria: six of her own (the club's copy and the archive are the club's), and the three newest of them.
    const hers = summaries.get(maria) as EmailSummary;
    expect(hers.total).toBe(6);
    expect(hers.lines.map((line) => line.id)).toEqual(await ids(["k:declaration", "k:bib", "k:reminder"]));
    expect(said(hers)).toEqual([
      // Waiting and failed rows never left: their moment is when they were queued.
      ["COMPLETE_DECLARATION", "waiting", "2026-10-01T08:59:00.000Z"],
      ["BIB_ASSIGNED", "failed", "2026-10-01T07:00:00.000Z"],
      ["EVENT_REMINDER", "waiting", "2026-10-01T06:00:00.000Z"],
    ]);
    expect(hers.lines.map((line) => line.id)).not.toContain(await idOf("k:ion"));

    // Ion: his one, delivered — its moment is when it left, not when it was queued.
    expect(summaries.get(ion)?.total).toBe(1);
    expect(said(summaries.get(ion))).toEqual([["REGISTRATION_CONFIRMED", "delivered", "2026-10-01T08:31:00.000Z"]]);

    // Nobody emailed this one: an answer of its own, «none», never a missing entry.
    expect(summaries.get(nimeni)).toEqual({ total: 0, lines: [] });
  });

  it("counts what the person's own fold counts (§915), and its lines are the fold's own rows", async () => {
    const summaries = await readEmailSummaries(db, admin(), { registrationIds: [maria] });
    const fold = await readEmailHistory(db, admin(), { registrationId: maria }, NOW);
    // «și încă N» and the fold's «N emailuri» are one number.
    expect(summaries.get(maria)?.total).toBe(fold.ownTotal);
    const foldIds = fold.rows.map((line) => line.id);
    for (const line of summaries.get(maria)?.lines ?? []) expect(foldIds).toContain(line.id);
    // Her emails left in the order they were queued, so the three newest are the fold's first three too.
    expect(summaries.get(maria)?.lines.map((line) => line.id)).toEqual(foldIds.slice(0, EMAIL_SUMMARY_LINES));
  });

  it("orders the lines by the moment each shows: an email held back and sent after a later one stands above it", async () => {
    // Queued 10:00 and held two minutes (it left at 10:02); queued 10:01 and sent at once (10:01:10); queued 10:01:30 and
    // still waiting, its moment the queueing; and one queued first of all that left last of all, an hour on.
    await db.insert(emailOutbox).values([
      row("k:held", { messageType: "EVENT_UPDATE_NOTICE", registrationId: nimeni, createdAt: at("2026-10-01T07:00:00.000Z"), sentAt: at("2026-10-01T07:02:00.000Z") }),
      row("k:at-once", { messageType: "ORGANIZER_MESSAGE", registrationId: nimeni, createdAt: at("2026-10-01T07:01:00.000Z"), sentAt: at("2026-10-01T07:01:10.000Z") }),
      row("k:still", { messageType: "EVENT_REMINDER", status: "PENDING", registrationId: nimeni, createdAt: at("2026-10-01T07:01:30.000Z") }),
      row("k:paced", { messageType: "BIB_ASSIGNED", registrationId: nimeni, createdAt: at("2026-10-01T06:00:00.000Z"), sentAt: at("2026-10-01T08:00:00.000Z") }),
    ]);
    const summary = (await readEmailSummaries(db, admin(), { registrationIds: [nimeni] })).get(nimeni) as EmailSummary;
    expect(summary.total).toBe(4);
    expect(said(summary)).toEqual([
      ["BIB_ASSIGNED", "sent", "2026-10-01T08:00:00.000Z"],
      ["EVENT_UPDATE_NOTICE", "sent", "2026-10-01T07:02:00.000Z"],
      ["EVENT_REMINDER", "waiting", "2026-10-01T07:01:30.000Z"],
    ]);
    // Newest first by what the line says: never an hour above a later one.
    const moments = summary.lines.map((line) => line.at.getTime());
    expect(moments).toEqual([...moments].sort((a, b) => b - a));
    // The fold is ordered by the queueing it shows first — the same emails, its own order.
    const fold = await readEmailHistory(db, admin(), { registrationId: nimeni }, NOW);
    expect(fold.rows.map((line) => line.id)).toEqual(await ids(["k:still", "k:at-once", "k:held", "k:paced"]));
    expect(fold.ownTotal).toBe(summary.total);
  });

  it("never draws more than three, however many a person has, and still counts them all", async () => {
    // Forty more for Ion, a second apart, each leaving half a minute after it was queued.
    const queuedAt = (index: number) => at("2026-10-01T08:40:00.000Z").getTime() + index * 1000;
    await db.insert(emailOutbox).values(
      Array.from({ length: 40 }, (_, index) =>
        row(`k:many:${index}`, { messageType: "EVENT_UPDATE_NOTICE", registrationId: ion, createdAt: new Date(queuedAt(index)), sentAt: new Date(queuedAt(index) + 30_000) }),
      ),
    );
    const read = await sent(() => readEmailSummaries(db, admin(), { registrationIds: [ion, maria] }));
    expect(read.answer.get(ion)?.total).toBe(41);
    expect(read.answer.get(ion)?.lines.map((line) => line.id)).toEqual(await ids(["k:many:39", "k:many:38", "k:many:37"]));
    expect(read.answer.get(maria)?.lines).toHaveLength(EMAIL_SUMMARY_LINES);
    expect(EMAIL_SUMMARY_LINES).toBe(3);
  });
});

describe("§NNN a page of volunteers", () => {
  it("gives each volunteer the rows whose payload names them — their own and their parent's link — never another volunteer's, the colleagues' notice and the club's copy neither counted nor drawn", async () => {
    const summaries = await readEmailSummaries(db, admin(), { volunteerIds: [vlad, vera, vio] });
    expect([...summaries.keys()].sort()).toEqual([vlad, vera, vio].sort());

    const his = summaries.get(vlad) as EmailSummary;
    // The notice to the colleagues is the newest row that names him, and it is the club's: not his first line, not in his count.
    expect(his.total).toBe(2);
    expect(his.lines.map((line) => line.id)).toEqual(await ids(["k:guardian", "k:role"]));
    expect(said(his)).toEqual([
      ["VOLUNTEER_GUARDIAN_REQUEST", "sent", "2026-09-30T11:00:30.000Z"],
      ["VOLUNTEER_ROLE_ASSIGNED", "delivered", "2026-09-30T10:01:00.000Z"],
    ]);

    expect(summaries.get(vera)?.total).toBe(1);
    expect(said(summaries.get(vera))).toEqual([["VOLUNTEER_POINT", "waiting", "2026-09-30T12:00:00.000Z"]]);
    expect(summaries.get(vio)).toEqual({ total: 0, lines: [] });
  });

  it("counts what the volunteer's own fold counts (§915), and its lines are the fold's own rows", async () => {
    const summaries = await readEmailSummaries(db, admin(), { volunteerIds: [vlad] });
    const fold = await readEmailHistory(db, admin(), { volunteerId: vlad }, NOW);
    expect(summaries.get(vlad)?.total).toBe(fold.ownTotal);
    // His two left in the order they were queued: the fold's rows, in the fold's order.
    expect(summaries.get(vlad)?.lines.map((line) => line.id)).toEqual(fold.rows.map((line) => line.id));
  });

  it("keeps a registration's id and a volunteer's id apart: neither kind answers for the other's", async () => {
    // A volunteer's id asked as a registration's, and the other way: the ids are real, the rows are not theirs.
    expect((await readEmailSummaries(db, admin(), { registrationIds: [vlad] })).get(vlad)).toEqual({ total: 0, lines: [] });
    expect((await readEmailSummaries(db, admin(), { volunteerIds: [maria] })).get(maria)).toEqual({ total: 0, lines: [] });
  });
});

describe("§NNN each outcome, the fold's own judgement", () => {
  it("says waiting, sent, delivered, rejected, failed and captured from the row's state and the provider's facts", async () => {
    const cases: Array<{ outcome: EmailOutcome; fields: Partial<Row>; at: string }> = [
      // Queued, and held by a worker now: neither has left.
      { outcome: "waiting", fields: { status: "PENDING" }, at: "2026-10-01T08:00:00.000Z" },
      { outcome: "waiting", fields: { status: "PROCESSING", attemptCount: 1 }, at: "2026-10-01T08:00:00.000Z" },
      // It left; nothing more is known — and it left and the recipient's server took it.
      { outcome: "sent", fields: { status: "SENT" }, at: "2026-10-01T08:00:30.000Z" },
      { outcome: "sent", fields: { status: "SENT", transport: "gmail", recipientCount: 2 }, at: "2026-10-01T08:00:30.000Z" },
      { outcome: "delivered", fields: { status: "SENT", deliveredAt: at("2026-10-01T08:01:00.000Z") }, at: "2026-10-01T08:00:30.000Z" },
      // Refused after it left, refused outright at the send (no `sent_at`: its moment is the queueing), and marked as spam.
      { outcome: "rejected", fields: { status: "BOUNCED", rejectedAt: at("2026-10-01T08:05:00.000Z"), rejectionCause: "mailbox-full" }, at: "2026-10-01T08:00:30.000Z" },
      { outcome: "rejected", fields: { status: "BOUNCED", sentAt: null, rejectionCause: "no-such-address" }, at: "2026-10-01T08:00:00.000Z" },
      { outcome: "rejected", fields: { status: "COMPLAINED", sentAt: at("2026-10-01T08:00:30.000Z"), rejectedAt: at("2026-10-01T08:09:00.000Z") }, at: "2026-10-01T08:00:30.000Z" },
      // It spent its tries and never left.
      { outcome: "failed", fields: { status: "FAILED", attemptCount: 20, lastError: LAST_ANSWER }, at: "2026-10-01T08:00:00.000Z" },
      // QA's allowlist kept it: «sent», to nobody — said even when a delivery fact stands on the row.
      { outcome: "captured", fields: { status: "SENT", recipientCount: 0 }, at: "2026-10-01T08:00:30.000Z" },
      { outcome: "captured", fields: { status: "SENT", recipientCount: 0, deliveredAt: at("2026-10-01T08:01:00.000Z") }, at: "2026-10-01T08:00:30.000Z" },
    ];
    const people: string[] = [];
    for (const [index, one] of cases.entries()) {
      const person = await register(`Persoana ${index}`);
      people.push(person);
      await db.insert(emailOutbox).values(row(`k:case:${index}`, { registrationId: person, ...one.fields }));
    }
    const read = await sent(() => readEmailSummaries(db, admin(), { registrationIds: people }));
    // A page of eleven people is one statement.
    expect(read.statements).toHaveLength(1);
    for (const [index, one] of cases.entries()) {
      const summary = read.answer.get(people[index]);
      expect(summary?.total, `case ${index}`).toBe(1);
      expect(said(summary), `case ${index}`).toEqual([["REGISTRATION_CONFIRMED", one.outcome, one.at]]);
    }
    // Every outcome of the closed set is met above: none is said only on paper.
    expect([...new Set(cases.map((one) => one.outcome))].sort()).toEqual([...EMAIL_OUTCOMES].sort());
  });
});

describe("§NNN the cost: one statement a page, none for nobody", () => {
  it("sends one statement for a page of registrations and one for a page of volunteers", async () => {
    expect((await sent(() => readEmailSummaries(db, admin(), { registrationIds: [maria, ion, nimeni] }))).statements).toHaveLength(1);
    expect((await sent(() => readEmailSummaries(db, admin(), { volunteerIds: [vlad, vera, vio] }))).statements).toHaveLength(1);
  });

  it("sends none for a page with no rows, and none when every id is malformed", async () => {
    const empty = await sent(() => readEmailSummaries(db, admin(), { registrationIds: [] }));
    expect(empty.answer.size).toBe(0);
    expect(empty.statements).toEqual([]);
    const junk = await sent(() => readEmailSummaries(db, admin(), { volunteerIds: ["not-an-id", "", "123", "' or 1=1 --"] }));
    expect(junk.answer.size).toBe(0);
    expect(junk.statements).toEqual([]);
  });

  it("drops a malformed id before the statement, answers once for an id asked twice, and keys the answer in lower case", async () => {
    const forged = "00000000-0000-4000-8000-00000000000g";
    const read = await sent(() => readEmailSummaries(db, admin(), { registrationIds: ["not-an-id", maria, forged, maria.toUpperCase(), " ", ion] }));
    expect([...read.answer.keys()].sort()).toEqual([maria, ion].sort());
    expect(read.answer.get(maria)?.total).toBe(6);
    expect(read.statements).toHaveLength(1);
    // Only the two well-formed ids are among what PostgreSQL was sent: a malformed one would be refused as no uuid.
    const sentIds = read.statements[0].params.filter((value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value));
    expect(sentIds.sort()).toEqual([maria, ion].sort());
    expect(read.statements[0].params).not.toContain("not-an-id");
    expect(read.statements[0].params).not.toContain(forged);

    const volunteers = await sent(() => readEmailSummaries(db, admin(), { volunteerIds: ["nope", vlad, vlad] }));
    expect([...volunteers.answer.keys()]).toEqual([vlad]);
    expect(volunteers.statements[0].params).not.toContain("nope");
  });

  it("asks about at most the stated number of people — a page is always whole under it — and answers three rows a person at most", async () => {
    // The lists' largest page fits whole, with room.
    expect(EMAIL_SUMMARY_PEOPLE_MAX).toBeGreaterThanOrEqual(Math.max(...PER_PAGE_OPTIONS));
    const crowd = [maria, ...Array.from({ length: EMAIL_SUMMARY_PEOPLE_MAX + 25 }, () => randomUUID())];
    const read = await sent(() => readEmailSummaries(db, admin(), { registrationIds: crowd }));
    expect(read.statements).toHaveLength(1);
    expect(read.answer.size).toBe(EMAIL_SUMMARY_PEOPLE_MAX);
    // The ids past the cap were not read: they have no entry — not «none», which would be a lie.
    expect(read.answer.has(crowd[EMAIL_SUMMARY_PEOPLE_MAX - 1])).toBe(true);
    expect(read.answer.has(crowd[EMAIL_SUMMARY_PEOPLE_MAX])).toBe(false);
    const sentIds = read.statements[0].params.filter((value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value));
    expect(sentIds).toHaveLength(EMAIL_SUMMARY_PEOPLE_MAX);
    // The three newest are cut in the statement itself, by the place of each row among its person's.
    expect(read.statements[0].text).toMatch(/row_number\(\) over \(partition by/i);
    expect(read.statements[0].text).toMatch(/count\(\*\) over \(partition by/i);
    expect(read.statements[0].params).toContain(EMAIL_SUMMARY_LINES);
  });

  it("only reads: every statement is one SELECT, and the outbox is as it was", async () => {
    const before = await db.select().from(emailOutbox);
    const read = await sent(async () => {
      await readEmailSummaries(db, admin(), { registrationIds: [maria, ion] });
      await readEmailSummaries(db, admin(), { volunteerIds: [vlad, vera] });
    });
    expect(read.statements).toHaveLength(2);
    for (const statement of read.statements) expect(statement.text.trim()).toMatch(/^select\b/i);
    expect(await db.select().from(emailOutbox)).toEqual(before);
  });
});

describe("§NNN what the column never reads", () => {
  /**
   * Every name the statement PostgreSQL is sent carries — each double-quoted identifier, once: the table, its columns
   * wherever they stand (the selection, the condition, the order), and the statement's own aliases. A column read
   * tomorrow is a name that is not on the list below.
   */
  const namesIn = (text: string) => [...new Set([...text.matchAll(/"(\w+)"/g)].map((match) => match[1]))].sort();
  /** The statement's own names: the subquery and the three values it computes. */
  const OWN_NAMES = ["person_emails", "person_id", "position", "total"];
  /** The outbox's columns the column reads: which email, its state, when it was queued and left, how many it reached, whether it was taken. */
  const READ = ["created_at", "delivered_at", "id", "message_type", "recipient_count", "sent_at", "status"];
  /** What the payload is asked: every `"payload_json" ->> <key>`, the key as written or as its parameter's value. */
  const payloadKeys = (statement: { text: string; params: unknown[] }) =>
    [...statement.text.matchAll(/"payload_json"\s*->>\s*(?:'(\w+)'|\$(\d+))/g)].map((match) => match[1] ?? String(statement.params[Number(match[2]) - 1])).sort();

  it("names only the type, the state, its times, the count it reached and the delivery — of the payload, the club-copy flag alone", async () => {
    const { statements: made } = await sent(() => readEmailSummaries(db, admin(), { registrationIds: [maria, ion] }));
    expect(namesIn(made[0].text)).toEqual(["email_outbox", "payload_json", "registration_id", ...READ, ...OWN_NAMES].sort());
    expect(payloadKeys(made[0])).toEqual(["clubCopy"]);
    // The payload is never selected whole, compared whole or cast: only asked for that one key.
    expect(made[0].text.match(/"payload_json"/g)).toHaveLength(1);
    // Found by the registration's own index: the ids are compared with the column itself.
    expect(made[0].text).toMatch(/"email_outbox"\."registration_id" in \(\$1, \$2\)/);
  });

  it("names the same for volunteers, and of the payload the club-copy flag and the volunteer's id alone", async () => {
    const { statements: made } = await sent(() => readEmailSummaries(db, admin(), { volunteerIds: [vlad, vera] }));
    expect(namesIn(made[0].text)).toEqual(["email_outbox", "payload_json", ...READ, ...OWN_NAMES].sort());
    expect([...new Set(payloadKeys(made[0]))]).toEqual(["clubCopy", "volunteerId"]);
    expect(made[0].text.match(/"payload_json"/g)).toHaveLength(payloadKeys(made[0]).length);
    // The journal's own expression, compared with the ids asked about.
    expect(made[0].text).toMatch(/\("email_outbox"\."payload_json" ->> 'volunteerId'\) in \(\$1, \$2\)/);
  });

  it("names no address, no last answer, nothing of the provider's and nobody who pressed — in either statement", async () => {
    const { statements: made } = await sent(async () => {
      await readEmailSummaries(db, admin(), { registrationIds: [maria] });
      await readEmailSummaries(db, admin(), { volunteerIds: [vlad] });
    });
    for (const statement of made) {
      for (const never of ["recipient_email", "last_error", "provider_code", "provider_detail", "provider_message_id", "rejection_cause", "idempotency_key", "requested_by_staff_user_id", "press_id", "road_failures", "participant_id", "staff_users", "event_volunteers", "registrations"]) {
        expect(statement.text, never).not.toContain(`"${never}"`);
      }
      expect(statement.text).not.toMatch(/select\s+\*/i);
    }
  });

  it("hands back nothing of the payload's words, the provider's words, a last answer or an address", async () => {
    const answers = [
      await readEmailSummaries(db, admin(), { registrationIds: [maria, ion, nimeni] }),
      await readEmailSummaries(db, admin(), { volunteerIds: [vlad, vera, vio] }),
    ];
    for (const answer of answers) {
      const text = JSON.stringify([...answer]);
      for (const never of [PAYLOAD_WORDS, PROVIDER_WORDS, LAST_ANSWER, "421 try again later", "@example.org", "@club.test", "mailbox-full"]) expect(text, never).not.toContain(never);
      // A line is four facts and nothing else.
      for (const summary of answer.values()) {
        expect(Object.keys(summary).sort()).toEqual(["lines", "total"]);
        for (const line of summary.lines) expect(Object.keys(line).sort()).toEqual(["at", "id", "messageType", "outcome"]);
      }
    }
  });

  it("the reader's source names no payload, address or error column, writes nothing and tags no cache", () => {
    const source = readFileSync(path.join(process.cwd(), "src/modules/notifications/email-summaries.ts"), "utf8");
    // The comments say what is never read, in words; the code is what is held.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const never of ["payloadJson", "recipientEmail", "lastError", "providerDetail", "providerCode", "rejectionCause", "idempotencyKey", "requestedByStaffUserId"]) {
      expect(code, never).not.toContain(never);
    }
    for (const never of [".insert(", ".update(", ".delete(", ".transaction(", ".execute(", "next/cache", "revalidate"]) expect(code, never).not.toContain(never);
    // Of the payload it reaches only through the two named expressions: the journal's id and the fold's club side.
    expect(code).toContain("VOLUNTEER_ID_OF_ROW");
    expect(code).toContain("CLUB_SIDE_OF_ROW");
    // And it asks for the role before it reads, by the fold's own assertion.
    expect(code.indexOf("assertMayReadEmailHistory(actor)")).toBeGreaterThan(-1);
    expect(code.indexOf("assertMayReadEmailHistory(actor)")).toBeLessThan(code.indexOf("db\n    .select("));
  });
});
