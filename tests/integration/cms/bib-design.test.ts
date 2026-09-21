import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, saveEventFields } from "@/modules/content/events/service";
import { DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import { findEventForBibs } from "@/modules/registrations/bibs";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-038-01, `DECISIONS.md` §249 — the bib's design, from the editor to the renderers.
 *
 * The unit test holds the rules about what a design may say; this one holds the two things
 * only the database can answer: that a design saved in the editor is the design the sheet and
 * the preview read, and that a form **without** the panel leaves it alone. The second is the
 * one that would go wrong silently: a checkbox that is off posts nothing, so a create form —
 * or a caller written before this existed — must not read as "every switch off".
 */
describe("§249 the bib's design, saved and read back", () => {
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

  const EVENT_FIELDS = {
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

  const NEW_EVENT = {
    ...EVENT_FIELDS,
    translations: {
      ro: { slug: "crosul-aniversar", title: "Crosul aniversar", excerpt: "Cursa clubului." },
      en: { slug: "anniversary-cross", title: "Anniversary cross", excerpt: "The club's own race." },
    },
  };

  const PICTURE = "https://pub-example.r2.dev/qa/3f2a1b4c-0000-4000-8000-000000000000/web.webp";

  async function existingEvent() {
    const created = await createEvent(db, { actor: admin, fields: NEW_EVENT });
    const [row] = await db.select().from(events).where(eq(events.id, created.id));
    return row;
  }

  it("starts on the platform's own design, with nothing stored", async () => {
    const event = await existingEvent();
    expect(event.bibDesign).toBeNull();
    expect((await findEventForBibs(db, event.id, "ro"))?.design).toEqual(DEFAULT_BIB_DESIGN);
  });

  it("stores what the panel posted, and both renderers read it", async () => {
    const event = await existingEvent();
    const design = {
      ...DEFAULT_BIB_DESIGN,
      showDate: false,
      showLogo: false,
      numberScale: "large" as const,
      namePosition: "above" as const,
      headerImageSrc: PICTURE,
      cutMarks: true,
    };

    await saveEventFields(db, {
      actor: admin,
      eventId: event.id,
      expectedVersion: event.version,
      fields: { ...EVENT_FIELDS, bibDesign: design },
    });

    // `findEventForBibs` is what the sheet route and the preview route both call (§249).
    expect((await findEventForBibs(db, event.id, "ro"))?.design).toEqual(design);
  });

  it("leaves the design alone when the form did not carry the panel", async () => {
    const event = await existingEvent();
    const design = { ...DEFAULT_BIB_DESIGN, numberScale: "small" as const, sponsorImageSrc: PICTURE };
    const saved = await saveEventFields(db, {
      actor: admin,
      eventId: event.id,
      expectedVersion: event.version,
      fields: { ...EVENT_FIELDS, bibDesign: design },
    });

    // The next save carries no `bibDesign` at all — the create form, or an older caller.
    await saveEventFields(db, {
      actor: admin,
      eventId: event.id,
      expectedVersion: saved.version,
      fields: { ...EVENT_FIELDS, locationName: "Stadionul Olimpia" },
    });

    const after = await findEventForBibs(db, event.id, "ro");
    expect(after?.design).toEqual(design);
  });

  it("refuses a picture this site did not store", async () => {
    const event = await existingEvent();
    let code = "no error";
    try {
      await saveEventFields(db, {
        actor: admin,
        eventId: event.id,
        expectedVersion: event.version,
        fields: { ...EVENT_FIELDS, bibDesign: { ...DEFAULT_BIB_DESIGN, headerImageSrc: "https://evil.example/logo.png" } },
      });
    } catch (error) {
      if (!isDomainError(error)) throw error;
      code = error.code;
    }
    // Either the save is refused or the address is dropped; what must never happen is a bib
    // that fetches somebody else's server on every print.
    const after = await findEventForBibs(db, event.id, "ro");
    expect(code === "VALIDATION_ERROR" || after?.design.headerImageSrc === null).toBe(true);
  });
});
