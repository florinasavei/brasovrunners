import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { CLUB_NAME } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-03 criterion 12 (§NNN) — where the member tick's verbs show, read from a real database.
 *
 * - the registration's page carries «Bifa de membru» with «Nu e membru» (ticked) or «E membru» (not),
 *   asked first with the person's name; the Organizer reads the chip and sees no verb (§289);
 * - the list's row offers the same verb behind "⋮", with a hidden form that comes back to the list;
 * - «Curăță bifele celor care nu sunt membri» shows with the members' filter on, for the Administrator
 *   only, and opens the preview: one ticked box per candidate, the count, the note; an empty preview
 *   says «Nicio bifă de scos».
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
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  cancelRegistrationFromRowAction: vi.fn(),
  eraseRegistrationFromListAction: vi.fn(),
  setBibPrintedAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  correctRegisteredNameAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  declarationHoldAction: vi.fn(),
  // The member tick and its sweep (§NNN).
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

const byTestId = (tree: ReactNode, id: string) => elements(tree).filter((element) => element.props["data-testid"] === id);

let db: TestDatabase;
let close: () => Promise<void>;

async function createRace(title: string) {
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
      clubMemberDeclared: true,
      clubName: CLUB_NAME,
      ...row,
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function staff(role: "ADMIN" | "MODERATOR", email = `${role.toLowerCase()}@dev.test`): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email, displayName: role, role }).returning();
  return user;
}

async function listPage(searchParams: Record<string, string>) {
  return AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(searchParams) } as never);
}

async function detailPage(id: string) {
  return RegistrationDetailPage({ params: Promise.resolve({ locale: "ro", id }), searchParams: Promise.resolve({}) } as never);
}

/** What the list's "⋮" holds for each row: the table's own `rowActions`, walked. */
function rowActionsOf(tree: ReactNode): ReactElement<Props>[] {
  const table = elements(tree).find((element) => element.type === AdminTable);
  if (!table) return [];
  const rows = table.props.rows as { id: string }[];
  const render = table.props.rowActions as (row: { id: string }) => ReactNode;
  return rows.flatMap((row) => elements(render(row)));
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

describe("BR-REQ-037-03 criterion 12: the registration's page", () => {
  it("offers «Nu e membru» on a ticked row and «E membru» on an unticked one, each asked with the person's name", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("ADMIN");
    const ticked = await register(race.id);
    const unticked = await register(race.id, { clubMemberDeclared: false, clubName: null });

    const [clearForm] = byTestId(await detailPage(ticked), "member-tick-form");
    expect(clearForm.props.action).toBe(actions.setClubMemberDeclaredAction);
    expect(clearForm.props.confirm).toMatchObject({ title: "Scoți bifa de membru?", confirmLabel: "Nu e membru" });
    expect((clearForm.props.confirm as { body: string }).body).toBe(`Scoți bifa de membru de la Runner ${serial - 1}; nimic altceva nu se schimbă, niciun email.`);
    const clearTo = elements(clearForm).find((element) => element.props.name === "to");
    expect(clearTo?.props.value).toBe("0");

    const [setForm] = byTestId(await detailPage(unticked), "member-tick-form");
    expect(setForm.props.confirm).toMatchObject({ title: "Pui bifa de membru?", confirmLabel: "E membru" });
    expect(elements(setForm).find((element) => element.props.name === "to")?.props.value).toBe("1");
  });

  it("shows the Organizer the chip and no verb (§289)", async () => {
    const race = await createRace("Crosul");
    state.actor = await staff("MODERATOR");
    const tree = await detailPage(await register(race.id));
    expect(byTestId(tree, "member-tick")).toHaveLength(0);
    expect(elements(tree).some((element) => element.props.label === "Membru (declarat)")).toBe(true);
  });
});

