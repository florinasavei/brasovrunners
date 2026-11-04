import { and, eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { NO_WAITLIST } from "@/modules/registrations/domain/waitlist";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { sendHoldEmails } from "../../helpers/outbox";

/**
 * «Locuri păstrate pentru club» (§914; BR-REQ-034-01, BR-REQ-034-02, BR-REQ-035-01) on a real database: a threshold on the
 * entry's channel inside the one allocator. A public entry takes a place only while fewer than `capacity − K` are taken,
 * the waiting list's automatic offers fill only up to that number, and every staff verb keeps the whole capacity — a kept
 * place given with no supplementary place while one is free. The capacity formula is untouched and `kind` is in no
 * condition. The public count, «Pe site acum» and «Locuri» say the site's places; nothing public names the reserve.
 *
 * The two-connection race over the threshold is `tests/concurrency/capacity.test.ts`; K only lowers the number a public
 * entry is compared with, so it adds no way past the capacity.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
}));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: () => undefined,
}));

const { confirmEmail, submitRegistration, readPublicPlaces, inviteToEventByStaff } = await import("@/modules/registrations/service");
const { cancelRegistrationByStaff, enterOnWaitlistByStaff, offerPlaceByStaff } = await import("@/modules/registrations/admin-service");
const { readPublicDoor } = await import("@/modules/registrations/public-now");
const { readPlaceOutlook } = await import("@/modules/registrations/admin-repository");
const { saveEventAndTranslations } = await import("@/modules/content/events/service");
const { default: PublicNowLine } = await import("@/modules/registrations/ui/PublicNowLine");
const { default: PlaceOutlook } = await import("@/modules/registrations/ui/PlaceOutlook");

const MINUTE = 60_000;
const NOW = new Date();
const STARTS = new Date(NOW.getTime() + 30 * 24 * 60 * MINUTE);
// Past the club's declaration hold (30 minutes) of a registration confirmed at NOW, or a minute after.
const AFTER_HOLD = new Date(NOW.getTime() + 33 * MINUTE);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let declarationId: string;

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    const id = await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
    if (key === "EVENT_DECLARATION") declarationId = id;
  }
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN", preferredLocale: "ro" }).returning();
});

/**
 * A published race thirty days off with `capacity` places, `kept` of them the club's. The caller's copy carries no
 * participation window, so a hold is the club's thirty minutes (§377); the allocator reads K off the locked row.
 */
async function createEvent(capacity: number | null, kept: number, over: Partial<typeof events.$inferInsert> = {}): Promise<EventInput> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: STARTS,
      registrationMode: "INTERNAL",
      capacity,
      placesKeptForClub: kept,
      waitlistAutoOffer: false,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      declarationDocumentId: declarationId,
      ...over,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  return {
    id: event.id,
    raceId: null,
    capacity: event.capacity,
    registrationMode: "INTERNAL",
    registrationOpensAt: null,
    registrationClosesAt: null,
    startsAt: event.startsAt,
    eventStatus: event.eventStatus,
    publishedAt: NOW,
  } as EventInput;
}

function publicSubmission(event: EventInput, name: string, at: Date = NOW) {
  return submitRegistration(
    db,
    event,
    {
      firstName: name,
      lastName: "Munteanu",
      birthDate: "1985-03-02",
      sex: "FEMALE",
      nationality: "RO",
      country: "RO",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Ion Vecinul",
      emergencyContactPhone: "+40722222222",
      email: `${name.toLowerCase()}@example.ro`,
      locale: "ro",
      privacyAcknowledged: true,
      fitnessDeclared: true,
      termsAccepted: true,
      rulesAcknowledged: true,
      resultsNameConsent: false,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(at.getTime() - 30_000).toISOString(),
    },
    at,
    "REAL",
    { source: "PUBLIC", createdByStaffUserId: null },
  );
}

async function rowOf(name: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return row;
}

/** The public form and its address confirmed: the allocator's decision for a public entry; the declaration email sent. */
async function publicEntry(event: EventInput, name: string, at: Date = NOW) {
  await publicSubmission(event, name, at);
  const confirmed = await confirmEmail(db, event, (await rowOf(name)).id, at);
  await sendHoldEmails(db, at);
  return confirmed;
}

/** «Adaugă pe lista de așteptare» (§872): a staff entry, vouched, through the same allocator. */
function staffEntry(eventId: string, name: string, at: Date = NOW) {
  return enterOnWaitlistByStaff(
    db,
    admin,
    { eventId, firstName: name, lastName: "Munteanu", email: `${name.toLowerCase()}@example.ro`, locale: "ro", relayedByParticipantRequest: true, offerNow: null },
    at,
  );
}

