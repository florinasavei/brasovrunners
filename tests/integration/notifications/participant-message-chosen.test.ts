import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationReconfirmations } from "@/db/schema/registration-reconfirmations";
import { type Registration, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { CHOSEN_AUDIENCE, CHOSEN_FIELD, CONFIRM_COUNT_FIELD } from "@/modules/notifications/domain/organizer-message";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { newCheckinCode } from "@/modules/registrations/checkin-code";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { NEVER_KEPT } from "@/shared/forms/outcome";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { confirmed } from "../../helpers/typed-count";

/**
 * §NNN — «Doar anumiți participanți, pe care îi aleg din listă» on «Trimite un mesaj participanților» (the owner,
 * 2026-11-13: «As vrea sa fac un test pentru mailul asta, sa selectez doar anumiti participanti»; BR-REQ-080-01,
 * BR-REQ-080-02, BR-REQ-060-01).
 *
 * A fifth choice of «Cui îi trimiți» that is not a group: the people ticked. The send is the group's send in every
 * respect — the lock, one row a registration in its language, each flag on its own rows, the club's one copy, the audit
 * row, a second press that queues nothing — and reaches exactly the ticked that are this event's and active: a tick on a
 * cancelled, lapsed or unconfirmed-address registration, on another event's or on nobody writes to nobody. The audit row
 * says the choice and the counts, never who. After such a send, and after no other, its words can be read back for the
 * boxes.
 *
 * And «Scrie la câți trimiți» (the owner, of the same message: «si vreau extra extra confirmare»): every send, to a group
 * or to the ticked, goes only when the number typed is exactly the number of real registrations it is about to write to,
 * counted under the lock — the bulk erase's guard (§287). Any other number, nothing typed and a caller that forgot it
 * queue nothing, and the refusal says how many there are now. All people here are made up.
 */
const DAY = 86_400_000;

const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: url });
  },
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { sendParticipantMessage, listParticipantMessages, listChoosableRecipients, readKeptMessage } = await import("@/modules/notifications/participant-messages");
const { updateClubNotices } = await import("@/modules/notifications/club-notices");
const { sendParticipantMessageAction } = await import("@/app/[locale]/admin/events/[id]/mesaje/actions");

const WORDS = {
  subject: { ro: "Probă: ne vedem la {eventTitle}", en: "Trial: see you at {eventTitle}" },
  body: { ro: "Bună, {participantName}!\n\nMasa de ridicare se deschide la 8:00.", en: "Hi {participantName}!\n\nThe pickup desk opens at 8:00." },
};

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
let organizer: StaffUser;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  organizer = await staff("MODERATOR");
  eventId = await race("Crosul Tâmpei");
});

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Staff ${serial}`, role }).returning();
  return user;
}

async function race(title: string): Promise<string> {
  serial += 1;
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date(Date.now() + 10 * DAY),
      timezone: "Europe/Bucharest",
      locationName: "Parcul Tractorul",
      registrationMode: "INTERNAL",
      capacity: 50,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date(),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title, slug: `cros-${serial}-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: `${title} (en)`, slug: `cross-${serial}-${event.id.slice(0, 8)}` },
  ]);
  return event.id;
}

type Extra = { kind?: "REAL" | "TEST"; locale?: "ro" | "en"; event?: string };

/** A made-up registration at `status`, on an address of its own. */
async function person(name: string, status: RegistrationStatus, extra: Extra = {}): Promise<Registration> {
  serial += 1;
  const [owner] = await db
    .insert(participants)
    .values({ ...canonicalizeEmail(`runner-${serial}@example.test`), defaultName: name })
    .returning();
  const [row] = await db
    .insert(registrations)
    .values({
      eventId: extra.event ?? eventId,
      participantId: owner.id,
      status,
      kind: extra.kind ?? "REAL",
      locale: extra.locale ?? "ro",
      registeredName: name,
      displayName: name,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: true,
      tshirtSize: "NONE",
      waitlistedAt: status === "WAITLISTED" || status === "WAITLIST_OFFERED" ? new Date() : null,
      holdExpiresAt: status === "PENDING_DECLARATION" || status === "WAITLIST_OFFERED" ? new Date(Date.now() + 2 * DAY) : null,
      offerCreatedAt: status === "WAITLIST_OFFERED" ? new Date() : null,
      confirmedAt: status === "CONFIRMED" ? new Date() : null,
      checkinCode: status === "CONFIRMED" ? newCheckinCode() : null,
      ...(status === "CANCELLED" ? { cancelledAt: new Date(), cancellationSource: "PARTICIPANT" as const } : {}),
      ...(status === "EXPIRED" ? { expiredAt: new Date(), expiryReason: "DECLARATION_HOLD_LAPSED" as const } : {}),
    })
    .returning();
  return row;
}

