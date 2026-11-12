import { isValidElement, type ReactElement, type ReactNode } from "react";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationReconfirmations } from "@/db/schema/registration-reconfirmations";
import { PARTNER_NAME_MAX, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { canManageRegistrations, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { readSheet } from "../../helpers/xlsx";

/**
 * The registrations list's column «Partener» (the decision on the list's column; the owner, 2026-11-11: «aș vrea o coloană
 * separată de „partener” unde să pot selecta și să pot vedea în gridul cu toți participanții cine de la ce partener e»;
 * BR-REQ-037-05, BR-REQ-060-01, BR-REQ-070-01): the partner's name in a column of its own, sorted by it, the filter by any
 * partner or by one, and the row's own editor for the Administrator — the label still a label.
 *
 * Read from a real database (PGlite, the same migrations as Neon), with made-up people and made-up partners. The page is a
 * Server Component: it is called and its element tree walked, as `partner-mark-screens.test.ts` walks it.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
  Link: () => null,
}));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  // The coarse gate, as the real one asks it: the role's capability, refused FORBIDDEN otherwise.
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    const { DomainError: Refusal } = await import("@/shared/errors/domain-error");
    if (!allowed((state.actor as StaffUser).role)) throw new Refusal("FORBIDDEN", "not this role");
    return state.actor;
  },
}));
vi.mock("@/shared/feedback/flash", () => ({ flashOutcome: async () => undefined, flash: async () => undefined }));
// The suggestions' one reader, counted: the page reads the event's partners once, never per row.
vi.mock("@/modules/registrations/partner-mark", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/registrations/partner-mark")>();
  return { ...actual, listPartnerSuggestions: vi.fn(actual.listPartnerSuggestions) };
});
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  addToWaitlistAction: vi.fn(),
  moveReserveEntryAction: vi.fn(),
  addRegistrationNoteFromListAction: vi.fn(),
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  setPublicRegistrationOpenAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setRegistrationEliteAction: vi.fn(),
  setRegistrationEliteTickAction: vi.fn(),
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
const { default: RowPartnerDialog } = await import("@/modules/registrations/ui/RowPartnerDialog");
const { default: ActionForm } = await import("@/shared/forms/ActionForm");
const { default: PartnerFilterSelect } = await import("@/modules/registrations/ui/PartnerFilterSelect");
const { default: ReserveListPanel } = await import("@/modules/registrations/ui/ReserveListPanel");
const { setRegistrationPartnerFromListAction } = await import("@/app/[locale]/admin/registrations/[id]/partner-actions");
const partnerMark = await import("@/modules/registrations/partner-mark");
const { countRegistrationsForAdmin, listRegistrationsForAdmin, summariseRegistrationsForAdmin } = await import("@/modules/registrations/admin-repository");
const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");

/** Made-up partners: no real sponsor's name. The lower-case first letter is on purpose — it sorts by the letter, not the case. */
const BAKERY = "Brutăria Exemplu";
const WORKSHOP = "atelierul de Test";
const CAFE = "Cafeneaua de Test";
/** The bakery as a later row wrote it: the event's spelling once it is the newest. */
const SPELLING = "brutăria exemplu";

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; label: string; hint?: string; sortable?: boolean; initialDir?: string; hideBelow?: string; essential?: boolean; primary?: boolean; omitEmptyOnPhone?: boolean; render: (row: unknown) => ReactNode };
type ListRow = { id: string; registeredName: string; partnerName: string | null };

/** Every element under `node`, depth first. */
function elements(node: ReactNode, acc: ReactElement<Props>[] = []): ReactElement<Props>[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, acc);
    return acc;
  }
  if (!isValidElement<Props>(node)) return acc;
  acc.push(node);
  for (const value of Object.values(node.props)) {
    if (value !== node.props.children && (isValidElement(value) || Array.isArray(value))) elements(value as ReactNode, acc);
  }
  elements(node.props.children, acc);
  return acc;
}

