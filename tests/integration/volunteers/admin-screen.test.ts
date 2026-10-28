import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import {
  countVolunteersAwaiting,
  countVolunteersForAdmin,
  findVolunteerForAdmin,
  listEventsWithVolunteers,
  listRoleNames,
  listRolesWithCounts,
  listVolunteersForAdmin,
  summariseVolunteersForAdmin,
  UNASSIGNED,
  VOLUNTEER_SORT_KEYS,
  type VolunteerSortKey,
} from "@/modules/volunteers/admin-list";
import { forgetVolunteersBadgeCount, volunteersBadgeCount } from "@/modules/volunteers/nav-count";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §839 — «Voluntari», the events' volunteers as one screen (the owner, 2026-10-21: «a nicer volunteers screen, similar
 * to the participants area»), from a real database:
 *
 * - the list reads the rows the filters leave — one event or every event, a state, a role or «De repartizat», a name
 *   with or without diacritics — in the order asked, with each row's roles given and offered and its event's title in
 *   the reader's language; its counter and its strip agree with it, the strip blind to the state and the role;
 * - the page draws the featured event unless one is chosen, every event while a name is searched, the strip's pills as
 *   links, each row's state verbs carrying where to come back to, and the event's card and file one link away; the
 *   person's page draws the card's block for them and comes back to itself; an Organizer and an Administrator read
 *   both, the Tehnic role and an unknown or guessed id get a 404 (BR-REQ-060-01);
 * - a verb pressed on the screen comes back to the page it came from, a refusal's code in the address, and a `returnTo`
 *   that is not a path of the screen sends nobody anywhere but the event's card;
 * - the tab's figure is the offers still waiting on the events ahead, memoized a minute.
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
// The house's typed routing, reduced to what the screen asks of it: the locale's prefix, the params filled in, a query appended.
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

const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");
const { default: SectionLayout } = await import("@/app/[locale]/admin/volunteers/(list)/layout");
const { default: AdminVolunteerPage } = await import("@/app/[locale]/admin/volunteers/[id]/page");
const actions = await import("@/app/[locale]/admin/events/[id]/volunteer-actions");

