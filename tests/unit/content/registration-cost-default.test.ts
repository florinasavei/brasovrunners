import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { eq } from "drizzle-orm";
import { createEvent, saveEventFields } from "@/modules/content/events/service";
import { initialCostTypeOf } from "@/modules/content/events/ui/box-summaries";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §398 — the owner, 2026-09-25: "by default toate evenimentele sunt gratuite". A new event's
 * cost select preselects `FREE` (`initialCostTypeOf`, tested on its own in
 * `box-summaries.test.ts`); this checks that `CostBox` (the cost's own card since §NNN) actually reads the select's
 * `defaultValue`, and `CostFields`' visibility switch, off that one function — so the create
 * page and the closed summary can never drift apart on what "default" means.
 *
 * A save that never opens the box still writes `FREE`: the select is a real form control inside
 * the box's `<details>`, and a closed `<details>` still submits what is inside it (unlike a box
 * hidden by `OnlyForType`/`OnlyForMode`, which the service has to ignore on purpose). No schema
 * or column change was needed — `content/events/fields.ts#costType` already accepts a real
 * enum value; only the form's own default was missing.
 */
const SOURCE = readFileSync(path.join(process.cwd(), "src", "modules", "content", "events", "ui", "boxes", "CostBox.tsx"), "utf8");

describe("§398 a new event starts free", () => {
  it("computes the box's cost value with initialCostTypeOf, not straight off the event", () => {
    expect(SOURCE).toContain("const initialCostType = initialCostTypeOf(event);");
  });

  it("preselects the cost select off that value", () => {
    expect(SOURCE).toMatch(/name="event\.costType"[\s\S]{0,300}defaultValue=\{initialCostType\}/);
  });

  it("keeps CostFields' shown/hidden switch and the closed line off the same value", () => {
    expect(SOURCE).toContain("initialCostType={initialCostType}");
    expect(SOURCE).toMatch(/costAmount = initialCostType === "PAID" \|\| initialCostType === "DONATION"/);
    expect(SOURCE).toMatch(/costLabel = initialCostType\s*\?/);
  });
});

describe("§398 initialCostTypeOf agrees with RegistrationBox's use of it", () => {
  it("FREE on create, kept as typed on an edit — including an unstated cost", () => {
    expect(initialCostTypeOf(null)).toBe("FREE");
    expect(initialCostTypeOf({ costType: null })).toBe("");
    expect(initialCostTypeOf({ costType: "PAID" })).toBe("PAID");
  });
});

/**
 * §398 — the "saved value" half, proven through the create service rather than by reading
 * `RegistrationBox`'s source: a create posted with `costType` omitted — what a form that never
 * renders the box (or a caller that never mentions it) would post — writes `FREE` on its own,
 * because the service now defaults it on create; the row reads back `FREE`, not null and not
 * the DB column's own default. A second case proves an edit given the same omission is not
 * touched: the service only defaults on create, never on save.
 */
describe("§398 a create that never opens the cost box saves FREE, and reads back FREE", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "superadmin@dev.test", displayName: "Admin", role: "ADMIN" })
      .returning();
  });

  it("stores FREE off a create that posts the closed box's own default, no amount, no link", async () => {
    const created = await createEvent(db, {
      actor: admin,
      fields: {
        type: "GROUP_RUN",
        eventStatus: "SCHEDULED",
        timezone: "Europe/Bucharest",
        startsAtWallTime: "2026-10-18T18:00",
        endsAtWallTime: "",
        raceStartsAtWallTime: "",
        locationName: "Parcul Tractorul",
        locationAddress: "",
        surface: null,
        difficulty: null,
        mapUrl: "",
        routeUrl: "",
        distanceMeters: "",
        elevationGainMeters: "",
        featured: false,
        registrationMode: "NONE",
        participantListVisibility: "HIDDEN",
        capacity: "",
        registrationOpensAtWallTime: "",
        registrationClosesAtWallTime: "",
        declarationDocumentId: "",
        externalProvider: "",
        externalRegistrationUrl: "",
        // `costType` genuinely absent — no key at all, not even `null` — the same as
        // `costAmount`/`costUrl` when a caller is not editing the cost fields. This proves the
        // service's own create-time default, not merely that it stores what it was given.
        costAmount: "",
        costUrl: "",
        translations: {
          ro: { slug: "alergare-libera", title: "Alergare liberă", excerpt: "Kilometri împreună." },
          en: { slug: "free-run", title: "Free run", excerpt: "Kilometres together." },
        },
      },
    });

    const [row] = await db.select().from(events).where(eq(events.id, created.id));
    expect(row.costType).toBe("FREE");
    expect(row.costAmount).toBeNull();
    expect(row.costUrl).toBeNull();
  });

  it("leaves a saved cost type alone when a save posts no cost type", async () => {
    const created = await createEvent(db, {
      actor: admin,
      fields: {
        type: "GROUP_RUN",
        eventStatus: "SCHEDULED",
        timezone: "Europe/Bucharest",
        startsAtWallTime: "2026-10-18T18:00",
        endsAtWallTime: "",
        raceStartsAtWallTime: "",
        locationName: "Parcul Tractorul",
        locationAddress: "",
        surface: null,
        difficulty: null,
        mapUrl: "",
        routeUrl: "",
        distanceMeters: "",
        elevationGainMeters: "",
        featured: false,
        registrationMode: "NONE",
        participantListVisibility: "HIDDEN",
        capacity: "",
        registrationOpensAtWallTime: "",
        registrationClosesAtWallTime: "",
        declarationDocumentId: "",
        externalProvider: "",
        externalRegistrationUrl: "",
        costType: "PAID",
        costAmount: "50 RON",
        costUrl: "",
        translations: {
          ro: { slug: "cursa-cu-plata", title: "Cursă cu plată", excerpt: "Kilometri împreună." },
          en: { slug: "paid-race", title: "Paid race", excerpt: "Kilometres together." },
        },
      },
    });

    const saved = await saveEventFields(db, {
      actor: admin,
      eventId: created.id,
      expectedVersion: created.version,
      fields: {
        type: "GROUP_RUN",
        eventStatus: "SCHEDULED",
        timezone: "Europe/Bucharest",
        startsAtWallTime: "2026-10-18T18:00",
        endsAtWallTime: "",
        raceStartsAtWallTime: "",
        locationName: "Parcul Tractorul",
        locationAddress: "",
        surface: null,
        difficulty: null,
        mapUrl: "",
        routeUrl: "",
        distanceMeters: "",
        elevationGainMeters: "",
        featured: false,
        registrationMode: "NONE",
        participantListVisibility: "HIDDEN",
        capacity: "",
        registrationOpensAtWallTime: "",
        registrationClosesAtWallTime: "",
        declarationDocumentId: "",
        externalProvider: "",
        externalRegistrationUrl: "",
        // No cost type posted — genuinely absent, an edit that never opens the cost box, or a
        // caller that does not touch it. The service must not treat this as "make it FREE" the
        // way create does, nor as "clear it": the stored value stays exactly as it was.
        costAmount: "",
        costUrl: "",
      },
    });

    const [row] = await db.select().from(events).where(eq(events.id, saved.id));
    expect(row.costType).toBe("PAID");
  });
});