/** Every string under `node`, joined: what the reader sees of it. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => textOf(child as ReactNode)).join("");
  if (!isValidElement<Props>(node)) return "";
  return textOf(node.props.children);
}

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;
const NOW = new Date();
const at = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

async function createRace(title = "Crosul") {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date(NOW.getTime() + 30 * 24 * 3_600_000),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title },
    { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title },
  ]);
  return event;
}

/** One made-up registration; `minutesAgo` orders the list's default (newest first). */
async function register(eventId: string, name: string, row: Partial<typeof registrations.$inferInsert> = {}, minutesAgo = serial) {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: name, preferredLocale: "ro" })
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
      submittedAt: at(minutesAgo),
      ...row,
    })
    .returning({ id: registrations.id, participantId: registrations.participantId });
  return created;
}

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@example.invalid`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

const listPage = (searchParams: Record<string, string>, locale: "ro" | "en" = "ro") =>
  AdminRegistrationsPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(searchParams) } as never);
const tableOf = (tree: ReactNode) => elements(tree).find((element) => element.type === AdminTable);
const rowsOf = (tree: ReactNode) => (tableOf(tree)?.props.rows as ListRow[]) ?? [];
const columnOf = (tree: ReactNode, key: string) => (tableOf(tree)?.props.columns as Column[]).find((column) => column.key === key);
/** The cell `key` of the row `id`, walked: the one render both copies of the table draw. */
const cellOf = (tree: ReactNode, key: string, id: string) => {
  const row = rowsOf(tree).find((candidate) => candidate.id === id);
  const column = columnOf(tree, key);
  return row && column ? column.render(row) : undefined;
};

function form(fields: Record<string, string>): FormData {
  const posted = new FormData();
  posted.set("uiLocale", "ro");
  for (const [name, value] of Object.entries(fields)) posted.set(name, value);
  return posted;
}

/** Where a press that succeeded sends the browser: the mocked redirect's address. */
async function redirectOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT ")) return message.slice("REDIRECT ".length);
    throw error;
  }
  throw new Error("expected a redirect");
}

const partnerTrail = () => db.select().from(auditLogs).where(eq(auditLogs.action, "registration.partner_set"));
const partnerOf = async (id: string) => (await db.select({ name: registrations.partnerName }).from(registrations).where(eq(registrations.id, id)))[0]?.name ?? null;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  vi.mocked(partnerMark.listPartnerSuggestions).mockClear();
});

describe("the column «Partener» on the registrations list", () => {
  it("shows the partner's name as plain text, nothing without one; optional, hinted, sortable, a phone line only with a value", async () => {
    const race = await createRace();
    const from = await register(race.id, "Ana Pop", { partnerName: BAKERY });
    const plain = await register(race.id, "Ion Pop");
    state.actor = await staff("MODERATOR");
    const tree = await listPage({ eventId: race.id });
    const column = columnOf(tree, "partner");
    expect(column?.label).toBe("Partener");
    expect(column?.hint).toBe((await import("../../../messages/ro.json")).default.Admin.partner.columnHint);
    expect(column?.sortable).toBe(true);
    expect(column?.initialDir).toBe("asc");
    // Optional like its neighbours — «Coloane» hides it — but on the wide table at every width it is drawn (`md` and up),
    // unlike the address, which leaves it below `lg`: a landscape tablet sees and sets the partner too.
    expect(column?.essential).toBeUndefined();
    expect(column?.primary).toBeUndefined();
    expect(column?.hideBelow).toBe("md");
    expect(columnOf(tree, "email")?.hideBelow).toBe("lg");
    expect(column?.omitEmptyOnPhone).toBe(true);
    // The last column, right before the row's verbs (the owner, 2026-11-12: «Coloana de partener ar trebui să apară ultima»):
    // the verbs' column is pinned now, so the frame cuts nothing that stands last.
    const keys = (tableOf(tree)?.props.columns as Column[]).map((candidate) => candidate.key);
    expect(keys.indexOf("partner")).toBe(keys.length - 1);
    expect(keys.indexOf("partner")).toBe(keys.indexOf("submitted") + 1);

    const cell = elements(cellOf(tree, "partner", from.id));
    expect(textOf(cell.find((element) => element.props["data-testid"] === "row-partner"))).toBe(BAKERY);
    // Plain text, wrapping anywhere: no chip.
    expect(cell.some((element) => element.props.testId === "partner-chip")).toBe(false);
    expect((cell.find((element) => element.props["data-testid"] === "row-partner")?.props.sx as Record<string, unknown>).overflowWrap).toBe("anywhere");
    // The Organizer reads the column and gets no press: a row without a partner is an empty cell (no phone line).
    expect(cell.some((element) => element.type === RowPartnerDialog)).toBe(false);
    expect(cellOf(tree, "partner", plain.id)).toBeNull();
  });

  it("the chip «Partener: {name}» leaves this list's name cell, rows and lead rows alike", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    state.actor = admin;
    const from = await register(race.id, "Ana Pop", { partnerName: BAKERY });
    const now = new Date();
    const later = new Date(now.getTime() + 3 * 24 * 3_600_000);
    await db.insert(eventInvitations).values({
      eventId: race.id,
      participantId: from.participantId,
      email: "mara@example.org",
      canonicalEmail: "mara@example.org",
      name: "Mara Invitata",
      invitedByStaffUserId: admin.id,
      createdAt: now,
      sentAt: now,
      lastSentAt: now,
      expiresAt: later,
      partnerName: CAFE,
    });
    const tree = await listPage({ eventId: race.id });
    expect(elements(cellOf(tree, "name", from.id)).some((element) => element.props.testId === "partner-chip")).toBe(false);
    // The lead row (an open invitation) puts its partner in the same column, and its name cell has no chip either.
    const lead = (tableOf(tree)?.props.leadRows as { cells: Record<string, ReactNode> }[])[0];
    expect(lead).toBeDefined();
    expect(textOf(lead.cells.partner)).toBe(CAFE);
    expect(elements(lead.cells.name).some((element) => element.props.testId === "partner-chip")).toBe(false);
    expect(textOf(lead.cells.name)).toContain("Mara Invitata");
  });

  it("a name of 120 characters is drawn whole, wrapping anywhere inside a bounded column", async () => {
    const race = await createRace();
    const long = `${"Partenerul ".repeat(12)}`.slice(0, PARTNER_NAME_MAX);
    expect([...long]).toHaveLength(PARTNER_NAME_MAX);
    const row = await register(race.id, "Ana Pop", { partnerName: long });
    state.actor = await staff("ADMIN");
    const cell = elements(cellOf(await listPage({ eventId: race.id }), "partner", row.id));
    const text = cell.find((element) => element.props["data-testid"] === "row-partner");
    expect(textOf(text)).toBe(long);
    const frame = cell[0].props.sx as { minWidth: number; maxWidth: Record<string, string> };
    expect(frame.minWidth).toBe(0);
    expect(frame.maxWidth.md).toBe("16rem");
  });
});

describe("sorting by «Partener»", () => {
  it("by the name without regard to case, the rows without a partner last in both directions, then newest first", async () => {
    const race = await createRace();
    const bakery = await register(race.id, "B", { partnerName: BAKERY }, 5);
    const workshop = await register(race.id, "W", { partnerName: WORKSHOP }, 4);
    const cafe = await register(race.id, "C", { partnerName: CAFE }, 3);
    const olderNone = await register(race.id, "N1", {}, 9);
    const newerNone = await register(race.id, "N2", {}, 1);
    const order = async (dir: "asc" | "desc") =>
      (await listRegistrationsForAdmin(db, { eventId: race.id }, { limit: 25, offset: 0, sort: "partner", dir }, NOW)).map((row) => row.id);
    // «atelierul» before «Brutăria» although a lower-case letter sorts after every capital byte by byte.
    expect(await order("asc")).toEqual([workshop.id, bakery.id, cafe.id, newerNone.id, olderNone.id]);
    expect(await order("desc")).toEqual([cafe.id, bakery.id, workshop.id, newerNone.id, olderNone.id]);

    // The page's sort link and its pages keep it: `?sort=partner` is one of the list's keys.
    state.actor = await staff("ADMIN");
    const tree = await listPage({ eventId: race.id, sort: "partner", dir: "asc" });
    expect(rowsOf(tree).map((row) => row.id)).toEqual([workshop.id, bakery.id, cafe.id, newerNone.id, olderNone.id]);
    expect((tableOf(tree)?.props.query as { sort: string }).sort).toBe("partner");
  });

  it("pagination and the other filters keep the sort", async () => {
    const race = await createRace();
    for (let index = 0; index < 26; index += 1) await register(race.id, `Ana ${index}`, { partnerName: index % 2 === 0 ? CAFE : BAKERY }, 100 + index);
    await register(race.id, "Ion Fara", {}, 1);
    state.actor = await staff("ADMIN");
    const second = await listPage({ eventId: race.id, sort: "partner", dir: "asc", page: "2", perPage: "25" });
    // 27 rows, 25 a page: the second page is the 26th and the 27th — the last of «Cafeneaua» and the one without a partner.
    expect(rowsOf(second).map((row) => row.partnerName)).toEqual([CAFE, null]);
    const narrowed = await listPage({ eventId: race.id, sort: "partner", dir: "desc", partner: "1", q: "Ana", perPage: "50" });
    const names = rowsOf(narrowed).map((row) => row.partnerName);
    expect(names).toHaveLength(26);
    expect(names.slice(0, 13).every((name) => name === CAFE)).toBe(true);
    expect(names.slice(13).every((name) => name === BAKERY)).toBe(true);
  });
});

describe("the filter by partner", () => {
  async function seeded() {
    const race = await createRace();
    const other = await createRace("Alt cros");
    const ana = await register(race.id, "Ana Pop", { partnerName: BAKERY });
    // The newest spelling is the event's (the box's suggestions keep it): the filter compares without regard to case.
    const bia = await register(race.id, "Bia Pop", { partnerName: SPELLING, status: "WAITLISTED", updatedAt: new Date(NOW.getTime() + 60_000) });
    const cip = await register(race.id, "Cip Pop", { partnerName: CAFE });
    const dan = await register(race.id, "Dan Pop");
    await register(other.id, "Eva Pop", { partnerName: BAKERY });
    return { race, other, ana, bia, cip, dan };
  }

  it("any partner keeps `partner=1`; one partner — case aside — narrows the rows, the count, the summary and the pages", async () => {
    const { race, ana, bia, cip, dan } = await seeded();
    expect((await listRegistrationsForAdmin(db, { eventId: race.id, fromPartner: true })).map((row) => row.id).sort()).toEqual([ana.id, bia.id, cip.id].sort());
    expect((await listRegistrationsForAdmin(db, { eventId: race.id, partner: BAKERY })).map((row) => row.id).sort()).toEqual([ana.id, bia.id].sort());
    expect(await countRegistrationsForAdmin(db, { eventId: race.id, partner: "BRUTĂRIA EXEMPLU" })).toBe(2);
    expect((await summariseRegistrationsForAdmin(db, { eventId: race.id, partner: BAKERY })).real).toBe(2);

    state.actor = await staff("MODERATOR");
    const tree = await listPage({ eventId: race.id, partnerName: "brutăria EXEMPLU" });
    const table = tableOf(tree);
    expect(rowsOf(tree).map((row) => row.id).sort()).toEqual([ana.id, bia.id].sort());
    expect(table?.props.total).toBe(2);
    // The summary strip is the same `WHERE`: two registrations.
    expect((elements(tree).find((element) => element.props.summary !== undefined)?.props.summary as { real: number }).real).toBe(2);
    // It rides with every sort and page link, in the event's spelling.
    expect((table?.props.currentParams as Record<string, string | undefined>).partnerName).toBe(SPELLING);
    // The select says it, with the event's partners as its options.
    const select = elements(tree).find((element) => element.type === PartnerFilterSelect);
    expect(select?.props.chosen).toBe(SPELLING);
    expect(select?.props.anyChosen).toBe(false);
    expect([...(select?.props.partners as string[])].sort()).toEqual([SPELLING, CAFE].sort());
    expect(select?.props.anyName).toBe("partner");
    expect(select?.props.oneName).toBe("partnerName");
    expect(rowsOf(await listPage({ eventId: race.id, partner: "1" })).map((row) => row.id).sort()).toEqual([ana.id, bia.id, cip.id].sort());
    expect(elements(await listPage({ eventId: race.id, partner: "1" })).find((element) => element.type === PartnerFilterSelect)?.props.anyChosen).toBe(true);
    expect(rowsOf(await listPage({ eventId: race.id })).map((row) => row.id)).toContain(dan.id);
  });

  it("combines with a state, «Reconfirmare» and a search, in the one `WHERE`", async () => {
    const { race, ana, bia } = await seeded();
    state.actor = await staff("ADMIN");
    expect(rowsOf(await listPage({ eventId: race.id, partnerName: BAKERY, status: "WAITLISTED" })).map((row) => row.id)).toEqual([bia.id]);
    expect(rowsOf(await listPage({ eventId: race.id, partnerName: BAKERY, q: "Ana" })).map((row) => row.id)).toEqual([ana.id]);
    await db.insert(registrationReconfirmations).values({ registrationId: ana.id, eventId: race.id, sendId: crypto.randomUUID(), askedAt: at(30), reconfirmedAt: at(10) });
    const reconfirmed = await listPage({ eventId: race.id, partnerName: BAKERY, reconfirm: "yes" });
    expect(rowsOf(reconfirmed).map((row) => row.id)).toEqual([ana.id]);
    expect(tableOf(reconfirmed)?.props.total).toBe(1);
  });

  it("ignores an unknown, an over-long or another event's name, and any name with every event listed — never an error", async () => {
    const { race, other } = await seeded();
    state.actor = await staff("ADMIN");
    const all = tableOf(await listPage({ eventId: race.id }))?.props.total;
    expect(all).toBe(4);
    for (const unknown of ["Nimeni Exemplu", "x".repeat(PARTNER_NAME_MAX + 1), "   ", `${BAKERY}x`]) {
      const tree = await listPage({ eventId: race.id, partnerName: unknown });
      expect(tableOf(tree)?.props.total, unknown).toBe(4);
      expect((tableOf(tree)?.props.currentParams as Record<string, string | undefined>).partnerName, unknown).toBeUndefined();
      expect(elements(tree).find((element) => element.type === PartnerFilterSelect)?.props.chosen, unknown).toBeNull();
    }
    // With every event listed there is no event's partner to choose: the name is ignored, the select offers none.
    const everywhere = await listPage({ eventId: "all", partnerName: BAKERY });
    expect(tableOf(everywhere)?.props.total).toBe(5);
    expect(elements(everywhere).find((element) => element.type === PartnerFilterSelect)?.props.partners).toEqual([]);
    expect(tableOf(await listPage({ eventId: other.id, partnerName: CAFE }))?.props.total).toBe(1);
  });

  it("both export links carry it, and the file holds exactly that partner's rows", async () => {
    const { race } = await seeded();
    const admin = await staff("ADMIN");
    state.actor = admin;
    const tree = await listPage({ eventId: race.id, partnerName: BAKERY });
    const exports = elements(tree)
      .map((element) => element.props.href)
      .filter((href): href is string => typeof href === "string" && href.startsWith("/api/admin/registrations/export"));
    expect(exports).toHaveLength(2);
    expect(exports.some((href) => href.includes("format=xlsx"))).toBe(true);
    for (const href of exports) expect(new URL(href, "https://example.test").searchParams.get("partnerName"), href).toBe(SPELLING);

    for (const href of exports) {
      const response = await exportRegistrations(new Request(new URL(href, "https://example.test")));
      const names = href.includes("format=xlsx")
        ? readSheet(Buffer.from(await response.arrayBuffer())).rows.slice(1).map((row) => (row as unknown[]).join(" "))
        : (await response.text()).split("\r\n").slice(1).filter(Boolean);
      const text = names.join("\n");
      expect(text, href).toContain("Ana Pop");
      expect(text, href).toContain("Bia Pop");
      expect(text, href).not.toContain("Cip Pop");
      expect(text, href).not.toContain("Dan Pop");
      expect(text, href).not.toContain("Eva Pop");
    }
    // An unknown name is ignored by the file too: every row of the event.
    const csv = await (await exportRegistrations(new Request(`https://example.test/api/admin/registrations/export?eventId=${race.id}&partnerName=Nimeni`))).text();
    for (const name of ["Ana Pop", "Bia Pop", "Cip Pop", "Dan Pop"]) expect(csv).toContain(name);
  });
});

