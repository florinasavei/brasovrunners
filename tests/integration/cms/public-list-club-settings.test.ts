import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { previewPageOf } from "@/modules/content/events/preview-view";
import { findEventForEditing } from "@/modules/content/events/repository";
import { createEvent, duplicateEvent } from "@/modules/content/events/service";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { deleteStaffUser, insertStaffUser } from "@/modules/staff-identity/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §753 — «Clubul pe lista publică» on the event (`events.public_list_club`, migration 0145): saved through
 * the editor's action, stored as posted, a form without the box leaves it as stored, a value that is no mode
 * is refused, every change is written to the trail with from and to, the public cache is told on the save,
 * a copy carries it, and the preview and the public read carry it. A new or removed account (a member) tells
 * the cache too, because the club's name shows for members.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[] }));
const cache = vi.hoisted(() => ({ revalidatePublicContent: vi.fn() }));

vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: cache.revalidatePublicContent,
}));
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
  ro: { slug: "crosul-clubului", title: "Crosul", excerpt: "Cu lista publică." },
  en: { slug: "club-column-race", title: "The race", excerpt: "With the public list." },
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
  cache.revalidatePublicContent.mockClear();
});

const reloadEvent = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
const trail = (eventId: string) =>
  db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "event.public_list_club_changed"), eq(auditLogs.entityId, eventId)))
    .orderBy(asc(auditLogs.createdAt));

/** The editor's settings as they post, with the club's mode when it is given. */
function settingsForm(eventId: string, expectedVersion: number, club: string | null): FormData {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", eventId);
  form.set("event.expectedVersion", String(expectedVersion));
  for (const [name, value] of Object.entries(FIELDS)) {
    if (typeof value === "string") form.set(`event.${name}`, value);
  }
  if (club !== null) form.set("event.publicListClub", club);
  return form;
}

async function postSave(form: FormData): Promise<unknown> {
  return saveEventAndTranslationsAction(null, form).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
}

describe("§753 «Clubul pe lista publică» on the event", () => {
  it("starts as «Doar» the club's members on a new event", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    expect((await reloadEvent(source.id)).publicListClub).toBe("members_only");
  });

  it("is saved through the editor's action as posted, audited with from and to, and the public cache is told", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: TRANSLATIONS }, now: NOW });
    cache.revalidatePublicContent.mockClear();

    expect(await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "as_typed"))).toBe("redirected");
    expect((await reloadEvent(source.id)).publicListClub).toBe("as_typed");
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("events");
    const first = await trail(source.id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      actorStaffUserId: admin.id,
      entityType: "event",
      metadataJson: { from: "members_only", to: "as_typed" },
    });

    // The same value again moves nothing and writes no row; another mode writes the next one.
    expect(await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "as_typed"))).toBe("redirected");
    expect(await trail(source.id)).toHaveLength(1);
    expect(await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "hidden"))).toBe("redirected");
    expect((await reloadEvent(source.id)).publicListClub).toBe("hidden");
    expect((await trail(source.id)).at(-1)?.metadataJson).toEqual({ from: "as_typed", to: "hidden" });
  });

  it("a form without the box leaves the stored mode alone, and a value that is no mode changes nothing", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, publicListClub: "hidden", translations: TRANSLATIONS }, now: NOW });
    expect((await reloadEvent(source.id)).publicListClub).toBe("hidden");

    expect(await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, null))).toBe("redirected");
    expect((await reloadEvent(source.id)).publicListClub).toBe("hidden");
    expect(await trail(source.id)).toHaveLength(0);

    const refused = await postSave(settingsForm(source.id, (await reloadEvent(source.id)).version, "everything"));
    expect(refused).not.toBe("redirected");
    expect((await reloadEvent(source.id)).publicListClub).toBe("hidden");
    expect(await trail(source.id)).toHaveLength(0);
  });

  it("is carried by a copy, the editor's read, the preview and the public read", async () => {
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, publicListClub: "as_typed", translations: TRANSLATIONS }, now: NOW });
    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id, now: NOW });
    expect((await reloadEvent(copy.id)).publicListClub).toBe("as_typed");

    const editing = await findEventForEditing(db, source.id);
    expect(editing?.event.publicListClub).toBe("as_typed");
    expect(previewPageOf(editing!.event, editing!.translations[0])).toMatchObject({ publicListClub: "as_typed" });

    await db.update(events).set({ editorialStatus: "PUBLISHED", publishedAt: NOW }).where(eq(events.id, source.id));
    expect(await findPublishedEventBySlug(db, "ro", "crosul-clubului")).toMatchObject({ publicListClub: "as_typed" });
  });

  it("an account that comes or goes changes nothing on the public list (§NNN): the cached lists stay", async () => {
    cache.revalidatePublicContent.mockClear();
    const member = await insertStaffUser(db, { email: "membru@example.org", displayName: "Membru", role: "MEMBER" });
    await deleteStaffUser(db, member.id);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });
});