/**
 * A send to the people ticked, each press a form of its own — by an organizer who typed the number of recipients the page
 * showed (`confirmed`), unless the test types its own.
 */
const sendTo = async (ticked: readonly unknown[] | undefined, overrides: Partial<Parameters<typeof sendParticipantMessage>[2]> = {}, actor: StaffUser = organizer) =>
  sendParticipantMessage(db, actor, await confirmed(db, { eventId, audience: CHOSEN_AUDIENCE, registrationIds: ticked, sendId: randomUUID(), ...WORDS, ...overrides }), new Date());

/** The participants' own rows of the organizers' message — never the club's copy, which has no participant. */
const ownRows = () => db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), isNotNull(emailOutbox.participantId)));
const clubCopies = () => db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), isNull(emailOutbox.participantId)));
const sendAudits = () => db.select().from(auditLogs).where(eq(auditLogs.action, "event.participant_message_sent"));
const writtenTo = async () => (await ownRows()).map((row) => row.registrationId).sort();

async function refusalOf(attempt: Promise<unknown>) {
  try {
    await attempt;
    return undefined;
  } catch (caught) {
    if (isDomainError(caught)) return { code: caught.code, fields: caught.fields };
    throw caught;
  }
}

describe("§NNN the send writes to the people ticked, and to nobody else", () => {
  it("queues one row for each ticked registration that is this event's and active — whatever else was ticked", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "WAITLISTED", { locale: "en" });
    const carmen = await person("Carmen", "CONFIRMED");
    const cancelled = await person("Gabi", "CANCELLED");
    const lapsed = await person("Horia", "EXPIRED");
    const unconfirmed = await person("Felix", "PENDING_EMAIL_CONFIRMATION");
    const elsewhere = await person("Ioana", "CONFIRMED", { event: await race("Altă cursă") });
    const sendId = randomUUID();

    // Ana twice, in another case too; three who are registered but never written to; another event's runner; nobody's id; junk.
    const ticked = [ana.id, bogdan.id, ana.id, ana.id.toUpperCase(), cancelled.id, lapsed.id, unconfirmed.id, elsewhere.id, randomUUID(), "", "ana", 7, null];
    expect(await sendTo(ticked, { sendId })).toEqual({ kind: "queued", real: 2, test: 0 });

    const rows = await ownRows();
    expect(rows.map((row) => row.registrationId).sort()).toEqual([ana.id, bogdan.id].sort());
    for (const row of rows) {
      expect(row.payloadJson).toEqual(WORDS);
      expect(row.idempotencyKey).toBe(`organizer-message:${sendId}:registration:${row.registrationId}`);
      expect(row.requestedByStaffUserId).toBe(organizer.id);
    }
    // Each in the language they registered in, as for a group.
    expect(rows.find((row) => row.registrationId === bogdan.id)?.locale).toBe("en");
    // Carmen is active and was not ticked: a send to the ticked is never a send to the group.
    expect(rows.some((row) => row.registrationId === carmen.id)).toBe(false);
  });

  it("writes to a ticked test registration like a real one, and counts it apart (§12.6)", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const probe = await person("Test", "CONFIRMED", { kind: "TEST" });
    expect(await sendTo([ana.id, probe.id])).toEqual({ kind: "queued", real: 1, test: 1 });
    expect(await writtenTo()).toEqual([ana.id, probe.id].sort());
    // A test row alone: written to, and no club copy rides with a send that reaches no real participant.
    const admin = await staff("ADMIN");
    await updateClubNotices(db, admin, { participants: { bcc: ["arhiva@club.test"] } }, new Date());
    expect(await sendTo([probe.id])).toEqual({ kind: "queued", real: 0, test: 1 });
    expect(await clubCopies()).toEqual([]);
  });

  it("queues and audits nothing when nobody is ticked, or nobody ticked can be written to", async () => {
    await person("Ana", "CONFIRMED");
    const cancelled = await person("Gabi", "CANCELLED");
    const elsewhere = await person("Ioana", "CONFIRMED", { event: await race("Altă cursă") });
    for (const ticked of [[], undefined, [cancelled.id], [elsewhere.id], [randomUUID()], ["ana", ""]]) {
      expect(await sendTo(ticked), JSON.stringify(ticked)).toEqual({ kind: "nobody" });
    }
    expect(await ownRows()).toEqual([]);
    expect(await sendAudits()).toEqual([]);
  });

  it("reads the ticks only for that choice: a send to a group reaches its group, ticks or not", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "WAITLISTED");
    expect(await sendTo([bogdan.id], { audience: "CONFIRMED" })).toEqual({ kind: "queued", real: 1, test: 0 });
    expect(await writtenTo()).toEqual([ana.id]);
  });

  it("puts each flag on its own rows, as a send to a group does: «Vin» where it can be answered, the QR where confirmed", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "WAITLISTED");
    const dan = await person("Dan", "WAITLIST_OFFERED");
    const unticked = await person("Carmen", "CONFIRMED");
    const sendId = randomUUID();
    await sendTo([ana.id, bogdan.id, dan.id], { sendId, askReconfirm: true, sendQr: true });

    const payloadOf = async (id: string) => (await ownRows()).find((row) => row.registrationId === id)?.payloadJson;
    expect(await payloadOf(ana.id)).toEqual({ ...WORDS, askReconfirm: true, sendQr: true });
    expect(await payloadOf(bogdan.id)).toEqual({ ...WORDS, askReconfirm: true });
    expect(await payloadOf(dan.id)).toEqual(WORDS);
    // An ask only for the ticked that can answer — never for somebody the send did not write to.
    const asks = await db.select().from(registrationReconfirmations);
    expect(asks.map((ask) => ask.registrationId).sort()).toEqual([ana.id, bogdan.id].sort());
    expect(asks.some((ask) => ask.registrationId === unticked.id)).toBe(false);
    const [audit] = await sendAudits();
    expect(audit.metadataJson).toMatchObject({ audience: CHOSEN_AUDIENCE, recipients: 3, askReconfirm: true, asked: 2, askedTest: 0, sendQr: true, withQr: 1, withQrTest: 0 });
  });

  it("gives the club one copy of the send, with how many real people it reached — and a second press queues nothing", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "PENDING_DECLARATION");
    await person("Carmen", "CONFIRMED");
    const admin = await staff("ADMIN");
    await updateClubNotices(db, admin, { participants: { bcc: ["arhiva@club.test", "presedinte@club.test"] } }, new Date());
    const sendId = randomUUID();
    expect(await sendTo([ana.id, bogdan.id], { sendId })).toEqual({ kind: "queued", real: 2, test: 0 });

    const copies = await clubCopies();
    expect(copies.map((copy) => copy.recipientEmail).sort()).toEqual(["arhiva@club.test", "presedinte@club.test"]);
    for (const copy of copies) expect(copy.payloadJson).toEqual({ ...WORDS, clubCopy: true, eventId, recipients: 2 });

    // The same form again, with somebody else ticked too: it was sent already, and nobody new is written to.
    const before = (await db.select().from(emailOutbox)).length;
    const carmen = (await db.select().from(registrations).where(eq(registrations.registeredName, "Carmen")))[0];
    expect(await sendTo([ana.id, bogdan.id, carmen.id], { sendId })).toEqual({ kind: "duplicate" });
    expect((await db.select().from(emailOutbox)).length).toBe(before);
    expect(await sendAudits()).toHaveLength(1);
  });

  it("audits the choice, the counts and the subject — and never who was ticked", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "WAITLISTED");
    const sendId = randomUUID();
    await sendTo([ana.id, bogdan.id], { sendId });
    const [audit] = await sendAudits();
    expect(audit.actorStaffUserId).toBe(organizer.id);
    expect(audit.entityId).toBe(eventId);
    expect(audit.participantId).toBeNull();
    expect(audit.metadataJson).toEqual({ sendId, audience: CHOSEN_AUDIENCE, recipients: 2, test: 0, subject: WORDS.subject });
    const trail = JSON.stringify(audit);
    for (const secret of [ana.id, bogdan.id, ana.participantId, bogdan.participantId, "@example.test", "Masa de ridicare"]) expect(trail).not.toContain(secret);

    // «Mesaje trimise» reads the choice from the same row.
    expect(await listParticipantMessages(db, eventId)).toMatchObject([{ sendId, audience: CHOSEN_AUDIENCE, recipients: 2, test: 0, askReconfirm: false, sendQr: false }]);
  });

  it("refuses a role that may not write to participants, whoever is ticked (BR-REQ-060-01)", async () => {
    const ana = await person("Ana", "CONFIRMED");
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      expect(await refusalOf(sendTo([ana.id], {}, await staff(role))), role).toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await ownRows()).toEqual([]);
  });
});