const NOW = new Date("2026-10-21T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
let runId: string;
let waterId: string;
let finishId: string;
let marshalId: string;
const people: Record<"ana" | "stefan" | "mihai" | "dana" | "bogdan", string> = { ana: "", stefan: "", mihai: "", dana: "", bogdan: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function person(role: StaffRole, name: string): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
  return row;
}

/** A volunteer written as the form or the card writes one, with the roles chosen and the roles given (§837). */
async function volunteer(over: {
  eventId: string;
  name: string;
  state?: "REGISTERED" | "CONFIRMED" | "CANCELLED";
  source?: "STAFF" | "PUBLIC";
  given?: string[];
  chosen?: string[];
  createdAt?: Date;
}): Promise<string> {
  const email = `${over.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({
      eventId: over.eventId,
      name: over.name,
      email,
      canonicalEmail: email,
      canonicalizationVersion: 1,
      phone: "0700000000",
      source: over.source ?? "PUBLIC",
      state: over.state ?? "REGISTERED",
      roleId: over.given?.[0] ?? null,
      createdAt: over.createdAt ?? NOW,
      updatedAt: over.createdAt ?? NOW,
    })
    .returning({ id: eventVolunteers.id });
  if (over.chosen?.length) await db.insert(eventVolunteerRoleChoices).values(over.chosen.map((roleId) => ({ volunteerId: row.id, roleId })));
  if (over.given?.length) await db.insert(eventVolunteerRoleAssignments).values(over.given.map((roleId) => ({ volunteerId: row.id, roleId })));
  return row.id;
}

beforeEach(async () => {
  await resetTables(db);
  forgetVolunteersBadgeCount();
  state.locale = "ro";
  state.redirected.length = 0;
  staff.ADMIN = await person("ADMIN", "Ana Admin");
  staff.MODERATOR = await person("MODERATOR", "Oana Organizator");
  staff.DEV = await person("DEV", "Tudor Tehnic");
  state.actor = staff.ADMIN;
  const [race, run] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), featured: true, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-10-01T00:00:00.000Z") },
      { type: "GROUP_RUN", startsAt: new Date("2026-11-04T16:00:00.000Z"), acceptsVolunteers: true },
      // Takes no volunteers and has none: not an event of this screen.
      { type: "GROUP_RUN", startsAt: new Date("2026-11-11T16:00:00.000Z") },
    ])
    .returning({ id: events.id });
  raceId = race.id;
  runId = run.id;
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
    { eventId: runId, locale: "ro", slug: `alergarea-${runId.slice(0, 8)}`, title: "Alergarea" },
    { eventId: runId, locale: "en", slug: `run-${runId.slice(0, 8)}`, title: "The run" },
  ]);
  const [water, finish] = await db
    .insert(eventVolunteerRoles)
    .values([
      { eventId: raceId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3, position: 0 },
      { eventId: raceId, nameRo: "Sosire", nameEn: "Finish", needed: 2, position: 1 },
    ])
    .returning({ id: eventVolunteerRoles.id });
  waterId = water.id;
  finishId = finish.id;
  const [marshal] = await db.insert(eventVolunteerRoles).values({ eventId: runId, nameRo: "Direcționare", nameEn: "Marshal", needed: null }).returning({ id: eventVolunteerRoles.id });
  marshalId = marshal.id;
  people.ana = await volunteer({ eventId: raceId, name: "Ana Pop", chosen: [waterId], given: [waterId], createdAt: new Date("2026-10-01T10:00:00.000Z") });
  people.stefan = await volunteer({ eventId: raceId, name: "Ștefan Tănase", state: "CONFIRMED", chosen: [waterId, finishId], given: [waterId, finishId], createdAt: new Date("2026-10-02T10:00:00.000Z") });
  people.mihai = await volunteer({ eventId: raceId, name: "Mihai Anulat", state: "CANCELLED", given: [finishId], source: "STAFF", createdAt: new Date("2026-10-03T10:00:00.000Z") });
  people.dana = await volunteer({ eventId: raceId, name: "Dana Ionescu", chosen: [finishId], createdAt: new Date("2026-10-04T10:00:00.000Z") });
  people.bogdan = await volunteer({ eventId: runId, name: "Bogdan Vasile", chosen: [marshalId], given: [marshalId], createdAt: new Date("2026-10-05T10:00:00.000Z") });
});

/** A page as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(page: ReactElement): Promise<string> {
  // The client islands (the pager, the fold, the submit buttons) read the catalogue from the provider the admin layout wraps them in.
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const element = createElement(NextIntlClientProvider, intl, page);
  const stream = await renderToReadableStream(element, { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}

const listPage = async (params: Record<string, string> = {}, locale: "ro" | "en" = "ro") => {
  state.locale = locale;
  return html(await AdminVolunteersPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(params) }));
};
const personPage = async (id: string, params: { volunteerError?: string } = {}) =>
  html(await AdminVolunteerPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve(params) }));

/** The hidden `returnTo` values a page's forms carry. */
const returnTos = (page: string) => [...page.matchAll(/<input type="hidden" name="returnTo" value="([^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));

const names = (rows: { name: string }[]) => rows.map((row) => row.name);
const firstPage = { limit: 25, offset: 0, sort: "name" as VolunteerSortKey, dir: "asc" as const };

function form(fields: Record<string, string>, eventId = raceId): FormData {
  const data = new FormData();
  data.set("uiLocale", "ro");
  data.set("eventId", eventId);
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** A one-button form: it always redirects, with the refusal's code in the address when it has one. */
async function press(action: (form: FormData) => Promise<void>, data: FormData): Promise<string> {
  state.redirected.length = 0;
  await action(data).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
  });
  return state.redirected.at(-1) ?? "";
}

describe("the list's repository (§839)", () => {
  it("offers the events that take volunteers or have any, the featured one first, titled in the reader's language", async () => {
    const listed = await listEventsWithVolunteers(db, "ro");
    expect(listed.map((event) => [event.id, event.title])).toEqual([
      [raceId, "Crosul"],
      [runId, "Alergarea"],
    ]);
    expect((await listEventsWithVolunteers(db, "en")).map((event) => event.title)).toEqual(["The cross", "The run"]);
  });

  it("reads one event's rows with their roles given and offered, or every event's with each one's title", async () => {
    const rows = await listVolunteersForAdmin(db, { eventId: raceId }, firstPage, "ro");
    expect(names(rows)).toHaveLength(4);
    expect(names(rows).slice(0, 3)).toEqual(["Ana Pop", "Dana Ionescu", "Mihai Anulat"]);
    const stefan = rows.find((row) => row.name === "Ștefan Tănase");
    expect(stefan?.roleIds).toEqual([waterId, finishId]);
    expect(stefan?.choiceIds).toEqual([waterId, finishId]);
    expect(stefan?.eventTitle).toBe("Crosul");
    expect(rows.find((row) => row.name === "Dana Ionescu")?.roleIds).toEqual([]);

    const all = await listVolunteersForAdmin(db, {}, firstPage, "en");
    expect(names(all)).toHaveLength(5);
    expect(all.find((row) => row.name === "Bogdan Vasile")?.eventTitle).toBe("The run");
    expect(await countVolunteersForAdmin(db, {})).toBe(5);
    expect(await countVolunteersForAdmin(db, { eventId: raceId })).toBe(4);
  });

  it("filters by state, by a role given, by «De repartizat» and by a name typed without diacritics", async () => {
    expect(names(await listVolunteersForAdmin(db, { eventId: raceId, state: "CONFIRMED" }, firstPage, "ro"))).toEqual(["Ștefan Tănase"]);
    expect(names(await listVolunteersForAdmin(db, { eventId: raceId, role: waterId }, firstPage, "ro"))).toEqual(["Ana Pop", "Ștefan Tănase"]);
    expect(names(await listVolunteersForAdmin(db, { eventId: raceId, role: UNASSIGNED }, firstPage, "ro"))).toEqual(["Dana Ionescu"]);
    expect(names(await listVolunteersForAdmin(db, { search: "tanase" }, firstPage, "ro"))).toEqual(["Ștefan Tănase"]);
    expect(names(await listVolunteersForAdmin(db, { search: "STEFAN" }, firstPage, "ro"))).toEqual(["Ștefan Tănase"]);
    expect(await countVolunteersForAdmin(db, { search: "%" })).toBe(0);
  });

  it("orders by every sort key, the states in the card's order", async () => {
    for (const sort of VOLUNTEER_SORT_KEYS) {
      for (const dir of ["asc", "desc"] as const) expect(await listVolunteersForAdmin(db, { eventId: raceId }, { ...firstPage, sort, dir }, "ro")).toHaveLength(4);
    }
    const byState = await listVolunteersForAdmin(db, { eventId: raceId }, { ...firstPage, sort: "state", dir: "asc" }, "ro");
    expect(byState.map((row) => row.state)).toEqual(["REGISTERED", "REGISTERED", "CONFIRMED", "CANCELLED"]);
    const newestFirst = await listVolunteersForAdmin(db, {}, { ...firstPage, sort: "since", dir: "desc" }, "ro");
    expect(names(newestFirst)[0]).toBe("Bogdan Vasile");
    const byEvent = await listVolunteersForAdmin(db, {}, { ...firstPage, sort: "event", dir: "asc" }, "ro");
    expect(names(byEvent)[0]).toBe("Bogdan Vasile");
  });

  it("summarises the scope by state and how many wait for a role, blind to the state and the role", async () => {
    expect(await summariseVolunteersForAdmin(db, { eventId: raceId })).toEqual({
      total: 4,
      byState: { REGISTERED: 2, CONFIRMED: 1, CANCELLED: 1 },
      // Dana alone: Mihai holds a role, and a cancelled person waits for nothing anyway.
      unassigned: 1,
    });
    expect((await summariseVolunteersForAdmin(db, {})).total).toBe(5);
    // «Ana Pop», «Dana Ionescu» and «Ștefan Tănase»: the folded «tanase» holds «ana» too.
    expect((await summariseVolunteersForAdmin(db, { search: "ana" })).total).toBe(3);
    expect((await summariseVolunteersForAdmin(db, { search: "ionescu" })).total).toBe(1);
  });

  it("counts the offers still waiting on the events ahead for the tab, and memoizes them a minute", async () => {
    // Ana, Dana and Bogdan: «Înscris» on events not yet over; Ștefan is confirmed, Mihai cancelled.
    expect(await countVolunteersAwaiting(db, NOW)).toBe(3);
    expect(await countVolunteersAwaiting(db, new Date("2026-12-01T10:00:00.000Z"))).toBe(0);
    expect(await volunteersBadgeCount(db, NOW)).toBe(3);
    await volunteer({ eventId: runId, name: "Nou Venit" });
    expect(await volunteersBadgeCount(db, new Date(NOW.getTime() + 30_000))).toBe(3);
    expect(await volunteersBadgeCount(db, new Date(NOW.getTime() + 61_000))).toBe(4);
    forgetVolunteersBadgeCount();
    expect(await volunteersBadgeCount(db, NOW)).toBe(4);
  });

  it("finds one person with their event, names the roles of a page's rows, and counts who holds each role", async () => {
    const ana = await findVolunteerForAdmin(db, people.ana, "ro");
    expect(ana?.name).toBe("Ana Pop");
    expect(ana?.event.id).toBe(raceId);
    expect(ana?.eventTitle).toBe("Crosul");
    expect(ana?.roleIds).toEqual([waterId]);
    expect(await findVolunteerForAdmin(db, "00000000-0000-4000-8000-000000000000", "ro")).toBeNull();

    const roleNames = await listRoleNames(db, [waterId, marshalId]);
    expect(roleNames.get(waterId)).toEqual({ nameRo: "Punct de apă", nameEn: "Water point" });
    expect(roleNames.get(marshalId)?.nameEn).toBe("Marshal");
    expect((await listRoleNames(db, [])).size).toBe(0);

    const counts = await listRolesWithCounts(db, raceId);
    // Mihai's finish role is not counted: a cancelled person holds no place in «N din M» (§761).
    expect(counts.map((role) => [role.nameRo, role.given])).toEqual([
      ["Punct de apă", 2],
      ["Sosire", 1],
    ]);
  });
});

describe("the list page (§839)", () => {
  it("opens on the featured event, every row's verbs coming back to this page, with the event's card and file one link away", async () => {
    const page = await listPage();
    expect(page).toContain("Ana Pop");
    expect(page).toContain("Dana Ionescu");
    expect(page).not.toContain("Bogdan Vasile");
    // Dana waits for a role; Mihai is cancelled and gets no «De repartizat». Once per layout: `AdminTable` draws the table and the phone cards.
    expect(page.match(/data-testid="volunteer-unassigned"/g)).toHaveLength(2);
    // Mihai was typed by an organizer.
    expect(page.match(/data-testid="volunteer-staff-chip"/g)).toHaveLength(2);
    expect(page).toContain("Roluri date");
    expect(page).toContain("Punct de apă, Sosire");
    expect(new Set(returnTos(page))).toEqual(new Set(["/ro/admin/volunteers"]));
    expect(page).toContain(`href="/ro/admin/events/${raceId}#box-volunteers"`);
    expect(page).toContain(`href="/api/admin/events/${raceId}/volunteers?lang=ro"`);
    // One event chosen: its own file, not every event's (§846).
    expect(page).not.toContain('data-testid="volunteers-xlsx-all"');
    expect(page).toContain(`href="/ro/admin/volunteers/${people.ana}"`);
    // The strip: everyone, each state, and «De repartizat», as links.
    expect(page).toContain("Voluntari: 4");
    expect(page).toContain("De repartizat: 1");
    expect(page).toContain("Confirmat: 1");
  });

  it("spans every event on «all», and widens a name search to every event, saying so", async () => {
    const all = await listPage({ eventId: "all" });
    expect(all).toContain("Bogdan Vasile");
    expect(all).toContain("Alergarea");
    expect(all).not.toContain(`href="/api/admin/events/${raceId}/volunteers`);
    // Every event: one workbook of them all, «Descarcă Excel: toate evenimentele» (§846).
    expect(all).toContain('href="/api/admin/volunteers/export?lang=ro"');
    expect(all).toContain("Descarcă Excel: toate evenimentele");
    const searched = await listPage({ q: "stefan" });
    expect(searched).toContain("Ștefan Tănase");
    expect(searched).not.toContain("Ana Pop");
    expect(searched).toContain('data-testid="volunteers-search-everywhere"');
  });

  it("narrows by state and by «De repartizat», the filters riding with every verb's way back", async () => {
    const confirmed = await listPage({ state: "CONFIRMED" });
    expect(confirmed).toContain("Ștefan Tănase");
    expect(confirmed).not.toContain("Ana Pop");
    const waiting = await listPage({ eventId: raceId, role: "none", page: "1" });
    expect(waiting).toContain("Dana Ionescu");
    expect(waiting).not.toContain("Ana Pop");
    expect(new Set(returnTos(waiting))).toEqual(new Set([`/ro/admin/volunteers?eventId=${raceId}&role=none&page=1`]));
    // A role nobody has, or junk, is no filter.
    expect(await listPage({ eventId: raceId, role: "junk" })).toContain("Ana Pop");
    expect(await listPage({ state: "JUNK" })).toContain("Ana Pop");
  });

  it("says a refusal's code as a sentence and ignores an unknown one; reads in English too", async () => {
    expect(await listPage({ volunteerError: "CONFLICT" })).toContain(ro.Admin.errors.CONFLICT);
    expect(await listPage({ volunteerError: "NOT_A_CODE" })).not.toContain('role="alert"');
    expect(await listPage()).not.toContain('role="alert"');
    const english = await listPage({}, "en");
    expect(english).toContain("Water point, Finish");
    expect(english).toContain("Volunteers: 4");
  });

  it("is read by the Organizer and the Administrator and refused to the Tehnic role, by the page and by the layout", async () => {
    state.actor = staff.MODERATOR;
    expect(await listPage()).toContain("Ana Pop");
    state.actor = staff.DEV;
    await expect(listPage()).rejects.toThrow("NOT_FOUND");
    await expect(SectionLayout({ children: null })).rejects.toThrow("NOT_FOUND");
    state.actor = staff.ADMIN;
    expect(await SectionLayout({ children: null })).toBeTruthy();
  });
});

