import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { eventFieldsSchema } from "@/modules/content/events/fields";
import { previewPageOf } from "@/modules/content/events/preview-view";
import { findEventForEditing } from "@/modules/content/events/repository";
import { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Lista ascunsă» on the event (`events.hidden_list_*`, migration 0126), modelled on §634's tick:
 * the four columns start as before the group existed (off, no series, the numbers said, the hidden list
 * not counted) and the migration switches the group on for an event that already had somebody on the
 * list; the editor's action saves them by one marker, a form without the group edits none, and every
 * change is written to the trail with from and to; a series and a copy carry them; the hidden list's
 * series may not start inside the race's capped series, nor inside the desk's spares.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[] }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { saveEventAndTranslationsAction } = await import("@/app/[locale]/admin/actions");

const NOW = new Date("2026-09-25T10:00:00.000Z");

const FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-07T19:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Piața Sfatului",
  locationNameEn: "Council Square",
  locationAddress: "",
  surface: "ASPHALT",
  difficulty: "MEDIUM",
  costType: "FREE",
  costAmount: "",
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "10000",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "INTERNAL",
  externalProvider: "",
  externalRegistrationUrl: "",
  participantListVisibility: "HIDDEN" as const,
  capacity: "150",
  bibStartNumber: "1",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
};

const TRANSLATIONS = {
  ro: { slug: "crosul-ascuns", title: "Crosul", excerpt: "Cu lista ascunsă." },
  en: { slug: "hidden-list-race", title: "The race", excerpt: "With the hidden list." },
};

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  state.actor = admin;
  // An event that takes registrations names an approved declaration.
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Declar."] }] } },
    { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I declare."] }] } },
  ];
  FIELDS.declarationDocumentId = await insertLegalDocumentVersion(db, {
    key: "EVENT_DECLARATION",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(declaration),
    translations: declaration,
    now: NOW,
  });
  state.redirected.length = 0;
});

const reloadEvent = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
const translationsOf = (id: string) => db.select().from(eventTranslations).where(eq(eventTranslations.eventId, id));
const trailOf = (action: "event.hidden_list_changed" | "event.participant_count_public_changed") => (eventId: string) =>
  db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, eventId)))
    .orderBy(asc(auditLogs.createdAt));
/** The hidden list's group: the switch, its series, «Numără și lista ascunsă». */
const trail = trailOf("event.hidden_list_changed");
/** «Arată public numărătoarea», on every event: its own action (§NNN), never the hidden list's. */
const countTrail = trailOf("event.participant_count_public_changed");

type Group = { enabled?: boolean; start?: string; countPublic?: boolean; counted?: boolean } | "absent";

/** The editor's settings as they post, plus the «Lista ascunsă» group (one marker for the three) and the count's tick. */
function settingsForm(eventId: string, expectedVersion: number, group: Group): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries(FIELDS)) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  if (group !== "absent") {
    form.set("event.hiddenList.present", "1");
    if (group.enabled) form.set("event.hiddenListEnabled", "on");
    form.set("event.hiddenListBibStart", group.start ?? "");
    if (group.counted) form.set("event.hiddenListCounted", "on");
    // «Arată public numărătoarea» (§NNN) is outside the group, with its own marker, as the editor posts it.
    form.set("event.participantCountPublic.present", "1");
    if (group.countPublic) form.set("event.participantCountPublic", "on");
  }
  return form;
}

async function postSave(form: FormData): Promise<unknown> {
  return saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
}

const wordsFor = (row: { slug: string; title: string; excerpt: string | null }) => ({
  slug: row.slug,
  title: row.title,
  excerpt: row.excerpt ?? "",
  seoTitle: "",
  seoDescription: "",
});

const settled = (row: Awaited<ReturnType<typeof reloadEvent>>) => ({
  enabled: row.hiddenListEnabled,
  start: row.hiddenListBibStart,
  countPublic: row.participantCountPublic,
  counted: row.hiddenListCounted,
});