describe("§NNN «Scrie la câți trimiți»: the send insists on the number of recipients, typed", () => {
  /** Three real people active, a test registration and a cancelled one: «Toți cei înscriși» is 3. */
  async function five() {
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "CONFIRMED");
    const carmen = await person("Carmen", "WAITLISTED");
    const probe = await person("Test", "CONFIRMED", { kind: "TEST" });
    await person("Gabi", "CANCELLED");
    return { ana, bogdan, carmen, probe };
  }
  const toEverybody = (confirmCount: string, sendId: string = randomUUID()) => sendTo(undefined, { audience: "ALL_ACTIVE", confirmCount, sendId });
  const nothingWritten = async () => {
    expect(await ownRows()).toEqual([]);
    expect(await clubCopies()).toEqual([]);
    expect(await sendAudits()).toEqual([]);
    expect(await db.select().from(registrationReconfirmations)).toEqual([]);
  };

  it("queues nothing for any other number, for nothing typed and for a caller that forgot it — and says how many there are now", async () => {
    await five();
    for (const typed of ["2", "4", "0", "", " ", "03", "3.0", "+3", "trei", "3 participanți", "3\n3"]) {
      expect(await sendTo(undefined, { audience: "ALL_ACTIVE", confirmCount: typed, askReconfirm: true }), JSON.stringify(typed)).toEqual({ kind: "miscounted", real: 3 });
    }
    // A caller that never asked anybody — past this file's own helper, which types the number: the type forbids it, and
    // the send refuses it all the same.
    const forgot = { eventId, audience: "ALL_ACTIVE", sendId: randomUUID(), ...WORDS } as unknown as Parameters<typeof sendParticipantMessage>[2];
    expect(await sendParticipantMessage(db, organizer, forgot, new Date())).toEqual({ kind: "miscounted", real: 3 });
    await nothingWritten();
  });

  it("sends when the number is exactly that of the real registrations it writes to: the test registration is not counted, the keyboard's spaces are forgiven", async () => {
    await five();
    expect(await toEverybody("3")).toEqual({ kind: "queued", real: 3, test: 1 });
    expect(await toEverybody(" 3 ")).toEqual({ kind: "queued", real: 3, test: 1 });
    // Counting the test registration too is another number.
    expect(await toEverybody("4")).toEqual({ kind: "miscounted", real: 3 });
  });

  it("stops the press it is for: two people in mind, and «Toți cei înscriși» chosen", async () => {
    const { ana, bogdan } = await five();
    expect(await toEverybody("2")).toEqual({ kind: "miscounted", real: 3 });
    await nothingWritten();
    // The same number with those two ticked is the send that was meant.
    expect(await sendTo([ana.id, bogdan.id], { confirmCount: "2" })).toEqual({ kind: "queued", real: 2, test: 0 });
    expect(await writtenTo()).toEqual([ana.id, bogdan.id].sort());
  });

  it("holds a send to the ticked to the real people ticked — whoever else was ticked", async () => {
    const { ana, bogdan, probe } = await five();
    const cancelled = (await db.select().from(registrations).where(eq(registrations.registeredName, "Gabi")))[0];
    const ticked = [ana.id, bogdan.id, probe.id, cancelled.id];
    // Four ticks, two of them real and active: the number is 2.
    for (const typed of ["4", "3", "1"]) expect(await sendTo(ticked, { confirmCount: typed }), typed).toEqual({ kind: "miscounted", real: 2 });
    await nothingWritten();
    expect(await sendTo(ticked, { confirmCount: "2" })).toEqual({ kind: "queued", real: 2, test: 1 });
    // Test registrations alone: nobody the club counts, and the number is 0.
    expect(await sendTo([probe.id], { confirmCount: "1" })).toEqual({ kind: "miscounted", real: 0 });
    expect(await sendTo([probe.id], { confirmCount: "0" })).toEqual({ kind: "queued", real: 0, test: 1 });
  });

  it("is true of the very send: a group that changed since the number was read is refused with the number now", async () => {
    await five();
    // The page said 3; somebody confirmed before the press.
    await person("Dana", "CONFIRMED");
    expect(await toEverybody("3")).toEqual({ kind: "miscounted", real: 4 });
    await nothingWritten();
    expect(await toEverybody("4")).toEqual({ kind: "queued", real: 4, test: 1 });
  });

  it("asks nothing of a press that sends nothing anyway: a form already sent, an empty group", async () => {
    await five();
    const sendId = randomUUID();
    expect(await toEverybody("3", sendId)).toEqual({ kind: "queued", real: 3, test: 1 });
    expect(await toEverybody("999", sendId)).toEqual({ kind: "duplicate" });
    expect(await sendTo(undefined, { audience: "PENDING_DECLARATION", confirmCount: "7" })).toEqual({ kind: "nobody" });
    expect(await sendAudits()).toHaveLength(1);
  });

  it("is refused before it for a role that may not write, a message in one language and an event that is not there", async () => {
    await five();
    expect(await refusalOf(sendTo(undefined, { audience: "ALL_ACTIVE", confirmCount: "3" }, await staff("DEV")))).toMatchObject({ code: "FORBIDDEN" });
    expect(await refusalOf(sendTo(undefined, { audience: "ALL_ACTIVE", confirmCount: "999", body: { ro: "Doar română.", en: "" } }))).toEqual({ code: "VALIDATION_ERROR", fields: ["bodyEn"] });
    expect(await refusalOf(sendTo(undefined, { audience: "ALL_ACTIVE", confirmCount: "3", eventId: randomUUID() }))).toMatchObject({ code: "NOT_FOUND" });
    await nothingWritten();
  });

  it("is a box the form never hands back, named in both languages with the number now", () => {
    expect(CONFIRM_COUNT_FIELD).toBe("confirmCount");
    // Typed again after every refusal (§315): a kept number would be the guard filling itself in.
    expect(NEVER_KEPT.has(CONFIRM_COUNT_FIELD)).toBe(true);
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.errors.MESSAGE_COUNT_MISMATCH).toContain("{actual}");
      expect(catalogue.Admin.participantMessages.typedCount.label).not.toBe("");
    }
    expect(ro.Admin.participantMessages.typedCount).toEqual({
      title: "Confirmă trimiterea",
      label: "Scrie la câți trimiți",
      help: "Exact numărul de destinatari de mai sus — altfel nu pleacă nimic.",
    });
  });
});

