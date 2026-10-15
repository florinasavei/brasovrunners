import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { removalPlan } from "@/modules/legal-documents/domain/deletability";
import { findCurrentApprovedDocument, insertLegalDocumentVersion, listVersionsForBackoffice, volunteerMinorsOpen } from "@/modules/legal-documents/repository";
import { readDeletionFacts } from "@/modules/legal-documents/service";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { acceptVolunteerAgreementByLink, mintVolunteerAgreementLink, readVolunteerAgreementLink, readAgreementFacts } from "@/modules/volunteers/agreement";
import { renderVolunteerAgreementPdf } from "@/modules/volunteers/agreement-pdf";
import { ageOn } from "@/modules/registrations/domain/age";
import { agreementMinimumAge, agreementRolesStamp, guardianStandingOf } from "@/modules/volunteers/domain/volunteer";
import {
  acceptVolunteerGuardianByLink,
  mintVolunteerGuardianLink,
  readVolunteerGuardianLink,
  recordPaperVolunteerGuardian,
  requestVolunteerGuardian,
} from "@/modules/volunteers/guardian";
import { changeVolunteer, listVolunteers, submitVolunteer } from "@/modules/volunteers/volunteers";
import { env } from "@/shared/config/env";
import { roleDescription } from "../../helpers/role-description";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { drawnRuns } from "../../helpers/pdf-drawn";

import { bornAged, bornAgedOn } from "../../helpers/volunteer-birth";

