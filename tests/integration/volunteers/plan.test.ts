import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { viewPersonData } from "@/modules/registrations/person-data";
import { readVolunteerPlan } from "@/modules/volunteers/plan";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-050-02 — «Planul voluntarilor» (the owner, 2026-11-16, with a map of the route and its seven points: «e foarte
 * important sa avem planul de voluntari si fiecare in ce punct ramane»), from a real database:
 *
 * - whoever works the volunteers puts a person at one of the event's own points and takes them off it; each change is audited as
 *   `volunteer.edited` naming the box and the point's id, a press that changes nothing writes nothing, and nothing else of the
 *   person moves; another event's point, a point no longer there and a cancelled person are refused; the Tehnic role is refused
 *   with nothing written (BR-REQ-060-01);
 * - a point taken off the route frees its people;
 * - the plan reads the points in the route's order with their people by name, everybody at no point under them, and never a
 *   cancelled person;
 * - the page draws it, with «Pune aici» offering only who stands at no point and «Scoate» on everybody placed, and the
 *   «Voluntari» list says each person's point and links to the plan.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en", redirected: [] as string[] }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { locale?: "ro" | "en"; namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    const locale = typeof arg === "string" ? state.locale : (arg.locale ?? state.locale);
    const catalogue = (locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale, messages: catalogue[namespace] as never });
  },
  getLocale: async () => state.locale,
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
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
// The house's typed routing, reduced to what the screens ask of it: the locale's prefix, the params filled in, a query appended.
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
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { default: VolunteerPlanPage } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/page");
const { placeVolunteerAction } = await import("@/app/[locale]/admin/events/[id]/plan-voluntari/actions");
const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");

