import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventCheckpoints } from "@/db/schema/event-checkpoints";
import { eventVolunteerCategories, eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listRoleNames } from "@/modules/volunteers/admin-list";
import { volunteerTypes } from "@/modules/volunteers/domain/volunteer";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-050-02 — «Tip» on the «Voluntari» list (the owner, 2026-11-17: «Practic voluntarii sunt de 2 tipuri: start-finish și pe
 * traseu», then, with a picture of this list: «și pe ecuson vreau, și în tabelul ăsta»), from a real database and the page as the server
 * draws it, in Romanian and in English:
 *
 * - the column stands right after «Roluri date» and before «Punct», under the catalogue's heading with its «?»; it neither sorts nor
 *   hides on a narrow table, and a phone's card leaves its line out for an empty cell;
 * - its cell names the categories of the roles GIVEN — never the ones only offered — in the club's own words and the page's language,
 *   each once, in the order the club set the categories (not the order the roles were given in), joined by «, »;
 * - a role under no category adds nothing («Alte activități» is no type): a person given only such roles, and a person given none,
 *   have an empty cell;
 * - the page reads it in the one read of the roles' words it already made, whatever the number of rows.
 *
 * The made-up people here are nobody.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

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
// How many times the page reads the roles' words: once, whatever the number of rows.
const reads = vi.hoisted(() => ({ roleNames: 0 }));
vi.mock("@/modules/volunteers/admin-list", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/volunteers/admin-list")>();
  return {
    ...real,
    listRoleNames: (...args: Parameters<typeof real.listRoleNames>) => {
      reads.roleNames += 1;
      return real.listRoleNames(...args);
    },
  };
});

const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; label: string; hint?: string; sortable?: boolean; omitEmptyOnPhone?: boolean; hideBelow?: string; essential?: boolean; render: (row: unknown) => ReactNode };

/** Every element under `node`, depth first. */
function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  elements(node.props.children, acc);
  return acc;
}