describe("the row's own editor", () => {
  it("is the Administrator's, with one event chosen; the suggestions are read once for the page, never per row", async () => {
    const race = await createRace();
    const rows = [];
    for (const name of ["Ana Pop", "Bia Pop", "Cip Pop", "Dan Pop"]) rows.push(await register(race.id, name, name === "Ana Pop" ? { partnerName: BAKERY } : {}));
    await register(race.id, "Eva Pop", { partnerName: CAFE });
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      state.actor = await staff(role);
      vi.mocked(partnerMark.listPartnerSuggestions).mockClear();
      const tree = await listPage({ eventId: race.id, sort: "partner", dir: "asc", page: "1", perPage: "50" });
      expect(vi.mocked(partnerMark.listPartnerSuggestions), role).toHaveBeenCalledTimes(1);
      const dialogs = rowsOf(tree).map((row) => elements(cellOf(tree, "partner", row.id)).find((element) => element.type === RowPartnerDialog));
      expect(dialogs.every(Boolean), role).toBe(true);
      // Every row gets the same array: one read handed to all.
      expect(new Set(dialogs.map((dialog) => dialog?.props.partners)).size, role).toBe(1);
      const ana = dialogs.find((dialog) => dialog?.props.current === BAKERY);
      expect(ana?.props.ariaLabel, role).toBe("Schimbă partenerul pentru Ana Pop");
      expect(ana?.props.label, role).toBe("Schimbă");
      expect(ana?.props.choiceName, role).toBe("partnerChoice");
      expect(ana?.props.boxName, role).toBe("partnerName");
      expect(ana?.props.max, role).toBe(PARTNER_NAME_MAX);
      expect([...(ana?.props.partners as string[])].sort(), role).toEqual([BAKERY, CAFE].sort());
      // It comes back to this very list: the event, the sort, the page and its size.
      const back = new URLSearchParams((ana?.props.fields as Record<string, string>).listQuery);
      expect([back.get("eventId"), back.get("sort"), back.get("dir"), back.get("page"), back.get("perPage")], role).toEqual([race.id, "partner", "asc", "1", "50"]);
      const bare = dialogs.find((dialog) => dialog?.props.current === null);
      expect(bare?.props.label, role).toBe("Alege");
      expect(bare?.props.ariaLabel, role).toMatch(/^Alege partenerul pentru (Bia|Cip|Dan) Pop$/);
    }
    // WCAG 2.5.3, label in name: on every row, in both languages, the press's accessible name holds the words it shows.
    for (const locale of ["ro", "en"] as const) {
      const tree = await listPage({ eventId: race.id, page: "1", perPage: "50" }, locale);
      const pressed = rowsOf(tree).map((row) => elements(cellOf(tree, "partner", row.id)).find((element) => element.type === RowPartnerDialog));
      expect(pressed.length, locale).toBeGreaterThan(0);
      const labels = new Set<string>();
      for (const dialog of pressed) {
        const { label, ariaLabel } = dialog?.props as { label: string; ariaLabel: string };
        labels.add(label);
        expect(ariaLabel.toLocaleLowerCase(locale), locale).toContain(label.toLocaleLowerCase(locale));
      }
      // Both presses met: «Alege» and «Schimbă» (or "Choose" and "Change").
      expect(labels.size, locale).toBe(2);
    }
    // With every event listed: no press (the hint says so), the names still shown, and no suggestions read.
    vi.mocked(partnerMark.listPartnerSuggestions).mockClear();
    const everywhere = await listPage({ eventId: "all" });
    expect(vi.mocked(partnerMark.listPartnerSuggestions)).not.toHaveBeenCalled();
    expect(elements(everywhere).some((element) => element.type === RowPartnerDialog)).toBe(false);
    expect(textOf(cellOf(everywhere, "partner", rows[0].id))).toBe(BAKERY);
    // The Organizer: the column, no press.
    state.actor = await staff("MODERATOR");
    const organizer = await listPage({ eventId: race.id });
    expect(elements(organizer).some((element) => element.type === RowPartnerDialog)).toBe(false);
    expect(textOf(cellOf(organizer, "partner", rows[0].id))).toBe(BAKERY);
  });

  it("sets, changes, clears and says «unchanged», for the Administrator and above — the same audit row, back on the same list", async () => {
    const race = await createRace();
    const target = await register(race.id, "Ana Pop");
    const listQuery = `eventId=${race.id}&partner=1&sort=partner&dir=desc&page=2&perPage=50&saved=noteAdded`;
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      const actor = await staff(role);
      state.actor = actor;
      await db.update(registrations).set({ partnerName: null }).where(eq(registrations.id, target.id));
      await db.delete(auditLogs);
      const press = (fields: Record<string, string>) => redirectOf(setRegistrationPartnerFromListAction(null, form({ registrationId: target.id, listQuery, ...fields })));

      // Picked from the select.
      const set = new URL(await press({ partnerChoice: BAKERY, partnerName: "" }), "https://example.test");
      expect(set.pathname, role).toBe("/ro/admin/registrations");
      // On the row itself (§NNN): the list stays where the Administrator was working, the toast says what was saved.
      expect(set.hash, role).toBe(`#reg-${target.id}`);
      expect(Object.fromEntries(set.searchParams), role).toEqual({ eventId: race.id, partner: "1", sort: "partner", dir: "desc", page: "2", perPage: "50", saved: "partnerSaved", from: "row" });
      expect(decodeURIComponent(set.toString()), role).not.toContain(BAKERY);
      expect(await partnerOf(target.id), role).toBe(BAKERY);

      // A typed name wins over the select.
      expect(new URL(await press({ partnerChoice: BAKERY, partnerName: `  ${CAFE}  ` }), "https://example.test").searchParams.get("saved"), role).toBe("partnerSaved");
      expect(await partnerOf(target.id), role).toBe(CAFE);

      // The same again: nothing written, no audit row.
      expect(new URL(await press({ partnerChoice: CAFE, partnerName: "" }), "https://example.test").searchParams.get("saved"), role).toBe("partnerUnchanged");

      // «Fără partener» with an empty box clears.
      expect(new URL(await press({ partnerChoice: "", partnerName: "   " }), "https://example.test").searchParams.get("saved"), role).toBe("partnerCleared");
      expect(await partnerOf(target.id), role).toBeNull();

      const trail = await partnerTrail();
      expect(trail.map((row) => row.metadataJson), role).toEqual([{ partner: true }, { partner: true }, { partner: false }]);
      for (const row of trail) {
        expect(row.actorStaffUserId, role).toBe(actor.id);
        expect([row.entityType, row.entityId], role).toEqual(["registration", target.id]);
        expect(JSON.stringify(row.metadataJson), role).not.toContain("Brutăria");
      }
    }
  });

  it("takes a name of 120 characters and refuses 121 at the box, with nothing written", async () => {
    const race = await createRace();
    const target = await register(race.id, "Ana Pop");
    state.actor = await staff("ADMIN");
    const long = "p".repeat(PARTNER_NAME_MAX);
    await redirectOf(setRegistrationPartnerFromListAction(null, form({ registrationId: target.id, listQuery: `eventId=${race.id}`, partnerChoice: "", partnerName: long })));
    expect(await partnerOf(target.id)).toBe(long);
    const refused = await setRegistrationPartnerFromListAction(null, form({ registrationId: target.id, listQuery: `eventId=${race.id}`, partnerChoice: "", partnerName: `${long}q` }));
    expect(refused?.error).toBe("VALIDATION_ERROR");
    expect(refused?.fields).toEqual(["partnerName"]);
    // What was typed is kept for the box.
    expect(refused?.values.partnerName).toEqual([`${long}q`]);
    expect(await partnerOf(target.id)).toBe(long);
    expect(await partnerTrail()).toHaveLength(1);
  });

  it("is refused on the server for every other role — the Organizer, Tehnic, the desk-only roles — nothing written, no audit row", async () => {
    const race = await createRace();
    const target = await register(race.id, "Ana Pop", { partnerName: BAKERY });
    for (const role of STAFF_ROLES.filter((candidate) => !canManageRegistrations(candidate))) {
      state.actor = await staff(role);
      const refused = await setRegistrationPartnerFromListAction(null, form({ registrationId: target.id, listQuery: `eventId=${race.id}`, partnerChoice: "", partnerName: CAFE }));
      expect(refused?.error, role).toBe("FORBIDDEN");
      expect(await partnerOf(target.id), role).toBe(BAKERY);
      const cleared = await setRegistrationPartnerFromListAction(null, form({ registrationId: target.id, listQuery: `eventId=${race.id}`, partnerChoice: "", partnerName: "" }));
      expect(cleared?.error, role).toBe("FORBIDDEN");
      expect(await partnerOf(target.id), role).toBe(BAKERY);
    }
    expect(STAFF_ROLES.filter((candidate) => !canManageRegistrations(candidate))).toEqual(expect.arrayContaining(["MODERATOR", "DEV", "CONTRIBUTOR", "MEMBER"]));
    expect(await partnerTrail()).toHaveLength(0);
  });

  it("the list says the outcome in the toast's words, and a row's save leaves the internal list's panel as it was", async () => {
    const race = await createRace();
    await register(race.id, "Ana Pop", { partnerName: BAKERY });
    state.actor = await staff("ADMIN");
    for (const [saved, words] of [
      ["partnerSaved", "Partenerul a fost salvat. Nu s-a trimis nimic nimănui."],
      ["partnerCleared", "Nu mai e de la parteneri. Nu s-a trimis nimic nimănui."],
      ["partnerUnchanged", "Era deja așa; nimic de schimbat."],
    ] as const) {
      const tree = elements(await listPage({ eventId: race.id, saved, from: "row" }));
      expect(textOf(tree.find((element) => element.props["data-testid"] === "partner-saved-alert")), saved).toBe(words);
      // Never the generic «Salvat.» beside it.
      expect(tree.filter((element) => element.props.severity === "success" && textOf(element) === "Salvat."), saved).toHaveLength(0);
      expect(tree.find((element) => element.type === ReserveListPanel)?.props.opened, saved).toBe(false);
    }
    // A line's own fold still opens its panel on the way back.
    expect(elements(await listPage({ eventId: race.id, saved: "partnerSaved" })).find((element) => element.type === ReserveListPanel)?.props.opened).toBe(true);
  });
});

