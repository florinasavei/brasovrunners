import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { updateClubNotices } from "@/modules/notifications/club-notices";
import { EMAIL_SAMPLE } from "@/modules/notifications/domain/email-sample";
import { updateEmailCopy } from "@/modules/notifications/email-copy";
import {
  countParticipantMessageAudiences,
  listParticipantMessages,
  previewParticipantMessage,
  sendParticipantMessage,
} from "@/modules/notifications/participant-messages";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §364 — "Trimite un mesaj participanților": the organizer writes to the people
 * registered for one event, in Română and English, to the group they choose.
 *
 * Every registration status is seeded, a test row among them, so each group's count and each
 * send's recipients can be read against what must and must not be reached: never a cancelled or
 * lapsed registration, never an address nobody confirmed; a test row written to like a real one
 * and counted apart (§12.6, as the §331 notices do). One outbox row per registration, in its
 * language, carrying both languages of both texts; a second press of the same form queues
 * nothing; the audit row says who, the group, the counts and the subject — and no address.
 */
describe("§364 the organizer's message to an event's participants", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let organizer: StaffUser;

  const NOW = new Date("2026-10-08T07:30:00.000Z");
  const ZONE = "Europe/Bucharest";
  const SEND_ID = "0b0d5c3e-4f5a-4c1e-9d2b-7a8e9f0a1b2c";
  const WORDS = {
    subject: { ro: "Vreme rea la {eventTitle}", en: "Bad weather at {eventTitle}" },
    body: {
      ro: "Salut, {participantName}!\n\nStartul se mută la 10:00.",
      en: "Hi, {participantName}!\n\nThe start moves to 10:00.",
    },
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    organizer = await staff("MODERATOR", "organizer@dev.test", "Dani Organizatorul");
  });

  async function staff(role: StaffRole, email: string, displayName: string = role) {
    const [row] = await db.insert(staffUsers).values({ email, displayName, role }).returning();
    return row;
  }

  /** A race on 11 Oct in Brașov, published in both languages, with a place of its own in English. */
  async function seedEvent() {
    const [row] = await db
      .insert(events)
      .values({
        type: "RACE",
        surface: "ASPHALT",
        startsAt: new Date("2026-10-11T09:00:00+03:00"),
        endsAt: new Date("2026-10-11T11:00:00+03:00"),
        timezone: ZONE,
        locationName: "Parcul Tractorul",
        registrationMode: "INTERNAL",
        capacity: 20,
        publishedAt: NOW,
        editorialStatus: "PUBLISHED",
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: row.id, locale: "ro", slug: `crosul-${row.id.slice(0, 8)}`, title: "Crosul de toamnă", excerpt: "Rapid." },
      { eventId: row.id, locale: "en", slug: `autumn-cross-${row.id.slice(0, 8)}`, title: "The autumn cross", excerpt: "Fast.", locationName: "Tractorul Park" },
    ]);
    return row;
  }

  type Seeded = { name: string; status: RegistrationStatus; locale?: "ro" | "en"; kind?: "REAL" | "TEST"; bib?: number };

  async function seedRegistrations(eventId: string, entries: readonly Seeded[]) {
    const people = await db
      .insert(participants)
      .values(
        entries.map(({ name }) => ({
          deliveryEmail: `${name}@example.test`,
          normalizedEmail: `${name}@example.test`,
          canonicalEmail: `${name}@example.test`,
          canonicalizationVersion: 1,
          defaultName: name,
        })),
      )
      .returning();
    return db
      .insert(registrations)
      .values(
        entries.map(({ name, status, locale, kind, bib }, index) => ({
          eventId,
          participantId: people[index].id,
          status,
          kind: kind ?? "REAL",
          locale: locale ?? "ro",
          registeredName: name,
          displayName: name,
          privacyNoticeVersion: 1,
          privacyAcknowledgedAt: NOW,
          raceId: null,
          resultsNameConsent: false,
          resultsConsentVersion: 1,
          bibNumber: bib ?? null,
          waitlistedAt: status === "WAITLISTED" ? NOW : null,
          ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "PARTICIPANT" as const } : {}),
          ...(status === "EXPIRED" ? { expiredAt: NOW, expiryReason: "DECLARATION_HOLD_LAPSED" as const } : {}),
          ...(status === "PENDING_DECLARATION" || status === "WAITLIST_OFFERED" ? { holdExpiresAt: new Date(NOW.getTime() + 3_600_000) } : {}),
          ...(status === "WAITLIST_OFFERED" ? { offerCreatedAt: NOW } : {}),
          ...(status === "CONFIRMED" ? { confirmedAt: NOW } : {}),
        })),
      )
      .returning();
  }

  /** Every status there is, English among them, and a test row: four real ones are "active". */
  const EVERYONE: readonly Seeded[] = [
    { name: "ana", status: "CONFIRMED", bib: 7 },
    { name: "bogdan", status: "CONFIRMED", locale: "en" },
    { name: "carmen", status: "WAITLISTED" },
    { name: "dan", status: "WAITLIST_OFFERED", locale: "en" },
    { name: "elena", status: "PENDING_DECLARATION" },
    { name: "florin", status: "PENDING_EMAIL_CONFIRMATION" },
    { name: "gabi", status: "CANCELLED" },
    { name: "horia", status: "EXPIRED" },
    { name: "test", status: "CONFIRMED", kind: "TEST" },
  ];

  /** The participants' own rows of this type — never the club's copies (§320), which have no participant. */
  const queued = () =>
    db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), isNotNull(emailOutbox.participantId)))
      .orderBy(asc(emailOutbox.recipientEmail));

  const send = (eventId: string, overrides: Partial<Parameters<typeof sendParticipantMessage>[2]> = {}, actor: StaffUser = organizer) =>
    sendParticipantMessage(db, actor, { eventId, audience: "ALL_ACTIVE", sendId: SEND_ID, ...WORDS, ...overrides }, NOW);

  async function refusalOf(attempt: Promise<unknown>) {
    try {
      await attempt;
      return undefined;
    } catch (caught) {
      if (isDomainError(caught)) return { code: caught.code, fields: caught.fields };
      throw caught;
    }
  }

  it("the migration adds ORGANIZER_MESSAGE, and the database's enum is the schema's (expand only)", async () => {
    const result = await db.execute(sql`SELECT unnest(enum_range(NULL::email_message_type))::text AS value`);
    const values = (result as unknown as { rows: { value: string }[] }).rows.map((row) => row.value);
    expect(values).toContain("ORGANIZER_MESSAGE");
    expect(values).toEqual([...emailMessageType.enumValues]);
  });

  it("counts each group live: real ones for the number shown, test ones apart, nobody cancelled, lapsed or unconfirmed", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, EVERYONE);
    expect(await countParticipantMessageAudiences(db, event.id)).toEqual({
      ALL_ACTIVE: { real: 5, test: 1 },
      CONFIRMED: { real: 2, test: 1 },
      WAITLIST: { real: 2, test: 0 },
      PENDING_DECLARATION: { real: 1, test: 0 },
    });
    // Another event's registrations are nobody's business here.
    const other = await seedEvent();
    expect((await countParticipantMessageAudiences(db, other.id)).ALL_ACTIVE).toEqual({ real: 0, test: 0 });
  });

  it("queues exactly one row per recipient of the chosen group, in each one's language, carrying both languages", async () => {
    const event = await seedEvent();
    const rows = await seedRegistrations(event.id, EVERYONE);
    const byName = (name: string) => rows.find((row) => row.registeredName === name)!;

    const result = await send(event.id, { audience: "WAITLIST" });
    expect(result).toEqual({ kind: "queued", real: 2, test: 0 });
    const waiting = await queued();
    expect(waiting.map((row) => row.registrationId).sort()).toEqual([byName("carmen").id, byName("dan").id].sort());
    expect(waiting.find((row) => row.registrationId === byName("dan").id)?.locale).toBe("en");
    for (const row of waiting) {
      expect(row.payloadJson).toEqual(WORDS);
      expect(row.requestedByStaffUserId).toBe(organizer.id);
      expect(row.idempotencyKey).toBe(`organizer-message:${SEND_ID}:registration:${row.registrationId}`);
    }

    // Everybody active, in a second send: the four real ones and the test row — never florin, gabi or horia.
    const all = await send(event.id, { sendId: "1c1e6d4f-5a6b-4d2f-8e3c-8b9f0a1b2c3d" });
    expect(all).toEqual({ kind: "queued", real: 5, test: 1 });
    const second = (await queued()).filter((row) => row.idempotencyKey.includes("1c1e6d4f"));
    expect(second.map((row) => row.registrationId).sort()).toEqual(
      ["ana", "bogdan", "carmen", "dan", "elena", "test"].map((name) => byName(name).id).sort(),
    );
    for (const name of ["florin", "gabi", "horia"]) expect(second.some((row) => row.registrationId === byName(name).id)).toBe(false);
  });

  it("a second press of the same form queues nothing and writes no second audit row", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, EVERYONE);
    expect(await send(event.id)).toEqual({ kind: "queued", real: 5, test: 1 });
    const before = await queued();

    // A registration that arrives between the two presses is not sent a message nobody pressed Send for.
    await seedRegistrations(event.id, [{ name: "ioana", status: "CONFIRMED" }]);
    expect(await send(event.id)).toEqual({ kind: "duplicate" });
    expect(await queued()).toHaveLength(before.length);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.participant_message_sent"))).toHaveLength(1);
  });

  it("an empty group queues and audits nothing", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, [{ name: "ana", status: "CONFIRMED" }]);
    expect(await send(event.id, { audience: "PENDING_DECLARATION" })).toEqual({ kind: "nobody" });
    expect(await queued()).toHaveLength(0);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses a message in one language, naming the empty boxes, and an unknown placeholder, naming its box", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, EVERYONE);
    expect(await refusalOf(send(event.id, { subject: { ro: "Vreme rea", en: "" }, body: { ro: "Startul se mută.", en: "" } }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["subjectEn", "bodyEn"],
    });
    expect(await refusalOf(send(event.id, { body: { ro: "Salut {nume}", en: "Hi {participantName}" } }))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["bodyRo"],
    });
    expect(await refusalOf(send(event.id, { audience: "CANCELLED" }))).toEqual({ code: "VALIDATION_ERROR", fields: ["audience"] });
    expect(await refusalOf(send(event.id, { sendId: "not-an-id" }))).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await refusalOf(send("not-a-uuid"))).toMatchObject({ code: "NOT_FOUND" });
    expect(await refusalOf(send("5d8a2f1c-0000-4000-8000-000000000000"))).toMatchObject({ code: "NOT_FOUND" });
    expect(await queued()).toHaveLength(0);
  });

  it("BR-REQ-060-01: the Organizer, the Administrator and the Superadministrator may send; the volunteer, the Redactor and Tehnic may not", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, EVERYONE);
    const ids = ["2d2f7e50-6b7c-4e30-9f4d-9c0a1b2c3d4e", "3e3a8f61-7c8d-4f41-8a5e-0d1b2c3d4e5f"];
    const admin = await staff("ADMIN", "admin@dev.test");
    const superadmin = await staff("SUPERADMIN", "super@dev.test");
    expect((await send(event.id, { sendId: ids[0] }, admin)).kind).toBe("queued");
    expect((await send(event.id, { sendId: ids[1] }, superadmin)).kind).toBe("queued");
    for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
      const actor = await staff(role, `${role.toLowerCase()}@dev.test`);
      expect(await refusalOf(send(event.id, { sendId: "4f4b9a72-8d9e-4a52-9b6f-1e2c3d4e5f60" }, actor))).toMatchObject({ code: "FORBIDDEN" });
      expect(await refusalOf(previewParticipantMessage(db, actor, { eventId: event.id, locale: "ro", ...WORDS }))).toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("audits who, the group, the counts and the subject — and never an address or the body", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, EVERYONE);
    await send(event.id, { audience: "CONFIRMED" });
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.participant_message_sent"));
    expect(audit.actorStaffUserId).toBe(organizer.id);
    expect(audit.entityType).toBe("event");
    expect(audit.entityId).toBe(event.id);
    expect(audit.participantId).toBeNull();
    expect(audit.metadataJson).toEqual({ sendId: SEND_ID, audience: "CONFIRMED", recipients: 2, test: 1, subject: WORDS.subject });
    const trail = JSON.stringify(audit.metadataJson);
    expect(trail).not.toContain("@example.test");
    expect(trail).not.toContain("Startul se mută");

    // "Mesaje trimise" is read from these rows: date, subject, group, count, sender.
    expect(await listParticipantMessages(db, event.id)).toEqual([
      { at: NOW, subject: WORDS.subject, audience: "CONFIRMED", recipients: 2, test: 1, senderName: "Dani Organizatorul" },
    ]);
  });

  it("renders each registrant's copy in their language first, the other language's own words and facts second, with nothing to act on", async () => {
    const event = await seedEvent();
    const rows = await seedRegistrations(event.id, EVERYONE);
    const byName = (name: string) => rows.find((row) => row.registeredName === name)!;
    await send(event.id, { audience: "CONFIRMED" });
    const told = await queued();

    const ana = await renderOutboxMessage(told.find((row) => row.registrationId === byName("ana").id)!, db, NOW);
    expect(ana.subject).toBe("Vreme rea la Crosul de toamnă / Bad weather at The autumn cross");
    const [romanian, english] = ana.text.split("— — —");
    expect(romanian).toContain("Salut, ana!");
    expect(romanian).toContain("Startul se mută la 10:00.");
    expect(romanian).toContain("Parcul Tractorul");
    expect(english).toContain("The start moves to 10:00.");
    // The English half reads the English facts, the place's English name among them.
    expect(english).toContain("A message from the organizers of The autumn cross");
    expect(english).toContain("Tractorul Park");
    expect(english).not.toContain("Startul se mută");
    // The button is the event's page, "my registrations" by address, and no token anywhere.
    expect(ana.html).toContain(`/ro/evenimente/crosul-${event.id.slice(0, 8)}`);
    expect(ana.text).toContain("/ro/inscrieri/ale-mele");
    expect(ana.attachments).toBeUndefined();

    const bogdan = await renderOutboxMessage(told.find((row) => row.registrationId === byName("bogdan").id)!, db, NOW);
    expect(bogdan.subject).toBe("Bad weather at The autumn cross / Vreme rea la Crosul de toamnă");
    expect(bogdan.text.indexOf("Hi, bogdan!")).toBeLessThan(bogdan.text.indexOf("Salut, bogdan!"));
    expect(await db.select().from(emailActionTokens)).toHaveLength(0);
  });

  it("fills {bibNumber} with the settled number only, and leaves it out for whoever has none", async () => {
    const event = await seedEvent();
    const rows = await seedRegistrations(event.id, EVERYONE);
    const byName = (name: string) => rows.find((row) => row.registeredName === name)!;
    await send(event.id, { audience: "CONFIRMED", body: { ro: "Numărul tău: {bibNumber}.", en: "Your number: {bibNumber}." } });
    const told = await queued();
    const ana = await renderOutboxMessage(told.find((row) => row.registrationId === byName("ana").id)!, db, NOW);
    expect(ana.text).toContain("Numărul tău: 7.");
    const bogdan = await renderOutboxMessage(told.find((row) => row.registrationId === byName("bogdan").id)!, db, NOW);
    expect(bogdan.text).toContain("Your number:.");
  });

  it("gives the club one copy of the whole send — the words and the count, no names (§NNN) — and counts no test row", async () => {
    const event = await seedEvent();
    const rows = await seedRegistrations(event.id, EVERYONE);
    const admin = await staff("ADMIN", "admin@dev.test");
    await updateClubNotices(db, admin, { participants: { bcc: ["arhiva@club.test", "presedinte@club.test"] } }, NOW);
    await send(event.id, { audience: "CONFIRMED" });

    const copies = await db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"), isNull(emailOutbox.participantId)));
    // Two real confirmed registrants and a test one: one copy per club address, not one per registrant.
    expect(copies.map((copy) => copy.recipientEmail).sort()).toEqual(["arhiva@club.test", "presedinte@club.test"]);
    for (const copy of copies) {
      // About nobody: no registration, the event's id and how many real participants it reached.
      expect(copy.registrationId).toBeNull();
      expect(copy.payloadJson).toEqual({ ...WORDS, clubCopy: true, eventId: event.id, recipients: 2 });
    }
    const message = await renderOutboxMessage(copies[0], db, NOW);
    expect(message.subject.startsWith("[Copie club] ")).toBe(true);
    expect(message.subject).toContain(" / [Club copy] ");
    expect(message.text).toContain("Copie pentru club a mesajului trimis la 2 participanți");
    expect(message.text).toContain("Club copy of the message sent to 2 participants");
    expect(message.text).toContain("Startul se mută la 10:00.");
    expect(message.text).toContain("The start moves to 10:00.");
    // It greets the club and names none of the recipients.
    expect(message.text.startsWith("Salut,\n")).toBe(true);
    for (const row of rows) {
      expect(message.text).not.toContain(`Salut, ${row.registeredName}`);
      expect(message.text).not.toContain(`Hi ${row.registeredName}`);
      expect(message.text).not.toContain(`${row.registeredName}@example.test`);
    }
    expect(message.to).toBe(copies[0].recipientEmail);

    // The same send again queues nothing twice.
    const before = (await db.select().from(emailOutbox)).length;
    await send(event.id, { audience: "CONFIRMED" });
    expect((await db.select().from(emailOutbox)).length).toBe(before);
  });

  it("previews the message a registrant in either language would receive, and names the placeholders it cannot fill", async () => {
    const event = await seedEvent();
    const english = await previewParticipantMessage(db, organizer, { eventId: event.id, locale: "en", ...WORDS });
    expect(english.subject).toBe("Bad weather at The autumn cross / Vreme rea la Crosul de toamnă");
    // Addressed to the one sample runner the /admin/emails previews use, never a second copy of her.
    expect(english.html).toContain(`Hi, ${EMAIL_SAMPLE.en.participantName}!`);
    expect(english.html).toContain(`Salut, ${EMAIL_SAMPLE.ro.participantName}!`);
    expect(english.unknown).toEqual([]);

    const typo = await previewParticipantMessage(db, organizer, {
      eventId: event.id,
      locale: "ro",
      subject: { ro: "Salut {nume}", en: "" },
      body: { ro: "", en: "{bib}" },
    });
    expect(typo.unknown).toEqual(["nume", "bib"]);
    // Nothing is queued by a preview, and nothing is minted.
    expect(await queued()).toHaveLength(0);
    expect(await db.select().from(emailActionTokens)).toHaveLength(0);
  });

  it("is written per send: the copy editor on /admin/emails refuses to store words for it (§247)", async () => {
    const copywriter = await staff("COPYWRITER", "words@dev.test");
    expect(
      await refusalOf(updateEmailCopy(db, copywriter, { messageType: "ORGANIZER_MESSAGE", locale: "ro", entry: { subject: "X", paragraphs: ["Y"] } }, NOW)),
    ).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
