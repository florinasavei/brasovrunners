import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, duplicateEvent, repeatEvent } from "@/modules/content/events/service";
import { exportEvent } from "@/modules/content/events/transfer/export";
import { readEventFile, serializeEventFile } from "@/modules/content/events/transfer/file-format";
import { diffEventImport, importEventAsNew, importEventOver } from "@/modules/content/events/transfer/import";
import { ladderKeyPrefixOf } from "@/modules/media/ladder";
import { pictureUses, usedHere } from "@/modules/media/picker";
import { countMediaAssets, deleteMediaAsset, listMediaAssetsForAdmin, sweepOrphanAssets } from "@/modules/media/references";
import { getStorage, objectKey } from "@/modules/media/storage";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { PLAN_PICTURE_DISPLAY_WIDTH, readVolunteerPlan, setVolunteerPlanPicture } from "@/modules/volunteers/plan";
import { decodeFlash } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { planSummaryOf } from "../../helpers/volunteer-plan";

/**
 * §952, BR-REQ-050-02, BR-REQ-060-01 — the picture of «Planul voluntarilor» (the owner, 2026-11-16, with a picture of the route
 * and its volunteers' points numbered on it: «trebui sa pot incarca si planul voluntarilor pe traseu in genul [pozei]»), from a
 * real database:
 *
 * - whoever works the volunteers sets, changes and takes off an event's one picture; each change is one audit row naming the
 *   event and the pictures' ids and nothing else; a press that changes nothing writes nothing; the id must name a stored
 *   picture; the Tehnic role, the Redactor, a desk Volunteer and a member are refused with nothing written;
 * - the plan reads the picture — the whole of it and a display size — beside everything it read before;
 * - the reference check counts it: the sweep keeps it, the pictures page's delete is refused and the list names the plan, and
 *   once it is taken off and old enough the sweep takes it;
 * - the Server Actions ask the capability at their own door, and say what happened;
 * - the page draws it above the points, a link to the whole picture around it, with «Schimbă poza» and «Șterge poza», in both
 *   languages; on paper the picture is one piece and the controls are not there; with no picture the page reads as before,
 *   plus the upload;
 * - a series' dates, a copy and the event's file do not carry it.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  locale: "ro" as "ro" | "en",
  redirected: [] as string[],
  /** The capabilities the actions asked at their door, by name. */
  asked: [] as string[],
  /** The flash cookies the actions wrote. */
  flashed: [] as string[],
  /** How many times the service was reached. */
  serviceCalls: 0,
  /** Whether this environment has a store for pictures. */
  storage: true,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale?: "ro" | "en"; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? state.locale : (arg.locale ?? state.locale);
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => state.locale,
  getFormatter: async () => createFormatter({ locale: state.locale, timeZone: "Europe/Bucharest" }),
  setRequestLocale: () => undefined,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: (_name: string, value: string) => void state.flashed.push(value), delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The house's typed routing, reduced to what the screens ask of it (`plan.test.ts`'s stand-in).
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string>; query?: Record<string, string> };
  const hrefOf = (locale: string, href: Href) => {
    if (typeof href === "string") return `/${locale}${href}`;
    let path = href.pathname;
    for (const [key, value] of Object.entries(href.params ?? {})) path = path.replace(`[${key}]`, value);
    const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : "";
    return `/${locale}${path}${query}`;
  };
  return {
    getPathname: ({ locale, href }: { locale: string; href: Href }) => hrefOf(locale, href),
    Link: ({ href, children, ...rest }: { href: Href; children?: ReactNode } & Record<string, unknown>) => createElement("a", { href: hrefOf(state.locale, href), ...rest }, children),
  };
});
// The session's door as the real one answers (`session.ts#requireStaffCapability`): the predicate asked of the actor, by name.
vi.mock("@/modules/staff-identity/session", async () => {
  const { DomainError } = await import("@/shared/errors/domain-error");
  return {
    DEV_STAFF_COOKIE: "dev-staff",
    requireStaff: async () => state.actor,
    requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
      state.asked.push(capability.name);
      if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "the door refused");
      return state.actor;
    },
  };
});
// The service itself, counted: a press refused at the action's door never reaches it.
vi.mock("@/modules/volunteers/plan", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/volunteers/plan")>();
  return {
    ...real,
    setVolunteerPlanPicture: (...args: Parameters<typeof real.setVolunteerPlanPicture>) => {
      state.serviceCalls += 1;
      return real.setVolunteerPlanPicture(...args);
    },
  };
});
// A store there or not, as a deployment without its bucket has none (`STORAGE_MODE`).
vi.mock("@/modules/media/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/media/storage")>()),
  isStorageConfigured: () => state.storage,
}));

const { default: VolunteerPlanPage } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/page");
const { removePlanPictureAction, setPlanPictureAction } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/actions");
const { default: AdminPicturesPage } = await import("@/app/[locale]/admin/gallery/pictures/page");