/**
 * BR-REQ-041-01, `DECISIONS.md` §NNN — the owner, 2026-11-12, of this list on a wide screen: «Aici mi se face crop!». Besides the
 * verbs' column pinned in `AdminTable` (`tests/unit/staff/admin-table-pinned-verbs.test.ts`), the list no longer asks for width
 * it does not use: «Eveniment» is drawn only while every event is listed, and an address reads on a line of its own.
 */
describe("§NNN the list asks for no width it does not use", () => {
  const keysOf = (tree: ReactNode) => (tableOf(tree)?.props.columns as Column[]).map((column) => column.key);

  it("draws «Eveniment» only while every event is listed: one event chosen is the filter's own choice on every row", async () => {
    const race = await createRace("Crosul aniversar — ediția a II-a");
    const row = await register(race.id, "Ana Pop");
    state.actor = await staff("ADMIN");

    const one = await listPage({ eventId: race.id });
    expect(columnOf(one, "event")).toBeUndefined();

    const every = await listPage({ eventId: "all" });
    const column = columnOf(every, "event");
    expect(column?.label).toBe("Eveniment");
    expect(column?.sortable).toBe(true);
    // The title on a floor of its own on the wide table, so it is a few lines and never a word to a line; a phone's card keeps its width.
    const cell = elements(cellOf(every, "event", row.id))[0];
    expect(textOf(cell)).toBe("Crosul aniversar — ediția a II-a");
    expect(cell.props.sx).toEqual({ display: "inline-block", minWidth: { xs: 0, md: "12rem" } });
    // Nothing else moves: the same columns in the same order, «Eveniment» before the address.
    expect(keysOf(one)).toEqual(keysOf(every).filter((key) => key !== "event"));
    expect(keysOf(every).indexOf("event")).toBe(keysOf(every).indexOf("email") - 1);
  });

  it("an address breaks anywhere and still reads on a line: a floor on the wide table, none on a phone's card — a lead row's too", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    state.actor = admin;
    const row = await register(race.id, "Ana Pop");
    const now = new Date();
    await db.insert(eventInvitations).values({
      eventId: race.id,
      participantId: row.participantId,
      email: "mara@example.org",
      canonicalEmail: "mara@example.org",
      name: "Mara Invitata",
      invitedByStaffUserId: admin.id,
      createdAt: now,
      sentAt: now,
      lastSentAt: now,
      expiresAt: new Date(now.getTime() + 3 * 24 * 3_600_000),
    });
    const tree = await listPage({ eventId: race.id });
    const address = { display: "inline-block", minWidth: { xs: 0, lg: "12rem" }, wordBreak: "break-all" };
    // `lg` is where the column is drawn (`hideBelow`), so the floor never reaches the phone's card.
    expect(columnOf(tree, "email")?.hideBelow).toBe("lg");
    expect(elements(cellOf(tree, "email", row.id))[0].props.sx).toEqual(address);
    const lead = (tableOf(tree)?.props.leadRows as { cells: Record<string, ReactNode> }[])[0];
    expect(textOf(lead.cells.email)).toBe("mara@example.org");
    expect(elements(lead.cells.email)[0].props.sx).toEqual(address);
    // The lead rows stand only where one event is chosen, where «Eveniment» is not drawn: they carry no cell for it.
    expect(Object.keys(lead.cells)).not.toContain("event");
  });
});

