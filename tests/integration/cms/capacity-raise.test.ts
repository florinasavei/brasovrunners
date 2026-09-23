import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { repeatEvent, saveEventAndTranslations, type SeriesEditScope } from "@/modules/content/events/service";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { confirmEmail, type EventForRegistration, signDeclaration, submitRegistration } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-034-02 criterion 5 (`DECISIONS.md` §147) — a higher capacity saved in the editor
 * offers the new places to the waiting list at once, in the save's own transaction, through
 * the one allocator; the save reports how many. Criterion 3 still holds while an offer stands,
 * a save that is not a raise never reaches the allocator, a cancelled event offers nothing,
 * and a refused series save rolls the source's offers back with it.
 */
describe("BR-REQ-034-02 criterion 5 a raised capacity offers places to the waiting list", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let editor: StaffUser;
  let declarationId: string;

  /** The day of the save; the event is three weeks off and registration is open. */
  const NOW = new Date("2026-09-19T10:00:00.000Z");
  const ZONE = "Europe/Bucharest";
  const HOUR = 3_600_000;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "moderator@dev.test", displayName: "Editor", role: "ADMIN" })
      .returning();
    const privacy: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(privacy),
      translations: privacy,
      now: NOW,
    });
    const declaration: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Declar."] }] } },
      { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I declare."] }] } },
    ];
    declarationId = await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(declaration),
      translations: declaration,
      now: NOW,
    });
  });

  /** A race on 11 Oct with `capacity` places, registration open since yesterday. */
  async function seedEvent(capacity: number) {
    const [row] = await db
      .insert(events)
      .values({
        type: "RACE",
        surface: "ASPHALT",
        startsAt: new Date("2026-10-11T08:00:00+03:00"),
        endsAt: new Date("2026-10-11T09:30:00+03:00"),
        timezone: ZONE,
        locationName: "Parcul Tractorul",
        registrationMode: "INTERNAL",
        capacity,
        registrationOpensAt: new Date("2026-09-18T08:00:00+03:00"),
        registrationClosesAt: new Date("2026-10-11T07:00:00+03:00"),
        declarationDocumentId: declarationId,
        publishedAt: NOW,
        editorialStatus: "PUBLISHED",
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: row.id, locale: "ro", slug: "cursa-de-toamna", title: "Cursa de toamnă", excerpt: "Rapid." },
      { eventId: row.id, locale: "en", slug: "autumn-race", title: "Autumn race", excerpt: "Fast." },
    ]);
    return row;
  }

  const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
  const registrationsOf = (eventId: string) =>
    db.select().from(registrations).where(eq(registrations.eventId, eventId)).orderBy(asc(registrations.createdAt), asc(registrations.id));
  const statusOf = async (eventId: string, registrationId: string) => (await registrationsOf(eventId)).find((r) => r.id === registrationId)?.status;
  const offersQueued = async () => (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "WAITLIST_SPOT_OFFER"))).length;

  /** The row as the allocator reads it. */
  const eventFor = (row: typeof events.$inferSelect): EventForRegistration => ({
    id: row.id,
    eventStatus: row.eventStatus,
    registrationMode: row.registrationMode,
    startsAt: row.startsAt,
    registrationOpensAt: row.registrationOpensAt,
    registrationClosesAt: row.registrationClosesAt,
    confirmationOpensDaysBefore: row.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: row.confirmationDeadlineDaysBefore,
    capacity: row.capacity,
    raceId: row.raceId,
    publishedAt: row.publishedAt,
  });

  /** One person through the form and the email link — a place, or the waiting list; `sign` takes the place. */
  async function enter(row: typeof events.$inferSelect, name: string, at: Date, sign = false) {
    const event = eventFor(row);
    const known = new Set((await registrationsOf(row.id)).map((r) => r.id));
    await submitRegistration(
      db,
      event,
      {
        firstName: name,
        lastName: "Pop",
        birthDate: "1990-05-17",
        sex: "UNSPECIFIED",
        nationality: "RO",
        city: "Brașov",
        phone: "+40711111111",
        emergencyContactName: "Contact Urgență",
        emergencyContactPhone: "+40722222222",
        email: `${name.toLowerCase()}@example.ro`,
        locale: "ro",
        privacyAcknowledged: true,
        fitnessDeclared: true,
        rulesAcknowledged: true,
        resultsNameConsent: true,
        listOptOut: false,
        honeypot: "",
        renderedAt: new Date(at.getTime() - 10_000).toISOString(),
      },
      at,
    );
    const created = (await registrationsOf(row.id)).find((r) => !known.has(r.id))!;
    const confirmed = await confirmEmail(db, event, created.id, at);
    if (sign) return signDeclaration(db, event, confirmed.id, await signingInput(db, at, `${name} Pop`), at);
    return confirmed;
  }

  /** Rows as the allocator would have left them, for dates whose registration is not open yet. */
  async function seedRows(entries: ReadonlyArray<{ eventId: string; name: string; status: "CONFIRMED" | "WAITLISTED" }>) {
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
        entries.map(({ eventId, name, status }, index) => ({
          eventId,
          participantId: people[index].id,
          status,
          locale: "ro" as const,
          registeredName: name,
          displayName: name,
          privacyNoticeVersion: 1,
          privacyAcknowledgedAt: NOW,
          raceId: null,
          resultsNameConsent: false,
          resultsConsentVersion: 1,
          waitlistedAt: status === "WAITLISTED" ? NOW : null,
        })),
      )
      .returning();
  }

  /** The editor's form for the row, as posted, with the changes given. */
  const formFor = (row: typeof events.$inferSelect, changes: Record<string, unknown> = {}) => ({
    type: row.type,
    eventStatus: row.eventStatus,
    timezone: row.timezone,
    startsAtWallTime: toWallTimeInput(row.startsAt, row.timezone),
    endsAtWallTime: toWallTimeInput(row.endsAt, row.timezone),
    raceStartsAtWallTime: "",
    locationName: row.locationName ?? "",
    locationAddress: "",
    surface: row.surface,
    difficulty: null,
    costType: null,
    mapUrl: row.mapUrl ?? "",
    routeUrl: "",
    distanceMeters: "",
    elevationGainMeters: "",
    featured: false,
    registrationMode: row.registrationMode,
    participantListVisibility: "HIDDEN" as const,
    capacity: row.capacity === null ? "" : String(row.capacity),
    registrationOpensAtWallTime: toWallTimeInput(row.registrationOpensAt, row.timezone),
    registrationClosesAtWallTime: toWallTimeInput(row.registrationClosesAt, row.timezone),
    declarationDocumentId: row.declarationDocumentId ?? "",
    externalProvider: "",
    externalRegistrationUrl: "",
    ...changes,
  });

  /** The editor's save with the changes given; `capacity: ""` lifts the cap. */
  async function save(id: string, changes: Record<string, unknown>, at: Date, scope: SeriesEditScope = "this") {
    const row = await reload(id);
    const ro = (await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, id))).find((t) => t.locale === "ro")!;
    return saveEventAndTranslations(db, {
      actor: editor,
      eventId: id,
      fields: formFor(row, changes),
      expectedVersion: row.version,
      translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: ro.title, excerpt: ro.excerpt ?? "", seoTitle: "", seoDescription: "" } }],
      acknowledgeLiveEdit: true,
      scope,
      // A save that cancels says why (§NNN); these tests are about the offers, so nobody is told.
      ...(changes.eventStatus === "CANCELLED" && row.eventStatus !== "CANCELLED" ? { cancellation: { reason: "Ploaie torențială.", notify: false } } : {}),
      now: at,
    });
  }
  const saveCapacity = (id: string, capacity: string, at: Date, scope: SeriesEditScope = "this") => save(id, { capacity }, at, scope);

  /** The save's refusal, as a domain error code, or undefined when it went through. */
  async function refusalOf(attempt: Promise<unknown>) {
    try {
      await attempt;
      return undefined;
    } catch (caught) {
      return isDomainError(caught) ? caught.code : caught;
    }
  }

  it("offers the new place to the first in line, once, and still refuses a number below the places taken", async () => {
    const row = await seedEvent(1);
    const ana = await enter(row, "Ana", NOW, true);
    expect(ana.status).toBe("CONFIRMED");
    const bogdan = await enter(row, "Bogdan", new Date(NOW.getTime() + 1000));
    expect(bogdan.status).toBe("WAITLISTED");
    expect(await offersQueued()).toBe(0);

    // One more place: Bogdan is offered it in the same save, with his email queued.
    const raisedAt = new Date(NOW.getTime() + 60_000);
    const raised = await saveCapacity(row.id, "2", raisedAt);
    expect(raised).toEqual({ appliedTo: 0, offered: 1 });
    expect((await reload(row.id)).capacity).toBe(2);
    const offered = (await registrationsOf(row.id)).find((r) => r.id === bogdan.id)!;
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect(offered.offerCreatedAt).toEqual(raisedAt);
    expect(offered.holdExpiresAt).toEqual(new Date(raisedAt.getTime() + 24 * HOUR));
    expect(await offersQueued()).toBe(1);

    // The same number again offers nothing and queues nothing.
    expect(await saveCapacity(row.id, "2", new Date(raisedAt.getTime() + 1000))).toEqual({ appliedTo: 0, offered: 0 });
    expect(await offersQueued()).toBe(1);

    // Criterion 3: the offer holds a place, so 1 is below the two places taken.
    expect(await refusalOf(saveCapacity(row.id, "1", new Date(raisedAt.getTime() + 2000)))).toBe("VALIDATION_ERROR");
    expect((await reload(row.id)).capacity).toBe(2);
  });

  it("a save that is not a raise never reaches the allocator: a lapsed offer stays for the job, the next in line stays waiting", async () => {
    const row = await seedEvent(1);
    await enter(row, "Ana", NOW, true);
    const bogdan = await enter(row, "Bogdan", new Date(NOW.getTime() + 1000));
    const carmen = await enter(row, "Carmen", new Date(NOW.getTime() + 2000));
    const raisedAt = new Date(NOW.getTime() + 60_000);
    expect((await saveCapacity(row.id, "2", raisedAt)).offered).toBe(1);
    expect(await statusOf(row.id, bogdan.id)).toBe("WAITLIST_OFFERED");

    // A day and an hour later Bogdan's offer has lapsed and Carmen is next. The allocator, if
    // asked, would expire him and offer her; the same number saved again asks it nothing.
    const later = new Date(raisedAt.getTime() + 25 * HOUR);
    expect(await save(row.id, { capacity: "2", locationName: "Parcul Tractorul, la lac" }, later)).toEqual({ appliedTo: 0, offered: 0 });
    expect(await statusOf(row.id, bogdan.id)).toBe("WAITLIST_OFFERED");
    expect(await statusOf(row.id, carmen.id)).toBe("WAITLISTED");
    expect(await offersQueued()).toBe(1);
  });

  it("offers in order and only as many as the raise adds; a lifted cap offers to everyone waiting", async () => {
    const row = await seedEvent(1);
    await enter(row, "Ana", NOW, true);
    const bogdan = await enter(row, "Bogdan", new Date(NOW.getTime() + 1000));
    const carmen = await enter(row, "Carmen", new Date(NOW.getTime() + 2000));
    const dan = await enter(row, "Dan", new Date(NOW.getTime() + 3000));
    expect([bogdan.status, carmen.status, dan.status]).toEqual(["WAITLISTED", "WAITLISTED", "WAITLISTED"]);

    // Two more places: the first two in line, not the third.
    expect((await saveCapacity(row.id, "3", new Date(NOW.getTime() + 60_000))).offered).toBe(2);
    const afterRaise = await registrationsOf(row.id);
    expect(afterRaise.find((r) => r.id === bogdan.id)?.status).toBe("WAITLIST_OFFERED");
    expect(afterRaise.find((r) => r.id === carmen.id)?.status).toBe("WAITLIST_OFFERED");
    expect(afterRaise.find((r) => r.id === dan.id)?.status).toBe("WAITLISTED");

    // No cap at all: whoever is still waiting is offered a place.
    expect((await saveCapacity(row.id, "", new Date(NOW.getTime() + 120_000))).offered).toBe(1);
    expect((await reload(row.id)).capacity).toBeNull();
    expect((await registrationsOf(row.id)).find((r) => r.id === dan.id)?.status).toBe("WAITLIST_OFFERED");
    expect(await offersQueued()).toBe(3);
  });

  it("cancelled and widened in the same save, the event offers nothing: nobody is invited to a race that will not run", async () => {
    const row = await seedEvent(1);
    await enter(row, "Ana", NOW, true);
    const bogdan = await enter(row, "Bogdan", new Date(NOW.getTime() + 1000));
    expect(bogdan.status).toBe("WAITLISTED");

    expect(await save(row.id, { capacity: "", eventStatus: "CANCELLED" }, new Date(NOW.getTime() + 60_000))).toMatchObject({ appliedTo: 0, offered: 0 });
    const cancelled = await reload(row.id);
    expect(cancelled.eventStatus).toBe("CANCELLED");
    expect(cancelled.capacity).toBeNull();
    expect(await statusOf(row.id, bogdan.id)).toBe("WAITLISTED");
    expect(await offersQueued()).toBe(0);

    // A raise on an event already cancelled offers nothing either.
    expect(await save(row.id, { capacity: "5" }, new Date(NOW.getTime() + 120_000))).toEqual({ appliedTo: 0, offered: 0 });
    expect(await statusOf(row.id, bogdan.id)).toBe("WAITLISTED");
    expect(await offersQueued()).toBe(0);
  });

  it("raised for every date of a series, each date offers its own new places to its own line", async () => {
    const source = await seedEvent(1);
    await repeatEvent(db, { actor: editor, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    expect(dates).toHaveLength(3);

    // The source and the second date: one place taken, one person waiting on each; the
    // other dates have nobody. Rows inserted as the allocator would have left them — the
    // later dates' registration is not open yet, so the form cannot be used for them.
    await seedRows([
      { eventId: source.id, name: "ana", status: "CONFIRMED" },
      { eventId: source.id, name: "bogdan", status: "WAITLISTED" },
      { eventId: dates[1].id, name: "carmen", status: "CONFIRMED" },
      { eventId: dates[1].id, name: "dan", status: "WAITLISTED" },
    ]);

    const result = await saveCapacity(source.id, "2", new Date(NOW.getTime() + 60_000), "all");
    expect(result).toEqual({ appliedTo: 3, offered: 2 });
    for (const id of [source.id, ...dates.map((d) => d.id)]) expect((await reload(id)).capacity).toBe(2);
    const statuses = async (eventId: string) => (await registrationsOf(eventId)).map((r) => r.status).sort();
    expect(await statuses(source.id)).toEqual(["CONFIRMED", "WAITLIST_OFFERED"]);
    expect(await statuses(dates[1].id)).toEqual(["CONFIRMED", "WAITLIST_OFFERED"]);
    expect(await offersQueued()).toBe(2);
  });

  it("one date of the series too full refuses the whole save, and the source's offers go back with it", async () => {
    const source = await seedEvent(1);
    await repeatEvent(db, { actor: editor, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));

    // One waiting on the source; three places already taken on the second date, by hand.
    const [, bogdan] = await seedRows([
      { eventId: source.id, name: "ana", status: "CONFIRMED" },
      { eventId: source.id, name: "bogdan", status: "WAITLISTED" },
      { eventId: dates[1].id, name: "carmen", status: "CONFIRMED" },
      { eventId: dates[1].id, name: "dan", status: "CONFIRMED" },
      { eventId: dates[1].id, name: "elena", status: "CONFIRMED" },
    ]);

    // Two places is a raise on the source and below the three taken on the second date: the
    // source's offer was made first, inside the transaction, and is undone with the number.
    expect(await refusalOf(saveCapacity(source.id, "2", new Date(NOW.getTime() + 60_000), "all"))).toBe("VALIDATION_ERROR");
    expect((await reload(source.id)).capacity).toBe(1);
    expect(await statusOf(source.id, bogdan.id)).toBe("WAITLISTED");
    expect(await offersQueued()).toBe(0);
  });
});
