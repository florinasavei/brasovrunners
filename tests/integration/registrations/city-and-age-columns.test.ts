import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { listRegistrationsForAdmin, REGISTRATION_SORT_KEYS } from "@/modules/registrations/admin-repository";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Pe lista de participanți în back-office vreau să văd și Orașul și vârsta participanților» (the
 * owner, 2026-10-04), from a real database:
 *
 * - the registrations list has «Oraș» and «Vârstă», in both of `AdminTable`'s layouts, for every role that
 *   reads the list (the Organizer too, §289) — the city with the country's code only abroad, the age on
 *   the event's day; «—» when there is nothing to say; a test registration shows both like a real one;
 * - `?sort=city` and `?sort=age` order the rows, the rows with nothing last either way;
 * - the CSV ends with the age on race day, the country and the city.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogue = (state.locale === "ro" ? ro : en) as unknown as Record<string, Record<string, unknown>>;
    return createTranslator({ locale: state.locale, messages: catalogue[namespace] as never });
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
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({ getPathname: () => "/ro/admin/registrations", Link: () => null }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  resendRegistrationEmailAction: vi.fn(),
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  editRegistrationAnswersAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  declarationHoldAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; label: string; hint?: string; sortable?: boolean; initialDir?: string; hideBelow?: string; render: (row: unknown) => ReactNode };

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

const text = (node: ReactNode) => renderToStaticMarkup(node as ReactElement).replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").trim();

let db: TestDatabase;
let close: () => Promise<void>;

// 21 November 2099, 08:00 in Brașov.
const START = new Date("2099-11-21T06:00:00.000Z");

async function createRace(title: string) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: START,
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      featured: true,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `${title}-ro`, title },
    { eventId: event.id, locale: "en", slug: `${title}-en`, title },
  ]);
  return event;
}

let serial = 0;
async function register(eventId: string, name: string, row: Partial<typeof registrations.$inferInsert>) {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
    .returning();
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    kind: "REAL",
    locale: "ro",
    registeredName: name,
    displayName: resolveDisplayName({ legalName: name }),
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: new Date(),
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    status: "CONFIRMED",
    ...row,
  });
}

async function staff(role: "ADMIN" | "MODERATOR"): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
  return user;
}

/** Four rows: a Romanian city, one abroad, one with neither city nor birth date, and a test registration. */
async function seed() {
  const race = await createRace("Crosul");
  // 36 on the race's day, the day itself her birthday.
  await register(race.id, "Ana Brașov", { city: "Brașov", country: "RO", birthDate: "2063-11-21" });
  // 17 on the race's day: the birthday is the day after.
  await register(race.id, "Bob Bristol", { city: "Bristol", country: "GB", birthDate: "2081-11-22" });
  await register(race.id, "Cora Nimic", { city: null, birthDate: null });
  // A test registration shows its city and age like any row (§30).
  await register(race.id, "Dan Test", { kind: "TEST", city: "Arad", country: "RO", birthDate: "2075-01-10" });
  return race;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("§NNN «Oraș» and «Vârstă» on the registrations list", () => {
  it("two sortable columns, in both layouts, for the Administrator and the Organizer — a test row like a real one", async () => {
    const race = await seed();
    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = await staff(role);
      const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId: race.id }) } as never);
      const table = elements(tree).find((element) => element.type === AdminTable);
      expect(table, role).toBeDefined();
      const columns = table!.props.columns as Column[];
      const city = columns.find((column) => column.key === "city");
      const age = columns.find((column) => column.key === "age");
      expect(city?.label).toBe("Oraș");
      expect(age?.label).toBe("Vârstă");
      expect(age?.hint).toContain("ziua evenimentului");
      for (const column of [city, age]) {
        expect(column?.sortable).toBe(true);
        expect(column?.initialDir).toBe("asc");
        // No breakpoint drops either from the wide table; the phone layout carries every column.
        expect(column?.hideBelow).toBeUndefined();
      }

      const said = new Map<string, [string, string]>();
      for (const row of table!.props.rows as { registeredName: string }[]) said.set(row.registeredName, [text(city!.render(row)), text(age!.render(row))]);
      expect(said.get("Ana Brașov")).toEqual(["Brașov", "36"]);
      expect(said.get("Bob Bristol")).toEqual(["Bristol (GB)", "17"]);
      expect(said.get("Cora Nimic")).toEqual(["—", "—"]);
      expect(said.get("Dan Test")).toEqual(["Arad", "24"]);
      await db.delete(staffUsers);
    }
  });

  it("the English labels", async () => {
    const race = await seed();
    state.locale = "en";
    state.actor = await staff("ADMIN");
    const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ eventId: race.id }) } as never);
    const columns = elements(tree).find((element) => element.type === AdminTable)!.props.columns as Column[];
    expect(columns.find((column) => column.key === "city")?.label).toBe("City");
    expect(columns.find((column) => column.key === "age")?.label).toBe("Age");
  });

  it("?sort=city alphabetically and ?sort=age youngest first, the rows with nothing last — both ways", async () => {
    const race = await seed();
    expect(REGISTRATION_SORT_KEYS).toEqual(expect.arrayContaining(["city", "age"]));
    const order = async (sort: "city" | "age", dir: "asc" | "desc") =>
      (await listRegistrationsForAdmin(db, { eventId: race.id }, { limit: 25, offset: 0, sort, dir })).map((row) => row.registeredName);
    expect(await order("city", "asc")).toEqual(["Dan Test", "Ana Brașov", "Bob Bristol", "Cora Nimic"]);
    expect(await order("city", "desc")).toEqual(["Bob Bristol", "Ana Brașov", "Dan Test", "Cora Nimic"]);
    expect(await order("age", "asc")).toEqual(["Bob Bristol", "Dan Test", "Ana Brașov", "Cora Nimic"]);
    expect(await order("age", "desc")).toEqual(["Ana Brașov", "Dan Test", "Bob Bristol", "Cora Nimic"]);
  });

  it("the CSV ends with the age on race day, the country and the city; the test row is omitted as before", async () => {
    const race = await seed();
    state.actor = await staff("MODERATOR");
    const response = await exportRegistrations(new Request(`http://localhost/api/admin/registrations/export?eventId=${race.id}`));
    expect(response.status).toBe(200);
    const [header, ...lines] = (await response.text()).split("\r\n");
    expect(header.split(",").slice(-3)).toEqual(["Age on race day", "Country", "City"]);
    const last = (name: string) => lines.find((line) => line.includes(name))?.split(",").slice(-3);
    expect(last("Ana Brașov")).toEqual(["36", "RO", "Brașov"]);
    expect(last("Bob Bristol")).toEqual(["17", "GB", "Bristol"]);
    expect(last("Cora Nimic")).toEqual(["", "RO", ""]);
    expect(lines.some((line) => line.includes("Dan Test"))).toBe(false);
  });
});
