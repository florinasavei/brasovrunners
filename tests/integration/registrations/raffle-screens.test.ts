import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
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
 * §949 (the owner, 2026-11-16: «o bifă importantă, și coloană peste tot de „participă la tombolă" și o setare per eveniment
 * cum ar fi „avem tombolă" dar doar în backoffice vizibil») — «Tombolă» on the registrations list. With one event chosen that
 * holds a raffle, each row says whether its registration is on the raffle's list: the Administrator's cell is the house's
 * one-press tick, a plain form posting the state it wants and coming back to the row — for the Organizer too. An event that
 * holds none, and the list across every event, draw no such column. What is shown is a courtesy (BR-REQ-060-01): the action and
 * the service refuse every other role again (`raffle-mark.test.ts`).
 *
 * The page is a Server Component, so it is called and its element tree walked — `ambassador-screens.test.ts`'s harness.
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
const actions = await import("@/app/[locale]/admin/registrations/actions");

type Props = Record<string, unknown> & { children?: ReactNode };
type Column = { key: string; label: string; hint?: string; render: (row: unknown) => ReactNode };

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

const columnOf = (tree: ReactNode, key: string) => (tableOf(tree)?.props.columns as Column[]).find((candidate) => candidate.key === key);

/** The «Tombolă» cell of one row, walked. */
function raffleCellOf(tree: ReactNode, id: string): ReactElement<Props>[] {
  const row = (tableOf(tree)?.props.rows as { id: string }[]).find((candidate) => candidate.id === id);
  const column = columnOf(tree, "raffle");
  return row && column ? elements(column.render(row)) : [];
}
const field = (nodes: ReactElement<Props>[], name: string) => nodes.find((element) => element.props.name === name)?.props.value;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

describe("§949 «Tombolă» on the registrations list", () => {
  it("draws the column only for one chosen event that holds a raffle", async () => {
    const race = await createRace();
    await register(race.id);
    state.actor = await staff("ADMIN");
    // No raffle on the event: no column.
    expect(columnOf(await listPage({ eventId: race.id }), "raffle")).toBeUndefined();

    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, race.id));
    const column = columnOf(await listPage({ eventId: race.id }), "raffle");
    expect(column).toMatchObject({ label: "Tombolă", hint: ro.Admin.registrations.raffle.columnHint });
    // Across every event the rows are several events': no column.
    expect(columnOf(await listPage({ eventId: "all" }), "raffle")).toBeUndefined();
  });

  it("gives whoever reads the list a one-press tick on each row, posting the other state and coming back to the row", async () => {
    const race = await createRace();
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, race.id));
    const inId = await register(race.id);
    const outId = await register(race.id, { inRaffle: false });
    state.actor = await staff("ADMIN");
    const tree = await listPage({ eventId: race.id });

    const ticked = raffleCellOf(tree, inId);
    const form = ticked.find((element) => element.props["data-testid"] === "registration-raffle-form");
    expect(form?.props.action).toBe(actions.setRegistrationRaffleAction);
    expect(field(ticked, "registrationId")).toBe(inId);
    expect(field(ticked, "uiLocale")).toBe("ro");
    // On the list, in: the press takes the person out. The way back is the list as it stands.
    expect(field(ticked, "inRaffle")).toBe("0");
    expect(String(field(ticked, "listQuery"))).toContain(`eventId=${race.id}`);
    const tick = ticked.find((element) => element.props["data-testid"] === "registration-raffle-tick");
    expect(tick?.props.checked).toBe(true);
    expect(tick?.props["aria-label"]).toMatch(/^Scoate de la tombolă: Runner \d+$/);

    const unticked = raffleCellOf(tree, outId);
    expect(field(unticked, "inRaffle")).toBe("1");
    const empty = unticked.find((element) => element.props["data-testid"] === "registration-raffle-tick");
    expect(empty?.props.checked).toBe(false);
    expect(empty?.props["aria-label"]).toMatch(/^Pune la tombolă: Runner \d+$/);
  });

  it("gives the Organizer the same tick: who reads the list may press it", async () => {
    const race = await createRace();
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, race.id));
    const inId = await register(race.id);
    const outId = await register(race.id, { inRaffle: false });
    state.actor = await staff("MODERATOR");
    const tree = await listPage({ eventId: race.id });

    for (const [id, posted, checked] of [
      [inId, "0", true],
      [outId, "1", false],
    ] as const) {
      const cell = raffleCellOf(tree, id);
      expect(cell.find((element) => element.props["data-testid"] === "registration-raffle-form")?.props.action).toBe(actions.setRegistrationRaffleAction);
      expect(field(cell, "inRaffle")).toBe(posted);
      expect(cell.find((element) => element.props["data-testid"] === "registration-raffle-tick")?.props.checked).toBe(checked);
    }
  });

  it("speaks English on the English page", async () => {
    const race = await createRace();
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, race.id));
    const id = await register(race.id);
    state.actor = await staff("ADMIN");
    state.locale = "en";
    const tree = await listPage({ eventId: race.id });
    expect(columnOf(tree, "raffle")).toMatchObject({ label: "Raffle", hint: en.Admin.registrations.raffle.columnHint });
    expect(raffleCellOf(tree, id).find((element) => element.props["data-testid"] === "registration-raffle-tick")?.props["aria-label"]).toMatch(/^Take out of the raffle: Runner \d+$/);
  });
});

/** A toolbar link of the list by its test id: the house's `GlyphButton`, its href and words as the page hands them over. */
const buttonOf = (tree: ReactNode, testId: string) => elements(tree).find((element) => element.props["data-testid"] === testId);

