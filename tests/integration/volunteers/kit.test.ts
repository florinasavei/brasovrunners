import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerCategories, eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { countVolunteersWithKit, listRoleNames, listRolesWithCounts, listVolunteersForAdmin, summariseVolunteersForAdmin, type VolunteerSortKey } from "@/modules/volunteers/admin-list";
import { roleLabel } from "@/modules/volunteers/domain/volunteer";
import { viewPersonData } from "@/modules/registrations/person-data";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { readSheet } from "../../helpers/xlsx";

/**
 * §904 — «Are kit» (the owner, 2026-11-03: «ar trebui să număr pe header câți au kit, deci trebuie încă un field de „are kit"»), and
 * the role names the «Voluntari» list printed twice, from a real database:
 *
 * - the list's row carries the house's one-press tick (`TickButton` in a plain form posting the state it wants); the Organizer and the
 *   Administrator tick and clear it, each change audited as `volunteer.edited` naming the box, a press that changes nothing writing
 *   nothing, the Tehnic role refused with nothing written (BR-REQ-060-01); «Modifică» and «Adaugă un voluntar de mână» save it from
 *   their box, and a person's data (art. 15) carries it;
 * - the strip says «Cu kit: N» — the ticked who are not cancelled, blind to the filters — and the pill and the select filter by it;
 * - the event's CSV and spreadsheet carry an «Are kit» column, «Da» / «Nu»;
 * - a role name standing in two categories («Direcționare» under «Start / Sosire» and under «Traseu») is printed with its category in
 *   «Roluri date» and «S-a oferit pentru», each role once: the links are read once per row (their primary keys), and the doubling was
 *   two roles printed by the same bare name.
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
const { default: AdminVolunteerPage } = await import("@/app/[locale]/admin/volunteers/[id]/page");
const { setVolunteerKitAction } = await import("@/app/[locale]/admin/volunteers/actions");
const actions = await import("@/app/[locale]/admin/events/[id]/volunteer-actions");
const { GET: eventFile } = await import("@/app/api/admin/events/[id]/volunteers/route");

const NOW = new Date("2026-10-21T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let raceId: string;
let runId: string;
let guideStartId: string;
let guideRouteId: string;
let waterId: string;
const people: Record<"ana" | "dan" | "eva" | "ion" | "mara", string> = { ana: "", dan: "", eva: "", ion: "", mara: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function person(role: StaffRole, name: string): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
  return row;
}

/** A volunteer as the form or the card writes one, with the roles chosen and given (§837) and the organizers' «Are kit». */
async function volunteer(over: {
  eventId: string;
  name: string;
  state?: "REGISTERED" | "CONFIRMED" | "CANCELLED";
  given?: string[];
  chosen?: string[];
  hasKit?: boolean;
  createdAt: Date;
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
      phone: "+40712345678",
      source: "PUBLIC",
      state: over.state ?? "REGISTERED",
      roleId: over.given?.[0] ?? null,
      hasKit: over.hasKit ?? false,
      createdAt: over.createdAt,
      updatedAt: over.createdAt,
    })
    .returning({ id: eventVolunteers.id });
  if (over.chosen?.length) await db.insert(eventVolunteerRoleChoices).values(over.chosen.map((roleId) => ({ volunteerId: row.id, roleId })));
  if (over.given?.length) await db.insert(eventVolunteerRoleAssignments).values(over.given.map((roleId) => ({ volunteerId: row.id, roleId })));
  return row.id;
}

