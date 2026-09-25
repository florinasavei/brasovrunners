import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailMessageType, emailOutbox, type EmailMessageType } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { updateClubNotices } from "@/modules/notifications/club-notices";
import { isParticipantMessage } from "@/modules/notifications/domain/club-notices";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import type { DeclarationPdfInput } from "@/modules/registrations/declaration-pdf";
import { findRegistrationDetailForAdmin, listOutboxHistory } from "@/modules/registrations/admin-repository";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import { addTestRegistrations } from "@/modules/registrations/test-registrations";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-033-02 criteria 11 and 14 as amended by §320, and BR-REQ-036-02 — no club-bound message
 * carries anything only the participant may hold.
 *
 * The GDPR audit of 2026-09-23 found the participant-Bcc list (§293) receiving the participant's
 * message byte for byte: live single-use links to confirm the address, sign the declaration,
 * take a freed place or cancel, the check-in QR, and the signed declaration with the identity
 * document. Anybody reading a club mailbox could act for the runner. This file walks a real
 * registration to its confirmation with every club list set, then renders every message the club
 * receives — each club copy, the archive copy of the declaration, the confirmation notice — and
 * asserts that none contains a token minted in the test, an action path, a desk code or an
 * unmasked identity document, while the participant's own messages still carry all of it.
 *
 * Two seams are watched rather than replaced: every token `issueActionToken` mints is recorded,
 * so "contains no token" is checked against the real secrets rather than a pattern; and every
 * input the declaration PDF is drawn from is recorded, because pdfkit writes an embedded font's
 * text as glyph ids in a deflated stream and the drawn page cannot be searched for a number.
 */
const watched = vi.hoisted(() => ({ secrets: [] as string[], pdfInputs: [] as unknown[] }));

vi.mock("@/modules/action-tokens/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/action-tokens/repository")>();
  return {
    ...actual,
    issueActionToken: async (...args: Parameters<typeof actual.issueActionToken>) => {
      const issued = await actual.issueActionToken(...args);
      watched.secrets.push(issued.secret);
      return issued;
    },
  };
});

vi.mock("@/modules/registrations/declaration-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/registrations/declaration-pdf")>();
  return {
    ...actual,
    renderDeclarationPdf: async (input: Parameters<typeof actual.renderDeclarationPdf>[0]) => {
      watched.pdfInputs.push(input);
      return actual.renderDeclarationPdf(input);
    },
  };
});

const NOW = new Date("2026-09-04T10:00:00.000Z");
const ARCHIVE = "arhiva@example.test";
const HIDDEN = "contabil@example.test";
const PRESIDENT = "presedinte@example.test";
const ID_DOCUMENT = "BV 123456";

/** Every path a participant's token opens, in both languages, and the two token/code APIs. */
const ACTION_PATH =
  /\/(inregistrari|registrations)\/(confirmare|confirm|declaratie|declare|gestionare|manage|lista|list)\/|\/(inscrieri|registrations)\/(ale-mele|mine)\/[A-Za-z0-9_-]{20,}|\/api\/registrations\/(declaration|qr)\//;

async function approve(db: TestDatabase) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație pe proprie răspundere", body: declarationRo },
    { locale: "en", title: "Declaration", body: declarationEn },
  ];
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "TERMS", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(privacy), translations: privacy, now: NOW });
  await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(declaration), translations: declaration, now: NOW });
}

async function createEvent(db: TestDatabase): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL", capacity: 10, locationName: "Parcul Tractorul" })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul aniversar", slug: "crosul-aniversar" },
    { eventId: event.id, locale: "en", title: "The anniversary cross", slug: "anniversary-cross" },
  ]);
  return {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    registrationMode: event.registrationMode,
    registrationOpensAt: null,
    registrationClosesAt: null,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
  };
}

const submission = {
  firstName: "Ana",
  lastName: "Popescu",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Popescu",
  emergencyContactPhone: "+40722222222",
  email: "ana@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
};

const claimed = (row: OutboxRow): OutboxRow => ({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: NOW });

/** What a PDF was drawn from, as one string: the text's fill-ins and the signature line. */
const drawnFrom = (input: unknown) => JSON.stringify((input as DeclarationPdfInput).entries.map((entry) => ({ values: entry.values, signature: entry.signature })));

