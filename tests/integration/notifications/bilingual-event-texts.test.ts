import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox, type EmailMessageType } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { findEventNotificationRows } from "@/modules/events/repository";
import { forgetCachedEmailCopy, updateEmailCopy } from "@/modules/notifications/email-copy";
import { processOutboxBatch } from "@/modules/notifications/outbox";
import { createOutboxRenderer, type EventRowsReader, renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §NNN (email follow-up; the owner, 2026-09-24: "multi-lingual, always") — the
 * second half of a bilingual message reads the other language's event texts.
 *
 * Found by the review of §354: every message carries both languages (§96), but the event's title,
 * "what to bring" and the place's own name were read once, in the registrant's language, so a
 * Romanian registrant's English half said "What to bring: Frontală și apă". Now both languages'
 * rows come from the one query the renderer already ran, read once per event per batch.
 */
const NOW = new Date("2026-10-09T09:00:00.000Z");

const RO = { title: "Crosul Tâmpei", checklist: "Frontală și apă", place: "Poalele Tâmpei" };
const EN = { title: "The Tâmpa Cross", checklist: "Headlamp and water", place: "The foot of Tâmpa" };

/** The plain-text body's two halves, the registrant's language first (§96). */
function halves(message: OutgoingEmail): [string, string] {
  const [first, second] = message.text.split("\n— — —\n");
  return [first, second];
}

function recordingSender(): EmailSender & { calls: OutgoingEmail[] } {
  const calls: OutgoingEmail[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      return { outcome: "sent", providerMessageId: `provider:${calls.length}` };
    },
  };
}

