import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §897 (the owner, 2026-11-03: «ar trebui să pot marca pe cineva ca elită oricând») — the registrations list's «⋮»
 * offers «Marchează ca elită» or «Nu mai e elită» by the row's own mark, with the medal, to the Administrator in every
 * state, from a hidden form that asks nothing and comes back to the list; the Organizer gets neither. A marked row
 * wears «Elită» on the list and on the registration's page, for every role that reads them. What is shown is a courtesy
 * (BR-REQ-060-01): the action and the service refuse every other role again (`elite-mark.test.ts`).
 *
 * The pages are Server Components, so they are called and their element trees walked.
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
  addToWaitlistAction: vi.fn(),
  moveReserveEntryAction: vi.fn(),
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  setPublicRegistrationOpenAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  editRegistrationAnswersAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setRegistrationEliteAction: vi.fn(),
  setRegistrationEliteTickAction: vi.fn(),
  declarationHoldAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: RegistrationDetailPage } = await import("@/app/[locale]/admin/registrations/[id]/page");
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const actions = await import("@/app/[locale]/admin/registrations/actions");

type Props = Record<string, unknown> & { children?: ReactNode };
type MenuItem = { label: string; icon: string; formId?: string; hint?: string; checked?: boolean };
type Column = { key: string; render: (row: unknown) => ReactNode };

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

let db: TestDatabase;
let close: () => Promise<void>;

async function createRace() {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2099-11-21T08:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "crosul-ro", title: "Crosul" },
    { eventId: event.id, locale: "en", slug: "crosul-en", title: "Crosul" },
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
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: role, role }).returning();
  return user;
}

async function listPage(searchParams: Record<string, string>) {
  return AdminRegistrationsPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve(searchParams) } as never);
}

function tableOf(tree: ReactNode) {
  return elements(tree).find((element) => element.type === AdminTable);
}

/** What one row's "⋮" cell holds: the table's own `rowActions` for that row, walked. */
function cellOf(tree: ReactNode, id: string): ReactElement<Props>[] {
  const table = tableOf(tree);
  const row = (table?.props.rows as { id: string }[]).find((candidate) => candidate.id === id);
  return row ? elements((table?.props.rowActions as (row: { id: string }) => ReactNode)(row)) : [];
}

/** The «Nume» cell of one row, walked: where the row's chips are. */
function nameCellOf(tree: ReactNode, id: string): ReactElement<Props>[] {
  const table = tableOf(tree);
  const row = (table?.props.rows as { id: string }[]).find((candidate) => candidate.id === id);
  const column = (table?.props.columns as Column[]).find((candidate) => candidate.key === "name");
  return row && column ? elements(column.render(row)) : [];
}

const menuItems = (tree: ReactNode, id: string) => (cellOf(tree, id).find((element) => Array.isArray(element.props.items))?.props.items ?? []) as MenuItem[];
const eliteItems = (tree: ReactNode, id: string) => menuItems(tree, id).filter((item) => item.formId === `elite-${id}`);
const eliteForm = (tree: ReactNode, id: string) => cellOf(tree, id).find((element) => element.props.id === `elite-${id}`);
const eliteChip = (nodes: ReactElement<Props>[]) => nodes.find((element) => element.props.testId === "elite-chip");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("§897 the elite mark on the registrations list", () => {
  it("offers «Marchează ca elită» or «Nu mai e elită» by the row's own mark, with the medal, in every state", async () => {
    const race = await createRace();
    state.actor = await staff("ADMIN");
    const plain = await register(race.id);
    const marked = await register(race.id, { elite: true });
    const waiting = await register(race.id, { status: "WAITLISTED" });
    const cancelled = await register(race.id, { status: "CANCELLED", cancelledAt: new Date(), cancellationSource: "ADMIN", elite: true });
    const tree = await listPage({ eventId: race.id });

    expect(eliteItems(tree, plain).map((item) => [item.label, item.icon])).toEqual([["Marchează ca elită", "elite"]]);
    expect(eliteItems(tree, marked).map((item) => [item.label, item.icon])).toEqual([["Nu mai e elită", "elite"]]);
    expect(eliteItems(tree, waiting).map((item) => item.label)).toEqual(["Marchează ca elită"]);
    expect(eliteItems(tree, cancelled).map((item) => item.label)).toEqual(["Nu mai e elită"]);
  });

  it("posts its action from a hidden form that asks nothing, carries the opposite mark and comes back to the list", async () => {
    const race = await createRace();
    state.actor = await staff("ADMIN");
    const plain = await register(race.id);
    const marked = await register(race.id, { elite: true });
    const tree = await listPage({ eventId: race.id });
    const field = (form: ReactElement<Props> | undefined, name: string) => elements(form).find((element) => element.props.name === name)?.props.value;

    const mark = eliteForm(tree, plain);
    expect(mark?.props.action).toBe(actions.setRegistrationEliteAction);
    // §384: it tells nobody and the same menu undoes it — no question.
    expect(mark?.props.confirm).toBeUndefined();
    expect(field(mark, "elite")).toBe("1");
    expect(field(mark, "registrationId")).toBe(plain);
    expect(String(field(mark, "listQuery"))).toContain(`eventId=${race.id}`);
    expect(field(eliteForm(tree, marked), "elite")).toBe("0");
  });

  it("puts «Elită» on a marked row for every role that reads the list, and offers the Organizer no mark", async () => {
    const race = await createRace();
    const plain = await register(race.id);
    const marked = await register(race.id, { elite: true });

    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = await staff(role);
      const tree = await listPage({ eventId: race.id });
      const chip = eliteChip(nameCellOf(tree, marked));
      expect(chip?.props.label, role).toBe("Elită");
      expect(chip?.props.glyph, role).toBe("elite");
      expect(eliteChip(nameCellOf(tree, plain)), role).toBeUndefined();
      if (role === "MODERATOR") {
        expect(eliteItems(tree, plain)).toHaveLength(0);
        expect(eliteItems(tree, marked)).toHaveLength(0);
        expect(eliteForm(tree, plain)).toBeUndefined();
      }
    }

    state.locale = "en";
    state.actor = await staff("ADMIN");
    const english = await listPage({ eventId: race.id });
    expect(eliteChip(nameCellOf(english, marked))?.props.label).toBe("Elite");
    expect(eliteItems(english, plain).map((item) => item.label)).toEqual(["Mark as elite"]);
    expect(eliteItems(english, marked).map((item) => item.label)).toEqual(["No longer elite"]);
  });

  it("puts «Elită» on the registration's own page while marked", async () => {
    const race = await createRace();
    const marked = await register(race.id, { elite: true });
    const plain = await register(race.id);
    state.actor = await staff("MODERATOR");
    const page = (id: string) => RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never);
    expect(eliteChip(elements(await page(marked)))?.props.label).toBe("Elită");
    expect(eliteChip(elements(await page(plain)))).toBeUndefined();
  });
});

