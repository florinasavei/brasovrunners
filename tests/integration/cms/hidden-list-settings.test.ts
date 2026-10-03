import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { eventFieldsSchema, hiddenListBandIssue } from "@/modules/content/events/fields";
import { previewPageOf } from "@/modules/content/events/preview-view";
import { findEventForEditing } from "@/modules/content/events/repository";
import { createEvent, duplicateEvent, materializeStandingRepeats, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { addSupplementaryPlace } from "@/modules/registrations/repository";
import { formatCalendarDay } from "@/i18n/dates";
import ro from "../../../messages/ro.json";
import en from "../../../messages/en.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Lista ascunsă» on the event (`events.hidden_list_*`, migration 0126), modelled on §634's tick:
 * the four columns start as before the group existed (off, no series, the numbers said, the hidden list
 * not counted) and the migration switches the group on for an event that already had somebody on the
 * list; the editor's action saves them by one marker, a form without the group edits none, and every
 * change is written to the trail with from and to; a series and a copy carry them; the hidden list's
 * series may not start inside the race's capped series, nor run into the desk's spares.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[], slugsRefused: false }));

// A refusal of a series that is not the hidden list's, on demand: the standing job must not swallow it.
vi.mock("@/modules/content/events/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/content/events/repository")>();
  const { DomainError } = await import("@/shared/errors/domain-error");
  return {
    ...original,
    findTakenSlugs: (async (...args: Parameters<typeof original.findTakenSlugs>) => {
      if (state.slugsRefused) throw new DomainError("VALIDATION_ERROR", "slug: refused for the test", ["slug"]);
      return original.findTakenSlugs(...args);
    }) as typeof original.findTakenSlugs,
  };
});

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

