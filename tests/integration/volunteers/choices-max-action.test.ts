import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { STAFF_ROLES, canManageVolunteers, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { decodeFlash, FLASH_COOKIE } from "@/shared/feedback/notice";
import { DomainError } from "@/shared/errors/domain-error";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — «Cel mult câte roluri poate bifa o persoană» on the event editor's «Voluntari» card, through its real Server Action
 * (`setVolunteerChoicesMaxAction`; BR-REQ-050-02, BR-REQ-060-01): the box saves digits, an empty box takes the limit off,
 * anything else is refused back to the card with nothing saved; the action asks for the capability by name at its own door,
 * so a role that may not manage volunteers is refused before the service is reached; and each outcome has its sentence in
 * both catalogues. Next's redirect is caught where the browser would follow it, and the flash cookie held in memory.
 */
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  actor: undefined as unknown,
  redirected: [] as string[],
  cookies: new Map<string, string>(),
  /** The capabilities the action asked its door for, by the predicate's own name. */
  asked: [] as string[],
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name) } : undefined), set: (name: string, value: string) => void state.cookies.set(name, value), delete: (name: string) => void state.cookies.delete(name) }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ locale, href }: { locale: string; href: string | { pathname: string; params?: Record<string, string> } }) =>
    typeof href === "string" ? `/${locale}${href}` : `/${locale}${href.pathname.replace("[id]", href.params?.id ?? "")}`,
  Link: () => null,
}));
/*
  The session, set by the test — and the door's own rule kept as `session.ts` has it: `requireStaffCapability` hands the
  predicate the actor and refuses with FORBIDDEN, so what the action asked for is observable (`state.asked`) and a role
  the predicate refuses never reaches the service through it.
*/
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => {
    state.asked.push("requireStaff");
    return state.actor;
  },
  requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
    state.asked.push(capability.name);
    if (!capability(state.actor)) throw new DomainError("FORBIDDEN", `may not ${capability.name}`);
    return state.actor;
  },
}));
/** The service, watched: a press refused at the action's door never calls it. */
const service = vi.hoisted(() => ({ setVolunteerChoicesMax: vi.fn() }));
vi.mock("@/modules/volunteers/volunteers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/volunteers/volunteers")>();
  service.setVolunteerChoicesMax.mockImplementation(actual.setVolunteerChoicesMax);
  return { ...actual, setVolunteerChoicesMax: service.setVolunteerChoicesMax };
});

const { setVolunteerChoicesMaxAction } = await import("@/app/[locale]/admin/events/[id]/volunteer-actions");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let eventId: string;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

beforeEach(async () => {
  await resetTables(db);
  state.redirected.length = 0;
  state.asked.length = 0;
  state.cookies.clear();
  service.setVolunteerChoicesMax.mockClear();
  admin = await staff("ADMIN");
  state.actor = admin;
  const [event] = await db.insert(events).values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), acceptsVolunteers: true }).returning({ id: events.id });
  eventId = event.id;
});

const limitOf = async () => (await db.select({ max: events.volunteerChoicesMax }).from(events).where(eq(events.id, eventId)))[0].max;
const trail = () => db.select().from(auditLogs).where(and(eq(auditLogs.action, "event.volunteer_choices_max_set"), eq(auditLogs.entityId, eventId))).orderBy(asc(auditLogs.createdAt));

/** One press of the card's form: where the browser is sent, and the toast the flash carries (or none, for a refusal). */
async function press(typed: string | null, event = eventId): Promise<{ to: string; toast: string | null }> {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("eventId", event);
  if (typed !== null) form.set("max", typed);
  state.redirected.length = 0;
  state.cookies.clear();
  await setVolunteerChoicesMaxAction(form).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== "NEXT_REDIRECT") throw error;
  });
  return { to: state.redirected[0] ?? "", toast: decodeFlash(state.cookies.get(FLASH_COOKIE))?.key ?? null };
}

