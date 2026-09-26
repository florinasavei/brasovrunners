import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { requestMyRegistrationsLink } from "@/modules/registrations/my-registrations";
import { requestRegistrationLink, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * AGENTS.md §19.4 — the throttle's key for an email identity is a hash, never the address
 * (§322).
 *
 * The contact form hashed its bucket from the start; the registration form, the link request
 * and "Înscrierile mele" wrote the canonical address into `rate_limit_buckets` in plain text for
 * the day each row lives. The bucket needs equality and nothing else, so what is asserted is
 * that no row holds the address and that the two link-request doors still share one allowance.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

describe("AGENTS.md §19.4 throttle keys for an email identity", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  it("keys the link request on a hash, and both link doors share the one allowance", async () => {
    await requestRegistrationLink(db, { email: "Ana.Pop+x@Gmail.com" }, NOW);
    await requestMyRegistrationsLink(db, { email: "ana.pop@gmail.com", locale: "ro" }, NOW);

    const rows = await db.select().from(rateLimitBuckets);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(emailBucketKey("link-request", "ana.pop@gmail.com"));
    expect(rows[0].key).not.toContain("@");
    expect(rows[0].count).toBe(2);
  });

  it("keys the public registration form on a hash", async () => {
    const body = { sections: [{ paragraphs: ["p"] }] };
    const pair: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Document", body },
      { locale: "en", title: "Document", body },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(pair),
      translations: pair,
      now: NOW,
    });
    await insertLegalDocumentVersion(db, {
      key: "TERMS",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(pair),
      translations: pair,
      now: NOW,
    });
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: 10 })
      .returning();

    await submitRegistration(
      db,
      {
        id: event.id,
        eventStatus: event.eventStatus,
        registrationMode: "INTERNAL",
        startsAt: event.startsAt,
        registrationOpensAt: null,
        registrationClosesAt: null,
        confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
        confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
        capacity: 10,
        raceId: null,
        publishedAt: NOW,
      },
      {
        firstName: "Ana",
        lastName: "Pop",
        birthDate: "1990-05-17",
        sex: "UNSPECIFIED",
        phone: "+40711111111",
        emergencyContactName: "Ion Pop",
        emergencyContactPhone: "+40722222222",
        nationality: "RO",
        email: "ana@example.ro",
        locale: "ro",
        privacyAcknowledged: true,
        fitnessDeclared: true,
        termsAccepted: true,
        rulesAcknowledged: true,
        listOptOut: true,
        honeypot: "",
        renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
      },
      NOW,
    );

    const [row] = await db.select().from(rateLimitBuckets);
    expect(row.scope).toBe("registration-submit");
    expect(row.key).toBe(emailBucketKey("registration-submit", "ana@example.ro"));
    expect(row.key).not.toContain("ana");
  });
});
