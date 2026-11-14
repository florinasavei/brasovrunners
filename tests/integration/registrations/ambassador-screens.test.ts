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
 * §NNN (the owner, 2026-11-14: «pe lângă Elite, adaugă și categoria de „Ambasadori" ca să putem decide pe cine premiem și
 * pe cine nu», choosing «Ca Elită, fără BIB special») — «Ambasador» on the backoffice's screens. The registrations list's
 * «⋮» offers «Marchează ca ambasador» or «Nu mai e ambasador» by the row's own mark to the Administrator in every state,
 * from a hidden form that asks nothing and comes back to the list, and — on a row that wears either mark — the one pair of
 * ticks, «Apare în clasament» and «Apare pe site». A marked row wears «Ambasador» on the list and on the registration's
 * page, for every role that reads them; the «Ambasadori» panel lists the event's ambassadors with what the ticks hide of
 * each. What is shown is a courtesy (BR-REQ-060-01): the action and the service refuse every other role again
 * (`ambassador-mark.test.ts`).
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
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  editRegistrationAnswersAction: vi.fn(),
  changeRegistrationAddressAction: vi.fn(),
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
const { default: AmbassadorPanel } = await import("@/modules/registrations/ui/AmbassadorPanel");
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

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

const markItems = (tree: ReactNode, id: string) => menuItems(tree, id).filter((item) => item.formId === `ambassador-${id}`);
const markForm = (tree: ReactNode, id: string) => cellOf(tree, id).find((element) => element.props.id === `ambassador-${id}`);
const chipOf = (nodes: ReactElement<Props>[], testId = "ambassador-chip") => nodes.find((element) => element.props.testId === testId);
const tickItems = (tree: ReactNode, id: string) => menuItems(tree, id).filter((item) => item.formId === `elite-results-${id}` || item.formId === `elite-site-${id}`);
const field = (form: ReactElement<Props> | undefined, name: string) => elements(form).find((element) => element.props.name === name)?.props.value;
const detailPage = (id: string) => RegistrationDetailPage({ params: Promise.resolve({ locale: state.locale, id }), searchParams: Promise.resolve({}) } as never);

describe("§NNN the ambassador mark on the registrations list", () => {
  it("offers «Marchează ca ambasador» or «Nu mai e ambasador» by the row's own mark, with its own glyph, in every state", async () => {
    const race = await createRace();
    state.actor = await staff("ADMIN");
    const plain = await register(race.id);
    const marked = await register(race.id, { ambassador: true });
    const waiting = await register(race.id, { status: "WAITLISTED" });
    const cancelled = await register(race.id, { status: "CANCELLED", cancelledAt: new Date(), cancellationSource: "ADMIN", ambassador: true });
    const tree = await listPage({ eventId: race.id });

    expect(markItems(tree, plain).map((item) => [item.label, item.icon])).toEqual([["Marchează ca ambasador", "ambassador"]]);
    expect(markItems(tree, marked).map((item) => [item.label, item.icon])).toEqual([["Nu mai e ambasador", "ambassador"]]);
    expect(markItems(tree, waiting).map((item) => item.label)).toEqual(["Marchează ca ambasador"]);
    expect(markItems(tree, cancelled).map((item) => item.label)).toEqual(["Nu mai e ambasador"]);
    // Beside the elite's mark, never in its place: a row offers both, each by its own mark.
    expect(menuItems(tree, marked).map((item) => item.label)).toEqual(expect.arrayContaining(["Marchează ca elită", "Nu mai e ambasador"]));
  });

  it("posts its action from a hidden form that asks nothing, carries the opposite mark and comes back to the list", async () => {
    const race = await createRace();
    state.actor = await staff("ADMIN");
    const plain = await register(race.id);
    const marked = await register(race.id, { ambassador: true });
    const tree = await listPage({ eventId: race.id });

    const mark = markForm(tree, plain);
    expect(mark?.props.action).toBe(actions.setRegistrationAmbassadorAction);
    // §384: it tells nobody and the same menu undoes it — no question.
    expect(mark?.props.confirm).toBeUndefined();
    expect(field(mark, "ambassador")).toBe("1");
    expect(field(mark, "registrationId")).toBe(plain);
    expect(String(field(mark, "listQuery"))).toContain(`eventId=${race.id}`);
    expect(field(markForm(tree, marked), "ambassador")).toBe("0");
  });

  it("puts «Ambasador» on a marked row for every role that reads the list, and offers the Organizer no mark", async () => {
    const race = await createRace();
    const plain = await register(race.id);
    const marked = await register(race.id, { ambassador: true });
    const both = await register(race.id, { ambassador: true, elite: true });

    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = await staff(role);
      const tree = await listPage({ eventId: race.id });
      const chip = chipOf(nameCellOf(tree, marked));
      expect(chip?.props.label, role).toBe("Ambasador");
      expect(chip?.props.glyph, role).toBe("ambassador");
      expect(chipOf(nameCellOf(tree, plain)), role).toBeUndefined();
      // An ambassador alone wears no «Elită»; one that is both wears both.
      expect(chipOf(nameCellOf(tree, marked), "elite-chip"), role).toBeUndefined();
      expect([chipOf(nameCellOf(tree, both))?.props.label, chipOf(nameCellOf(tree, both), "elite-chip")?.props.label], role).toEqual(["Ambasador", "Elită"]);
      if (role === "MODERATOR") {
        expect(markItems(tree, plain)).toHaveLength(0);
        expect(markItems(tree, marked)).toHaveLength(0);
        expect(markForm(tree, plain)).toBeUndefined();
        expect(tickItems(tree, marked)).toEqual([]);
      }
    }

    state.locale = "en";
    state.actor = await staff("ADMIN");
    const english = await listPage({ eventId: race.id });
    expect(chipOf(nameCellOf(english, marked))?.props.label).toBe("Ambassador");
    expect(markItems(english, plain).map((item) => item.label)).toEqual(["Mark as ambassador"]);
    expect(markItems(english, marked).map((item) => item.label)).toEqual(["No longer an ambassador"]);
  });
});

