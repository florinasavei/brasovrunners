import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §994 — «Contact» on the «Voluntari» list (the owner, 2026-11-19, with a picture of this list: «și aici vreau să văd mailurile»),
 * from a real database and the page as the server draws it, in Romanian and in English:
 *
 * - the column stands right after «Nume», under the registrations list's heading «Contact» and its own «?»;
 * - its cell is the address, a `mailto:` link, and under it the telephone, a `tel:` link that dials the digits and the plus, read
 *   grouped — as the person typed them, or the organizer on a row the club entered;
 * - a row the club typed with neither has an empty cell, and a phone's card leaves its line out; a row with one of them has that one;
 * - the list stays the 404 it was for whoever may not work the volunteers.
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

const { default: AdminVolunteersPage } = await import("@/app/[locale]/admin/volunteers/(list)/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; label: string; hint?: string; sortable?: boolean; omitEmptyOnPhone?: boolean; render: (row: unknown) => ReactNode };

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

const NOW = new Date("2026-11-19T08:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let staff: Record<"ADMIN" | "MODERATOR" | "CONTRIBUTOR", StaffUser>;
let raceId: string;
const people = { ana: "", dan: "", zoe: "", ion: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

/** A volunteer as the form writes one (`PUBLIC`: both an address and a telephone), or as an organizer types one (`STAFF`). */
async function volunteer(over: { name: string; email: string | null; phone: string | null; source?: "PUBLIC" | "STAFF" }): Promise<string> {
  const [row] = await db
    .insert(eventVolunteers)
    .values({
      eventId: raceId,
      name: over.name,
      email: over.email,
      canonicalEmail: over.email,
      canonicalizationVersion: over.email === null ? null : 1,
      phone: over.phone,
      source: over.source ?? "PUBLIC",
      state: "CONFIRMED",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: eventVolunteers.id });
  return row.id;
}

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  const [admin, organizer, contributor] = await db
    .insert(staffUsers)
    .values([
      { email: "admin@example.test", displayName: "Ana Admin", role: "ADMIN" },
      { email: "organizer@example.test", displayName: "Olga Organizer", role: "MODERATOR" },
      { email: "contributor@example.test", displayName: "Cora Contributor", role: "CONTRIBUTOR" },
    ])
    .returning();
  staff = { ADMIN: admin, MODERATOR: organizer, CONTRIBUTOR: contributor };
  state.actor = admin;
  [{ id: raceId }] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), featured: true, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-10-01T00:00:00.000Z") })
    .returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: raceId, locale: "ro", slug: `crosul-${raceId.slice(0, 8)}`, title: "Crosul" },
    { eventId: raceId, locale: "en", slug: `cross-${raceId.slice(0, 8)}`, title: "The cross" },
  ]);
  // From the form, both; typed by the club with neither, with the telephone alone, and with the address alone.
  people.ana = await volunteer({ name: "Ana Pop", email: "ana.pop@example.test", phone: "+40700000011" });
  people.zoe = await volunteer({ name: "Zoe Manea", email: null, phone: null, source: "STAFF" });
  people.dan = await volunteer({ name: "Dan Ene", email: null, phone: "0700000022", source: "STAFF" });
  people.ion = await volunteer({ name: "Ion Lupu", email: "ion.lupu@example.test", phone: null, source: "STAFF" });
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

/** A page as the server streams it, Suspense settled; Emotion's styles and React's separators out of the way. */
async function html(page: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, page), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
/** The opening tag and the text of every element of a part that carries a test id, in the order drawn. */
const linksOf = (part: string, testid: string) =>
  [...part.matchAll(new RegExp(`<a[^>]*data-testid="${testid}"[^>]*>([^<]*)<`, "g"))].map((match) => ({ href: /href="([^"]*)"/.exec(match[0])?.[1], text: match[1] }));
/** The wide table's row of one person: the `<tr>` holding the link to their own page. */
const tableRowOf = (page: string, id: string) => [...page.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((match) => match[0]).find((row) => row.includes(`/admin/volunteers/${id}"`)) ?? "";

describe("§994 «Contact» on the «Voluntari» list", () => {
  it("stands right after «Nume», under the heading «Contact» and its own «?», sorting nothing, its empty cell no line on a phone", async () => {
    for (const [locale, catalogue] of [["ro", ro], ["en", en]] as const) {
      const { columns } = tableOf(await listTree({}, locale));
      const keys = columns.map((column) => column.key);
      expect(keys.indexOf("contact"), locale).toBe(keys.indexOf("name") + 1);
      const column = columns.find((candidate) => candidate.key === "contact")!;
      expect(column.label).toBe(catalogue.Admin.registrations.columnContact);
      expect(column.hint).toBe(catalogue.Admin.volunteers.screen.contactHint);
      expect(column.sortable).toBeFalsy();
      expect(column.omitEmptyOnPhone).toBe(true);
    }
    expect(ro.Admin.registrations.columnContact).toBe("Contact");
  });

  it("draws the address to write to and, under it, the telephone to ring — each only where the row has it", async () => {
    for (const locale of ["ro", "en"] as const) {
      const page = await html(await listTree({}, locale));
      // From the form: the address, then the telephone read grouped, dialling the digits and the plus.
      const ana = tableRowOf(page, people.ana);
      expect(linksOf(ana, "volunteer-email"), locale).toEqual([{ href: "mailto:ana.pop@example.test", text: "ana.pop@example.test" }]);
      expect(linksOf(ana, "volunteer-phone"), locale).toEqual([{ href: "tel:+40700000011", text: "+40 700 000 011" }]);
      expect(ana.indexOf('data-testid="volunteer-email"')).toBeLessThan(ana.indexOf('data-testid="volunteer-phone"'));
      // Typed by the club: the one it has, nothing for the other; a number typed without its country code reads as typed.
      expect(linksOf(tableRowOf(page, people.dan), "volunteer-email")).toEqual([]);
      expect(linksOf(tableRowOf(page, people.dan), "volunteer-phone")).toEqual([{ href: "tel:0700000022", text: "0700000022" }]);
      expect(linksOf(tableRowOf(page, people.ion), "volunteer-email")).toEqual([{ href: "mailto:ion.lupu@example.test", text: "ion.lupu@example.test" }]);
      expect(linksOf(tableRowOf(page, people.ion), "volunteer-phone")).toEqual([]);
      // Neither: an empty cell.
      const { cell } = tableOf(await listTree({}, locale));
      expect(cell("contact", people.zoe)).toBeNull();
      expect(tableRowOf(page, people.zoe)).not.toContain("volunteer-email");
      expect(tableRowOf(page, people.zoe)).not.toContain("volunteer-phone");
    }
  });

  it("is the Organizer's as the Administrator's, and the list stays a 404 for a role that does not work the volunteers", async () => {
    state.actor = staff.MODERATOR;
    expect(linksOf(tableRowOf(await html(await listTree()), people.ana), "volunteer-email")).toEqual([{ href: "mailto:ana.pop@example.test", text: "ana.pop@example.test" }]);
    state.actor = staff.CONTRIBUTOR;
    await expect(listTree()).rejects.toThrow("NOT_FOUND");
  });
});