describe("«Adaugă un voluntar de mână» on the list (§NNN)", () => {
  it("draws the card's form for the event in scope, coming back to this page, and none across every event", async () => {
    const page = await listPage();
    const add = /data-testid="volunteers-add"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
    expect(add).toContain("Adaugă un voluntar de mână");
    expect(add).toContain(`name="eventId" value="${raceId}"`);
    expect(returnTos(add)).toEqual(["/ro/admin/volunteers"]);
    expect(add).toContain("Punct de apă");
    expect(await listPage({ eventId: "all" })).not.toContain('data-testid="volunteers-add"');
  });

  it("adds the person to the event in scope, typed by an organizer, and comes back to the list", async () => {
    const back = `/ro/admin/volunteers?eventId=${raceId}&page=1`;
    state.redirected.length = 0;
    const fields = { name: "Maria Test", email: "maria@example.test", phone: "0712 345 678", note: "", roleIds: waterId, assignedRoleIds: waterId, returnTo: back };
    await actions.addVolunteerAction(null, form(fields)).catch((error: unknown) => {
      if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
    });
    expect(state.redirected.at(-1)).toBe(back);
    const [maria] = await db.select({ eventId: eventVolunteers.eventId, source: eventVolunteers.source, state: eventVolunteers.state }).from(eventVolunteers).where(eq(eventVolunteers.name, "Maria Test"));
    expect(maria).toEqual({ eventId: raceId, source: "STAFF", state: "REGISTERED" });
  });
});