const { duplicateEventAction, repeatEventAction, saveEventAndTranslationsAction } = await import("@/app/[locale]/admin/actions");
const { runRegistrationMaintenance } = await import("@/modules/registrations/maintenance");

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
  state.slugsRefused = false;
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
    // Its own sentence, naming the box, rather than «Verifică datele introduse»; the box is linked too.
    expect(refused).toMatchObject({ error: "HIDDEN_LIST_IN_RACE_SERIES", fields: ["event.hiddenListBibStart"] });
    expect(refused).not.toHaveProperty("errorValues");
    expect((await reloadEvent(source.id)).hiddenListBibStart).toBeNull();
    // Exactly past the 150 places: 151.
    expect(await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, { enabled: true, start: "151", countPublic: true }))).toBe("redirected");
    expect((await reloadEvent(source.id)).hiddenListBibStart).toBe(151);
  });

  it("judges the band: the race's capped series, its first number uncapped, and nothing while the switch is off", () => {
    const issue = (extra: Partial<Parameters<typeof hiddenListBandIssue>[0]>) =>
      hiddenListBandIssue({ hiddenListEnabled: true, hiddenListBibStart: null, bibStartNumber: 1, capacity: 150, ...extra });
    expect(issue({ hiddenListBibStart: 1 })).toMatch(/outside the race's series \(1–150\)/);
    expect(issue({ hiddenListBibStart: 150 })).not.toBeNull();
    expect(issue({ hiddenListBibStart: 151 })).toBeNull();
    expect(issue({ hiddenListBibStart: 500, bibStartNumber: 600 })).toBeNull();
    // Uncapped: the race's series has no end, so the hidden list's must start below the race's first number.
    expect(issue({ hiddenListBibStart: 1, capacity: null })).toMatch(/below the race's first number \(1\)/);
    expect(issue({ hiddenListBibStart: 2, capacity: null })).not.toBeNull();
    expect(issue({ hiddenListBibStart: 5000, capacity: null, bibStartNumber: 100 })).not.toBeNull();
    expect(issue({ hiddenListBibStart: 1, capacity: null, bibStartNumber: 100 })).toBeNull();
    expect(issue({ hiddenListBibStart: 99, capacity: null, bibStartNumber: 100 })).toBeNull();
    // The switch off: the box is not judged — it acts only while on.
    expect(issue({ hiddenListEnabled: false, hiddenListBibStart: 10 })).toBeNull();
    // Not a refinement of the schema any more: the service judges it against the event as it stands.
    expect(eventFieldsSchema.safeParse({ ...FIELDS, hiddenListEnabled: true, hiddenListBibStart: "1" }).success).toBe(true);
  });

  it("a place «Trimite-i oferta» added past a hidden start set just above the series never refuses a save that does not move it", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    const group = { enabled: true, start: "151", countPublic: true };
    expect(await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, group))).toBe("redirected");
    // §642: one supplementary place, without a save — the race's series is now 1–151, the hidden start inside it.
    expect(await addSupplementaryPlace(db, source.id, admin.id, NOW)).toBe(151);
    const withCapacity = async (capacity: string) => {
      const form = settingsForm(source.id, (await reloadEvent(source.id)).version, group);
      form.set("event.capacity", capacity);
      return postSave(form);
    };
    // An ordinary save posting what the event holds — the 151 places and the start nobody touched — passes.
    expect(await withCapacity("151")).toBe("redirected");
    expect((await reloadEvent(source.id)).hiddenListBibStart).toBe(151);
    // A save that moves the places is judged: 152 places reach past the start, and the box is named.
    expect(await withCapacity("152")).toMatchObject({ error: "HIDDEN_LIST_IN_RACE_SERIES", fields: ["event.hiddenListBibStart"] });
    expect((await reloadEvent(source.id)).capacity).toBe(151);
    // A save that moves the start is judged too: 150 is inside 1–151.
    const moved = settingsForm(source.id, (await reloadEvent(source.id)).version, { ...group, start: "150" });
    moved.set("event.capacity", "151");
    expect(await postSave(moved)).toMatchObject({ error: "HIDDEN_LIST_IN_RACE_SERIES", fields: ["event.hiddenListBibStart"] });
    // Switching the hidden list on again with that start is judged as well: off then on, refused.
    const off = settingsForm(source.id, (await reloadEvent(source.id)).version, { ...group, enabled: false });
    off.set("event.capacity", "151");
    expect(await postSave(off)).toBe("redirected");
    expect(await withCapacity("151")).toMatchObject({ error: "HIDDEN_LIST_IN_RACE_SERIES", fields: ["event.hiddenListBibStart"] });
    expect((await reloadEvent(source.id)).hiddenListEnabled).toBe(false);
  });

  it("refuses a series that runs into the desk's spares, which only the event row knows", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await db.update(events).set({ walkInBibStart: 200, walkInBibCount: 20 }).where(eq(events.id, source.id));
    const refused = await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, { enabled: true, start: "210", countPublic: true }));
    // The box is named, so the editor points at it rather than only saying «Verifică datele introduse».
    expect(refused).toMatchObject({ error: "HIDDEN_LIST_ON_SPARES", fields: ["event.hiddenListBibStart"] });
    expect((await reloadEvent(source.id)).hiddenListBibStart).toBeNull();
    // A start below spares that sit above the race: the series 160… runs through 200–219, so it is refused too.
    const below = await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, { enabled: true, start: "160", countPublic: true }));
    expect(below).toMatchObject({ error: "HIDDEN_LIST_ON_SPARES", fields: ["event.hiddenListBibStart"] });
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

  /** A source with two later dates (14 and 21 October), and a scoped save of its hidden list to them. */
  async function seriesWithDates() {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    expect(dates.length).toBe(2);
    const saveFollowing = async (start: string) => {
      const row = await reloadEvent(source.id);
      const translations = await translationsOf(source.id);
      const ro = translations.find((t) => t.locale === "ro")!;
      const en = translations.find((t) => t.locale === "en")!;
      return saveEventAndTranslations(db, {
        actor: admin,
        eventId: source.id,
        fields: { ...FIELDS, hiddenListEnabled: true, hiddenListBibStart: start, participantCountPublic: true, hiddenListCounted: false },
        expectedVersion: row.version,
        translations: [
          { translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro) },
          { translationId: en.id, expectedVersion: en.version, fields: wordsFor(en) },
        ],
        scope: "following",
        now: NOW,
      });
    };
    return { source, dates, saveFollowing };
  }

  it("a scoped series save judges each later date against its own spares, names the date, and writes nothing", async () => {
    const { source, dates, saveFollowing } = await seriesWithDates();
    // Only the 14 October date printed spares (§444): the saved date has none, so its own judgement passes.
    await db.update(events).set({ walkInBibStart: 200, walkInBibCount: 20 }).where(eq(events.id, dates[0].id));
    await expect(saveFollowing("210")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["hiddenListBibStart"],
      message: expect.stringMatching(/desk's spare numbers \(200–219\) on 2026-10-14$/),
    });
    // The whole save is one transaction: no date — the saved one included — took the start.
    for (const id of [source.id, ...dates.map((date) => date.id)]) {
      expect(settled(await reloadEvent(id)), id).toEqual({ enabled: false, start: null, countPublic: true, counted: false });
      expect(await trail(id), id).toHaveLength(0);
    }
    // Past the spares, every date takes it.
    await saveFollowing("220");
    for (const id of [source.id, ...dates.map((date) => date.id)]) expect((await reloadEvent(id)).hiddenListBibStart, id).toBe(220);
  });

  it("a scoped series save judges each later date against its own places, naming the date", async () => {
    const { source, dates, saveFollowing } = await seriesWithDates();
    // The 21 October date holds ten places more than the others (supplementary ones, §642): its series is 1–160.
    await db.update(events).set({ capacity: 160 }).where(eq(events.id, dates[1].id));
    await expect(saveFollowing("155")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["hiddenListBibStart"],
      message: expect.stringMatching(/outside the race's series \(1–160\) on 2026-10-21$/),
    });
    for (const id of [source.id, ...dates.map((date) => date.id)]) expect((await reloadEvent(id)).hiddenListBibStart, id).toBeNull();
    await saveFollowing("161");
    for (const id of [source.id, ...dates.map((date) => date.id)]) expect((await reloadEvent(id)).hiddenListBibStart, id).toBe(161);
  });

  it("a copy is refused when the source's places have reached its hidden start, its log naming the date", async () => {
    const source = await createEvent(db, {
      actor: admin,
      fields: { ...FIELDS, hiddenListEnabled: true, hiddenListBibStart: "151", translations: TRANSLATIONS },
      now: NOW,
    });
    // §642: a supplementary place without a save — the source's series is 1–151, its hidden start inside it.
    expect(await addSupplementaryPlace(db, source.id, admin.id, NOW)).toBe(151);
    const before = (await db.select().from(events)).length;
    await expect(duplicateEvent(db, { actor: admin, eventId: source.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["hiddenListBibStart"],
      message: expect.stringMatching(/\(1–151\) on 2026-10-07$/),
    });
    await expect(
      repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["hiddenListBibStart"] });
    // Nothing made, and no standing rule left behind for the job.
    expect((await db.select().from(events)).length).toBe(before);
    expect((await reloadEvent(source.id)).repeatRule).toBeNull();
    // A rule stored before the place was added: the maintenance job skips this source and fails nothing.
    await db.update(events).set({ repeatRule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false } }).where(eq(events.id, source.id));
    expect(await materializeStandingRepeats(db, NOW, { seriesHorizonDays: 60 })).toEqual({ sources: 1, created: 0, refused: [source.id] });
    expect((await db.select().from(events)).length).toBe(before);
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

  describe("the refusal's own sentence (§NNN)", () => {
    it("names the box in both languages, and the date where the sentence is a date's", () => {
      for (const [code, box] of [
        ["HIDDEN_LIST_IN_RACE_SERIES", ["«Numerele listei ascunse încep de la»", "«The hidden list's numbers start at»"]],
        ["HIDDEN_LIST_ON_SPARES", ["«Numerele listei ascunse încep de la»", "«The hidden list's numbers start at»"]],
      ] as const) {
        expect(ro.Admin.errors[code]).toContain(box[0]);
        expect(en.Admin.errors[code]).toContain(box[1]);
        expect(ro.Admin.errors[code]).not.toContain("{date}");
        expect(ro.Admin.errors[`${code}_DATED`]).toContain(box[0]);
        expect(en.Admin.errors[`${code}_DATED`]).toContain(box[1]);
        expect(ro.Admin.errors[`${code}_DATED`]).toContain("{date}");
        expect(en.Admin.errors[`${code}_DATED`]).toContain("{date}");
      }
    });

    /** The editor's scoped save, as the action posts it: «această dată și următoarele». */
    async function postFollowing(eventId: string, start: string) {
      const form = settingsForm(eventId, (await reloadEvent(eventId)).version, { enabled: true, start, countPublic: true });
      form.set("scope", "following");
      return postSave(form);
    }

    it("a scoped save refused on another date's places says that date, in the reader's language", async () => {
      const { source, dates } = await seriesWithDates();
      await db.update(events).set({ capacity: 160 }).where(eq(events.id, dates[1].id));
      const refused = await postFollowing(source.id, "155");
      expect(refused).toMatchObject({
        error: "HIDDEN_LIST_IN_RACE_SERIES_DATED",
        errorValues: { date: formatCalendarDay("2026-10-21", { locale: "ro", position: "inline" }) },
        fields: ["event.hiddenListBibStart"],
      });
      expect((refused as { errorValues: { date: string } }).errorValues.date).toContain("21 oct.");
      for (const id of [source.id, ...dates.map((date) => date.id)]) expect((await reloadEvent(id)).hiddenListBibStart, id).toBeNull();
    });

    it("a scoped save refused on another date's spares says that date", async () => {
      const { source, dates } = await seriesWithDates();
      await db.update(events).set({ walkInBibStart: 200, walkInBibCount: 20 }).where(eq(events.id, dates[0].id));
      expect(await postFollowing(source.id, "210")).toMatchObject({
        error: "HIDDEN_LIST_ON_SPARES_DATED",
        errorValues: { date: formatCalendarDay("2026-10-14", { locale: "ro", position: "inline" }) },
      });
    });

    it("a duplicate and a repeat refused by the source's hidden list say which box to move, never a date", async () => {
      const source = await createEvent(db, {
        actor: admin,
        fields: { ...FIELDS, hiddenListEnabled: true, hiddenListBibStart: "151", translations: TRANSLATIONS },
        now: NOW,
      });
      expect(await addSupplementaryPlace(db, source.id, admin.id, NOW)).toBe(151);
      const before = (await db.select().from(events)).length;

      const duplicate = new FormData();
      duplicate.set("uiLocale", "ro");
      duplicate.set("eventId", source.id);
      await expect(duplicateEventAction(null, duplicate)).rejects.toThrow("NEXT_REDIRECT");
      // Back to the events list, whose alert reads `Admin.errors.<code>` — this code, not VALIDATION_ERROR.
      expect(state.redirected.at(-1)).toMatch(/[?&]error=HIDDEN_LIST_IN_RACE_SERIES(#|&)/);

      const repeat = new FormData();
      repeat.set("uiLocale", "ro");
      repeat.set("eventId", source.id);
      repeat.set("repeatOn", "on");
      repeat.set("cadence", "WEEKLY");
      repeat.set("until", "2026-10-21");
      const refused = await repeatEventAction(null, repeat);
      // The box is the event's settings', not the repeat panel's: no link to a box the panel lacks.
      expect(refused).toMatchObject({ error: "HIDDEN_LIST_IN_RACE_SERIES", fields: [] });
      expect(refused).not.toHaveProperty("errorValues");
      expect((await db.select().from(events)).length).toBe(before);
    });
  });

  describe("the standing series the hidden list refuses (§NNN)", () => {
    const RULE = { cadence: "WEEKLY" as const, weekdays: [], until: "2026-10-21", publish: false };

    /** A source whose places «Trimite-i oferta» carried up to its hidden start, with its rule stored before. */
    async function stuckSource() {
      const source = await createEvent(db, {
        actor: admin,
        fields: { ...FIELDS, hiddenListEnabled: true, hiddenListBibStart: "151", translations: TRANSLATIONS },
        now: NOW,
      });
      expect(await addSupplementaryPlace(db, source.id, admin.id, NOW)).toBe(151);
      await db.update(events).set({ repeatRule: RULE }).where(eq(events.id, source.id));
      return source;
    }

    /** An ordinary series beside it, whose rule is stored and whose dates the job makes. */
    async function healthySource() {
      const translations = {
        ro: { ...TRANSLATIONS.ro, slug: "crosul-sanatos" },
        en: { ...TRANSLATIONS.en, slug: "healthy-race" },
      };
      const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations }, now: NOW });
      await db.update(events).set({ repeatRule: RULE }).where(eq(events.id, source.id));
      return source;
    }

    it("is named back to the run, while the other series still gets its dates", async () => {
      const stuck = await stuckSource();
      const healthy = await healthySource();
      const run = await materializeStandingRepeats(db, NOW, { seriesHorizonDays: 60 });
      expect(run).toMatchObject({ sources: 2, refused: [stuck.id] });
      expect(run.created).toBe(2);
      expect(await db.select().from(events).where(eq(events.repeatOf, healthy.id))).toHaveLength(2);
      expect(await db.select().from(events).where(eq(events.repeatOf, stuck.id))).toHaveLength(0);
    });

    it("lets any other refusal of a series fail the step, as before", async () => {
      await stuckSource();
      await healthySource();
      state.slugsRefused = true;
      await expect(materializeStandingRepeats(db, NOW, { seriesHorizonDays: 60 })).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["slug"] });
    });

    it("counts each refused source as an error of the maintenance run, and logs its id", async () => {
      const stuck = await stuckSource();
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const refused = await runRegistrationMaintenance(db, NOW);
        expect(logged.mock.calls.some((call) => call.includes(stuck.id))).toBe(true);
        // Saved right — the start above the places — the same run has one error fewer.
        await db.update(events).set({ hiddenListBibStart: 900 }).where(eq(events.id, stuck.id));
        logged.mockClear();
        const fixed = await runRegistrationMaintenance(db, NOW);
        expect(fixed.errorCount).toBe(refused.errorCount - 1);
        expect(logged.mock.calls.some((call) => call.includes(stuck.id))).toBe(false);
      } finally {
        logged.mockRestore();
      }
    });
  });
});
