import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox, type EmailMessageType } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { platformSettings } from "@/db/schema/platform-settings";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, repeatEvent, saveEventAndTranslations, saveEventFields } from "@/modules/content/events/service";
import { signGroupRunDeclaration } from "@/modules/group-run-declarations/service";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import {
  CALENDAR_RSVP_SETTING_ENTITY_ID,
  CALENDAR_RSVP_SETTING_KEY,
  calendarRsvpToForSending,
  readCalendarRsvpTo,
  updateCalendarRsvpTo,
} from "@/modules/notifications/calendar-rsvp";
import { updateClubNotices } from "@/modules/notifications/club-notices";
import { clubCopyPayload } from "@/modules/notifications/domain/club-notices";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-080-01 criterion 11, BR-REQ-020-01 criterion 7 (`DECISIONS.md` §672, amending §174) — the
 * five messages that carry the event into a calendar, with «Răspunsurile din calendar merg la» set
 * and unset: unset, exactly today's attachment on the confirmation and the reminder and nothing on
 * the rest; set, an invitation the calendar answers on all five, its update on «Detalii actualizate»
 * about the time or the place and its cancellation on the cancellation — to a person who holds a
 * place. A club copy and the archive copy carry nothing. The setting is the Administrator's, checked
 * and audited, and the invitation's `SEQUENCE` moves with the event's time, place and status.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");
const RSVP = "club+calendar@example.org";

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
});

async function publishedRace(overrides: Partial<typeof events.$inferInsert> = {}) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-10-11T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity: 10,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      // Nothing asks Open-Meteo from a test.
      weatherMode: "off",
      ...overrides,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul aniversar", slug: "crosul-aniversar" },
    { eventId: event.id, locale: "en", title: "The anniversary cross", slug: "anniversary-cross" },
  ]);
  return event;
}

async function registered(eventId: string, status: RegistrationStatus = "CONFIRMED", email = "ana@example.org") {
  const identity = canonicalizeEmail(email);
  const [participant] = await db
    .insert(participants)
    .values({ ...identity, defaultName: "Ana Popescu" })
    .returning();
  const [registration] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      status,
      locale: "ro",
      registeredName: "Ana Popescu",
      displayName: "Ana P.",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      listOptOut: false,
      resultsConsentVersion: 1,
    })
    .returning();
  return { participant, registration };
}

let rowNumber = 0;
function row(
  messageType: EmailMessageType,
  to: { participantId: string | null; registrationId: string | null; recipientEmail: string },
  payloadJson: Record<string, unknown> = {},
): OutboxRow {
  rowNumber += 1;
  return {
    id: `00000000-0000-4000-8000-${String(rowNumber).padStart(12, "0")}`,
    participantId: to.participantId,
    registrationId: to.registrationId,
    messageType,
    locale: "ro",
    recipientEmail: to.recipientEmail,
    payloadJson,
    idempotencyKey: `calendar:${rowNumber}`,
    requestedByStaffUserId: null,
    isManualResend: false,
    status: "PROCESSING",
    attemptCount: 1,
    nextAttemptAt: null,
    lockedAt: NOW,
    providerMessageId: null,
    transport: null,
    recipientCount: null,
    deliveredAt: null,
    rejectedAt: null,
    rejectionCause: null,
    providerCode: null,
    providerDetail: null,
    laterDeliveredAt: null,
    resolvedAt: null,
    retriedAt: null,
    retriedVia: null,
    lastError: null,
    createdAt: NOW,
    sentAt: null,
  };
}

const unfold = (ics: string) => ics.replace(/\r\n /g, "");
const setRsvp = (to: string) => updateCalendarRsvpTo(db, admin, { to }, NOW);

async function render(messageType: EmailMessageType, who: Awaited<ReturnType<typeof registered>>, payload: Record<string, unknown> = {}) {
  return renderOutboxMessage(
    row(messageType, { participantId: who.participant.id, registrationId: who.registration.id, recipientEmail: who.participant.deliveryEmail }, payload),
    db,
    NOW,
  );
}