const NOW = new Date("2026-11-16T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const later = (days: number) => new Date(NOW.getTime() + days * DAY);

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
let otherId: string;
const points = { junction: "", water: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function person(role: StaffRole): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Staff ${role}`, role }).returning();
  return row;
}

/** A stored picture as an upload leaves it: a ladder's version-8 prefix (§414) unless another is given. */
async function storedPicture(over: { keyPrefix?: string; width?: number; height?: number; name?: string } = {}) {
  const [row] = await db
    .insert(mediaAssets)
    .values({
      keyPrefix: over.keyPrefix ?? ladderKeyPrefixOf(randomUUID()),
      originalFilename: over.name ?? "harta-cu-puncte.png",
      width: over.width ?? 2400,
      height: over.height ?? 1600,
      byteSize: 1000,
      createdAt: NOW,
      lastReferencedAt: NOW,
    })
    .returning();
  return row;
}

beforeEach(async () => {
  await resetTables(db);
  Object.assign(state, { locale: "ro", storage: true, serviceCalls: 0 });
  state.redirected.length = 0;
  state.asked.length = 0;
  state.flashed.length = 0;
  for (const role of ["MEMBER", "CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"] as const) staff[role] = await person(role);
  state.actor = staff.MODERATOR;
  const [race, other] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-10-01T00:00:00.000Z") },
      { type: "RACE", startsAt: new Date("2026-12-05T08:00:00.000Z"), acceptsVolunteers: true },
    ])
    .returning({ id: events.id });
  raceId = race.id;
  otherId = other.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
    { eventId: otherId, locale: "ro", slug: `altul-${otherId.slice(0, 8)}`, title: "Alt cros" },
    { eventId: otherId, locale: "en", slug: `other-${otherId.slice(0, 8)}`, title: "Another cross" },
  ]);
  const [junction, water] = await db
    .insert(eventCheckpoints)
    .values([
      { eventId: raceId, km: "1.20", nameRo: "Intersecția Stejeriș", nameEn: "Stejeriș junction", kinds: ["DIRECTION"], position: 0 },
      { eventId: raceId, km: "5.50", nameRo: "Apă la cabană", nameEn: "Water at the hut", kinds: ["WATER"], position: 1 },
    ])
    .returning({ id: eventCheckpoints.id });
  points.junction = junction.id;
  points.water = water.id;
  await db.insert(eventVolunteers).values({
    eventId: raceId,
    name: "Ana Pop",
    email: "ana.pop@example.test",
    canonicalEmail: "ana.pop@example.test",
    canonicalizationVersion: 1,
    phone: "+40700000001",
    source: "PUBLIC",
    state: "CONFIRMED",
    checkpointId: points.junction,
    createdAt: NOW,
    updatedAt: NOW,
  });
});

/** Each press a second after the one before unless it is given its moment, so the trail reads in the order of the presses. */
let presses = 0;
const setPicture = (actor: StaffUser, assetId: unknown, eventId = raceId, at?: Date) =>
  setVolunteerPlanPicture(db, actor, { eventId, assetId }, at ?? new Date(NOW.getTime() + ++presses * 1000));
const rowOf = async (id = raceId) => (await db.select().from(events).where(eq(events.id, id)))[0];
const trail = async () =>
  (await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt))).filter((row) => row.action === "event.volunteer_plan_picture_set" || row.action === "event.volunteer_plan_picture_removed");
const assetThere = async (id: string) => (await db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, id))).length === 1;

/** A page as the server streams it, Suspense settled; React's separators out of the way — and Emotion's styles too, unless asked for. */
async function html(page: ReactElement, keepStyles = false): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  const markup = (await new Response(stream).text()).replace(/<!-- -->/g, "");
  return keepStyles ? markup : markup.replace(/<style[\s\S]*?<\/style>/g, "");
}
const planPage = async (query: Record<string, string> = {}, id = raceId, keepStyles = false) =>
  html(await VolunteerPlanPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve(query) }), keepStyles);
const picturesPage = async () => html(await AdminPicturesPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({}) }));

/** The opening tag of the element carrying `testid`. */
const tagOf = (page: string, testid: string) => page.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`))?.[0] ?? "";
/** Everything Emotion wrote for the page, and the generated classes of one element. */
const cssOf = (page: string) => [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");
const classesOf = (page: string, testid: string) => (tagOf(page, testid).match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter((name) => name.startsWith("css-"));
/** What the element's own rule says, on screen and inside `@media print`. */
function rulesOf(page: string, testid: string): { screen: string; print: string } {
  const css = cssOf(page);
  const classes = classesOf(page, testid);
  expect(classes.length, `${testid} carries a generated class`).toBeGreaterThan(0);
  const escaped = classes.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const all = (pattern: (name: string) => RegExp) => escaped.flatMap((name) => [...css.matchAll(pattern(name))].map((match) => match[1])).join(";");
  return {
    screen: all((name) => new RegExp(`(?:^|\\}|\\s)\\.${name}\\{([^}]*)\\}`, "g")),
    print: all((name) => new RegExp(`@media print\\{\\.${name}\\{([^}]*)\\}`, "g")),
  };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: raceId, ...fields })) data.set(key, value);
  return data;
}
async function press(action: (form: FormData) => Promise<void>, fields: Record<string, string> = {}): Promise<string> {
  state.redirected.length = 0;
  state.flashed.length = 0;
  await expect(action(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  return state.redirected[0];
}
const toasted = () => state.flashed.map((value) => decodeFlash(value)?.key);

describe("§952 the plan's picture: set, changed and taken off", () => {
  it("lets the Organizer put a stored picture on the plan, audited with the ids alone, and moves nothing else of the event", async () => {
    const picture = await storedPicture();
    const before = await rowOf();
    expect(before.volunteerPlanMediaAssetId).toBeNull();

    expect(await setPicture(staff.MODERATOR!, picture.id)).toEqual({ changed: true, outcome: "set" });

    const after = await rowOf();
    expect(after.volunteerPlanMediaAssetId).toBe(picture.id);
    // The version, the dates, the cover, every setting: as they were — an open editor's save is not made stale.
    expect({ ...after, volunteerPlanMediaAssetId: null }).toEqual(before);

    const rows = await trail();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "event.volunteer_plan_picture_set", actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: raceId });
    // The event and the pictures' ids — never a file's name, an address or anything of a person.
    expect(rows[0].metadataJson).toEqual({ assetId: picture.id, replaced: null });
    expect(JSON.stringify(rows[0].metadataJson)).not.toMatch(/harta|png|Crosul|Ana/);
  });

  it("writes nothing for a press that changes nothing, and says which picture another one replaced", async () => {
    const first = await storedPicture();
    const second = await storedPicture({ name: "harta-noua.png" });
    await setPicture(staff.ADMIN!, first.id);
    expect(await setPicture(staff.ADMIN!, first.id)).toEqual({ changed: false });
    // The same id as a person would paste it: upper case, a space around it.
    expect(await setPicture(staff.ADMIN!, ` ${first.id.toUpperCase()} `)).toEqual({ changed: false });
    expect(await trail()).toHaveLength(1);

    expect(await setPicture(staff.SUPERADMIN!, second.id)).toEqual({ changed: true, outcome: "replaced" });
    expect((await rowOf()).volunteerPlanMediaAssetId).toBe(second.id);
    const rows = await trail();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ action: "event.volunteer_plan_picture_set", actorStaffUserId: staff.SUPERADMIN!.id, entityId: raceId });
    expect(rows[1].metadataJson).toEqual({ assetId: second.id, replaced: first.id });
    // The picture it replaced is not deleted by the press: used nowhere, it waits for the sweep (§73).
    expect(await assetThere(first.id)).toBe(true);
  });

  it("takes the picture off with no value, audited with the id it was, and keeps the stored picture for the sweep", async () => {
    const picture = await storedPicture();
    await setPicture(staff.MODERATOR!, picture.id);

    expect(await setPicture(staff.MODERATOR!, null)).toEqual({ changed: true, outcome: "removed" });
    expect((await rowOf()).volunteerPlanMediaAssetId).toBeNull();
    const rows = await trail();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ action: "event.volunteer_plan_picture_removed", actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: raceId });
    expect(rows[1].metadataJson).toEqual({ assetId: picture.id });
    expect(await assetThere(picture.id)).toBe(true);

    // Off already: nothing to do, however "no picture" was posted.
    for (const none of ["", "   ", null, undefined]) expect(await setPicture(staff.MODERATOR!, none)).toEqual({ changed: false });
    expect(await trail()).toHaveLength(2);
  });

  it("is one picture an event: another event's plan is its own", async () => {
    const picture = await storedPicture();
    await setPicture(staff.ADMIN!, picture.id);
    expect((await rowOf(otherId)).volunteerPlanMediaAssetId).toBeNull();
    expect((await readVolunteerPlan(db, staff.ADMIN!, otherId)).picture).toBeNull();
  });

  it("refuses the Tehnic role, the Redactor, a desk Volunteer and a member, with nothing written (BR-REQ-060-01)", async () => {
    const picture = await storedPicture();
    const kept = await storedPicture({ name: "harta-pastrata.png" });
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      await expect(setPicture(staff[role]!, picture.id), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(readVolunteerPlan(db, staff[role]!, raceId), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await rowOf()).volunteerPlanMediaAssetId).toBeNull();
    expect(await trail()).toHaveLength(0);

    // Nor may they change or take off the one that is there — refused before the event or the picture is so much as read.
    await setPicture(staff.ADMIN!, kept.id);
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      await expect(setPicture(staff[role]!, picture.id), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(setPicture(staff[role]!, null), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(setPicture(staff[role]!, "not-an-id", "not-an-id"), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await rowOf()).volunteerPlanMediaAssetId).toBe(kept.id);
    expect(await trail()).toHaveLength(1);
  });

  it("asks for an event that is there", async () => {
    const picture = await storedPicture();
    await expect(setPicture(staff.ADMIN!, picture.id, "11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setPicture(staff.ADMIN!, picture.id, "not-an-id")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setPicture(staff.ADMIN!, null, "11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await trail()).toHaveLength(0);
  });

  it("asks for a stored picture: an id that names none, a film's poster and a value that is no id are refused, naming the box", async () => {
    const kept = await storedPicture();
    await setPicture(staff.ADMIN!, kept.id);
    // A film's automatic poster (§485) is a row of the store and no picture to put on a plan.
    const poster = await storedPicture({ keyPrefix: "yt-dQw4w9WgXcQ", width: 1280, height: 720 });
    for (const value of ["11111111-1111-4111-8111-111111111111", poster.id, "the map", 42, { id: kept.id }, ["x"]]) {
      await expect(setPicture(staff.ADMIN!, value), JSON.stringify(value)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["assetId"] });
    }
    // Nothing moved: the picture that was there is still the plan's, and the trail has its one row.
    expect((await rowOf()).volunteerPlanMediaAssetId).toBe(kept.id);
    expect(await trail()).toHaveLength(1);
  });
});

