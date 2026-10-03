import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { listRegistrationsForAdmin, REGISTRATION_SORT_KEYS } from "@/modules/registrations/admin-repository";
import { rowDeadlineOf } from "@/modules/registrations/domain/row-deadline";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Vreau să văd exact pe fiecare candidat până când poate semna declarația» (the owner,
 * 2026-10-03), from a real database:
 *
 * - the registrations list has a «Termen» column, in both of `AdminTable`'s layouts, saying each live
 *   row's moment from the row itself, for every role that reads the list (the Organizer too, §289);
 * - `?sort=deadline` orders the rows by the same cases, the soonest first, the rows with none last;
 * - the export carries the moment, last, in both formats' order;
 * - the registration's timeline reads the same helper: a lapsed offer says so.
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
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { default: RowDeadlineCell } = await import("@/modules/registrations/ui/RowDeadlineCell");
const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");

type Props = Record<string, unknown> & { children?: ReactNode };

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

function text(html: string): string {
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<\/span>/g, "</span>\n").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim();
}

let db: TestDatabase;
let close: () => Promise<void>;

const HOUR = 60 * 60_000;
const START = new Date("2099-11-21T08:00:00.000Z");

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
  const [created] = await db
    .insert(registrations)
    .values({
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
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function staff(role: "ADMIN" | "MODERATOR"): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
  return user;
}

/** Five rows, one per kind of deadline, and a confirmed one that waits on none. */
async function seed() {
  const race = await createRace("Crosul");
  const now = Date.now();
  const at = {
    kept: new Date(now - 2 * HOUR),
    offer: new Date(now + 3 * HOUR),
    reserved: new Date(now + 1 * HOUR),
    hold: new Date(now + 48 * HOUR),
    link: new Date(now + 24 * HOUR),
  };
  await register(race.id, "Ana Confirmată", { status: "CONFIRMED", holdExpiresAt: new Date(now - 10 * HOUR) });
  await register(race.id, "Bogdan Semnează", { status: "PENDING_DECLARATION", holdExpiresAt: at.hold });
  await register(race.id, "Carmen Depășit", { status: "PENDING_DECLARATION", holdExpiresAt: at.kept });
  await register(race.id, "Dan Oferit", { status: "WAITLIST_OFFERED", offerCreatedAt: new Date(now - HOUR), holdExpiresAt: at.offer });
  // A family's reservation outranks the link while it holds (§543).
  await register(race.id, "Elena Rezervat", { status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: at.reserved, emailLinkExpiresAt: new Date(now + 40 * HOUR) });
  await register(race.id, "Florin Link", { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: at.link });
  return { race, at };
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

describe("§NNN «Termen» on the registrations list", () => {
  it("a sortable column, each live row's moment from the row — for the Administrator and the Organizer", async () => {
    const { race, at } = await seed();
    const day = (value: Date) => formatDay(value, { locale: "ro", timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });
    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = await staff(role);
      const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId: race.id }) } as never);
      const table = elements(tree).find((element) => element.type === AdminTable);
      expect(table, role).toBeDefined();
      const columns = table!.props.columns as { key: string; label: string; sortable?: boolean; hideBelow?: string; render: (row: unknown) => ReactNode }[];
      const column = columns.find((candidate) => candidate.key === "deadline");
      expect(column?.label).toBe("Termen");
      expect(column?.sortable).toBe(true);
      // In the phone layout too: no breakpoint drops it from the wide table either.
      expect(column?.hideBelow).toBeUndefined();
      // Right after the step it is the deadline of.
      expect(columns.findIndex((candidate) => candidate.key === "deadline")).toBe(columns.findIndex((candidate) => candidate.key === "journey") + 1);

      const said = new Map<string, string>();
      for (const row of table!.props.rows as { registeredName: string }[]) {
        const rendered = column!.render(row) as ReactElement<Props>;
        expect(rendered.type).toBe(RowDeadlineCell);
        said.set(row.registeredName, text(renderToStaticMarkup(await RowDeadlineCell(rendered.props as never))));
      }
      expect(said.get("Ana Confirmată")).toBe("—");
      expect(said.get("Bogdan Semnează")).toBe(`${day(at.hold)}\nare de semnat declarația`);
      expect(said.get("Carmen Depășit")).toBe(`${day(at.kept)}\ntermen depășit, locul se ține cât nu-l cere nimeni`);
      expect(said.get("Dan Oferit")).toBe(`${day(at.offer)}\nloc oferit: are de semnat declarația`);
      expect(said.get("Elena Rezervat")).toBe(`${day(at.reserved)}\nloc rezervat: are de confirmat adresa`);
      expect(said.get("Florin Link")).toBe(`${day(at.link)}\nare de confirmat adresa din email`);
      await db.delete(staffUsers);
    }
  });

  it("?sort=deadline: the soonest first, the rows that wait on none last — both ways — as the cells say", async () => {
    const { race } = await seed();
    const now = new Date();
    expect(REGISTRATION_SORT_KEYS).toContain("deadline");
    const order = async (dir: "asc" | "desc") =>
      (await listRegistrationsForAdmin(db, { eventId: race.id }, { limit: 25, offset: 0, sort: "deadline", dir, now })).map((row) => row.registeredName);
    expect(await order("asc")).toEqual(["Carmen Depășit", "Elena Rezervat", "Dan Oferit", "Florin Link", "Bogdan Semnează", "Ana Confirmată"]);
    expect(await order("desc")).toEqual(["Bogdan Semnează", "Florin Link", "Dan Oferit", "Elena Rezervat", "Carmen Depășit", "Ana Confirmată"]);
    // The SQL's cases are the helper's: sorting the rows by `rowDeadlineOf` gives the same order.
    const rows = await listRegistrationsForAdmin(db, { eventId: race.id });
    const byHelper = [...rows]
      .sort((a, b) => (rowDeadlineOf(a, now)?.at.getTime() ?? Number.POSITIVE_INFINITY) - (rowDeadlineOf(b, now)?.at.getTime() ?? Number.POSITIVE_INFINITY))
      .map((row) => row.registeredName);
    expect(await order("asc")).toEqual(byHelper);
  });

  it("the export's «Deadline», last: the moment, or an empty cell", async () => {
    const { race, at } = await seed();
    state.actor = await staff("MODERATOR");
    const response = await exportRegistrations(new Request(`http://localhost/api/admin/registrations/export?eventId=${race.id}`));
    expect(response.status).toBe(200);
    const [header, ...lines] = (await response.text()).split("\r\n");
    expect(header.split(",").at(-1)).toBe("Deadline");
    const last = (name: string) => lines.find((line) => line.includes(name))?.split(",").at(-1);
    expect(last("Bogdan Semnează")).toBe(at.hold.toISOString());
    expect(last("Carmen Depășit")).toBe(at.kept.toISOString());
    expect(last("Elena Rezervat")).toBe(at.reserved.toISOString());
    expect(last("Florin Link")).toBe(at.link.toISOString());
    expect(last("Ana Confirmată")).toBe("");
  });

  it("the registration's timeline reads the same helper: a lapsed offer says so", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("ADMIN");
    const past = new Date(Date.now() - HOUR);
    const id = await register(race.id, "Dan Oferit", { status: "WAITLIST_OFFERED", offerCreatedAt: new Date(Date.now() - 2 * HOUR), holdExpiresAt: past });
    const tree = await RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never);
    const lines: string[] = [];
    for (const element of elements(tree)) {
      const children: unknown = element.props.children;
      if (Array.isArray(children) && children.length === 3 && children[1] === ": ") lines.push(children.join(""));
    }
    const day = formatDay(past, { locale: "ro", timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });
    expect(lines.join("\n")).toContain(`Ține locul până: ${day} — oferta a expirat`);
  });
});
