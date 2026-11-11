import { eq } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { events, eventTranslations } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Pe adresa mea, invitat special» on the registrations list (the decision «A line of the internal list on the
 * Administrator's own address, as a special guest»; BR-REQ-037-05, BR-REQ-060-01), as drawn: on every line of «Lista
 * internă (doar notițe)», for the Administrator alone, while the event takes a vouched entry and its «Folosește lista de
 * invitați speciali» is on — a 44-pixel button behind a question that names the Administrator's own address, says where
 * the emails go, that the place is outside the announced ones and not released unsigned, and that the declaration is
 * the person's own, and asks the relay tick as the move does. With the switch off, one sentence says where it is
 * switched on and no button is drawn. The Organizer sees none of it. Made-up people only.
 *
 * The page and the panel are Server Components, so each is called and its element tree walked.
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
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params[key])}`,
  Link: () => null,
}));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  addToWaitlistAction: vi.fn(),
  moveReserveEntryAction: vi.fn(),
  offerPlaceAction: vi.fn(),
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
  promoteRegistrationAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setRegistrationEliteAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
}));
vi.mock("@/app/[locale]/admin/registrations/[id]/actions", () => ({
  resendFamilyEmailAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");
const { default: ReserveListPanel } = await import("@/modules/registrations/ui/ReserveListPanel");
const { moveReserveEntryToOwnAddressAction } = await import("@/app/[locale]/admin/registrations/reserve-actions");

type Props = Record<string, unknown> & { children?: ReactNode };
type Confirm = { title: string; body: string; confirmLabel: string; email?: unknown; tick?: { field: string; label: string } };

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

function words(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(words).join("");
  return isValidElement<Props>(node) ? words(node.props.children) : "";
}

const byTestId = (nodes: ReactElement<Props>[], id: string) => nodes.filter((element) => element.props["data-testid"] === id);

const ADMIN_EMAIL = "admin.club@example.ro";

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  // A race that takes registrations, months away, with the special guests list switched on.
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
      hiddenListEnabled: true,
    })
    .returning();
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: "crosul-ro", title: "Crosul" },
    { eventId, locale: "en", slug: "crosul-en", title: "The cross" },
  ]);
  await db.insert(eventReserveEntries).values([
    { eventId, firstName: "Ana", lastName: "Pop", email: "ana@example.org", note: null, createdAt: new Date("2026-11-01T10:00:00.000Z") },
    { eventId, firstName: "Ilinca", lastName: "Dobre", email: null, note: "invitată de un partener", createdAt: new Date("2026-11-02T10:00:00.000Z") },
  ]);
});

async function staff(role: StaffRole, email = `${role.toLowerCase()}@dev.test`): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email, displayName: role, role }).returning();
  return user;
}

async function reservePanel(searchParams: Record<string, string>) {
  const page = elements(await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(searchParams) } as never));
  const element = page.find((candidate) => candidate.type === ReserveListPanel);
  if (!element) throw new Error("no internal list on the page");
  return { props: element.props, drawn: elements(await ReserveListPanel(element.props as never)) };
}

function lineOf(drawn: ReactElement<Props>[], name: string): ReactElement<Props>[] {
  const line = byTestId(drawn, "reserve-entry").find((element) => words(element).includes(name));
  if (!line) throw new Error(`no line for ${name}`);
  return elements(line);
}

describe("«Pe adresa mea, invitat special» on the internal list, as drawn", () => {
  it("gives the Administrator the press on every line, 44 pixels, asked first: the own address, the emails, the place, the declaration and the relay tick", async () => {
    state.actor = await staff("ADMIN", ADMIN_EMAIL);
    const { props, drawn } = await reservePanel({ eventId });
    expect(props.ownAddressAction).toBe(moveReserveEntryToOwnAddressAction);
    expect(props.ownAddressSwitchOff).toBe(false);

    for (const name of ["Ana Pop", "Ilinca Dobre"]) {
      const line = lineOf(drawn, name);
      const [form] = byTestId(line, "reserve-own-address-form");
      expect(form?.props.action, name).toBe(moveReserveEntryToOwnAddressAction);
      const [button] = byTestId(line, "reserve-own-address");
      expect(button.props).toMatchObject({ icon: "hiddenList", type: "submit", children: "Pe adresa mea, invitat special" });
      expect((button.props.sx as { minHeight: number }).minHeight).toBe(44);
      const confirm = form.props.confirm as Confirm;
      expect(confirm.title).toBe("Înscrii persoana pe adresa ta, ca invitat special?");
      expect(confirm.body).toContain(`${name} se înscrie pe adresa ta, ${ADMIN_EMAIL}: toate emailurile înscrierii vin la tine.`);
      for (const said of ["«Lista de invitați speciali»", "nu ia niciunul dintre locurile anunțate", "nu se eliberează înainte de start", "Declarația e a persoanei", "pe hârtie la start"]) {
        expect(confirm.body, said).toContain(said);
      }
      expect(confirm.confirmLabel).toBe("Pe adresa mea, invitat special");
      // The same relay tick the move asks, by the same mechanism; the declaration's email announced before the press.
      expect(confirm.tick).toEqual({ field: "relayedByParticipantRequest", label: ro.Admin.registrations.relayConfirmation });
      expect(confirm.email).toBeDefined();
      // The form posts the line, the tick and the list's query — and no address: the server reads the account's.
      const names = elements(form).map((element) => element.props.name).filter(Boolean);
      expect(names).toEqual(expect.arrayContaining(["uiLocale", "entryId", "listQuery", "relayedByParticipantRequest"]));
      expect(names).not.toContain("email");
      expect(byTestId(line, "reserve-own-address-off")).toHaveLength(0);
    }
    // Under the missing address, the pointer beside the elite one; a line with an address needs none.
    const [pointer] = byTestId(lineOf(drawn, "Ilinca Dobre"), "reserve-own-address-pointer");
    expect(words(pointer)).toBe(ro.Admin.reserve.ownAddressNoAddress);
    expect(byTestId(lineOf(drawn, "Ana Pop"), "reserve-own-address-pointer")).toHaveLength(0);
  });

  it("with the event's switch off, says in one sentence where it is switched on, and draws no press", async () => {
    await db.update(events).set({ hiddenListEnabled: false }).where(eq(events.id, eventId));
    state.actor = await staff("ADMIN", ADMIN_EMAIL);
    const { props, drawn } = await reservePanel({ eventId });
    expect(props.ownAddressAction).toBeUndefined();
    expect(props.ownAddressSwitchOff).toBe(true);
    expect(byTestId(drawn, "reserve-own-address-form")).toHaveLength(0);
    expect(byTestId(drawn, "reserve-own-address")).toHaveLength(0);
    const sentences = byTestId(drawn, "reserve-own-address-off");
    expect(sentences).toHaveLength(2);
    expect(words(sentences[0])).toBe(ro.Admin.reserve.ownAddressSwitchOff);
    expect(words(sentences[0])).toContain("«Folosește lista de invitați speciali»");
    expect(en.Admin.reserve.ownAddressSwitchOff).toContain("«Use the special guests list»");
  });

  it("draws nothing of it after the start", async () => {
    await db.update(events).set({ startsAt: new Date("2020-01-01T08:00:00.000Z") }).where(eq(events.id, eventId));
    state.actor = await staff("ADMIN", ADMIN_EMAIL);
    const { props, drawn } = await reservePanel({ eventId });
    expect(props.ownAddressAction).toBeUndefined();
    expect(props.ownAddressSwitchOff).toBe(false);
    for (const id of ["reserve-own-address-form", "reserve-own-address", "reserve-own-address-off", "reserve-own-address-pointer"]) expect(byTestId(drawn, id), id).toHaveLength(0);
  });

  it("gives the Organizer none of it: no press, no sentence, no pointer — the list's own verbs only", async () => {
    state.actor = await staff("MODERATOR");
    const { props, drawn } = await reservePanel({ eventId });
    expect(props.ownAddressAction).toBeUndefined();
    expect(props.ownAddressEmail).toBeUndefined();
    expect(props.ownAddressSwitchOff).toBe(false);
    expect(byTestId(drawn, "reserve-entry")).toHaveLength(2);
    for (const id of ["reserve-own-address-form", "reserve-own-address", "reserve-own-address-off", "reserve-own-address-pointer"]) expect(byTestId(drawn, id), id).toHaveLength(0);
  });

  it("opens the panel on the way back, the toast's words in both languages saying what to do next", async () => {
    state.actor = await staff("ADMIN", ADMIN_EMAIL);
    const { props } = await reservePanel({ eventId, saved: "reserveOwnAddressGuest" });
    expect(props.opened).toBe(true);
    for (const toast of [ro.Feedback.toast.reserveOwnAddressGuest, en.Feedback.toast.reserveOwnAddressGuest]) {
      expect(toast.length).toBeLessThanOrEqual(200);
      expect(toast).not.toMatch(/\{/);
    }
    expect(ro.Feedback.toast.reserveOwnAddressGuest).toContain("pe hârtie la start");
  });
});
