import { type ComponentProps, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { readPresentTicks } from "@/modules/volunteers/present-by";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { statementsOf } from "../../helpers/statements";

/**
 * §NNN, §983, BR-REQ-050-02 — who ticked a volunteer «Prezent», and when (the owner, 2026-11-19: «vreau si tracing pentru
 * voluntarim [voluntari] gen cine a scanat, cine a marcat prezent»), on the «Voluntari» list and on the person's page, read from a real
 * database: while ticked, «Org1, 08:20» under the tick — from the newest trail row that set it, a tick again after an untick naming
 * the second —, «cont șters» for an account gone since; unticked, nothing; ticked with no such row, nothing; both languages; read
 * in ONE query for the page's rows, however many, and none when no row is ticked.
 *
 * The made-up people and the organizers' accounts are nobody.
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
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; render: (row: unknown) => ReactNode };

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

async function html(node: ReactNode): Promise<string> {
  const intl = { locale: state.locale, timeZone: "Europe/Bucharest", messages: state.locale === "ro" ? ro : en } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const stream = await renderToReadableStream(createElement(NextIntlClientProvider, intl, node), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!-- -->/g, "");
}
const words = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

/** «08:20» on the event's clock (UTC+2 in November). */
const at = (clock: string) => new Date(`2099-11-21T${String(Number(clock.slice(0, 2)) - 2).padStart(2, "0")}:${clock.slice(3)}:00.000Z`);
const MORNING = at("10:00");

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
const org = {} as Record<"org1" | "org2" | "org3" | "gone", StaffUser>;
const people = { ana: "", ion: "", eva: "", mara: "", dan: "" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

let serial = 0;
async function volunteer(name: string, present = false): Promise<string> {
  serial += 1;
  const email = `volunteer-${serial}@example.test`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name, email, canonicalEmail: email, canonicalizationVersion: 1, phone: "+40700000001", source: "PUBLIC", state: "CONFIRMED", present })
    .returning({ id: eventVolunteers.id });
  return row.id;
}
const tick = (actor: StaffUser, id: string, present: boolean, clock: string) => changeVolunteer(db, actor, { kind: "setPresent", eventId, id, present }, at(clock));

beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
  for (const role of ["MODERATOR", "ADMIN"] as const) {
    [staff[role]] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Coleg ${role}`, role }).returning();
  }
  for (const key of ["org1", "org2", "org3", "gone"] as const) {
    [org[key]] = await db.insert(staffUsers).values({ email: `${key}@example.test`, displayName: key === "gone" ? "Plecat" : `Org${key.slice(3)}`, role: "MODERATOR" }).returning();
  }
  state.actor = staff.MODERATOR;
  const [race] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T07:00:00.000Z"), timezone: "Europe/Bucharest", featured: true, acceptsVolunteers: true, editorialStatus: "PUBLISHED", publishedAt: MORNING })
    .returning({ id: events.id });
  eventId = race.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: `crosul-${eventId.slice(0, 8)}`, title: "Crosul" },
    { eventId, locale: "en", slug: `cross-${eventId.slice(0, 8)}`, title: "The cross" },
  ]);
  // Ana ticked by Org1; Ion ticked and unticked since; Eva ticked, unticked and ticked again by Org3; Mara ticked before the trail
  // kept it (no row); Dan ticked by an account removed since.
  people.ana = await volunteer("Ana Pop");
  people.ion = await volunteer("Ion Lupu");
  people.eva = await volunteer("Eva Stan");
  people.mara = await volunteer("Mara Dinu", true);
  people.dan = await volunteer("Dan Ene");
  await tick(org.org1, people.ana, true, "08:20");
  await tick(org.org1, people.ion, true, "08:10");
  await tick(org.org2, people.ion, false, "08:15");
  await tick(org.org1, people.eva, true, "08:00");
  await tick(org.org2, people.eva, false, "08:05");
  await tick(org.org3, people.eva, true, "08:30");
  await tick(org.gone, people.dan, true, "08:40");
  await db.delete(staffUsers).where(eq(staffUsers.id, org.gone.id));
});

const listTree = async (query: Record<string, string> = {}) => atTheClock(MORNING, () => AdminVolunteersPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve({ eventId, ...query }) }));
const personPage = async (id: string) => html(await atTheClock(MORNING, () => AdminVolunteerPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) })));

/** The «Prezent» cell of each row, as the list hands it to the table: the line under the tick, or null. */
async function presentLines(query: Record<string, string> = {}): Promise<Record<string, string | null>> {
  const tree = await listTree(query);
  const table = elements(tree).find((element) => element.type === AdminTable)!;
  const columns = table.props.columns as Column[];
  const rows = table.props.rows as Array<{ id: string; name: string }>;
  const column = columns.find((candidate) => candidate.key === "present")!;
  return Object.fromEntries(
    rows.map((row) => {
      const line = elements(column.render(row)).find((element) => element.props["data-testid"] === "volunteer-present-by");
      return [row.name, line ? String(line.props.children) : null];
    }),
  );
}

describe("§NNN who ticked a volunteer «Prezent», and when", () => {
  it("says it under the tick on the «Voluntari» list while ticked — the newest tick — and nothing unticked or with no trail row", async () => {
    expect(await presentLines()).toEqual({
      "Ana Pop": "Org1, 08:20",
      "Ion Lupu": null,
      "Eva Stan": "Org3, 08:30",
      "Mara Dinu": null,
      "Dan Ene": "cont șters, 08:40",
    });
    state.locale = "en";
    expect(await presentLines()).toMatchObject({ "Ana Pop": "Org1, 08:20", "Dan Ene": "deleted account, 08:40", "Ion Lupu": null });
  });

  it("is drawn in the page, in the table and on the phone's card alike", async () => {
    const markup = await html(await listTree());
    const lines = [...markup.matchAll(/data-testid="volunteer-present-by"[^>]*>([^<]*)</g)].map((match) => words(match[1]));
    // `AdminTable` draws every row twice — the table and the phone card — so each ticked row's line is there twice.
    expect(lines.filter((line) => line === "Org1, 08:20")).toHaveLength(2);
    expect(lines).toHaveLength(6);
  });

  it("says it beside the tick on the person's page, and nothing for an unticked person", async () => {
    const line = (markup: string) => /data-testid="volunteer-page-present-by"[^>]*>([^<]*)</.exec(markup)?.[1] ?? null;
    expect(line(await personPage(people.ana))).toBe("Org1, 08:20");
    expect(line(await personPage(people.eva))).toBe("Org3, 08:30");
    expect(line(await personPage(people.ion))).toBeNull();
    expect(line(await personPage(people.mara))).toBeNull();
    state.locale = "en";
    expect(line(await personPage(people.dan))).toBe("deleted account, 08:40");
  });

  it("is read in ONE query for the page's rows, however many — and none when no row is ticked", async () => {
    const reads = async (operation: () => Promise<unknown>) => (await statementsOf(db, operation)).filter((text) => text.includes("->> 'volunteerId'")).length;
    expect(await reads(() => listTree())).toBe(1);
    for (let index = 0; index < 8; index += 1) await tick(org.org1, await volunteer(`Ana Pop ${index}`), true, "08:50");
    expect(await reads(() => listTree())).toBe(1);
    expect(Object.values(await presentLines()).filter((line) => line === "Org1, 08:50")).toHaveLength(8);
    expect(await reads(() => readPresentTicks(db, [{ id: people.ion, eventId, present: false }]))).toBe(0);
  });
});