describe("the person's page (§839)", () => {
  it("draws the card's block for one person, coming back to itself, with the way back to the list and to the event", async () => {
    const page = await personPage(people.stefan);
    expect(page).toContain("Ștefan Tănase");
    expect(page).toContain('data-testid="volunteer-row"');
    expect(page).toContain(`href="/ro/admin/volunteers?eventId=${raceId}"`);
    expect(page).toContain(`href="/ro/admin/events/${raceId}#box-volunteers"`);
    expect(page).toContain('data-testid="volunteer-event-line"');
    expect(page).toContain("Crosul");
    expect(new Set(returnTos(page))).toEqual(new Set([`/ro/admin/volunteers/${people.stefan}`]));
    expect(await personPage(people.stefan, { volunteerError: "CONFLICT" })).toContain(ro.Admin.errors.CONFLICT);
  });

  it("draws the block open under the page's own header (§842): no row fold, and the name and the state said once", async () => {
    const page = await personPage(people.stefan);
    expect(page).toMatch(/<section[^>]*data-testid="volunteer-row"/);
    expect(page).not.toContain('data-testid="volunteer-edit"');
    expect(page).not.toContain('data-testid="volunteer-name"');
    expect(page.match(/data-testid="volunteer-state"/g)).toHaveLength(1);
    expect(page.match(/<h2[^>]*>Ștefan Tănase<\/h2>/g)).toHaveLength(1);
    // The verbs are there, open: the state's, «Modifică» and «Șterge voluntarul».
    expect(page).toContain('data-testid="volunteer-status"');
    expect(page).toContain(">Șterge voluntarul<");
  });

  it("is a 404 for a guessed id, an unknown one, and the Tehnic role", async () => {
    await expect(personPage("not-an-id")).rejects.toThrow("NOT_FOUND");
    await expect(personPage("00000000-0000-4000-8000-000000000000")).rejects.toThrow("NOT_FOUND");
    state.actor = staff.DEV;
    await expect(personPage(people.ana)).rejects.toThrow("NOT_FOUND");
  });
});

