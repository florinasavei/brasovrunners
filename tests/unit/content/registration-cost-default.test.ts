import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { eq } from "drizzle-orm";
import { createEvent } from "@/modules/content/events/service";
import { initialCostTypeOf } from "@/modules/content/events/ui/box-summaries";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the owner, 2026-09-25: "by default toate evenimentele sunt gratuite". A new event's
 * cost select preselects `FREE` (`initialCostTypeOf`, tested on its own in
 * `box-summaries.test.ts`); this checks that `RegistrationBox` actually reads the select's
 * `defaultValue`, and `CostFields`' visibility switch, off that one function — so the create
 * page and the closed summary can never drift apart on what "default" means.
 *
 * A save that never opens the box still writes `FREE`: the select is a real form control inside
 * the box's `<details>`, and a closed `<details>` still submits what is inside it (unlike a box
 * hidden by `OnlyForType`/`OnlyForMode`, which the service has to ignore on purpose). No schema
 * or column change was needed — `content/events/fields.ts#costType` already accepts a real
 * enum value; only the form's own default was missing.
 */
const SOURCE = readFileSync(path.join(process.cwd(), "src", "modules", "content", "events", "ui", "boxes", "RegistrationBox.tsx"), "utf8");

describe("§NNN a new event starts free", () => {
  it("computes the box's cost value with initialCostTypeOf, not straight off the event", () => {
    expect(SOURCE).toContain("const initialCostType = initialCostTypeOf(event);");
  });

  it("preselects the cost select off that value", () => {
    expect(SOURCE).toMatch(/name="event\.costType"[\s\S]{0,300}defaultValue=\{initialCostType\}/);
  });

  it("keeps CostFields' shown/hidden switch and the closed line off the same value", () => {
    expect(SOURCE).toContain("initialCostType={initialCostType}");
    expect(SOURCE).toMatch(/costAmount = initialCostType === "PAID" \|\| initialCostType === "DONATION"/);
    expect(SOURCE).toMatch(/costLabel = initialCostType \?/);
  });
});

describe("§NNN initialCostTypeOf agrees with RegistrationBox's use of it", () => {
  it("FREE on create, kept as typed on an edit — including an unstated cost", () => {
    expect(initialCostTypeOf(null)).toBe("FREE");
    expect(initialCostTypeOf({ costType: null })).toBe("");
    expect(initialCostTypeOf({ costType: "PAID" })).toBe("PAID");
  });
});

/**
 * §NNN — the "saved value" half, proven through the create service rather than by reading
 * `RegistrationBox`'s source: a create posted with the cost box never opened writes exactly what
 * the closed `<details>` submits — `costType: "FREE"`, no amount, no link — and the row reads
 * back `FREE`, not null and not the DB column's own default.
 */
describe("§NNN a create that never opens the cost box saves FREE, and reads back FREE", () => {
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
        // Exactly what a closed CostFields box still submits (§343): the select's own
        // `defaultValue` from `initialCostTypeOf(null)`, and the two amount/link fields empty.
        costType: "FREE",
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
});