/**
 * BR-REQ-037-07, BR-REQ-070-01, `DECISIONS.md` §NNN — the owner, 2026-11-12: «trebuie să pot filtra și invitațiile după stare».
 * The list's «Stare» offers the three states of an invitation not accepted yet; choosing one makes the grid that state's
 * invitations and nothing else.
 */
describe("§NNN «Stare» filters the event's invitations too", () => {
  const leadNames = (tree: ReactNode) => ((tableOf(tree)?.props.leadRows as { cells: Record<string, ReactNode> }[]) ?? []).map((lead) => textOf(lead.cells.name).replace("Invitație", ""));
  const offered = (tree: ReactNode) => elements(tree).map((element) => element.props["data-testid"]).filter((id): id is string => typeof id === "string" && id.startsWith("status-invitation-"));

  async function raceWithInvitations() {
    const race = await createRace();
    const admin = await staff("ADMIN");
    state.actor = admin;
    const ana = await register(race.id, "Ana Pop");
    const now = new Date();
    const day = 24 * 3_600_000;
    const invite = (name: string, row: Partial<typeof eventInvitations.$inferInsert>) =>
      db.insert(eventInvitations).values({
        eventId: race.id,
        participantId: ana.participantId,
        email: `${name.split(" ")[0].toLowerCase()}@example.org`,
        canonicalEmail: `${name.split(" ")[0].toLowerCase()}@example.org`,
        name,
        invitedByStaffUserId: admin.id,
        createdAt: new Date(now.getTime() - 5 * day),
        sentAt: new Date(now.getTime() - 5 * day),
        lastSentAt: new Date(now.getTime() - 5 * day),
        expiresAt: new Date(now.getTime() + 3 * day),
        ...row,
      });
    await invite("Sara Trimisa", {});
    await invite("Sorin Trimisul", {});
    await invite("Emil Expiratul", { expiresAt: new Date(now.getTime() - day) });
    await invite("Radu Retrasul", { withdrawnAt: new Date(now.getTime() - day), withdrawnByStaffUserId: admin.id });
    return { race, ana };
  }

  it("offers the three states with one event chosen, in the words the rows wear; one of them lists that state's invitations and no registration", async () => {
    const { race, ana } = await raceWithInvitations();
    const plain = await listPage({ eventId: race.id });
    expect(offered(plain)).toEqual(["status-invitation-sent", "status-invitation-expired", "status-invitation-withdrawn"]);
    expect(rowsOf(plain).map((row) => row.id)).toEqual([ana.id]);
    expect(leadNames(plain).sort()).toEqual(["Emil Expiratul", "Radu Retrasul", "Sara Trimisa", "Sorin Trimisul"]);

    for (const [status, names] of [
      ["invitation-sent", ["Sara Trimisa", "Sorin Trimisul"]],
      ["invitation-expired", ["Emil Expiratul"]],
      ["invitation-withdrawn", ["Radu Retrasul"]],
    ] as const) {
      const tree = await listPage({ eventId: race.id, status });
      expect(rowsOf(tree), status).toEqual([]);
      expect(leadNames(tree).sort(), status).toEqual([...names]);
      // The table counts what it lists: the invitations.
      expect(tableOf(tree)?.props.total, status).toBe(names.length);
    }
    // The select's words are the rows' own.
    const option = elements(plain).find((element) => element.props["data-testid"] === "status-invitation-expired");
    expect(textOf(option)).toBe("Invitație expirată");
  });

  it("lists them on any page, and the search box looks in their names and addresses", async () => {
    const { race } = await raceWithInvitations();
    expect(leadNames(await listPage({ eventId: race.id, status: "invitation-sent", page: "3" })).sort()).toEqual(["Sara Trimisa", "Sorin Trimisul"]);
    expect(leadNames(await listPage({ eventId: race.id, status: "invitation-sent", q: "sORin" }))).toEqual(["Sorin Trimisul"]);
    expect(leadNames(await listPage({ eventId: race.id, status: "invitation-sent", q: "sara@example" }))).toEqual(["Sara Trimisa"]);
    expect(leadNames(await listPage({ eventId: race.id, status: "invitation-sent", q: "nimeni" }))).toEqual([]);
    // A filter an invitation cannot answer hides them, as it did.
    expect(leadNames(await listPage({ eventId: race.id, status: "invitation-sent", partner: "1" }))).toEqual([]);
    expect(leadNames(await listPage({ eventId: race.id, status: "CONFIRMED" }))).toEqual([]);
  });

  it("with every event listed the three are not offered and the parameter says nothing", async () => {
    const { ana } = await raceWithInvitations();
    const every = await listPage({ eventId: "all", status: "invitation-sent" });
    expect(offered(every)).toEqual([]);
    expect(rowsOf(every).map((row) => row.id)).toEqual([ana.id]);
    expect(leadNames(every)).toEqual([]);
  });
});

