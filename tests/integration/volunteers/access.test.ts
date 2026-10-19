import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerInvitations } from "@/db/schema/event-volunteer-invitations";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { duplicateEvent, repeatEvent } from "@/modules/content/events/service";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { generateTokenSecret, hashTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { pruneExpiredRows } from "@/modules/jobs/retention";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { VolunteerInvitationRefusal } from "@/modules/volunteers/domain/access";
import { readVolunteerInvitationLink } from "@/modules/volunteers/invitation-link";
import { listVolunteerInvitations, resendVolunteerInvitation, sendVolunteerInvitations, withdrawVolunteerInvitation } from "@/modules/volunteers/invitations";
import { readPublicVolunteerRoles, setVolunteersAccess, submitVolunteer } from "@/modules/volunteers/volunteers";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-10-13T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();
const SECRET = /invite=([A-Za-z0-9_-]{43})/;

/**
 * §NNN — «Cine se poate oferi» (BR-REQ-060-01, BR-REQ-036-02, BR-REQ-050-02): the club's choice of who may offer as a volunteer —
 * anyone, its signed-in members, or only people it invites by email. The server asserts the door again at the post (a hidden form
 * is not a permission); an invitation's link is hashed at rest, minted when its email leaves, single use, and spent in the very
 * transaction of the sign-up it leads to; the send, «Retrimite» and «Retrage» are audited with ids and never an address; and the
 * choice is carried by a copy and a repeat. The pages, the card and the email's words are `tests/unit/volunteers/access-*`.
 */
describe("§NNN who may offer as a volunteer", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let technician: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  async function approveTexts() {
    const body = (text: string) => ({ sections: [{ paragraphs: [`Voluntari ({{volunteers}}, {{volunteerAgreement}}): ${text}`] }] });
    const notice: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: body("păstrăm numele") },
      { locale: "en", title: "Privacy", body: body("we keep the name") },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(notice),
      translations: notice,
      now: NOW,
    });
    const agreement: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale] }));
    await insertLegalDocumentVersion(db, {
      key: "VOLUNTEER_AGREEMENT",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(agreement),
      translations: agreement,
      now: NOW,
    });
  }

  async function person(role: StaffUser["role"], name: string): Promise<StaffUser> {
    const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
    return row;
  }

  async function seedEvent(overrides: Partial<typeof events.$inferInsert> = {}) {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: new Date(NOW.getTime() + 30 * DAY),
        editorialStatus: "PUBLISHED",
        publishedAt: new Date(NOW.getTime() - DAY),
        acceptsVolunteers: true,
        volunteersAccess: "INVITED",
        ...overrides,
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul" },
      { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title: "The cross" },
    ]);
    return event;
  }

  async function seedRole(eventId: string, overrides: Partial<typeof eventVolunteerRoles.$inferInsert> = {}) {
    const [role] = await db
      .insert(eventVolunteerRoles)
      .values({ eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 2, ...overrides })
      .returning();
    return role;
  }

  beforeEach(async () => {
    await resetTables(db);
    await approveTexts();
    admin = await person("ADMIN", "Ana Admin");
    organizer = await person("MODERATOR", "Oana Organizator");
    technician = await person("DEV", "Tudor Tehnic");
  });

  const form = (roleIds: string | string[], extra: Record<string, unknown> = {}) => ({
    roleIds: Array.isArray(roleIds) ? roleIds : [roleIds],
    name: "Maria Test",
    email: "maria@example.test",
    phone: "+40712345678",
    message: "",
    locale: "ro",
    consent: true,
    agreement: true,
    adult: true,
    renderedAt: RENDERED,
    ...extra,
  });
  const volunteers = (eventId: string) => db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId));
  const invitations = (eventId: string) => db.select().from(eventVolunteerInvitations).where(eq(eventVolunteerInvitations.eventId, eventId));
  const invitationMail = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "VOLUNTEER_INVITATION"));
  const trail = async (action: string) => (await db.select().from(auditLogs).where(eq(auditLogs.action, action as never))).map((row) => row.metadataJson);

  /** Sends one invitation and renders its email as the worker would: the link's secret, and the message. */
  async function invite(eventId: string, address = "ioana@example.test", extra: { message?: string; locale?: "ro" | "en" } = {}) {
    await sendVolunteerInvitations(db, admin, { eventId, addresses: address, message: extra.message ?? "", locale: extra.locale ?? "ro" }, NOW);
    const [row] = (await invitationMail()).filter((mail) => mail.recipientEmail === address).slice(-1);
    return renderInvitation(row);
  }
  async function renderInvitation(row: typeof emailOutbox.$inferSelect) {
    const message = await renderOutboxMessage({ ...(row as unknown as OutboxRow), status: "PROCESSING", lockedAt: NOW }, db, NOW);
    const secret = SECRET.exec(message.text)?.[1];
    expect(secret, "the email carries the personal link").toBeDefined();
    return { message, secret: secret as string };
  }

  describe("the data (migration 0171)", () => {
    it("starts every event at «Oricine», keeps one invitation per address per event, and carries a message type of its own", async () => {
      const plain = await seedEvent({ volunteersAccess: undefined });
      expect(plain.volunteersAccess).toBe("ANYONE");
      await db.insert(eventVolunteerInvitations).values({ eventId: plain.id, deliveryEmail: "A@Example.test", canonicalEmail: "a@example.test", canonicalizationVersion: 2, sentAt: NOW, expiresAt: NOW });
      await expect(
        db.insert(eventVolunteerInvitations).values({ eventId: plain.id, deliveryEmail: "a@example.test", canonicalEmail: "a@example.test", canonicalizationVersion: 2, sentAt: NOW, expiresAt: NOW }),
      ).rejects.toThrow();
      await db.insert(emailOutbox).values({ messageType: "VOLUNTEER_INVITATION", locale: "ro", recipientEmail: "a@example.test", idempotencyKey: "k1", payloadJson: {} });
      // The invitations go with the event.
      await db.delete(events).where(eq(events.id, plain.id));
      expect(await db.select().from(eventVolunteerInvitations)).toHaveLength(0);
    });

    it("reads the choice with the roles, so the page and the box share one cache entry", async () => {
      const event = await seedEvent({ volunteersAccess: "MEMBERS" });
      await seedRole(event.id);
      expect((await readPublicVolunteerRoles(db, event.id)).access).toBe("MEMBERS");
    });
  });

  describe("«Cine se poate oferi» saved by the card", () => {
    it("saves the choice, audits it, deletes nothing, and refuses a value that is none of the three and every role but the Organizer's and the Administrators'", async () => {
      const event = await seedEvent({ volunteersAccess: "ANYONE" });
      const role = await seedRole(event.id);
      await db.insert(eventVolunteers).values({ eventId: event.id, roleId: role.id, name: "Dat", email: "d@example.test", canonicalEmail: "d@example.test", canonicalizationVersion: 2, phone: "+40712345678", source: "STAFF" });
      expect(await setVolunteersAccess(db, organizer, { eventId: event.id, access: "INVITED" }, NOW)).toEqual({ changed: true });
      expect(await setVolunteersAccess(db, organizer, { eventId: event.id, access: "INVITED" }, NOW)).toEqual({ changed: false });
      expect((await trail("event.volunteers_access_changed")).map((meta) => meta)).toEqual([{ from: "ANYONE", to: "INVITED" }]);
      await sendVolunteerInvitations(db, admin, { eventId: event.id, addresses: "x@example.test", message: "", locale: "ro" }, NOW);
      // Narrowing, widening and narrowing again deletes no sign-up and no invitation.
      await setVolunteersAccess(db, admin, { eventId: event.id, access: "ANYONE" }, NOW);
      await setVolunteersAccess(db, admin, { eventId: event.id, access: "MEMBERS" }, NOW);
      expect(await volunteers(event.id)).toHaveLength(1);
      expect(await invitations(event.id)).toHaveLength(1);
      await expect(setVolunteersAccess(db, admin, { eventId: event.id, access: "EVERYBODY" as never }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(setVolunteersAccess(db, technician, { eventId: event.id, access: "ANYONE" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await db.select().from(events).where(eq(events.id, event.id)))[0].volunteersAccess).toBe("MEMBERS");
    });

    it("travels with a copy of the event and with every date of a repeat — and the tick «Primește voluntari», the people and the invitations do not", async () => {
      const source = await seedEvent({ volunteersAccess: "MEMBERS", endsAt: new Date(NOW.getTime() + 30 * DAY + 3_600_000) });
      const role = await seedRole(source.id);
      await db.insert(eventVolunteers).values({ eventId: source.id, roleId: role.id, name: "Dat", email: "d@example.test", canonicalEmail: "d@example.test", canonicalizationVersion: 2, phone: "+40712345678", source: "STAFF" });
      const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
      expect(copy.volunteersAccess).toBe("MEMBERS");
      expect(copy.acceptsVolunteers).toBe(false);
      expect(await volunteers(copy.id)).toHaveLength(0);
      await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-12-30", publish: false }, now: NOW });
      const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
      expect(dates.length).toBeGreaterThan(0);
      for (const date of dates) expect(date.volunteersAccess).toBe("MEMBERS");
    });
  });

  describe("the sign-up asks the door again on the server", () => {
    it("«Doar membrii»: a stranger's post is refused and writes nothing; a member's is kept with the account's own address, whatever was posted", async () => {
      const event = await seedEvent({ volunteersAccess: "MEMBERS" });
      const role = await seedRole(event.id);
      await expect(submitVolunteer(db, event.id, form(role.id), NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(submitVolunteer(db, event.id, form(role.id), NOW, undefined, { member: null, inviteSecret: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await volunteers(event.id)).toHaveLength(0);
      // A member offering with somebody else's address is a forged post: refused.
      await expect(submitVolunteer(db, event.id, form(role.id, { email: "alta@example.test" }), NOW, undefined, { member: { email: "membru@example.test" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await volunteers(event.id)).toHaveLength(0);
      expect(await submitVolunteer(db, event.id, form(role.id, { email: "Membru@Example.test" }), NOW, undefined, { member: { email: "membru@example.test" } })).toEqual({ outcome: "done" });
      const [row] = await volunteers(event.id);
      expect(row).toMatchObject({ canonicalEmail: "membru@example.test", source: "PUBLIC", state: "REGISTERED" });
    });

    it("«Doar cu invitație»: no link, no sign-up; a link that names nothing says so and writes nothing", async () => {
      const event = await seedEvent();
      const role = await seedRole(event.id);
      await expect(submitVolunteer(db, event.id, form(role.id), NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      // A member is not an invitee: the choice is the club's.
      await expect(submitVolunteer(db, event.id, form(role.id), NOW, undefined, { member: { email: "maria@example.test" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await submitVolunteer(db, event.id, form(role.id), NOW, undefined, { inviteSecret: "x".repeat(43) })).toEqual({ outcome: "invitation", reason: "invalid" });
      expect(await submitVolunteer(db, event.id, form(role.id), NOW, undefined, { inviteSecret: "not a secret" })).toEqual({ outcome: "invitation", reason: "invalid" });
      expect(await volunteers(event.id)).toHaveLength(0);
    });

    it("«Oricine»: nothing changes for a person with no link and no account", async () => {
      const event = await seedEvent({ volunteersAccess: "ANYONE" });
      const role = await seedRole(event.id);
      expect(await submitVolunteer(db, event.id, form(role.id), NOW)).toEqual({ outcome: "done" });
      expect(await volunteers(event.id)).toHaveLength(1);
    });
  });

  describe("the invitations: send, send again, withdraw", () => {
    it("sends one invitation and one email per address, in one go, audited by id — the outbox and the trail hold no address, name or line", async () => {
      const event = await seedEvent();
      await seedRole(event.id);
      const result = await sendVolunteerInvitations(
        db,
        organizer,
        { eventId: event.id, addresses: "ioana@example.test\nAndrei@Example.test, ioana@example.test; vlad@example.test", message: " Te așteptăm! ", locale: "en" },
        NOW,
      );
      expect(result).toEqual({ sent: 3, alreadyInvited: 0, alreadyOffered: 0 });
      const rows = await invitations(event.id);
      expect(rows.map((row) => row.canonicalEmail).sort()).toEqual(["andrei@example.test", "ioana@example.test", "vlad@example.test"]);
      expect(rows.every((row) => row.message === "Te așteptăm!" && row.locale === "en" && row.tokenHash === null && row.usedAt === null && row.invitedByStaffUserId === organizer.id)).toBe(true);
      // The expiry is the event's end (its start with no end).
      expect(rows[0].expiresAt.getTime()).toBe(new Date(NOW.getTime() + 30 * DAY).getTime());
      const mail = await invitationMail();
      expect(mail).toHaveLength(3);
      for (const row of mail) {
        expect(row).toMatchObject({ participantId: null, registrationId: null, locale: "en" });
        expect(Object.keys(row.payloadJson as object).sort()).toEqual(["eventId", "invitationId"]);
        expect(JSON.stringify(row.payloadJson)).not.toMatch(/@|Te a/);
      }
      const sent = await trail("volunteer_invitation.sent");
      expect(sent).toHaveLength(3);
      expect(JSON.stringify(sent)).not.toMatch(/@|Te a|Andrei|Ioana/i);
    });

    it("refuses the whole send, writing nothing, for an address that cannot be read, an empty box, too many addresses, a long line, another choice, a closed offer and every other role", async () => {
      const event = await seedEvent();
      await seedRole(event.id);
      const send = (addresses: string, extra: { message?: string } = {}, actor: StaffUser = admin) =>
        sendVolunteerInvitations(db, actor, { eventId: event.id, addresses, message: extra.message ?? "", locale: "ro" }, NOW);
      const refusal = async (promise: Promise<unknown>) => {
        const error = await promise.then(
          () => null,
          (thrown: unknown) => thrown,
        );
        expect(error).toBeInstanceOf(VolunteerInvitationRefusal);
        return error as VolunteerInvitationRefusal;
      };
      const bad = await refusal(send("bun@example.test\nnu-e-adresa\nal-doilea"));
      expect(bad).toMatchObject({ refusal: "VINVITE_BAD_ADDRESS", unread: ["nu-e-adresa", "al-doilea"] });
      expect(await refusal(send(" \n "))).toMatchObject({ refusal: "VINVITE_NOBODY" });
      expect(await refusal(send(Array.from({ length: 51 }, (_, index) => `p${index}@example.test`).join("\n")))).toMatchObject({ refusal: "VINVITE_TOO_MANY" });
      expect(await refusal(send("a@example.test", { message: "x".repeat(501) }))).toMatchObject({ refusal: "VINVITE_MESSAGE_LONG" });
      await db.update(events).set({ volunteersAccess: "MEMBERS" }).where(eq(events.id, event.id));
      expect(await refusal(send("a@example.test"))).toMatchObject({ refusal: "VINVITE_NOT_INVITED_ONLY" });
      await db.update(events).set({ volunteersAccess: "INVITED", acceptsVolunteers: false }).where(eq(events.id, event.id));
      expect(await refusal(send("a@example.test"))).toMatchObject({ refusal: "VINVITE_EVENT_CLOSED" });
      await db.update(events).set({ acceptsVolunteers: true }).where(eq(events.id, event.id));
      await expect(send("a@example.test", {}, technician)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await invitations(event.id)).toHaveLength(0);
      expect(await invitationMail()).toHaveLength(0);
    });

    it("sends nothing while the privacy notice in force does not describe volunteers: no link to a page that answers 404", async () => {
      await resetTables(db);
      admin = await person("ADMIN", "Ana Admin");
      const event = await seedEvent();
      await seedRole(event.id);
      await expect(sendVolunteerInvitations(db, admin, { eventId: event.id, addresses: "a@example.test", message: "", locale: "ro" }, NOW)).rejects.toMatchObject({ refusal: "VINVITE_EVENT_CLOSED" });
    });

    it("asks an address once: a live invitation is not sent twice, a person who already offered is not invited, and a withdrawn one comes back with the same row", async () => {
      const event = await seedEvent();
      const role = await seedRole(event.id);
      await db.insert(eventVolunteers).values({ eventId: event.id, roleId: role.id, name: "Deja", email: "deja@example.test", canonicalEmail: "deja@example.test", canonicalizationVersion: 2, phone: "+40712345678", source: "PUBLIC" });
      const first = await sendVolunteerInvitations(db, admin, { eventId: event.id, addresses: "ioana@example.test", message: "", locale: "ro" }, NOW);
      expect(first.sent).toBe(1);
      const second = await sendVolunteerInvitations(db, admin, { eventId: event.id, addresses: "Ioana@example.test\ndeja@example.test", message: "", locale: "ro" }, NOW);
      expect(second).toEqual({ sent: 0, alreadyInvited: 1, alreadyOffered: 1 });
      expect(await invitationMail()).toHaveLength(1);
      const [row] = await invitations(event.id);
      await withdrawVolunteerInvitation(db, admin, row.id, NOW);
      const third = await sendVolunteerInvitations(db, admin, { eventId: event.id, addresses: "ioana@example.test", message: "Din nou", locale: "ro" }, new Date(NOW.getTime() + 1000));
      expect(third.sent).toBe(1);
      const [again] = await invitations(event.id);
      expect(again).toMatchObject({ id: row.id, withdrawnAt: null, message: "Din nou", tokenHash: null });
      expect(await invitationMail()).toHaveLength(2);
    });

    it("«Retrimite» queues another email and audits it; «Retrage» ends the invitation and audits it; neither works on an invitation no longer open, and only the Organizer and the Administrators press them", async () => {
      const event = await seedEvent();
      await seedRole(event.id);
      await sendVolunteerInvitations(db, admin, { eventId: event.id, addresses: "ioana@example.test", message: "", locale: "ro" }, NOW);
      const [row] = await invitations(event.id);
      await expect(resendVolunteerInvitation(db, technician, row.id, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(withdrawVolunteerInvitation(db, technician, row.id, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await resendVolunteerInvitation(db, organizer, row.id, new Date(NOW.getTime() + 1000));
      expect(await invitationMail()).toHaveLength(2);
      expect((await invitations(event.id))[0].resentAt).toEqual(new Date(NOW.getTime() + 1000));
      await withdrawVolunteerInvitation(db, organizer, row.id, new Date(NOW.getTime() + 2000));
      const [ended] = await invitations(event.id);
      expect(ended).toMatchObject({ withdrawnByStaffUserId: organizer.id });
      await expect(resendVolunteerInvitation(db, admin, row.id, NOW)).rejects.toMatchObject({ refusal: "VINVITE_NOT_OPEN" });
      await expect(withdrawVolunteerInvitation(db, admin, row.id, NOW)).rejects.toMatchObject({ refusal: "VINVITE_NOT_OPEN" });
      expect(await trail("volunteer_invitation.resent")).toEqual([{ invitationId: row.id }]);
      expect(await trail("volunteer_invitation.withdrawn")).toEqual([{ invitationId: row.id }]);
      expect(JSON.stringify(await trail("volunteer_invitation.withdrawn"))).not.toContain("@");
      // The list the card draws: the address and who sent it, for those who may manage volunteers alone.
      const listed = await listVolunteerInvitations(db, admin, event.id);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ deliveryEmail: "ioana@example.test", invitedByName: "Ana Admin" });
      await expect(listVolunteerInvitations(db, technician, event.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("the email and its link", () => {
    it("renders the invitation in both languages with the roles, the club's line, the facts block and a personal link; the secret is in the email alone and only its hash is kept", async () => {
      const event = await seedEvent();
      await seedRole(event.id);
      await seedRole(event.id, { nameRo: "Sosire", nameEn: "Finish", position: 1, needed: null });
      const { message, secret } = await invite(event.id, "ioana@example.test", { message: "Ne bucurăm să te vedem!", locale: "ro" });
      expect(message.subject).toBe("Te invităm să fii voluntar la Crosul / We invite you to volunteer at The cross");
      expect(message.text).toContain("Căutăm oameni pentru: Punct de apă, Sosire.");
      expect(message.text).toContain("We are looking for people for: Water point, Finish.");
      expect(message.text).toContain("Mesajul clubului:");
      expect(message.text).toContain("Ne bucurăm să te vedem!");
      expect(message.text).toContain("Mă ofer voluntar");
      expect(message.text).toContain("I want to volunteer");
      expect(message.text).toContain("ți-a trecut adresa ca să te invite voluntar la un eveniment");
      expect(message.text).toContain(`/ro/evenimente/crosul-${event.id.slice(0, 8)}/voluntari?invite=${secret}`);
      const [row] = await invitations(event.id);
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.tokenHash).not.toContain(secret);
      expect(JSON.stringify(row)).not.toContain(secret);
      // Nothing of the invitation holds a place: the role still needs its two people.
      const [water] = (await readPublicVolunteerRoles(db, event.id)).roles;
      expect(water).toMatchObject({ needed: 2, taken: 0, free: 2 });
    });

    it("mints a new link with each email: the earlier one stops working, and the page's read changes nothing", async () => {
      const event = await seedEvent();
      await seedRole(event.id);
      const first = await invite(event.id);
      const before = await invitations(event.id);
      expect((await readVolunteerInvitationLink(db, event.id, first.secret, NOW)).reading).toEqual({ standing: "open" });
      expect(await invitations(event.id)).toEqual(before);
      await resendVolunteerInvitation(db, admin, before[0].id, new Date(NOW.getTime() + 1000));
      const [, resent] = (await invitationMail()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const second = await renderInvitation(resent);
      expect(second.secret).not.toBe(first.secret);
      expect((await readVolunteerInvitationLink(db, event.id, first.secret, NOW)).reading).toEqual({ standing: "invalid" });
      expect((await readVolunteerInvitationLink(db, event.id, second.secret, NOW)).reading).toEqual({ standing: "open" });
    });

    it("withdraws an email whose invitation was used, withdrawn or has run out, or whose event is over, and names nothing of the address", async () => {
      const event = await seedEvent();
      await seedRole(event.id);
      await sendVolunteerInvitations(db, admin, { eventId: event.id, addresses: "ioana@example.test", message: "", locale: "ro" }, NOW);
      const [mail] = await invitationMail();
      const [row] = await invitations(event.id);
      const row$ = { ...(mail as unknown as OutboxRow), status: "PROCESSING" as const, lockedAt: NOW };
      await db.update(eventVolunteerInvitations).set({ withdrawnAt: NOW });
      await expect(renderOutboxMessage(row$, db, NOW)).rejects.toThrow(/invitation/i);
      await db.update(eventVolunteerInvitations).set({ withdrawnAt: null, expiresAt: new Date(NOW.getTime() - 1) });
      await expect(renderOutboxMessage(row$, db, NOW)).rejects.toThrow(/invitation/i);
      await db.update(eventVolunteerInvitations).set({ expiresAt: new Date(NOW.getTime() + DAY) });
      await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));
      await expect(renderOutboxMessage(row$, db, NOW)).rejects.toThrow(/event|invitation/i);
      // A corrected address meanwhile: the link would reach the wrong inbox.
      await db.update(events).set({ eventStatus: "SCHEDULED" }).where(eq(events.id, event.id));
      await expect(renderOutboxMessage({ ...row$, recipientEmail: "alta@example.test" }, db, NOW)).rejects.toThrow(/address/i);
      expect(row.tokenHash).toBeNull();
    });
  });

  describe("the sign-up through the link", () => {
    it("opens the form for the invited address whatever was posted, spends the link in the same transaction, audits it, and refuses the link a second time", async () => {
      const event = await seedEvent();
      const role = await seedRole(event.id);
      const { secret } = await invite(event.id, "ioana@example.test");
      const link = await readVolunteerInvitationLink(db, event.id, secret, NOW);
      expect(link.reading).toEqual({ standing: "open" });
      expect(link.invitation?.deliveryEmail).toBe("ioana@example.test");
      // The posted address is not the invitation's: the invitation's is kept.
      expect(await submitVolunteer(db, event.id, form(role.id, { email: "altcineva@example.test", name: "Ioana Invitata" }), NOW, undefined, { inviteSecret: secret })).toEqual({ outcome: "done" });
      const [row] = await volunteers(event.id);
      expect(row).toMatchObject({ canonicalEmail: "ioana@example.test", name: "Ioana Invitata", source: "PUBLIC" });
      const [spent] = await invitations(event.id);
      expect(spent).toMatchObject({ volunteerId: row.id, usedAt: NOW });
      expect(await trail("volunteer_invitation.used")).toEqual([{ invitationId: spent.id, volunteerId: row.id }]);
      expect((await readVolunteerInvitationLink(db, event.id, secret, NOW)).reading).toEqual({ standing: "used" });
      // A second press with the same link: refused, and no second person.
      expect(await submitVolunteer(db, event.id, form(role.id, { name: "Din nou" }), NOW, undefined, { inviteSecret: secret })).toEqual({ outcome: "invitation", reason: "used" });
      expect(await volunteers(event.id)).toHaveLength(1);
      // It holds no place and counts nothing: the role was never short.
      expect((await readPublicVolunteerRoles(db, event.id)).roles[0]).toMatchObject({ taken: 0, free: 2 });
    });

    it("says why a link no longer works — withdrawn, run out, another event's — and writes nothing", async () => {
      const event = await seedEvent();
      const other = await seedEvent();
      const role = await seedRole(event.id);
      await seedRole(other.id);
      const { secret } = await invite(event.id, "ioana@example.test");
      const [row] = await invitations(event.id);
      expect((await readVolunteerInvitationLink(db, other.id, secret, NOW)).reading).toEqual({ standing: "invalid" });
      expect(await submitVolunteer(db, other.id, form(role.id), NOW, undefined, { inviteSecret: secret })).toEqual({ outcome: "invitation", reason: "invalid" });
      await withdrawVolunteerInvitation(db, admin, row.id, NOW);
      expect(await submitVolunteer(db, event.id, form(role.id), NOW, undefined, { inviteSecret: secret })).toEqual({ outcome: "invitation", reason: "withdrawn" });
      await db.update(eventVolunteerInvitations).set({ withdrawnAt: null, expiresAt: new Date(NOW.getTime() - 1) });
      expect(await submitVolunteer(db, event.id, form(role.id), NOW, undefined, { inviteSecret: secret })).toEqual({ outcome: "invitation", reason: "expired" });
      expect(await volunteers(event.id)).toHaveLength(0);
    });

    it("keeps the link for later when every role filled meanwhile, and honours a live invitation in every choice — including after the club narrowed or widened it", async () => {
      const event = await seedEvent();
      const role = await seedRole(event.id, { needed: 1 });
      const { secret } = await invite(event.id, "ioana@example.test");
      // The organizers gave the one place away: the answer is the polite «full», and the link is not spent.
      await db.insert(eventVolunteers).values({ eventId: event.id, roleId: role.id, name: "Dat", email: "d@example.test", canonicalEmail: "d@example.test", canonicalizationVersion: 2, phone: "+40712345678", source: "STAFF", state: "CONFIRMED" });
      expect(await submitVolunteer(db, event.id, form(role.id), NOW, undefined, { inviteSecret: secret })).toEqual({ outcome: "full" });
      expect((await invitations(event.id))[0].usedAt).toBeNull();
      // INVITED → MEMBERS: the invited person is not a member, and the club wrote to them: the link still opens the door.
      await db.delete(eventVolunteers);
      await setVolunteersAccess(db, admin, { eventId: event.id, access: "MEMBERS" }, NOW);
      expect(await submitVolunteer(db, event.id, form(role.id), NOW, undefined, { inviteSecret: secret })).toEqual({ outcome: "done" });
      expect((await invitations(event.id))[0].usedAt).not.toBeNull();
    });

    it("spends the link of a person already on the list, and answers as it always did", async () => {
      const event = await seedEvent({ volunteersAccess: "ANYONE" });
      const role = await seedRole(event.id);
      expect(await submitVolunteer(db, event.id, form(role.id, { email: "ioana@example.test" }), NOW)).toEqual({ outcome: "done" });
      // The club invited that address before it offered (or by another road): the invitation is answered, no second person is written.
      const secret = generateTokenSecret();
      await db.insert(eventVolunteerInvitations).values({
        eventId: event.id,
        deliveryEmail: "ioana@example.test",
        canonicalEmail: "ioana@example.test",
        canonicalizationVersion: 2,
        tokenHash: hashTokenSecret(secret),
        sentAt: NOW,
        expiresAt: new Date(NOW.getTime() + DAY),
      });
      expect(await submitVolunteer(db, event.id, form(role.id, { email: "ioana@example.test" }), NOW, undefined, { inviteSecret: secret })).toEqual({ outcome: "done" });
      const [row] = await volunteers(event.id);
      expect(await volunteers(event.id)).toHaveLength(1);
      expect((await invitations(event.id))[0]).toMatchObject({ volunteerId: row.id, usedAt: NOW });
    });
  });

  describe("retention", () => {
    it("deletes the invitations with the offers, thirty days after the event began, and keeps those of an event still ahead or only just over", async () => {
      const old = await seedEvent({ startsAt: new Date(NOW.getTime() - 31 * DAY) });
      const recent = await seedEvent({ startsAt: new Date(NOW.getTime() - 29 * DAY) });
      const ahead = await seedEvent();
      for (const [event, sentAt] of [
        [old, new Date(NOW.getTime() - 40 * DAY)],
        [recent, new Date(NOW.getTime() - 40 * DAY)],
        [ahead, NOW],
      ] as const) {
        await db.insert(eventVolunteerInvitations).values({ eventId: event.id, deliveryEmail: "p@example.test", canonicalEmail: "p@example.test", canonicalizationVersion: 2, sentAt, expiresAt: sentAt });
      }
      const result = await pruneExpiredRows(db, NOW);
      expect(result.failures).toEqual([]);
      expect(await invitations(old.id)).toHaveLength(0);
      expect(await invitations(recent.id)).toHaveLength(1);
      expect(await invitations(ahead.id)).toHaveLength(1);
    });

    it("deletes the invitation of an address with the volunteer the card deletes", async () => {
      const event = await seedEvent({ volunteersAccess: "ANYONE" });
      const role = await seedRole(event.id);
      await db.update(events).set({ volunteersAccess: "INVITED" }).where(eq(events.id, event.id));
      await sendVolunteerInvitations(db, admin, { eventId: event.id, addresses: "ioana@example.test", message: "", locale: "ro" }, NOW);
      const { secret } = await renderInvitation((await invitationMail())[0]);
      await submitVolunteer(db, event.id, form(role.id, { email: "x@example.test" }), NOW, undefined, { inviteSecret: secret });
      const { changeVolunteer } = await import("@/modules/volunteers/volunteers");
      const [person] = await volunteers(event.id);
      await changeVolunteer(db, admin, { kind: "delete", eventId: event.id, id: person.id }, NOW);
      expect(await volunteers(event.id)).toHaveLength(0);
      expect(await invitations(event.id)).toHaveLength(0);
    });
  });
});
