import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventInvitations } from "@/db/schema/event-invitations";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «De la parteneri» on the backoffice's screens (the decision «De la parteneri»; BR-REQ-060-01): on the registrations list the
 * partner's name in its own column «Partener» (the list's column), which both copies of the table draw, and no chip in the
 * name column any more; «Partener: {name}» on the registration's page, on a line of the internal list and on an invitation's
 * row; nothing for a row without a name. The filter «De la parteneri» among the list's filters, a select now, the rows it keeps. On the registration's page the Administrator gets the tick and the box in a form, the
 * Organizer the chip alone. The pages are Server Components, so they are called and their element trees walked.
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
  addRegistrationNoteFromListAction: vi.fn(),
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  setPublicRegistrationOpenAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  changeRegistrationAddressAction: vi.fn(),
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
  setRegistrationAmbassadorAction: vi.fn(),
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
const { default: ReserveListPanel } = await import("@/modules/registrations/ui/ReserveListPanel");
const { default: PartnerMarkFields, PartnerSuggestionList } = await import("@/modules/registrations/ui/PartnerMarkFields");
const { default: InvitationsPanel } = await import("@/modules/registrations/ui/InvitationsPanel");
const { default: PartnerFilterSelect } = await import("@/modules/registrations/ui/PartnerFilterSelect");
const reserveActions = await import("@/app/[locale]/admin/registrations/reserve-actions");
const partnerActions = await import("@/app/[locale]/admin/registrations/[id]/partner-actions");
const { setRegistrationPartner } = await import("@/modules/registrations/partner-mark");

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; primary?: boolean; render: (row: unknown) => ReactNode };

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

/** Made-up partners: no real sponsor's name. */
const PARTNER = "Brutăria Exemplu";

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;

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
    { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul" },
    { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title: "Crosul" },
  ]);
  return event;
}

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
    .returning({ id: registrations.id, participantId: registrations.participantId });
  return created;
}

async function staff(role: "ADMIN" | "MODERATOR"): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: role, role }).returning();
  return user;
}

const listPage = (searchParams: Record<string, string>) =>
  AdminRegistrationsPage({ params: Promise.resolve({ locale: state.locale }), searchParams: Promise.resolve(searchParams) } as never);
const detailPage = (id: string) => RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never);
const tableOf = (tree: ReactNode) => elements(tree).find((element) => element.type === AdminTable);

/** One cell of one row, walked — the «Nume» cell by default, where the row's chips are: the one render both copies of the table draw. */
function nameCellOf(tree: ReactNode, id: string, key = "name"): ReactElement<Props>[] {
  const table = tableOf(tree);
  const row = (table?.props.rows as { id: string }[]).find((candidate) => candidate.id === id);
  const column = (table?.props.columns as Column[]).find((candidate) => candidate.key === key);
  return row && column ? elements(column.render(row)) : [];
}