/**
 * §398 — a regression test: `eventColumnsFrom` (the one place create and save both build the
 * `events` columns through) dropped `difficulty: fields.difficulty` while adding the cost-type
 * default above it, so a create silently stored `null` and a save never changed a difficulty
 * the club picked, though nothing refused it — the column is nullable, so typecheck stayed
 * clean and nothing else caught it. This proves both paths read HARD back.
 */
describe("§398 a picked difficulty survives create and save", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "superadmin@dev.test", displayName: "Admin", role: "ADMIN" })
      .returning();
  });

  it("a create posting HARD stores and reads back HARD", async () => {
    const created = await createEvent(db, {
      actor: admin,
      fields: {
        type: "GROUP_RUN",
        eventStatus: "SCHEDULED",
        timezone: "Europe/Bucharest",
        startsAtWallTime: "2026-10-18T18:00",
        endsAtWallTime: "",
        raceStartsAtWallTime: "",
        locationName: "Parcul Tractorul",
        locationAddress: "",
        surface: null,
        difficulty: "HARD",
        mapUrl: "",
        routeUrl: "",
        distanceMeters: "",
        elevationGainMeters: "",
        featured: false,
        registrationMode: "NONE",
        participantListVisibility: "HIDDEN",
        capacity: "",
        registrationOpensAtWallTime: "",
        registrationClosesAtWallTime: "",
        declarationDocumentId: "",
        externalProvider: "",
        externalRegistrationUrl: "",
        costAmount: "",
        costUrl: "",
        translations: {
          ro: { slug: "traseu-dificil", title: "Traseu dificil", excerpt: "Kilometri împreună." },
          en: { slug: "hard-trail", title: "Hard trail", excerpt: "Kilometres together." },
        },
      },
    });

    const [row] = await db.select().from(events).where(eq(events.id, created.id));
    expect(row.difficulty).toBe("HARD");
  });

  it("a save posting HARD stores and reads back HARD", async () => {
    const created = await createEvent(db, {
      actor: admin,
      fields: {
        type: "GROUP_RUN",
        eventStatus: "SCHEDULED",
        timezone: "Europe/Bucharest",
        startsAtWallTime: "2026-10-18T18:00",
        endsAtWallTime: "",
        raceStartsAtWallTime: "",
        locationName: "Parcul Tractorul",
        locationAddress: "",
        surface: null,
        difficulty: null,
        mapUrl: "",
        routeUrl: "",
        distanceMeters: "",
        elevationGainMeters: "",
        featured: false,
        registrationMode: "NONE",
        participantListVisibility: "HIDDEN",
        capacity: "",
        registrationOpensAtWallTime: "",
        registrationClosesAtWallTime: "",
        declarationDocumentId: "",
        externalProvider: "",
        externalRegistrationUrl: "",
        costAmount: "",
        costUrl: "",
        translations: {
          ro: { slug: "traseu-usor", title: "Traseu ușor", excerpt: "Kilometri împreună." },
          en: { slug: "easy-trail", title: "Easy trail", excerpt: "Kilometres together." },
        },
      },
    });

    const saved = await saveEventFields(db, {
      actor: admin,
      eventId: created.id,
      expectedVersion: created.version,
      fields: {
        type: "GROUP_RUN",
        eventStatus: "SCHEDULED",
        timezone: "Europe/Bucharest",
        startsAtWallTime: "2026-10-18T18:00",
        endsAtWallTime: "",
        raceStartsAtWallTime: "",
        locationName: "Parcul Tractorul",
        locationAddress: "",
        surface: null,
        difficulty: "HARD",
        mapUrl: "",
        routeUrl: "",
        distanceMeters: "",
        elevationGainMeters: "",
        featured: false,
        registrationMode: "NONE",
        participantListVisibility: "HIDDEN",
        capacity: "",
        registrationOpensAtWallTime: "",
        registrationClosesAtWallTime: "",
        declarationDocumentId: "",
        externalProvider: "",
        externalRegistrationUrl: "",
        costAmount: "",
        costUrl: "",
      },
    });

    const [row] = await db.select().from(events).where(eq(events.id, saved.id));
    expect(row.difficulty).toBe("HARD");
  });
});
