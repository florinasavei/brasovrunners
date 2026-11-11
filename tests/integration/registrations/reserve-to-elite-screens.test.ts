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
 * «Mută pe lista de elită» on the registrations list (§903; BR-REQ-037-05, BR-REQ-060-01), as drawn: on every line of
 * «Lista internă (doar notițe)», with an address or without, the Administrator gets the button — the elite glyph,
 * 44 pixels — behind a question that names the person and says what does not happen; under a line's «Email pentru
 * lista oficială» the same role reads that an elite runner needs no address; back from the move, the panel opens on
 * a link to the editor's elite card. The Organizer keeps the list and gets none of it; Tehnic never reaches the page.
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
  addRegistrationNoteFromListAction: vi.fn(),
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
const { moveReserveEntryToEliteAction } = await import("@/app/[locale]/admin/registrations/reserve-actions");

type Props = Record<string, unknown> & { children?: ReactNode };
type Confirm = { title: string; body: string; confirmLabel: string; email?: unknown };

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

/** Every string drawn under an element, in order. */
function words(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(words).join("");
  return isValidElement<Props>(node) ? words(node.props.children) : "";
}

const byTestId = (nodes: ReactElement<Props>[], id: string) => nodes.filter((element) => element.props["data-testid"] === id);

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
/** Each line's id by the name it shows. */
let lineIds: Map<string, string>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  // A race that takes registrations, months away: the one-press moves onto the official list are drawn too.
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
    })
    .returning();
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId, locale: "ro", slug: "crosul-ro", title: "Crosul" },
    { eventId, locale: "en", slug: "crosul-en", title: "The cross" },
  ]);
  // Two lines: one with an address, one without (the elite runner's usual case).
  const written = await db
    .insert(eventReserveEntries)
    .values([
      { eventId, firstName: "Ana", lastName: "Pop", email: "ana@example.org", note: "a scris pe contact", createdAt: new Date("2026-11-01T10:00:00.000Z") },
      { eventId, firstName: "Ion", lastName: "Ionescu", email: null, note: null, createdAt: new Date("2026-11-02T10:00:00.000Z") },
    ])
    .returning();
  lineIds = new Map(written.map((row) => [`${row.firstName} ${row.lastName}`, row.id]));
});

async function staff(role: StaffRole): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
  return user;
}

async function listPage(searchParams: Record<string, string>) {
  return AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve(searchParams) } as never);
}

/** The internal list's element on the page, and what it draws once called. */
async function reservePanel(searchParams: Record<string, string>) {
  const page = elements(await listPage(searchParams));
  const element = page.find((candidate) => candidate.type === ReserveListPanel);
  if (!element) throw new Error("no internal list on the page");
  return { props: element.props, drawn: elements(await ReserveListPanel(element.props as never)) };
}

/** One line of the list, by the name it shows. */
function lineOf(drawn: ReactElement<Props>[], name: string): ReactElement<Props>[] {
  const line = byTestId(drawn, "reserve-entry").find((element) => words(element).includes(name));
  if (!line) throw new Error(`no line for ${name}`);
  return elements(line);
}