describe("BR-REQ-080-01 «Răspunsurile din calendar merg la» (§672)", () => {
  it("is off until an Administrator types an address; trimmed, checked, audited, and off again when emptied", async () => {
    expect(await readCalendarRsvpTo(db)).toEqual({ to: "", updatedAt: null });
    expect(await calendarRsvpToForSending(db)).toBeNull();

    await setRsvp(`  ${RSVP} `);
    expect((await readCalendarRsvpTo(db)).to).toBe(RSVP);
    // The send reads the new address at once on the instance that saved it.
    expect(await calendarRsvpToForSending(db)).toBe(RSVP);
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "calendar_rsvp_to.changed"));
    expect(audit).toMatchObject({ entityType: "platform_setting", entityId: CALENDAR_RSVP_SETTING_ENTITY_ID, actorStaffUserId: admin.id, metadataJson: { from: "", to: RSVP } });

    // Not an address: refused, naming the box, and nothing changes.
    await expect(setRsvp("nu-e-adresa")).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["calendarRsvpTo"] });
    await expect(setRsvp("a@b@example.org")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await readCalendarRsvpTo(db)).to).toBe(RSVP);

    // Only the Administrator: an Organizer is refused, whatever the address.
    const [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Organizer", role: "MODERATOR" }).returning();
    await expect(updateCalendarRsvpTo(db, organizer, { to: "" }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await setRsvp("");
    expect((await readCalendarRsvpTo(db)).to).toBe("");
    expect(await calendarRsvpToForSending(db)).toBeNull();
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "calendar_rsvp_to.changed"))).toHaveLength(2);
  });

  it("reads a stored value it can no longer parse as off — a message never fails over it", async () => {
    await db.insert(platformSettings).values({ key: CALENDAR_RSVP_SETTING_KEY, value: { to: 42 }, updatedAt: NOW });
    expect((await readCalendarRsvpTo(db)).to).toBe("");
    expect(await calendarRsvpToForSending(db)).toBeNull();
  });
});