beforeEach(async () => {
  await resetTables(db);
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
  // The club's own shape of the race (the sample's, §774): one role name under two categories.
  const [start, route] = await db
    .insert(eventVolunteerCategories)
    .values([
      { eventId: raceId, nameRo: "Start / Sosire", nameEn: "Start / Finish", sort: 0 },
      { eventId: raceId, nameRo: "Traseu", nameEn: "Route", sort: 1 },
    ])
    .returning({ id: eventVolunteerCategories.id });
  const [guideStart, guideRoute, water] = await db
    .insert(eventVolunteerRoles)
    .values([
      { eventId: raceId, categoryId: start.id, nameRo: "Direcționare", nameEn: "Guidance", needed: 2, position: 0 },
      { eventId: raceId, categoryId: route.id, nameRo: "Direcționare", nameEn: "Guidance", needed: 2, position: 1 },
      { eventId: raceId, categoryId: route.id, nameRo: "Punct de hidratare", nameEn: "Water point", needed: 3, position: 2 },
    ])
    .returning({ id: eventVolunteerRoles.id });
  guideStartId = guideStart.id;
  guideRouteId = guideRoute.id;
  waterId = water.id;
  const [marshal] = await db.insert(eventVolunteerRoles).values({ eventId: runId, nameRo: "Marcaj", nameEn: "Marking", needed: null }).returning({ id: eventVolunteerRoles.id });
  // Ana offered «Direcționare» in both categories and was given the route's: two choices, one role.
  people.ana = await volunteer({ eventId: raceId, name: "Ana Pop", chosen: [guideStartId, guideRouteId], given: [guideRouteId], createdAt: new Date("2026-10-01T10:00:00.000Z") });
  people.dan = await volunteer({ eventId: raceId, name: "Dan Ene", state: "CONFIRMED", chosen: [waterId], given: [waterId], hasKit: true, createdAt: new Date("2026-10-02T10:00:00.000Z") });
  // Ticked, then cancelled: handed nothing, counted nowhere.
  people.eva = await volunteer({ eventId: raceId, name: "Eva Stan", state: "CANCELLED", chosen: [waterId], hasKit: true, createdAt: new Date("2026-10-03T10:00:00.000Z") });
  people.ion = await volunteer({ eventId: raceId, name: "Ion Lupu", chosen: [waterId], createdAt: new Date("2026-10-04T10:00:00.000Z") });
  // Another event's volunteer with a kit: counted for that event and across every event, never for the race.
  people.mara = await volunteer({ eventId: runId, name: "Mara Dinu", state: "CONFIRMED", chosen: [marshal.id], given: [marshal.id], hasKit: true, createdAt: new Date("2026-10-05T10:00:00.000Z") });
});