describe("§903 «Mută pe lista de elită» on the internal list, as drawn", () => {
  it("gives the Administrator the button on every line, with an address or without: the elite glyph, 44 pixels, asked first", async () => {
    state.actor = await staff("ADMIN");
    const { props, drawn } = await reservePanel({ eventId });
    expect(props.eliteMoveAction).toBe(moveReserveEntryToEliteAction);

    for (const name of ["Ana Pop", "Ion Ionescu"]) {
      const line = lineOf(drawn, name);
      const [form] = byTestId(line, "reserve-elite-form");
      expect(form?.props.action, name).toBe(moveReserveEntryToEliteAction);
      const [button] = byTestId(line, "reserve-elite");
      expect(button.props).toMatchObject({ icon: "elite", type: "submit", children: "Mută pe lista de elită" });
      expect((button.props.sx as { minHeight: number }).minHeight).toBe(44);
      // The question names the person and says what does not happen; no email is announced, since none is sent.
      const confirm = form.props.confirm as Confirm;
      expect(confirm.title).toBe("Muți pe lista de elită?");
      expect(confirm.body.startsWith(`${name}: nu e o înscriere`)).toBe(true);
      for (const said of ["niciun loc", "niciun email", "nicio declarație în aplicație", "Pe BIB se tipărește numele", "Nota internă nu se păstrează"]) expect(confirm.body).toContain(said);
      expect(confirm.confirmLabel).toBe("Mută pe lista de elită");
      expect(confirm.email).toBeUndefined();
      // The line, and the list's own query so the press comes back to the same list.
      const field = (fieldName: string) => elements(form).find((element) => element.props.name === fieldName)?.props.value;
      expect(field("entryId")).toBe(lineIds.get(name));
      expect(field("listQuery")).toBe(props.listQuery);
      expect(new URLSearchParams(String(field("listQuery"))).get("eventId")).toBe(eventId);
    }
  });

  it("tells the Administrator, under a line's «Email pentru lista oficială», that an elite runner needs no address", async () => {
    state.actor = await staff("ADMIN");
    const { drawn } = await reservePanel({ eventId });
    const line = lineOf(drawn, "Ion Ionescu");
    const [fold] = byTestId(line, "reserve-move-email");
    const [warning] = byTestId(line, "reserve-elite-no-address");
    expect(words(warning)).toBe("Alergător de elită? Nu-i trebuie adresă: „Mută pe lista de elită”.");
    // In sight, beside the address's closed fold rather than inside it (the owner asked for a warning; a closed fold hides one).
    expect(byTestId(elements(fold), "reserve-elite-no-address")).toHaveLength(0);
    // A line with an address has no such box, and no such line.
    expect(byTestId(lineOf(drawn, "Ana Pop"), "reserve-elite-no-address")).toHaveLength(0);
    expect(en.Admin.reserve.eliteNoAddress).toBe("An elite runner? No address needed: “Move to the elite list”.");
  });

  it("opens the panel after the move on a link to the editor's elite card, and only then", async () => {
    state.actor = await staff("ADMIN");
    const after = await reservePanel({ eventId, saved: "reserveMovedToElite" });
    expect(after.props.opened).toBe(true);
    expect(after.props.eliteCardHref).toBe(`/ro/admin/events/${eventId}#bib-elite`);
    const [moved] = byTestId(after.drawn, "reserve-moved-to-elite");
    expect(words(moved)).toContain("Numele e pe lista de elită");
    const [link] = byTestId(after.drawn, "reserve-elite-card");
    expect(link.props).toMatchObject({ icon: "elite", href: `/ro/admin/events/${eventId}#bib-elite`, children: "Deschide lista de elită" });
    expect((link.props.sx as { minHeight: number }).minHeight).toBe(44);

    const before = await reservePanel({ eventId });
    expect(before.props.eliteCardHref).toBeUndefined();
    expect(byTestId(before.drawn, "reserve-moved-to-elite")).toHaveLength(0);
  });

  it("gives the Organizer the list's own verbs and none of the elite move: no button, no form, no line under the address", async () => {
    state.actor = await staff("MODERATOR");
    const { props, drawn } = await reservePanel({ eventId, saved: "reserveMovedToElite" });
    expect(props.eliteMoveAction).toBeUndefined();
    expect(props.eliteCardHref).toBeUndefined();
    expect(byTestId(drawn, "reserve-entry")).toHaveLength(2);
    expect(byTestId(drawn, "reserve-delete-form")).toHaveLength(2);
    for (const id of ["reserve-elite-form", "reserve-elite", "reserve-elite-no-address", "reserve-moved-to-elite", "reserve-elite-card"]) expect(byTestId(drawn, id), id).toHaveLength(0);
  });

  it("is never reached by Tehnic: the page itself is not there", async () => {
    state.actor = await staff("DEV");
    await expect(listPage({ eventId })).rejects.toThrow("NOT_FOUND");
  });
});