describe("BR-REQ-080-01 criterion 11 the five messages, with the setting unset and set (§672)", () => {
  it("unset: the confirmation and the reminder carry today's file, and nothing else carries one", async () => {
    const event = await publishedRace();
    const ana = await registered(event.id);
    for (const type of ["REGISTRATION_CONFIRMED", "EVENT_REMINDER"] as const) {
      const message = await render(type, ana);
      expect(message.calendar, type).toBeUndefined();
      expect(message.attachments?.map((file) => [file.filename, file.contentType]), type).toEqual([["crosul-aniversar.ics", "text/calendar; charset=utf-8"]]);
      const ics = message.attachments![0].data.toString("utf8");
      expect(ics).toContain("METHOD:PUBLISH");
      expect(ics).not.toContain("ORGANIZER");
      expect(ics).not.toContain("ATTENDEE");
    }
    for (const [type, payload] of [
      ["EVENT_UPDATE_NOTICE", { changes: ["time", "place"] }],
      ["EVENT_CANCELLED", { reason: { ro: "Ploaie.", en: "Rain." } }],
    ] as const) {
      const message = await render(type, ana, payload);
      expect(message.calendar, type).toBeUndefined();
      expect(message.attachments, type).toBeUndefined();
    }
  });

  it("set: the confirmation and the reminder carry an invitation in place of the file, to the person's own address", async () => {
    const event = await publishedRace();
    const ana = await registered(event.id);
    await setRsvp(RSVP);
    for (const type of ["REGISTRATION_CONFIRMED", "EVENT_REMINDER"] as const) {
      const message = await render(type, ana);
      expect(message.attachments, type).toBeUndefined();
      expect(message.calendar?.method, type).toBe("REQUEST");
      const ics = unfold(message.calendar!.ics);
      expect(ics).toContain("METHOD:REQUEST");
      expect(ics).toContain(`ORGANIZER;CN=Brașov Runners:mailto:${RSVP}`);
      expect(ics).toContain("ATTENDEE;CN=Ana Popescu;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ana@example.org");
      expect(ics).toContain("SEQUENCE:0");
      expect(ics).toContain(`UID:${event.id}@`);
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    }
  });

  it("set: «Detalii actualizate» carries the update for the time or the place, never for the programme or a note alone", async () => {
    const event = await publishedRace();
    const ana = await registered(event.id);
    await setRsvp(RSVP);
    for (const changes of [["time"], ["place"], ["reinstated"], ["programme", "place"]]) {
      const message = await render("EVENT_UPDATE_NOTICE", ana, { changes });
      expect(message.calendar?.method, changes.join()).toBe("REQUEST");
    }
    for (const payload of [{ changes: ["programme"] }, { changes: [], note: { ro: "Aduceți apă.", en: "Bring water." } }]) {
      const message = await render("EVENT_UPDATE_NOTICE", ana, payload);
      expect(message.calendar).toBeUndefined();
      expect(message.attachments).toBeUndefined();
    }
  });

  it("set: the cancellation carries the invitation's cancellation, a sequence above the last invitation's", async () => {
    const event = await publishedRace();
    const ana = await registered(event.id);
    await setRsvp(RSVP);
    const invited = unfold((await render("REGISTRATION_CONFIRMED", ana)).calendar!.ics);
    expect(invited).toContain("SEQUENCE:0");

    // The editor's cancellation, told: the event's number moves with the status, in the save's transaction.
    const [created] = await db.select().from(events).where(eq(events.id, event.id));
    await db.update(events).set({ eventStatus: "CANCELLED", calendarSequence: created.calendarSequence + 1 }).where(eq(events.id, event.id));
    const message = await render("EVENT_CANCELLED", ana, { reason: { ro: "Ploaie.", en: "Rain." } });
    expect(message.calendar?.method).toBe("CANCEL");
    const ics = unfold(message.calendar!.ics);
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:1");
    expect(ics).toContain(`UID:${event.id}@`);
    expect(ics).not.toContain("RSVP=TRUE");
  });

  it("set: the method follows the event at the send — a request after a cancellation cancels, a cancellation after it is on again carries nothing", async () => {
    const event = await publishedRace({ eventStatus: "CANCELLED" });
    const ana = await registered(event.id);
    await setRsvp(RSVP);
    const late = await render("EVENT_UPDATE_NOTICE", ana, { changes: ["time"] });
    expect(late.calendar?.method).toBe("CANCEL");
    expect(unfold(late.calendar!.ics)).toContain("METHOD:CANCEL");
    expect(late.calendar!.ics).not.toContain("RSVP=TRUE");

    await db.update(events).set({ eventStatus: "SCHEDULED" }).where(eq(events.id, event.id));
    const stale = await render("EVENT_CANCELLED", ana, { reason: { ro: "Ploaie.", en: "Rain." } });
    expect(stale.calendar).toBeUndefined();
    expect(stale.attachments).toBeUndefined();
  });

  it("set: nobody without a place is invited — the waiting list hears the update and the cancellation without one", async () => {
    const event = await publishedRace();
    const waiting = await registered(event.id, "WAITLISTED", "ion@example.org");
    await setRsvp(RSVP);
    expect((await render("EVENT_UPDATE_NOTICE", waiting, { changes: ["time"] })).calendar).toBeUndefined();
    expect((await render("EVENT_CANCELLED", waiting, { reason: { ro: "Ploaie.", en: "Rain." } })).calendar).toBeUndefined();
    // A confirmation rendered for a registration no longer confirmed keeps today's file.
    const cancelled = await registered(event.id, "CANCELLED", "maria@example.org");
    const late = await render("REGISTRATION_CONFIRMED", cancelled);
    expect(late.calendar).toBeUndefined();
    expect(late.attachments?.map((file) => file.filename)).toEqual(["crosul-aniversar.ics"]);
  });

  it("set: a draft gets nothing, as since §174", async () => {
    const event = await publishedRace({ editorialStatus: "DRAFT", publishedAt: null });
    const ana = await registered(event.id);
    await setRsvp(RSVP);
    const message = await render("REGISTRATION_CONFIRMED", ana);
    expect(message.calendar).toBeUndefined();
    expect(message.attachments).toBeUndefined();
  });

  it("set: a club copy attaches nothing and carries no invitation (§320)", async () => {
    const event = await publishedRace();
    const ana = await registered(event.id);
    await setRsvp(RSVP);
    for (const [type, payload] of [
      ["REGISTRATION_CONFIRMED", {}],
      ["EVENT_REMINDER", {}],
      ["EVENT_UPDATE_NOTICE", { changes: ["time"] }],
      ["EVENT_CANCELLED", { reason: { ro: "Ploaie.", en: "Rain." } }],
    ] as const) {
      const copy = await renderOutboxMessage(
        row(type, { participantId: null, registrationId: ana.registration.id, recipientEmail: "arhiva@example.org" }, clubCopyPayload(payload)),
        db,
        NOW,
      );
      expect(copy.calendar, type).toBeUndefined();
      expect(copy.attachments, type).toBeUndefined();
    }
  });
});