describe("§NNN who can be ticked", () => {
  it("lists this event's active registrations by name as Romanian sorts it, with a state and a test row's mark — and nothing else of a person", async () => {
    const zoe = await person("Zoe Albu", "CONFIRMED");
    const stefan = await person("Ștefan Pop", "WAITLISTED");
    const stela = await person("Stela Ene", "PENDING_DECLARATION");
    const ana = await person("Ana Țurcanu", "WAITLIST_OFFERED");
    const probe = await person("Test Unu", "CONFIRMED", { kind: "TEST" });
    await person("Gabi", "CANCELLED");
    await person("Horia", "EXPIRED");
    await person("Felix", "PENDING_EMAIL_CONFIRMATION");
    await person("Ioana", "CONFIRMED", { event: await race("Altă cursă") });

    const people = await listChoosableRecipients(db, eventId);
    // The Romanian alphabet: Ș is its own letter, after S and before T — «Ștefan» after «Stela», never after «Zoe».
    expect(people).toEqual([
      { id: ana.id, name: "Ana Țurcanu", status: "WAITLIST_OFFERED", test: false },
      { id: stela.id, name: "Stela Ene", status: "PENDING_DECLARATION", test: false },
      { id: stefan.id, name: "Ștefan Pop", status: "WAITLISTED", test: false },
      { id: probe.id, name: "Test Unu", status: "CONFIRMED", test: true },
      { id: zoe.id, name: "Zoe Albu", status: "CONFIRMED", test: false },
    ]);
    expect(JSON.stringify(people)).not.toContain("@");
    // Exactly the people a send to everybody ticked reaches.
    expect(await sendTo(people.map((one) => one.id))).toEqual({ kind: "queued", real: 4, test: 1 });
  });

  it("is an empty list for an event nobody is registered for", async () => {
    expect(await listChoosableRecipients(db, eventId)).toEqual([]);
  });
});