describe("§NNN the one pair of ticks, on a row that wears either mark", () => {
  it("offers an ambassador's row «Apare în clasament» and «Apare pe site» as ticks, each posting the other state — and a row with neither mark none", async () => {
    const race = await createRace();
    state.actor = await staff("ADMIN");
    const plain = await register(race.id);
    const ambassador = await register(race.id, { ambassador: true, eliteHiddenFromResults: true });
    const tree = await listPage({ eventId: race.id });

    expect(tickItems(tree, plain)).toEqual([]);
    expect(tickItems(tree, ambassador).map((item) => [item.label, item.checked, item.icon])).toEqual([
      ["Apare în clasament", false, "ambassador"],
      ["Apare pe site", true, "ambassador"],
    ]);
    const results = cellOf(tree, ambassador).find((element) => element.props.id === `elite-results-${ambassador}`);
    expect(results?.props.action).toBe(actions.setRegistrationEliteTickAction);
    expect(results?.props.confirm).toBeUndefined();
    expect([field(results, "tick"), field(results, "on"), field(results, "registrationId")]).toEqual(["inResults", "1", ambassador]);
  });

  it("draws one pair for a row that wears both marks, under the elite's medal, after both marks' own verbs", async () => {
    const race = await createRace();
    state.actor = await staff("ADMIN");
    const both = await register(race.id, { ambassador: true, elite: true });
    const tree = await listPage({ eventId: race.id });
    expect(tickItems(tree, both).map((item) => [item.label, item.icon])).toEqual([
      ["Apare în clasament", "elite"],
      ["Apare pe site", "elite"],
    ]);
    const labels = menuItems(tree, both).map((item) => item.label);
    expect(labels.indexOf("Nu mai e elită")).toBeLessThan(labels.indexOf("Nu mai e ambasador"));
    expect(labels.indexOf("Nu mai e ambasador")).toBeLessThan(labels.indexOf("Apare în clasament"));
    // One form a tick, never two posting the same thing.
    expect(cellOf(tree, both).filter((element) => element.props.id === `elite-results-${both}`)).toHaveLength(1);
  });
});