/**
 * BR-REQ-060-01, BR-REQ-070-01, `DECISIONS.md` §NNN — the owner, 2026-11-12: «Aș vrea să afișez și numărul de telefon al
 * alergătorilor în grid ca să pot să-i sun rapid». §322's rule is kept: a telephone is read only when asked for, by whoever
 * may read the registrations, and each read is recorded — here once per page drawn, with the count and never a number.
 */
describe("§NNN «Arată telefoanele»: the telephones on demand, each page recorded", () => {
  const phoneViews = () => db.select().from(auditLogs).where(eq(auditLogs.action, "registrations.phones_viewed"));
  const switchOf = (tree: ReactNode) => {
    const box = elements(tree).find((element) => element.props["data-testid"] === "registrations-phones");
    const link = elements(box).find((element) => typeof element.props.href === "string");
    return { href: link?.props.href as string | undefined, words: textOf(link), help: textOf(elements(box).at(-1)) };
  };

  it("draws no «Telefon» column and reads no telephone until asked; asked, the numbers are links and the page is recorded once", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    state.actor = admin;
    const ana = await register(race.id, "Ana Pop", { phone: "0722 123 456" });
    const ion = await register(race.id, "Ion Pop");

    const plain = await listPage({ eventId: race.id, sort: "name", dir: "asc" });
    expect(columnOf(plain, "phone")).toBeUndefined();
    expect(await phoneViews()).toHaveLength(0);
    // The switch is a plain link to the same list, as it stands, with the telephones asked for.
    const off = switchOf(plain);
    expect(off.words).toBe("Arată telefoanele");
    expect(new URL(off.href ?? "", "https://example.test").searchParams.get("phones")).toBe("1");
    expect(new URL(off.href ?? "", "https://example.test").searchParams.get("sort")).toBe("name");
    expect(off.help).toContain("jurnal");

    const shown = await listPage({ eventId: race.id, sort: "name", dir: "asc", phones: "1" });
    const column = columnOf(shown, "phone");
    expect(column?.label).toBe("Telefon");
    expect(column?.hint).toContain("jurnal");
    const keys = (tableOf(shown)?.props.columns as Column[]).map((candidate) => candidate.key);
    expect(keys.indexOf("phone")).toBe(keys.indexOf("email") + 1);
    // The number as typed, on a link a phone rings; nothing typed, a dash.
    const cell = elements(cellOf(shown, "phone", ana.id))[0];
    expect(textOf(cell)).toBe("0722 123 456");
    expect(cell.props.href).toBe("tel:0722123456");
    expect(textOf(cellOf(shown, "phone", ion.id))).toBe("—");
    // One row in the trail for the page: who, which event, how many rows — never a number.
    const views = await phoneViews();
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ actorStaffUserId: admin.id, participantId: null, entityType: "event", entityId: race.id, metadataJson: { rowCount: 2 } });
    expect(JSON.stringify(views[0])).not.toContain("0722");
    // The switch now takes the column away, and every sort and page link keeps it on meanwhile.
    const on = switchOf(shown);
    expect(on.words).toBe("Ascunde telefoanele");
    expect(new URL(on.href ?? "", "https://example.test").searchParams.get("phones")).toBeNull();
    expect((tableOf(shown)?.props.currentParams as Record<string, string | undefined>).phones).toBe("1");
    // Anything but «1» is not the ask.
    await db.delete(auditLogs);
    expect(columnOf(await listPage({ eventId: race.id, phones: "yes" }), "phone")).toBeUndefined();
    expect(await phoneViews()).toHaveLength(0);
  });

  it("records every event's list with no event, and a page of no rows not at all", async () => {
    const race = await createRace();
    state.actor = await staff("MODERATOR");
    await register(race.id, "Ana Pop", { phone: "+40 722 000 111" });
    const every = await listPage({ eventId: "all", phones: "1" });
    expect(textOf(cellOf(every, "phone", rowsOf(every)[0].id))).toBe("+40 722 000 111");
    expect((elements(cellOf(every, "phone", rowsOf(every)[0].id))[0].props.href as string)).toBe("tel:+40722000111");
    expect((await phoneViews()).map((row) => [row.entityId, row.metadataJson])).toEqual([[null, { rowCount: 1 }]]);

    await db.delete(auditLogs);
    await listPage({ eventId: race.id, phones: "1", q: "nimeni-cu-numele-asta" });
    expect(await phoneViews()).toHaveLength(0);
  });

  it("is read by whoever may read the registrations and by nobody else — the service refuses and records nothing", async () => {
    const race = await createRace();
    const ana = await register(race.id, "Ana Pop", { phone: "0722 123 456" });
    const { readRowPhones } = await import("@/modules/registrations/admin-service");
    const { canReadRegistrations } = await import("@/modules/staff-identity/domain/roles");
    for (const role of STAFF_ROLES) {
      await db.delete(auditLogs);
      const actor = await staff(role);
      const read = readRowPhones(db, actor, { registrationIds: [ana.id], eventId: race.id }, new Date());
      if (canReadRegistrations(actor.role)) {
        expect(await read, role).toEqual(new Map([[ana.id, "0722 123 456"]]));
        expect(await phoneViews(), role).toHaveLength(1);
      } else {
        await expect(read, role).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(await phoneViews(), role).toHaveLength(0);
      }
    }
  });
});

