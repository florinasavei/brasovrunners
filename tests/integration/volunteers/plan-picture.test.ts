import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { mediaAssets } from "@/db/schema/gallery";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { eventVolunteerPlanLinks, eventVolunteerPlanPictures, PLAN_PICTURES_MAX } from "@/db/schema/volunteer-plan";
import { createEvent, duplicateEvent, repeatEvent } from "@/modules/content/events/service";
import { exportEvent } from "@/modules/content/events/transfer/export";
import { readEventFile, serializeEventFile } from "@/modules/content/events/transfer/file-format";
import { diffEventImport, importEventAsNew, importEventOver } from "@/modules/content/events/transfer/import";
import { ladderKeyPrefixOf } from "@/modules/media/ladder";
import { pictureUses, usedHere } from "@/modules/media/picker";
import { countMediaAssets, deleteMediaAsset, listMediaAssetsForAdmin, sweepOrphanAssets } from "@/modules/media/references";
import { getStorage, objectKey } from "@/modules/media/storage";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { addVolunteerPlanLink, addVolunteerPlanPicture, PLAN_PICTURE_DISPLAY_WIDTH, readVolunteerPlan, readVolunteerPlanMaps, removeVolunteerPlanPicture } from "@/modules/volunteers/plan";
import { decodeFlash } from "@/shared/feedback/notice";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { drawnOpen, elementWith, planPointBar, planPointsOf, planSummaryOf } from "../../helpers/volunteer-plan";

/**
 * §952 amended by §978 («Poze și hărți»), BR-REQ-050-02, BR-REQ-060-01 — the pictures of «Planul voluntarilor» (the owner,
 * 2026-11-16, with a picture of the route and its volunteers' points numbered on it: «trebui sa pot incarca si planul
 * voluntarilor pe traseu in genul [pozei]»; and 2026-11-18: «Poza planului trebuie sa fie mai sus, si sa pot pune mai multe
 * poze»), from a real database:
 *
 * - whoever works the volunteers adds stored pictures to an event's plan, each going last, and takes one off; twelve at most;
 *   one already there changes nothing; each change is one audit row naming the event and the stored picture's id and nothing
 *   else; the event's row does not move; the id must name a stored picture; the Tehnic role, the Redactor, a desk Volunteer
 *   and a member are refused with nothing written;
 * - the plan reads them in their order — the whole of each and a display size — beside everything it read before;
 * - the reference check counts them: the sweep keeps them, the pictures page's delete is refused and the list names the plan;
 *   once taken off and old enough the sweep takes them; the retired column of §952 is still counted;
 * - the Server Actions ask the capability at their own door, and say what happened;
 * - the page draws them in «Poze și hărți», the first fold, open when it holds something, in a grid, each a link to the whole
 *   of it, with «Șterge poza» under each and «Adaugă o poză», in both languages; a press comes back with the fold open; on
 *   paper the fold prints after the rest of the plan, each picture one piece, its controls off the sheet;
 * - a series' dates, a copy and the event's file do not carry them; deleting the event deletes them.
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
  /** How many times a service was reached. */
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
// The services themselves, counted: a press refused at the action's door never reaches them.
vi.mock("@/modules/volunteers/plan", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/volunteers/plan")>();
  return {
    ...real,
    addVolunteerPlanPicture: (...args: Parameters<typeof real.addVolunteerPlanPicture>) => {
      state.serviceCalls += 1;
      return real.addVolunteerPlanPicture(...args);
    },
    removeVolunteerPlanPicture: (...args: Parameters<typeof real.removeVolunteerPlanPicture>) => {
      state.serviceCalls += 1;
      return real.removeVolunteerPlanPicture(...args);
    },
  };
});
// A store there or not, as a deployment without its bucket has none (`STORAGE_MODE`).
vi.mock("@/modules/media/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/media/storage")>()),
  isStorageConfigured: () => state.storage,
}));

const { default: VolunteerPlanPage } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/page");
const { addPlanPictureAction, removePlanPictureAction } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/actions");
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
const moment = (at?: Date) => at ?? new Date(NOW.getTime() + ++presses * 1000);
const addPicture = (actor: StaffUser, assetId: unknown, eventId = raceId, at?: Date) => addVolunteerPlanPicture(db, actor, { eventId, assetId }, moment(at));
const removePicture = (actor: StaffUser, id: unknown, eventId = raceId, at?: Date) => removeVolunteerPlanPicture(db, actor, { eventId, id }, moment(at));
/** The plan's picture rows of an event, in their order. */
const rowsOf = async (eventId = raceId) =>
  db.select().from(eventVolunteerPlanPictures).where(eq(eventVolunteerPlanPictures.eventId, eventId)).orderBy(asc(eventVolunteerPlanPictures.position));
