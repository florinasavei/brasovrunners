import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { legalDocuments } from "@/db/schema/legal-documents";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { signedTextHash } from "@/modules/legal-documents/domain/signed-text";
import { insertLegalDocumentVersion, listVersionsForBackoffice } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import {
  acceptVolunteerAgreementByLink,
  mintVolunteerAgreementLink,
  readAgreementFacts,
  readVolunteerAgreementLink,
  recordPaperVolunteerAgreement,
  requestVolunteerAgreement,
} from "@/modules/volunteers/agreement";
import { renderVolunteerAgreementPdf, VOLUNTEER_AGREEMENT_PDF_NAME } from "@/modules/volunteers/agreement-pdf";
import { agreementStandingOf } from "@/modules/volunteers/domain/volunteer";
import { changeVolunteer, listVolunteers, submitVolunteer } from "@/modules/volunteers/volunteers";
import { env } from "@/shared/config/env";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { drawnRuns } from "../../helpers/pdf-drawn";

const NOW = new Date("2026-10-13T10:00:00.000Z");
const LATER = new Date("2026-10-14T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();

/**
 * §NNN (amending §754) — the volunteer agreement, accepted by every volunteer before they are listed
 * (BR-REQ-053-01's gate for the volunteers' form, BR-REQ-036-02's link rules for its email link):
 * the form's fourth condition and the acceptance it records, the hand-entered person's «contract neacceptat
 * încă», the organizers' link — minted at the send, hashed at rest, single use, its page a read — the paper
 * acceptance at the desk, the copies by email, the PDF's words, and the legal list counting the acceptances.
 */
describe("§NNN the volunteer agreement", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let technician: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  /** The notice in force names `{{volunteers}}` (§754's gate), in both languages. */
  async function approveNotice() {
    const body = (text: string) => ({ sections: [{ paragraphs: [`Voluntari ({{volunteers}}): ${text}`] }] });
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: body("păstrăm numele") },
      { locale: "en", title: "Privacy", body: body("we keep the name") },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }

  /** The agreement in force from the platform's template, its club facts filled as a club would. */
  async function approveAgreement(version = 1, locales: readonly ("ro" | "en")[] = ["ro", "en"]) {
    const translations: LegalDocumentTranslationInput[] = locales.map((locale) => ({ locale, ...LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale] }));
    return insertLegalDocumentVersion(db, {
      key: "VOLUNTEER_AGREEMENT",
      version,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }

  async function seedEvent() {
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date(NOW.getTime() + 30 * DAY), editorialStatus: "PUBLISHED", publishedAt: new Date(NOW.getTime() - DAY), acceptsVolunteers: true })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul", locationName: "Parcul central" },
      { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title: "The cross", locationName: "Central park" },
    ]);
    const [role] = await db
      .insert(eventVolunteerRoles)
      .values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed: 5, descriptionRo: "Împarte apă la kilometrul 5", descriptionEn: "Hands out water at kilometre 5" })
      .returning();
    return { event, role };
  }

  const form = (roleId: string, extra: Record<string, unknown> = {}) => ({
    roleId,
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

  /** A person an organizer entered by hand: no acceptance yet. */
  async function byHand(eventId: string, roleId: string, email = "ion@example.test") {
    const result = await changeVolunteer(db, admin, { kind: "add", eventId, fields: { roleId, name: "Ion Popescu", email, phone: "+40712345679", note: "" } }, NOW);
    return result.volunteer.id;
  }

  const row = async (id: string) => (await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0];
  const outboxOf = (type: "VOLUNTEER_AGREEMENT_REQUEST" | "VOLUNTEER_AGREEMENT_ACCEPTED" | "VOLUNTEER_RECEIVED") =>
    db.select().from(emailOutbox).where(eq(emailOutbox.messageType, type));
  const render = (outboxRow: unknown, at = NOW) => renderOutboxMessage({ ...(outboxRow as OutboxRow), status: "PROCESSING", lockedAt: at }, db, at);

  /** The secret in a rendered request's button, as the person's mail client would open it. */
  function secretIn(text: string): string {
    const match = text.match(/\/voluntari\/contract\/([A-Za-z0-9_-]{43})/);
    if (!match) throw new Error("no agreement link in the message");
    return match[1];
  }

  beforeEach(async () => {
    await resetTables(db);
    await approveNotice();
    [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Ana Admin", role: "ADMIN" }).returning();
    [technician] = await db.insert(staffUsers).values({ email: "dev@example.test", displayName: "Tudor Tehnic", role: "DEV" }).returning();
  });

  describe("the public form", () => {
    it("is shut while no agreement is in force in every language — one language alone keeps it shut", async () => {
      const { event, role } = await seedEvent();
      await expect(submitVolunteer(db, event.id, form(role.id), NOW)).rejects.toMatchObject({ code: "CONFLICT" });
      await approveAgreement(1, ["ro"]);
      await expect(submitVolunteer(db, event.id, form(role.id), NOW)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await db.select().from(eventVolunteers)).toHaveLength(0);
      await approveAgreement(2);
      expect(await submitVolunteer(db, event.id, form(role.id), NOW)).toEqual({ outcome: "done" });
    });

    it("refuses an offer without the agreement's tick or the age's, naming each as the person's own fix", async () => {
      await approveAgreement();
      const { event, role } = await seedEvent();
      await expect(submitVolunteer(db, event.id, form(role.id, { agreement: false }), NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["agreement"] });
      await expect(submitVolunteer(db, event.id, form(role.id, { adult: false }), NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["adult"] });
      expect(await db.select().from(eventVolunteers)).toHaveLength(0);
    });

    it("stores the acceptance with the version in force, the moment, the way, the language, the blanks and the text's fingerprint", async () => {
      const agreementId = await approveAgreement();
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id, { locale: "en", name: "Mary Test" }), NOW);
      const [person] = await db.select().from(eventVolunteers);
      expect(person).toMatchObject({
        agreementDocumentId: agreementId,
        agreementAcceptedAt: NOW,
        agreementMethod: "FORM",
        agreementLocale: "en",
        declaredAdult: true,
        agreementTokenHash: null,
        agreementRecordedByStaffUserId: null,
      });
      const facts = readAgreementFacts(person.agreementFacts);
      expect(facts).toMatchObject({
        volunteer: "Mary Test",
        volunteerRole: "Water point",
        volunteerTasks: "Hands out water at kilometre 5",
        event: "The cross",
        eventLocation: "Central park",
        minimumAge: "18 years",
      });
      expect(facts?.signedAt).toBeTruthy();
      // The fingerprint is over the English text as filled: recomputed from the row, it is the same.
      const en = LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT.en;
      expect(person.agreementTextHash).toBe(signedTextHash({ title: en.title, body: en.body, values: { ...facts! } }));
      expect(person.agreementTextHash).toMatch(/^[0-9a-f]{64}$/);
      // The person's card line: accepted, on the form.
      const [listed] = await listVolunteers(db, event.id);
      expect(listed).toMatchObject({ agreementMethod: "FORM", agreementVersion: 1, agreementRoleName: "Water point" });
      expect(agreementStandingOf(listed, NOW)).toBe("accepted");
    });

    it("attaches the accepted agreement as a PDF to the person's receipt, and says so", async () => {
      await approveAgreement();
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const [receipt] = await outboxOf("VOLUNTEER_RECEIVED");
      const message = await render(receipt);
      expect(message.attachments?.map((file) => file.filename)).toEqual([VOLUNTEER_AGREEMENT_PDF_NAME]);
      expect(message.attachments?.[0].data.toString("latin1").startsWith("%PDF-1.")).toBe(true);
      expect(message.text).toContain("Contractul de voluntariat pe care l-ai acceptat e atașat, ca PDF.");
      expect(message.text).toContain("The volunteer agreement you accepted is attached as a PDF.");
    });

    it("counts each acceptance on its version in /admin/legal, so a version somebody accepted is never edited or removed as unused", async () => {
      const agreementId = await approveAgreement();
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const version = (await listVersionsForBackoffice(db)).find((candidate) => candidate.id === agreementId);
      expect(version?.acceptanceCount).toBe(1);
      // The database holds it too: the row a volunteer accepted is never deleted under them.
      await expect(db.delete(legalDocuments).where(eq(legalDocuments.id, agreementId))).rejects.toThrow();
    });
  });

  describe("a person entered by hand", () => {
    it("is «contract neacceptat încă» until they accept", async () => {
      await approveAgreement();
      const { event, role } = await seedEvent();
      const id = await byHand(event.id, role.id);
      expect(await row(id)).toMatchObject({ agreementDocumentId: null, agreementAcceptedAt: null, agreementMethod: null, declaredAdult: false });
      const [listed] = await listVolunteers(db, event.id);
      expect(agreementStandingOf(listed, NOW)).toBe("notAccepted");
    });

    it("gets the link only while an agreement is in force, only from who may manage volunteers, and never twice once accepted", async () => {
      const { event, role } = await seedEvent();
      const id = await byHand(event.id, role.id);
      await expect(requestVolunteerAgreement(db, admin, { eventId: event.id, id }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_AGREEMENT_MISSING" });
      await approveAgreement();
      await expect(requestVolunteerAgreement(db, technician, { eventId: event.id, id }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      const other = await seedEvent();
      await expect(requestVolunteerAgreement(db, admin, { eventId: other.event.id, id }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await outboxOf("VOLUNTEER_AGREEMENT_REQUEST")).toHaveLength(0);

      await requestVolunteerAgreement(db, admin, { eventId: event.id, id }, NOW);
      const [queued] = await outboxOf("VOLUNTEER_AGREEMENT_REQUEST");
      expect(queued).toMatchObject({ recipientEmail: "ion@example.test", participantId: null, registrationId: null, requestedByStaffUserId: admin.id });
      // A press queues a message, never a secret (§14.5): no token in the payload, none on the row yet.
      expect(queued.payloadJson).toEqual({ eventId: event.id, volunteerId: id });
      expect(await row(id)).toMatchObject({ agreementRequestedAt: NOW, agreementTokenHash: null });
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.agreement_requested"));
      expect(audit).toMatchObject({ actorStaffUserId: admin.id, entityId: event.id, metadataJson: { volunteerId: id } });

      // A cancelled person is not asked.
      await changeVolunteer(db, admin, { kind: "setState", eventId: event.id, id, state: "CANCELLED" }, NOW);
      await expect(requestVolunteerAgreement(db, admin, { eventId: event.id, id }, LATER)).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("is sent a link minted at the send, kept only as its SHA-256, which opens a page that reads and never writes", async () => {
      await approveAgreement();
      const { event, role } = await seedEvent();
      const id = await byHand(event.id, role.id);
      await requestVolunteerAgreement(db, admin, { eventId: event.id, id }, NOW);
      const [queued] = await outboxOf("VOLUNTEER_AGREEMENT_REQUEST");
      const message = await render(queued);
      expect(message.subject).toBe("Contractul de voluntariat pentru Crosul / The volunteer agreement for The cross");
      expect(message.text).toContain(`${env.APP_BASE_URL}/ro/voluntari/contract/`);
      const secret = secretIn(message.text);
      const stored = await row(id);
      // Hashed at rest: the row holds the digest, and nothing holds the secret.
      expect(stored.agreementTokenHash).toBe(createHash("sha256").update(secret, "utf8").digest("hex"));
      expect(JSON.stringify(stored)).not.toContain(secret);
      expect(JSON.stringify(await db.select().from(emailOutbox))).not.toContain(secret);
      expect(agreementStandingOf({ agreementAcceptedAt: stored.agreementAcceptedAt, agreementTokenExpiresAt: stored.agreementTokenExpiresAt }, NOW)).toBe("linkSent");

      // GET never mutates: reading twice changes nothing, and shows the text filled for this person.
      const view = await readVolunteerAgreementLink(db, secret, "ro", NOW);
      await readVolunteerAgreementLink(db, secret, "ro", NOW);
      expect(await row(id)).toEqual(stored);
      expect(view).toMatchObject({ status: "open", name: "Ion Popescu", eventTitle: "Crosul", roleName: "Punct de apă" });
      if (view.status === "open") {
        expect(view.values).toMatchObject({ volunteer: "Ion Popescu", volunteerRole: "Punct de apă", volunteerTasks: "Împarte apă la kilometrul 5", minimumAge: "18 ani" });
        expect(view.values.signedAt).toBeUndefined();
      }
      // A forged or malformed secret reads as nothing, the one answer.
      expect(await readVolunteerAgreementLink(db, "x".repeat(43), "ro", NOW)).toEqual({ status: "invalid" });
      expect(await readVolunteerAgreementLink(db, "short", "ro", NOW)).toEqual({ status: "invalid" });
    });

    it("accepts from the link once — the ticks required, the link spent in the same statement — and sends the person's copy", async () => {
      const agreementId = await approveAgreement();
      const { event, role } = await seedEvent();
      const id = await byHand(event.id, role.id);
      const link = await mintVolunteerAgreementLink(db, id, NOW);
      expect(link).not.toBeNull();
      const secret = link!.secret;

      await expect(acceptVolunteerAgreementByLink(db, secret, { agreement: false, adult: true, locale: "ro" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["agreement"] });
      await expect(acceptVolunteerAgreementByLink(db, secret, { agreement: true, adult: false, locale: "ro" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["adult"] });
      // A refused tick spends nothing.
      expect((await row(id)).agreementTokenHash).not.toBeNull();

      expect(await acceptVolunteerAgreementByLink(db, secret, { agreement: true, adult: true, locale: "en" }, LATER)).toEqual({ outcome: "accepted", volunteerId: id });
      expect(await row(id)).toMatchObject({
        agreementDocumentId: agreementId,
        agreementAcceptedAt: LATER,
        agreementMethod: "LINK",
        agreementLocale: "en",
        declaredAdult: true,
        agreementTokenHash: null,
        agreementTokenExpiresAt: null,
      });
      // Single use: the same link again, a second tab, a replay — nothing.
      expect(await acceptVolunteerAgreementByLink(db, secret, { agreement: true, adult: true, locale: "en" }, LATER)).toEqual({ outcome: "invalid" });
      expect(await readVolunteerAgreementLink(db, secret, "en", LATER)).toEqual({ status: "invalid" });

      const [copy] = await outboxOf("VOLUNTEER_AGREEMENT_ACCEPTED");
      expect(copy).toMatchObject({ recipientEmail: "ion@example.test", locale: "en", idempotencyKey: `volunteer:${id}:agreement-accepted` });
      const message = await render(copy, LATER);
      expect(message.subject).toContain("You accepted the volunteer agreement for The cross");
      expect(message.attachments?.map((file) => file.filename)).toEqual([VOLUNTEER_AGREEMENT_PDF_NAME]);
      expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "volunteer.agreement_accepted"), eq(auditLogs.entityId, event.id)))).toHaveLength(1);

      // Accepted: no further link, no paper record.
      await expect(requestVolunteerAgreement(db, admin, { eventId: event.id, id }, LATER)).rejects.toMatchObject({ code: "VOLUNTEER_AGREEMENT_ACCEPTED" });
      await expect(recordPaperVolunteerAgreement(db, admin, { eventId: event.id, id }, LATER)).rejects.toMatchObject({ code: "VOLUNTEER_AGREEMENT_ACCEPTED" });
      expect(await mintVolunteerAgreementLink(db, id, LATER)).toBeNull();
    });

    it("kills a link that expired, one a newer email replaced, one sent to an address changed since, and one of a cancelled person", async () => {
      await approveAgreement();
      const { event, role } = await seedEvent();
      const id = await byHand(event.id, role.id);
      const accept = (secret: string, at: Date) => acceptVolunteerAgreementByLink(db, secret, { agreement: true, adult: true, locale: "ro" }, at);

      const first = (await mintVolunteerAgreementLink(db, id, NOW))!;
      // Past its expiry: nothing.
      expect(await accept(first.secret, new Date(first.expiresAt.getTime() + 1))).toEqual({ outcome: "invalid" });
      // A newer email's link replaces the older one.
      const second = (await mintVolunteerAgreementLink(db, id, NOW))!;
      expect(await accept(first.secret, NOW)).toEqual({ outcome: "invalid" });
      // The address changed: the link went to the old one, and dies.
      await changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id, fields: { roleId: role.id, name: "Ion Popescu", email: "ion.nou@example.test", phone: "+40712345679", note: "" } }, NOW);
      expect(await accept(second.secret, NOW)).toEqual({ outcome: "invalid" });
      // Cancelled: no link is minted, none is honoured.
      const third = (await mintVolunteerAgreementLink(db, id, NOW))!;
      await changeVolunteer(db, admin, { kind: "setState", eventId: event.id, id, state: "CANCELLED" }, NOW);
      expect(await accept(third.secret, NOW)).toEqual({ outcome: "invalid" });
      expect(await mintVolunteerAgreementLink(db, id, NOW)).toBeNull();
      expect((await row(id)).agreementAcceptedAt).toBeNull();
    });

    it("withdraws a request email whose person accepted since, and mints nothing for them", async () => {
      await approveAgreement();
      const { event, role } = await seedEvent();
      const id = await byHand(event.id, role.id);
      await requestVolunteerAgreement(db, admin, { eventId: event.id, id }, NOW);
      await recordPaperVolunteerAgreement(db, admin, { eventId: event.id, id }, NOW);
      const [queued] = await outboxOf("VOLUNTEER_AGREEMENT_REQUEST");
      await expect(render(queued)).rejects.toThrow(/accepted/i);
      expect((await row(id)).agreementTokenHash).toBeNull();
    });

    it("records a paper acceptance at the desk with the version in force and who recorded it — never by a role that may not", async () => {
      const { event, role } = await seedEvent();
      const id = await byHand(event.id, role.id);
      await expect(recordPaperVolunteerAgreement(db, admin, { eventId: event.id, id }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_AGREEMENT_MISSING" });
      const agreementId = await approveAgreement();
      await expect(recordPaperVolunteerAgreement(db, technician, { eventId: event.id, id }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await recordPaperVolunteerAgreement(db, admin, { eventId: event.id, id }, NOW);
      expect(await row(id)).toMatchObject({
        agreementDocumentId: agreementId,
        agreementMethod: "PAPER",
        agreementLocale: "ro",
        agreementRecordedByStaffUserId: admin.id,
        declaredAdult: true,
      });
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.agreement_recorded"));
      expect(audit).toMatchObject({ actorStaffUserId: admin.id, metadataJson: { volunteerId: id, version: 1, method: "PAPER" } });
      // The audit row names the volunteer by id only, never the person's words.
      expect(JSON.stringify(audit.metadataJson)).not.toContain("Ion");
    });

    it("keeps what was accepted when the role is renamed or the person moved since: the card says which role", async () => {
      await approveAgreement();
      const { event, role } = await seedEvent();
      const id = await byHand(event.id, role.id);
      await recordPaperVolunteerAgreement(db, admin, { eventId: event.id, id }, NOW);
      await db.update(eventVolunteerRoles).set({ nameRo: "Hidratare", nameEn: "Hydration" }).where(eq(eventVolunteerRoles.id, role.id));
      const [listed] = await listVolunteers(db, event.id);
      expect(listed.agreementRoleName).toBe("Punct de apă");
      expect(readAgreementFacts((await row(id)).agreementFacts)?.volunteerRole).toBe("Punct de apă");
    });
  });

  describe("the PDF", () => {
    const words = async (volunteerId: string, at = NOW) => (await drawnRuns(() => renderVolunteerAgreementPdf(db, volunteerId, at))).map((run) => run.text).join(" ");

    it("prints the accepted text with the blanks as accepted, the name, the way and the fingerprint", async () => {
      await approveAgreement();
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const [person] = await db.select().from(eventVolunteers);
      const rendered = await renderVolunteerAgreementPdf(db, person.id, NOW);
      expect(rendered?.accepted).toBe(true);
      expect(rendered?.pdf.toString("latin1").startsWith("%PDF-1.")).toBe(true);
      const text = await words(person.id);
      expect(text).toContain("CONTRACT DE VOLUNTARIAT");
      expect(text).toContain("Maria Test");
      expect(text).toContain("Punct de apă");
      expect(text).toContain("Împarte apă la kilometrul 5");
      expect(text).toContain("Crosul");
      expect(text).toContain("18 ani");
      // Unpaid, the law, and how it was accepted — on the form, an electronic signature.
      expect(text).toContain("fără plată");
      expect(text).toContain("Legii nr. 78/2014");
      expect(text).toContain("Acceptat electronic");
      expect(text).toContain("pe pagina evenimentului");
      expect(text).toContain(person.agreementTextHash!);
      // No identity document is asked anywhere.
      expect(text).not.toContain("Act de identitate");
    });

    it("prints a copy to sign at the desk for a person who has not accepted: their blanks, two signature lines, no typed signature", async () => {
      const { event, role } = await seedEvent();
      const id = await byHand(event.id, role.id);
      // Nothing in force: nothing to print.
      expect(await renderVolunteerAgreementPdf(db, id, NOW)).toBeUndefined();
      await approveAgreement();
      const rendered = await renderVolunteerAgreementPdf(db, id, NOW);
      expect(rendered?.accepted).toBe(false);
      const text = await words(id);
      expect(text).toContain("Ion Popescu");
      expect(text).toContain("Punct de apă");
      expect(text).toContain("DREPT PENTRU CARE SEMNĂM,");
      expect(text).toContain("Semnătura voluntarului:");
      expect(text).toContain("Pentru organizator (nume și semnătură):");
      expect(text).not.toContain("Acceptat electronic");
      expect(text).not.toContain("Act de identitate");
    });

    it("prints a paper acceptance with who recorded it", async () => {
      await approveAgreement();
      const { event, role } = await seedEvent();
      const id = await byHand(event.id, role.id);
      await recordPaperVolunteerAgreement(db, admin, { eventId: event.id, id }, NOW);
      const text = await words(id);
      expect(text).toContain("Semnat pe hârtie");
      expect(text).toContain("Ana Admin");
    });
  });
});