/** A page as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(page: ReactElement): Promise<string> {
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
const personPage = async (id: string) => html(await AdminVolunteerPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) }));

/** The row forms of «Are kit» on a page — `AdminTable` draws each row twice, the table and the phone cards — for one person. */
const kitFormsOf = (page: string, id: string) => [...page.matchAll(/<form[^>]*data-testid="volunteer-kit-form"[\s\S]*?<\/form>/g)].map((match) => match[0]).filter((one) => one.includes(`value="${id}"`));
const textOf = (page: string, testid: string) => [...page.matchAll(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`, "g"))].map((match) => match[1].replace(/&amp;/g, "&"));

function form(fields: Record<string, string | string[]>, eventId = raceId): FormData {
  const data = new FormData();
  data.set("uiLocale", "ro");
  data.set("eventId", eventId);
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string") data.set(name, value);
    else for (const item of value) data.append(name, item);
  }
  return data;
}

/** A form's press: it always redirects, with the refusal's code in the address when it has one. */
async function press(action: (form: FormData) => Promise<unknown>, data: FormData): Promise<string> {
  state.redirected.length = 0;
  await action(data).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
  });
  return state.redirected.at(-1) ?? "";
}

const kitOf = async (id: string) => (await db.select({ hasKit: eventVolunteers.hasKit }).from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0]?.hasKit;
const kitAudits = async (id: string) =>
  (await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.edited"))).filter((row) => (row.metadataJson as { volunteerId?: string }).volunteerId === id);
const firstPage = { limit: 25, offset: 0, sort: "since" as VolunteerSortKey, dir: "asc" as const };

describe("«Are kit» on the list's row (§904)", () => {
  it("is the house's one-press tick: a submit drawn as the checkbox, its state in aria-checked, posting the state it wants and coming back to this page", async () => {
    const page = await listPage();
    expect(page).toContain(">Kit<");
    const dan = kitFormsOf(page, people.dan);
    expect(dan.length).toBeGreaterThan(0);
    for (const one of dan) {
      // The form's one button is the tick.
      const button = /<button\b[^>]*>/.exec(one)?.[0] ?? "";
      expect(button).toContain('data-testid="volunteer-kit-tick"');
      expect(button).toContain('type="submit"');
      expect(button).toContain('role="checkbox"');
      expect(button).toContain('aria-checked="true"');
      expect(one).toContain('name="hasKit" value="0"');
      expect(one).toContain('name="returnTo" value="/ro/admin/volunteers"');
      expect(one).toContain("Are kit");
    }
    expect(kitFormsOf(page, people.ana).length).toBeGreaterThan(0);
    for (const one of kitFormsOf(page, people.ana)) {
      expect(one).toContain('aria-checked="false"');
      expect(one).toContain('name="hasKit" value="1"');
    }
    // Never a toggle's verb: the words name the setting, ticked or not.
    expect(dan.join("")).not.toMatch(/Bifează|Debifează|Pornește|Oprește/);
  });

  it("is ticked and cleared by the Administrator and the Organizer, each change audited naming the box; a press that changes nothing writes nothing", async () => {
    const back = `/ro/admin/volunteers?eventId=${raceId}&kit=no&page=1`;
    expect(await press(setVolunteerKitAction, form({ volunteerId: people.ana, hasKit: "1", returnTo: back }))).toBe(back);
    expect(await kitOf(people.ana)).toBe(true);
    const [ticked] = await kitAudits(people.ana);
    expect(ticked.actorStaffUserId).toBe(staff.ADMIN?.id);
    expect(ticked.entityId).toBe(raceId);
    expect(ticked.metadataJson).toEqual({ volunteerId: people.ana, fields: ["hasKit"], hasKit: true, assignedRoleIds: [guideRouteId] });

    // The same state again — a second press before the page answered: nothing written, no second row.
    await press(setVolunteerKitAction, form({ volunteerId: people.ana, hasKit: "1", returnTo: back }));
    expect(await kitAudits(people.ana)).toHaveLength(1);

    state.actor = staff.MODERATOR;
    await press(setVolunteerKitAction, form({ volunteerId: people.ana, hasKit: "0", returnTo: back }));
    expect(await kitOf(people.ana)).toBe(false);
    const rows = await kitAudits(people.ana);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.actorStaffUserId === staff.MODERATOR?.id)?.metadataJson).toMatchObject({ fields: ["hasKit"], hasKit: false });
    // Nothing else of the person moved.
    const [ana] = await db.select({ state: eventVolunteers.state, name: eventVolunteers.name }).from(eventVolunteers).where(eq(eventVolunteers.id, people.ana));
    expect(ana).toEqual({ state: "REGISTERED", name: "Ana Pop" });
  });

  it("is refused to the Tehnic role and for a person of another event, with nothing written", async () => {
    state.actor = staff.DEV;
    const refusal = await press(setVolunteerKitAction, form({ volunteerId: people.ana, hasKit: "1", returnTo: "/ro/admin/volunteers" }));
    expect(refusal).toBe("/ro/admin/volunteers?volunteerError=FORBIDDEN");
    expect(await kitOf(people.ana)).toBe(false);
    state.actor = staff.ADMIN;
    // Mara is the run's: posted as the race's, she is not there.
    expect(await press(setVolunteerKitAction, form({ volunteerId: people.mara, hasKit: "0", returnTo: "/ro/admin/volunteers" }))).toBe("/ro/admin/volunteers?volunteerError=NOT_FOUND");
    expect(await kitOf(people.mara)).toBe(true);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.edited"))).toEqual([]);
  });
});

describe("«Are kit» in «Modifică», in «Adaugă un voluntar de mână» and in a person's data (§904)", () => {
  it("is a box of the person's «Modifică», ticked as saved, beside the chip «Are kit»", async () => {
    const page = await personPage(people.dan);
    const box = /<input\b[^>]*\bname="hasKit"[^>]*>/.exec(page)?.[0] ?? "";
    expect(box).toContain('type="checkbox"');
    expect(box).toContain("checked");
    expect(page).toContain('data-testid="volunteer-kit"');
    const ana = await personPage(people.ana);
    expect(/<input\b[^>]*\bname="hasKit"[^>]*>/.exec(ana)?.[0] ?? "").not.toContain("checked");
    expect(ana).not.toContain('data-testid="volunteer-kit"');
  });

  it("is saved by «Modifică», audited among the boxes changed — whatever the privacy notice names, being the club's own mark", async () => {
    // Ion's boxes as «Modifică» posts them; a ticked box posts `on`, an unticked one nothing at all.
    const boxes = { volunteerId: people.ion, name: "Ion Lupu", email: "ion.lupu@example.test", phone: "0712 345 678", note: "", roleIds: [waterId], assignedRoleIds: [] as string[] };
    await actions.editVolunteerAction(null, form({ ...boxes, hasKit: "on" })).catch((error: unknown) => {
      if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
    });
    expect(await kitOf(people.ion)).toBe(true);
    const [edited] = await kitAudits(people.ion);
    expect((edited.metadataJson as { fields: string[] }).fields).toEqual(["hasKit"]);

    // The box left unticked clears it.
    await actions.editVolunteerAction(null, form(boxes)).catch((error: unknown) => {
      if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
    });
    expect(await kitOf(people.ion)).toBe(false);
  });

  it("is saved by «Adaugă un voluntar de mână» on the list, the audit row saying so", async () => {
    const back = `/ro/admin/volunteers?eventId=${raceId}&page=1`;
    state.redirected.length = 0;
    await actions
      .addVolunteerAction(null, form({ name: "Maria Test", email: "maria@example.test", phone: "0712 345 678", note: "", roleIds: [waterId], assignedRoleIds: [waterId], hasKit: "on", returnTo: back }))
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
      });
    expect(state.redirected.at(-1)).toBe(back);
    const [maria] = await db.select({ id: eventVolunteers.id, hasKit: eventVolunteers.hasKit }).from(eventVolunteers).where(eq(eventVolunteers.name, "Maria Test"));
    expect(maria.hasKit).toBe(true);
    const [added] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.added"));
    expect(added.metadataJson).toMatchObject({ volunteerId: maria.id, hasKit: true });
    // Unticked, it is off, and the audit row says nothing of it.
    await actions.addVolunteerAction(null, form({ name: "Radu Test", email: "radu@example.test", phone: "0712 345 679", note: "", roleIds: [waterId], assignedRoleIds: [] })).catch(() => {});
    const [radu] = await db.select({ hasKit: eventVolunteers.hasKit }).from(eventVolunteers).where(eq(eventVolunteers.name, "Radu Test"));
    expect(radu.hasKit).toBe(false);
  });

  it("is among what is kept about the offer when the person asks for their data (art. 15 GDPR)", async () => {
    const data = await viewPersonData(db, staff.ADMIN as StaffUser, "dan.ene@example.test", NOW);
    expect(data.volunteerOffers.map((offer) => offer.hasKit)).toEqual([true]);
  });
});

describe("«Cu kit: N» on the «Voluntari» strip, and the filter (§904)", () => {
  it("counts the ticked who are not cancelled, for the event in scope or every event, blind to the filters", async () => {
    // Dan; Eva is cancelled, Mara is the run's.
    expect((await summariseVolunteersForAdmin(db, { eventId: raceId })).withKit).toBe(1);
    expect((await summariseVolunteersForAdmin(db, {})).withKit).toBe(2);
    expect((await summariseVolunteersForAdmin(db, { search: "dinu" })).withKit).toBe(1);
    // The states' figures are the same as before the tick split them.
    expect((await summariseVolunteersForAdmin(db, { eventId: raceId })).byState).toEqual({ REGISTERED: 2, CONFIRMED: 1, CANCELLED: 1 });
    expect(await countVolunteersWithKit(db, raceId)).toBe(1);
    expect(await countVolunteersWithKit(db, runId)).toBe(1);

    const page = await listPage();
    expect(page).toContain("Cu kit: 1");
    // A pill: a link that filters to the ticked.
    expect(page).toContain('href="/ro/admin/volunteers?kit=yes"');
    // Said with nobody ticked too: a nought is an answer.
    await db.update(eventVolunteers).set({ hasKit: false });
    expect(await listPage()).toContain("Cu kit: 0");
    expect(await listPage({}, "en")).toContain("With a kit: 0");
  });

  it("filters by the tick — «yes», «no», or nobody filtered for anything else — the strip unmoved and the filter riding with every verb's way back", async () => {
    const ticked = await listPage({ kit: "yes" });
    expect(ticked).toContain("Dan Ene");
    expect(ticked).toContain("Eva Stan");
    expect(ticked).not.toContain("Ana Pop");
    expect(ticked).not.toContain("Ion Lupu");
    // The strip still says how the scope stands.
    expect(ticked).toContain("Voluntari: 4");
    expect(ticked).toContain("Cu kit: 1");
    expect(ticked).toContain('name="returnTo" value="/ro/admin/volunteers?kit=yes"');
    // The pill in force clears it.
    expect(ticked).toContain('href="/ro/admin/volunteers"');

    const without = await listPage({ kit: "no" });
    expect(without).toContain("Ana Pop");
    expect(without).toContain("Ion Lupu");
    expect(without).not.toContain("Dan Ene");

    const junk = await listPage({ kit: "maybe" });
    expect(junk).toContain("Ana Pop");
    expect(junk).toContain("Dan Ene");
    expect((await listVolunteersForAdmin(db, { eventId: raceId, kit: true }, firstPage, "ro")).map((row) => row.name)).toEqual(["Dan Ene", "Eva Stan"]);
  });
});

describe("«Are kit» in the event's files (§904)", () => {
  it("is the CSV's last column and a column of the spreadsheet beside the T-shirt, «Da» / «Nu» in the reader's words", async () => {
    const csv = await (await eventFile(new Request(`http://localhost/api/admin/events/${raceId}/volunteers?lang=ro`), { params: Promise.resolve({ id: raceId }) })).text();
    const lines = csv.split("\r\n");
    expect(lines[0].endsWith(",Are kit")).toBe(true);
    expect(lines.find((line) => line.includes("Dan Ene"))?.endsWith(",Da")).toBe(true);
    expect(lines.find((line) => line.includes("Ion Lupu"))?.endsWith(",Nu")).toBe(true);
    const english = await (await eventFile(new Request(`http://localhost/api/admin/events/${raceId}/volunteers?lang=en`), { params: Promise.resolve({ id: raceId }) })).text();
    expect(english.split("\r\n")[0].endsWith(",Has a kit")).toBe(true);

    const buffer = Buffer.from(await (await eventFile(new Request(`http://localhost/api/admin/events/${raceId}/volunteers?format=xlsx&lang=ro`), { params: Promise.resolve({ id: raceId }) })).arrayBuffer());
    const { rows } = readSheet(buffer);
    const column = rows[0].indexOf(ro.Admin.volunteers.csvColumns.hasKit);
    expect(column).toBe(rows[0].indexOf(ro.Admin.volunteers.csvColumns.shirtSize) + 1);
    expect(rows.find((row) => row[0] === "Dan Ene")?.[column]).toBe("Da");
    expect(rows.find((row) => row[0] === "Ion Lupu")?.[column]).toBe("Nu");
  });
});