describe("§NNN an elite's two ticks on the list's «⋮» and on the registration's page", () => {
  const tickItems = (tree: ReactNode, id: string) => menuItems(tree, id).filter((item) => item.formId === `elite-results-${id}` || item.formId === `elite-site-${id}`);
  const formOf = (tree: ReactNode, formId: string) => cellOf(tree, formId.replace(/^elite-(results|site)-/, "")).find((element) => element.props.id === formId);
  const field = (form: ReactElement<Props> | undefined, name: string) => elements(form).find((element) => element.props.name === name)?.props.value;

  it("offers the Administrator, on a marked row only, «Apare în clasament» and «Apare pe site» as ticks, each posting the other state and asking nothing", async () => {
    const race = await createRace();
    state.actor = await staff("ADMIN");
    const plain = await register(race.id);
    const hidden = await register(race.id, { elite: true, eliteHiddenFromSite: true });
    const tree = await listPage({ eventId: race.id });

    expect(tickItems(tree, plain)).toEqual([]);
    expect(tickItems(tree, hidden).map((item) => [item.label, item.checked])).toEqual([
      ["Apare în clasament", true],
      ["Apare pe site", false],
    ]);
    // Each says what it hides behind its tooltip (a thumb reads the same on the registration's page).
    expect(tickItems(tree, hidden).every((item) => typeof item.hint === "string" && item.hint.length > 0)).toBe(true);
    const results = formOf(tree, `elite-results-${hidden}`);
    const site = formOf(tree, `elite-site-${hidden}`);
    for (const form of [results, site]) {
      expect(form?.props.action).toBe(actions.setRegistrationEliteTickAction);
      // §384: it tells nobody, only hides, and the same tick undoes it — no question.
      expect(form?.props.confirm).toBeUndefined();
      expect(field(form, "registrationId")).toBe(hidden);
      expect(String(field(form, "listQuery"))).toContain(`eventId=${race.id}`);
    }
    expect([field(results, "tick"), field(results, "on")]).toEqual(["inResults", "0"]);
    expect([field(site, "tick"), field(site, "on")]).toEqual(["onSite", "1"]);
  });

  it("offers the Organizer no tick on the list", async () => {
    const race = await createRace();
    const marked = await register(race.id, { elite: true });
    state.actor = await staff("MODERATOR");
    const tree = await listPage({ eventId: race.id });
    expect(tickItems(tree, marked)).toEqual([]);
    expect(formOf(tree, `elite-results-${marked}`)).toBeUndefined();
  });

  it("draws the registration's «Elită» card while marked: the Administrator's ticks in forms, the Organizer's disabled", async () => {
    const race = await createRace();
    const marked = await register(race.id, { elite: true, eliteHiddenFromResults: true });
    const plain = await register(race.id);
    const page = (id: string) => RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never);
    const ticksOf = (nodes: ReactElement<Props>[]) => nodes.filter((element) => typeof element.props["data-testid"] === "string" && /^elite-tick-(inResults|onSite)$/.test(element.props["data-testid"] as string));

    state.actor = await staff("ADMIN");
    const admin = elements(await page(marked));
    expect(admin.some((element) => element.props["data-testid"] === "elite-ticks")).toBe(true);
    expect(ticksOf(admin).map((element) => [element.props["data-testid"], element.props.checked, element.props.disabled])).toEqual([
      ["elite-tick-inResults", false, undefined],
      ["elite-tick-onSite", true, undefined],
    ]);
    const forms = admin.filter((element) => element.props.action === actions.setRegistrationEliteTickAction);
    expect(forms.map((form) => [field(form, "tick"), field(form, "on"), field(form, "registrationId")])).toEqual([
      ["inResults", "1", marked],
      ["onSite", "0", marked],
    ]);

    state.actor = await staff("MODERATOR");
    const organizer = elements(await page(marked));
    expect(ticksOf(organizer).map((element) => [element.props.checked, element.props.disabled])).toEqual([
      [false, true],
      [true, true],
    ]);
    expect(organizer.some((element) => element.props.action === actions.setRegistrationEliteTickAction)).toBe(false);
    expect(elements(await page(plain)).some((element) => element.props["data-testid"] === "elite-ticks")).toBe(false);
  });
});