/** The row that holds a stored picture on a plan. */
const rowIdOf = async (assetId: string, eventId = raceId) => (await rowsOf(eventId)).find((row) => row.mediaAssetId === assetId)!.id;
const eventRowOf = async (id = raceId) => (await db.select().from(events).where(eq(events.id, id)))[0];
const trail = async () =>
  (await db.select().from(auditLogs).orderBy(asc(auditLogs.createdAt))).filter((row) => row.action === "event.volunteer_plan_picture_added" || row.action === "event.volunteer_plan_picture_removed");
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
/** Every opening tag carrying `testid`. */
const tagsOf = (page: string, testid: string) => [...page.matchAll(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`, "g"))].map((match) => match[0]);
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
/** What the fold's own class says on paper, every rule of it — its own, its bar's, its body's. */
const foldOnPaper = (markup: string) =>
  classesOf(markup, "plan-maps-section")
    .flatMap((name) => [...cssOf(markup).matchAll(/@media print\{((?:[^{}]*\{[^}]*\})+)\}/g)].flatMap((block) => [...block[1].matchAll(new RegExp(`\\.${name}([^{]*)\\{([^}]*)\\}`, "g"))].map((rule) => `${rule[1]}{${rule[2]}}`)))
    .join(";");

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

describe("§978 the plan's pictures: added, each last, and taken off", () => {
  it("lets the Organizer add a stored picture to the plan, audited with its id alone, and moves nothing of the event", async () => {
    const picture = await storedPicture();
    const before = await eventRowOf();

    expect(await addPicture(staff.MODERATOR!, picture.id)).toEqual({ changed: true });

    expect((await rowsOf()).map((row) => [row.mediaAssetId, row.position])).toEqual([[picture.id, 1]]);
    // The version, the dates, the cover, every setting — and the retired column of §952: as they were.
    expect(await eventRowOf()).toEqual(before);

    const rows = await trail();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "event.volunteer_plan_picture_added", actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: raceId });
    // The event and the stored picture's id — never a file's name, an address or anything of a person.
    expect(rows[0].metadataJson).toEqual({ assetId: picture.id });
    expect(JSON.stringify(rows[0].metadataJson)).not.toMatch(/harta|png|Crosul|Ana/);
  });

  it("puts each new picture last, and changes nothing for one already on the plan", async () => {
    const [first, second, third] = [await storedPicture(), await storedPicture({ name: "start.png" }), await storedPicture({ name: "parcare.png" })];
    await addPicture(staff.ADMIN!, first.id);
    await addPicture(staff.ADMIN!, second.id);
    expect(await addPicture(staff.ADMIN!, first.id)).toEqual({ changed: false });
    // The same id as a person would paste it: upper case, a space around it.
    expect(await addPicture(staff.ADMIN!, ` ${second.id.toUpperCase()} `)).toEqual({ changed: false });
    await addPicture(staff.SUPERADMIN!, third.id);
    expect((await rowsOf()).map((row) => [row.mediaAssetId, row.position])).toEqual([
      [first.id, 1],
      [second.id, 2],
      [third.id, 3],
    ]);
    expect(await trail()).toHaveLength(3);
    // …and the plan reads them in that order.
    expect((await readVolunteerPlan(db, staff.MODERATOR!, raceId)).pictures.map((one) => one.assetId)).toEqual([first.id, second.id, third.id]);
  });

  it("takes one picture off by its row, audited with the stored picture's id, and keeps the stored picture for the sweep", async () => {
    const [first, second] = [await storedPicture(), await storedPicture()];
    await addPicture(staff.MODERATOR!, first.id);
    await addPicture(staff.MODERATOR!, second.id);

    expect(await removePicture(staff.MODERATOR!, await rowIdOf(first.id))).toEqual({ changed: true });
    expect((await rowsOf()).map((row) => row.mediaAssetId)).toEqual([second.id]);
    const rows = await trail();
    expect(rows.at(-1)).toMatchObject({ action: "event.volunteer_plan_picture_removed", actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: raceId });
    expect(rows.at(-1)!.metadataJson).toEqual({ assetId: first.id });
    expect(await assetThere(first.id)).toBe(true);

    // Gone already, a value that is no id, nothing at all: nothing to do.
    for (const none of [randomUUID(), "not-an-id", "", null, undefined]) expect(await removePicture(staff.MODERATOR!, none)).toEqual({ changed: false });
    expect(await trail()).toHaveLength(3);

    // Added again, it goes last: the position after the greatest, never a gap filled in.
    const third = await storedPicture();
    await addPicture(staff.MODERATOR!, third.id);
    await addPicture(staff.MODERATOR!, first.id);
    expect((await rowsOf()).map((row) => [row.mediaAssetId, row.position])).toEqual([
      [second.id, 2],
      [third.id, 3],
      [first.id, 4],
    ]);
  });

  it("is each event's own: another event's plan has its own pictures, and a row of it is not this plan's to take off", async () => {
    const picture = await storedPicture();
    await addPicture(staff.ADMIN!, picture.id);
    await addPicture(staff.ADMIN!, picture.id, otherId);
    expect((await readVolunteerPlan(db, staff.ADMIN!, otherId)).pictures.map((one) => one.assetId)).toEqual([picture.id]);
    // The other plan's row, posted on this event: nothing happens to either.
    expect(await removePicture(staff.ADMIN!, await rowIdOf(picture.id, otherId))).toEqual({ changed: false });
    expect(await rowsOf(otherId)).toHaveLength(1);
    expect(await rowsOf()).toHaveLength(1);
  });

  it(`holds ${PLAN_PICTURES_MAX} pictures at most: the next is refused with its sentence, and nothing is written`, async () => {
    for (let n = 0; n < PLAN_PICTURES_MAX; n += 1) await addPicture(staff.ADMIN!, (await storedPicture()).id);
    const extra = await storedPicture();
    await expect(addPicture(staff.ADMIN!, extra.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR", reason: "PLAN_PICTURES_FULL", values: { max: "12" } });
    expect(await rowsOf()).toHaveLength(PLAN_PICTURES_MAX);
    expect(await trail()).toHaveLength(PLAN_PICTURES_MAX);
    // One taken off, there is room again.
    await removePicture(staff.ADMIN!, (await rowsOf())[0].id);
    expect(await addPicture(staff.ADMIN!, extra.id)).toEqual({ changed: true });
    // The sentence, in both languages, with the number.
    expect(ro.Admin.errors.PLAN_PICTURES_FULL).toContain("{max}");
    expect(en.Admin.errors.PLAN_PICTURES_FULL).toContain("{max}");
  });

  it("refuses the Tehnic role, the Redactor, a desk Volunteer and a member, with nothing written (BR-REQ-060-01)", async () => {
    const picture = await storedPicture();
    const kept = await storedPicture({ name: "harta-pastrata.png" });
    await addPicture(staff.ADMIN!, kept.id);
    const keptRow = await rowIdOf(kept.id);
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      await expect(addPicture(staff[role]!, picture.id), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(removePicture(staff[role]!, keptRow), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      // Refused before the event or the picture is so much as read.
      await expect(addPicture(staff[role]!, "not-an-id", "not-an-id"), role).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(readVolunteerPlan(db, staff[role]!, raceId), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await rowsOf()).map((row) => row.mediaAssetId)).toEqual([kept.id]);
    expect(await trail()).toHaveLength(1);
  });

  it("asks for an event that is there", async () => {
    const picture = await storedPicture();
    await expect(addPicture(staff.ADMIN!, picture.id, "11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addPicture(staff.ADMIN!, picture.id, "not-an-id")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(removePicture(staff.ADMIN!, randomUUID(), "11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await trail()).toHaveLength(0);
  });

  it("asks for a stored picture: nothing, an id that names none, a film's poster and a value that is no id are refused, naming the box", async () => {
    const kept = await storedPicture();
    await addPicture(staff.ADMIN!, kept.id);
    // A film's automatic poster (§485) is a row of the store and no picture to put on a plan.
    const poster = await storedPicture({ keyPrefix: "yt-dQw4w9WgXcQ", width: 1280, height: 720 });
    for (const value of ["", "   ", null, undefined, "11111111-1111-4111-8111-111111111111", poster.id, "the map", 42, { id: kept.id }, ["x"]]) {
      await expect(addPicture(staff.ADMIN!, value), JSON.stringify(value)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["assetId"] });
    }
    expect((await rowsOf()).map((row) => row.mediaAssetId)).toEqual([kept.id]);
    expect(await trail()).toHaveLength(1);
  });

  it("is deleted with its event, and with a stored picture deleted by hand", async () => {
    const [first, second] = [await storedPicture(), await storedPicture()];
    await addPicture(staff.ADMIN!, first.id);
    await addPicture(staff.ADMIN!, second.id);
    await addPicture(staff.ADMIN!, first.id, otherId);
    await db.delete(mediaAssets).where(eq(mediaAssets.id, second.id));
    expect((await rowsOf()).map((row) => row.mediaAssetId)).toEqual([first.id]);
    await db.delete(events).where(eq(events.id, raceId));
    expect(await rowsOf()).toEqual([]);
    expect(await rowsOf(otherId)).toHaveLength(1);
  });
});

describe("§978 the plan reads its pictures", () => {
  it("returns none without any, and everything the plan returned before", async () => {
    const plan = await readVolunteerPlan(db, staff.MODERATOR!, raceId);
    expect(plan.pictures).toEqual([]);
    expect(plan.links).toEqual([]);
    expect(plan.points.map(({ number, point }) => [number, point.nameRo])).toEqual([
      [1, "Intersecția Stejeriș"],
      [2, "Apă la cabană"],
    ]);
    expect(plan.points[0].people.map((one) => one.name)).toEqual(["Ana Pop"]);
    expect(plan.unplaced).toEqual([]);
    expect(plan.roles).toBeInstanceOf(Map);
  });

  it("returns the whole of each picture and a display size of it, at the store's public addresses", async () => {
    const picture = await storedPicture({ width: 2400, height: 1600 });
    await addPicture(staff.ADMIN!, picture.id);
    const [read] = (await readVolunteerPlan(db, staff.MODERATOR!, raceId)).pictures;

    const storage = getStorage();
    const full = storage.publicUrl(objectKey(picture.keyPrefix, "web"));
    expect(read).toEqual({
      id: await rowIdOf(picture.id),
      assetId: picture.id,
      width: 2400,
      height: 1600,
      fullUrl: full,
      displayUrl: storage.publicUrl(objectKey(picture.keyPrefix, PLAN_PICTURE_DISPLAY_WIDTH)),
      srcSet: expect.stringContaining(`${full} 2400w`),
    });
    // Absolute, so a page and a message can carry them alike; the ladder below the master for a screen that chooses.
    expect(read.fullUrl).toMatch(/^https?:\/\/.+\/web\.webp$/);
    expect(read.displayUrl).toMatch(/^https?:\/\/.+\/1280w\.webp$/);
    expect(read.srcSet).toContain("/480w.webp 480w");
    expect(read.srcSet).toContain("/1920w.webp 1920w");
    // The email's own read says the same pictures, with nobody signed in.
    expect((await readVolunteerPlanMaps(db, raceId)).pictures).toEqual([read]);
    expect(await readVolunteerPlanMaps(db, "not-an-id")).toEqual({ pictures: [], links: [] });
  });

  it("takes the widest stored file under the display size, and the master itself for a small picture or one stored before the ladder", async () => {
    const full = (prefix: string) => getStorage().publicUrl(objectKey(prefix, "web"));
    // 1000 pixels wide: its rungs are 480 and 640 — the display size is the wider. 500 wide: no rung under it — the master is
    // both. Stored before the ladder (a version-4 prefix, §414): one file, and no `srcset` naming files that do not exist.
    const medium = await storedPicture({ width: 1000, height: 700 });
    const small = await storedPicture({ width: 500, height: 300 });
    const old = await storedPicture({ keyPrefix: randomUUID(), width: 2400, height: 1600 });
    for (const one of [medium, small, old]) await addPicture(staff.ADMIN!, one.id);
    const [m, s, o] = (await readVolunteerPlan(db, staff.ADMIN!, raceId)).pictures;
    expect(m).toMatchObject({ displayUrl: getStorage().publicUrl(objectKey(medium.keyPrefix, 640)), fullUrl: full(medium.keyPrefix) });
    expect(s).toMatchObject({ displayUrl: full(small.keyPrefix), fullUrl: full(small.keyPrefix), srcSet: `${full(small.keyPrefix)} 500w` });
    expect(o).toMatchObject({ displayUrl: full(old.keyPrefix), fullUrl: full(old.keyPrefix) });
    expect(o.srcSet).toBeUndefined();
  });

  it("reads no picture where there is no store", async () => {
    await addPicture(staff.ADMIN!, (await storedPicture()).id);
    state.storage = false;
    expect((await readVolunteerPlan(db, staff.ADMIN!, raceId)).pictures).toEqual([]);
    state.storage = true;
    expect((await readVolunteerPlan(db, staff.ADMIN!, raceId)).pictures).toHaveLength(1);
  });
});

describe("§978 a picture used on a plan is the plan's (the reference check, §73)", () => {
  it("is kept by the sweep, refused by the pictures page's delete, and listed once as used by the event's plan", async () => {
    const picture = await storedPicture();
    await getStorage().put(objectKey(picture.keyPrefix, "web"), Buffer.from("web"), "image/webp");
    await getStorage().put(objectKey(picture.keyPrefix, "thumb"), Buffer.from("thumb"), "image/webp");
    await addPicture(staff.MODERATOR!, picture.id);

    // A month on, used by nothing but the plan: still there.
    expect(await sweepOrphanAssets(db, later(30))).toBe(0);
    expect(await assetThere(picture.id)).toBe(true);
    expect(await countMediaAssets(db, later(30))).toMatchObject({ total: 1, unreferenced: 0, sweepable: 0 });
    await expect(deleteMediaAsset(db, { actor: { id: staff.ADMIN!.id, role: "ADMIN" }, assetId: picture.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const listed = (await listMediaAssetsForAdmin(db, "ro")).find((row) => row.id === picture.id);
    expect(listed?.references).toEqual([{ kind: "volunteerPlan", id: raceId, title: "Crosul" }]);
    expect((await listMediaAssetsForAdmin(db, "en")).find((row) => row.id === picture.id)?.references).toEqual([{ kind: "volunteerPlan", id: raceId, title: "The cross" }]);
    // Named by the retired column of §952 as well — a plan of the release before, copied by the migration —: one line still.
    await db.update(events).set({ volunteerPlanMediaAssetId: picture.id }).where(eq(events.id, raceId));
    expect((await listMediaAssetsForAdmin(db, "ro")).find((row) => row.id === picture.id)?.references).toEqual([{ kind: "volunteerPlan", id: raceId, title: "Crosul" }]);
  });

  it("is the sweep's once it is taken off and old enough — the row and its files", async () => {
    const picture = await storedPicture();
    const web = objectKey(picture.keyPrefix, "web");
    await getStorage().put(web, Buffer.from("web"), "image/webp");
    await addPicture(staff.MODERATOR!, picture.id);
    // The sweep saw it used a month on…
    expect(await sweepOrphanAssets(db, later(30))).toBe(0);
    // …then «Șterge poza»: used nowhere, and listed so.
    await removePicture(staff.MODERATOR!, await rowIdOf(picture.id), raceId, later(30));
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

  it("keeps a picture two plans use until both let go of it — and one the retired column still names", async () => {
    const picture = await storedPicture();
    await addPicture(staff.ADMIN!, picture.id);
    await addPicture(staff.ADMIN!, picture.id, otherId);
    await removePicture(staff.ADMIN!, await rowIdOf(picture.id));
    expect(await sweepOrphanAssets(db, later(60))).toBe(0);
    await removePicture(staff.ADMIN!, await rowIdOf(picture.id, otherId), otherId, later(60));
    expect(await sweepOrphanAssets(db, later(70))).toBe(1);

    // The column of §952 is written by nobody now and counted until its contract: nothing it names is swept first.
    const old = await storedPicture();
    await db.update(events).set({ volunteerPlanMediaAssetId: old.id }).where(eq(events.id, otherId));
    expect(await sweepOrphanAssets(db, later(90))).toBe(0);
    expect(await assetThere(old.id)).toBe(true);
  });

  it("is no picture of the event's texts: «Din galerie» gives it no chip and «Acest eveniment» does not offer it", () => {
    expect(pictureUses(["volunteerPlan"])).toEqual([]);
    expect(pictureUses(["volunteerPlan", "event", "album"])).toEqual(["event", "album"]);
    expect(usedHere([{ kind: "volunteerPlan", id: raceId }], { kind: "event", id: raceId })).toBe(false);
  });

  it("is named on the pictures page with a link to the plan — and in words alone for a role the plan is a 404 for", async () => {
    const picture = await storedPicture();
    await addPicture(staff.ADMIN!, picture.id);
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

describe("§978 the page's presses: «Adaugă o poză», «Șterge poza»", () => {
  // Back to «Poze și hărți», open, in the view the press came from — «Tabel» for a form that names none (§974).
  const back = (view = "table") => `/ro/admin/events/${raceId}/plan-voluntari?view=${view}&saved=planMaps#plan-maps`;
  const refusedAt = (code: string) => `/ro/admin/events/${raceId}/plan-voluntari?view=table&planError=${code}#admin-alert`;

  it("adds the uploaded picture and takes one off, coming back to the fold and saying what happened", async () => {
    const [first, second] = [await storedPicture(), await storedPicture()];

    expect(await press(addPlanPictureAction, { assetId: first.id })).toBe(back());
    expect(toasted()).toEqual(["planPictureAdded"]);
    // The same picture again: nothing to change, said so.
    expect(await press(addPlanPictureAction, { assetId: first.id })).toBe(back());
    expect(toasted()).toEqual(["volunteerUnchanged"]);
    // Pressed on «Pe puncte», back to it.
    expect(await press(addPlanPictureAction, { assetId: second.id, view: "points" })).toBe(back("points"));
    expect((await rowsOf()).map((row) => row.mediaAssetId)).toEqual([first.id, second.id]);

    expect(await press(removePlanPictureAction, { pictureId: await rowIdOf(first.id) })).toBe(back());
    expect(toasted()).toEqual(["planPictureRemoved"]);
    expect(await press(removePlanPictureAction, { pictureId: randomUUID() })).toBe(back());
    expect(toasted()).toEqual(["volunteerUnchanged"]);
    expect((await rowsOf()).map((row) => row.mediaAssetId)).toEqual([second.id]);
    // The address opens the fold in either view — and so does the picture it holds.
    for (const view of ["table", "points"]) expect(drawnOpen(elementWith(await planPage({ view, saved: "planMaps" }), 'data-testid="plan-maps-section"'))).toBe(true);

    // Every press asked the capability at the action's own door, by name.
    expect(state.asked).toEqual(Array.from({ length: 5 }, () => "canManageVolunteers"));
    // One row a change, none for the presses that changed nothing.
    expect((await trail()).map((row) => row.action).sort()).toEqual(["event.volunteer_plan_picture_added", "event.volunteer_plan_picture_added", "event.volunteer_plan_picture_removed"]);
  });

  it("every toast and refusal it writes has its sentence in both languages", () => {
    for (const key of ["planPictureAdded", "planPictureRemoved", "planLinkAdded", "planLinkRemoved", "volunteerUnchanged"] as const) {
      expect(ro.Feedback.toast[key], key).toEqual(expect.any(String));
      expect(en.Feedback.toast[key], key).toEqual(expect.any(String));
    }
    for (const code of ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR", "PLAN_PICTURES_FULL", "PLAN_LINKS_FULL", "PLAN_LINK_URL", "PLAN_LINK_LABEL"] as const) {
      expect(ro.Admin.errors[code], code).toEqual(expect.any(String));
      expect(en.Admin.errors[code], code).toEqual(expect.any(String));
    }
    // The one-picture words of §952 are gone with the one picture.
    for (const catalogue of [ro, en] as Record<string, unknown>[]) {
      const toast = (catalogue as { Feedback: { toast: Record<string, unknown> } }).Feedback.toast;
      expect(toast.planPictureSet).toBeUndefined();
      expect(toast.planPictureReplaced).toBeUndefined();
    }
  });

  it("refuses the upload's form with no picture in it, and a thirteenth picture with its sentence on the page", async () => {
    for (const assetId of ["", "   "]) expect(await press(addPlanPictureAction, { assetId })).toBe(refusedAt("VALIDATION_ERROR"));
    expect(toasted()).toEqual([]);
    expect(await planPage({ planError: "VALIDATION_ERROR" })).toContain(ro.Admin.errors.VALIDATION_ERROR);

    for (let n = 0; n < PLAN_PICTURES_MAX; n += 1) await addPicture(staff.ADMIN!, (await storedPicture()).id);
    expect(await press(addPlanPictureAction, { assetId: (await storedPicture()).id })).toBe(refusedAt("PLAN_PICTURES_FULL"));
    expect(await planPage({ planError: "PLAN_PICTURES_FULL" })).toContain("Planul are deja 12 poze, cât poate avea. Șterge una ca să adaugi alta.");
  });

  it("comes back with the refusal's code for a picture that is not one, and to the volunteers' screen for a form with no event", async () => {
    expect(await press(addPlanPictureAction, { assetId: "11111111-1111-4111-8111-111111111111" })).toContain("planError=VALIDATION_ERROR#admin-alert");
    expect(await press(addPlanPictureAction, { assetId: "the map" })).toContain("planError=VALIDATION_ERROR#admin-alert");
    expect(await rowsOf()).toEqual([]);

    const picture = await storedPicture();
    expect(await press(addPlanPictureAction, { assetId: picture.id, eventId: "not-an-id" })).toBe("/ro/admin/volunteers");
    expect(await press(removePlanPictureAction, { eventId: "" })).toBe("/ro/admin/volunteers");
    expect(await trail()).toHaveLength(0);
  });

  it("refuses the Tehnic role, the Redactor, a desk Volunteer and a member at the action's own door: the service is never reached", async () => {
    const kept = await storedPicture();
    const wanted = await storedPicture();
    await addPicture(staff.ADMIN!, kept.id);
    const keptRow = await rowIdOf(kept.id);
    state.serviceCalls = 0;
    state.asked.length = 0;

    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      expect(await press(addPlanPictureAction, { assetId: wanted.id }), role).toBe(refusedAt("FORBIDDEN"));
      expect(await press(removePlanPictureAction, { pictureId: keptRow }), role).toBe(refusedAt("FORBIDDEN"));
    }
    expect(state.asked).toEqual(Array.from({ length: 8 }, () => "canManageVolunteers"));
    expect(state.serviceCalls).toBe(0);
    expect((await rowsOf()).map((row) => row.mediaAssetId)).toEqual([kept.id]);
    expect(await trail()).toHaveLength(1);
    expect(toasted()).toEqual([]);
  });
});

