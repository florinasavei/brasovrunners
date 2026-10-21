import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { exportPersonData, viewPersonData } from "@/modules/registrations/person-data";
import { acceptVolunteerAgreementByLink, mintVolunteerAgreementLink, recordPaperVolunteerAgreement } from "@/modules/volunteers/agreement";
import { renderVolunteerAgreementPdf } from "@/modules/volunteers/agreement-pdf";
import { agreementRolesStamp } from "@/modules/volunteers/domain/volunteer";
import { acceptVolunteerGuardianByLink, mintVolunteerGuardianLink, recordPaperVolunteerGuardian } from "@/modules/volunteers/guardian";
import { changeVolunteer, submitVolunteer } from "@/modules/volunteers/volunteers";
import { roleDescription } from "../../helpers/role-description";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { drawnRuns } from "../../helpers/pdf-drawn";

import { bornAged } from "../../helpers/volunteer-birth";

const NOW = new Date("2026-10-13T10:00:00.000Z");
const LATER = new Date("2026-10-14T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
/** A date of birth that makes a person `years` old on the event's day (§773): the last day of being so. */
const aged = (years: number) => bornAged(years, new Date(NOW.getTime() + 30 * DAY));
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();
const VOLUNTEER_TRACE = { ip: "203.0.113.20", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1" };
const GUARDIAN_TRACE = { ip: "2001:db8::7", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/127.0" };

/**
 * BR-REQ-053-01 (§771, amending §758 and §768; the owner, 2026-10-14): the trace of the electronic signature on
 * the volunteer agreement — the caller's IP address and browser, kept on the volunteer's row for an acceptance on the
 * form or from the emailed link, and for the guardian's own on theirs; never for «Semnat pe hârtie», which a member
 * of staff records from a sheet signed by hand. Printed under each signature of the PDF, listed in «Toate datele unei
 * persoane», deleted with the row.
 */
describe("§771 the trace of the electronic signature on the volunteer agreement", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  async function approveNotice() {
    const body = (text: string) => ({ sections: [{ paragraphs: [`Voluntari ({{volunteers}}, {{volunteerAgreement}}, {{volunteerProfile}}, {{volunteerMinors}}): ${text}`] }] });
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: body("păstrăm numele") },
      { locale: "en", title: "Privacy", body: body("we keep the name") },
    ];
    await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
  }

  async function approveAgreement() {
    const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale] }));
    await insertLegalDocumentVersion(db, { key: "VOLUNTEER_AGREEMENT", version: 1, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
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

  /** What the volunteers' page posts: the profile's boxes, and — for a person under eighteen — the parent's. */
  const form = (roleId: string, extra: Record<string, unknown> = {}) => ({
    roleIds: [roleId],
    name: "Maria Test",
    email: "maria@example.test",
    phone: "+40712345678",
    message: "",
    locale: "ro",
    consent: true,
    agreement: true,
    birthDate: aged(30),
    sex: "FEMALE",
    city: "Brașov",
    renderedAt: RENDERED,
    ...extra,
  });
  const minorForm = (roleId: string) =>
    form(roleId, { name: "Dan Tânărul", email: "dan@example.test", birthDate: aged(15), sex: "MALE", guardianName: "Maria Popescu", guardianEmail: "maria.p@example.test", guardianAware: true });

  const row = async (id: string) => (await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0];
  const only = async () => (await db.select().from(eventVolunteers))[0];
  const choicesOf = async (id: string) =>
    (await db.select({ roleId: eventVolunteerRoleChoices.roleId }).from(eventVolunteerRoleChoices).where(eq(eventVolunteerRoleChoices.volunteerId, id))).map((choice) => choice.roleId);
  async function printedFor(id: string) {
    const person = await row(id);
    const version = await findCurrentApprovedDocument(db, "VOLUNTEER_AGREEMENT", person.locale, NOW);
    return { documentId: version!.id, roles: agreementRolesStamp(await givenOf(id), await choicesOf(id)) };
  }
  const givenOf = async (id: string) =>
    (await db.select({ roleId: eventVolunteerRoleAssignments.roleId }).from(eventVolunteerRoleAssignments).where(eq(eventVolunteerRoleAssignments.volunteerId, id))).map((given) => given.roleId);
  const handEntered = async (eventId: string, roleId: string, extra: Record<string, unknown> = {}) =>
    (
      await changeVolunteer(
        db,
        admin,
        { kind: "add", eventId, fields: { roleIds: [roleId], assignedRoleIds: [roleId], name: "Ion Popescu", email: "ion@example.test", phone: "+40712345679", note: "", birthDate: aged(40), ...extra } },
        NOW,
      )
    ).volunteer.id;

  beforeEach(async () => {
    await resetTables(db);
    await approveNotice();
    await approveAgreement();
    [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Ana Admin", role: "ADMIN" }).returning();
  });

  it("writes the address and the browser of the press when the form's tick accepts the agreement (FORM), and null when none came", async () => {
    const { event, role } = await seedEvent();
    expect(await submitVolunteer(db, event.id, form(role.id), NOW, VOLUNTEER_TRACE)).toEqual({ outcome: "done" });
    expect(await only()).toMatchObject({
      agreementMethod: "FORM",
      agreementIp: VOLUNTEER_TRACE.ip,
      agreementUserAgent: VOLUNTEER_TRACE.userAgent,
      guardianIp: null,
      guardianUserAgent: null,
    });

    await db.delete(eventVolunteers);
    await submitVolunteer(db, event.id, form(role.id), NOW);
    expect(await only()).toMatchObject({ agreementMethod: "FORM", agreementIp: null, agreementUserAgent: null });
  });

  it("writes it when the volunteer accepts from the emailed link (LINK), and never when staff record the paper (PAPER)", async () => {
    const { event, role } = await seedEvent();
    const byLink = await handEntered(event.id, role.id);
    const link = await mintVolunteerAgreementLink(db, byLink, "ion@example.test", NOW);
    expect(await acceptVolunteerAgreementByLink(db, link!.secret, { agreement: true, adult: true, locale: "ro" }, LATER, VOLUNTEER_TRACE)).toMatchObject({ outcome: "accepted" });
    expect(await row(byLink)).toMatchObject({ agreementMethod: "LINK", agreementIp: VOLUNTEER_TRACE.ip, agreementUserAgent: VOLUNTEER_TRACE.userAgent });

    const onPaper = await handEntered(event.id, role.id, { name: "Vlad Popescu", email: "vlad@example.test" });
    await recordPaperVolunteerAgreement(db, admin, { eventId: event.id, id: onPaper, printed: await printedFor(onPaper) }, NOW);
    expect(await row(onPaper)).toMatchObject({ agreementMethod: "PAPER", agreementIp: null, agreementUserAgent: null });
  });

  it("writes the guardian's own trace on their link (LINK) and none on paper, and keeps the two signers' apart", async () => {
    const { event, role } = await seedEvent();
    await submitVolunteer(db, event.id, minorForm(role.id), NOW, VOLUNTEER_TRACE);
    const minor = await only();
    const secret = (await mintVolunteerGuardianLink(db, minor.id, "maria.p@example.test", NOW))!.secret;
    expect(await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, LATER, GUARDIAN_TRACE)).toMatchObject({ outcome: "accepted" });
    expect(await row(minor.id)).toMatchObject({
      agreementIp: VOLUNTEER_TRACE.ip,
      agreementUserAgent: VOLUNTEER_TRACE.userAgent,
      guardianMethod: "LINK",
      guardianIp: GUARDIAN_TRACE.ip,
      guardianUserAgent: GUARDIAN_TRACE.userAgent,
    });

    // Another person under eighteen, whose guardian signs the sheet at the desk.
    const other = await handEntered(event.id, role.id, { name: "Dana Tânăra", email: "dana@example.test", birthDate: aged(16), guardianName: "Elena Popescu", guardianEmail: "elena@example.test" });
    await recordPaperVolunteerGuardian(db, admin, { eventId: event.id, id: other, printed: await printedFor(other) }, NOW);
    expect(await row(other)).toMatchObject({ guardianMethod: "PAPER", guardianIp: null, guardianUserAgent: null });
  });

  it("prints «Semnat electronic la … · IP … · …» under each electronic signature, and today's block for a paper one", async () => {
    const { event, role } = await seedEvent();
    await submitVolunteer(db, event.id, minorForm(role.id), NOW, VOLUNTEER_TRACE);
    const minor = await only();
    const secret = (await mintVolunteerGuardianLink(db, minor.id, "maria.p@example.test", NOW))!.secret;
    await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, LATER, GUARDIAN_TRACE);

    const runs = await drawnRuns(() => renderVolunteerAgreementPdf(db, minor.id, LATER));
    const lines = runs.filter((run) => run.text.startsWith("Semnat electronic la ")).map((run) => run.text);
    expect(lines).toEqual([
      `Semnat electronic la 13.10.2026, 13:00:00 (ora României) · IP ${VOLUNTEER_TRACE.ip} · ${VOLUNTEER_TRACE.userAgent}`,
      `Semnat electronic la 14.10.2026, 13:00:00 (ora României) · IP ${GUARDIAN_TRACE.ip} · ${GUARDIAN_TRACE.userAgent}`,
    ]);

    // A volunteer whose agreement was recorded on paper: the paper block, no trace line.
    const onPaper = await handEntered(event.id, role.id, { name: "Vlad Popescu", email: "vlad@example.test" });
    await recordPaperVolunteerAgreement(db, admin, { eventId: event.id, id: onPaper, printed: await printedFor(onPaper) }, NOW);
    const paperRuns = await drawnRuns(() => renderVolunteerAgreementPdf(db, onPaper, LATER));
    expect(paperRuns.some((run) => run.text.startsWith("Semnat electronic la "))).toBe(false);
    expect(paperRuns.some((run) => run.text.includes("pe hârtie"))).toBe(true);
  });

  it("lists every trace in «Toate datele unei persoane», for the volunteer by their own address", async () => {
    const { event, role } = await seedEvent();
    await submitVolunteer(db, event.id, minorForm(role.id), NOW, VOLUNTEER_TRACE);
    const minor = await only();
    const secret = (await mintVolunteerGuardianLink(db, minor.id, "maria.p@example.test", NOW))!.secret;
    await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, LATER, GUARDIAN_TRACE);
    for (const read of [viewPersonData, exportPersonData]) {
      const data = await read(db, admin, "dan@example.test", LATER);
      expect(data.volunteerOffers).toHaveLength(1);
      expect(data.volunteerOffers[0]).toMatchObject({
        agreementIp: VOLUNTEER_TRACE.ip,
        agreementUserAgent: VOLUNTEER_TRACE.userAgent,
        guardianIp: GUARDIAN_TRACE.ip,
        guardianUserAgent: GUARDIAN_TRACE.userAgent,
      });
    }
  });

  it("clears the guardian's trace with the rest of their columns when the age is corrected to eighteen or more", async () => {
    const { event, role } = await seedEvent();
    await submitVolunteer(db, event.id, minorForm(role.id), NOW, VOLUNTEER_TRACE);
    const minor = await only();
    const secret = (await mintVolunteerGuardianLink(db, minor.id, "maria.p@example.test", NOW))!.secret;
    await acceptVolunteerGuardianByLink(db, secret, { agreement: true, typedName: "Maria Popescu", locale: "ro" }, LATER, GUARDIAN_TRACE);
    expect(await row(minor.id)).toMatchObject({ guardianIp: GUARDIAN_TRACE.ip, guardianUserAgent: GUARDIAN_TRACE.userAgent });

    await changeVolunteer(
      db,
      admin,
      { kind: "edit", eventId: event.id, id: minor.id, fields: { roleIds: [role.id], assignedRoleIds: [role.id], name: "Dan Tânărul", email: "dan@example.test", phone: "+40712345678", note: "", birthDate: aged(19) } },
      LATER,
    );
    expect(await row(minor.id)).toMatchObject({
      guardianName: null,
      guardianAcceptedAt: null,
      guardianTypedName: null,
      guardianIp: null,
      guardianUserAgent: null,
      agreementIp: VOLUNTEER_TRACE.ip,
    });
  });

  it("deletes the trace with the row — the columns are the row's", async () => {
    const { event, role } = await seedEvent();
    await submitVolunteer(db, event.id, form(role.id), NOW, VOLUNTEER_TRACE);
    const person = await only();
    await changeVolunteer(db, admin, { kind: "delete", eventId: event.id, id: person.id }, NOW);
    expect(await db.select().from(eventVolunteers)).toHaveLength(0);
  });
});
