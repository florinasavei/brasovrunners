import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventResults } from "@/db/schema/event-results";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace, person, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §NNN — «Cronometrare»'s Server Actions (BR-REQ-050-02, BR-REQ-060-01): the island's press answers the outcome, the page's state and
 * the server's clock, the same press sent again — its id — as saved, «sign in again» for a session that ended or is another account's
 * than the press's (the entry waits on the phone), `failed` for a press the server could not record, and a refusal — never the page —
 * for a member; the clock's own question; the plain forms come back to the page with the outcome in the address, numbers and codes
 * only; «Start» is whoever enters results', and the organizer's own «Start» heard again within ten seconds changes nothing.
 * The session's door is the real one's shape: no session is UNAUTHENTICATED, a capability not held is FORBIDDEN. The actions read
 * the real clock, so the race started an hour ago.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[] }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", async () => {
  const { DomainError } = await import("@/shared/errors/domain-error");
  const door = async () => {
    if (!state.actor) throw new DomainError("UNAUTHENTICATED", "no staff session");
    return state.actor as { role: string };
  };
  return {
    DEV_STAFF_COOKIE: "dev-staff",
    requireStaff: door,
    requireStaffCapability: async (capability: (subject: unknown) => boolean) => {
      const actor = await door();
      if (!capability(actor)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not`);
      return actor;
    },
  };
});

const { readFinishClockAction, recordFinishFormAction, recordFinishPressAction, setRaceGunAction, undoFinishFormAction, undoFinishPressAction } = await import(
  "@/app/[locale]/admin/checkin/cronometrare/actions"
);

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
let gun: Date;
const staff: Partial<Record<StaffRole, StaffUser>> = {};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  for (const [role, name] of [["ADMIN", "Ana Admin"], ["MODERATOR", "Oana Organizator"], ["CONTRIBUTOR", "Vlad Voluntar"], ["MEMBER", "Membru Club"]] as const) staff[role] = await person(db, role, name);
  gun = new Date(Math.floor((Date.now() - 3_600_000) / 1000) * 1000);
  raceId = (await createRace(db, { startsAt: gun })).id;
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
  await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10" });
  state.actor = staff.CONTRIBUTOR;
  state.redirected.length = 0;
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set("uiLocale", "ro");
  data.set("eventId", raceId);
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}
async function post(action: (form: FormData) => Promise<void>, data: FormData): Promise<string> {
  await action(data).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== "NEXT_REDIRECT") throw error;
  });
  return state.redirected.at(-1) ?? "";
}
const stored = () => db.select().from(eventResults).where(eq(eventResults.eventId, raceId)).orderBy(eventResults.bibNumber);
const page = (query: string) => `/ro/admin/checkin/cronometrare?eventId=${raceId}&${query}`;

describe("§NNN the island's press", () => {
  it("answers the outcome — the claimed moment kept — and the page's state, with who entered the line and the server's clock", async () => {
    const claimed = gun.getTime() + 45 * 60_000 + 12_000;
    const sentAtMs = Date.now();
    const pressId = "4a7e0c1d-2b3f-4c5d-8e9f-0a1b2c3d4e5f";
    const answer = await recordFinishPressAction({ eventId: raceId, staffId: staff.CONTRIBUTOR!.id, bibNumber: 102, claimedAtMs: claimed, pressId });
    expect(answer).toMatchObject({ kind: "answer", outcome: { kind: "recorded", bibNumber: 102, name: "Bia Marin", gunTimeMs: 45 * 60_000 + 12_000, positionOverall: 1, again: false } });
    if (answer.kind !== "answer" || !answer.state) throw new Error("no state");
    expect(answer.state.recent.map((line) => [line.bibNumber, line.by, line.undoUntilMs !== null, line.pressedAgain])).toEqual([[102, "Vlad Voluntar", true, null]]);
    expect(answer.state.gunAtMs).toBe(gun.getTime());
    expect(Math.abs(answer.state.serverNowMs - Date.now())).toBeLessThan(10_000);
    // The server's two instants of the request — its arrival and its answer — for the island to measure the round trip.
    expect(answer.clock.receivedAtMs).toBeGreaterThanOrEqual(sentAtMs);
    expect(answer.clock.answeredAtMs).toBeGreaterThanOrEqual(answer.clock.receivedAtMs);
    expect(answer.clock.answeredAtMs).toBeLessThanOrEqual(Date.now());
    // The same press again — its id — is saved, and so is a press with no id at that second (the guess); another volunteer's is a
    // duplicate naming who stored it.
    expect(await recordFinishPressAction({ eventId: raceId, staffId: staff.CONTRIBUTOR!.id, bibNumber: 102, claimedAtMs: claimed, pressId })).toMatchObject({ outcome: { kind: "recorded", again: true } });
    expect(await recordFinishPressAction({ eventId: raceId, bibNumber: 102, claimedAtMs: claimed })).toMatchObject({ outcome: { kind: "recorded", again: true } });
    state.actor = staff.MODERATOR;
    expect(await recordFinishPressAction({ eventId: raceId, bibNumber: 102, claimedAtMs: claimed + 4000 })).toMatchObject({
      outcome: { kind: "duplicate", bibNumber: 102, gunTimeMs: 45 * 60_000 + 16_000, storedGunTimeMs: 45 * 60_000 + 12_000, storedBy: "Vlad Voluntar" },
    });
    expect(await stored()).toHaveLength(1);
  });

  it("answers a refusal on the entry's line — with the time to write down — never an error, and «sign in again» for a session that ended", async () => {
    const unknown = await recordFinishPressAction({ eventId: raceId, bibNumber: 900, claimedAtMs: null });
    expect(unknown).toMatchObject({ kind: "answer", outcome: { kind: "refused", code: "RESULT_BIB_UNKNOWN", bibNumber: 900 } });
    if (unknown.kind !== "answer" || unknown.outcome.kind !== "refused") throw new Error("not refused");
    expect(unknown.outcome.gunTimeMs).toBeGreaterThanOrEqual(3_600_000);
    expect(unknown.state).not.toBeNull();
    expect(await recordFinishPressAction({ eventId: raceId, bibNumber: -3 })).toMatchObject({ outcome: { kind: "refused", code: "VALIDATION_ERROR", bibNumber: null } });
    state.actor = staff.MEMBER;
    expect(await recordFinishPressAction({ eventId: raceId, bibNumber: 101 })).toMatchObject({ kind: "answer", outcome: { kind: "refused", code: "FORBIDDEN", bibNumber: 101, gunTimeMs: null }, state: null, clock: { receivedAtMs: expect.any(Number) } });
    state.actor = undefined;
    expect(await recordFinishPressAction({ eventId: raceId, bibNumber: 101 })).toEqual({ kind: "session" });
    expect(await stored()).toHaveLength(0);
  });

  it("records a press only under the account that pressed it: another account's session answers «sign in again», nothing written", async () => {
    state.actor = staff.MODERATOR;
    expect(await recordFinishPressAction({ eventId: raceId, staffId: staff.CONTRIBUTOR!.id, bibNumber: 101, claimedAtMs: Date.now() - 2_000 })).toEqual({ kind: "session" });
    expect(await stored()).toHaveLength(0);
    // The Organizer's own press goes.
    expect(await recordFinishPressAction({ eventId: raceId, staffId: staff.MODERATOR!.id, bibNumber: 101 })).toMatchObject({ outcome: { kind: "recorded", bibNumber: 101 } });
    expect((await stored()).map((row) => row.updatedByStaffUserId)).toEqual([staff.MODERATOR!.id]);
  });

  it("answers `failed` — not an error, not a refusal — for a press the server could not record, so the phone tries it again", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const real = state.db;
    state.db = new Proxy(db, { get: (target, name) => (name === "transaction" ? () => Promise.reject(new Error("the connection was lost")) : Reflect.get(target, name)) });
    try {
      expect(await recordFinishPressAction({ eventId: raceId, staffId: staff.CONTRIBUTOR!.id, bibNumber: 101 })).toEqual({ kind: "failed" });
      expect(logged).toHaveBeenCalled();
    } finally {
      state.db = real;
      logged.mockRestore();
    }
    expect(await stored()).toHaveLength(0);
  });

  it("answers the server's clock to the island as it wakes, and «sign in again» for a session that ended", async () => {
    const before = Date.now();
    const answer = await readFinishClockAction();
    expect(answer).toMatchObject({ kind: "clock" });
    if (answer.kind !== "clock") throw new Error("no clock");
    expect(answer.clock.receivedAtMs).toBeGreaterThanOrEqual(before);
    expect(answer.clock.answeredAtMs).toBeGreaterThanOrEqual(answer.clock.receivedAtMs);
    state.actor = staff.MEMBER;
    expect(await readFinishClockAction()).toEqual({ kind: "refused" });
    state.actor = undefined;
    expect(await readFinishClockAction()).toEqual({ kind: "session" });
  });

  it("undoes the viewer's own press and refuses another's, the page's state with each answer", async () => {
    await recordFinishPressAction({ eventId: raceId, bibNumber: 101 });
    const [row] = await stored();
    state.actor = staff.MODERATOR;
    expect(await undoFinishPressAction({ eventId: raceId, resultId: row.id })).toMatchObject({ kind: "answer", outcome: { kind: "refused", code: "RESULT_UNDO_NOT_ALLOWED" } });
    state.actor = staff.CONTRIBUTOR;
    const undone = await undoFinishPressAction({ eventId: raceId, resultId: row.id });
    expect(undone).toMatchObject({ kind: "answer", outcome: { kind: "undone", bibNumber: 101 }, state: { recent: [] } });
    expect(await stored()).toHaveLength(0);
    state.actor = undefined;
    expect(await undoFinishPressAction({ eventId: raceId, resultId: row.id })).toEqual({ kind: "session" });
  });
});

describe("§NNN the plain forms (scripts off)", () => {
  it("come back to the page with what happened: recorded, a duplicate with its time, a refusal with the number and the time", async () => {
    expect(await post(recordFinishFormAction, form({ bib: " 101 " }))).toBe(page("ok=101"));
    state.actor = staff.MODERATOR;
    const duplicate = await post(recordFinishFormAction, form({ bib: "101" }));
    expect(duplicate).toMatch(new RegExp(`^${page("dup=101&t=")}\\d+$`.replace(/\?/g, "\\?")));
    // A runner «Clasament» disqualified: the row stays, and the page is told its state.
    await db.update(eventResults).set({ status: "DSQ", gunTimeMs: null, positionOverall: null, positionSex: null, positionCategory: null }).where(eq(eventResults.bibNumber, 101));
    expect(await post(recordFinishFormAction, form({ bib: "101" }))).toMatch(/&dup=101&t=\d+&s=DSQ$/);
    expect(await post(recordFinishFormAction, form({ bib: "900" }))).toMatch(/&refused=RESULT_BIB_UNKNOWN&bib=900&t=\d+$/);
    expect(await post(recordFinishFormAction, form({ bib: "abc" }))).toBe(page("refused=VALIDATION_ERROR"));
    state.actor = staff.MEMBER;
    expect(await post(recordFinishFormAction, form({ bib: "102" }))).toBe(page("refused=FORBIDDEN&bib=102"));
    expect((await stored()).map((row) => row.bibNumber)).toEqual([101]);
  });

  it("undo one's own press, and refuse another's", async () => {
    await post(recordFinishFormAction, form({ bib: "102" }));
    const [row] = await stored();
    state.actor = staff.MODERATOR;
    expect(await post(undoFinishFormAction, form({ resultId: row.id }))).toBe(page("refused=RESULT_UNDO_NOT_ALLOWED"));
    state.actor = staff.CONTRIBUTOR;
    expect(await post(undoFinishFormAction, form({ resultId: row.id }))).toBe(page("undone=102"));
  });
});

describe("§NNN «Start»", () => {
  const gunOfRace = async () => (await db.select({ at: events.raceGunAt, by: events.raceGunByStaffUserId }).from(events).where(eq(events.id, raceId)))[0];

  it("sets the gun at the tap the island wrote into the form, clears it, and is refused to the desk Volunteer", async () => {
    state.actor = staff.MODERATOR;
    const tap = Date.now() - 1500;
    expect(await post(setRaceGunAction, form({ intent: "start", claimedAtMs: String(tap) }))).toBe(page("gun=set"));
    expect(await gunOfRace()).toEqual({ at: new Date(tap), by: staff.MODERATOR!.id });
    // The same tap sent again — queued behind the first, claiming its own moment —: the gun as it stands, nothing written.
    expect(await post(setRaceGunAction, form({ intent: "start", claimedAtMs: String(Date.now()) }))).toBe(page("gun=repeat"));
    expect(await gunOfRace()).toEqual({ at: new Date(tap), by: staff.MODERATOR!.id });
    expect(await post(setRaceGunAction, form({ intent: "clear" }))).toBe(page("gun=cleared"));
    expect(await post(setRaceGunAction, form({ intent: "clear" }))).toBe(page("gun=unchanged"));
    state.actor = staff.CONTRIBUTOR;
    expect(await post(setRaceGunAction, form({ intent: "start" }))).toBe(page("refused=FORBIDDEN"));
    expect(await gunOfRace()).toEqual({ at: null, by: null });
  });

  it("is fixed once somebody finished", async () => {
    await post(recordFinishFormAction, form({ bib: "101" }));
    state.actor = staff.ADMIN;
    expect(await post(setRaceGunAction, form({ intent: "start" }))).toBe(page("refused=RACE_GUN_FIXED"));
  });
});