const NOW = new Date("2026-11-16T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
let runId: string;
let guideId: string;
let waterId: string;
/** The race's points, typed out of the route's order on purpose: the plan reads them by distance. */
const points = { junction: "", water: "", bridge: "", elsewhere: "" };
const people = { ana: "", dan: "", eva: "", ion: "", zoe: "", mara: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function person(role: StaffRole, name: string): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
  return row;
}

async function volunteer(over: { eventId: string; name: string; state?: "REGISTERED" | "CONFIRMED" | "CANCELLED"; given?: string[]; phone?: string | null; bibNumber?: number }): Promise<string> {
  const email = `${over.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({
      eventId: over.eventId,
      name: over.name,
      email,
      canonicalEmail: email,
      canonicalizationVersion: 1,
      phone: over.phone === undefined ? "+40700000001" : over.phone,
      // Only a row the club typed may lack a telephone number (§865): the public form asks for one.
      source: over.phone === null ? "STAFF" : "PUBLIC",
      state: over.state ?? "CONFIRMED",
      roleId: over.given?.[0] ?? null,
      bibNumber: over.bibNumber ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: eventVolunteers.id });
  if (over.given?.length) await db.insert(eventVolunteerRoleAssignments).values(over.given.map((roleId) => ({ volunteerId: row.id, roleId })));
  return row.id;
}

async function point(eventId: string, km: string, nameRo: string, kinds: Array<"WATER" | "DIRECTION">, position: number): Promise<string> {
  const [row] = await db.insert(eventCheckpoints).values({ eventId, km, nameRo, nameEn: `${nameRo} (en)`, kinds, position }).returning({ id: eventCheckpoints.id });
  return row.id;
}

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  state.redirected.length = 0;
  staff.ADMIN = await person("ADMIN", "Ana Admin");
  staff.MODERATOR = await person("MODERATOR", "Oana Organizator");
  staff.DEV = await person("DEV", "Tudor Tehnic");
  state.actor = staff.MODERATOR;
  const [race, run] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), featured: true, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-10-01T00:00:00.000Z") },
      { type: "RACE", startsAt: new Date("2026-12-05T08:00:00.000Z"), acceptsVolunteers: true },
    ])
    .returning({ id: events.id });
  raceId = race.id;
  runId = run.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
    { eventId: runId, locale: "ro", slug: `altul-${runId.slice(0, 8)}`, title: "Alt cros" },
    { eventId: runId, locale: "en", slug: `other-${runId.slice(0, 8)}`, title: "Another cross" },
  ]);
  const [guide, water] = await db
    .insert(eventVolunteerRoles)
    .values([
      { eventId: raceId, nameRo: "Direcționare", nameEn: "Guidance", needed: 4, position: 0 },
      { eventId: raceId, nameRo: "Punct de hidratare", nameEn: "Water point", needed: 2, position: 1 },
    ])
    .returning({ id: eventVolunteerRoles.id });
  guideId = guide.id;
  waterId = water.id;
  // Typed water first, then the bridge, then the junction: by distance the junction is the route's first point.
  points.water = await point(raceId, "5.50", "Apă la cabană", ["WATER"], 0);
  points.bridge = await point(raceId, "7.25", "Podul de lemn", ["DIRECTION"], 1);
  points.junction = await point(raceId, "1.20", "Intersecția Stejeriș", ["DIRECTION"], 2);
  points.elsewhere = await point(runId, "3.00", "Punctul altui eveniment", ["DIRECTION"], 0);

  people.ana = await volunteer({ eventId: raceId, name: "Ana Pop", given: [guideId], bibNumber: 501 });
  people.dan = await volunteer({ eventId: raceId, name: "Dan Ene", given: [waterId], phone: "+40700000002" });
  // Offered and not confirmed yet: on the plan, said so.
  people.ion = await volunteer({ eventId: raceId, name: "Ion Lupu", state: "REGISTERED" });
  people.zoe = await volunteer({ eventId: raceId, name: "Zoe Manea", given: [guideId], phone: null });
  // Cancelled: on no plan.
  people.eva = await volunteer({ eventId: raceId, name: "Eva Stan", state: "CANCELLED", given: [guideId] });
  people.mara = await volunteer({ eventId: runId, name: "Mara Dinu" });
});

const place = (actor: StaffUser, id: string, checkpointId: unknown, eventId = raceId) => changeVolunteer(db, actor, { kind: "setCheckpoint", eventId, id, checkpointId }, NOW);
const rowOf = async (id: string) => (await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0];
const trail = async () => (await db.select().from(auditLogs)).filter((row) => row.action === "volunteer.edited");

/** A page as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(page: ReactElement): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const planPage = async (query: Record<string, string> = {}, id = raceId) => html(await VolunteerPlanPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve(query) }));
const listPage = async (query: Record<string, string> = {}) => html(await AdminVolunteersPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(query) }));
/** The plan's points as the page draws them: each `<li data-testid="plan-point">` whole. */
const pointsOf = (page: string) => [...page.matchAll(/<li[^>]*data-testid="plan-point"[\s\S]*?(?=<li[^>]*data-testid="plan-point"|<\/ol>)/g)].map((match) => match[0]);
const textOf = (part: string, testid: string) => [...part.matchAll(new RegExp(`data-testid="${testid}"[^>]*>(?:<a[^>]*>)?([^<]*)<`, "g"))].map((match) => match[1]);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: raceId, ...fields })) data.set(key, value);
  return data;
}
async function press(fields: Record<string, string>): Promise<string> {
  state.redirected.length = 0;
  await expect(placeVolunteerAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  return state.redirected[0];
}

describe("§NNN placing a volunteer at a point of the route", () => {
  it("lets the Organizer put a person at one of the event's points, audited, and moves nothing else of the person", async () => {
    const before = await rowOf(people.ana);
    expect(before.checkpointId).toBeNull();
    expect(await place(staff.MODERATOR!, people.ana, points.junction)).toMatchObject({ changed: true });

    const after = await rowOf(people.ana);
    expect(after.checkpointId).toBe(points.junction);
    // The state, the number, the kit, the contact: as they were.
    expect({ ...after, checkpointId: null, updatedAt: before.updatedAt }).toEqual(before);
    expect((await db.select().from(eventVolunteerRoleAssignments).where(eq(eventVolunteerRoleAssignments.volunteerId, people.ana))).map((row) => row.roleId)).toEqual([guideId]);

    const rows = await trail();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorStaffUserId: staff.MODERATOR!.id, entityType: "event", entityId: raceId });
    expect(rows[0].metadataJson).toMatchObject({ volunteerId: people.ana, fields: ["checkpoint"], checkpointId: points.junction });
    // The trail names the box and the point's id, never a name of either.
    expect(JSON.stringify(rows[0].metadataJson)).not.toMatch(/Ana|Stejeriș/);
  });

  it("writes nothing for a press that changes nothing, and moves a person from one point to another", async () => {
    await place(staff.ADMIN!, people.ana, points.junction);
    expect(await place(staff.ADMIN!, people.ana, points.junction)).toMatchObject({ changed: false });
    expect(await trail()).toHaveLength(1);
    await place(staff.ADMIN!, people.ana, points.water);
    expect((await rowOf(people.ana)).checkpointId).toBe(points.water);
    expect(await trail()).toHaveLength(2);
  });

  it("takes a person off their point with an empty value, audited with no point", async () => {
    await place(staff.MODERATOR!, people.ana, points.junction);
    expect(await place(staff.MODERATOR!, people.ana, "")).toMatchObject({ changed: true });
    expect((await rowOf(people.ana)).checkpointId).toBeNull();
    expect((await trail()).at(-1)!.metadataJson).toMatchObject({ fields: ["checkpoint"], checkpointId: null });
    // Off already: nothing to do, whatever "no point" was posted as.
    for (const none of ["", "   ", null, undefined]) expect(await place(staff.MODERATOR!, people.ana, none)).toMatchObject({ changed: false });
  });

  it("refuses another event's point, a point that is not there and a value that is no point, with nothing written", async () => {
    await expect(place(staff.ADMIN!, people.ana, points.elsewhere)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(place(staff.ADMIN!, people.ana, "11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(place(staff.ADMIN!, people.ana, "the junction")).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["checkpointId"] });
    // A person of another event is not this event's to place.
    await expect(place(staff.ADMIN!, people.mara, points.junction)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await rowOf(people.ana)).checkpointId).toBeNull();
    expect((await rowOf(people.mara)).checkpointId).toBeNull();
    expect(await trail()).toHaveLength(0);
  });

  it("places no cancelled person, yet takes one off the point they had", async () => {
    await expect(place(staff.ADMIN!, people.eva, points.junction)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["checkpointId"] });
    // Placed, then cancelled: the point is kept on the row, and «Scoate» still works.
    await place(staff.ADMIN!, people.dan, points.water);
    await db.update(eventVolunteers).set({ state: "CANCELLED" }).where(eq(eventVolunteers.id, people.dan));
    expect((await rowOf(people.dan)).checkpointId).toBe(points.water);
    expect(await place(staff.ADMIN!, people.dan, "")).toMatchObject({ changed: true });
  });

  it("refuses the Tehnic role, with nothing written (BR-REQ-060-01)", async () => {
    await expect(place(staff.DEV!, people.ana, points.junction)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(readVolunteerPlan(db, staff.DEV!, raceId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await rowOf(people.ana)).checkpointId).toBeNull();
    expect(await trail()).toHaveLength(0);
  });

  it("frees a point's people when the point is taken off the route", async () => {
    await place(staff.ADMIN!, people.ana, points.junction);
    await place(staff.ADMIN!, people.dan, points.water);
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.id, points.junction));
    expect((await rowOf(people.ana)).checkpointId).toBeNull();
    expect((await rowOf(people.dan)).checkpointId).toBe(points.water);
    const plan = await readVolunteerPlan(db, staff.ADMIN!, raceId);
    expect(plan.unplaced.map((one) => one.name)).toContain("Ana Pop");
  });
});

describe("§NNN the point among what is kept about a person", () => {
  it("names the point when the person asks for their data, and none while they stand at none (art. 15 GDPR)", async () => {
    const before = await viewPersonData(db, staff.ADMIN!, "ana.pop@example.test", NOW);
    expect(before.volunteerOffers.map((offer) => offer.checkpointName)).toEqual([null]);
    await place(staff.ADMIN!, people.ana, points.junction);
    const after = await viewPersonData(db, staff.ADMIN!, "ana.pop@example.test", NOW);
    expect(after.volunteerOffers.map((offer) => offer.checkpointName)).toEqual(["Intersecția Stejeriș"]);
  });
});

describe("§NNN the plan as it is read", () => {
  it("lists the points in the route's order with their people by name, and everybody else under them — never a cancelled person", async () => {
    await place(staff.ADMIN!, people.zoe, points.junction);
    await place(staff.ADMIN!, people.ana, points.junction);
    await place(staff.ADMIN!, people.dan, points.water);
    const plan = await readVolunteerPlan(db, staff.MODERATOR!, raceId);

    expect(plan.points.map(({ number, point }) => [number, point.nameRo])).toEqual([
      [1, "Intersecția Stejeriș"],
      [2, "Apă la cabană"],
      [3, "Podul de lemn"],
    ]);
    expect(plan.points.map(({ people: at }) => at.map((one) => one.name))).toEqual([["Ana Pop", "Zoe Manea"], ["Dan Ene"], []]);
    // Ion, offered and not placed. Eva is cancelled; Mara is another event's.
    expect(plan.unplaced.map((one) => one.name)).toEqual(["Ion Lupu"]);
    expect([...plan.roles.keys()].sort()).toEqual([guideId, waterId].sort());

    // Placed and cancelled since: off the plan, at the point or under it.
    await db.update(eventVolunteers).set({ state: "CANCELLED" }).where(eq(eventVolunteers.id, people.zoe));
    const later = await readVolunteerPlan(db, staff.MODERATOR!, raceId);
    expect(later.points[0].people.map((one) => one.name)).toEqual(["Ana Pop"]);
    expect(later.unplaced.map((one) => one.name)).toEqual(["Ion Lupu"]);
  });

  it("is not there for an event that is not", async () => {
    await expect(readVolunteerPlan(db, staff.ADMIN!, "11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readVolunteerPlan(db, staff.ADMIN!, "not-an-id")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("§NNN the plan's page", () => {
  it("draws each point with its people, their number, telephone and roles, and offers only who stands at no point", async () => {
    await place(staff.ADMIN!, people.ana, points.junction);
    await place(staff.ADMIN!, people.dan, points.water);
    const page = await planPage();

    expect(page).toContain(ro.Admin.volunteers.plan.title);
    expect(page).toContain("Crosul");
    expect(page).toContain("La puncte: 2 · Fără punct: 2 · Puncte fără nimeni: 1");
    const drawn = pointsOf(page);
    expect(drawn.map((part) => textOf(part, "plan-point-title")[0])).toEqual(["1. 1,2 km — Intersecția Stejeriș", "2. 5,5 km — Apă la cabană", "3. 7,25 km — Podul de lemn"]);
    // What the point is, in the backoffice's words.
    expect(drawn[0]).toContain("Direcționare");
    expect(drawn[1]).toContain("Apă");

    // Ana at the junction: her name to her page, her number, her telephone as a link, her role.
    expect(textOf(drawn[0], "plan-person-name")).toEqual(["Ana Pop"]);
    expect(drawn[0]).toContain(`href="/ro/admin/volunteers/${people.ana}"`);
    expect(drawn[0]).toContain("Nr. 501");
    expect(drawn[0]).toContain('href="tel:+40700000001"');
    expect(drawn[0]).toContain("Direcționare");
    expect(textOf(drawn[1], "plan-person-name")).toEqual(["Dan Ene"]);
    expect(drawn[1]).toContain("Punct de hidratare");
    // The bridge has nobody.
    expect(drawn[2]).toContain(ro.Admin.volunteers.plan.nobodyHere);
    expect(drawn[2]).not.toContain('data-testid="plan-person"');

    // «Pune aici» on every point: Ion and Zoe, who stand nowhere — never Ana or Dan, never the cancelled Eva.
    for (const part of drawn) {
      const select = part.match(/<select[\s\S]*?<\/select>/)![0];
      const offered = [...select.matchAll(/<option value="([0-9a-f-]{36})"/g)].map((match) => match[1]);
      expect(offered.sort()).toEqual([people.ion, people.zoe].sort());
      expect(select).toContain("Zoe Manea — Direcționare");
      expect(select).toMatch(/required/);
    }
    // «Scoate» on each person placed, posting no point.
    expect(drawn[0]).toMatch(new RegExp(`name="volunteerId" value="${people.ana}"[\\s\\S]*?name="checkpointId" value=""`));
    expect(drawn[0]).toContain("Scoate de la acest punct: Ana Pop");

    // Under the points: who stands at none — Ion not confirmed yet and with no role, Zoe with no telephone.
    const unplaced = page.slice(page.indexOf(ro.Admin.volunteers.plan.unplacedTitle));
    expect(textOf(unplaced, "plan-person-name")).toEqual(["Ion Lupu", "Zoe Manea"]);
    expect(unplaced).toContain("fără rol dat · neconfirmat încă");
    expect(page).not.toContain("Eva Stan");
    expect(page).not.toContain("Mara Dinu");
  });

  it("says so when everybody stands at a point, and when the event has no points yet", async () => {
    for (const id of [people.ana, people.dan, people.ion, people.zoe]) await place(staff.ADMIN!, id, points.bridge);
    const full = await planPage();
    expect(full).toContain(ro.Admin.volunteers.plan.unplacedNone);
    // Nobody left to offer: no «Pune aici» anywhere.
    expect(full).not.toContain('data-testid="plan-place-form"');

    // The other event, once its one point is taken off the route.
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.id, points.elsewhere));
    const bare = await planPage({}, runId);
    expect(bare).toContain("Evenimentul nu are încă puncte pe traseu.");
  });

  it("is in English for an English reader, and a 404 for the Tehnic role and for an event that is not there", async () => {
    await place(staff.ADMIN!, people.ana, points.junction);
    state.locale = "en";
    const page = await planPage();
    // As the markup carries an apostrophe.
    expect(page).toContain(en.Admin.volunteers.plan.title.replace(/'/g, "&#x27;"));
    expect(page).toContain("1. 1.2 km — Intersecția Stejeriș (en)");
    expect(page).toContain("At points: 1 · At no point: 3 · Points with nobody: 2");
    state.locale = "ro";

    await expect(planPage({}, "11111111-1111-4111-8111-111111111111")).rejects.toThrow("NOT_FOUND");
    await expect(planPage({}, "not-an-id")).rejects.toThrow("NOT_FOUND");
    state.actor = staff.DEV;
    await expect(planPage()).rejects.toThrow("NOT_FOUND");
  });

  it("puts a person at a point and takes them off from the page's forms, coming back to that point", async () => {
    expect(await press({ volunteerId: people.ion, checkpointId: points.water, at: points.water })).toBe(`/ro/admin/events/${raceId}/plan-voluntari#point-${points.water}`);
    expect((await rowOf(people.ion)).checkpointId).toBe(points.water);
    expect(await press({ volunteerId: people.ion, checkpointId: "", at: points.water })).toBe(`/ro/admin/events/${raceId}/plan-voluntari#point-${points.water}`);
    expect((await rowOf(people.ion)).checkpointId).toBeNull();

    // A refusal comes back with its code, and the page says it in words.
    const refused = await press({ volunteerId: people.ion, checkpointId: points.elsewhere, at: points.water });
    expect(refused).toBe(`/ro/admin/events/${raceId}/plan-voluntari?planError=NOT_FOUND#point-${points.water}`);
    expect(await planPage({ planError: "NOT_FOUND" })).toContain(ro.Admin.errors.NOT_FOUND);
    // A code that is no code says nothing.
    const forged = await planPage({ planError: "<script>" });
    expect(forged).not.toContain("&lt;script&gt;");
    expect(forged).not.toMatch(/MuiAlert-[a-z]*Error/);

    // The Tehnic role's press writes nothing.
    state.actor = staff.DEV;
    expect(await press({ volunteerId: people.ion, checkpointId: points.water, at: points.water })).toContain("planError=FORBIDDEN");
    expect((await rowOf(people.ion)).checkpointId).toBeNull();
  });
});

describe("§NNN the «Voluntari» list says each person's point", () => {
  it("links to the event's plan and names the point of whoever stands at one", async () => {
    await place(staff.ADMIN!, people.ana, points.water);
    const page = await listPage();
    expect(page).toContain(`href="/ro/admin/events/${raceId}/plan-voluntari"`);
    expect(page).toContain(ro.Admin.volunteers.plan.columnHint);
    // Ana's row, in the table and in her phone card; nobody else has a point.
    expect(textOf(page, "volunteer-point")).toEqual(["2. Apă la cabană", "2. Apă la cabană"]);

    // A cancelled person keeps the point on the row and shows none.
    await db.update(eventVolunteers).set({ state: "CANCELLED" }).where(eq(eventVolunteers.id, people.ana));
    expect(await listPage()).not.toContain('data-testid="volunteer-point"');
  });

  it("has no «Punct» column for an event with no points on its route", async () => {
    await db.delete(eventCheckpoints).where(eq(eventCheckpoints.id, points.elsewhere));
    const page = await listPage({ eventId: runId });
    expect(page).toContain(`href="/ro/admin/events/${runId}/plan-voluntari"`);
    expect(page).not.toContain(ro.Admin.volunteers.plan.columnHint);
  });
});