describe("BR-REQ-037-03 criterion 12: the registrations list", () => {
  it("puts the verb behind each row's ⋮ for the Administrator, coming back to the list, and nowhere for the Organizer", async () => {
    const race = await createRace("Crosul");
    const id = await register(race.id);

    state.actor = await staff("ADMIN");
    const forms = rowActionsOf(await listPage({ eventId: race.id })).filter((element) => element.props.id === `member-${id}`);
    expect(forms).toHaveLength(1);
    expect(forms[0].props.action).toBe(actions.setClubMemberDeclaredAction);
    expect(elements(forms[0]).some((element) => element.props.name === "listQuery")).toBe(true);

    state.actor = await staff("MODERATOR");
    expect(rowActionsOf(await listPage({ eventId: race.id })).filter((element) => element.props.id === `member-${id}`)).toHaveLength(0);
  });

  it("offers «Curăță bifele celor care nu sunt membri» only with the members' filter on, and only to the Administrator", async () => {
    const race = await createRace("Crosul");
    await register(race.id);
    state.actor = await staff("ADMIN");
    const label = "Curăță bifele celor care nu sunt membri";
    const hasButton = (tree: ReactNode) => elements(tree).some((element) => element.props.icon === "sweep" && element.props.children === label);

    expect(hasButton(await listPage({ eventId: race.id }))).toBe(false);
    expect(hasButton(await listPage({ eventId: race.id, clubMember: "1" }))).toBe(true);
    // A summary pill keeps the filter's key (§626), so the button stays with a state chosen too.
    expect(hasButton(await listPage({ eventId: race.id, clubMember: "1", status: "CONFIRMED" }))).toBe(true);

    state.actor = await staff("MODERATOR");
    expect(hasButton(await listPage({ eventId: race.id, clubMember: "1" }))).toBe(false);
    expect(byTestId(await listPage({ eventId: race.id, clubMember: "1", memberSweep: "1" }), "member-sweep")).toHaveLength(0);
  });

  it("opens the preview: one ticked box per candidate, the count, the event's scope — members and unticked rows left out", async () => {
    const race = await createRace("Crosul");
    const stranger = await register(race.id);
    const another = await register(race.id);
    await register(race.id, { clubMemberDeclared: false, clubName: null });
    const memberRow = await register(race.id);
    // That row's address is a member's account (the participant's canonical address, `runnerN@example.org`).
    await db.insert(staffUsers).values({ email: `runner${serial}@example.org`, displayName: "Member", role: "MEMBER" });
    state.actor = await staff("ADMIN");

    const tree = await listPage({ eventId: race.id, clubMember: "1", memberSweep: "1" });
    const [form] = byTestId(tree, "member-sweep-form");
    expect(form.props.action).toBe(actions.clearMemberTicksAction);
    const boxes = elements(form).filter((element) => element.props.name === "registrationId");
    expect(boxes.map((box) => box.props.value).sort()).toEqual([stranger, another].sort());
    expect(boxes.every((box) => box.props.defaultChecked === true)).toBe(true);
    expect(boxes.map((box) => box.props.value)).not.toContain(memberRow);
    expect(elements(form).find((element) => element.props.name === "eventId")?.props.value).toBe(race.id);
    expect(byTestId(form, "member-sweep-count")[0].props.children).toBe("2 înscrieri cu bifa de membru fără cont de membru");
    expect(form.props.confirm).toMatchObject({ title: "Scoți bifele de membru?", confirmLabel: "Scoate bifa la cele 2" });
    expect((form.props.confirm as { bodyCount: { field: string } }).bodyCount.field).toBe("registrationId");
  });

  it("says «Nicio bifă de scos» when every ticked row is a member's", async () => {
    const race = await createRace("Crosul");
    await register(race.id);
    await db.insert(staffUsers).values({ email: `runner${serial}@example.org`, displayName: "Member", role: "MEMBER" });
    state.actor = await staff("ADMIN");

    const tree = await listPage({ eventId: race.id, clubMember: "1", memberSweep: "1" });
    expect(byTestId(tree, "member-sweep-form")).toHaveLength(0);
    expect(byTestId(tree, "member-sweep-empty")).toHaveLength(1);
  });

  it("names the sweep's count after the press, in its counted form", async () => {
    await createRace("Crosul");
    state.actor = await staff("ADMIN");
    const tree = await listPage({ clubMember: "1", saved: "memberTicksCleared", count: "3" });
    const [banner] = byTestId(tree, "member-ticks-cleared");
    expect(banner.props.children).toBe("Am scos bifa de membru la 3 înscrieri. Nimic altceva nu s-a schimbat.");
  });
});