describe("§NNN the words stay after a send to the people ticked", () => {
  it("reads back that send's words and its two ticks — for this event only", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "WAITLIST_OFFERED");
    const sendId = randomUUID();
    await sendTo([ana.id, bogdan.id], { sendId, sendQr: true });
    // The ticks are the send's, whatever each row carries: Bogdan's row has no flag of its own.
    expect(await readKeptMessage(db, eventId, sendId)).toEqual({ ...WORDS, askReconfirm: false, sendQr: true });

    const both = randomUUID();
    await sendTo([bogdan.id], { sendId: both, askReconfirm: true, sendQr: true });
    expect(await readKeptMessage(db, eventId, both)).toEqual({ ...WORDS, askReconfirm: true, sendQr: true });

    expect(await readKeptMessage(db, await race("Altă cursă"), sendId)).toBeNull();
    expect(await readKeptMessage(db, eventId, randomUUID())).toBeNull();
    for (const malformed of ["", "nope", `${sendId}'`, "%"]) expect(await readKeptMessage(db, eventId, malformed)).toBeNull();
  });

  it("hands back nothing after a send to a group (§364: its next press is a new message), or once the send's rows are gone", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const group = randomUUID();
    await sendTo(undefined, { sendId: group, audience: "ALL_ACTIVE" });
    expect(await readKeptMessage(db, eventId, group)).toBeNull();

    const sendId = randomUUID();
    await sendTo([ana.id], { sendId });
    expect(await readKeptMessage(db, eventId, sendId)).not.toBeNull();
    await db.delete(emailOutbox);
    expect(await readKeptMessage(db, eventId, sendId)).toBeNull();
  });
});

