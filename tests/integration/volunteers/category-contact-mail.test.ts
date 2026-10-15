import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerCategories, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { readAgreementFacts } from "@/modules/volunteers/agreement";
import { renderVolunteerAgreementPdf } from "@/modules/volunteers/agreement-pdf";
import { changeVolunteer, submitVolunteer } from "@/modules/volunteers/volunteers";
import { roleDescription } from "../../helpers/role-description";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { drawnRuns } from "../../helpers/pdf-drawn";
import { bornAged } from "../../helpers/volunteer-birth";

/**
 * §774 — the contact person of a category, in the volunteers' emails, and the role named alone with its category in brackets in the
 * agreement (the owner, 2026-10-14: «trebuie să fie o persoană de contact pentru voluntari»; «the contact person for each category will
 * be established later»): «received», «role assigned» and the guardian's request carry the contact of the category of the role(s)
 * concerned in their footer — when set — and no other message does; the agreement's sentences, its PDF and the card's comparison say
 * «Direcționare (Traseu)».
 */
const NOW = new Date("2026-10-13T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();
const aged = (years: number) => bornAged(years, new Date(NOW.getTime() + 30 * DAY));

describe("§774 a category's contact person in the volunteers' emails", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  async function approveTexts() {
    const marker = "{{volunteers}}, {{volunteerAgreement}}, {{volunteerProfile}}, {{volunteerMinors}}";
    const body = (text: string) => ({ sections: [{ paragraphs: [`Voluntari (${marker}): ${text}`] }] });
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

  const contactOf = { name: "Ana Popescu", phone: "+40712345678", email: "coordonator@club.test" };

  /** A published race with two categories — «Start / Sosire» with no contact set, «Traseu» with Ana's — and «Direcționare» under each. */
  async function seedEvent(options: { startContact?: boolean } = {}) {
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date(NOW.getTime() + 30 * DAY), editorialStatus: "PUBLISHED", publishedAt: new Date(NOW.getTime() - DAY), acceptsVolunteers: true })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul", locationName: "Parcul central" },
      { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title: "The cross", locationName: "Central park" },
    ]);
    const [start, route] = await db
      .insert(eventVolunteerCategories)
      .values([
        {
          eventId: event.id,
          nameRo: "Start / Sosire",
          nameEn: "Start / Finish",
          sort: 0,
          ...(options.startContact ? { contactName: "Dan Ionescu", contactPhone: "+40722000111", contactEmail: null } : {}),
        },
        { eventId: event.id, nameRo: "Traseu", nameEn: "Route", sort: 1, contactName: contactOf.name, contactPhone: contactOf.phone, contactEmail: contactOf.email },
      ])
      .returning();
    const roles = await db
      .insert(eventVolunteerRoles)
      .values([
        { eventId: event.id, categoryId: start.id, nameRo: "Direcționare", nameEn: "Guidance", needed: 5, position: 0, ...roleDescription("Arăți drumul la start", "Show the way at the start") },
        { eventId: event.id, categoryId: route.id, nameRo: "Direcționare", nameEn: "Guidance", needed: 5, position: 1, ...roleDescription("Arăți drumul pe traseu", "Show the way on the route") },
        { eventId: event.id, categoryId: null, nameRo: "Foto/Video", nameEn: "Photo/Video", needed: 5, position: 2 },
      ])
      .returning();
    return { event, start, route, atStart: roles[0], onRoute: roles[1], loose: roles[2] };
  }

  const form = (roleIds: string[], extra: Record<string, unknown> = {}) => ({
    roleIds,
    name: "Ion Voluntar",
    email: "ion@example.test",
    phone: "+40712345679",
    message: "",
    locale: "ro",
    consent: true,
    agreement: true,
    birthDate: aged(30),
    sex: "MALE",
    city: "Brașov",
    renderedAt: RENDERED,
    ...extra,
  });

  const outboxOf = (type: "VOLUNTEER_RECEIVED" | "VOLUNTEER_ROLE_ASSIGNED" | "VOLUNTEER_GUARDIAN_REQUEST" | "VOLUNTEER_AGREEMENT_REQUEST" | "VOLUNTEER_CLUB_NOTICE") =>
    db.select().from(emailOutbox).where(eq(emailOutbox.messageType, type));
  const render = (outboxRow: unknown) => renderOutboxMessage({ ...(outboxRow as OutboxRow), status: "PROCESSING", lockedAt: NOW }, db, NOW);

  const CONTACT_RO = "Întrebări despre voluntariat? Ana Popescu · +40 712 345 678 · coordonator@club.test";
  const CONTACT_EN = "Questions about volunteering? Ana Popescu · +40 712 345 678 · coordonator@club.test";

  beforeEach(async () => {
    await resetTables(db);
    await approveTexts();
    [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Ana Admin", role: "ADMIN" }).returning();
  });

  describe("«am primit»: the contact of the category of the roles offered for", () => {
    it("says it in the footer of both halves — and the role in brackets in the facts line — when the one role ticked sits under a category with a contact", async () => {
      const { event, onRoute } = await seedEvent();
      await submitVolunteer(db, event.id, form([onRoute.id]), NOW);
      const [message] = await outboxOf("VOLUNTEER_RECEIVED");
      const rendered = await render(message);
      expect(rendered.text).toContain(CONTACT_RO);
      expect(rendered.text).toContain(CONTACT_EN);
      expect(rendered.text).toContain("Te-ai oferit pentru: Direcționare (Traseu)");
      expect(rendered.text).toContain("You offered for: Guidance (Route)");
      // Not a link, not a button: the words, so a mail client may make of them what it does.
      expect(rendered.text).not.toMatch(/tel:|mailto:/);
      // The html carries the same words, escaped.
      expect(rendered.html).toContain("Întrebări despre voluntariat? Ana Popescu");
    });

    it("says each person once when the roles ticked sit under several categories, and none for a role under no category or a category with no contact", async () => {
      const { event, atStart, onRoute, loose } = await seedEvent({ startContact: true });
      await submitVolunteer(db, event.id, form([atStart.id, onRoute.id, loose.id]), NOW);
      const rendered = await render((await outboxOf("VOLUNTEER_RECEIVED"))[0]);
      expect(rendered.text).toContain("Questions about volunteering? Start / Finish: Dan Ionescu · +40 722 000 111; Route: Ana Popescu · +40 712 345 678 · coordonator@club.test");
      expect(rendered.text).toContain("Te-ai oferit pentru: Direcționare (Start / Sosire), Direcționare (Traseu), Foto/Video");

      await resetTables(db);
      await approveTexts();
      const second = await seedEvent();
      await submitVolunteer(db, second.event.id, form([second.atStart.id, second.loose.id], { email: "dana@example.test" }), NOW);
      const quiet = await render((await outboxOf("VOLUNTEER_RECEIVED"))[0]);
      expect(quiet.text).not.toMatch(/Questions about volunteering|Întrebări despre voluntariat/);
      expect(quiet.text).toContain("Te-ai oferit pentru: Direcționare (Start / Sosire), Foto/Video");
    });

    it("is not the club's notice's: the colleagues' message about the offer carries no contact", async () => {
      const { event, onRoute } = await seedEvent();
      await submitVolunteer(db, event.id, form([onRoute.id]), NOW);
      const notices = await outboxOf("VOLUNTEER_CLUB_NOTICE");
      expect(notices.length).toBeGreaterThan(0);
      for (const notice of notices) {
        const text = (await render(notice)).text;
        expect(text).not.toMatch(/Questions about volunteering|Întrebări despre voluntariat|coordonator@club\.test/);
        // The organizers' own line names the role as the others do.
        expect(text).toContain("Direcționare (Traseu)");
      }
    });
  });

  describe("«Dă-i rolul …»: the contact of the category of the role given", () => {
    it("names the role given with its category and the contact of that category — not the contact of another role the person ticked", async () => {
      const { event, start, atStart, onRoute } = await seedEvent({ startContact: true });
      expect(start.id).toBeTruthy();
      const added = await changeVolunteer(
        db,
        admin,
        { kind: "add", eventId: event.id, fields: { roleIds: [atStart.id, onRoute.id], assignedRoleId: onRoute.id, name: "Maria Test", email: "maria@example.test", phone: "+40712345680", note: "" } },
        NOW,
      );
      const [message] = await outboxOf("VOLUNTEER_ROLE_ASSIGNED");
      const rendered = await render(message);
      expect(rendered.text).toContain("Rol: Direcționare (Traseu)");
      expect(rendered.text).toContain("Role: Guidance (Route)");
      expect(rendered.text).toContain("Organizatorii ți-au dat un rol la Crosul: Direcționare (Traseu).");
      expect(rendered.text).toContain(CONTACT_RO);
      expect(rendered.text).not.toContain("Dan Ionescu");
      // Given the start's role instead, it is that category's contact.
      await changeVolunteer(db, admin, { kind: "assign", eventId: event.id, id: added.volunteer.id, roleId: atStart.id }, NOW);
      const second = (await outboxOf("VOLUNTEER_ROLE_ASSIGNED")).find((row) => (row.payloadJson as { roleId: string }).roleId === atStart.id)!;
      const again = await render(second);
      expect(again.text).toContain("Questions about volunteering? Dan Ionescu · +40 722 000 111");
      expect(again.text).not.toContain("Ana Popescu");
    });

    it("says no contact for a role under no category", async () => {
      const { event, loose } = await seedEvent();
      await changeVolunteer(
        db,
        admin,
        { kind: "add", eventId: event.id, fields: { roleIds: [loose.id], assignedRoleId: loose.id, name: "Maria Test", email: "maria@example.test", phone: "+40712345680", note: "" } },
        NOW,
      );
      const rendered = await render((await outboxOf("VOLUNTEER_ROLE_ASSIGNED"))[0]);
      expect(rendered.text).toContain("Rol: Foto/Video");
      expect(rendered.text).not.toMatch(/Questions about volunteering|Întrebări despre voluntariat/);
    });
  });

  describe("the guardian's request", () => {
    it("carries the contact of the category of the roles the minor offered for, beside the link — the parent may ask the one the club named", async () => {
      const { event, onRoute } = await seedEvent();
      await submitVolunteer(db, event.id, form([onRoute.id], { name: "Dan Tânărul", email: "dan@example.test", birthDate: aged(15), guardianName: "Maria Popescu", guardianEmail: "maria@example.test", guardianAware: true }), NOW);
      const [request] = await outboxOf("VOLUNTEER_GUARDIAN_REQUEST");
      const rendered = await render(request);
      expect(rendered.text).toContain(CONTACT_RO);
      expect(rendered.text).toContain(CONTACT_EN);
      expect(rendered.text).toContain("/voluntari/parinte/");
    });
  });

  describe("the messages that carry none", () => {
    it("leaves the agreement's link message without the contact: it is about a document, not about the work", async () => {
      const { event, onRoute } = await seedEvent();
      await changeVolunteer(
        db,
        admin,
        { kind: "add", eventId: event.id, fields: { roleIds: [onRoute.id], assignedRoleId: onRoute.id, name: "Maria Test", email: "maria@example.test", phone: "+40712345680", note: "" } },
        NOW,
      );
      const { requestVolunteerAgreement } = await import("@/modules/volunteers/agreement");
      const [person] = await db.select().from(eventVolunteers);
      await requestVolunteerAgreement(db, admin, { eventId: event.id, id: person.id }, NOW);
      const rendered = await render((await outboxOf("VOLUNTEER_AGREEMENT_REQUEST"))[0]);
      expect(rendered.text).toContain("Direcționare (Traseu)");
      expect(rendered.text).not.toMatch(/Questions about volunteering|Întrebări despre voluntariat/);
    });
  });

  describe("the agreement names the role with its category in brackets", () => {
    it("fills the sentence of the roles chosen with «Direcționare (Traseu), Foto/Video» and freezes it in the acceptance's facts, in the language of the page", async () => {
      const { event, onRoute, loose } = await seedEvent();
      await submitVolunteer(db, event.id, form([onRoute.id, loose.id]), NOW);
      const [person] = await db.select().from(eventVolunteers);
      const facts = readAgreementFacts(person.agreementFacts)!;
      expect(facts.volunteerRoleChoices).toBe("Direcționare (Traseu), Foto/Video");
      expect(facts.volunteerChoiceTasks).toContain("Direcționare (Traseu) — Arăți drumul pe traseu");
      expect(facts.volunteerRole).toBe("");
      // The card's «the accepted text named other roles» compares the same words (`agreementStillNamesRole`).
      const english = await submitVolunteer(db, event.id, form([onRoute.id], { locale: "en", email: "english@example.test" }), NOW);
      expect(english.outcome).toBe("done");
      const [second] = await db.select().from(eventVolunteers).where(eq(eventVolunteers.email, "english@example.test"));
      expect(readAgreementFacts(second.agreementFacts)!.volunteerRoleChoices).toBe("Guidance (Route)");
    });

    it("prints it on the agreement's PDF, and the role given in its own blank", async () => {
      const { event, atStart } = await seedEvent();
      await changeVolunteer(
        db,
        admin,
        { kind: "add", eventId: event.id, fields: { roleIds: [atStart.id], assignedRoleId: atStart.id, name: "Maria Test", email: "maria@example.test", phone: "+40712345680", note: "" } },
        NOW,
      );
      const [person] = await db.select().from(eventVolunteers);
      const words = (await drawnRuns(() => renderVolunteerAgreementPdf(db, person.id, NOW, { sheet: true }))).map((run) => run.text).join(" ");
      expect(words).toContain("Direcționare (Start / Sosire)");
      expect(words).not.toContain("Direcționare (Traseu)");
    });
  });
});