describe("BR-REQ-080-01 the group run's declaration carries the invitation to the signer (§672)", () => {
  async function approve(key: "GROUP_RUN_DECLARATION_TRAIL" | "PRIVACY_NOTICE") {
    const translations: LegalDocumentTranslationInput[] = (["ro", "en"] as const).map((locale) => ({ locale, ...LEGAL_TEMPLATES[key][locale] }));
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
  }

  async function signed() {
    await approve("GROUP_RUN_DECLARATION_TRAIL");
    await approve("PRIVACY_NOTICE");
    const [event] = await db
      .insert(events)
      .values({
        type: "GROUP_RUN",
        surface: "TRAIL",
        offersGroupRunDeclaration: true,
        editorialStatus: "PUBLISHED",
        publishedAt: NOW,
        startsAt: new Date("2026-10-07T16:00:00.000Z"),
        registrationMode: "NONE",
        locationName: "Stația de telecabină",
        weatherMode: "off",
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", title: "Tura pe munte", slug: "tura-pe-munte" },
      { eventId: event.id, locale: "en", title: "The mountain loop", slug: "mountain-loop" },
    ]);
    await updateClubNotices(db, admin, { declarations: { to: "arhiva@example.org", cc: [], bcc: [] }, confirmations: { to: [] }, participants: { bcc: [] } }, NOW);
    const document = await findCurrentApprovedDocument(db, "GROUP_RUN_DECLARATION_TRAIL", "ro", NOW);
    await signGroupRunDeclaration(
      db,
      {
        eventId: event.id,
        documentId: document!.id,
        contentSha256: document!.contentSha256,
        accepted: true,
        typedName: "Ana Popescu",
        birthDate: "1990-05-17",
        email: "ana@example.org",
        locale: "ro",
      },
      NOW,
    );
    const rows = await db.select().from(emailOutbox);
    const claimed = (type: EmailMessageType) => ({ ...rows.find((candidate) => candidate.messageType === type)!, status: "PROCESSING" as const, attemptCount: 1, lockedAt: NOW });
    return { event, signer: claimed("GROUP_RUN_DECLARATION_SIGNED"), archive: claimed("GROUP_RUN_DECLARATION_ARCHIVE") };
  }

  it("unset: the PDF alone, as before", async () => {
    const { signer } = await signed();
    const message = await renderOutboxMessage(signer, db, NOW);
    expect(message.calendar).toBeUndefined();
    expect(message.attachments?.map((file) => file.contentType)).toEqual(["application/pdf"]);
  });

  it("set: the signer's copy carries the run as an invitation under the name they signed with; the archive copy carries none", async () => {
    const { event, signer, archive } = await signed();
    await setRsvp(RSVP);
    const message = await renderOutboxMessage(signer, db, NOW);
    expect(message.attachments?.map((file) => file.contentType)).toEqual(["application/pdf"]);
    expect(message.calendar?.method).toBe("REQUEST");
    const ics = unfold(message.calendar!.ics);
    expect(ics).toContain(`UID:${event.id}@`);
    expect(ics).toContain(`ORGANIZER;CN=Brașov Runners:mailto:${RSVP}`);
    expect(ics).toContain("ATTENDEE;CN=Ana Popescu;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ana@example.org");

    const toClub = await renderOutboxMessage(archive, db, NOW);
    expect(toClub.calendar).toBeUndefined();
    expect(toClub.attachments?.map((file) => file.contentType)).toEqual(["application/pdf"]);
  });
});