describe("a role standing in two categories is named with its category, each once (§904)", () => {
  it("reads each row's links once — two choices and one role are two and one — and the words of each role with its category's", async () => {
    const rows = await listVolunteersForAdmin(db, { eventId: raceId }, firstPage, "ro");
    const ana = rows.find((row) => row.id === people.ana);
    expect(ana?.choiceIds).toEqual([guideStartId, guideRouteId]);
    expect(ana?.roleIds).toEqual([guideRouteId]);
    const words = await listRoleNames(db, [guideStartId, guideRouteId]);
    expect([...words.values()].map((one) => roleLabel(one, "ro"))).toEqual(expect.arrayContaining(["Direcționare (Start / Sosire)", "Direcționare (Traseu)"]));
    const counts = await listRolesWithCounts(db, raceId);
    expect(counts.map((role) => [roleLabel(role, "ro"), role.given])).toEqual([
      ["Direcționare (Start / Sosire)", 0],
      ["Direcționare (Traseu)", 1],
      ["Punct de hidratare (Traseu)", 1],
    ]);
  });

  it("prints «Roluri date» and «S-a oferit pentru» as the card says them, never one bare name twice", async () => {
    const page = await listPage();
    const given = textOf(page, "volunteer-given");
    const offered = textOf(page, "volunteer-offered");
    expect(given).toContain("Direcționare (Traseu)");
    expect(offered).toContain("Direcționare (Start / Sosire), Direcționare (Traseu)");
    for (const cell of [...given, ...offered]) {
      const names = cell.split(", ");
      expect(new Set(names).size, cell).toBe(names.length);
    }
    expect(page).not.toContain("Direcționare, Direcționare");
    // The role select names the chosen role the same way.
    expect(await listPage({ eventId: raceId, role: guideRouteId })).toContain("Direcționare (Traseu) · 1");
    expect(await listPage({}, "en")).toContain("Guidance (Start / Finish), Guidance (Route)");
  });

  it("keeps a role under no category by its name alone", async () => {
    const all = await listPage({ eventId: "all" });
    expect(textOf(all, "volunteer-given")).toContain("Marcaj");
    const [run] = await db.select({ id: eventVolunteerRoles.id }).from(eventVolunteerRoles).where(and(eq(eventVolunteerRoles.eventId, runId), eq(eventVolunteerRoles.nameRo, "Marcaj")));
    expect((await listRoleNames(db, [run.id])).get(run.id)).toEqual({ nameRo: "Marcaj", nameEn: "Marking", categoryRo: null, categoryEn: null });
  });
});