async function refusalFields(work: Promise<unknown>): Promise<readonly string[]> {
  try {
    await work;
  } catch (error) {
    if (isDomainError(error)) return error.fields;
    throw error;
  }
  throw new Error("expected a refusal");
}

const capacityOf = async (eventId: string) => (await db.select({ capacity: events.capacity }).from(events).where(eq(events.id, eventId)))[0].capacity;
const raises = (eventId: string) =>
  db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, eventId), eq(auditLogs.entityType, "event")))
    .then((rows) => rows.filter((row) => row.action.startsWith("event.capacity_raised")));

describe("BR-REQ-034-01 kept places in the allocator: the public stops at capacity − K, the staff keep the whole (§914)", () => {
  it("capacity 10, K 3: seven public places, then the waiting list — and a staff entry still takes a kept place while nobody waits", async () => {
    const event = await createEvent(10, 3);
    for (const name of ["Ana", "Bia", "Cora", "Dana", "Ema", "Fana", "Gina"]) {
      expect((await publicEntry(event, name)).status, name).toBe("PENDING_DECLARATION");
    }
    // The site's places are taken: the next public entry waits.
    const staffFirst = await createEvent(10, 3);
    for (const name of ["Hana", "Ina", "Jana", "Lia", "Mara", "Nina", "Oana"]) await publicEntry(staffFirst, name);
    // A staff entry takes a kept place while nobody waits (§615 untouched)…
    expect((await staffEntry(staffFirst.id, "Paula")).status).toBe("PENDING_DECLARATION");
    // …and the next public entry waits, beside two kept places still free.
    expect((await publicEntry(staffFirst, "Raluca")).status).toBe("WAITLISTED");
    // Once somebody waits, a staff entry queues behind them, as every newcomer does (§615, §872).
    expect((await staffEntry(staffFirst.id, "Sara")).status).toBe("WAITLISTED");
    // The first event: the eighth public entry waits.
    expect((await publicEntry(event, "Tina")).status).toBe("WAITLISTED");
    expect(await capacityOf(event.id)).toBe(10);
  });

  it("with no waiting list, the public entry past the threshold is refused like a full race and nothing is written; a staff entry takes a kept place", async () => {
    const event = await createEvent(3, 1, { waitlistCapacity: 0 });
    await publicEntry(event, "Ana");
    await publicEntry(event, "Bia");
    expect(await refusalFields(publicSubmission(event, "Cora"))).toEqual([NO_WAITLIST]);
    expect(await rowOf("Cora")).toBeUndefined();
    expect((await staffEntry(event.id, "Dana")).status).toBe("PENDING_DECLARATION");
  });

  it("«Trimite-i oferta» gives a kept place with no supplementary place: the capacity stays, no raise is written", async () => {
    const event = await createEvent(4, 1);
    for (const name of ["Ana", "Bia", "Cora"]) await publicEntry(event, name);
    expect((await publicEntry(event, "Dana")).status).toBe("WAITLISTED");
    const offered = await offerPlaceByStaff(db, admin, (await rowOf("Dana")).id, NOW, {});
    expect(offered).toMatchObject({ status: "WAITLIST_OFFERED", capacityRaisedTo: null });
    expect(await capacityOf(event.id)).toBe(4);
    expect(await raises(event.id)).toEqual([]);
  });

  it("an invitation takes a kept place with no supplementary place while the public line waits", async () => {
    const event = await createEvent(4, 1);
    for (const name of ["Ana", "Bia", "Cora"]) await publicEntry(event, name);
    expect((await publicEntry(event, "Dana")).status).toBe("WAITLISTED");
    const sent = await inviteToEventByStaff(db, event, { people: [{ name: "Elena Pace", email: "elena@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW);
    expect(sent.capacityRaisedTo).toBeNull();
    expect(await capacityOf(event.id)).toBe(4);
    // The next one finds no kept place left: it needs a confirmed supplementary place, as before (§642).
    const second = await refusalFields(
      inviteToEventByStaff(db, event, { people: [{ name: "Flavia Pace", email: "flavia@example.invalid" }], days: 7, outsideCapacity: false }, admin, NOW),
    );
    expect(second).toEqual(["SUPPLEMENTARY_PLACE_UNCONFIRMED"]);
  });

  it("«Da»: a place freed while the site's places are taken stays the club's; lowering K hands it to the line, audited", async () => {
    const event = await createEvent(4, 1, { waitlistAutoOffer: true });
    for (const name of ["Ana", "Bia", "Cora"]) await publicEntry(event, name);
    expect((await publicEntry(event, "Dana")).status).toBe("WAITLISTED");
    // The kept place, given by the staff: four of four taken.
    expect((await offerPlaceByStaff(db, admin, (await rowOf("Dana")).id, NOW, {})).status).toBe("WAITLIST_OFFERED");
    expect((await publicEntry(event, "Ema")).status).toBe("WAITLISTED");
    // Ana leaves: three taken, the site's three — the freed place is the club's again, nobody is offered it.
    await cancelRegistrationByStaff(db, admin, (await rowOf("Ana")).id, "", NOW);
    expect((await rowOf("Ema")).status).toBe("WAITLISTED");

    // K lowered to 0 in the editor: the site's places grow by one, offered at once (§147).
    const [row] = await db.select().from(events).where(eq(events.id, event.id));
    const ro = (await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, event.id))).find((t) => t.locale === "ro")!;
    const saved = await saveEventAndTranslations(db, {
      actor: admin,
      eventId: event.id,
      fields: {
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
        mapUrl: "",
        routeUrl: "",
        distanceMeters: "",
        elevationGainMeters: "",
        featured: false,
        registrationMode: row.registrationMode,
        participantListVisibility: "HIDDEN" as const,
        capacity: "4",
        placesKeptForClub: "",
        registrationOpensAtWallTime: "",
        registrationClosesAtWallTime: "",
        declarationDocumentId: row.declarationDocumentId ?? "",
        externalProvider: "",
        externalRegistrationUrl: "",
      },
      expectedVersion: row.version,
      translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: ro.title, excerpt: "", seoTitle: "", seoDescription: "" } }],
      acknowledgeLiveEdit: true,
      scope: "this",
      placesChangeReason: "  Locurile clubului s-au dat  ",
      now: NOW,
    });
    expect(saved.offered).toBe(1);
    expect((await rowOf("Ema")).status).toBe("WAITLIST_OFFERED");
    const [kept] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.places_kept_changed"));
    expect(kept).toMatchObject({ actorStaffUserId: admin.id, entityType: "event", entityId: event.id });
    expect(kept.metadataJson).toEqual({ from: 1, to: 0, via: "editor", reason: "Locurile clubului s-au dat", version: row.version + 1 });
    // The capacity did not move: no row of its own.
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.capacity_changed"))).toEqual([]);
  });

  it("§160: a lapsed hold goes for a public newcomer only while the club's places are not in use; a staff newcomer keeps the whole capacity", async () => {
    const event = await createEvent(3, 1, { waitlistCapacity: 0 });
    await publicEntry(event, "Ana");
    // A minute later, so the two deadlines are no tie: the oldest goes first.
    await publicEntry(event, "Bia", new Date(NOW.getTime() + MINUTE));
    // Both holds lapse. The site's room is 0: one goes for the next public newcomer, the oldest deadline first.
    expect((await publicEntry(event, "Cora", AFTER_HOLD)).status).toBe("PENDING_DECLARATION");
    expect((await rowOf("Ana")).status).toBe("EXPIRED");
    // The kept place, given by the staff while nobody waits: now the club's place is in use.
    expect((await staffEntry(event.id, "Dana", AFTER_HOLD)).status).toBe("PENDING_DECLARATION");
    // A public newcomer is refused — releasing Bia would only give the club its place back — and the page says full.
    expect((await readPublicPlaces(db, { id: event.id, capacity: 3, waitlistCapacity: 0 }, AFTER_HOLD)).availablePlaces).toBe(0);
    expect(await refusalFields(publicSubmission(event, "Ema", AFTER_HOLD))).toEqual([NO_WAITLIST]);
    expect((await rowOf("Bia")).status).toBe("PENDING_DECLARATION");
    // A staff newcomer wants a place under the whole capacity: Bia's lapsed hold goes for them.
    expect((await staffEntry(event.id, "Fana", AFTER_HOLD)).status).toBe("PENDING_DECLARATION");
    expect((await rowOf("Bia")).status).toBe("EXPIRED");
    expect(await capacityOf(event.id)).toBe(3);
  });
});