/**
 * BR-REQ-060-01, `DECISIONS.md` §NNN — the owner, 2026-11-12: «Mă disperă în general că atunci când fac un edit gen „aleg
 * partenerul” și navighezi». The page's half of it (the actions' half is `row-press-returns.test.ts`): the table names its
 * rows, and every form of a row carries the list's own query.
 */
describe("§NNN a row's press comes back to the row", () => {
  it("names each row and hands every one of its forms the list's query, once", async () => {
    const race = await createRace();
    state.actor = await staff("ADMIN");
    const ana = await register(race.id, "Ana Pop", { bibNumber: 4, confirmedAt: new Date(), emailConfirmedAt: new Date() });
    const tree = await listPage({ eventId: race.id, sort: "name", dir: "asc" });
    const table = tableOf(tree);
    const row = rowsOf(tree)[0];
    expect((table?.props.rowId as (row: ListRow) => string)(row)).toBe(`reg-${ana.id}`);

    const drawn = elements((table?.props.rowActions as (row: ListRow) => ReactNode)(row));
    const forms = drawn.filter((element) => element.type === ActionForm || element.props.component === "form");
    // The resend, the desk's verbs, the special guests list, the cancel, the member tick, the elite mark, the printing mark.
    expect(forms.length).toBeGreaterThanOrEqual(6);
    for (const one of forms) {
      const queries = elements(one.props.children).filter((element) => element.type === "input" && element.props.name === "listQuery");
      expect(queries, String(one.props.id)).toHaveLength(1);
      const query = new URLSearchParams(queries[0].props.value as string);
      expect(query.get("eventId"), String(one.props.id)).toBe(race.id);
      expect(query.get("sort"), String(one.props.id)).toBe("name");
    }
  });
});

