import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01, BR-REQ-070-01, `DECISIONS.md` §NNN — the owner, 2026-11-12: «Mă disperă în general că atunci când fac un
 * edit gen „aleg partenerul” și navighezi». A press on a row of the registrations list — «Retrimite», check-in, «Anulează»,
 * and the rest of the row's verbs — comes back to that row of the same list, through the real actions on a real database:
 * the form carries the list's query (`listQuery`), the path is rebuilt, the toast says the outcome. Pressed from the
 * registration's own page (no `listQuery`) each one returns where it always did. A refusal lands on the list's alert.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, flashed: [] as unknown[] }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  requireStaff: async () => state.actor,
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    if (!capability(state.actor)) throw new DomainError("FORBIDDEN", "no");
    return state.actor;
  },
}));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string | { pathname: string; params?: Record<string, string> } }) =>
    typeof href === "string" ? `/ro${href}` : `/ro${href.pathname.replace(/\[(\w+)\]/g, (_, key: string) => href.params?.[key] ?? "")}`,
}));
vi.mock("@/shared/feedback/flash", () => ({
  flashOutcome: async (outcome: unknown) => {
    state.flashed.push(outcome);
  },
  flash: async (outcome: unknown) => {
    state.flashed.push(outcome);
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: () => undefined,
}));

const { cancelRegistrationFromRowAction, checkInAction, setBibPrintedAction } = await import("@/app/[locale]/admin/registrations/actions");
const { resendRegistrationEmailAction } = await import("@/app/[locale]/admin/registrations/[id]/actions");

let db: TestDatabase;
let close: () => Promise<void>;
let registrationId: string;
let eventId: string;

const LIST = "/ro/admin/registrations";
const listQuery = () => `eventId=${eventId}&sort=name&dir=asc&page=2&saved=old`;

async function staff(role: StaffRole): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: `Tester ${role}`, role }).returning();
  return user;
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries({ uiLocale: "ro", registrationId, ...fields })) data.set(name, value);
  return data;
};

/** The address the action redirected to. */
async function redirectedTo(pressed: Promise<unknown>): Promise<URL> {
  try {
    await pressed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT ")) return new URL(message.slice("REDIRECT ".length), "https://example.test");
    throw error;
  }
  throw new Error("the action returned a state instead of redirecting");
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  state.flashed = [];
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50, editorialStatus: "PUBLISHED", publishedAt: new Date("2026-09-01T10:00:00.000Z") })
    .returning();
  eventId = event.id;
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "crosul-ro", title: "Crosul" },
    { eventId: event.id, locale: "en", slug: "crosul-en", title: "The cross" },
  ]);
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: "ana@example.org", normalizedEmail: "ana@example.org", canonicalEmail: "ana@example.org", canonicalizationVersion: 2, defaultName: "Ana Test", preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId: event.id,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: "Ana Test",
      displayName: resolveDisplayName({ legalName: "Ana Test" }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date(),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      emailConfirmedAt: new Date(),
      confirmedAt: new Date(),
      bibNumber: 7,
    })
    .returning({ id: registrations.id });
  registrationId = created.id;
});

/** On the list, on the row, the list's own query kept and the older outcome gone. */
function expectBackOnTheRow(to: URL, saved: string) {
  expect(to.pathname).toBe(LIST);
  expect(to.hash).toBe(`#reg-${registrationId}`);
  expect(Object.fromEntries(to.searchParams)).toMatchObject({ eventId, sort: "name", dir: "asc", page: "2", saved });
}

describe("§NNN a press on a row of the list comes back to that row", () => {
  it("«Retrimite»: to the row with the toast, from the list; to the registration's page, from that page", async () => {
    state.actor = await staff("ADMIN");
    const fromList = await redirectedTo(resendRegistrationEmailAction(null, form({ listQuery: listQuery() })));
    expectBackOnTheRow(fromList, "resent");
    expect(state.flashed).toEqual([{ saved: "resent" }]);

    const fromPage = await redirectedTo(resendRegistrationEmailAction(null, form({})));
    expect(fromPage.pathname).toBe(`${LIST}/${registrationId}`);
    expect(fromPage.searchParams.get("resent")).toBe("1");
    expect(fromPage.hash).toBe("#admin-alert");
  });

  it("«Retrimite» refused — the Organizer's press — lands on the list's alert with the refusal, and no toast", async () => {
    state.actor = await staff("MODERATOR");
    const to = await redirectedTo(resendRegistrationEmailAction(null, form({ listQuery: listQuery() })));
    expect(to.pathname).toBe(LIST);
    expect(to.hash).toBe("#admin-alert");
    expect(to.searchParams.get("error")).toBe("FORBIDDEN");
    expect(to.searchParams.get("saved")).toBeNull();
    expect(state.flashed).toEqual([]);
  });

  it("the desk's verbs — check-in and the printing mark — pressed from the list's «⋮»", async () => {
    state.actor = await staff("ADMIN");
    expectBackOnTheRow(await redirectedTo(checkInAction(null, form({ direction: "in", listQuery: listQuery() }))), "checkedIn");
    expect((await db.select().from(registrations).where(eq(registrations.id, registrationId)))[0].checkedInAt).not.toBeNull();
    expectBackOnTheRow(await redirectedTo(setBibPrintedAction(form({ printed: "1", listQuery: listQuery() }))), "bibsPrinted");

    // From the registration's own page: that page, as before.
    const fromPage = await redirectedTo(checkInAction(null, form({ direction: "undo" })));
    expect(fromPage.pathname).toBe(`${LIST}/${registrationId}`);
    expect(fromPage.hash).toBe("#admin-alert");
  });

  it("«Anulează» from the list's «⋮»: the row stays in view, now cancelled", async () => {
    state.actor = await staff("ADMIN");
    const to = await redirectedTo(cancelRegistrationFromRowAction(null, form({ reason: "nu mai vine", listQuery: listQuery() })));
    expectBackOnTheRow(to, "registrationCancelled");
    expect((await db.select().from(registrations).where(eq(registrations.id, registrationId)))[0].status).toBe("CANCELLED");
  });
});
