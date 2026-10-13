import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-07 (§648, §747): the registrations list's «⋮» offers «Pune pe lista de invitați speciali» /
 * «Scoate de pe lista de invitați speciali» by the registration page's own predicate: the Administrator's,
 * an active row, putting on only while the event's switch is on, taking off for any row on the list. The
 * hidden form posts the same action with the page's dialog and the list's query; the Organizer sees nothing.
 *
 * The page is a Server Component, so it is called and its element trees walked.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale: "ro", messages: (ro as unknown as Record<string, Record<string, unknown>>)[namespace] as never }),
  getLocale: async () => "ro",
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
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const actions = await import("@/app/[locale]/admin/registrations/actions");

type Props = Record<string, unknown> & { children?: ReactNode };
type MenuItem = { label: string; icon: string; formId?: string };

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

let db: TestDatabase;
let close: () => Promise<void>;

async function createRace(title: string, hiddenListEnabled: boolean) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
      hiddenListEnabled,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `${title}-ro`, title },
    { eventId: event.id, locale: "en", slug: `${title}-en`, title },
  ]);
  return event;
}

let serial = 0;
async function register(eventId: string, row: Partial<typeof registrations.$inferInsert> = {}) {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${serial}`,
      displayName: resolveDisplayName({ legalName: `Runner ${serial}` }),
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

async function listPage(searchParams: Record<string, string>) {
  return AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(searchParams) } as never);
}

/** What one row's "⋮" cell holds: the table's own `rowActions` for that row, walked. */
function cellOf(tree: ReactNode, id: string): ReactElement<Props>[] {
  const table = elements(tree).find((element) => element.type === AdminTable);
  const row = (table?.props.rows as { id: string }[]).find((candidate) => candidate.id === id);
  return row ? elements((table?.props.rowActions as (row: { id: string }) => ReactNode)(row)) : [];
}

const menuItems = (tree: ReactNode, id: string) => (cellOf(tree, id).find((element) => Array.isArray(element.props.items))?.props.items ?? []) as MenuItem[];
const outsideItems = (tree: ReactNode, id: string) => menuItems(tree, id).filter((item) => item.formId === `outside-${id}`);
const outsideForm = (tree: ReactNode, id: string) => cellOf(tree, id).find((element) => element.props.id === `outside-${id}`);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

describe("BR-REQ-037-07: the list's «⋮» and the special guests list (§747)", () => {
  it("offers «Pune pe lista…» only while the event's switch is on, and «Scoate de pe…» for a row on the list even with it off", async () => {
    const on = await createRace("Cu lista", true);
    const off = await createRace("Fara lista", false);
    state.actor = await staff("ADMIN");
    const counted = await register(on.id);
    const onList = await register(on.id, { outsideCapacity: true });
    const switchedOff = await register(off.id);
    const switchedOffOnList = await register(off.id, { outsideCapacity: true });

    const tree = await listPage({});
    expect(outsideItems(tree, counted).map((item) => item.label)).toEqual(["Pune pe lista de invitați speciali"]);
    expect(outsideItems(tree, onList).map((item) => item.label)).toEqual(["Scoate de pe lista de invitați speciali"]);
    expect(outsideItems(tree, switchedOff)).toHaveLength(0);
    expect(outsideItems(tree, switchedOffOnList).map((item) => item.label)).toEqual(["Scoate de pe lista de invitați speciali"]);
    // The house's «invitat special» glyph before the words.
    expect(outsideItems(tree, counted)[0].icon).toBe("hiddenList");
  });

  it("offers it in no ended state", async () => {
    const race = await createRace("Crosul", true);
    state.actor = await staff("ADMIN");
    const cancelled = await register(race.id, { status: "CANCELLED" });
    const expired = await register(race.id, { status: "EXPIRED", outsideCapacity: true });
    const tree = await listPage({});
    expect(outsideItems(tree, cancelled)).toHaveLength(0);
    expect(outsideItems(tree, expired)).toHaveLength(0);
  });

  it("posts the registration page's action and dialog from a hidden form that comes back to the list", async () => {
    const race = await createRace("Crosul", true);
    state.actor = await staff("ADMIN");
    const counted = await register(race.id);
    const onList = await register(race.id, { outsideCapacity: true });
    const tree = await listPage({ eventId: race.id });
    const put = outsideForm(tree, counted);
    const take = outsideForm(tree, onList);
    expect(put?.props.action).toBe(actions.setOutsideCapacityAction);
    expect((put?.props.confirm as { title: string }).title).toBe("Pui înscrierea pe lista de invitați speciali?");
    expect((take?.props.confirm as { title: string }).title).toBe("Scoți înscrierea de pe lista de invitați speciali?");
    const field = (form: ReactElement<Props> | undefined, name: string) => elements(form).find((element) => element.props.name === name)?.props.value;
    expect(field(put, "outside")).toBe("true");
    expect(field(take, "outside")).toBe("false");
    expect(field(put, "registrationId")).toBe(counted);
    expect(elements(put).some((element) => element.props.name === "listQuery")).toBe(true);
  });

  it("returns to the row's own page: the page and the filters stay in the form's return address", async () => {
    const race = await createRace("Crosul", true);
    state.actor = await staff("ADMIN");
    const first = await register(race.id);
    const second = await register(race.id);
    const tree = await listPage({ eventId: race.id, status: "CONFIRMED", page: "2", perPage: "1" });
    const form = outsideForm(tree, first) ?? outsideForm(tree, second);
    const query = new URLSearchParams(String(elements(form).find((element) => element.props.name === "listQuery")?.props.value));
    expect(query.get("page")).toBe("2");
    expect(query.get("status")).toBe("CONFIRMED");
    expect(query.get("eventId")).toBe(race.id);
  });

  it("names the email in a waiting runner's question, and none in a test row's", async () => {
    const race = await createRace("Crosul", true);
    state.actor = await staff("ADMIN");
    const waiting = await register(race.id, { status: "WAITLISTED" });
    const waitingTest = await register(race.id, { status: "WAITLISTED", kind: "TEST" });
    const tree = await listPage({ eventId: race.id });
    const confirmOf = (id: string) => outsideForm(tree, id)?.props.confirm as { body: string; email?: unknown };
    expect(confirmOf(waiting).body).toContain("primește acum un loc ca invitat special");
    expect(confirmOf(waiting).email).toBeDefined();
    expect(confirmOf(waitingTest).email).toBeUndefined();
  });

  it("renders the refusal from the «⋮» as today's sentence naming who holds the places, not a message key", async () => {
    const race = await createRace("Crosul", true);
    state.actor = await staff("ADMIN");
    const tree = await listPage({ eventId: race.id, error: "NO_FREE_PLACE", capacity: "1", confirmed: "1", declaration: "0", offered: "0", family: "0", invited: "0" });
    const alerts = elements(tree).filter((element) => element.props.severity === "error");
    const shown = JSON.stringify(alerts.map((alert) => alert.props.children));
    expect(shown).toContain("Cursa e plină: locuri 1, confirmați 1, declarații de semnat 0");
    expect(shown).not.toContain("Admin.errors");
  });

  it("shows the Organizer no entry and no form", async () => {
    const race = await createRace("Crosul", true);
    const id = await register(race.id);
    state.actor = await staff("MODERATOR");
    const tree = await listPage({ eventId: race.id });
    expect(outsideForm(tree, id)).toBeUndefined();
    expect(outsideItems(tree, id)).toHaveLength(0);
    // The row's menu is still there, so the assertion above is not an empty cell.
    expect(menuItems(tree, id).length).toBeGreaterThan(0);
    expect(await db.select({ id: events.id }).from(events).where(eq(events.id, race.id))).toHaveLength(1);
  });
});
