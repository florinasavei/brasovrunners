import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { countEventThanksRecipients, sendEventThanks } from "@/modules/notifications/event-mail";
import { countEventNoticeRecipients, queueEventCancelledNotices, queueEventUpdateNotices } from "@/modules/notifications/event-notices";
import { PARTICIPANT_MESSAGE_AUDIENCES } from "@/modules/notifications/domain/organizer-message";
import { countParticipantMessageAudiences, sendParticipantMessage } from "@/modules/notifications/participant-messages";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §384 — "I need to know each time a participant will be emailed!"
 *
 * The confirmation dialog says "an email will be sent to N participants" from a count the page
 * read on the server, and the number has to be the number of rows the send then queues. Both
 * come from one query each — `countParticipantMessageAudiences` beside `sendParticipantMessage`,
 * `countEventNoticeRecipients` beside the cancellation and update notices, and
 * `countEventThanksRecipients` beside the thank-you — and this proves the pair agree, over a
 * queue that holds every status there is, a test row among them (counted apart, §12.6).
 */
describe("§384 the dialog's count is the send's recipients", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let organizer: StaffUser;

  const NOW = new Date("2026-10-08T07:30:00.000Z");
  const ZONE = "Europe/Bucharest";

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Dani", role: "MODERATOR" }).returning();
  });

  async function seedEvent(startsAt = new Date("2026-10-11T09:00:00+03:00")) {
    const [row] = await db
      .insert(events)
      .values({
        type: "RACE",
        surface: "ASPHALT",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
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
      { eventId: row.id, locale: "en", slug: `autumn-cross-${row.id.slice(0, 8)}`, title: "The autumn cross", excerpt: "Fast." },
    ]);
    return row;
  }

  type Seeded = { name: string; status: RegistrationStatus; kind?: "REAL" | "TEST"; checkedIn?: boolean };

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
        entries.map(({ name, status, kind, checkedIn }, index) => ({
          eventId,
          participantId: people[index].id,
          status,
          kind: kind ?? "REAL",
          locale: "ro" as const,
          registeredName: name,
          displayName: name,
          privacyNoticeVersion: 1,
          privacyAcknowledgedAt: NOW,
          raceId: null,
          resultsNameConsent: false,
          resultsConsentVersion: 1,
          waitlistedAt: status === "WAITLISTED" ? NOW : null,
          ...(status === "CANCELLED" ? { cancelledAt: NOW, cancellationSource: "PARTICIPANT" as const } : {}),
          ...(status === "EXPIRED" ? { expiredAt: NOW, expiryReason: "DECLARATION_HOLD_LAPSED" as const } : {}),
          ...(status === "PENDING_DECLARATION" || status === "WAITLIST_OFFERED" ? { holdExpiresAt: new Date(NOW.getTime() + 3_600_000) } : {}),
          ...(status === "WAITLIST_OFFERED" ? { offerCreatedAt: NOW } : {}),
          ...(status === "CONFIRMED" ? { confirmedAt: NOW } : {}),
          ...(checkedIn ? { checkedInAt: NOW } : {}),
        })),
      )
      .returning();
  }

  /** Every status there is, and a test row: the same queue `participant-messages.test.ts` reads. */
  const EVERYONE: readonly Seeded[] = [
    { name: "ana", status: "CONFIRMED", checkedIn: true },
    { name: "bogdan", status: "CONFIRMED" },
    { name: "carmen", status: "WAITLISTED" },
    { name: "dan", status: "WAITLIST_OFFERED" },
    { name: "elena", status: "PENDING_DECLARATION" },
    { name: "florin", status: "PENDING_EMAIL_CONFIRMATION" },
    { name: "gabi", status: "CANCELLED" },
    { name: "horia", status: "EXPIRED" },
    { name: "test", status: "CONFIRMED", kind: "TEST", checkedIn: true },
  ];

  const WORDS = { subject: { ro: "Vreme rea", en: "Bad weather" }, body: { ro: "Startul se mută.", en: "The start moves." } };

  it("a message to the participants: each group's count is exactly what the send queues", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, EVERYONE);
    const counts = await countParticipantMessageAudiences(db, event.id);
    for (const audience of PARTICIPANT_MESSAGE_AUDIENCES) {
      const result = await sendParticipantMessage(db, organizer, { eventId: event.id, audience, sendId: `00000000-0000-4000-8000-00000000000${PARTICIPANT_MESSAGE_AUDIENCES.indexOf(audience)}`, ...WORDS }, NOW);
      if (counts[audience].real + counts[audience].test === 0) {
        expect(result).toEqual({ kind: "nobody" });
        continue;
      }
      expect(result).toEqual({ kind: "queued", real: counts[audience].real, test: counts[audience].test });
    }
    // And the number the dialog states is the real one, which is not the whole queue.
    expect(counts.ALL_ACTIVE).toEqual({ real: 5, test: 1 });
  });

  it("a cancellation: the count beside the box is the number of real rows the notice reaches", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, EVERYONE);
    const counted = await countEventNoticeRecipients(db, event.id);
    const queued = await db.transaction((tx) =>
      queueEventCancelledNotices(tx, { eventId: event.id, saveKey: `${event.id}:v2`, reason: { ro: "Furtună.", en: "A storm." }, actorStaffUserId: organizer.id, now: NOW }),
    );
    expect(queued).toBe(counted.real);
    // The four states that hold or wait for a place, and the test row apart (§331).
    expect(counted).toEqual({ real: 5, test: 1 });
    // The rows themselves: one per active registration, test row included, counted apart.
    const rows = await db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "EVENT_CANCELLED"), isNotNull(emailOutbox.participantId)));
    expect(rows).toHaveLength(counted.real + counted.test);
  });

  it("an update notice: the same count, the same rows", async () => {
    const event = await seedEvent();
    await seedRegistrations(event.id, EVERYONE);
    const counted = await countEventNoticeRecipients(db, event.id);
    const queued = await db.transaction((tx) =>
      queueEventUpdateNotices(tx, { eventId: event.id, saveKey: `${event.id}:v3`, changes: ["place"], note: null, actorStaffUserId: organizer.id, now: NOW }),
    );
    expect(queued).toBe(counted.real);
  });

  it("the thank-you: the count is everyone checked in, which is who the send writes to", async () => {
    const event = await seedEvent(new Date("2026-10-01T09:00:00+03:00"));
    await seedRegistrations(event.id, EVERYONE);
    const counted = await countEventThanksRecipients(db, event.id);
    const [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    const sent = await sendEventThanks(db, admin, { eventId: event.id }, NOW);
    // The dialog states the real one; the test row is written to too, and named apart (§12.6).
    expect(counted).toEqual({ real: 1, test: 1 });
    expect(sent.recipients).toBe(counted.real + counted.test);
    // The toast and the banner flash `real`: the dialog's number, the test row in neither (§30).
    expect(sent.real).toBe(counted.real);
    expect(sent.test).toBe(counted.test);
    const rows = await db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "EVENT_THANKS"), isNotNull(emailOutbox.participantId)));
    expect(rows).toHaveLength(counted.real + counted.test);
  });
});
