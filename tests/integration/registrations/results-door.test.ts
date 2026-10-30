import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02 (§808, amended by §816): the registrations list draws the «Clasament» door with one race chosen when the race is
 * published, before its start too, like the page behind it; a group run, and a race ahead that is not published, get none.
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
vi.mock("@/i18n/navigation", () => ({ getPathname: ({ href }: { href: string | { pathname: string } }) => (typeof href === "string" ? href : href.pathname), Link: () => null }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  // «Adaugă pe lista de așteptare» (§NNN): the list page and the queue panel import it; not under test here.
  addToWaitlistAction: vi.fn(),
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

type Props = Record<string, unknown> & { children?: ReactNode };

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

async function createEvent(title: string, over: Partial<typeof events.$inferInsert>) {
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
      ...over,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `${title}-ro`, title },
    { eventId: event.id, locale: "en", slug: `${title}-en`, title },
  ]);
  return event;
}

async function staff(role: "ADMIN" | "MODERATOR"): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
  return user;
}

async function resultsLink(eventId: string) {
  const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale: "ro" }), searchParams: Promise.resolve({ eventId }) } as never);
  return elements(tree).find((element) => element.props["data-testid"] === "results-link");
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

describe("BR-REQ-050-02: the list's «Clasament» door (§808, §816)", () => {
  it("is drawn for a published race still ahead, and leads to the results page", async () => {
    state.actor = await staff("ADMIN");
    const race = await createEvent("Crosul", {});
    const link = await resultsLink(race.id);
    expect(link).toBeDefined();
    expect(link?.props.icon).toBe("results");
    expect(link?.props.href).toBe("/admin/events/[id]/results");
  });

  it("is drawn for the Organizer too", async () => {
    state.actor = await staff("MODERATOR");
    const race = await createEvent("Crosul", {});
    expect(await resultsLink(race.id)).toBeDefined();
  });

  it("is drawn for a race that has started, whatever its editorial state", async () => {
    state.actor = await staff("ADMIN");
    const past = await createEvent("Crosul trecut", { startsAt: new Date("2020-11-21T08:00:00.000Z"), editorialStatus: "DRAFT", publishedAt: null });
    expect(await resultsLink(past.id)).toBeDefined();
  });

  it("is not drawn for a group run, nor for a race ahead that is not published", async () => {
    state.actor = await staff("ADMIN");
    const run = await createEvent("Alergarea", { type: "GROUP_RUN" });
    const draft = await createEvent("Crosul ciornă", { editorialStatus: "DRAFT", publishedAt: null });
    expect(await resultsLink(run.id)).toBeUndefined();
    expect(await resultsLink(draft.id)).toBeUndefined();
  });
});