/** Every string under `node`, joined: what the reader sees of it. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => textOf(child as ReactNode)).join("");
  if (!isValidElement<Props>(node)) return "";
  return textOf(node.props.children);
}

const chipOf = (nodes: ReactElement<Props>[], testId = "partner-chip") => nodes.find((element) => element.props.testId === testId);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("the partner on the registrations list", () => {
  it("is in the column «Partener» on a row with a name, for every role that reads the list, both copies drawing it; no chip in the name column; nothing on a row without", async () => {
    const race = await createRace();
    const from = await register(race.id, { partnerName: PARTNER });
    const plain = await register(race.id);
    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = await staff(role);
      const tree = await listPage({ eventId: race.id });
      // The column «Partener» says it now (the list's column): the chip left the name cell of this list.
      const cell = nameCellOf(tree, from.id, "partner");
      expect(textOf(cell.find((element) => element.props["data-testid"] === "row-partner")), role).toBe(PARTNER);
      expect(chipOf(nameCellOf(tree, from.id)), role).toBeUndefined();
      expect(chipOf(cell), role).toBeUndefined();
      expect(nameCellOf(tree, plain.id, "partner").some((element) => element.props["data-testid"] === "row-partner"), role).toBe(false);
      expect(chipOf(nameCellOf(tree, plain.id)), role).toBeUndefined();
      // The table draws every column on both layouts: the desktop table and the phone cards read this one render.
      expect((tableOf(tree)?.props.columns as Column[]).find((column) => column.key === "name")?.primary, role).toBe(true);
      expect((tableOf(tree)?.props.columns as Column[]).some((column) => column.key === "partner"), role).toBe(true);
    }
    state.locale = "en";
    const english = await listPage({ eventId: race.id });
    expect((tableOf(english)?.props.columns as (Column & { label: string })[]).find((column) => column.key === "partner")?.label).toBe("Partner");
    expect(textOf(nameCellOf(english, from.id, "partner").find((element) => element.props["data-testid"] === "row-partner"))).toBe(PARTNER);
    expect(chipOf(nameCellOf(english, from.id))).toBeUndefined();
  });

  it("offers the filter «De la parteneri», which keeps the rows with a name, its count beside them", async () => {
    const race = await createRace();
    state.actor = await staff("MODERATOR");
    const from = await register(race.id, { partnerName: PARTNER });
    await register(race.id);
    const all = await listPage({ eventId: race.id });
    // A select now (the list's column «Partener»): «de la orice partener» posts `partner` = 1, as the tick did.
    const box = elements(all).find((element) => element.type === PartnerFilterSelect);
    expect(box?.props.anyName).toBe("partner");
    expect(box?.props.anyChosen).toBe(false);
    // Its words, and the help under them.
    expect(box?.props.label).toBe("De la parteneri");
    expect(box?.props.help).toBe(ro.Admin.partner.filterHelp);
    expect(tableOf(all)?.props.total).toBe(2);

    const filtered = await listPage({ eventId: race.id, partner: "1" });
    const table = tableOf(filtered);
    expect((table?.props.rows as { id: string }[]).map((row) => row.id)).toEqual([from.id]);
    expect(table?.props.total).toBe(1);
    // It rides with every sort, page and export link: the file is the rows on screen.
    expect((table?.props.currentParams as Record<string, string | undefined>).partner).toBe("1");
    expect(elements(filtered).find((element) => element.type === PartnerFilterSelect)?.props.anyChosen).toBe(true);
  });
});

describe("«De la parteneri» on the registration's page", () => {
  it("wears the chip for every role; the Administrator alone gets the tick and the box in a form", async () => {
    const race = await createRace();
    const from = await register(race.id, { partnerName: PARTNER });
    const plain = await register(race.id);

    state.actor = await staff("MODERATOR");
    const organizer = elements(await detailPage(from.id));
    expect(chipOf(organizer)?.props.label).toBe(`Partener: ${PARTNER}`);
    expect(organizer.some((element) => element.props.action === partnerActions.setRegistrationPartnerAction)).toBe(false);
    expect(organizer.some((element) => element.type === PartnerMarkFields)).toBe(false);
    expect(chipOf(elements(await detailPage(plain.id)))).toBeUndefined();

    state.actor = await staff("ADMIN");
    const page = elements(await detailPage(from.id));
    expect(chipOf(page)?.props.label).toBe(`Partener: ${PARTNER}`);
    const formOf = page.find((element) => element.props.action === partnerActions.setRegistrationPartnerAction);
    expect(formOf).toBeDefined();
    const inside = elements(formOf);
    expect(inside.find((element) => element.type === PartnerMarkFields)?.props.name).toBe(PARTNER);
    expect(inside.find((element) => element.props.name === "registrationId")?.props.value).toBe(from.id);
    // The event's earlier names, the box's suggestions.
    expect(page.find((element) => element.type === PartnerSuggestionList)?.props.names).toEqual([PARTNER]);
    // A registration without one: the tick drawn unticked, the box empty.
    expect(elements(await detailPage(plain.id)).find((element) => element.type === PartnerMarkFields)?.props.name).toBeNull();
  });

  it("renders with a real `registration.partner_set` row, and «Istoric» says it in words, never the name", async () => {
    const race = await createRace();
    const target = await register(race.id);
    const admin = await staff("ADMIN");
    state.actor = admin;
    await setRegistrationPartner(db, admin, target.id, { partner: "on", partnerName: PARTNER }, new Date());
    for (const locale of ["ro", "en"] as const) {
      state.locale = locale;
      const page = elements(
        await RegistrationDetailPage({ params: Promise.resolve({ locale, id: target.id }), searchParams: Promise.resolve({}) } as never),
      );
      const trail = page.find((element) => element.props["data-testid"] === "audit-trail");
      expect(trail, locale).toBeDefined();
      const text = textOf(trail);
      const label = (locale === "ro" ? ro : en).Admin.registrations.audit.registration.partner_set;
      expect(text, locale).toContain(label);
      expect(text, locale).not.toContain("partner_set");
      expect(text, locale).not.toContain(PARTNER);
    }
  });
});

describe("«De la parteneri» on the internal list and the invitations", () => {
  it("a line wears the chip; the add asks the tick and the box; each line has its fold", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    state.actor = admin;
    const [line] = await db.insert(eventReserveEntries).values({ eventId: race.id, firstName: "Ana", lastName: "Pop", partnerName: PARTNER }).returning();
    const [bare] = await db.insert(eventReserveEntries).values({ eventId: race.id, firstName: "Ion", lastName: "Pop" }).returning();
    const entries = [
      { ...line, createdByName: null },
      { ...bare, createdByName: null },
    ];
    const panel = elements(
      await ReserveListPanel({
        locale: "ro",
        eventId: race.id,
        entries,
        addAction: vi.fn(),
        saveNoteAction: vi.fn(),
        partnerAction: reserveActions.saveReservePartnerAction,
        partnerSuggestions: [PARTNER],
        deleteAction: vi.fn(),
        opened: true,
      }),
    );
    const lines = panel.filter((element) => element.props["data-testid"] === "reserve-entry");
    expect(lines).toHaveLength(2);
    expect(chipOf(elements(lines[0]))?.props.label).toBe(`Partener: ${PARTNER}`);
    expect(chipOf(elements(lines[1]))).toBeUndefined();
    const folds = panel.filter((element) => element.props.action === reserveActions.saveReservePartnerAction);
    expect(folds).toHaveLength(2);
    expect(elements(folds[0]).find((element) => element.type === PartnerMarkFields)?.props.name).toBe(PARTNER);
    expect(elements(folds[1]).find((element) => element.type === PartnerMarkFields)?.props.name).toBeNull();
    const add = panel.find((element) => element.props["data-testid"] === "reserve-add-form");
    expect(elements(add).find((element) => element.type === PartnerMarkFields)?.props.name).toBeNull();
    expect(panel.find((element) => element.type === PartnerSuggestionList)?.props.names).toEqual([PARTNER]);
    // Without the press (a role the page hands none), no fold — the chip stays.
    const readOnly = elements(await ReserveListPanel({ locale: "ro", eventId: race.id, entries, addAction: vi.fn(), saveNoteAction: vi.fn(), deleteAction: vi.fn(), opened: true }));
    expect(readOnly.some((element) => element.props.action === reserveActions.saveReservePartnerAction)).toBe(false);
    expect(readOnly.filter((element) => element.props.testId === "partner-chip")).toHaveLength(1);
  });

  it("an invitation's row wears the chip: the send's name while open, the registration's as it stands once accepted", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    const now = new Date();
    const later = new Date(now.getTime() + 3 * 24 * 3_600_000);
    const accepted = await register(race.id, { partnerName: null });
    const open = await register(race.id, { status: "WAITLISTED" });
    const base = { eventId: race.id, email: "x@example.org", canonicalEmail: "x@example.org", invitedByStaffUserId: admin.id, createdAt: now, sentAt: now, lastSentAt: now, expiresAt: later };
    await db.insert(eventInvitations).values([
      { ...base, participantId: open.participantId, name: "Ana Deschis", partnerName: PARTNER },
      { ...base, participantId: accepted.participantId, name: "Ion Primit", partnerName: PARTNER, acceptedAt: now, acceptedRegistrationId: accepted.id },
      { ...base, participantId: open.participantId, name: "Eva Fără", email: "y@example.org", canonicalEmail: "y@example.org" },
    ]);
    const tree = elements(
      await InvitationsPanel({ db, actor: { role: "MODERATOR" }, locale: "ro", eventId: race.id, mayManage: false, sendAction: vi.fn() as never, resendAction: vi.fn() as never, withdrawAction: vi.fn() as never, deleteAction: vi.fn() as never, now }),
    );
    const rows = tree.filter((element) => element.props["data-testid"] === "invitation-row");
    const chipIn = (name: string) => {
      const row = rows.find((candidate) => JSON.stringify(elements(candidate).map((element) => element.props.children ?? null)).includes(name));
      return elements(row).find((element) => element.props.testId === "invitation-partner-chip")?.props.label;
    };
    expect(chipIn("Ana Deschis")).toBe(`Partener: ${PARTNER}`);
    // Accepted: the registration's name now, which its page cleared.
    expect(chipIn("Ion Primit")).toBeUndefined();
    expect(chipIn("Eva Fără")).toBeUndefined();
  });
});