describe("BR-REQ-033-02 criterion 14 no club-bound message carries a token, a link, an attachment or the identity document (§320)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    watched.secrets.length = 0;
    watched.pdfInputs.length = 0;
  });

  async function everyListSet() {
    const [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    await updateClubNotices(
      db,
      admin,
      {
        declarations: { to: ARCHIVE, cc: [], bcc: [] },
        confirmations: { to: [PRESIDENT] },
        // The participant's own address on the list too: they get their message, never the copy.
        participants: { bcc: [HIDDEN, PRESIDENT, submission.email] },
      },
      NOW,
    );
    return admin;
  }

  async function confirmedRegistration(event: EventForRegistration) {
    await submitRegistration(db, event, submission, NOW);
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, row.id, NOW);
    await signDeclaration(db, event, row.id, { ...(await signingInput(db, NOW, "Ana Popescu")), idDocument: ID_DOCUMENT }, NOW);
    return row;
  }

  it("queues one club copy per club address beside each participant message, and none on the participant's envelope", async () => {
    await approve(db);
    await everyListSet();
    const event = await createEvent(db);
    const registration = await confirmedRegistration(event);

    const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, registration.id));
    const own = rows.filter((row) => row.participantId !== null && isParticipantMessage(row.messageType));
    expect(own.map((row) => row.messageType).sort()).toEqual(["COMPLETE_DECLARATION", "REGISTRATION_CONFIRMED", "VERIFY_REGISTRATION_EMAIL"]);

    for (const message of own) {
      // The participant's own row: to them, and no club address anywhere on it.
      expect(message.recipientEmail).toBe(submission.email);
      expect(message.payloadJson, message.messageType).not.toHaveProperty("bcc");
      expect(message.payloadJson, message.messageType).not.toHaveProperty("cc");
      expect(message.payloadJson, message.messageType).not.toHaveProperty("clubCopy");

      const copies = rows.filter((row) => row.messageType === message.messageType && row.participantId === null);
      // The address confirmation goes to an address nobody has confirmed yet: no copy of it (§NNN).
      if (message.messageType === "VERIFY_REGISTRATION_EMAIL") {
        expect(copies, message.messageType).toEqual([]);
        continue;
      }
      expect(copies.map((copy) => copy.recipientEmail).sort(), message.messageType).toEqual([HIDDEN, PRESIDENT].sort());
      for (const copy of copies) {
        expect(copy.payloadJson).toEqual({ ...(message.payloadJson as object), clubCopy: true });
        expect(copy.locale).toBe(message.locale);
        expect(copy.idempotencyKey).toBe(`${message.idempotencyKey}:club-copy:${copy.recipientEmail}`);
      }
    }

    // The club's own messages are not copied again: one archive copy, one notice, no more.
    expect(rows.filter((row) => row.messageType === "DECLARATION_ARCHIVE")).toHaveLength(1);
    expect(rows.filter((row) => row.messageType === "CLUB_CONFIRMATION_NOTICE")).toHaveLength(1);
    // Three participant messages, two copies of each but the address confirmation, the archive copy and the notice.
    expect(rows).toHaveLength(3 + 2 * 2 + 1 + 1);

    // The backoffice's timeline labels the copies, so they do not read as sends to the runner.
    const history = await listOutboxHistory(db, registration.id);
    expect(history.filter((entry) => entry.clubCopy)).toHaveLength(4);
    expect(history.filter((entry) => !entry.clubCopy)).toHaveLength(5);

    // A club mailbox that bounces its copy says nothing about the participant's address (§76).
    const bounced = () => findRegistrationDetailForAdmin(db, registration.id).then((detail) => detail?.emailRejectedReason ?? null);
    const [copy] = rows.filter((row) => row.participantId === null);
    await db.update(emailOutbox).set({ status: "BOUNCED", lastError: "550 club mailbox full" }).where(eq(emailOutbox.id, copy.id));
    expect(await bounced()).toBeNull();
    const [verification] = own.filter((row) => row.messageType === "VERIFY_REGISTRATION_EMAIL");
    await db.update(emailOutbox).set({ status: "BOUNCED", lastError: "550 no such user" }).where(eq(emailOutbox.id, verification.id));
    expect(await bounced()).toBe("550 no such user");
  });

  it("renders every club-bound message with no token, no action path, no desk code and a masked identity document", async () => {
    await approve(db);
    await everyListSet();
    const event = await createEvent(db);
    const registration = await confirmedRegistration(event);
    const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, registration.id));

    // The participant's own messages first: they mint the tokens this test then looks for.
    const own = rows.filter((row) => row.participantId !== null && isParticipantMessage(row.messageType));
    let confirmationPdf: unknown;
    for (const row of own) {
      const before = watched.secrets.length;
      const pdfsBefore = watched.pdfInputs.length;
      const message = await renderOutboxMessage(claimed(row), db, NOW);
      const minted = watched.secrets.slice(before);
      // The participant's message is unchanged: their links, their code, their PDF.
      expect(minted.length, row.messageType).toBeGreaterThan(0);
      for (const secret of minted) expect(message.html, row.messageType).toContain(secret);
      expect(message.to).toBe(submission.email);
      expect(message.bcc).toBeUndefined();
      if (row.messageType === "REGISTRATION_CONFIRMED") {
        expect(message.html).toMatch(/\/api\/registrations\/qr\//);
        expect(message.attachments?.some((file) => file.contentType === "application/pdf")).toBe(true);
        confirmationPdf = watched.pdfInputs[pdfsBefore];
      }
    }
    // The runner's own copy of the declaration is whole.
    expect(drawnFrom(confirmationPdf)).toContain(ID_DOCUMENT);
    expect(watched.secrets.length).toBeGreaterThanOrEqual(4);
    // The desk code the confirmation carried: what the desk hands the number against.
    const [{ checkinCode }] = await db.select({ checkinCode: registrations.checkinCode }).from(registrations).where(eq(registrations.id, registration.id));
    expect(checkinCode).toBeTruthy();

    // Now everything the club receives.
    const clubBound = rows.filter((row) => row.participantId === null || !isParticipantMessage(row.messageType));
    expect(clubBound.map((row) => row.messageType).sort()).toEqual(
      ["CLUB_CONFIRMATION_NOTICE", "DECLARATION_ARCHIVE", ...["COMPLETE_DECLARATION", "REGISTRATION_CONFIRMED"].flatMap((type) => [type, type])].sort(),
    );
    const tokensBefore = (await db.select().from(emailActionTokens)).length;
    const secretsBefore = watched.secrets.length;

    for (const row of clubBound) {
      const pdfsBefore = watched.pdfInputs.length;
      const message = await renderOutboxMessage(claimed(row), db, NOW);
      const label = `${row.messageType} to ${row.recipientEmail}`;

      for (const body of [message.html, message.text, message.subject]) {
        for (const secret of watched.secrets) expect(body, label).not.toContain(secret);
        expect(body, label).not.toMatch(ACTION_PATH);
        expect(body, label).not.toContain(ID_DOCUMENT);
        expect(body, label).not.toContain("123456");
        // Nothing the desk hands a number against.
        expect(body, label).not.toContain(checkinCode!);
      }

      if (row.messageType === "DECLARATION_ARCHIVE") {
        // The archive keeps its PDF — drawn with the identity document masked.
        expect(message.attachments, label).toHaveLength(1);
        const input = watched.pdfInputs[pdfsBefore];
        expect(drawnFrom(input)).not.toContain("123456");
        expect(drawnFrom(input)).toContain("BV ••••56");
        expect(message.text).toContain("cu seria și numărul actului de identitate mascate");
      } else {
        // A club copy, and the notice, attach nothing at all.
        expect(message.attachments ?? [], label).toHaveLength(0);
        expect(watched.pdfInputs.length, label).toBe(pdfsBefore);
      }

      if (row.participantId === null) {
        // A club copy: to the one club address its row is for, marked, with the runner's greeting.
        expect(message.to).toBe(row.recipientEmail);
        expect(message.cc).toBeUndefined();
        expect(message.bcc).toBeUndefined();
        expect(message.subject.startsWith("[Copie club] ")).toBe(true);
        expect(message.subject).toContain(" / [Club copy] ");
        expect(message.text).toContain("Copie pentru club a mesajului trimis participantului.");
        expect(message.text).toContain("Salut, Ana Popescu,");
      }
    }

    // Rendering the club's messages minted nothing, anywhere.
    expect(watched.secrets.length).toBe(secretsBefore);
    expect((await db.select().from(emailActionTokens)).length).toBe(tokensBefore);
  });

  /**
   * Every message type a participant receives, whether or not the walk above reached it: a club
   * copy of each, rendered against a confirmed registration with a signed declaration — the state
   * in which the most personal things exist to leak.
   */
  it("renders a club copy of every participant message type with nothing to act on and nothing attached", async () => {
    await approve(db);
    const event = await createEvent(db);
    const registration = await confirmedRegistration(event);
    // Not a group run's self-declaration (§393): it is about no registration, so it is never copied
    // (`enqueueClubCopies` copies only a message with a registration) and a copy of it cannot exist.
    const types = (emailMessageType.enumValues as EmailMessageType[]).filter((type) => isParticipantMessage(type) && type !== "GROUP_RUN_DECLARATION_SIGNED");
    expect(types.length).toBeGreaterThanOrEqual(14);

    // Tokens exist for this registration already: the participant's own messages minted them.
    for (const row of await db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, registration.id), isNotNull(emailOutbox.participantId)))) {
      await renderOutboxMessage(claimed(row), db, NOW);
    }
    const secretsBefore = watched.secrets.length;
    expect(secretsBefore).toBeGreaterThan(0);

    for (const messageType of types) {
      const [row] = await db
        .insert(emailOutbox)
        .values({
          participantId: null,
          registrationId: registration.id,
          messageType,
          locale: "ro",
          recipientEmail: HIDDEN,
          payloadJson: { clubCopy: true, ...(messageType === "EVENT_THANKS" ? { url: "https://example.org/rezultate" } : {}) },
          idempotencyKey: `by-hand:${messageType}:club-copy`,
          status: "PENDING",
          attemptCount: 0,
          createdAt: NOW,
        })
        .returning();
      const pdfsBefore = watched.pdfInputs.length;
      const message = await renderOutboxMessage(claimed(row), db, NOW);

      for (const body of [message.html, message.text]) {
        for (const secret of watched.secrets) expect(body, messageType).not.toContain(secret);
        expect(body, messageType).not.toMatch(ACTION_PATH);
        expect(body, messageType).not.toContain("123456");
      }
      expect(message.attachments ?? [], messageType).toHaveLength(0);
      expect(watched.pdfInputs.length, messageType).toBe(pdfsBefore);
      expect(message.html, messageType).not.toContain("display:inline-block;background");
      expect(message.subject.startsWith("[Copie club] "), messageType).toBe(true);
    }
    expect(watched.secrets.length).toBe(secretsBefore);
  });

  /**
   * A row queued before §320 deployed carries the old participant Bcc in its payload. Rendered
   * after, it goes to the participant alone: the club loses one copy of an in-flight message
   * rather than a club mailbox receiving that runner's live links.
   */
  it("sends a participant's message queued with the old Bcc to the participant alone", async () => {
    await approve(db);
    const event = await createEvent(db);
    const registration = await confirmedRegistration(event);
    const [confirmed] = await db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.registrationId, registration.id), eq(emailOutbox.messageType, "REGISTRATION_CONFIRMED")));
    const legacy = { ...confirmed, payloadJson: { bcc: [HIDDEN, PRESIDENT] } };

    const message = await renderOutboxMessage(claimed(legacy), db, NOW);
    expect(message.to).toBe(submission.email);
    expect(message.bcc).toBeUndefined();
    expect(message.cc).toBeUndefined();
    // Still the participant's whole message.
    expect(message.html).toMatch(/\/inregistrari\/gestionare\//);

    // The club's own archive copy keeps the copies it was queued with (§244).
    const [archive] = await db.insert(emailOutbox).values({
      participantId: registration.participantId,
      registrationId: registration.id,
      messageType: "DECLARATION_ARCHIVE",
      locale: "ro",
      recipientEmail: ARCHIVE,
      payloadJson: { cc: [PRESIDENT], bcc: [HIDDEN] },
      idempotencyKey: "by-hand:archive",
      status: "PENDING",
      attemptCount: 0,
      createdAt: NOW,
    }).returning();
    const copy = await renderOutboxMessage(claimed(archive), db, NOW);
    expect(copy.cc).toEqual([PRESIDENT]);
    expect(copy.bcc).toEqual([HIDDEN]);
  });

  it("queues no club copy for a test registration, nor for a message with no registration (§12.6)", async () => {
    await approve(db);
    const admin = await everyListSet();
    const event = await createEvent(db);
    await addTestRegistrations(db, admin, { eventId: event.id, count: 1, now: NOW });
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await signDeclaration(db, event, row.id, { ...(await signingInput(db, NOW, row.registeredName)), idDocument: "BV 000000" }, NOW);

    const queued = await db.select().from(emailOutbox);
    expect(queued.map((r) => r.messageType)).toContain("REGISTRATION_CONFIRMED");
    expect(await db.select().from(emailOutbox).where(isNull(emailOutbox.participantId))).toHaveLength(0);
    for (const message of queued) expect(message.payloadJson, message.messageType).not.toHaveProperty("clubCopy");
  });
});