const NOW = new Date("2026-10-13T10:00:00.000Z");
const LATER = new Date("2026-10-14T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
/** A date of birth that makes a person `years` old on the event's day (§NNN): the last day of being so. */
const aged = (years: number) => bornAged(years, new Date(NOW.getTime() + 30 * DAY));
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();

/**
 * §768 — volunteers from fourteen, with a parent's or guardian's agreement under eighteen (the owner, 2026-10-14): the
 * age boundary on the public form and the organizers' entry, the guardian's single-use link (minted at the send, hashed
 * at rest, single use, a read that never writes — AGENTS.md §12.8), the paper record at the desk, «Acordul părintelui
 * lipsește» and the refusal to confirm, the PDF's second signer, and the gate: nobody under eighteen is taken until a
 * privacy notice naming `{{volunteerMinors}}` and an agreement naming `{{volunteerGuardian}}` are in force in every language.
 */
describe("§768 volunteers under eighteen and their guardian", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let technician: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  /** The notice in force names the volunteers' markers in both languages; `minors: false` is a notice from §765's template, silent on minors. */
  async function approveNotice(version = 1, minors = true) {
    const marker = `{{volunteers}}, {{volunteerAgreement}}, {{volunteerProfile}}${minors ? ", {{volunteerMinors}}" : ""}`;
    const body = (text: string) => ({ sections: [{ paragraphs: [`Voluntari (${marker}): ${text}`] }] });
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: body("păstrăm numele") },
      { locale: "en", title: "Privacy", body: body("we keep the name") },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }

  /** A notice approved before the profile's boxes were named (§758's): the form asks no date and the entry takes none. */
  async function approveNoticeWithoutProfile() {
    const body = (text: string) => ({ sections: [{ paragraphs: [`Voluntari ({{volunteers}}, {{volunteerAgreement}}): ${text}`] }] });
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
    await approveAgreement();
  }

  /** The agreement in force: the platform's template (its minors' clause names the guardian), or — `minors: false` — one approved before it. */
  async function approveAgreement(version = 1, minors = true, locales: readonly ("ro" | "en")[] = ["ro", "en"]) {
    const without = (locale: "ro" | "en") => {
      const template = LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale];
      const sections = template.body.sections.map((section) => ({ ...section, paragraphs: section.paragraphs.filter((paragraph) => !paragraph.includes("{{volunteerGuardian}}")) }));
      return { ...template, body: { ...template.body, sections } };
    };
    const translations: LegalDocumentTranslationInput[] = locales.map((locale) => ({ locale, ...(minors ? LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale] : without(locale)) }));
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
      .values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed: 5, ...roleDescription("Împarte apă la kilometrul 5", "Hands out water at kilometre 5") })
      .returning();
    return { event, role };
  }

  /** What the volunteers' page posts: the profile's boxes, and — for a minor — the parent's. */
  const form = (roleId: string, extra: Record<string, unknown> = {}) => ({
    roleIds: [roleId],
    name: "Dan Tânărul",
    email: "dan@example.test",
    phone: "+40712345678",
    message: "",
    locale: "ro",
    consent: true,
    agreement: true,
    birthDate: aged(15),
    sex: "MALE",
    city: "Brașov",
    guardianName: "Maria Popescu",
    guardianEmail: "maria@example.test",
    guardianAware: true,
    renderedAt: RENDERED,
    ...extra,
  });

  /** A minor an organizer entered by hand, with the parent's name and address — the role ticked and given. */
  async function minorByHand(eventId: string, roleId: string, extra: Record<string, unknown> = {}) {
    const result = await changeVolunteer(
      db,
      admin,
      {
        kind: "add",
        eventId,
        fields: { roleIds: [roleId], assignedRoleId: roleId, name: "Dan Tânărul", email: "dan@example.test", phone: "+40712345679", note: "", birthDate: aged(15), guardianName: "Maria Popescu", guardianEmail: "maria@example.test", ...extra },
      },
      NOW,
    );
    return result.volunteer.id;
  }

  const row = async (id: string) => (await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0];
  const outboxOf = (type: "VOLUNTEER_GUARDIAN_REQUEST" | "VOLUNTEER_AGREEMENT_ACCEPTED" | "VOLUNTEER_RECEIVED" | "VOLUNTEER_AGREEMENT_REQUEST") =>
    db.select().from(emailOutbox).where(eq(emailOutbox.messageType, type));
  const render = (outboxRow: unknown, at = NOW) => renderOutboxMessage({ ...(outboxRow as OutboxRow), status: "PROCESSING", lockedAt: at }, db, at);
  const choicesOf = async (id: string) =>
    (await db.select({ roleId: eventVolunteerRoleChoices.roleId }).from(eventVolunteerRoleChoices).where(eq(eventVolunteerRoleChoices.volunteerId, id))).map((choice) => choice.roleId);
  const words = async (volunteerId: string, options: { sheet?: boolean } = {}, at = NOW) =>
    (await drawnRuns(() => renderVolunteerAgreementPdf(db, volunteerId, at, options))).map((run) => run.text).join(" ");

  /** The secret in a rendered guardian message's button, as the parent's mail client would open it. */
  function guardianSecretIn(text: string): string {
    const match = text.match(/\/voluntari\/parinte\/([A-Za-z0-9_-]{43})/);
    if (!match) throw new Error("no guardian link in the message");
    return match[1];
  }

  /** What the card's «PDF de semnat de părinte» printed for this person now: the version in force in their language and their roles. */
  async function printedFor(id: string, at = NOW) {
    const person = await row(id);
    const version = await findCurrentApprovedDocument(db, "VOLUNTEER_AGREEMENT", person.locale, at);
    return { documentId: version?.id ?? "00000000-0000-4000-8000-000000000000", roles: agreementRolesStamp(person.roleId, await choicesOf(id)) };
  }

  beforeEach(async () => {
    await resetTables(db);
    await approveNotice();
    await approveAgreement();
    [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Ana Admin", role: "ADMIN" }).returning();
    [technician] = await db.insert(staffUsers).values({ email: "dev@example.test", displayName: "Tudor Tehnic", role: "DEV" }).returning();
  });

  describe("the club takes nobody under eighteen until both texts say so", () => {
    it("is open only with a notice naming the minors AND an agreement naming the guardian, each in every language", async () => {
      expect(await volunteerMinorsOpen(db, NOW)).toBe(true);
      await approveNotice(2, false);
      expect(await volunteerMinorsOpen(db, NOW)).toBe(false);
      await approveNotice(3, true);
      expect(await volunteerMinorsOpen(db, NOW)).toBe(true);
      await approveAgreement(2, false);
      expect(await volunteerMinorsOpen(db, NOW)).toBe(false);
      // One language alone keeps it shut: a person accepts in the language of the page.
      await approveAgreement(3, true, ["ro"]);
      expect(await volunteerMinorsOpen(db, NOW)).toBe(false);
    });

    it("says on the age's own box that a person under eighteen is not taken yet — the adults' form is untouched", async () => {
      await approveNotice(2, false);
      const { event, role } = await seedEvent();
      await expect(submitVolunteer(db, event.id, form(role.id), NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["birthDate"] });
      expect(await db.select().from(eventVolunteers)).toHaveLength(0);
      expect(await db.select().from(emailOutbox)).toHaveLength(0);
      // An adult is taken as ever, the guardian's boxes dropped.
      expect(await submitVolunteer(db, event.id, form(role.id, { birthDate: aged(30), guardianName: "", guardianEmail: "", guardianAware: false }), NOW)).toEqual({ outcome: "done" });
    });

    it("says the same while the agreement carries no clause for the guardian", async () => {
      await approveAgreement(2, false);
      const { event, role } = await seedEvent();
      await expect(submitVolunteer(db, event.id, form(role.id), NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["birthDate"] });
    });

    it("keeps the organizers' entry shut to a person under eighteen too, naming the age", async () => {
      await approveNotice(2, false);
      const { event, role } = await seedEvent();
      await expect(
        changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: { roleIds: [role.id], assignedRoleId: "", name: "Dan", email: "dan@example.test", phone: "+40712345679", note: "", birthDate: aged(15), guardianName: "Maria Popescu" } }, NOW),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["birthDate"] });
      expect(await db.select().from(eventVolunteers)).toHaveLength(0);
    });
  });

  describe("the text in force decides what a guardian may accept and what the blanks say", () => {
    it("answers «nothing to accept» to a link minted before the club approved a version with no clause for the guardian — and records nothing", async () => {
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const [person] = await db.select().from(eventVolunteers);
      const secret = (await mintVolunteerGuardianLink(db, person.id, "maria@example.test", NOW))!.secret;
      expect(await readVolunteerGuardianLink(db, secret, "ro", NOW)).toMatchObject({ status: "open" });
      await approveAgreement(2, false);
      expect(await readVolunteerGuardianLink(db, secret, "ro", LATER)).toEqual({ status: "noAgreement" });
      expect(await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, LATER)).toEqual({ outcome: "noAgreement" });
      expect(await row(person.id)).toMatchObject({ guardianAcceptedAt: null, guardianDocumentId: null, guardianTextHash: null });
      expect(await changeVolunteer(db, admin, { kind: "setState", eventId: event.id, id: person.id, state: "CONFIRMED" }, LATER).catch((error) => error.code)).toBe("VOLUNTEER_GUARDIAN_MISSING");
      // The clause comes back with a newer version: the same link, still live, is a text to accept again.
      await approveAgreement(3, true);
      expect(await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, LATER)).toMatchObject({ outcome: "accepted" });
    });

    it("keeps saying eighteen in a text approved before the minors' clause, and fourteen in one that carries it", async () => {
      await approveAgreement(2, false);
      const { event, role } = await seedEvent();
      // An adult signs under the old text: its blanks, its fingerprint and the page it read all say eighteen.
      expect(await submitVolunteer(db, event.id, form(role.id, { birthDate: aged(30), guardianName: "", guardianEmail: "", guardianAware: false }), NOW)).toEqual({ outcome: "done" });
      const [adult] = await db.select().from(eventVolunteers);
      expect(readAgreementFacts(adult.agreementFacts)?.minimumAge).toBe("18 ani");
      const old = await findCurrentApprovedDocument(db, "VOLUNTEER_AGREEMENT", "ro", NOW);
      expect(agreementMinimumAge(old!.body)).toBe(18);
      await approveAgreement(3, true);
      const current = await findCurrentApprovedDocument(db, "VOLUNTEER_AGREEMENT", "ro", NOW);
      expect(agreementMinimumAge(current!.body)).toBe(14);
    });

    it("counts a guardian's acceptance as a signature on the version they read: a version only a parent accepted is retired, never hard-deleted", async () => {
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const [person] = await db.select().from(eventVolunteers);
      // The parent reads a newer version than the volunteer did.
      const second = await approveAgreement(2);
      const secret = (await mintVolunteerGuardianLink(db, person.id, "maria@example.test", NOW))!.secret;
      await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, LATER);
      // Superseded by a third: the second is no longer in force.
      await approveAgreement(3);
      const versions = await listVersionsForBackoffice(db);
      const mine = versions.find((version) => version.id === second)!;
      expect(mine.acceptanceCount).toBe(1);
      const [facts] = await readDeletionFacts(db, [mine], versions, LATER);
      expect(removalPlan(facts)).toMatchObject({ kind: "retire", reliance: { signatures: 1 } });
    });
  });

  describe("the organizers' card while the texts do not describe minors", () => {
    it("refuses a typed age under eighteen on the age's own box — the only one the card draws — whether the parent's boxes came or not", async () => {
      const { event, role } = await seedEvent();
      const id = await minorByHand(event.id, role.id, { birthDate: aged(40), guardianName: "", guardianEmail: "" });
      await approveNotice(2, false);
      const base = { roleIds: [role.id], assignedRoleId: role.id, name: "Dan Tânărul", email: "dan@example.test", phone: "+40712345679", note: "" };
      // No boxes posted (the card drew none): the refusal is the age's, not a guardianName nobody can see.
      await expect(changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id, fields: { ...base, birthDate: aged(16) } }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["birthDate"] });
      await expect(changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: { ...base, email: "ion@example.test", birthDate: aged(16) } }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["birthDate"] });
      expect(await row(id)).toMatchObject({ age: 40, guardianName: null });
      // Thirteen is the age's own refusal whatever the texts say; an adult's age saves.
      await expect(changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id, fields: { ...base, birthDate: aged(13) } }, NOW)).rejects.toMatchObject({ fields: ["birthDate"] });
      expect(await changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id, fields: { ...base, birthDate: aged(41) } }, NOW)).toMatchObject({ changed: true });
    });

    it("keeps refusing on the parent's boxes for a person who already is under eighteen — they are drawn for them", async () => {
      const { event, role } = await seedEvent();
      const id = await minorByHand(event.id, role.id);
      await approveNotice(2, false);
      const base = { roleIds: [role.id], assignedRoleId: role.id, name: "Dan Tânărul", email: "dan@example.test", phone: "+40712345679", note: "", birthDate: aged(16) };
      await expect(changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id, fields: base }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["guardianName"] });
    });
  });

  describe("the public form: the boundary", () => {
    it("refuses thirteen on the age's box, fourteen without a guardian on each of the three boxes, and takes fourteen to seventeen with one", async () => {
      const { event, role } = await seedEvent();
      await expect(submitVolunteer(db, event.id, form(role.id, { birthDate: aged(13) }), NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["birthDate"] });
      const alone = submitVolunteer(db, event.id, form(role.id, { birthDate: aged(14), guardianName: "", guardianEmail: "", guardianAware: false }), NOW);
      await expect(alone).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await alone.catch((error) => expect([...error.fields].sort()).toEqual(["guardianAware", "guardianEmail", "guardianName"]));
      expect(await db.select().from(eventVolunteers)).toHaveLength(0);
      expect(await db.select().from(emailOutbox)).toHaveLength(0);

      for (const [index, age] of [14, 17].entries()) {
        expect(await submitVolunteer(db, event.id, form(role.id, { birthDate: aged(age), email: `dan${index}@example.test`, guardianEmail: `maria${index}@example.test` }), NOW)).toEqual({ outcome: "done" });
      }
      const people = await db.select().from(eventVolunteers);
      expect(people.map((person) => person.age).sort()).toEqual([14, 17]);
    });

    it("keeps a minor's offer with the guardian's name and address, the volunteer's own acceptance — never «declared of age» — and asks the guardian by email", async () => {
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const [person] = await db.select().from(eventVolunteers);
      expect(person).toMatchObject({
        age: 15,
        state: "REGISTERED",
        source: "PUBLIC",
        guardianName: "Maria Popescu",
        guardianEmail: "maria@example.test",
        guardianRequestedAt: NOW,
        guardianAcceptedAt: null,
        guardianTokenHash: null,
        agreementMethod: "FORM",
        declaredAdult: false,
      });
      // The guardian's name rides in the blanks the volunteer's own acceptance is fingerprinted over.
      expect(JSON.stringify(person.agreementFacts)).toContain("Maria Popescu");
      // The guardian's mail, in the language of the page, with no secret yet — minted at the send.
      const [request] = await outboxOf("VOLUNTEER_GUARDIAN_REQUEST");
      expect(request).toMatchObject({ recipientEmail: "maria@example.test", locale: "ro", participantId: null, registrationId: null });
      expect(request.payloadJson).toEqual({ eventId: event.id, volunteerId: person.id });
      // The volunteer's own «am primit», and the trail: that a minor offered, never who.
      expect(await outboxOf("VOLUNTEER_RECEIVED")).toHaveLength(1);
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.signed_up"));
      expect(audit.metadataJson).toMatchObject({ volunteerId: person.id, minor: true });
      expect(JSON.stringify(audit.metadataJson)).not.toMatch(/Popescu|maria@/);
      // The state the card shows.
      const [listed] = await listVolunteers(db, event.id);
      expect(guardianStandingOf(listed, NOW)).toBe("missing");
    });

    it("takes eighteen alone and keeps nothing of the guardian's boxes", async () => {
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id, { birthDate: aged(18) }), NOW);
      const [person] = await db.select().from(eventVolunteers);
      expect(person).toMatchObject({ age: 18, guardianName: null, guardianEmail: null, guardianRequestedAt: null });
      expect(await outboxOf("VOLUNTEER_GUARDIAN_REQUEST")).toHaveLength(0);
      const [listed] = await listVolunteers(db, event.id);
      expect(guardianStandingOf(listed, NOW)).toBe("notNeeded");
    });

    it("throttles the guardian's address too: three an hour, so a script cannot spend a parent's mailbox", async () => {
      const { event, role } = await seedEvent();
      const results = [];
      for (const [index] of [1, 2, 3, 4].entries()) {
        results.push(await submitVolunteer(db, event.id, form(role.id, { email: `dan${index}@example.test`, guardianEmail: "maria@example.test" }), NOW));
      }
      expect(results.map((result) => result.outcome)).toEqual(["done", "done", "done", "limited"]);
      expect(await outboxOf("VOLUNTEER_GUARDIAN_REQUEST")).toHaveLength(3);
    });
  });

  describe("the guardian's link (AGENTS.md §12.8: hashed at rest, single use, GET never mutates)", () => {
    it("is minted when the email leaves, kept only as its SHA-256, and opens a page that reads and never writes", async () => {
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const [person] = await db.select().from(eventVolunteers);
      const [request] = await outboxOf("VOLUNTEER_GUARDIAN_REQUEST");
      const message = await render(request);
      expect(message.subject).toContain("Crosul");
      expect(message.text).toContain(`${env.APP_BASE_URL}/ro/voluntari/parinte/`);
      // The volunteer's name is in the body, the greeting names nobody: the mail is a parent's, not the child's.
      expect(message.text).toContain("Dan Tânărul");
      const secret = guardianSecretIn(message.text);
      const stored = await row(person.id);
      expect(stored.guardianTokenHash).toBe(createHash("sha256").update(secret, "utf8").digest("hex"));
      expect(JSON.stringify(stored)).not.toContain(secret);
      expect(JSON.stringify(await db.select().from(emailOutbox))).not.toContain(secret);
      expect(guardianStandingOf(stored, NOW)).toBe("linkSent");

      // GET never mutates: reading twice changes nothing, and shows the text filled for the volunteer, the guardian's name in the clause.
      const view = await readVolunteerGuardianLink(db, secret, "ro", NOW);
      await readVolunteerGuardianLink(db, secret, "ro", NOW);
      expect(await row(person.id)).toEqual(stored);
      expect(view).toMatchObject({ status: "open", guardianName: "Maria Popescu", volunteerName: "Dan Tânărul", eventTitle: "Crosul" });
      if (view.status === "open") {
        expect(view.values).toMatchObject({ volunteer: "Dan Tânărul", volunteerGuardian: "Maria Popescu", minimumAge: "14 ani" });
        expect(view.values.signedAt).toBeUndefined();
      }
      // A forged or malformed secret reads as nothing, the one answer.
      expect(await readVolunteerGuardianLink(db, "x".repeat(43), "ro", NOW)).toEqual({ status: "invalid" });
      expect(await readVolunteerGuardianLink(db, "short", "ro", NOW)).toEqual({ status: "invalid" });
    });

    it("accepts once — the tick and the typed name required, the link spent in the same statement — and sends the volunteer their copy", async () => {
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const [person] = await db.select().from(eventVolunteers);
      const secret = (await mintVolunteerGuardianLink(db, person.id, "maria@example.test", NOW))!.secret;

      await expect(acceptVolunteerGuardianByLink(db, secret, { agreement: false, typedName: "Maria Popescu", locale: "ro" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["agreement"] });
      await expect(acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "  ", locale: "ro" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["typedName"] });
      // A refused press spends nothing.
      expect((await row(person.id)).guardianTokenHash).not.toBeNull();

      expect(await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria  Popescu", locale: "en" }, LATER)).toEqual({ outcome: "accepted", volunteerId: person.id });
      const accepted = await row(person.id);
      expect(accepted).toMatchObject({
        guardianAcceptedAt: LATER,
        guardianMethod: "LINK",
        guardianLocale: "en",
        guardianTypedName: "Maria Popescu",
        guardianRecordedByStaffUserId: null,
        guardianTokenHash: null,
        guardianTokenExpiresAt: null,
      });
      expect(accepted.guardianDocumentId).not.toBeNull();
      expect(accepted.guardianTextHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(accepted.guardianFacts)).toContain("Maria Popescu");
      // The volunteer's own acceptance is untouched; the guardian's is its own proof.
      expect(accepted.agreementMethod).toBe("FORM");
      expect(guardianStandingOf(accepted, LATER)).toBe("accepted");

      // Single use: the same link again finds nothing, and so does a second tab.
      expect(await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, LATER)).toEqual({ outcome: "invalid" });
      expect(await readVolunteerGuardianLink(db, secret, "ro", LATER)).toEqual({ status: "invalid" });
      // The volunteer's copy, queued once, with the guardian's acceptance on its PDF; the trail has no name in it.
      expect(await outboxOf("VOLUNTEER_AGREEMENT_ACCEPTED")).toHaveLength(1);
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.guardian_accepted"));
      expect(audit).toMatchObject({ actorStaffUserId: null, entityId: event.id, metadataJson: { volunteerId: person.id, method: "LINK" } });
      expect(JSON.stringify(audit.metadataJson)).not.toMatch(/Popescu|maria@/);
    });

    it("is newest-wins: a newer link replaces the older, and the older then finds nothing", async () => {
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const [person] = await db.select().from(eventVolunteers);
      const older = (await mintVolunteerGuardianLink(db, person.id, "maria@example.test", NOW))!.secret;
      const newer = (await mintVolunteerGuardianLink(db, person.id, "maria@example.test", LATER))!.secret;
      expect((await readVolunteerGuardianLink(db, older, "ro", LATER)).status).toBe("invalid");
      expect((await readVolunteerGuardianLink(db, newer, "ro", LATER)).status).toBe("open");
    });

    it("dies at its expiry, for a cancelled volunteer, for one no longer under eighteen — one answer, whatever the reason", async () => {
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const [person] = await db.select().from(eventVolunteers);
      const secret = (await mintVolunteerGuardianLink(db, person.id, "maria@example.test", NOW))!.secret;
      const farFuture = new Date(NOW.getTime() + 365 * DAY);
      expect(await readVolunteerGuardianLink(db, secret, "ro", farFuture)).toEqual({ status: "invalid" });
      await changeVolunteer(db, admin, { kind: "setState", eventId: event.id, id: person.id, state: "CANCELLED" }, NOW);
      expect(await readVolunteerGuardianLink(db, secret, "ro", NOW)).toEqual({ status: "invalid" });
      expect(await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, NOW)).toEqual({ outcome: "invalid" });
      expect(await mintVolunteerGuardianLink(db, person.id, "maria@example.test", NOW)).toBeNull();
    });

    it("mints nothing for an address that is not the guardian's now, and withdraws a request queued before it was corrected", async () => {
      const { event, role } = await seedEvent();
      const id = await minorByHand(event.id, role.id);
      await requestVolunteerGuardian(db, admin, { eventId: event.id, id }, NOW);
      const [request] = await outboxOf("VOLUNTEER_GUARDIAN_REQUEST");
      // While the email waits, the organizer corrects the parent's address.
      await changeVolunteer(
        db,
        admin,
        { kind: "edit", eventId: event.id, id, fields: { roleIds: [role.id], assignedRoleId: role.id, name: "Dan Tânărul", email: "dan@example.test", phone: "+40712345679", note: "", birthDate: aged(15), guardianName: "Maria Popescu", guardianEmail: "maria.noua@example.test" } },
        NOW,
      );
      expect(await mintVolunteerGuardianLink(db, id, "maria@example.test", NOW)).toBeNull();
      await expect(render(request, LATER)).rejects.toThrow(/can no longer be asked/i);
      expect(await row(id)).toMatchObject({ guardianTokenHash: null, guardianTokenExpiresAt: null, guardianAcceptedAt: null });
      // A new press goes to the new address, and its link works.
      await requestVolunteerGuardian(db, admin, { eventId: event.id, id }, LATER);
      const fresh = (await outboxOf("VOLUNTEER_GUARDIAN_REQUEST")).find((candidate) => candidate.recipientEmail === "maria.noua@example.test")!;
      const message = await render(fresh, LATER);
      expect((await row(id)).guardianTokenHash).toBe(createHash("sha256").update(guardianSecretIn(message.text), "utf8").digest("hex"));
    });
  });

  describe("«Acordul părintelui lipsește»: the card's state and the refusal to confirm", () => {
    it("refuses «Confirmă» for a minor until the guardian accepts, with the sentence's own code — and never holds an adult up", async () => {
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      await submitVolunteer(db, event.id, form(role.id, { birthDate: aged(30), email: "adult@example.test", guardianName: "", guardianEmail: "", guardianAware: false }), NOW);
      const listed = await listVolunteers(db, event.id);
      const minor = listed.find((person) => person.email === "dan@example.test")!;
      const adult = listed.find((person) => person.email === "adult@example.test")!;
      expect(guardianStandingOf(minor, NOW)).toBe("missing");
      await expect(changeVolunteer(db, admin, { kind: "setState", eventId: event.id, id: minor.id, state: "CONFIRMED" }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_GUARDIAN_MISSING" });
      expect((await row(minor.id)).state).toBe("REGISTERED");
      expect(await changeVolunteer(db, admin, { kind: "setState", eventId: event.id, id: adult.id, state: "CONFIRMED" }, NOW)).toMatchObject({ changed: true });

      const secret = (await mintVolunteerGuardianLink(db, minor.id, "maria@example.test", NOW))!.secret;
      await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, NOW);
      expect(await changeVolunteer(db, admin, { kind: "setState", eventId: event.id, id: minor.id, state: "CONFIRMED" }, LATER)).toMatchObject({ changed: true });
      expect((await row(minor.id)).state).toBe("CONFIRMED");
      // Cancelling a minor with no consent is never refused.
      await submitVolunteer(db, event.id, form(role.id, { email: "other@example.test", guardianEmail: "other.parent@example.test" }), NOW);
      const other = (await listVolunteers(db, event.id)).find((person) => person.email === "other@example.test")!;
      expect(await changeVolunteer(db, admin, { kind: "setState", eventId: event.id, id: other.id, state: "CANCELLED" }, NOW)).toMatchObject({ changed: true });
    });
  });

  describe("the organizers' two verbs", () => {
    it("«Trimite linkul părintelui»: only who may manage volunteers, only while minors are taken, only with an address, never once accepted", async () => {
      const { event, role } = await seedEvent();
      const id = await minorByHand(event.id, role.id);
      await expect(requestVolunteerGuardian(db, technician, { eventId: event.id, id }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      const other = await seedEvent();
      await expect(requestVolunteerGuardian(db, admin, { eventId: other.event.id, id }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await outboxOf("VOLUNTEER_GUARDIAN_REQUEST")).toHaveLength(0);

      await requestVolunteerGuardian(db, admin, { eventId: event.id, id }, NOW);
      const [queued] = await outboxOf("VOLUNTEER_GUARDIAN_REQUEST");
      expect(queued).toMatchObject({ recipientEmail: "maria@example.test", requestedByStaffUserId: admin.id });
      // A press queues a message, never a secret (§14.5).
      expect(queued.payloadJson).toEqual({ eventId: event.id, volunteerId: id });
      expect(await row(id)).toMatchObject({ guardianRequestedAt: NOW, guardianTokenHash: null });
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.guardian_requested"));
      expect(audit).toMatchObject({ actorStaffUserId: admin.id, metadataJson: { volunteerId: id } });

      // No address: the consent is taken on paper.
      const onPaper = await minorByHand(event.id, role.id, { email: "ana@example.test", name: "Ana Tânăra", guardianEmail: "" });
      await expect(requestVolunteerGuardian(db, admin, { eventId: event.id, id: onPaper }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_GUARDIAN_NO_EMAIL" });
      // An adult is not a minor; a cancelled person is not asked.
      const adult = (await changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: { roleIds: [role.id], assignedRoleId: "", name: "Ion", email: "ion@example.test", phone: "+40712345680", note: "", birthDate: aged(40) } }, NOW)).volunteer.id;
      await expect(requestVolunteerGuardian(db, admin, { eventId: event.id, id: adult }, NOW)).rejects.toMatchObject({ code: "CONFLICT" });
      // Accepted: nothing left to send.
      const secret = (await mintVolunteerGuardianLink(db, id, "maria@example.test", NOW))!.secret;
      await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, NOW);
      await expect(requestVolunteerGuardian(db, admin, { eventId: event.id, id }, LATER)).rejects.toMatchObject({ code: "VOLUNTEER_GUARDIAN_ACCEPTED" });
      // And while the texts do not describe minors, no press at all.
      await approveNotice(2, false);
      const again = await minorByHandAllowed(event.id, role.id);
      await expect(requestVolunteerGuardian(db, admin, { eventId: event.id, id: again }, LATER)).rejects.toMatchObject({ code: "VOLUNTEER_MINORS_CLOSED" });
    });

    /** A minor already on the list when the texts were withdrawn: inserted straight, as the earlier press left it. */
    async function minorByHandAllowed(eventId: string, roleId: string) {
      const [created] = await db
        .insert(eventVolunteers)
        .values({
          eventId,
          roleId,
          name: "Vlad Tânărul",
          email: "vlad@example.test",
          canonicalEmail: "vlad@example.test",
          canonicalizationVersion: 1,
          phone: "+40712345681",
          locale: "ro",
          state: "REGISTERED",
          source: "STAFF",
          age: 16,
          guardianName: "Elena Popescu",
          guardianEmail: "elena@example.test",
        })
        .returning({ id: eventVolunteers.id });
      return created.id;
    }

    it("«Acordul părintelui pe hârtie»: records the version, the way and who recorded it — refused when the sheet printed is not the one in force", async () => {
      const { event, role } = await seedEvent();
      const id = await minorByHand(event.id, role.id);
      const printed = await printedFor(id);
      await expect(recordPaperVolunteerGuardian(db, technician, { eventId: event.id, id, printed }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
      // A stale sheet: the version or the roles changed since the print.
      await expect(recordPaperVolunteerGuardian(db, admin, { eventId: event.id, id, printed: { ...printed, roles: "role:other" } }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_AGREEMENT_REPRINT" });
      expect((await row(id)).guardianAcceptedAt).toBeNull();

      await recordPaperVolunteerGuardian(db, admin, { eventId: event.id, id, printed }, NOW);
      const accepted = await row(id);
      expect(accepted).toMatchObject({
        guardianAcceptedAt: NOW,
        guardianMethod: "PAPER",
        guardianLocale: "ro",
        guardianTypedName: null,
        guardianRecordedByStaffUserId: admin.id,
        guardianTokenHash: null,
      });
      expect(accepted.guardianTextHash).toMatch(/^[0-9a-f]{64}$/);
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.guardian_recorded"));
      expect(audit).toMatchObject({ actorStaffUserId: admin.id, metadataJson: { volunteerId: id, method: "PAPER" } });
      expect(JSON.stringify(audit.metadataJson)).not.toMatch(/Popescu|maria@/);
      // Twice: nothing left to record.
      await expect(recordPaperVolunteerGuardian(db, admin, { eventId: event.id, id, printed }, LATER)).rejects.toMatchObject({ code: "VOLUNTEER_GUARDIAN_ACCEPTED" });
      // The tick unlocks the confirm.
      expect(await changeVolunteer(db, admin, { kind: "setState", eventId: event.id, id, state: "CONFIRMED" }, LATER)).toMatchObject({ changed: true });
    });

    it("refuses a paper record for an adult and while the texts do not describe minors", async () => {
      const { event, role } = await seedEvent();
      const adult = (await changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: { roleIds: [role.id], assignedRoleId: "", name: "Ion", email: "ion@example.test", phone: "+40712345680", note: "", birthDate: aged(40) } }, NOW)).volunteer.id;
      await expect(recordPaperVolunteerGuardian(db, admin, { eventId: event.id, id: adult, printed: await printedFor(adult) }, NOW)).rejects.toMatchObject({ code: "CONFLICT" });
      const id = await minorByHand(event.id, role.id);
      const printed = await printedFor(id);
      await approveNotice(2, false);
      await expect(recordPaperVolunteerGuardian(db, admin, { eventId: event.id, id, printed }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_MINORS_CLOSED" });
    });
  });

  describe("the organizers' entry and edit", () => {
    it("takes a minor with the parent's name — the address optional, the consent on paper — and refuses thirteen", async () => {
      const { event, role } = await seedEvent();
      await expect(
        changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: { roleIds: [role.id], assignedRoleId: "", name: "Dan", email: "dan@example.test", phone: "+40712345679", note: "", birthDate: aged(13), guardianName: "Maria Popescu" } }, NOW),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["birthDate"] });
      await expect(
        changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: { roleIds: [role.id], assignedRoleId: "", name: "Dan", email: "dan@example.test", phone: "+40712345679", note: "", birthDate: aged(15) } }, NOW),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["guardianName"] });
      const id = await minorByHand(event.id, role.id, { guardianEmail: "" });
      expect(await row(id)).toMatchObject({ age: 15, guardianName: "Maria Popescu", guardianEmail: null, guardianAcceptedAt: null });
    });

    it("clears the guardian's data when the age becomes eighteen or none — nobody keeps a third person's data for an adult", async () => {
      const { event, role } = await seedEvent();
      const id = await minorByHand(event.id, role.id);
      const secret = (await mintVolunteerGuardianLink(db, id, "maria@example.test", NOW))!.secret;
      await changeVolunteer(
        db,
        admin,
        { kind: "edit", eventId: event.id, id, fields: { roleIds: [role.id], assignedRoleId: role.id, name: "Dan Tânărul", email: "dan@example.test", phone: "+40712345679", note: "", birthDate: aged(19) } },
        NOW,
      );
      expect(await row(id)).toMatchObject({ age: 19, guardianName: null, guardianEmail: null, guardianTokenHash: null, guardianRequestedAt: null });
      // The link a parent holds finds a volunteer who is no longer a minor: nothing.
      expect(await readVolunteerGuardianLink(db, secret, "ro", NOW)).toEqual({ status: "invalid" });
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.edited"));
      expect((audit.metadataJson as { fields: string[] }).fields).toEqual(expect.arrayContaining(["birthDate", "guardianCleared"]));
    });

    it("refuses to turn a confirmed adult into a minor with no consent — «Confirmat» is not kept without the parent's agreement", async () => {
      const { event, role } = await seedEvent();
      const id = await minorByHand(event.id, role.id, { birthDate: aged(20), guardianName: "", guardianEmail: "" });
      await changeVolunteer(db, admin, { kind: "setState", eventId: event.id, id, state: "CONFIRMED" }, NOW);
      const base = { roleIds: [role.id], assignedRoleId: role.id, name: "Dan Tânărul", email: "dan@example.test", phone: "+40712345679", note: "", birthDate: aged(16), guardianName: "Maria Popescu", guardianEmail: "maria@example.test" };
      await expect(changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id, fields: base }, NOW)).rejects.toMatchObject({ code: "VOLUNTEER_GUARDIAN_MISSING", fields: ["birthDate"] });
      expect(await row(id)).toMatchObject({ age: 20, state: "CONFIRMED", guardianName: null });
      // Moved back to «Înscris» first, the same edit is taken: the consent is then asked as for any minor.
      await changeVolunteer(db, admin, { kind: "setState", eventId: event.id, id, state: "REGISTERED" }, NOW);
      expect(await changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id, fields: base }, NOW)).toMatchObject({ changed: true });
      expect(await row(id)).toMatchObject({ age: 16, state: "REGISTERED", guardianName: "Maria Popescu", guardianAcceptedAt: null });
    });

    it("keeps an accepted guardian's name and address fixed under their acceptance, and a changed address kills a live link", async () => {
      const { event, role } = await seedEvent();
      const id = await minorByHand(event.id, role.id);
      const live = (await mintVolunteerGuardianLink(db, id, "maria@example.test", NOW))!.secret;
      const base = { roleIds: [role.id], assignedRoleId: role.id, name: "Dan Tânărul", email: "dan@example.test", phone: "+40712345679", note: "", birthDate: aged(15) };
      await changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id, fields: { ...base, guardianName: "Maria Popescu", guardianEmail: "maria.noua@example.test" } }, NOW);
      expect(await readVolunteerGuardianLink(db, live, "ro", NOW)).toEqual({ status: "invalid" });

      const secret = (await mintVolunteerGuardianLink(db, id, "maria.noua@example.test", NOW))!.secret;
      await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, NOW);
      await expect(
        changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id, fields: { ...base, guardianName: "Altcineva", guardianEmail: "maria.noua@example.test" } }, LATER),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["guardianName", "guardianEmail"] });
      expect(await row(id)).toMatchObject({ guardianName: "Maria Popescu" });
      // The same data saved again changes nothing.
      expect(await changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id, fields: { ...base, guardianName: "Maria Popescu", guardianEmail: "maria.noua@example.test" } }, LATER)).toMatchObject({ changed: false });
    });
  });

  describe("the volunteer's own link for a person entered under eighteen", () => {
    it("asks no age tick of a minor — their parent accepts beside them — and the adult's page is as it was", async () => {
      const { event, role } = await seedEvent();
      const id = await minorByHand(event.id, role.id);
      const secret = (await mintVolunteerAgreementLink(db, id, "dan@example.test", NOW))!.secret;
      const view = await readVolunteerAgreementLink(db, secret, "ro", NOW);
      expect(view).toMatchObject({ status: "open", minor: true });
      if (view.status === "open") expect(view.values).toMatchObject({ volunteerGuardian: "Maria Popescu" });
      // Accepting without the age tick is fine for a minor; the acceptance is never «declared of age».
      expect(await acceptVolunteerAgreementByLink(db, secret, { agreement: true, locale: "ro" }, NOW)).toEqual({ outcome: "accepted", volunteerId: id });
      expect(await row(id)).toMatchObject({ agreementMethod: "LINK", declaredAdult: false });

      const adult = (await changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: { roleIds: [role.id], assignedRoleId: role.id, name: "Ion", email: "ion@example.test", phone: "+40712345680", note: "", birthDate: aged(40) } }, NOW)).volunteer.id;
      const adultSecret = (await mintVolunteerAgreementLink(db, adult, "ion@example.test", NOW))!.secret;
      expect(await readVolunteerAgreementLink(db, adultSecret, "ro", NOW)).toMatchObject({ status: "open", minor: false });
      await expect(acceptVolunteerAgreementByLink(db, adultSecret, { agreement: true, locale: "ro" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["adult"] });
      expect(await acceptVolunteerAgreementByLink(db, adultSecret, { agreement: true, adult: true, locale: "ro" }, NOW)).toEqual({ outcome: "accepted", volunteerId: adult });
      expect((await row(adult)).declaredAdult).toBe(true);
    });
  });

  describe("the PDF: the guardian's line", () => {
    it("prints the sheet to sign with the volunteer's line and the parent's — and never the organizer's — for a person not yet accepted", async () => {
      const { event, role } = await seedEvent();
      const id = await minorByHand(event.id, role.id);
      const rendered = await renderVolunteerAgreementPdf(db, id, NOW);
      expect(rendered?.accepted).toBe(false);
      const text = await words(id);
      expect(text).toContain("Semnătura voluntarului:");
      expect(text).toContain("Semnătura părintelui sau tutorelui:");
      expect(text).not.toContain("Pentru organizator (nume și semnătură):");
      // The minors' clause is in the text, with the parent's name.
      // (The name is a bold run of its own in the drawn text, hence the spaces around it.)
      expect(text).toContain("Voluntarul fiind minor, părintele sau tutorele său,");
      expect(text).toContain("Maria Popescu");
      expect(text).not.toContain("Acceptat electronic");
    });

    it("an adult's PDF is unchanged: the organizer's line, no clause about a minor", async () => {
      const { event, role } = await seedEvent();
      const adult = (await changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: { roleIds: [role.id], assignedRoleId: role.id, name: "Ion", email: "ion@example.test", phone: "+40712345680", note: "", birthDate: aged(40) } }, NOW)).volunteer.id;
      const text = await words(adult);
      expect(text).toContain("Pentru organizator (nume și semnătură):");
      expect(text).not.toContain("Semnătura părintelui sau tutorelui");
      expect(text).not.toContain("Voluntarul fiind minor");
    });

    it("says the parent's consent is still to come under the volunteer's own acceptance, and prints the desk's sheet for it with `sheet`", async () => {
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const [person] = await db.select().from(eventVolunteers);
      const text = await words(person.id);
      expect(text).toContain("Acceptat electronic");
      expect(text).toContain("Acordul părintelui sau tutorelui, Maria Popescu: încă neprimit.");
      // The desk's sheet for the guardian: the text to sign, though the volunteer accepted their own.
      const sheet = await renderVolunteerAgreementPdf(db, person.id, NOW, { sheet: true });
      expect(sheet?.accepted).toBe(false);
      const sheetText = await words(person.id, { sheet: true });
      expect(sheetText).toContain("Semnătura părintelui sau tutorelui:");
      expect(sheetText).not.toContain("încă neprimit");
    });

    it("prints both signers once the parent accepted from the link: their typed name, the way, the guardian's version and fingerprint", async () => {
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const [person] = await db.select().from(eventVolunteers);
      const secret = (await mintVolunteerGuardianLink(db, person.id, "maria@example.test", NOW))!.secret;
      await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, LATER);
      const accepted = await row(person.id);
      const text = await words(person.id, {}, LATER);
      expect(text).toContain("Semnătura voluntarului:");
      expect(text).toContain("Dan Tânărul");
      expect(text).toContain("Semnătura părintelui sau tutorelui:");
      expect(text).toContain("Maria Popescu");
      expect(text).toContain("Acordul părintelui sau tutorelui, Maria Popescu, acceptat electronic");
      expect(text).toContain("din linkul unic trimis pe adresa lui de email");
      // The volunteer's own acceptance is told too, and the proof is the guardian's text.
      expect(text).toContain("pe pagina de voluntari a evenimentului");
      expect(text).toContain(accepted.guardianTextHash!);
      expect(text).not.toContain("încă neprimit");
    });

    it("keeps BOTH fingerprints on the copy when the parent read a newer version than the volunteer — each signer's own text, never the one's under the other's line", async () => {
      const { event, role } = await seedEvent();
      await submitVolunteer(db, event.id, form(role.id), NOW);
      const [person] = await db.select().from(eventVolunteers);
      // The club approves a new version between the sign-up and the parent's press.
      await approveAgreement(2);
      const secret = (await mintVolunteerGuardianLink(db, person.id, "maria@example.test", NOW))!.secret;
      await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, LATER);
      const accepted = await row(person.id);
      expect(accepted.agreementDocumentId).not.toBe(accepted.guardianDocumentId);
      expect(accepted.agreementTextHash).not.toBe(accepted.guardianTextHash);
      const text = await words(person.id, {}, LATER);
      expect(text).toContain(accepted.agreementTextHash!);
      expect(text).toContain(accepted.guardianTextHash!);
      // Each signer on their own line; the volunteer's acceptance is the form's, the parent's the link's.
      expect(text).toContain("Semnătura voluntarului:");
      expect(text).toContain("Semnătura părintelui sau tutorelui:");
      expect(text).toContain("pe pagina de voluntari a evenimentului");
      expect(text).toContain("Acordul părintelui sau tutorelui, Maria Popescu, acceptat electronic");
    });

    it("prints a paper consent with who recorded it", async () => {
      const { event, role } = await seedEvent();
      const id = await minorByHand(event.id, role.id);
      await recordPaperVolunteerGuardian(db, admin, { eventId: event.id, id, printed: await printedFor(id) }, NOW);
      const text = await words(id);
      expect(text).toContain("Acordul părintelui sau tutorelui, Maria Popescu, semnat pe hârtie");
      expect(text).toContain("Ana Admin");
    });
  });

  describe("§NNN the date of birth: the age is counted on the event's day, not today's", () => {
    /** The event's day in its own zone: NOW + 30 days at 10:00 UTC is 12 November 2026 in Brașov. */
    const EVENT_DAY = "2026-11-12";
    /** The day after a date, `YYYY-MM-DD`. */
    const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

    it("takes fourteen today, fourteen tomorrow and fourteen on the event's own morning — and refuses the day after, thirteen on the event's day", async () => {
      const { event, role } = await seedEvent();
      // Born so that fourteen was reached today (13 October), tomorrow, and on the event's day itself: all taken, each with a guardian.
      const born = [bornAgedOn(14, "2026-10-13"), bornAgedOn(14, "2026-10-14"), bornAgedOn(14, EVENT_DAY)];
      for (const [index, birthDate] of born.entries()) {
        expect(await submitVolunteer(db, event.id, form(role.id, { birthDate, email: `dan${index}@example.test`, guardianEmail: `maria${index}@example.test` }), NOW), birthDate).toEqual({ outcome: "done" });
      }
      const kept = await db.select().from(eventVolunteers).orderBy(eventVolunteers.createdAt);
      expect(kept.map((person) => person.age)).toEqual([14, 14, 14]);
      expect(kept.map((person) => person.dateOfBirth).sort()).toEqual([...born].sort());
      // One day later and fourteen comes the day after the event: thirteen on the event's day, refused on the date's own box.
      await expect(submitVolunteer(db, event.id, form(role.id, { birthDate: nextDay(born[2]), email: "late@example.test" }), NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["birthDate"] });
      expect(await db.select().from(eventVolunteers)).toHaveLength(3);
    });

    it("tells seventeen from eighteen on the event's day: a person who is seventeen today and eighteen by the race is an adult, and the other way is not", async () => {
      const { event, role } = await seedEvent();
      // Eighteen tomorrow, seventeen on the event's day: a minor, and the guardian is asked for.
      const stillMinor = nextDay(bornAgedOn(18, EVENT_DAY));
      const noGuardian = submitVolunteer(db, event.id, form(role.id, { birthDate: stillMinor, guardianName: "", guardianEmail: "", guardianAware: false }), NOW);
      await expect(noGuardian).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["guardianName", "guardianEmail", "guardianAware"] });
      expect(await submitVolunteer(db, event.id, form(role.id, { birthDate: stillMinor }), NOW)).toEqual({ outcome: "done" });
      // Eighteen on the event's day — seventeen today (the birthday is within the month): an adult, no guardian, and what was typed in the boxes is dropped.
      const adultByTheRace = bornAgedOn(18, EVENT_DAY);
      expect([ageOn(adultByTheRace, "2026-10-13"), ageOn(adultByTheRace, EVENT_DAY)]).toEqual([17, 18]);
      expect(await submitVolunteer(db, event.id, form(role.id, { birthDate: adultByTheRace, email: "ana@example.test", guardianName: "Maria Popescu", guardianEmail: "m@example.test" }), NOW)).toEqual({ outcome: "done" });
      const rows = await db.select().from(eventVolunteers).orderBy(eventVolunteers.createdAt);
      expect(rows.map((person) => [person.age, person.guardianName])).toEqual([[17, "Maria Popescu"], [18, null]]);
    });

    it("takes the person who is eighteen on the event's day while the club cannot take minors, and refuses the one who is seventeen on it", async () => {
      await approveNotice(2, false);
      const { event, role } = await seedEvent();
      expect(await submitVolunteer(db, event.id, form(role.id, { birthDate: bornAgedOn(18, EVENT_DAY) }), NOW)).toEqual({ outcome: "done" });
      // One day younger: seventeen on the event's day, refused on the date's own box with the minors-closed sentence's box.
      await expect(
        submitVolunteer(db, event.id, form(role.id, { birthDate: nextDay(bornAgedOn(18, EVENT_DAY)), email: "young@example.test" }), NOW),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["birthDate"] });
      // The organizers' entry holds the same line, naming the same box.
      await expect(
        changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: { roleIds: [role.id], assignedRoleId: "", name: "Dan", email: "dan@example.test", phone: "+40712345679", note: "", birthDate: bornAgedOn(17, EVENT_DAY) } }, NOW),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["birthDate"] });
    });

    it("counts a person born on 29 February as a common year does: eighteen on 1 March, seventeen on the 28th", async () => {
      await approveNotice(2, false);
      const { event, role } = await seedEvent();
      const born = "2008-02-29";
      // The event's day is 12 November 2026 here, so the leap-day birthday is the arithmetic's: the rule is `ageOn`, shown on both sides of 1 March.
      expect(ageOn(born, "2026-02-28")).toBe(17);
      expect(ageOn(born, "2026-03-01")).toBe(18);
      expect(ageOn(born, EVENT_DAY)).toBe(18);
      expect(await submitVolunteer(db, event.id, form(role.id, { birthDate: "29.02.2008" }), NOW)).toEqual({ outcome: "done" });
      expect(await db.select({ age: eventVolunteers.age, born: eventVolunteers.dateOfBirth }).from(eventVolunteers)).toEqual([{ age: 18, born }]);
      // 29 February 2009 is no day at all.
      await expect(submitVolunteer(db, event.id, form(role.id, { birthDate: "29.02.2009", email: "other@example.test" }), NOW)).rejects.toMatchObject({ fields: ["birthDate"] });
    });

    it("counts the age on the gun's day when the race has one, in the event's own zone", async () => {
      const { event, role } = await seedEvent();
      // The event begins on the 12th; the gun is on the 13th, 00:30 in Brașov (22:30 UTC on the 12th) — the 13th, not the UTC day.
      await db.update(events).set({ raceStartsAt: new Date("2026-11-12T22:30:00.000Z"), endsAt: new Date("2026-11-13T12:00:00.000Z") }).where(eq(events.id, event.id));
      const bornOnGunDay = bornAgedOn(20, "2026-11-13");
      expect(await submitVolunteer(db, event.id, form(role.id, { birthDate: bornOnGunDay, email: "gun@example.test", guardianName: "", guardianEmail: "", guardianAware: false }), NOW)).toEqual({ outcome: "done" });
      // Twenty on the gun's day, nineteen on the event's first day: the gun's day counts.
      expect((await db.select().from(eventVolunteers))[0]).toMatchObject({ age: 20, dateOfBirth: bornOnGunDay });
      // The same for an entry by hand.
      const hand = await changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: { roleIds: [role.id], assignedRoleId: "", name: "Ion", email: "ion@example.test", phone: "+40712345680", note: "", birthDate: bornOnGunDay } }, NOW);
      expect((await row(hand.volunteer.id)).age).toBe(20);
    });

    it("writes the date and its age by hand too, reads the typed shapes, and audits the box's name only — never the date", async () => {
      const { event, role } = await seedEvent();
      const id = await minorByHand(event.id, role.id, { birthDate: "15.11.2010" });
      expect(await row(id)).toMatchObject({ dateOfBirth: "2010-11-15", age: 15, guardianName: "Maria Popescu" });
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.added"));
      expect(JSON.stringify(audit.metadataJson)).not.toMatch(/2010|birthDate/);
      // A correction of the date: the age follows it, the trail names the box.
      await changeVolunteer(
        db,
        admin,
        { kind: "edit", eventId: event.id, id, fields: { roleIds: [role.id], assignedRoleId: role.id, name: "Dan Tânărul", email: "dan@example.test", phone: "+40712345679", note: "", birthDate: "15.11.2009", guardianName: "Maria Popescu", guardianEmail: "maria@example.test" } },
        LATER,
      );
      expect(await row(id)).toMatchObject({ dateOfBirth: "2009-11-15", age: 16 });
      const edited = (await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.edited")))[0];
      expect((edited.metadataJson as { fields: string[] }).fields).toEqual(["birthDate"]);
      expect(JSON.stringify(edited.metadataJson)).not.toMatch(/2009/);
    });

    it("keeps the age of a row from before the date when its box is left empty — the guardian is not lost over a corrected telephone number — and a date typed replaces it", async () => {
      const { event, role } = await seedEvent();
      // A row as the earlier release wrote it: an age of sixteen, a guardian, no date.
      const [old] = await db
        .insert(eventVolunteers)
        .values({
          eventId: event.id,
          roleId: role.id,
          name: "Dan Tânărul",
          email: "dan@example.test",
          canonicalEmail: "dan@example.test",
          canonicalizationVersion: 1,
          phone: "+40712345679",
          source: "STAFF",
          age: 16,
          guardianName: "Maria Popescu",
          guardianEmail: "maria@example.test",
        })
        .returning();
      await db.insert(eventVolunteerRoleChoices).values({ volunteerId: old.id, roleId: role.id });
      expect(old.dateOfBirth).toBeNull();
      const fields = { roleIds: [role.id], assignedRoleId: role.id, name: "Dan Tânărul", email: "dan@example.test", note: "", birthDate: "", guardianName: "Maria Popescu", guardianEmail: "maria@example.test" };
      await changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id: old.id, fields: { ...fields, phone: "+40712345681" } }, LATER);
      expect(await row(old.id)).toMatchObject({ age: 16, dateOfBirth: null, guardianName: "Maria Popescu", guardianEmail: "maria@example.test", phone: "+40712345681" });
      const [edited] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.edited"));
      expect((edited.metadataJson as { fields: string[] }).fields).toEqual(["phone"]);
      // A date typed replaces the age: forty, so the guardian goes with it.
      await changeVolunteer(db, admin, { kind: "edit", eventId: event.id, id: old.id, fields: { ...fields, phone: "+40712345681", birthDate: bornAgedOn(40, EVENT_DAY) } }, LATER);
      expect(await row(old.id)).toMatchObject({ age: 40, dateOfBirth: bornAgedOn(40, EVENT_DAY), guardianName: null, guardianEmail: null });
    });

    it("counts the age again on the next save when the event moved: the date is the person's, the age is the day's", async () => {
      const { event, role } = await seedEvent();
      const birthDate = nextDay(bornAgedOn(18, EVENT_DAY));
      const id = await minorByHand(event.id, role.id, { birthDate });
      expect((await row(id)).age).toBe(17);
      // The race moves a month: eighteen by then.
      await db.update(events).set({ startsAt: new Date(NOW.getTime() + 70 * DAY) }).where(eq(events.id, event.id));
      await changeVolunteer(
        db,
        admin,
        { kind: "edit", eventId: event.id, id, fields: { roleIds: [role.id], assignedRoleId: role.id, name: "Dan Tânărul", email: "dan@example.test", phone: "+40712345679", note: "nou", birthDate, guardianName: "Maria Popescu", guardianEmail: "maria@example.test" } },
        LATER,
      );
      expect(await row(id)).toMatchObject({ age: 18, dateOfBirth: birthDate, guardianName: null });
      const edited = (await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.edited")))[0];
      expect((edited.metadataJson as { fields: string[] }).fields).toEqual(expect.arrayContaining(["age", "note", "guardianCleared"]));
    });

    it("refuses a date the notice in force does not name while the profile boxes are not asked — a hand entry carrying one is refused on the box", async () => {
      await resetTables(db);
      await approveNoticeWithoutProfile();
      [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Ana Admin", role: "ADMIN" }).returning();
      const { event, role } = await seedEvent();
      await expect(
        changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: { roleIds: [role.id], assignedRoleId: "", name: "Ion", email: "ion@example.test", phone: "+40712345680", note: "", birthDate: bornAgedOn(40, EVENT_DAY) } }, NOW),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["birthDate"] });
    });
  });
});