describe("BR-REQ-020-01 criterion 7 the invitation's SEQUENCE moves with the time, the place and the status (§672)", () => {
  const FIELDS = {
    type: "RACE",
    eventStatus: "SCHEDULED",
    timezone: "Europe/Bucharest",
    startsAtWallTime: "2026-10-11T09:00",
    endsAtWallTime: "",
    raceStartsAtWallTime: "",
    locationName: "Parcul Tractorul",
    locationAddress: "",
    surface: null,
    difficulty: null,
    costType: null,
    mapUrl: "",
    routeUrl: "",
    distanceMeters: "",
    elevationGainMeters: "",
    featured: false,
    registrationMode: "NONE",
    participantListVisibility: "HIDDEN" as const,
    capacity: "",
    registrationOpensAtWallTime: "",
    registrationClosesAtWallTime: "",
    declarationDocumentId: "",
    externalProvider: "",
    externalRegistrationUrl: "",
  };

  async function save(id: string, fields: Record<string, unknown>, extra: Partial<Parameters<typeof saveEventFields>[1]> = {}) {
    const [current] = await db.select().from(events).where(eq(events.id, id));
    return saveEventFields(db, { actor: admin, eventId: id, expectedVersion: current.version, fields, now: NOW, ...extra });
  }
  const sequenceOf = async (id: string) => (await db.select({ value: events.calendarSequence }).from(events).where(eq(events.id, id)))[0].value;

  it("bumps on a moved start, a moved place, a cancellation and a date on again — told or not — and never on anything else", async () => {
    const created = await createEvent(db, {
      actor: admin,
      fields: {
        ...FIELDS,
        translations: {
          ro: { slug: "crosul-aniversar", title: "Crosul aniversar", excerpt: "Cursa clubului." },
          en: { slug: "anniversary-cross", title: "Anniversary cross", excerpt: "The club's own race." },
        },
      },
    });
    expect(await sequenceOf(created.id)).toBe(0);

    // Nothing the calendar holds: no bump.
    await save(created.id, { ...FIELDS, featured: true });
    expect(await sequenceOf(created.id)).toBe(0);
    // The start moved, nobody told: the next invitation must outrank the last all the same.
    await save(created.id, { ...FIELDS, startsAtWallTime: "2026-10-11T10:00" });
    expect(await sequenceOf(created.id)).toBe(1);
    // The place moved, the participants told.
    await save(created.id, { ...FIELDS, startsAtWallTime: "2026-10-11T10:00", locationName: "Poiana Brașov" }, { notice: { notify: true } });
    expect(await sequenceOf(created.id)).toBe(2);
    // Cancelled, then on again.
    await save(
      created.id,
      { ...FIELDS, startsAtWallTime: "2026-10-11T10:00", locationName: "Poiana Brașov", eventStatus: "CANCELLED" },
      { cancellation: { reason: { ro: "Ploaie.", en: "Rain." }, notify: true } },
    );
    expect(await sequenceOf(created.id)).toBe(3);
    await save(created.id, { ...FIELDS, startsAtWallTime: "2026-10-11T10:00", locationName: "Poiana Brașov" });
    expect(await sequenceOf(created.id)).toBe(4);
  });

  it("on a series, every date the save moves is bumped, nobody told; a save that moves nothing bumps none", async () => {
    const created = await createEvent(db, {
      actor: admin,
      fields: {
        ...FIELDS,
        startsAtWallTime: "2026-10-07T19:00",
        translations: {
          ro: { slug: "alergarea-de-miercuri", title: "Alergarea de miercuri", excerpt: "Seara." },
          en: { slug: "wednesday-run", title: "The Wednesday run", excerpt: "In the evening." },
        },
      },
    });
    await repeatEvent(db, { actor: admin, eventId: created.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const copies = await db.select().from(events).where(eq(events.repeatOf, created.id));
    expect(copies.length).toBe(2);
    const all = [created.id, ...copies.map((copy) => copy.id)];

    const saveSeries = async (fields: Record<string, unknown>) => {
      const [current] = await db.select().from(events).where(eq(events.id, created.id));
      await saveEventAndTranslations(db, { actor: admin, eventId: created.id, fields, expectedVersion: current.version, translations: [], scope: "all", now: NOW });
    };
    await saveSeries({ ...FIELDS, startsAtWallTime: "2026-10-07T19:00", featured: true });
    for (const id of all) expect(await sequenceOf(id)).toBe(0);
    await saveSeries({ ...FIELDS, startsAtWallTime: "2026-10-07T19:30", featured: true });
    for (const id of all) expect(await sequenceOf(id)).toBe(1);
  });

  it("a cancellation after an invitation: the confirmation said 0, the cancellation the editor queued says CANCEL with 1", async () => {
    const created = await createEvent(db, {
      actor: admin,
      fields: {
        ...FIELDS,
        translations: {
          ro: { slug: "crosul-aniversar", title: "Crosul aniversar", excerpt: "Cursa clubului." },
          en: { slug: "anniversary-cross", title: "Anniversary cross", excerpt: "The club's own race." },
        },
      },
    });
    await db.update(events).set({ editorialStatus: "PUBLISHED", publishedAt: NOW, weatherMode: "off" }).where(eq(events.id, created.id));
    const ana = await registered(created.id);
    await setRsvp(RSVP);
    expect(unfold((await render("REGISTRATION_CONFIRMED", ana)).calendar!.ics)).toContain("SEQUENCE:0");

    await save(created.id, { ...FIELDS, eventStatus: "CANCELLED" }, { cancellation: { reason: { ro: "Ploaie.", en: "Rain." }, notify: true } });
    const [queued] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "EVENT_CANCELLED"));
    expect(queued.recipientEmail).toBe("ana@example.org");
    const message = await renderOutboxMessage({ ...queued, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
    const ics = unfold(message.calendar!.ics);
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("SEQUENCE:1");
    expect(ics).toContain(`UID:${created.id}@`);
  });
});