const NOW = new Date("2026-11-17T08:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let raceId: string;
const roles = { guideStart: "", guideRoute: "", water: "", desk: "" };
const people = { ana: "", dan: "", mara: "", eva: "", ion: "", vlad: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

/** A volunteer as the form or the card writes one, with the roles offered and given (§837), in the order given. */
async function volunteer(over: { name: string; state?: "REGISTERED" | "CONFIRMED" | "CANCELLED"; given?: string[]; chosen?: string[]; checkpointId?: string }): Promise<string> {
  const email = `${over.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({
      eventId: raceId,
      name: over.name,
      email,
      canonicalEmail: email,
      canonicalizationVersion: 1,
      phone: "+40700000001",
      source: "PUBLIC",
      state: over.state ?? "CONFIRMED",
      roleId: over.given?.[0] ?? null,
      checkpointId: over.checkpointId ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: eventVolunteers.id });
  if (over.chosen?.length) await db.insert(eventVolunteerRoleChoices).values(over.chosen.map((roleId) => ({ volunteerId: row.id, roleId })));
  for (const roleId of over.given ?? []) await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId });
  return row.id;
}

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  reads.roleNames = 0;
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Ana Admin", role: "ADMIN" }).returning();
  state.actor = admin;
  [{ id: raceId }] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), featured: true, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-10-01T00:00:00.000Z") })
    .returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
  ]);
  // The club's two kinds of work, written in the reverse of their order: the order is the club's `sort`, never the rows'.
  const [route] = await db.insert(eventVolunteerCategories).values({ eventId: raceId, nameRo: "Pe traseu", nameEn: "On the route", sort: 1 }).returning({ id: eventVolunteerCategories.id });
  const [start] = await db.insert(eventVolunteerCategories).values({ eventId: raceId, nameRo: "Start / Sosire", nameEn: "Start / Finish", sort: 0 }).returning({ id: eventVolunteerCategories.id });
  const inserted = await db
    .insert(eventVolunteerRoles)
    .values([
      { eventId: raceId, categoryId: route.id, nameRo: "Direcționare", nameEn: "Guidance", needed: 2, position: 0 },
      { eventId: raceId, categoryId: start.id, nameRo: "Direcționare", nameEn: "Guidance", needed: 2, position: 1 },
      { eventId: raceId, categoryId: route.id, nameRo: "Punct de hidratare", nameEn: "Water point", needed: 3, position: 2 },
      { eventId: raceId, categoryId: null, nameRo: "Masă", nameEn: "Desk", needed: 1, position: 3 },
    ])
    .returning({ id: eventVolunteerRoles.id });
  [roles.guideRoute, roles.guideStart, roles.water, roles.desk] = inserted.map((row) => row.id);
  // A point on the route, so «Punct» stands in the list beside «Tip».
  const [point] = await db.insert(eventCheckpoints).values({ eventId: raceId, km: "5", nameRo: "Pădurea", nameEn: "The wood", kinds: ["WATER"], position: 0 }).returning({ id: eventCheckpoints.id });
  // One category; two, given route first; two roles of one category; only a role under none; none given (only offered); cancelled, still holding a role.
  people.ana = await volunteer({ name: "Ana Pop", given: [roles.guideRoute], checkpointId: point.id });
  people.dan = await volunteer({ name: "Dan Ene", given: [roles.water, roles.guideStart] });
  people.mara = await volunteer({ name: "Mara Dinu", given: [roles.guideRoute, roles.water] });
  people.eva = await volunteer({ name: "Eva Stan", given: [roles.desk] });
  people.ion = await volunteer({ name: "Ion Lupu", state: "REGISTERED", chosen: [roles.guideStart, roles.water] });
  people.vlad = await volunteer({ name: "Vlad Rusu", state: "CANCELLED", given: [roles.guideStart] });
});

const listTree = async (query: Record<string, string> = {}, locale: "ro" | "en" = "ro") => {
  state.locale = locale;
  return AdminVolunteersPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(query) });
};

/** The list's table as the page hands it over: its columns, and one column drawn for one row. */
function tableOf(tree: ReactNode) {
  const table = elements(tree).find((element) => element.type === AdminTable)!;
  const columns = table.props.columns as Column[];
  const rows = table.props.rows as Array<{ id: string }>;
  const cell = (key: string, id: string) => columns.find((column) => column.key === key)!.render(rows.find((row) => row.id === id));
  return { columns, rows, cell };
}

/** A cell's words, as one string: its text nodes in order. */
function wordsOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(wordsOf).join("");
  return isValidElement<Props>(node) ? wordsOf(node.props.children) : "";
}

/** A page as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(page: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const textsOf = (page: string, testid: string) => [...page.matchAll(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`, "g"))].map((match) => match[1]);
/** A catalogue's words as the server writes them into the page: React escapes the apostrophe and the ampersand. */
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");
/** The wide table's row of one person: the `<tr>` holding the link to their own page. */
const tableRowOf = (page: string, id: string) => [...page.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((match) => match[0]).find((row) => row.includes(`/admin/volunteers/${id}"`)) ?? "";

describe("§NNN «Tip» on the «Voluntari» list — the column", () => {
  it("stands right after «Roluri date» and before «Punct», under the catalogue's heading with its «?», sorting nothing, its empty cell no line on a phone", async () => {
    for (const [locale, catalogue] of [["ro", ro], ["en", en]] as const) {
      const { columns } = tableOf(await listTree({}, locale));
      const keys = columns.map((column) => column.key);
      expect(keys.indexOf("type"), locale).toBe(keys.indexOf("given") + 1);
      expect(keys.indexOf("point"), locale).toBe(keys.indexOf("type") + 1);
      expect(keys.indexOf("offered"), locale).toBe(keys.indexOf("point") + 1);
      const column = columns.find((candidate) => candidate.key === "type")!;
      expect(column.label).toBe(catalogue.Admin.volunteers.screen.columnType);
      expect(column.hint).toBe(catalogue.Admin.volunteers.screen.typeHint);
      expect(column.sortable).toBeFalsy();
      expect(column.hideBelow).toBeUndefined();
      expect(column.omitEmptyOnPhone).toBe(true);
    }
    expect(ro.Admin.volunteers.screen.columnType).toBe("Tip");
    expect(en.Admin.volunteers.screen.columnType).toBe("Type");
    // Without a point on the route the list has no «Punct»: «Tip» follows «Roluri date» and «S-a oferit pentru» follows it.
    await db.delete(eventCheckpoints);
    const keys = tableOf(await listTree()).columns.map((column) => column.key);
    expect(keys.indexOf("type")).toBe(keys.indexOf("given") + 1);
    expect(keys.indexOf("offered")).toBe(keys.indexOf("type") + 1);
  });

  it("names the categories of the roles given — one, two in the club's order, one once for two roles — in Romanian and in English", async () => {
    const expected = {
      ro: { ana: "Pe traseu", dan: "Start / Sosire, Pe traseu", mara: "Pe traseu", vlad: "Start / Sosire" },
      en: { ana: "On the route", dan: "Start / Finish, On the route", mara: "On the route", vlad: "Start / Finish" },
    };
    for (const locale of ["ro", "en"] as const) {
      const { cell } = tableOf(await listTree({}, locale));
      for (const [who, words] of Object.entries(expected[locale]) as Array<[keyof typeof people, string]>) {
        const drawn = cell("type", people[who]);
        expect(wordsOf(drawn), `${locale} ${who}`).toBe(words);
        expect(elements(drawn).some((element) => element.props["data-testid"] === "volunteer-type"), `${locale} ${who}`).toBe(true);
      }
    }
  });

  it("is empty for a person given only a role under no category, and for a person given none — whatever they offered", async () => {
    for (const locale of ["ro", "en"] as const) {
      const { cell } = tableOf(await listTree({}, locale));
      expect(cell("type", people.eva), locale).toBeNull();
      expect(cell("type", people.ion), locale).toBeNull();
      // «Roluri date» still says what it said: the role under none, and «De repartizat».
      expect(wordsOf(cell("given", people.eva))).toBe(locale === "ro" ? "Masă" : "Desk");
    }
  });

  it("is drawn on the page, in Romanian and in English: the words in the table and on the phones' cards, the heading and its «?», nothing for an empty cell", async () => {
    for (const [locale, catalogue] of [["ro", ro], ["en", en]] as const) {
      const page = await html(await listTree({}, locale));
      expect(page).toContain(`>${catalogue.Admin.volunteers.screen.columnType}<`);
      expect(page).toContain(escaped(catalogue.Admin.volunteers.screen.typeHint));
      // Each row with a type is drawn twice — the table and the phone's card — and the empty ones not at all.
      const typed = textsOf(page, "volunteer-type");
      expect(typed, locale).toHaveLength(8);
      const dan = locale === "ro" ? "Start / Sosire, Pe traseu" : "Start / Finish, On the route";
      expect(typed.filter((words) => words === dan), locale).toHaveLength(2);
      // In the table, the empty cell is there and holds nothing; the wide table keeps the column's place for every row.
      for (const id of [people.eva, people.ion]) expect(tableRowOf(page, id), locale).not.toContain('data-testid="volunteer-type"');
      expect(tableRowOf(page, people.dan)).toContain(`data-testid="volunteer-type">${dan}<`);
      // A phone's card has a «Tip» line only where there are words: four cards with one.
      const phone = page.slice(page.indexOf('data-testid="admin-table-hints"'));
      expect(phone.split(`>${catalogue.Admin.volunteers.screen.columnType}</p>`).length - 1, locale).toBe(4);
    }
  });

  it("reads the categories in the one read of the roles' words the page makes, whatever the number of rows", async () => {
    reads.roleNames = 0;
    await listTree();
    expect(reads.roleNames).toBe(1);
    const more: string[] = [];
    for (let index = 0; index < 20; index++) more.push(await volunteer({ name: `Radu Popa ${String.fromCharCode(97 + index)}`, given: [roles.guideStart, roles.water] }));
    reads.roleNames = 0;
    const { rows, cell } = tableOf(await listTree({ perPage: "50" }));
    expect(rows.length).toBe(26);
    expect(reads.roleNames).toBe(1);
    for (const id of more) expect(wordsOf(cell("type", id))).toBe("Start / Sosire, Pe traseu");
  });
});

describe("§NNN a person's type, as the list reads it", () => {
  it("is each category once, in the club's order, and nothing for a role under none or a role the page could not read", async () => {
    const words = await listRoleNames(db, [roles.guideRoute, roles.guideStart, roles.water, roles.desk]);
    expect(words.get(roles.desk)).toMatchObject({ categoryRo: null, categoryEn: null, categoryOrder: null });
    expect(words.get(roles.guideStart)?.categoryOrder).toMatchObject({ sort: 0 });
    expect(volunteerTypes([words.get(roles.water), words.get(roles.guideStart), words.get(roles.guideRoute)], "ro")).toEqual(["Start / Sosire", "Pe traseu"]);
    expect(volunteerTypes([words.get(roles.water), words.get(roles.guideStart)], "en")).toEqual(["Start / Finish", "On the route"]);
    expect(volunteerTypes([words.get(roles.desk), undefined], "ro")).toEqual([]);
    expect(volunteerTypes([], "ro")).toEqual([]);
  });
});