describe("§952 the plan reads its picture", () => {
  it("returns none without one, and everything the plan returned before", async () => {
    const plan = await readVolunteerPlan(db, staff.MODERATOR!, raceId);
    expect(plan.picture).toBeNull();
    expect(plan.points.map(({ number, point }) => [number, point.nameRo])).toEqual([
      [1, "Intersecția Stejeriș"],
      [2, "Apă la cabană"],
    ]);
    expect(plan.points[0].people.map((one) => one.name)).toEqual(["Ana Pop"]);
    expect(plan.unplaced).toEqual([]);
    expect(plan.roles).toBeInstanceOf(Map);
  });

  it("returns the whole picture and a display size of it, at the store's public addresses", async () => {
    const picture = await storedPicture({ width: 2400, height: 1600 });
    await setPicture(staff.ADMIN!, picture.id);
    const { picture: read } = await readVolunteerPlan(db, staff.MODERATOR!, raceId);

    const storage = getStorage();
    const full = storage.publicUrl(objectKey(picture.keyPrefix, "web"));
    expect(read).toEqual({
      assetId: picture.id,
      width: 2400,
      height: 1600,
      fullUrl: full,
      displayUrl: storage.publicUrl(objectKey(picture.keyPrefix, PLAN_PICTURE_DISPLAY_WIDTH)),
      srcSet: expect.stringContaining(`${full} 2400w`),
    });
    // Absolute, so a page and a message can carry them alike; the ladder below the master for a screen that chooses.
    expect(read!.fullUrl).toMatch(/^https?:\/\/.+\/web\.webp$/);
    expect(read!.displayUrl).toMatch(/^https?:\/\/.+\/1280w\.webp$/);
    expect(read!.srcSet).toContain("/480w.webp 480w");
    expect(read!.srcSet).toContain("/1920w.webp 1920w");
  });

  it("takes the widest stored file under the display size, and the master itself for a small picture or one stored before the ladder", async () => {
    const full = (prefix: string) => getStorage().publicUrl(objectKey(prefix, "web"));

    // 1000 pixels wide: its rungs are 480 and 640 — the display size is the wider.
    const medium = await storedPicture({ width: 1000, height: 700 });
    await setPicture(staff.ADMIN!, medium.id);
    expect((await readVolunteerPlan(db, staff.ADMIN!, raceId)).picture).toMatchObject({ displayUrl: getStorage().publicUrl(objectKey(medium.keyPrefix, 640)), fullUrl: full(medium.keyPrefix) });

    // 500 pixels wide: no rung under it — the master is both.
    const small = await storedPicture({ width: 500, height: 300 });
    await setPicture(staff.ADMIN!, small.id);
    expect((await readVolunteerPlan(db, staff.ADMIN!, raceId)).picture).toMatchObject({ displayUrl: full(small.keyPrefix), fullUrl: full(small.keyPrefix), srcSet: `${full(small.keyPrefix)} 500w` });

    // Stored before the ladder (a version-4 prefix, §414): one file, and no `srcset` naming files that do not exist.
    const old = await storedPicture({ keyPrefix: randomUUID(), width: 2400, height: 1600 });
    await setPicture(staff.ADMIN!, old.id);
    const read = (await readVolunteerPlan(db, staff.ADMIN!, raceId)).picture;
    expect(read).toMatchObject({ displayUrl: full(old.keyPrefix), fullUrl: full(old.keyPrefix) });
    expect(read!.srcSet).toBeUndefined();
  });

  it("reads an id that names nothing, and an environment with no store, as no picture", async () => {
    const picture = await storedPicture();
    await setPicture(staff.ADMIN!, picture.id);

    state.storage = false;
    expect((await readVolunteerPlan(db, staff.ADMIN!, raceId)).picture).toBeNull();
    state.storage = true;
    expect((await readVolunteerPlan(db, staff.ADMIN!, raceId)).picture).not.toBeNull();

    // The column has no foreign key (`events.ts` says why): a row deleted by hand leaves the id, and the plan no picture.
    await db.delete(mediaAssets).where(eq(mediaAssets.id, picture.id));
    expect((await rowOf()).volunteerPlanMediaAssetId).toBe(picture.id);
    const plan = await readVolunteerPlan(db, staff.ADMIN!, raceId);
    expect(plan.picture).toBeNull();
    expect(plan.points).toHaveLength(2);
    // …and another picture can still take its place.
    const next = await storedPicture();
    expect(await setPicture(staff.ADMIN!, next.id)).toEqual({ changed: true, outcome: "replaced" });
  });
});

