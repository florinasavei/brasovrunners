import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace } from "../../helpers/results";

/**
 * «Planul locurilor» (§911), BR-REQ-050-02: the registrations list scoped to one event links to the event's plan under
 * «Locuri», for every role that reads the list (the Organizer too, §289) — and the list over every event has no link,
 * since a plan is one event's. The page's tree is walked as a Server Component's, read without a browser.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, locale: "ro" as "ro" | "en" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg: string | { namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
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
vi.mock("@/i18n/navigation", () => {
  type Href = string | { pathname: string; params?: Record<string, string> };
  const path = (locale: string, href: Href) =>
    typeof href === "string" ? `/${locale}${href}` : `/${locale}${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params?.[key] ?? "")}`;
  return { getPathname: ({ locale, href }: { locale?: string; href: Href }) => path(locale ?? state.locale, href), Link: () => null };
});
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/registrations/actions", () => ({
  addToWaitlistAction: vi.fn(),
  moveReserveEntryAction: vi.fn(),
  addRegistrationNoteFromListAction: vi.fn(),
  resendRegistrationEmailAction: vi.fn(),
  bulkCancelRegistrationsAction: vi.fn(),
  bulkDeleteRegistrationsAction: vi.fn(),
  markBibsPrintedAction: vi.fn(),
  sendOutboxNowAction: vi.fn(),
  setPublicRegistrationOpenAction: vi.fn(),
  cancelRegistrationAction: vi.fn(),
  checkInAction: vi.fn(),
  confirmRegistrationNowAction: vi.fn(),
  editRegistrationAnswersAction: vi.fn(),
  changeRegistrationAddressAction: vi.fn(),
  setClubMemberDeclaredAction: vi.fn(),
  clearMemberTicksAction: vi.fn(),
  deleteRegistrationAction: vi.fn(),
  givePlaceNowAction: vi.fn(),
  offerPlaceAction: vi.fn(),
  setOutsideCapacityAction: vi.fn(),
  setRegistrationEliteAction: vi.fn(),
  promoteRegistrationAction: vi.fn(),
  setBibNumberAction: vi.fn(),
  withdrawConsentAction: vi.fn(),
  declarationHoldAction: vi.fn(),
}));
vi.mock("@/modules/notifications/send-now-choice", () => ({ sendNowChoiceFor: async () => null }));

const { default: AdminRegistrationsPage } = await import("@/app/[locale]/admin/registrations/(list)/page");

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

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.locale = "ro";
});

async function staff(role: "ADMIN" | "MODERATOR"): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@plan.test`, displayName: role, role }).returning();
  return user;
}

async function link(locale: "ro" | "en", query: Record<string, string>) {
  state.locale = locale;
  const tree = await AdminRegistrationsPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(query) } as never);
  return elements(tree).find((element) => element.props["data-testid"] === "race-plan-link");
}

describe("BR-REQ-050-02 the registrations list links to «Planul locurilor» (§911)", () => {
  it("under «Locuri», for one event, for the Administrator and the Organizer alike, in both languages", async () => {
    const race = await createRace(db, { capacity: 20 });
    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = await staff(role);
      const ro = await link("ro", { eventId: race.id });
      expect(ro?.props.href, role).toBe(`/ro/admin/events/${race.id}/locuri`);
      expect(ro?.props.icon).toBe("place");
      expect(ro?.props.children).toBe("Planul locurilor");
      const en = await link("en", { eventId: race.id });
      expect(en?.props.href).toBe(`/en/admin/events/${race.id}/locuri`);
      expect(en?.props.children).toBe("Places plan");
      await db.delete(staffUsers);
    }
  });

  it("is absent from the list over every event", async () => {
    await createRace(db, { capacity: 20 });
    state.actor = await staff("ADMIN");
    expect(await link("ro", { eventId: "all" })).toBeUndefined();
  });
});