describe("§978 «Poze și hărți» draws the pictures", () => {
  it("is the first fold, closed while empty, saying it holds nothing — the plan as before under it, plus the upload", async () => {
    for (const view of ["table", "points"]) {
      const page = await planPage({ view });
      const fold = elementWith(page, 'data-testid="plan-maps-section"');
      expect(fold).toMatch(/^<details[^>]*id="plan-maps"/);
      expect(drawnOpen(fold)).toBe(false);
      // Under the intro, above the views' tabs and every other fold.
      const at = (needle: string) => page.indexOf(needle);
      expect(at('data-testid="plan-maps-section"')).toBeGreaterThan(at('data-testid="plan-help-points"'));
      expect(at('data-testid="plan-maps-section"')).toBeLessThan(at('data-testid="plan-views"'));
      // The first fold of the page.
      expect(/^<details[^>]*>/.exec(page.slice(page.indexOf("<details")))?.[0]).toContain('id="plan-maps"');
    }
    const page = await planPage();
    expect(page).toContain('data-testid="plan-table-section"');
    const points = await planPage({ view: "points" });
    expect(planSummaryOf(points)).toBe("0 voluntari la start–finish · 1 voluntar pe traseu · 0 voluntari fără punct · 1 punct fără nimeni");
    expect(planPointBar(planPointsOf(points)[0])).toEqual({ name: "1. Intersecția Stejeriș", line: "1,2 km · 1 voluntar" });

    const fold = elementWith(page, 'data-testid="plan-maps-section"');
    expect(fold).toContain(`</svg>${ro.Admin.volunteers.plan.maps.title}<`);
    expect(fold).toContain(`data-testid="plan-maps-state">nicio poză · niciun link<`);
    // No picture, no link to one, no «Șterge poza».
    expect(fold).not.toContain('data-testid="plan-picture"');
    expect(page).not.toContain("<img");
    expect(fold).not.toContain('data-testid="plan-picture-remove-form"');
    // The upload: the form the island sends, with the event in it and the picture's box empty.
    const upload = elementWith(fold, 'data-testid="plan-picture-form"');
    expect(upload).toContain(`name="eventId" value="${raceId}"`);
    expect(upload).toContain('name="uiLocale" value="ro"');
    expect(upload).toMatch(/<input[^>]*type="hidden"[^>]*name="assetId"[^>]*value=""/);
    expect(upload).toContain(ro.Admin.volunteers.plan.picture.upload);
    expect(ro.Admin.volunteers.plan.picture.upload).toBe("Adaugă o poză");
    expect(upload).toMatch(/<input[^>]*id="plan-picture-file"[^>]*type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
    // The button is the file input's label, and the quality stands beside the upload as beside every upload (§414).
    expect(tagOf(page, "plan-picture-upload")).toMatch(/^<label[^>]*for="plan-picture-file"/);
    expect(upload).toContain('data-testid="image-quality"');
  });

  it("opens with its pictures in a grid, each a link to the whole of it in a new tab, «Șterge poza» under each, the upload still there", async () => {
    const stored = [await storedPicture({ width: 2400, height: 1600 }), await storedPicture({ width: 1200, height: 1800 })];
    for (const one of stored) await addPicture(staff.ADMIN!, one.id);
    const { pictures } = await readVolunteerPlan(db, staff.ADMIN!, raceId);
    const page = await planPage();
    const fold = elementWith(page, 'data-testid="plan-maps-section"');

    // Open by itself: the owner wants the map in sight. Its closed line counts.
    expect(drawnOpen(fold)).toBe(true);
    expect(fold).toContain(`data-testid="plan-maps-state">2 poze · niciun link<`);
    expect(drawnOpen(elementWith(await planPage({ view: "points" }), 'data-testid="plan-maps-section"'))).toBe(true);

    // Each picture in the plan's order: its link the whole picture, in a new tab, named for a reader who does not see it.
    const links = tagsOf(fold, "plan-picture-link");
    expect(links).toHaveLength(2);
    links.forEach((link, at) => {
      expect(link).toMatch(/^<a /);
      expect(link).toContain(`href="${pictures[at].fullUrl}"`);
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
      expect(link).toContain(`aria-label="Deschide poza ${at + 1} a planului întreagă, într-o filă nouă"`);
    });
    // The image: the display size, the ladder for a screen that chooses, its own size so the page does not jump.
    const images = tagsOf(fold, "plan-picture-image");
    expect(images[0]).toMatch(/^<img /);
    expect(images[0]).toContain(`src="${pictures[0].displayUrl}"`);
    expect(images[0]).toMatch(/srcSet="[^"]*\/480w\.webp 480w[^"]*\/web\.webp 2400w"/i);
    expect(images[0]).toMatch(/sizes="[^"]+"/);
    expect(images[0]).toContain('alt="Planul voluntarilor, poza 1"');
    expect(images[1]).toContain('width="1200"');
    expect(images[1]).toContain('height="1800"');
    // The hint once, under the grid.
    expect(fold.split(ro.Admin.volunteers.plan.picture.openHint)).toHaveLength(2);

    // «Șterge poza» under each, posting that picture's row and nothing that could add one.
    const removes = [...fold.matchAll(/<form[^>]*data-testid="plan-picture-remove-form"[\s\S]*?<\/form>/g)].map((match) => match[0]);
    expect(removes).toHaveLength(2);
    removes.forEach((remove, at) => {
      expect(remove).toContain(`name="pictureId" value="${pictures[at].id}"`);
      expect(remove).toContain(`name="eventId" value="${raceId}"`);
      expect(remove).not.toContain('name="assetId"');
      expect(remove).toContain(ro.Admin.volunteers.plan.picture.remove);
      expect(remove).toContain(`aria-label="Șterge poza ${at + 1}"`);
    });
    // «Adaugă o poză» still: it appends.
    expect(elementWith(fold, 'data-testid="plan-picture-form"')).toContain(ro.Admin.volunteers.plan.picture.upload);
  });

  it("names one picture without a number, and is in English for an English reader", async () => {
    await addPicture(staff.ADMIN!, (await storedPicture()).id);
    expect(tagOf(await planPage(), "plan-picture-image")).toContain(`alt="${ro.Admin.volunteers.plan.picture.alt}"`);
    state.locale = "en";
    const escaped = (text: string) => text.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
    const page = await planPage({ view: "points" });
    expect(page).toContain(`</svg>${en.Admin.volunteers.plan.maps.title}<`);
    expect(page).toContain(`data-testid="plan-maps-state">1 picture · no link<`);
    expect(tagOf(page, "plan-picture-link")).toContain(`aria-label="${escaped(en.Admin.volunteers.plan.picture.open)}"`);
    expect(tagOf(page, "plan-picture-image")).toContain(`alt="${escaped(en.Admin.volunteers.plan.picture.alt)}"`);
    expect(page).toContain(en.Admin.volunteers.plan.picture.openHint);
    expect(page).toContain(en.Admin.volunteers.plan.picture.upload);
    expect(page).toContain(en.Admin.volunteers.plan.picture.remove);
    expect(page).toContain(escaped(en.Admin.volunteers.plan.maps.help));
    expect(page).toContain('name="uiLocale" value="en"');
    expect(planSummaryOf(page)).toBe("0 volunteers at the start–finish · 1 volunteer on the route · 0 volunteers at no point · 1 point with nobody");
  });

  it("draws the grid two or three a row on a laptop and one on a phone, each picture no taller than 360 pixels", async () => {
    await addPicture(staff.ADMIN!, (await storedPicture({ width: 2400, height: 1600 })).id);
    const page = await planPage({}, raceId, true);
    expect(rulesOf(page, "plan-pictures").screen).toMatch(/display:grid;grid-template-columns:repeat\(auto-fill, minmax\(260px, 1fr\)\)/);
    const image = rulesOf(page, "plan-picture-image").screen;
    expect(image).toMatch(/width:100%/);
    expect(image).toMatch(/max-width:2400px/);
    expect(image).toMatch(/max-height:360px/);
    expect(image).toMatch(/object-fit:contain/);
  });

  it("prints after the rest of the plan, each picture in one piece whatever the screen had folded, and none of its controls", async () => {
    await addPicture(staff.ADMIN!, (await storedPicture()).id);
    const page = await planPage({}, raceId, true);
    const hiddenOnPaper = (testid: string) => /display:none/.test(rulesOf(page, testid).print);

    // On the sheet: the picture and its image — never cut between two pages, never taller than one.
    expect(hiddenOnPaper("plan-picture")).toBe(false);
    expect(hiddenOnPaper("plan-picture-image")).toBe(false);
    expect(rulesOf(page, "plan-picture").screen).toMatch(/break-inside:avoid/);
    expect(rulesOf(page, "plan-picture-image").print).toMatch(/max-height:17cm/);
    expect(rulesOf(page, "plan-picture-image").print).toMatch(/max-width:100%/);
    // A column on paper, not the screen's grid.
    expect(rulesOf(page, "plan-pictures").print).toMatch(/display:block/);

    // Off the sheet: the upload and its quality choice, «Șterge poza», the hint and the help.
    for (const testid of ["plan-picture-controls", "plan-picture-remove-form", "plan-picture-hint", "plan-maps-help"]) expect(hiddenOnPaper(testid), testid).toBe(true);

    // The fold on paper: shown whether open or shut, its bar and its frame left off — and moved after the rest of the plan
    // (`order` in the page's flex column), so the view's plan is still the first thing after the title (§974).
    expect(foldOnPaper(page)).not.toMatch(/(^|;)\{display:none/);
    expect(foldOnPaper(page)).toMatch(/(^|;)\{[^}]*;order:1;border:0px solid;padding-left:0px;padding-right:0px;background-color:transparent;/);
    expect(foldOnPaper(page)).toMatch(/>summary\{display:none/);
    expect(foldOnPaper(page)).toMatch(/::details-content\{display:block;content-visibility:visible/);
    // …inside the column the page is: a flex column, whose `order` the paper follows.
    const plain = page.replace(/<style[\s\S]*?<\/style>/g, "");
    const columnClass = /<div class="([^"]*)"/.exec(plain)?.[1].split(/\s+/).find((name) => name.startsWith("css-")) ?? "";
    expect(columnClass).not.toBe("");
    expect(elementWith(plain, 'data-testid="plan-maps-section"')).not.toBe("");
    expect(cssOf(page)).toMatch(new RegExp(`\\.${columnClass}\\{[^}]*display:flex;[^}]*flex-direction:column`));

    // With no picture and no link, the fold is off the sheet whole: a plan with nothing in it prints as it did.
    await removePicture(staff.ADMIN!, (await rowsOf())[0].id);
    expect(foldOnPaper(await planPage({}, raceId, true))).toMatch(/(^|;)\{display:none/);
  });

  it("gives a thumb 44 pixels on the upload and on «Șterge poza»", async () => {
    await addPicture(staff.ADMIN!, (await storedPicture()).id);
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
    // Every prop is a string or the labels' strings: nothing drawn is handed across.
    expect(call.slice("<PlanPictureUpload".length)).not.toMatch(/<[A-Za-z]/);
    expect(call).not.toMatch(/Icon\b|icon=/);
    const island = readFileSync("src/modules/volunteers/ui/PlanPictureUpload.tsx", "utf8");
    expect(island.startsWith('"use client";')).toBe(true);
    // Its glyph comes by name from the backoffice's table, through the house's button; it only ever appends.
    expect(island).toContain('icon="upload"');
    expect(island).not.toMatch(/replace/i);
    expect(island).not.toMatch(/@mui\/icons-material/);
    expect(island).toContain("sx={TAP_TARGET}");
  });

  it(`offers no upload once the plan holds ${PLAN_PICTURES_MAX} pictures, and none where there is no store`, async () => {
    for (let n = 0; n < PLAN_PICTURES_MAX; n += 1) await addPicture(staff.ADMIN!, (await storedPicture()).id);
    const full = await planPage();
    expect(tagsOf(full, "plan-picture")).toHaveLength(PLAN_PICTURES_MAX);
    expect(full).not.toContain('data-testid="plan-picture-form"');

    state.storage = false;
    const page = await planPage();
    expect(page).toContain(ro.Admin.volunteers.plan.picture.noStorage);
    expect(page).not.toContain('data-testid="plan-picture-form"');
    expect(page).not.toContain('data-testid="plan-picture-remove-form"');
    expect(page).not.toContain("<img");
    // The links still work, and the plan itself is as it was.
    expect(page).toContain('data-testid="plan-link-add-form"');
    expect(page).toContain(">Intersecția Stejeriș<");
  });

  it("is a 404 for the Tehnic role, the Redactor, a desk Volunteer and a member, pictures or not", async () => {
    await addPicture(staff.ADMIN!, (await storedPicture()).id);
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

describe("§978 the pictures and links are one edition's: not carried by a series, a copy or the event's file", () => {
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
  const MAP = "https://maps.example.test/d/viewer?mid=plan-serie";
  const linksOf = async (ids: string[]) => db.select().from(eventVolunteerPlanLinks).where(inArray(eventVolunteerPlanLinks.eventId, ids));

  it("leaves a series' later dates and a copy without them, and the source with its own", async () => {
    const admin = staff.ADMIN!;
    const picture = await storedPicture();
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: words("serie") }, now: AT });
    await addPicture(admin, picture.id, source.id, AT);
    await addVolunteerPlanLink(db, admin, { eventId: source.id, url: MAP, label: "Harta" }, AT);

    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-21", publish: false }, now: AT });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    const copy = await duplicateEvent(db, { actor: admin, eventId: source.id });
    const others = [...dates.map((date) => date.id), copy.id];
    expect(await db.select().from(eventVolunteerPlanPictures).where(inArray(eventVolunteerPlanPictures.eventId, others))).toEqual([]);
    expect(await linksOf(others)).toEqual([]);
    expect((await rowsOf(source.id)).map((row) => row.mediaAssetId)).toEqual([picture.id]);
    expect((await linksOf([source.id])).map((row) => row.url)).toEqual([MAP]);
  });

  it("is not in the event's file: an export names neither, a new event from the file has none, and an import over an event leaves its own", async () => {
    const admin = staff.ADMIN!;
    const picture = await storedPicture();
    const source = await createEvent(db, { actor: admin, fields: { ...FIELDS, translations: words("sursa") }, now: AT });
    await addPicture(admin, picture.id, source.id, AT);
    await addVolunteerPlanLink(db, admin, { eventId: source.id, url: MAP, label: "Harta" }, AT);

    const { file } = await exportEvent(db, { actor: admin, eventId: source.id, now: AT });
    const text = serializeEventFile(file);
    expect(text).not.toContain(picture.id);
    expect(text).not.toContain(picture.keyPrefix);
    expect(text).not.toContain(MAP);
    expect(text).not.toMatch(/volunteerPlan|volunteer_plan|planPicture|planLink/i);
    const read = readEventFile(text);
    if (!read.ok) throw new Error(`the export did not read back: ${read.refusal} ${read.detail ?? ""}`);

    const created = await importEventAsNew(db, { actor: admin, file: read.file, fetchImpl: nothingServed, now: AT });
    expect(await rowsOf(created.eventId)).toEqual([]);
    expect(await linksOf([created.eventId])).toEqual([]);

    // Over the event itself, once its distance has moved since the file was made: the import writes the file's distance
    // back through the editor's own save, and the plan's pictures and links — which no file names — stay where they were.
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
    expect((await eventRowOf(source.id)).distanceMeters).toBe(10_000);
    expect((await rowsOf(source.id)).map((row) => row.mediaAssetId)).toEqual([picture.id]);
    expect((await linksOf([source.id])).map((row) => row.url)).toEqual([MAP]);
    // The trail of the plan's pictures has the one press made here and nothing an import wrote.
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "event.volunteer_plan_picture_added"), eq(auditLogs.entityId, source.id)))).toHaveLength(1);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.volunteer_plan_picture_removed"))).toHaveLength(0);
  });
});