describe("§NNN each half of a bilingual message reads its own language's event texts", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let sequence = 0;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    forgetCachedEmailCopy();
  });

  async function seedEvent(translations: { locale: "ro" | "en"; title: string; checklist?: string | null; locationName?: string | null }[]) {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: new Date(NOW.getTime() + 40 * 60 * 60_000),
        registrationMode: "INTERNAL",
        // The event's own place, which a language without a name of its own reads (migration 0059).
        locationName: "Parcul Central",
      })
      .returning();
    await db.insert(eventTranslations).values(
      translations.map((translation) => ({
        eventId: event.id,
        locale: translation.locale,
        slug: `${translation.locale}-${event.id.slice(0, 8)}`,
        title: translation.title,
        checklist: translation.checklist ?? null,
        locationName: translation.locationName ?? null,
      })),
    );
    return event;
  }

  const bilingual = () =>
    seedEvent([
      { locale: "ro", title: RO.title, checklist: RO.checklist, locationName: RO.place },
      { locale: "en", title: EN.title, checklist: EN.checklist, locationName: EN.place },
    ]);

  async function queue(
    eventId: string,
    locale: "ro" | "en",
    messageType: EmailMessageType,
    payload: Record<string, unknown> = {},
    status: "CONFIRMED" | "WAITLISTED" = "CONFIRMED",
  ) {
    sequence += 1;
    const identity = canonicalizeEmail(`runner${sequence}@example.ro`);
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: `Runner ${sequence}`,
      })
      .returning();
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        status,
        locale,
        registeredName: `Runner ${sequence}`,
        displayName: `Runner ${sequence}`,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        confirmedAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60_000),
        bibNumber: 100 + sequence,
      })
      .returning();
    const [row] = await db
      .insert(emailOutbox)
      .values({
        participantId: participant.id,
        registrationId: registration.id,
        messageType,
        locale,
        recipientEmail: identity.deliveryEmail,
        payloadJson: payload,
        idempotencyKey: `bilingual:${sequence}`,
        createdAt: new Date(NOW.getTime() - 60_000 + sequence),
      })
      .returning();
    return { ...row, status: "PROCESSING" as const, attemptCount: 1, lockedAt: NOW };
  }

  it("gives a Romanian registrant's English half the English title, checklist and place", async () => {
    const event = await bilingual();
    const message = await renderOutboxMessage(await queue(event.id, "ro", "EVENT_REMINDER"), db, NOW);
    const [romanian, english] = halves(message);

    expect(romanian).toContain(RO.title);
    expect(romanian).toContain(`Ce să aduci: ${RO.checklist}`);
    expect(romanian).toContain(RO.place);
    expect(english).toContain(`${EN.title} is coming up.`);
    expect(english).toContain(`What to bring: ${EN.checklist}`);
    expect(english).toContain(EN.place);
    for (const romanianWords of [RO.title, RO.checklist, RO.place]) expect(english).not.toContain(romanianWords);
    for (const englishWords of [EN.title, EN.checklist, EN.place]) expect(romanian).not.toContain(englishWords);
  });

  it("and an English registrant's Romanian half the Romanian ones, the English half first", async () => {
    const event = await bilingual();
    const message = await renderOutboxMessage(await queue(event.id, "en", "EVENT_REMINDER"), db, NOW);
    const [english, romanian] = halves(message);

    expect(english).toContain(`What to bring: ${EN.checklist}`);
    expect(english).toContain(EN.place);
    expect(romanian).toContain(`${RO.title} se apropie.`);
    expect(romanian).toContain(`Ce să aduci: ${RO.checklist}`);
    expect(romanian).toContain(RO.place);
    for (const englishWords of [EN.title, EN.checklist, EN.place]) expect(romanian).not.toContain(englishWords);
  });

  it("puts the other language's title in the second subject, and leaves a subject without a title as it was", async () => {
    const event = await bilingual();
    const update = await renderOutboxMessage(await queue(event.id, "ro", "EVENT_UPDATE_NOTICE", { changes: ["place"] }), db, NOW);
    expect(update.subject).toBe(`Detalii actualizate pentru ${RO.title} / Updated details for ${EN.title}`);
    // "Locul de întâlnire este acum: …" names each half's own place too (§331).
    const [romanian, english] = halves(update);
    expect(romanian).toContain(`Locul de întâlnire este acum: ${RO.place}.`);
    expect(english).toContain(`The meeting point is now: ${EN.place}.`);

    const confirmed = await renderOutboxMessage(await queue(event.id, "en", "REGISTRATION_CONFIRMED"), db, NOW);
    expect(confirmed.subject).toBe("Your registration is confirmed / Înscrierea este confirmată");
  });

  it("says a checklist written in one language only in that half, and never in the other", async () => {
    const event = await seedEvent([
      { locale: "ro", title: RO.title, checklist: RO.checklist },
      { locale: "en", title: EN.title, checklist: null },
    ]);
    const [romanian, english] = halves(await renderOutboxMessage(await queue(event.id, "ro", "REGISTRATION_CONFIRMED"), db, NOW));
    expect(romanian).toContain(`Ce să aduci: ${RO.checklist}`);
    expect(english).not.toContain("What to bring");
    expect(english).not.toContain(RO.checklist);
    // A language with no place name of its own reads the event's (migration 0059), in both halves.
    expect(romanian).toContain("Parcul Central");
    expect(english).toContain("Parcul Central");
  });

  it("leaves an event written in one language only as it was: both halves read that language", async () => {
    const event = await seedEvent([{ locale: "ro", title: RO.title, checklist: RO.checklist, locationName: RO.place }]);
    const message = await renderOutboxMessage(await queue(event.id, "en", "EVENT_REMINDER"), db, NOW);
    const [english, romanian] = halves(message);
    // The English registrant's own half falls back to the only text there is, as it always did.
    expect(english).toContain(`${RO.title} is coming up.`);
    expect(english).toContain(`What to bring: ${RO.checklist}`);
    expect(romanian).toContain(`${RO.title} se apropie.`);
    expect(romanian).toContain(RO.place);
  });

  it("fills the club's own words for the other language with that language's values", async () => {
    const [copywriter] = await db
      .insert(staffUsers)
      .values({ email: "copywriter@dev.test", displayName: "Redactor", role: "COPYWRITER" })
      .returning();
    await updateEmailCopy(
      db,
      copywriter,
      {
        messageType: "REGISTRATION_CONFIRMED",
        locale: "en",
        entry: { subject: "Confirmed: {eventTitle}", paragraphs: ["See you at {eventTitle}, {eventLocationName}.", "Bring {eventChecklist}."] },
      },
      NOW,
    );
    const event = await bilingual();
    const message = await renderOutboxMessage(await queue(event.id, "ro", "REGISTRATION_CONFIRMED"), db, NOW);
    expect(message.subject).toBe(`Înscrierea este confirmată / Confirmed: ${EN.title}`);
    const [romanian, english] = halves(message);
    expect(english).toContain(`See you at ${EN.title}, ${EN.place}.`);
    expect(english).toContain(`Bring ${EN.checklist}.`);
    expect(romanian).toContain(`Înscrierea ta la ${RO.title} este confirmată.`);
  });

  it("reads each event's texts once per batch, not once per message", async () => {
    const race = await bilingual();
    const other = await seedEvent([
      { locale: "ro", title: "Alergarea de luni", checklist: null },
      { locale: "en", title: "The Monday run", checklist: null },
    ]);
    for (const locale of ["ro", "en", "ro"] as const) await queue(race.id, locale, "WAITLIST_JOINED");
    await queue(other.id, "en", "WAITLIST_JOINED");

    const reads: string[] = [];
    const counting: EventRowsReader = async (database, eventId) => {
      reads.push(eventId);
      return findEventNotificationRows(database, eventId);
    };
    const sender = recordingSender();
    const summary = await processOutboxBatch(db, { sender, render: createOutboxRenderer({ readEventRows: counting }), now: NOW });

    expect(summary.sent).toBe(4);
    // Two events, two reads — for four messages, each carrying both languages.
    expect([...reads].sort()).toEqual([race.id, other.id].sort());
    const subjects = sender.calls.map((call) => call.subject);
    expect(subjects.filter((subject) => subject.includes(EN.title))).toHaveLength(0);
    expect(sender.calls.filter((call) => call.text.includes(RO.title) && call.text.includes(EN.title))).toHaveLength(3);
    expect(sender.calls.filter((call) => call.text.includes("Alergarea de luni") && call.text.includes("The Monday run"))).toHaveLength(1);
  });

  it("writes {currentStatus} in the reader's own words, never the raw enum (§NNN, email follow-up review)", async () => {
    const event = await bilingual();
    const confirmedRo = await renderOutboxMessage(await queue(event.id, "ro", "REGISTRATION_STATE_NOTICE", {}, "CONFIRMED"), db, NOW);
    expect(confirmedRo.text).toContain("confirmată");
    expect(confirmedRo.text).not.toContain("CONFIRMED");

    const confirmedEn = await renderOutboxMessage(await queue(event.id, "en", "REGISTRATION_STATE_NOTICE", {}, "CONFIRMED"), db, NOW);
    expect(confirmedEn.text).toContain("confirmed");
    expect(confirmedEn.text).not.toContain("CONFIRMED");

    const waitlistedRo = await renderOutboxMessage(await queue(event.id, "ro", "REGISTRATION_STATE_NOTICE", {}, "WAITLISTED"), db, NOW);
    expect(waitlistedRo.text).toContain("pe lista de așteptare");
    expect(waitlistedRo.text).not.toContain("WAITLISTED");

    const waitlistedEn = await renderOutboxMessage(await queue(event.id, "en", "REGISTRATION_STATE_NOTICE", {}, "WAITLISTED"), db, NOW);
    expect(waitlistedEn.text).toContain("on the waiting list");
    expect(waitlistedEn.text).not.toContain("WAITLISTED");
  });

  it("asks again after a read that failed, rather than failing the rest of the batch with it", async () => {
    const race = await bilingual();
    await queue(race.id, "ro", "WAITLIST_JOINED");
    await queue(race.id, "en", "WAITLIST_JOINED");

    let calls = 0;
    const flaky: EventRowsReader = async (database, eventId) => {
      calls += 1;
      if (calls === 1) throw new Error("connection reset");
      return findEventNotificationRows(database, eventId);
    };
    const summary = await processOutboxBatch(db, { sender: recordingSender(), render: createOutboxRenderer({ readEventRows: flaky }), now: NOW });

    // The first render fails (a render failure is final, `AGENTS.md` §16.1); the second reads again and sends.
    expect(summary.failed).toBe(1);
    expect(summary.sent).toBe(1);
    expect(calls).toBe(2);
    const failed = await db.select().from(emailOutbox).where(eq(emailOutbox.status, "FAILED"));
    expect(failed).toHaveLength(1);
  });
});