describe("§NNN «Ambasador» on the registration's own page", () => {
  const ticksOf = (nodes: ReactElement<Props>[]) => nodes.filter((element) => typeof element.props["data-testid"] === "string" && /^elite-tick-(inResults|onSite)$/.test(element.props["data-testid"] as string));
  const card = (nodes: ReactElement<Props>[]) => nodes.find((element) => element.props["data-testid"] === "elite-ticks");

  it("wears the chip while marked, for every role that reads the page", async () => {
    const race = await createRace();
    const marked = await register(race.id, { ambassador: true });
    const plain = await register(race.id);
    state.actor = await staff("MODERATOR");
    expect(chipOf(elements(await detailPage(marked)))?.props.label).toBe("Ambasador");
    expect(chipOf(elements(await detailPage(plain)))).toBeUndefined();
  });

  it("draws the ticks' card for an ambassador, under its own name: the Administrator's ticks in forms, the Organizer's disabled", async () => {
    const race = await createRace();
    const marked = await register(race.id, { ambassador: true, eliteHiddenFromResults: true });
    const plain = await register(race.id);

    state.actor = await staff("ADMIN");
    const admin = elements(await detailPage(marked));
    expect(card(admin)?.props.title).toBe("Ambasador: clasament și site");
    expect(card(admin)?.props.glyph).toBe("ambassador");
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
    const organizer = elements(await detailPage(marked));
    expect(ticksOf(organizer).map((element) => [element.props.checked, element.props.disabled])).toEqual([
      [false, true],
      [true, true],
    ]);
    expect(organizer.some((element) => element.props.action === actions.setRegistrationEliteTickAction)).toBe(false);

    // Neither mark: no card at all.
    expect(card(elements(await detailPage(plain)))).toBeUndefined();
  });

  it("keeps the elite's own card and name for a registration that wears both marks", async () => {
    const race = await createRace();
    const both = await register(race.id, { ambassador: true, elite: true });
    state.actor = await staff("ADMIN");
    const nodes = elements(await detailPage(both));
    expect(card(nodes)?.props.title).toBe("Elită: clasament și site");
    expect(card(nodes)?.props.glyph).toBe("bibElite");
    expect(nodes.filter((element) => element.props["data-testid"] === "elite-ticks")).toHaveLength(1);
  });
});