describe("§NNN BR-REQ-050-02 the card's box «Cel mult câte roluri poate bifa o persoană»", () => {
  it("saves the digits typed and comes back to the card with the toast that says so", async () => {
    const card = `/ro/admin/events/${eventId}#box-volunteers`;
    expect(await press("2")).toEqual({ to: card, toast: "volunteerChoicesMaxOn" });
    expect(await limitOf()).toBe(2);
    // Spaces around the digits are a person's typing, not another number.
    expect(await press(" 1 ")).toEqual({ to: card, toast: "volunteerChoicesMaxOn" });
    expect(await limitOf()).toBe(1);
    expect(await press("20")).toEqual({ to: card, toast: "volunteerChoicesMaxOn" });
    expect(await limitOf()).toBe(20);
    expect((await trail()).map((row) => row.metadataJson)).toEqual([
      { from: null, to: 2 },
      { from: 2, to: 1 },
      { from: 1, to: 20 },
    ]);
  });

  it("an empty box takes the limit off, with its own toast — and a box that is not posted at all is an empty one", async () => {
    const card = `/ro/admin/events/${eventId}#box-volunteers`;
    await press("3");
    expect(await press("")).toEqual({ to: card, toast: "volunteerChoicesMaxOff" });
    expect(await limitOf()).toBeNull();
    await press("3");
    expect(await press("   ")).toEqual({ to: card, toast: "volunteerChoicesMaxOff" });
    expect(await limitOf()).toBeNull();
    await press("3");
    expect(await press(null)).toEqual({ to: card, toast: "volunteerChoicesMaxOff" });
    expect(await limitOf()).toBeNull();
  });

  it("says «era deja așa» when the press changes nothing, and writes no second line in the trail", async () => {
    await press("2");
    expect((await press("2")).toast).toBe("volunteerUnchanged");
    await press("");
    expect((await press("")).toast).toBe("volunteerUnchanged");
    expect(await trail()).toHaveLength(2);
  });

  it("refuses what is no limit — nought, twenty-one, three digits, a fraction, a sign, letters — back to the card naming the refusal, nothing saved and no toast", async () => {
    await press("2");
    for (const typed of ["0", "21", "99", "100", "1.5", "1,5", "1e1", "0x2", "-2", "+2", "doi", "2 roluri"]) {
      const answer = await press(typed);
      expect(answer.to, typed).toBe(`/ro/admin/events/${eventId}?volunteerError=VALIDATION_ERROR#box-volunteers`);
      expect(answer.toast, typed).toBeNull();
    }
    expect(await limitOf()).toBe(2);
    expect(await trail()).toHaveLength(1);
  });

  it("answers an event that is not there with the card's own refusal", async () => {
    expect((await press("2", "11111111-1111-4111-8111-111111111111")).to).toContain("volunteerError=NOT_FOUND");
    expect((await press("2", "not-an-id")).to).toContain("volunteerError=NOT_FOUND");
  });
});

describe("§NNN BR-REQ-060-01 the action asserts the capability itself", () => {
  it("asks its door for `canManageVolunteers` by name, on every press", async () => {
    await press("2");
    expect(state.asked).toEqual(["canManageVolunteers"]);
    expect(service.setVolunteerChoicesMax).toHaveBeenCalledTimes(1);
    expect(service.setVolunteerChoicesMax.mock.calls[0][1]).toMatchObject({ id: admin.id, role: "ADMIN" });
  });

  it.each(STAFF_ROLES.filter((role) => !canManageVolunteers(role)).map((role) => [role] as const))("refuses the %s role at the door — the service is never reached, nothing is written, no toast", async (role) => {
    state.actor = await staff(role);
    const answer = await press("2");
    expect(answer.to).toBe(`/ro/admin/events/${eventId}?volunteerError=FORBIDDEN#box-volunteers`);
    expect(answer.toast).toBeNull();
    expect(state.asked).toEqual(["canManageVolunteers"]);
    expect(service.setVolunteerChoicesMax).not.toHaveBeenCalled();
    expect(await limitOf()).toBeNull();
    expect(await trail()).toHaveLength(0);
  });

  it.each(STAFF_ROLES.filter((role) => canManageVolunteers(role)).map((role) => [role] as const))("serves the %s role", async (role) => {
    state.actor = await staff(role);
    expect((await press("2")).toast).toBe("volunteerChoicesMaxOn");
    expect(await limitOf()).toBe(2);
  });
});

describe("§NNN the words of the card's setting", () => {
  it("has each toast, the box's words and the refusal's sentence in both languages", () => {
    for (const catalogue of [ro, en]) {
      for (const key of ["volunteerChoicesMaxOn", "volunteerChoicesMaxOff", "volunteerUnchanged"] as const) expect(catalogue.Feedback.toast[key].length, key).toBeGreaterThan(0);
      for (const key of ["label", "placeholder", "help", "save", "saving"] as const) expect(catalogue.Admin.volunteers.choicesMax[key].length, key).toBeGreaterThan(0);
      // The help says the range through its two numbers, so the words never drift from the rule.
      expect(catalogue.Admin.volunteers.choicesMax.help).toContain("{min}");
      expect(catalogue.Admin.volunteers.choicesMax.help).toContain("{max}");
      expect(catalogue.Admin.errors.VALIDATION_ERROR.length).toBeGreaterThan(0);
      expect(catalogue.Admin.errors.FORBIDDEN.length).toBeGreaterThan(0);
    }
    expect(ro.Admin.volunteers.choicesMax.label).toBe("Cel mult câte roluri poate bifa o persoană");
    expect(ro.Feedback.toast.volunteerChoicesMaxOn).not.toBe(ro.Feedback.toast.volunteerChoicesMaxOff);
  });
});