describe("§NNN «Lista pentru tombolă — doar prezenții» on the registrations list's toolbar", () => {
  it("stands beside the whole file, under the same condition — one event chosen, a role that takes the file — linking to `?present=1`", async () => {
    const race = await createRace();
    await register(race.id);
    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = await staff(role);
      const tree = await listPage({ eventId: race.id });
      const whole = buttonOf(tree, "registrations-raffle-list");
      const present = buttonOf(tree, "registrations-raffle-present");
      expect(whole?.props.href, role).toBe(`/api/admin/events/${race.id}/raffle?lang=ro`);
      expect(present?.props.href, role).toBe(`/api/admin/events/${race.id}/raffle?present=1&lang=ro`);
      expect(present?.props.children, role).toBe("Lista pentru tombolă — doar prezenții (CSV)");
      // Its accessible name begins with the words it shows, and says who is in the file.
      expect(String(present?.props["aria-label"]).toLowerCase(), role).toContain("lista pentru tombolă — doar prezenții");
      expect(present?.props["aria-label"], role).toBe(ro.Admin.registrations.raffle.presentButtonLabel);
      // The house's 44-pixel target, as every toolbar link.
      expect(present?.props.sx, role).toEqual(whole?.props.sx);
      // Right after the whole file: the two raffle files side by side.
      const order = elements(tree).map((element) => element.props["data-testid"]);
      expect(order.indexOf("registrations-raffle-present"), role).toBe(order.indexOf("registrations-raffle-list") + 1);
    }
    // Whether or not the event holds a raffle, as the whole file's link: the file is the club's to take.
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, race.id));
    expect(buttonOf(await listPage({ eventId: race.id }), "registrations-raffle-present")).toBeDefined();
  });

  it("is drawn for no list across every event — neither file is", async () => {
    const race = await createRace();
    await register(race.id);
    state.actor = await staff("ADMIN");
    const tree = await listPage({ eventId: "all" });
    expect(buttonOf(tree, "registrations-raffle-list")).toBeUndefined();
    expect(buttonOf(tree, "registrations-raffle-present")).toBeUndefined();
  });

  it("speaks English on the English page", async () => {
    const race = await createRace();
    await register(race.id);
    state.actor = await staff("ADMIN");
    state.locale = "en";
    const present = buttonOf(await listPage({ eventId: race.id }), "registrations-raffle-present");
    expect(present?.props.href).toBe(`/api/admin/events/${race.id}/raffle?present=1&lang=en`);
    expect(present?.props.children).toBe("Raffle list — present only (CSV)");
    expect(present?.props["aria-label"]).toBe(en.Admin.registrations.raffle.presentButtonLabel);
  });
});

describe("§NNN «Tombolă» beside each person: whether they take part, and why not, under the organizers' tick", () => {
  /** The few words under a row's tick — «Da», or «Nu · <de ce>» — and whether they say in: the note as the cell hands it over. */
  const standingOf = (tree: ReactNode, id: string) => {
    const note = raffleCellOf(tree, id).find((element) => "takesPart" in element.props && "words" in element.props);
    return note ? { words: note.props.words, in: note.props.takesPart === true ? "1" : "0" } : undefined;
  };

  it("says Da or Nu with the reason by the one answer, «Din oficiu» and «Cu înscriere separată», and keeps the tick beside it", async () => {
    const race = await createRace();
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, race.id));
    const ana = await register(race.id, { bibNumber: 1 });
    const out = await register(race.id, { bibNumber: 2, inRaffle: false });
    const numberless = await register(race.id);
    const waiting = await register(race.id, { status: "WAITLISTED", waitlistedAt: new Date() });
    state.actor = await staff("MODERATOR");

    let tree = await listPage({ eventId: race.id });
    expect(standingOf(tree, ana)).toEqual({ words: "Da", in: "1" });
    expect(standingOf(tree, out)).toEqual({ words: "Nu · scos de organizatori", in: "0" });
    expect(standingOf(tree, numberless)).toEqual({ words: "Nu · fără număr", in: "0" });
    expect(standingOf(tree, waiting)).toEqual({ words: "Nu · neconfirmat", in: "0" });
    // The organizers' tick is still the cell's: the exclusion is theirs in both modes.
    expect(raffleCellOf(tree, ana).find((element) => element.props["data-testid"] === "registration-raffle-tick")?.props.checked).toBe(true);

    // «Cu înscriere separată»: nobody signed up yet, so the runner with a number does not take part — and says why.
    await db.update(events).set({ raffleSignUp: true }).where(eq(events.id, race.id));
    tree = await listPage({ eventId: race.id });
    expect(standingOf(tree, ana)).toEqual({ words: "Nu · nu s-a înscris", in: "0" });
    // «Alergătorii» unticked: the group first.
    await db.update(events).set({ raffleRunners: false }).where(eq(events.id, race.id));
    expect(standingOf(await listPage({ eventId: race.id }), ana)).toEqual({ words: "Nu · grupa nu e bifată", in: "0" });
  });

  it("is drawn with the column alone — no raffle, no note — and speaks English", async () => {
    const race = await createRace();
    const ana = await register(race.id, { bibNumber: 1 });
    state.actor = await staff("ADMIN");
    expect(standingOf(await listPage({ eventId: race.id }), ana)).toBeUndefined();
    await db.update(events).set({ hasRaffle: true, raffleSignUp: true }).where(eq(events.id, race.id));
    state.locale = "en";
    expect(standingOf(await listPage({ eventId: race.id }), ana)).toEqual({ words: "No · did not sign up", in: "0" });
  });
});