describe("§NNN the «Ambasadori» panel on an event's registrations list", () => {
  const panelOf = (tree: ReactNode) => elements(tree).find((element) => element.type === AmbassadorPanel);
  /** The panel as the server draws it, walked: its own tree. */
  const drawn = async (tree: ReactNode) => elements(await AmbassadorPanel(panelOf(tree)!.props as unknown as Parameters<typeof AmbassadorPanel>[0]));
  const byTestId = (nodes: ReactElement<Props>[], testId: string) => nodes.filter((element) => element.props["data-testid"] === testId);
  const textOf = (node: ReactNode): string => (Array.isArray(node) ? node.map(textOf).join("") : isValidElement<Props>(node) ? textOf(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : "");

  it("lists the event's ambassadors by name, in every state, each with its number and what the ticks hide of it — never a test row or another event's", async () => {
    const race = await createRace();
    // Another race of the club's, with an ambassador of its own: never on this event's panel.
    const [other] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2099-12-05T08:00:00.000Z"), timezone: "Europe/Bucharest", capacity: 50, registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: new Date("2026-09-01T10:00:00.000Z") })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: other.id, locale: "ro", slug: "alta-cursa-ro", title: "Altă cursă" },
      { eventId: other.id, locale: "en", slug: "alta-cursa-en", title: "Another race" },
    ]);
    await register(race.id, { registeredName: "Zoe Zamfir", ambassador: true, bibNumber: 12, confirmedAt: new Date() });
    await register(race.id, { registeredName: "Ana Albu", ambassador: true, elite: true, eliteHiddenFromResults: true, eliteHiddenFromSite: true });
    await register(race.id, { registeredName: "Dan Anulat", ambassador: true, status: "CANCELLED", cancelledAt: new Date(), cancellationSource: "ADMIN" });
    await register(race.id, { registeredName: "Tudor Test", ambassador: true, kind: "TEST" });
    await register(race.id, { registeredName: "Radu Simplu" });
    await register(other.id, { registeredName: "Alta Cursa", ambassador: true });
    state.actor = await staff("MODERATOR");

    const tree = await listPage({ eventId: race.id });
    const panel = panelOf(tree);
    expect((panel?.props.marked as { name: string }[]).map((row) => row.name)).toEqual(["Ana Albu", "Dan Anulat", "Zoe Zamfir"]);
    // The Organizer reads it and is handed no press.
    expect(panel?.props.unmark).toBeUndefined();

    const nodes = await drawn(tree);
    const fold = nodes.find((element) => element.props["data-testid"] === "registrations-ambassadors");
    expect(fold?.props).toMatchObject({ collapsible: true, title: "Ambasadori", aside: "3 ambasadori", glyph: "ambassador", id: "registrations-ambassadors" });
    expect(fold?.props.openWhen).toBeUndefined();
    const lines = byTestId(nodes, "registrations-ambassador").map((line) => textOf(line));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Ana Albu");
    expect(lines[0]).toContain("și elită");
    expect(lines[0]).toContain("în afara clasamentului");
    expect(lines[0]).toContain("nu apare pe site");
    expect(lines[2]).toContain("Zoe Zamfir");
    expect(lines[2]).toContain("12");
    expect(lines[2]).not.toContain("în afara clasamentului");
    expect(byTestId(nodes, "registrations-ambassador-unmark-form")).toEqual([]);
  });

  it("gives the Administrator a one-press «Nu mai e ambasador» on each line, with the row menu's fields and a named button", async () => {
    const race = await createRace();
    const zoe = await register(race.id, { registeredName: "Zoe Zamfir", ambassador: true });
    state.actor = await staff("ADMIN");
    const tree = await listPage({ eventId: race.id, page: "2" });
    const unmark = panelOf(tree)?.props.unmark as { action: unknown; listQuery: string } | undefined;
    expect(unmark?.action).toBe(actions.setRegistrationAmbassadorAction);
    expect(unmark?.listQuery).toContain(`eventId=${race.id}`);

    const nodes = await drawn(tree);
    const [form] = byTestId(nodes, "registrations-ambassador-unmark-form");
    expect(form.props.action).toBe(actions.setRegistrationAmbassadorAction);
    // §384: it tells nobody and the row's menu undoes it — no question.
    expect(form.props.confirm).toBeUndefined();
    expect([field(form, "registrationId"), field(form, "ambassador"), field(form, "uiLocale")]).toEqual([zoe, "0", "ro"]);
    expect(String(field(form, "listQuery"))).toBe(unmark?.listQuery);
    const [button] = byTestId(nodes, "registrations-ambassador-unmark");
    expect(button.props).toMatchObject({ type: "submit", icon: "ambassador", "aria-label": "Nu mai e ambasador: Zoe Zamfir" });
    expect(textOf(button)).toBe("Nu mai e ambasador");
  });

  it("says an event with no ambassador in words, draws no panel while the list spans every event, and speaks English on the English page", async () => {
    const race = await createRace();
    await register(race.id);
    state.actor = await staff("ADMIN");
    const empty = await drawn(await listPage({ eventId: race.id }));
    expect(empty.find((element) => element.props["data-testid"] === "registrations-ambassadors")?.props.aside).toBe("0 ambasadori");
    expect(textOf(byTestId(empty, "registrations-ambassadors-empty")[0])).toBe("Niciun ambasador la acest eveniment. Marchezi o înscriere din «⋮», pe rândul ei.");
    expect(panelOf(await listPage({}))).toBeUndefined();

    await register(race.id, { registeredName: "Zoe Zamfir", ambassador: true });
    state.locale = "en";
    const english = await drawn(await listPage({ eventId: race.id }));
    expect(english.find((element) => element.props["data-testid"] === "registrations-ambassadors")?.props).toMatchObject({ title: "Ambassadors", aside: "1 ambassador" });
    expect(textOf(byTestId(english, "registrations-ambassador-unmark")[0])).toBe("No longer an ambassador");
  });
});
