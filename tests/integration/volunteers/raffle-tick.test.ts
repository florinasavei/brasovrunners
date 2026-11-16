import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { viewPersonData } from "@/modules/registrations/person-data";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-050-02 — «Tombolă» on the «Voluntari» list (the owner, 2026-11-16: «o bifă importantă, și coloană peste tot de
 * „participă la tombolă"»), from a real database: with one event chosen that holds a raffle («Avem tombolă»), each row carries
 * the house's one-press tick — a plain form posting the state it wants — which takes the volunteer off the raffle's list or puts
 * them back; an event that holds none draws no such column; and a person's data says when they were taken out (art. 15 GDPR).
 * The service's roles and trail are `tests/integration/registrations/raffle-mark.test.ts`. The harness is `plan.test.ts`'s.
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

const { setVolunteerRaffleAction } = await import("@/app/[locale]/admin/volunteers/actions");
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

const rowOf = async (id: string) => (await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0];

/** A page as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(page: ReactElement): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const listPage = async (query: Record<string, string> = {}) => html(await AdminVolunteersPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(query) }));
/** The row forms of «Tombolă» on a page — `AdminTable` draws each row twice, the table and the phone cards — for one person. */
const raffleFormsOf = (page: string, id: string) => [...page.matchAll(/<form[^>]*data-testid="volunteer-raffle-form"[\s\S]*?<\/form>/g)].map((match) => match[0]).filter((one) => one.includes(`value="${id}"`));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ uiLocale: "ro", eventId: raceId, returnTo: "/ro/admin/volunteers", ...fields })) data.set(key, value);
  return data;
}
async function press(fields: Record<string, string>): Promise<string> {
  state.redirected.length = 0;
  await expect(setVolunteerRaffleAction(form(fields))).rejects.toThrow("NEXT_REDIRECT");
  return state.redirected[0];
}

describe("§NNN «Tombolă» on the «Voluntari» list", () => {
  it("draws no such column for an event that holds no raffle", async () => {
    const page = await listPage();
    expect(page).not.toContain('data-testid="volunteer-raffle-form"');
    expect(page).not.toContain(ro.Admin.volunteers.screen.raffleHint);
  });

  it("draws a one-press tick on every row of an event that holds one, posting the other state", async () => {
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, raceId));
    await db.update(eventVolunteers).set({ inRaffle: false }).where(eq(eventVolunteers.id, people.dan));
    const page = await listPage();
    expect(page).toContain(ro.Admin.volunteers.screen.raffleHint);

    // Ana is in: her two forms (the table and her phone card) post «out», and the tick reads ticked.
    const ana = raffleFormsOf(page, people.ana);
    expect(ana).toHaveLength(2);
    for (const one of ana) {
      expect(one).toMatch(/name="inRaffle" value="0"/);
      expect(one).toMatch(/aria-checked="true"/);
      expect(one).toContain("Participă: Ana Pop");
    }
    // Dan was taken out: his post «in», and the tick reads empty.
    const dan = raffleFormsOf(page, people.dan);
    expect(dan).toHaveLength(2);
    for (const one of dan) {
      expect(one).toMatch(/name="inRaffle" value="1"/);
      expect(one).toMatch(/aria-checked="false"/);
    }
  });

  it("takes a volunteer out and puts them back from the row's press, coming back to the list", async () => {
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, raceId));
    expect(await press({ volunteerId: people.ana, inRaffle: "0" })).toBe("/ro/admin/volunteers");
    expect((await rowOf(people.ana)).inRaffle).toBe(false);
    expect(await press({ volunteerId: people.ana, inRaffle: "1" })).toBe("/ro/admin/volunteers");
    expect((await rowOf(people.ana)).inRaffle).toBe(true);

    // The Tehnic role's press writes nothing and comes back with the refusal's code.
    state.actor = staff.DEV;
    expect(await press({ volunteerId: people.ana, inRaffle: "0" })).toBe("/ro/admin/volunteers?volunteerError=FORBIDDEN");
    expect((await rowOf(people.ana)).inRaffle).toBe(true);
  });

  it("is among what is kept about the person when they ask for their data (art. 15 GDPR)", async () => {
    const before = await viewPersonData(db, staff.ADMIN!, "ana.pop@example.test", NOW);
    expect(before.volunteerOffers.map((offer) => offer.inRaffle)).toEqual([true]);
    await db.update(eventVolunteers).set({ inRaffle: false }).where(eq(eventVolunteers.id, people.ana));
    const after = await viewPersonData(db, staff.ADMIN!, "ana.pop@example.test", NOW);
    expect(after.volunteerOffers.map((offer) => offer.inRaffle)).toEqual([false]);
  });
});
