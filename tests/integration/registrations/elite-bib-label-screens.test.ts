import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listDeskRegistrations } from "@/modules/registrations/admin-repository";
import { resolveDisplayName } from "@/modules/registrations/names";
import { STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §975 (the owner, 2026-11-18, with screenshots: «partea asta cu toți participanții trebuie să fie colapsabilă» · «ce am acum pe
 * această pagină [Ziua cursei] e de fapt „Prezența” și aici trebuie să marchez dacă cineva e elită și cum apare pe BIB»;
 * BR-REQ-037-08, BR-REQ-060-01) — the screens of «Eticheta pe BIB» and the list's fold:
 *
 * - the desk's row of a registration marked «Elită» wears «Elită» and «Pe BIB: {label}» for every desk role — what the bib in
 *   the volunteer's hand says — and the Administrator alone gets «Elită și BIB» at the row's end: the elite mark's verb posting the
 *   state it wants and, while marked, the label box; another role gets no fold (the actions refuse it anyway,
 *   `elite-bib-label.test.ts`);
 * - the registrations list's table, its results line, its pager and the batch verbs on its ticks sit in one fold «Participanți»,
 *   open on arrival, its closed line the results' count.
 *
 * The pages are Server Components: they are called and their element trees walked, as the other screen tests do.
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
  recordListWishAtDeskAction: vi.fn(),
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
  setRegistrationEliteBibLabelAction: vi.fn(),
  setRegistrationAmbassadorAction: vi.fn(),
  setRegistrationRaffleAction: vi.fn(),
  deleteSponsorListRecordAction: vi.fn(),
  turnRunnerIntoVolunteerAction: vi.fn(),
  turnVolunteerIntoRunnerAction: vi.fn(),
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
const { default: AdminTable } = await import("@/modules/staff-identity/ui/AdminTable");
const { default: DeskRow } = await import("@/modules/registrations/ui/DeskRow");
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

/** The text an element tree says, its strings joined. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<Props>(node)) return textOf(node.props.children);
  return "";
}

const byTestId = (tree: ReactNode, testId: string) => elements(tree).find((element) => element.props["data-testid"] === testId || element.props.testId === testId);

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
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
  eventId = event.id;
});

async function register(first: string, last: string, row: Partial<typeof registrations.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const name = `${first} ${last}`;
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
      firstName: first,
      lastName: last,
      displayName: resolveDisplayName({ legalName: name }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      confirmedAt: new Date(),
      bibNumber: serial,
      ...row,
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: role, role }).returning();
  return user;
}

/** One desk row, drawn for `role`, as the desk page draws it. */
async function deskRow(id: string, role: StaffRole) {
  const rows = await listDeskRegistrations(db, { eventId, query: "", locale: state.locale });
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error("no such desk row");
  return DeskRow({ row, locale: state.locale, back: "desk", eventId, q: "pop", minorSigns: { ro: false, en: false }, role });
}

/** The desk's backoffice roles: every one of them works the desk. */
const DESK_ROLES = STAFF_ROLES.filter((role) => role !== "MEMBER");

describe("§975 the desk says an elite's bib, and lets the Administrator change it", () => {
  it("puts «Elită» and «Pe BIB: {label}» beside the name of a marked row, for every desk role, and nothing on an unmarked one", async () => {
    const ana = await register("Ana", "Pop", { elite: true });
    const labelled = await register("Dan", "Pop", { elite: true, eliteBibLabel: "Dan cel Iute" });
    const plain = await register("Ion", "Pop");
    for (const role of DESK_ROLES) {
      const tree = await deskRow(ana, role);
      expect(byTestId(tree, "desk-elite-chip")?.props.label, role).toBe("Elită");
      expect(textOf(byTestId(tree, "desk-elite-label")), role).toBe("Pe BIB: Ana");
      expect(textOf(byTestId(await deskRow(labelled, role), "desk-elite-label")), role).toBe("Pe BIB: Dan cel Iute");
      const unmarked = await deskRow(plain, role);
      expect(byTestId(unmarked, "desk-elite-chip"), role).toBeUndefined();
      expect(byTestId(unmarked, "desk-elite-label"), role).toBeUndefined();
    }
    state.locale = "en";
    expect(textOf(byTestId(await deskRow(ana, "CONTRIBUTOR"), "desk-elite-label"))).toBe("On the bib: Ana");
  });

  it("gives the Administrator «Elită și BIB» on every row — the mark posting the state it wants, the label box while marked — and no other role", async () => {
    const ana = await register("Ana", "Pop", { elite: true, eliteBibLabel: "Ana P." });
    const plain = await register("Ion", "Pop");
    for (const role of ["ADMIN", "SUPERADMIN"] as const) {
      const marked = await deskRow(ana, role);
      const fold = byTestId(marked, "desk-elite-fold");
      expect(fold, role).toBeDefined();
      expect(textOf(elements(fold).find((element) => element.props.component === "summary"))).toContain("Elită și BIB");
      const mark = byTestId(fold, "desk-elite-mark-form");
      expect(mark?.props.action).toBe(actions.setRegistrationEliteAction);
      expect(mark?.props.confirm).toBeUndefined();
      const field = (form: ReactElement<Props> | undefined, name: string) => elements(form).find((element) => element.props.name === name);
      expect(field(mark, "elite")?.props.value).toBe("0");
      expect(field(mark, "back")?.props.value).toBe("desk");
      expect(field(mark, "eventId")?.props.value).toBe(eventId);
      expect(field(mark, "q")?.props.value).toBe("pop");
      expect(textOf(mark)).toContain("Nu mai e elită");
      const label = byTestId(fold, "desk-elite-label-form");
      expect(label?.props.action).toBe(actions.setRegistrationEliteBibLabelAction);
      const box = field(label, "eliteBibLabel");
      expect([box?.props.defaultValue, box?.props.placeholder, box?.props.label]).toEqual(["Ana P.", "Ana", "Eticheta pe BIB"]);
      expect(String(box?.props.helperText)).toContain("Implicit: prenumele");
      // Unmarked: the mark asks for «Elită»; there is no label box to fill until it is one.
      const unmarkedFold = byTestId(await deskRow(plain, role), "desk-elite-fold");
      expect(elements(byTestId(unmarkedFold, "desk-elite-mark-form")).find((element) => element.props.name === "elite")?.props.value).toBe("1");
      expect(textOf(byTestId(unmarkedFold, "desk-elite-mark-form"))).toContain("Marchează ca elită");
      expect(byTestId(unmarkedFold, "desk-elite-label-form")).toBeUndefined();
    }
    for (const role of DESK_ROLES.filter((candidate) => candidate !== "ADMIN" && candidate !== "SUPERADMIN")) {
      expect(byTestId(await deskRow(ana, role), "desk-elite-fold"), role).toBeUndefined();
      expect(byTestId(await deskRow(plain, role), "desk-elite-fold"), role).toBeUndefined();
    }
  });

  it("leaves the row as it was when no role is given, and offers no fold on a race that is over", async () => {
    const ana = await register("Ana", "Pop", { elite: true });
    const rows = await listDeskRegistrations(db, { eventId, query: "", locale: "ro" });
    const row = rows.find((candidate) => candidate.id === ana)!;
    expect(byTestId(await DeskRow({ row, locale: "ro", back: "desk", minorSigns: { ro: false, en: false } }), "desk-elite-fold")).toBeUndefined();
    expect(byTestId(await DeskRow({ row, locale: "ro", back: "desk", minorSigns: { ro: false, en: false }, readOnly: true, role: "ADMIN" }), "desk-elite-fold")).toBeUndefined();
  });
});

describe("§975 «Participanți»: the registrations table in one fold", () => {
  it("folds the table, its pager and the batch verbs together, open on arrival, the results' count on its closed line", async () => {
    state.actor = await staff("ADMIN");
    await register("Ana", "Pop");
    await register("Ion", "Pop");
    const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId }) } as never);
    const fold = byTestId(tree, "registrations-table-fold");
    expect(fold).toBeDefined();
    expect(fold?.props.collapsible).toBe(true);
    expect(fold?.props.openWhen).toEqual({ primary: true });
    expect(fold?.props.glyph).toBe("registrations");
    expect(fold?.props.title).toBe("Participanți");
    const table = elements(fold).find((element) => element.type === AdminTable);
    expect(table).toBeDefined();
    // The closed line says what the table's results line says.
    expect(fold?.props.aside).toBe((table?.props.labels as { results: string }).results);
    expect(String(fold?.props.aside)).toContain("2");
    // The batch form that owns the table's ticks sits in the same fold.
    expect(elements(fold).some((element) => element.props.id === "bulk-cancel")).toBe(true);
    // One table on the page, and it is the fold's.
    expect(elements(tree).filter((element) => element.type === AdminTable)).toHaveLength(1);

    state.locale = "en";
    const english = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({ eventId }) } as never);
    expect(byTestId(english, "registrations-table-fold")?.props.title).toBe("Participants");
  });
});