describe("§NNN «Lista ascunsă» on the event", () => {
  it("is an expand-only migration whose defaults are today's, switched on where somebody is already on the list", async () => {
    const sql = readFileSync(join(process.cwd(), "src/db/migrations/0126_hidden_list.sql"), "utf8");
    expect(sql).toContain('ALTER TABLE "events" ADD COLUMN "hidden_list_enabled" boolean DEFAULT false NOT NULL;');
    expect(sql).toContain('ALTER TABLE "events" ADD COLUMN "hidden_list_bib_start" integer;');
    expect(sql).toContain('ALTER TABLE "events" ADD COLUMN "participant_count_public" boolean DEFAULT true NOT NULL;');
    expect(sql).toContain('ALTER TABLE "events" ADD COLUMN "hidden_list_counted" boolean DEFAULT false NOT NULL;');
    expect(sql).toMatch(/UPDATE "events" SET "hidden_list_enabled" = true WHERE EXISTS \(SELECT 1 FROM "registrations" WHERE .*"outside_capacity" = true\);/);
    expect(sql).not.toMatch(/DROP|RENAME|SET NOT NULL/i);
    const [row] = await db.insert(events).values({ type: "RACE", startsAt: NOW, registrationMode: "INTERNAL" }).returning();
    expect(settled(row)).toEqual({ enabled: false, start: null, countPublic: true, counted: false });
  });

  it("is saved through the editor's action by its marker, a form without the group leaves it alone, and the trail names what moved", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect(settled(await reloadEvent(source.id))).toEqual({ enabled: false, start: null, countPublic: true, counted: false });

    expect(await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, { enabled: true, start: "900", countPublic: false, counted: true }))).toBe("redirected");
    expect(settled(await reloadEvent(source.id))).toEqual({ enabled: true, start: 900, countPublic: false, counted: true });
    const first = await trail(source.id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      actorStaffUserId: admin.id,
      entityType: "event",
      metadataJson: {
        from: { hiddenListEnabled: false, hiddenListBibStart: null, hiddenListCounted: false },
        to: { hiddenListEnabled: true, hiddenListBibStart: 900, hiddenListCounted: true },
      },
    });
    // The count's tick moved in the same save: its own row, under its own action.
    expect((await countTrail(source.id)).map((entry) => entry.metadataJson)).toEqual([{ from: { participantCountPublic: true }, to: { participantCountPublic: false } }]);

    // No marker: "not editing it", and no trail row.
    expect(await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "absent"))).toBe("redirected");
    expect(settled(await reloadEvent(source.id))).toEqual({ enabled: true, start: 900, countPublic: false, counted: true });
    expect(await trail(source.id)).toHaveLength(1);

    // The switch off keeps what the club chose below it — stored as posted, acting only while on.
    expect(await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, { enabled: false, start: "900", countPublic: false, counted: true }))).toBe("redirected");
    expect(settled(await reloadEvent(source.id))).toEqual({ enabled: false, start: 900, countPublic: false, counted: true });
    expect((await trail(source.id)).at(-1)?.metadataJson).toEqual({ from: { hiddenListEnabled: true }, to: { hiddenListEnabled: false } });
  });

  it("«Arată public numărătoarea» is saved by its own marker, on an event whose hidden list stays off", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    // The count's tick alone, unticked, without the hidden list's group: the hidden list is untouched.
    const form = settingsForm(source.id, (await reloadEvent(source.id)).version, "absent");
    form.set("event.participantCountPublic.present", "1");
    expect(await postSave(form)).toBe("redirected");
    expect(settled(await reloadEvent(source.id))).toEqual({ enabled: false, start: null, countPublic: false, counted: false });
    // Its own action: on an event that never uses the hidden list, the trail says nothing of the hidden list.
    expect((await countTrail(source.id)).at(-1)?.metadataJson).toEqual({ from: { participantCountPublic: true }, to: { participantCountPublic: false } });
    expect(await trail(source.id)).toHaveLength(0);
    // Ticked again by the same marker.
    const again = settingsForm(source.id, (await reloadEvent(source.id)).version, "absent");
    again.set("event.participantCountPublic.present", "1");
    again.set("event.participantCountPublic", "on");
    expect(await postSave(again)).toBe("redirected");
    expect(settled(await reloadEvent(source.id))).toEqual({ enabled: false, start: null, countPublic: true, counted: false });
  });

  it("refuses a hidden-list series starting inside the race's series, names the box, and accepts one below or past it", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const refused = await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, { enabled: true, start: "100", countPublic: true }));
    expect(refused).toMatchObject({ error: "VALIDATION_ERROR", fields: ["event.hiddenListBibStart"] });
    expect((await reloadEvent(source.id)).hiddenListBibStart).toBeNull();
    // Exactly past the 150 places: 151.
    expect(await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, { enabled: true, start: "151", countPublic: true }))).toBe("redirected");
    expect((await reloadEvent(source.id)).hiddenListBibStart).toBe(151);
  });

  it("judges the band in the schema: the race's capped series, its first number uncapped, and nothing while the switch is off", () => {
    const parse = (extra: Record<string, unknown>) => eventFieldsSchema.safeParse({ ...FIELDS, ...extra });
    const issue = (extra: Record<string, unknown>) => {
      const result = parse(extra);
      return result.success ? null : result.error.issues.find((entry) => entry.path[0] === "hiddenListBibStart")?.message ?? null;
    };
    expect(issue({ hiddenListEnabled: true, hiddenListBibStart: "1" })).toMatch(/outside the race's series \(1–150\)/);
    expect(issue({ hiddenListEnabled: true, hiddenListBibStart: "150" })).not.toBeNull();
    expect(issue({ hiddenListEnabled: true, hiddenListBibStart: "151" })).toBeNull();
    expect(issue({ hiddenListEnabled: true, hiddenListBibStart: "500", bibStartNumber: "600" })).toBeNull();
    // Uncapped: the race's series has no end, so the hidden list's must start below the race's first number.
    expect(issue({ hiddenListEnabled: true, hiddenListBibStart: "1", capacity: "" })).toMatch(/below the race's first number \(1\)/);
    expect(issue({ hiddenListEnabled: true, hiddenListBibStart: "2", capacity: "" })).not.toBeNull();
    expect(issue({ hiddenListEnabled: true, hiddenListBibStart: "5000", capacity: "", bibStartNumber: "100" })).not.toBeNull();
    expect(issue({ hiddenListEnabled: true, hiddenListBibStart: "1", capacity: "", bibStartNumber: "100" })).toBeNull();
    expect(issue({ hiddenListEnabled: true, hiddenListBibStart: "99", capacity: "", bibStartNumber: "100" })).toBeNull();
    // The switch off: the box is not judged — it acts only while on.
    expect(issue({ hiddenListEnabled: false, hiddenListBibStart: "10" })).toBeNull();
  });

  it("refuses a series starting inside the desk's spares, which only the event row knows", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await db.update(events).set({ walkInBibStart: 200, walkInBibCount: 20 }).where(eq(events.id, source.id));
    const refused = await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, { enabled: true, start: "210", countPublic: true }));
    // The box is named, so the editor points at it rather than only saying «Verifică datele introduse».
    expect(refused).toMatchObject({ error: "VALIDATION_ERROR", fields: ["event.hiddenListBibStart"] });
    expect((await reloadEvent(source.id)).hiddenListBibStart).toBeNull();
    expect(await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, { enabled: true, start: "220", countPublic: true }))).toBe("redirected");
    expect((await reloadEvent(source.id)).hiddenListBibStart).toBe(220);
  });

  it("the public read carries the two ticks and the switch", async () => {
    const source = await createEvent(
      db,
      { actor: admin, fields: { ...FIELDS, hiddenListEnabled: true, participantCountPublic: false, hiddenListCounted: true, translations: TRANSLATIONS }, now: NOW },
    );
    await db.update(events).set({ editorialStatus: "PUBLISHED", publishedAt: NOW }).where(eq(events.id, source.id));
    expect(await findPublishedEventBySlug(db, "ro", "crosul-ascuns")).toMatchObject({ hiddenListEnabled: true, participantCountPublic: false, hiddenListCounted: true });
  });

  it("the editor's preview carries the switch and the two ticks, as the page reads them", async () => {
    const source = await createEvent(
      db,
      { actor: admin, fields: { ...FIELDS, hiddenListEnabled: true, participantCountPublic: false, hiddenListCounted: true, translations: TRANSLATIONS }, now: NOW },
    );
    const record = await findEventForEditing(db, source.id);
    if (!record) throw new Error("no event");
    for (const translation of record.translations) {
      expect(previewPageOf(record.event, translation), translation.locale).toMatchObject({ hiddenListEnabled: true, participantCountPublic: false, hiddenListCounted: true });
    }
  });

  it("is carried to every date a series makes and kept by a duplicate", async () => {
    const source = await createEvent(db, {
      actor: admin,
      fields: { ...FIELDS, hiddenListEnabled: true, hiddenListBibStart: "900", participantCountPublic: false, hiddenListCounted: true, translations: TRANSLATIONS },
      now: NOW,
    });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(settled(date)).toEqual({ enabled: true, start: 900, countPublic: false, counted: true });

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect(settled(await reloadEvent(copy.id))).toEqual({ enabled: true, start: 900, countPublic: false, counted: true });
  });

  it("a series edit with the 'following' scope carries it to the later dates, each date's trail naming it", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);

    const row = await reloadEvent(source.id);
    const translations = await translationsOf(source.id);
    const ro = translations.find((t) => t.locale === "ro")!;
    const en = translations.find((t) => t.locale === "en")!;
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: { ...FIELDS, hiddenListEnabled: true, hiddenListBibStart: "", participantCountPublic: true, hiddenListCounted: true },
      expectedVersion: row.version,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro) },
        { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en) },
      ],
      scope: "following",
      now: NOW,
    });

    const moved = { from: { hiddenListEnabled: false, hiddenListCounted: false }, to: { hiddenListEnabled: true, hiddenListCounted: true } };
    expect(settled(await reloadEvent(source.id))).toEqual({ enabled: true, start: null, countPublic: true, counted: true });
    expect((await trail(source.id)).map((entry) => entry.metadataJson)).toEqual([moved]);
    for (const date of dates) {
      expect(settled(await reloadEvent(date.id)), date.id).toEqual({ enabled: true, start: null, countPublic: true, counted: true });
      expect((await trail(date.id)).map((entry) => entry.metadataJson), date.id).toEqual([moved]);
    }
  });
});
