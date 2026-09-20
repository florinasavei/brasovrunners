import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { registrationInterests } from "@/db/schema/registration-interests";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { queueRegistrationOpenedMessages, registerInterest, withdrawInterest } from "@/modules/registrations/interest";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const OPENS_AT = new Date(NOW.getTime() + 2 * DAY);

/**
 * BR-REQ-011-01 criterion 13 and BR-REQ-080-01 criterion 9 (`DECISIONS.md` §146): "tell me
 * when registration opens". What is protected: one row per event and canonical identity,
 * the form's own spam defences with the form's own silence, no address while no approved
 * privacy notice describes what happens to it (BR-REQ-053-01), a message the run that first
 * sees the window open — never before, never for an event that will not open — the address
 * gone with the message, and withdrawal by the canonical identity before it goes.
 */
describe("BR-REQ-011-01 criterion 13 — the interest list and REGISTRATION_OPENED", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    await approvePrivacyNotice();
  });

  /** The gate the registration form has: an address is taken only under an approved notice. */
  async function approvePrivacyNotice() {
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
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

  async function seedEvent(overrides: Partial<typeof events.$inferInsert> = {}) {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: new Date(NOW.getTime() + 30 * DAY),
        registrationMode: "INTERNAL",
        registrationOpensAt: OPENS_AT,
        editorialStatus: "PUBLISHED",
        publishedAt: new Date(NOW.getTime() - DAY),
        locationName: "Parcul Tractorul",
        mapUrl: "https://maps.example/tractorul",
        ...overrides,
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul" },
      { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title: "The cross" },
    ]);
    return event;
  }

  const rendered = new Date(NOW.getTime() - 60_000).toISOString();
  const form = (email: string, extra: Record<string, unknown> = {}) => ({ email, locale: "ro", renderedAt: rendered, ...extra });
  const rows = (eventId: string) => db.select().from(registrationInterests).where(eq(registrationInterests.eventId, eventId));
  const outbox = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "REGISTRATION_OPENED"));

  it("keeps one row per event and canonical identity — case, whitespace and a Gmail tag are one address", async () => {
    const event = await seedEvent();
    await registerInterest(db, event, form("Ana.Pop@gmail.com"), NOW);
    await registerInterest(db, event, form("  ana.pop@gmail.com "), NOW);
    await registerInterest(db, event, form("ana.pop+race@googlemail.com", { locale: "en" }), NOW);
    // Gmail dots are two addresses since version 2 (§74): a second row, not a collision.
    await registerInterest(db, event, form("anapop@gmail.com"), NOW);

    const kept = await rows(event.id);
    expect(kept).toHaveLength(2);
    const first = kept.find((row) => row.deliveryEmail === "Ana.Pop@gmail.com");
    expect(first?.canonicalEmail).toBe("ana.pop@gmail.com");
    expect(first?.canonicalizationVersion).toBe(2);
    // The first signature wins — the language of the page they were on, the address as typed.
    expect(first?.locale).toBe("ro");

    // Another event is another list.
    const other = await seedEvent();
    await registerInterest(db, other, form("ana.pop@gmail.com"), NOW);
    expect(await rows(other.id)).toHaveLength(1);
  });

  it("refuses a malformed address as the one fixable error, and nothing else is refused", async () => {
    const event = await seedEvent();
    const bad = await registerInterest(db, event, form("not an address"), NOW).catch((e: unknown) => e);
    expect(isDomainError(bad) && bad.code).toBe("VALIDATION_ERROR");
    expect(isDomainError(bad) && [...bad.fields]).toEqual(["email"]);
    expect(await rows(event.id)).toHaveLength(0);
  });

  it("answers a bot exactly like a person — the form's honeypot and timing check, no row", async () => {
    const event = await seedEvent();
    await expect(registerInterest(db, event, form("bot@example.ro", { honeypot: "http://spam" }), NOW)).resolves.toBeUndefined();
    await expect(registerInterest(db, event, form("fast@example.ro", { renderedAt: new Date(NOW.getTime() - 1000).toISOString() }), NOW)).resolves.toBeUndefined();
    await expect(registerInterest(db, event, { email: "stripped@example.ro", locale: "ro" }, NOW)).resolves.toBeUndefined();
    expect(await rows(event.id)).toHaveLength(0);
  });

  it("takes no address while no approved privacy notice describes it — the form's own gate", async () => {
    await resetTables(db);
    const event = await seedEvent();
    const refused = await registerInterest(db, event, form("ana@example.ro"), NOW).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("CONFLICT");
    expect(await rows(event.id)).toHaveLength(0);
    // A bot is still answered with silence first, so the gate is not an oracle for the notice.
    await expect(registerInterest(db, event, form("bot@example.ro", { honeypot: "x" }), NOW)).resolves.toBeUndefined();
  });

  it("withdraws an address by its canonical identity, and says whether one went", async () => {
    const event = await seedEvent();
    await registerInterest(db, event, form("Ana.Pop@gmail.com"), NOW);
    await registerInterest(db, event, form("ion@example.ro"), NOW);
    expect(await withdrawInterest(db, event.id, "ana.pop+tag@googlemail.com ")).toBe(true);
    expect(await withdrawInterest(db, event.id, "ana.pop@gmail.com")).toBe(false);
    expect((await rows(event.id)).map((row) => row.deliveryEmail)).toEqual(["ion@example.ro"]);
    const bad = await withdrawInterest(db, event.id, "not an address").catch((e: unknown) => e);
    expect(isDomainError(bad) && bad.code).toBe("VALIDATION_ERROR");
  });

  it("takes no address once the window is no longer ahead", async () => {
    const event = await seedEvent();
    const late = await registerInterest(db, event, form("ana@example.ro"), new Date(OPENS_AT.getTime() + 1)).catch((e: unknown) => e);
    expect(isDomainError(late) && late.code).toBe("CONFLICT");
    const external = await seedEvent({ registrationMode: "EXTERNAL", externalRegistrationUrl: "https://forms.example/x" });
    const wrong = await registerInterest(db, external, form("ana@example.ro"), NOW).catch((e: unknown) => e);
    expect(isDomainError(wrong) && wrong.code).toBe("CONFLICT");
  });

  it("queues one message per address the run that sees the window open, never before, and deletes the row with it", async () => {
    const event = await seedEvent();
    await registerInterest(db, event, form("ana@example.ro"), NOW);
    await registerInterest(db, event, form("ion@example.ro", { locale: "en" }), NOW);

    // Before the window: nothing, and the rows wait.
    expect(await queueRegistrationOpenedMessages(db, new Date(OPENS_AT.getTime() - 1))).toEqual({ queued: 0, dropped: 0 });
    expect(await outbox()).toHaveLength(0);
    expect(await rows(event.id)).toHaveLength(2);

    // The window opens: the maintenance job carries the step — one message each, no
    // participant, the event in the payload, no token.
    const [ana] = (await rows(event.id)).filter((row) => row.deliveryEmail === "ana@example.ro");
    const opened = await runRegistrationMaintenance(db, OPENS_AT);
    expect(opened.interestsNotified).toBe(2);
    expect(opened.errorCount).toBe(0);
    const queued = await outbox();
    expect(queued).toHaveLength(2);
    const toAna = queued.find((row) => row.recipientEmail === "ana@example.ro");
    expect(toAna?.participantId).toBeNull();
    expect(toAna?.registrationId).toBeNull();
    expect(toAna?.locale).toBe("ro");
    expect(toAna?.idempotencyKey).toBe(`interest:${ana.id}:opened`);
    expect(toAna?.payloadJson).toEqual({ eventId: event.id });
    expect(JSON.stringify(toAna?.payloadJson)).not.toMatch(/token/i);
    expect(queued.find((row) => row.recipientEmail === "ion@example.ro")?.locale).toBe("en");
    // The address is kept only until the message is queued.
    expect(await rows(event.id)).toHaveLength(0);

    // The next run finds nothing to do.
    expect(await queueRegistrationOpenedMessages(db, new Date(OPENS_AT.getTime() + DAY))).toEqual({ queued: 0, dropped: 0 });
    const result = await runRegistrationMaintenance(db, new Date(OPENS_AT.getTime() + DAY));
    expect(result.interestsNotified).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(await outbox()).toHaveLength(2);
  });

  it("drops the rows of an event that will not open — cancelled, started, moved off the site — with no message", async () => {
    const cancelled = await seedEvent();
    await registerInterest(db, cancelled, form("ana@example.ro"), NOW);
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, cancelled.id));

    const started = await seedEvent();
    await registerInterest(db, started, form("ion@example.ro"), NOW);
    await db.update(events).set({ startsAt: new Date(NOW.getTime() + DAY), registrationClosesAt: null }).where(eq(events.id, started.id));

    const external = await seedEvent();
    await registerInterest(db, external, form("maria@example.ro"), NOW);
    await db.update(events).set({ registrationMode: "EXTERNAL", externalRegistrationUrl: "https://forms.example/x" }).where(eq(events.id, external.id));

    const waiting = await seedEvent();
    await registerInterest(db, waiting, form("dan@example.ro"), NOW);

    // The cancelled and the external one go at once; the started one goes when the start has passed.
    expect(await queueRegistrationOpenedMessages(db, NOW)).toEqual({ queued: 0, dropped: 2 });
    expect(await rows(cancelled.id)).toHaveLength(0);
    expect(await rows(external.id)).toHaveLength(0);
    expect(await rows(started.id)).toHaveLength(1);
    expect(await rows(waiting.id)).toHaveLength(1);
    // Its window "opens" in two days but it started the day before: closed, nothing to say —
    // while the one still waiting is announced by the same run.
    expect(await queueRegistrationOpenedMessages(db, OPENS_AT)).toEqual({ queued: 1, dropped: 1 });
    expect(await rows(started.id)).toHaveLength(0);
    expect((await outbox()).map((row) => row.recipientEmail)).toEqual(["dan@example.ro"]);
  });

  it("waits for an unpublished event and announces a published one", async () => {
    const draft = await seedEvent();
    await registerInterest(db, draft, form("ana@example.ro"), NOW);
    await db.update(events).set({ editorialStatus: "ARCHIVED" }).where(eq(events.id, draft.id));
    expect(await queueRegistrationOpenedMessages(db, OPENS_AT)).toEqual({ queued: 0, dropped: 0 });
    expect(await rows(draft.id)).toHaveLength(1);
    await db.update(events).set({ editorialStatus: "PUBLISHED" }).where(eq(events.id, draft.id));
    expect(await queueRegistrationOpenedMessages(db, OPENS_AT)).toEqual({ queued: 1, dropped: 0 });
  });

  it("renders the message with the event's facts and the registration page as the action, and no token", async () => {
    const event = await seedEvent();
    const [translation] = await db.select().from(eventTranslations).where(and(eq(eventTranslations.eventId, event.id), eq(eventTranslations.locale, "ro")));
    const message = await renderOutboxMessage(
      {
        id: "row",
        participantId: null,
        registrationId: null,
        messageType: "REGISTRATION_OPENED",
        locale: "ro",
        recipientEmail: "ana@example.ro",
        payloadJson: { eventId: event.id },
        idempotencyKey: "interest:x:opened",
        requestedByStaffUserId: null,
        isManualResend: false,
        status: "PROCESSING",
        attemptCount: 1,
        nextAttemptAt: null,
        lockedAt: OPENS_AT,
        providerMessageId: null,
        lastError: null,
        createdAt: OPENS_AT,
        sentAt: null,
      },
      db,
      OPENS_AT,
    );
    // The other half repeats the words with the same title, as every bilingual message does (§96).
    expect(message.subject).toBe("Înscrierile la Crosul s-au deschis / Registration for Crosul is open");
    expect(message.text).toContain("Parcul Tractorul");
    expect(message.text).toContain(`Înscrie-te: ${env.APP_BASE_URL}/ro/evenimente/${translation.slug}/inscriere`);
    expect(message.text).not.toMatch(/token/i);
    expect(message.text).not.toMatch(/\/inregistrari\//);
    expect(message.html).not.toContain("Salut, ,");
    expect(message.html).toContain("Salut,");
    // Below the header band, which carries the club lockup on every message (§174).
    expect(message.html.slice(message.html.indexOf("</div>") + 6)).not.toContain("<img");
  });
});