describe("BR-REQ-034-01 the door says «a place» exactly when the allocator gives one, kept places included (§914)", () => {
  /** Rows as the allocator would have left them: `held` confirmed, `lapsed` declaration holds past their deadline, `waiting` in the line. */
  async function seat(eventId: string, held: number, lapsed: number, waiting: number) {
    const rows = [
      ...Array.from({ length: held }, () => ({ status: "CONFIRMED" as const, holdExpiresAt: null, waitlistedAt: null })),
      ...Array.from({ length: lapsed }, () => ({ status: "PENDING_DECLARATION" as const, holdExpiresAt: new Date(NOW.getTime() - MINUTE), waitlistedAt: null })),
      ...Array.from({ length: waiting }, () => ({ status: "WAITLISTED" as const, holdExpiresAt: null, waitlistedAt: new Date(NOW.getTime() - MINUTE) })),
    ];
    for (const [index, row] of rows.entries()) {
      const address = `seated${index}.${eventId.slice(0, 8)}@example.ro`;
      const [person] = await db
        .insert(participants)
        .values({ deliveryEmail: address, normalizedEmail: address, canonicalEmail: address, canonicalizationVersion: 1, defaultName: `Seated ${index}` })
        .returning();
      await db.insert(registrations).values({
        eventId,
        participantId: person.id,
        locale: "ro",
        registeredName: `Seated ${index}`,
        displayName: `Seated ${index}`,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        ...row,
      });
    }
  }

  it("over capacity 3 × K × the places held × a lapsed hold × somebody waiting × a waiting list or none", async () => {
    let checked = 0;
    for (const kept of [0, 1]) {
      for (const held of [1, 2, 3]) {
        for (const lapsed of [0, 1]) {
          if (held + lapsed > 3) continue;
          for (const waiting of [0, 1]) {
            for (const limit of [null, 0]) {
              const event = await createEvent(3, kept, { waitlistCapacity: limit });
              await seat(event.id, held, lapsed, waiting);
              const places = await readPublicPlaces(db, { id: event.id, capacity: 3, waitlistCapacity: limit }, NOW);
              // The door's «Înscrie-te»: a free place and nobody waiting before the newcomer (§615).
              const doorSaysPlace = (places.availablePlaces ?? 0) > 0 && places.waitlisted === 0;
              const name = `Newcomer${checked}`;
              let given = false;
              try {
                given = (await publicEntry(event, name)).status === "PENDING_DECLARATION";
              } catch (error) {
                // Refused at the door like a full race (§348): no place given.
                if (!isDomainError(error)) throw error;
              }
              expect(given, `K ${kept}, held ${held}, lapsed ${lapsed}, waiting ${waiting}, limit ${limit}`).toBe(doorSaysPlace);
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBe(40);
  });
});

describe("BR-REQ-034-01 kept places on the public count, «Pe site acum» and «Locuri» (§914)", () => {
  async function line(eventId: string): Promise<string> {
    const door = await readPublicDoor(db, eventId, NOW);
    if (!door) throw new Error("no door");
    return renderToStaticMarkup(await PublicNowLine({ door, eventId, locale: "ro", listQuery: "" }))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  it("announces capacity − K, and says only the kept places are left once the site's are taken", async () => {
    const event = await createEvent(10, 3);
    for (const name of ["Ana", "Bia", "Cora", "Dana", "Ema"]) await publicEntry(event, name);
    expect(await readPublicPlaces(db, { id: event.id, capacity: 10, waitlistCapacity: null }, NOW)).toMatchObject({ availablePlaces: 2, announcedCapacity: 7, occupied: 5 });
    // Site places still free: nothing said of the kept ones on «Pe site acum».
    expect(await line(event.id)).not.toContain("păstrate pentru club");
    for (const name of ["Fana", "Gina"]) await publicEntry(event, name);
    expect(await readPublicPlaces(db, { id: event.id, capacity: 10, waitlistCapacity: null }, NOW)).toMatchObject({ availablePlaces: 0, announcedCapacity: 7 });
    expect(await line(event.id)).toContain("Pe site arată plin: au rămas doar cele 3 locuri păstrate pentru club.");
  });

  it("says nothing of the kept places beside a door closed for another reason", async () => {
    const paused = await createEvent(3, 1, { publicRegistrationOpen: false });
    for (const name of ["Ana", "Bia"]) await staffEntry(paused.id, name);
    expect(await line(paused.id)).not.toContain("păstrate pentru club");
  });

  it("«Locuri» splits the free places into the site's and the club's", async () => {
    const event = await createEvent(10, 3);
    for (const name of ["Ana", "Bia", "Cora", "Dana", "Ema"]) await publicEntry(event, name);
    const outlook = await readPlaceOutlook(db, event.id, NOW);
    expect(outlook).toMatchObject({ free: 5, publicFree: 2, keptFree: 3, kept: 3 });
    if (!outlook) throw new Error("no outlook");
    const text = renderToStaticMarkup(await PlaceOutlook({ outlook, locale: "ro" })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Din ele, pe site: 2; păstrate pentru club: 3 din 3, le dai doar tu.");
    // Nothing kept: no split line.
    const plain = await createEvent(10, 0);
    const none = await readPlaceOutlook(db, plain.id, NOW);
    if (!none) throw new Error("no outlook");
    expect(renderToStaticMarkup(await PlaceOutlook({ outlook: none, locale: "ro" }))).not.toContain("păstrate pentru club");
  });
});