describe("the two readings of the row's editor and of the filter's parameter", () => {
  it("the row's editor: a typed name wins over the select, the select otherwise, both empty clears — then `parsePartnerMark`", () => {
    const posted = (fields: Record<string, string>) => partnerMark.parsePartnerMark(partnerMark.partnerMarkOfRow(form(fields)));
    expect(posted({ partnerChoice: BAKERY, partnerName: CAFE })).toBe(CAFE);
    expect(posted({ partnerChoice: BAKERY, partnerName: "  " })).toBe(BAKERY);
    expect(posted({ partnerChoice: "", partnerName: "" })).toBeNull();
    expect(posted({})).toBeNull();
    expect(posted({ partnerChoice: "", partnerName: `  ${WORKSHOP}  ` })).toBe(WORKSHOP);
  });

  it("the filter's name: one of the event's partners, case aside, in their spelling; anything else is null", () => {
    expect(partnerMark.chosenPartnerOf("brutăria EXEMPLU", [CAFE, BAKERY])).toBe(BAKERY);
    expect(partnerMark.chosenPartnerOf(`  ${CAFE} `, [CAFE, BAKERY])).toBe(CAFE);
    for (const raw of ["", "   ", "Nimeni", "x".repeat(PARTNER_NAME_MAX + 1), undefined, null, ["a", "b"], 7]) {
      expect(partnerMark.chosenPartnerOf(raw, [CAFE, BAKERY]), String(raw)).toBeNull();
    }
    expect(partnerMark.chosenPartnerOf(BAKERY, [])).toBeNull();
  });
});