describe("a verb pressed on the screen comes back to it (§839)", () => {
  it("returns to the list's page it came from, filters kept, and to the person's page", async () => {
    const back = `/ro/admin/volunteers?eventId=${raceId}&state=REGISTERED&page=2`;
    expect(await press(actions.setVolunteerStateAction, form({ volunteerId: people.ana, state: "CONFIRMED", returnTo: back }))).toBe(back);
    const [ana] = await db.select({ state: eventVolunteers.state }).from(eventVolunteers).where(eq(eventVolunteers.id, people.ana));
    expect(ana.state).toBe("CONFIRMED");
    const own = `/ro/admin/volunteers/${people.dana}`;
    expect(await press(actions.assignVolunteerAction, form({ volunteerId: people.dana, roleId: finishId, returnTo: own }))).toBe(own);
    // A searched name travels with its `+` for the space.
    const searched = "/ro/admin/volunteers?q=ana+pop";
    expect(await press(actions.setVolunteerStateAction, form({ volunteerId: people.ana, state: "REGISTERED", returnTo: searched }))).toBe(searched);
  });

  it("carries a refusal's code back in the address, replacing the last one", async () => {
    const back = `/ro/admin/volunteers?eventId=${raceId}&volunteerError=NOT_FOUND`;
    // A cancelled person is given no role (§837): reopen first.
    expect(await press(actions.assignVolunteerAction, form({ volunteerId: people.mihai, roleId: waterId, returnTo: back }))).toBe(
      `/ro/admin/volunteers?eventId=${raceId}&volunteerError=CONFLICT`,
    );
  });

  it("sends a forged `returnTo` nowhere but the event's card", async () => {
    for (const forged of ["https://example.test/ro/admin/volunteers", "/ro/admin/events/x", "//evil/ro/admin/volunteers", `/ro/admin/volunteers?eventId=${raceId}#x`, "/ro/admin/volunteers/not-an-id"]) {
      expect(await press(actions.setVolunteerStateAction, form({ volunteerId: people.ana, state: "CONFIRMED", returnTo: forged }))).toBe(`/ro/admin/events/${raceId}#box-volunteers`);
    }
  });
});