describe("§NNN the form's ticks reach the send", () => {
  function form(ticked: readonly string[], fields: Record<string, string> = {}): FormData {
    const posted = new FormData();
    posted.set("uiLocale", "ro");
    posted.set("eventId", eventId);
    posted.set("sendId", randomUUID());
    posted.set("audience", CHOSEN_AUDIENCE);
    posted.set("subjectRo", WORDS.subject.ro);
    posted.set("subjectEn", WORDS.subject.en);
    posted.set("bodyRo", WORDS.body.ro);
    posted.set("bodyEn", WORDS.body.en);
    for (const id of ticked) posted.append(CHOSEN_FIELD, id);
    // «Scrie la câți trimiți»: as many as were ticked, unless the test types another number.
    posted.set(CONFIRM_COUNT_FIELD, String(ticked.length));
    for (const [name, value] of Object.entries(fields)) posted.set(name, value);
    return posted;
  }

  /** Where a press that worked redirects to (the mock above), or what it returned. */
  async function press(posted: FormData): Promise<{ redirect: string } | { returned: unknown }> {
    try {
      return { returned: await sendParticipantMessageAction(null, posted) };
    } catch (error) {
      const to = (error as { redirectTo?: string }).redirectTo;
      if (to) return { redirect: to };
      throw error;
    }
  }

  it("sends to the ticked and lands on the page with the send's own id, so its words stay in the boxes", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "WAITLISTED");
    await person("Carmen", "CONFIRMED");
    state.actor = organizer;
    const posted = form([ana.id, bogdan.id], { sendQr: "1" });
    const sendId = String(posted.get("sendId"));
    const landed = await press(posted);
    expect(landed).toMatchObject({ redirect: expect.stringMatching(new RegExp(`sent=2&test=0&kept=${sendId}#admin-alert$`)) });
    expect(await writtenTo()).toEqual([ana.id, bogdan.id].sort());
    expect(await readKeptMessage(db, eventId, sendId)).toEqual({ ...WORDS, askReconfirm: false, sendQr: true });
  });

  it("lands without `kept` after a send to a group: the boxes are empty, as they always were", async () => {
    await person("Ana", "CONFIRMED");
    state.actor = organizer;
    const landed = await press(form([], { audience: "ALL_ACTIVE", [CONFIRM_COUNT_FIELD]: "1" }));
    expect(landed).toMatchObject({ redirect: expect.stringMatching(/sent=1&test=0#admin-alert$/) });
  });

  it("refuses a press with nobody ticked on the list itself, every box and tick kept (§315), and queues nothing", async () => {
    const cancelled = await person("Gabi", "CANCELLED");
    await person("Ana", "CONFIRMED");
    state.actor = organizer;
    expect(await press(form([]))).toMatchObject({ returned: { error: "NO_CHOSEN_RECIPIENTS", fields: [CHOSEN_FIELD], values: { audience: [CHOSEN_AUDIENCE], subjectRo: [WORDS.subject.ro] } } });
    // Somebody ticked who cancelled since the page was drawn: the same sentence, and the tick comes back with the form.
    expect(await press(form([cancelled.id]))).toMatchObject({ returned: { error: "NO_CHOSEN_RECIPIENTS", fields: [CHOSEN_FIELD], values: { [CHOSEN_FIELD]: [cancelled.id] } } });
    expect(await ownRows()).toEqual([]);
    expect(await sendAudits()).toEqual([]);
  });

  it("refuses a role that may not write to participants, whoever is ticked (BR-REQ-060-01)", async () => {
    const ana = await person("Ana", "CONFIRMED");
    state.actor = await staff("DEV");
    expect(await press(form([ana.id]))).toMatchObject({ returned: { error: "FORBIDDEN" } });
    expect(await ownRows()).toEqual([]);
  });

  it("«Scrie la câți trimiți»: a number that is not the recipients' is refused on its own box with the number now, every other box kept and that one empty", async () => {
    const ana = await person("Ana", "CONFIRMED");
    const bogdan = await person("Bogdan", "WAITLISTED");
    await person("Carmen", "CONFIRMED");
    state.actor = organizer;
    const refusal = { error: "MESSAGE_COUNT_MISMATCH", fields: [CONFIRM_COUNT_FIELD] };
    const kept = (returned: unknown) => (returned as { returned: { values: Record<string, string[]> } }).returned.values;

    // Two ticked, five typed.
    const wrong = await press(form([ana.id, bogdan.id], { [CONFIRM_COUNT_FIELD]: "5", sendQr: "1" }));
    expect(wrong).toMatchObject({ returned: { ...refusal, errorValues: { actual: "2" }, values: { audience: [CHOSEN_AUDIENCE], subjectRo: [WORDS.subject.ro], sendQr: ["1"], [CHOSEN_FIELD]: [ana.id, bogdan.id] } } });
    expect(kept(wrong)).not.toHaveProperty(CONFIRM_COUNT_FIELD);

    // Everybody chosen with the trial's number still in mind: three are registered.
    expect(await press(form([], { audience: "ALL_ACTIVE", [CONFIRM_COUNT_FIELD]: "2" }))).toMatchObject({ returned: { ...refusal, errorValues: { actual: "3" } } });

    // A form that posts no number at all — not this page's, or a press without the box — is refused the same way.
    const without = form([ana.id]);
    without.delete(CONFIRM_COUNT_FIELD);
    expect(await press(without)).toMatchObject({ returned: { ...refusal, errorValues: { actual: "1" } } });

    expect(await ownRows()).toEqual([]);
    expect(await sendAudits()).toEqual([]);
    // The right number, and it goes.
    expect(await press(form([ana.id, bogdan.id]))).toMatchObject({ redirect: expect.stringMatching(/sent=2&test=0&kept=/) });
  });
});