describe("§952 a picture used as a plan's is the plan's (the reference check, §73)", () => {
  it("is kept by the sweep, refused by the pictures page's delete, and listed as used by the event's plan", async () => {
    const picture = await storedPicture();
    await getStorage().put(objectKey(picture.keyPrefix, "web"), Buffer.from("web"), "image/webp");
    await getStorage().put(objectKey(picture.keyPrefix, "thumb"), Buffer.from("thumb"), "image/webp");
    await setPicture(staff.MODERATOR!, picture.id);

    // A month on, used by nothing but the plan: still there.
    expect(await sweepOrphanAssets(db, later(30))).toBe(0);
    expect(await assetThere(picture.id)).toBe(true);
    expect(await countMediaAssets(db, later(30))).toMatchObject({ total: 1, unreferenced: 0, sweepable: 0 });
    await expect(deleteMediaAsset(db, { actor: { id: staff.ADMIN!.id, role: "ADMIN" }, assetId: picture.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const listed = (await listMediaAssetsForAdmin(db, "ro")).find((row) => row.id === picture.id);
    expect(listed?.references).toEqual([{ kind: "volunteerPlan", id: raceId, title: "Crosul" }]);
    expect((await listMediaAssetsForAdmin(db, "en")).find((row) => row.id === picture.id)?.references).toEqual([{ kind: "volunteerPlan", id: raceId, title: "The cross" }]);
  });

  it("is the sweep's once it is taken off and old enough — the row and its files", async () => {
    const picture = await storedPicture();
    const web = objectKey(picture.keyPrefix, "web");
    await getStorage().put(web, Buffer.from("web"), "image/webp");
    await setPicture(staff.MODERATOR!, picture.id);
    // The sweep saw it used a month on…
    expect(await sweepOrphanAssets(db, later(30))).toBe(0);
    // …then «Șterge poza»: used nowhere, and listed so.
    await setPicture(staff.MODERATOR!, null, raceId, later(30));
    expect((await listMediaAssetsForAdmin(db, "ro")).find((row) => row.id === picture.id)?.references).toEqual([]);
    expect(await countMediaAssets(db, later(31))).toMatchObject({ total: 1, unreferenced: 1, sweepable: 0 });

    // Not old enough the next day: its week of grace runs from when it was last seen used.
    expect(await sweepOrphanAssets(db, later(31))).toBe(0);
    expect(await assetThere(picture.id)).toBe(true);
    // Eight days after: gone, with its files.
    expect(await sweepOrphanAssets(db, later(38))).toBe(1);
    expect(await assetThere(picture.id)).toBe(false);
    expect(await getStorage().get(web)).toBeNull();
  });

  it("keeps a picture two plans use until both let go of it", async () => {
    const picture = await storedPicture();
    await setPicture(staff.ADMIN!, picture.id);
    await setPicture(staff.ADMIN!, picture.id, otherId);
    await setPicture(staff.ADMIN!, null);
    expect(await sweepOrphanAssets(db, later(60))).toBe(0);
    await setPicture(staff.ADMIN!, null, otherId, later(60));
    expect(await sweepOrphanAssets(db, later(70))).toBe(1);
  });

  it("is no picture of the event's texts: «Din galerie» gives it no chip and «Acest eveniment» does not offer it", () => {
    expect(pictureUses(["volunteerPlan"])).toEqual([]);
    expect(pictureUses(["volunteerPlan", "event", "album"])).toEqual(["event", "album"]);
    expect(usedHere([{ kind: "volunteerPlan", id: raceId }], { kind: "event", id: raceId })).toBe(false);
  });

  it("is named on the pictures page with a link to the plan — and in words alone for a role the plan is a 404 for", async () => {
    const picture = await storedPicture();
    await setPicture(staff.ADMIN!, picture.id);
    const planHref = `href="/ro/admin/events/${raceId}/plan-voluntari"`;

    const forOrganizer = await picturesPage();
    expect(forOrganizer).toContain("Planul voluntarilor: Crosul");
    expect(forOrganizer).toContain(planHref);
    // Never as a picture of the event's editor, where it is not.
    expect(forOrganizer).not.toContain("Eveniment: Crosul");

    // The Tehnic role reads the pictures page and may not open a plan: the words, no link.
    state.actor = staff.DEV;
    const forTehnic = await picturesPage();
    expect(forTehnic).toContain("Planul voluntarilor: Crosul");
    expect(forTehnic).not.toContain(planHref);

    state.actor = staff.MODERATOR;
    state.locale = "en";
    expect(await picturesPage()).toContain("The volunteers&#x27; plan: The cross");
  });
});

describe("§952 the page's presses: «Încarcă poza planului», «Schimbă poza», «Șterge poza»", () => {
  const back = () => `/ro/admin/events/${raceId}/plan-voluntari#plan-picture`;

  it("records the uploaded picture, changes it and takes it off, coming back to the picture and saying what happened", async () => {
    const first = await storedPicture();
    const second = await storedPicture();

    expect(await press(setPlanPictureAction, { assetId: first.id })).toBe(back());
    expect((await rowOf()).volunteerPlanMediaAssetId).toBe(first.id);
    expect(toasted()).toEqual(["planPictureSet"]);

    // The same picture again: nothing to change, said so.
    expect(await press(setPlanPictureAction, { assetId: first.id })).toBe(back());
    expect(toasted()).toEqual(["volunteerUnchanged"]);

    expect(await press(setPlanPictureAction, { assetId: second.id })).toBe(back());
    expect((await rowOf()).volunteerPlanMediaAssetId).toBe(second.id);
    expect(toasted()).toEqual(["planPictureReplaced"]);

    expect(await press(removePlanPictureAction)).toBe(back());
    expect((await rowOf()).volunteerPlanMediaAssetId).toBeNull();
    expect(toasted()).toEqual(["planPictureRemoved"]);
    expect(await press(removePlanPictureAction)).toBe(back());
    expect(toasted()).toEqual(["volunteerUnchanged"]);

    // Every press asked the capability at the action's own door, by name.
    expect(state.asked).toEqual(Array.from({ length: 5 }, () => "canManageVolunteers"));
    // One row a change, none for the two presses that changed nothing (the presses' own clock is the real one: counted, not ordered).
    expect((await trail()).map((row) => row.action).sort()).toEqual(["event.volunteer_plan_picture_removed", "event.volunteer_plan_picture_set", "event.volunteer_plan_picture_set"]);
  });

  it("every toast it writes has its sentence in both languages", () => {
    for (const key of ["planPictureSet", "planPictureReplaced", "planPictureRemoved", "volunteerUnchanged"] as const) {
      expect(ro.Feedback.toast[key], key).toEqual(expect.any(String));
      expect(en.Feedback.toast[key], key).toEqual(expect.any(String));
    }
    for (const code of ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR"] as const) {
      expect(ro.Admin.errors[code], code).toEqual(expect.any(String));
      expect(en.Admin.errors[code], code).toEqual(expect.any(String));
    }
  });

  it("refuses the upload's form with no picture in it — taking the picture off is only «Șterge poza»", async () => {
    const picture = await storedPicture();
    await setPicture(staff.ADMIN!, picture.id);
    for (const assetId of ["", "   "]) {
      expect(await press(setPlanPictureAction, { assetId })).toBe(`/ro/admin/events/${raceId}/plan-voluntari?planError=VALIDATION_ERROR#admin-alert`);
    }
    expect((await rowOf()).volunteerPlanMediaAssetId).toBe(picture.id);
    expect(toasted()).toEqual([]);
    // The page says the refusal in words.
    expect(await planPage({ planError: "VALIDATION_ERROR" })).toContain(ro.Admin.errors.VALIDATION_ERROR);
  });

  it("comes back with the refusal's code for a picture that is not one, and to the volunteers' screen for a form with no event", async () => {
    expect(await press(setPlanPictureAction, { assetId: "11111111-1111-4111-8111-111111111111" })).toContain("planError=VALIDATION_ERROR#admin-alert");
    expect(await press(setPlanPictureAction, { assetId: "the map" })).toContain("planError=VALIDATION_ERROR#admin-alert");
    expect((await rowOf()).volunteerPlanMediaAssetId).toBeNull();

    const picture = await storedPicture();
    expect(await press(setPlanPictureAction, { assetId: picture.id, eventId: "not-an-id" })).toBe("/ro/admin/volunteers");
    expect(await press(removePlanPictureAction, { eventId: "" })).toBe("/ro/admin/volunteers");
    expect(await trail()).toHaveLength(0);
  });

  it("refuses the Tehnic role, the Redactor, a desk Volunteer and a member at the action's own door: the service is never reached", async () => {
    const kept = await storedPicture();
    const wanted = await storedPicture();
    await setPicture(staff.ADMIN!, kept.id);
    state.serviceCalls = 0;
    state.asked.length = 0;

    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      expect(await press(setPlanPictureAction, { assetId: wanted.id }), role).toBe(`/ro/admin/events/${raceId}/plan-voluntari?planError=FORBIDDEN#admin-alert`);
      expect(await press(removePlanPictureAction), role).toBe(`/ro/admin/events/${raceId}/plan-voluntari?planError=FORBIDDEN#admin-alert`);
    }
    expect(state.asked).toEqual(Array.from({ length: 8 }, () => "canManageVolunteers"));
    expect(state.serviceCalls).toBe(0);
    expect((await rowOf()).volunteerPlanMediaAssetId).toBe(kept.id);
    expect(await trail()).toHaveLength(1);
    expect(toasted()).toEqual([]);
  });
});

describe("§952 the plan's page draws the picture", () => {
  it("reads as before with no picture, plus the upload", async () => {
    const page = await planPage();
    // The plan as it was.
    expect(page).toContain(ro.Admin.volunteers.plan.title);
    // Four numbers since the plan has two kinds of points (§961): nobody at the start–finish, one person on the route.
    expect(planSummaryOf(page)).toBe("0 voluntari la start–finish · 1 voluntar pe traseu · 0 voluntari fără punct · 1 punct fără nimeni");
    expect(page).toContain("1. 1,2 km — Intersecția Stejeriș");

    // No picture, no link to one, no «Șterge poza».
    expect(page).not.toContain('data-testid="plan-picture"');
    expect(page).not.toContain("<img");
    expect(page).not.toContain('data-testid="plan-picture-remove-form"');
    expect(page).not.toContain(ro.Admin.volunteers.plan.picture.remove);
    expect(page).not.toContain(ro.Admin.volunteers.plan.picture.replace);

    // The section, what to do, and the upload: the form the island sends, with the event in it and the picture's box empty.
    expect(page).toContain(ro.Admin.volunteers.plan.picture.title);
    expect(page).toContain(ro.Admin.volunteers.plan.picture.none);
    const upload = page.slice(page.indexOf('data-testid="plan-picture-form"'), page.indexOf('data-testid="plan-summary"'));
    expect(upload).toContain(`name="eventId" value="${raceId}"`);
    expect(upload).toContain('name="uiLocale" value="ro"');
    expect(upload).toMatch(/<input[^>]*type="hidden"[^>]*name="assetId"[^>]*value=""/);
    expect(upload).toContain(ro.Admin.volunteers.plan.picture.upload);
    expect(upload).toMatch(/<input[^>]*id="plan-picture-file"[^>]*type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
    // The button is the file input's label, and the quality stands beside the upload as beside every upload (§414).
    expect(tagOf(page, "plan-picture-upload")).toMatch(/^<label[^>]*for="plan-picture-file"/);
    expect(upload).toContain('data-testid="image-quality"');
    expect(upload).toContain(ro.Admin.volunteers.plan.picture.help);
  });

  it("draws the picture above the points, as wide as the column, a press opening the whole of it in a new tab", async () => {
    const stored = await storedPicture({ width: 2400, height: 1600 });
    await setPicture(staff.ADMIN!, stored.id);
    const { picture } = await readVolunteerPlan(db, staff.ADMIN!, raceId);
    const page = await planPage();

    // Above the summary and the first point.
    const at = (needle: string) => page.indexOf(needle);
    expect(at('data-testid="plan-picture"')).toBeGreaterThan(at(ro.Admin.volunteers.plan.title));
    expect(at('data-testid="plan-picture"')).toBeLessThan(at('data-testid="plan-summary"'));
    expect(at('data-testid="plan-summary"')).toBeLessThan(at('data-testid="plan-point"'));

    // The link is the whole picture, in a new tab, named for a reader who does not see it.
    const link = tagOf(page, "plan-picture-link");
    expect(link).toMatch(/^<a /);
    expect(link).toContain(`href="${picture!.fullUrl}"`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(link).toContain(`aria-label="${ro.Admin.volunteers.plan.picture.open}"`);

    // The image: the display size, the ladder for a screen that chooses, its own size so the page does not jump.
    const image = tagOf(page, "plan-picture-image");
    expect(image).toMatch(/^<img /);
    expect(image).toContain(`src="${picture!.displayUrl}"`);
    expect(image).toMatch(/srcSet="[^"]*\/480w\.webp 480w[^"]*\/web\.webp 2400w"/i);
    expect(image).toContain('sizes="(min-width: 1536px) 1488px, (min-width: 600px) calc(100vw - 48px), calc(100vw - 32px)"');
    expect(image).toContain(`alt="${ro.Admin.volunteers.plan.picture.alt}"`);
    expect(image).toContain('width="2400"');
    expect(image).toContain('height="1600"');
    expect(page).toContain(ro.Admin.volunteers.plan.picture.openHint);
    expect(page).not.toContain(ro.Admin.volunteers.plan.picture.none);

    // «Schimbă poza» in the upload's form, «Șterge poza» in its own, each with the event.
    const controls = page.slice(at('data-testid="plan-picture-controls"'), at('data-testid="plan-summary"'));
    expect(tagOf(page, "plan-picture-upload")).toMatch(/^<label[^>]*for="plan-picture-file"/);
    expect(controls).toContain(ro.Admin.volunteers.plan.picture.replace);
    expect(controls).not.toContain(ro.Admin.volunteers.plan.picture.upload);
    const remove = controls.slice(controls.indexOf('data-testid="plan-picture-remove-form"'));
    expect(remove).toContain(`name="eventId" value="${raceId}"`);
    expect(remove).toMatch(/<button[^>]*type="submit"[^>]*>/);
    expect(remove).toContain(ro.Admin.volunteers.plan.picture.remove);
    // The remove form posts no picture: it cannot be turned into a set.
    expect(remove).not.toContain('name="assetId"');
  });

  it("is in English for an English reader", async () => {
    const stored = await storedPicture();
    state.locale = "en";
    // As the markup carries an apostrophe and a quotation mark — the help names the button that sends the picture (§956).
    const escaped = (text: string) => text.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

    const bare = await planPage();
    expect(bare).toContain(escaped(en.Admin.volunteers.plan.picture.title));
    expect(bare).toContain(escaped(en.Admin.volunteers.plan.picture.none));
    expect(bare).toContain(escaped(en.Admin.volunteers.plan.picture.upload));
    expect(bare).toContain(escaped(en.Admin.volunteers.plan.picture.help));
    expect(bare).toContain('name="uiLocale" value="en"');

    await setPicture(staff.ADMIN!, stored.id);
    const page = await planPage();
    expect(tagOf(page, "plan-picture-link")).toContain(`aria-label="${en.Admin.volunteers.plan.picture.open}"`);
    expect(tagOf(page, "plan-picture-image")).toContain(`alt="${escaped(en.Admin.volunteers.plan.picture.alt)}"`);
    expect(page).toContain(en.Admin.volunteers.plan.picture.openHint);
    expect(page).toContain(en.Admin.volunteers.plan.picture.replace);
    expect(page).toContain(en.Admin.volunteers.plan.picture.remove);
    expect(planSummaryOf(page)).toBe("0 volunteers at the start–finish · 1 volunteer on the route · 0 volunteers at no point · 1 point with nobody");
  });

  it("prints the picture first and in one piece, and none of its controls", async () => {
    const stored = await storedPicture();
    await setPicture(staff.ADMIN!, stored.id);
    const page = await planPage({}, raceId, true);
    const hiddenOnPaper = (testid: string) => /display:none/.test(rulesOf(page, testid).print);

    // On the sheet: the figure and its image — never cut between two pages, never taller than one.
    expect(hiddenOnPaper("plan-picture")).toBe(false);
    expect(hiddenOnPaper("plan-picture-image")).toBe(false);
    expect(rulesOf(page, "plan-picture").screen).toMatch(/break-inside:avoid/);
    expect(rulesOf(page, "plan-picture-image").print).toMatch(/max-height:17cm/);
    expect(rulesOf(page, "plan-picture-image").print).toMatch(/max-width:100%/);
    // On the screen: as wide as the column, and never wider than its own pixels.
    expect(rulesOf(page, "plan-picture-image").screen).toMatch(/width:100%/);
    expect(rulesOf(page, "plan-picture-image").screen).toMatch(/max-width:2400px/);

    // Off the sheet: the island's button and its quality choice, «Șterge poza», and the links above the title.
    expect(hiddenOnPaper("plan-picture-controls")).toBe(true);
    const controls = page.slice(page.indexOf('data-testid="plan-picture-controls"'), page.indexOf('data-testid="plan-summary"'));
    for (const inside of ['data-testid="plan-picture-upload"', 'data-testid="image-quality"', 'data-testid="plan-picture-remove-form"']) expect(controls, inside).toContain(inside);

    // First on the sheet after the points' table, «Punctele, pe scurt» (§NNN, amending §952's «first after the title»): the
    // table is the one thing between the title and the picture that is printed — the picture's own heading and every control
    // are left off the paper — and the points come after it.
    const plain = page.replace(/<style[\s\S]*?<\/style>/g, "");
    const before = plain.slice(plain.indexOf(ro.Admin.volunteers.plan.help), plain.indexOf('data-testid="plan-picture"'));
    expect(before).toContain(ro.Admin.volunteers.plan.picture.title);
    expect(before).toContain('data-testid="plan-table-section"');
    expect(hiddenOnPaper("plan-table-section")).toBe(false);
    expect(before).not.toContain('data-testid="plan-point"');
    expect(before).not.toContain('data-testid="plan-summary"');
    const sectionHeading = page.match(new RegExp(`<h3[^>]*class="([^"]*)"[^>]*>${ro.Admin.volunteers.plan.picture.title}`))?.[1] ?? "";
    const headingClass = sectionHeading.split(/\s+/).find((name) => name.startsWith("css-")) ?? "";
    expect(cssOf(page)).toMatch(new RegExp(`@media print\\{\\.${headingClass}\\{[^}]*display:none`));
  });

  it("gives a thumb 44 pixels on both buttons", async () => {
    const stored = await storedPicture();
    await setPicture(staff.ADMIN!, stored.id);
    const page = await planPage({}, raceId, true);
    expect(rulesOf(page, "plan-picture-upload").screen).toMatch(/min-height:44px/);
    const removeButton = page.slice(page.indexOf('data-testid="plan-picture-remove-form"')).match(/<button[^>]*class="([^"]*)"/)?.[1] ?? "";
    const removeClass = removeButton.split(/\s+/).find((name) => name.startsWith("css-")) ?? "";
    expect(removeClass).not.toBe("");
    expect(cssOf(page)).toMatch(new RegExp(`\\.${removeClass}\\{[^}]*min-height:44px`));
  });

  it("hands the island strings and names only: no component, no element, no icon", () => {
    const source = readFileSync("src/app/[locale]/admin/events/[id]/plan-voluntari/page.tsx", "utf8");
    const call = source.slice(source.indexOf("<PlanPictureUpload"), source.indexOf("</Box>", source.indexOf("<PlanPictureUpload")));
    expect(call).toContain("labels={{");
    // Every prop is a string, a boolean or the labels' strings: nothing drawn is handed across.
    expect(call.slice("<PlanPictureUpload".length)).not.toMatch(/<[A-Za-z]/);
    expect(call).not.toMatch(/Icon\b|icon=/);
    const island = readFileSync("src/modules/volunteers/ui/PlanPictureUpload.tsx", "utf8");
    expect(island.startsWith('"use client";')).toBe(true);
    // Its glyphs come by name from the backoffice's table, through the house's button.
    expect(island).toContain('icon={replaces ? "replace" : "upload"}');
    expect(island).not.toMatch(/@mui\/icons-material/);
    expect(island).toContain("sx={TAP_TARGET}");
  });

  it("offers no upload where there is no store, and draws no picture", async () => {
    const stored = await storedPicture();
    await setPicture(staff.ADMIN!, stored.id);
    state.storage = false;
    const page = await planPage();
    expect(page).toContain(ro.Admin.volunteers.plan.picture.noStorage);
    // …and does not ask for an upload it cannot take.
    expect(page).not.toContain(ro.Admin.volunteers.plan.picture.none);
    expect(page).not.toContain('data-testid="plan-picture-form"');
    expect(page).not.toContain('data-testid="plan-picture-remove-form"');
    expect(page).not.toContain("<img");
    // The plan itself is as it was.
    expect(page).toContain("1. 1,2 km — Intersecția Stejeriș");
  });

  it("is a 404 for the Tehnic role, the Redactor, a desk Volunteer and a member, picture or not", async () => {
    const stored = await storedPicture();
    await setPicture(staff.ADMIN!, stored.id);
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      await expect(planPage(), role).rejects.toThrow("NOT_FOUND");
    }
    // …and the page it is for the three who work the volunteers.
    for (const role of ["MODERATOR", "ADMIN", "SUPERADMIN"] as const) {
      state.actor = staff[role];
      expect(await planPage(), role).toContain('data-testid="plan-picture-controls"');
    }
  });
});

describe("§952 the picture is one edition's: not carried by a series, a copy or the event's file", () => {
  const AT = new Date("2026-09-25T10:00:00.000Z");
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
    registrationMode: "EXTERNAL",
    externalProvider: "Alt club",
    externalRegistrationUrl: "https://alt-club.example.test/inscriere",
    participantListVisibility: "HIDDEN" as const,
    capacity: "",
    registrationOpensAtWallTime: "",
    registrationClosesAtWallTime: "",
    declarationDocumentId: "",
  };
  const words = (slug: string) => ({
    ro: { slug: `crosul-${slug}`, title: `Crosul ${slug}`, excerpt: "Cu plan." },
    en: { slug: `the-cross-${slug}`, title: `The cross ${slug}`, excerpt: "With a plan." },
  });
  const nothingServed = (async () => new Response(null, { status: 404 })) as typeof fetch;

  it("leaves a series' later dates and a copy without it, and the source with its own", async () => {
    const admin = staff.ADMIN!;
    const picture = await storedPicture();
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: words("serie") }, now: AT });
    await setPicture(admin, picture.id, source.id, AT);

    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: AT });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date.volunteerPlanMediaAssetId, date.id).toBeNull();

    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    expect((await rowOf(copy.id)).volunteerPlanMediaAssetId).toBeNull();
    expect((await rowOf(source.id)).volunteerPlanMediaAssetId).toBe(picture.id);
  });

  it("is not in the event's file: an export does not name it, a new event from the file has none, and an import over an event leaves its own", async () => {
    const admin = staff.ADMIN!;
    const picture = await storedPicture();
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: words("sursa") }, now: AT });
    await setPicture(admin, picture.id, source.id, AT);

    const { file } = await exportEvent(db, { actor: admin, eventId: source.id, now: AT });
    const text = serializeEventFile(file);
    expect(text).not.toContain(picture.id);
    expect(text).not.toContain(picture.keyPrefix);
    expect(text).not.toMatch(/volunteerPlan|volunteer_plan|planPicture/i);
    const read = readEventFile(text);
    if (!read.ok) throw new Error(`the export did not read back: ${read.refusal} ${read.detail ?? ""}`);

    const created = await importEventAsNew(db, { actor: admin, file: read.file, fetchImpl: nothingServed, now: AT });
    expect((await rowOf(created.eventId)).volunteerPlanMediaAssetId).toBeNull();

    // Over the event itself, once its distance has moved since the file was made: the import writes the file's distance
    // back through the editor's own save, and the plan's picture — which no file names — stays where it was.
    await db.update(events).set({ distanceMeters: 5000 }).where(eq(events.id, source.id));
    const diff = await diffEventImport(db, { actor: admin, file: read.file, eventId: source.id });
    const over = await importEventOver(db, {
      actor: admin,
      file: read.file,
      eventId: source.id,
      expectedVersion: diff.target.version,
      translationVersions: diff.target.translationVersions,
      fetchImpl: nothingServed,
      now: AT,
    });
    expect(over.changed.length).toBeGreaterThan(0);
    const after = await rowOf(source.id);
    expect(after.distanceMeters).toBe(10_000);
    expect(after.volunteerPlanMediaAssetId).toBe(picture.id);
    // The trail of the plan's picture has the one press made here and nothing an import wrote.
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "event.volunteer_plan_picture_set"), eq(auditLogs.entityId, source.id)))).toHaveLength(1);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.volunteer_plan_picture_removed"))).toHaveLength(0);
  });
});
