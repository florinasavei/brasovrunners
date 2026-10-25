import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventResults } from "@/db/schema/event-results";
import type { StaffUser } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { withClientWords } from "../../helpers/client-words";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace, person, RACE_STARTS_AT, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §NNN — «Sosire», the finish line (BR-REQ-050-02, BR-REQ-060-01): `recordFinish` stamps the time since the gun on a confirmed runner's
 * number, re-ranks, audits without a name and refuses what «Clasament» must handle (an unknown number with the time to write down, a
 * number already finished, a press before the gun, a group run, a role that may not); and the page as the server draws it, in both
 * languages — the clock, the box, the sentence after a press, «Ultimii sosiți» latest first.
 */
const messages = { ro, en };
let language: "ro" | "en" = "ro";
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));
const revalidate = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()), revalidatePublicContent: revalidate }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("@/app/[locale]/admin/events/[id]/results/actions", () => ({ recordFinishAction: async () => null }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getLocale: async () => language,
  getMessages: async () => messages[language],
  getTranslations: async (arg?: string | { locale?: "ro" | "en"; namespace: string }) => {
    const locale = typeof arg === "object" && arg.locale ? arg.locale : language;
    const namespace = typeof arg === "string" ? arg : arg?.namespace;
    return createTranslator({ locale, messages: messages[locale] as never, namespace: namespace as never });
  },
}));

const { default: FinishPage } = await import("@/app/[locale]/admin/events/[id]/results/sosire/page");
const { FinishError, gunOf, readFinishPage, recordFinish, saveEventResults } = await import("@/modules/results/results");

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
const GUN = RACE_STARTS_AT;
const at = (minutes: number, seconds = 0) => new Date(GUN.getTime() + minutes * 60_000 + seconds * 1000);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  language = "ro";
  revalidate.mockClear();
  for (const [role, name] of [["ADMIN", "Ana Admin"], ["MODERATOR", "Oana Organizator"], ["DEV", "Tudor Tehnic"], ["CONTRIBUTOR", "Vlad Voluntar"], ["COPYWRITER", "Radu Redactor"], ["MEMBER", "Membru Club"]] as const) staff[role] = await person(db, role, name);
  raceId = (await createRace(db)).id;
  state.actor = staff.ADMIN;
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
  await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10" });
  await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103, sex: "MALE", birthDate: "1996-11-21" });
});

const finish = (bib: number, now: Date, actor: StaffUser = staff.ADMIN!) => recordFinish(db, actor, { eventId: raceId, bibNumber: bib }, now);
const stored = () => db.select().from(eventResults).where(eq(eventResults.eventId, raceId)).orderBy(eventResults.bibNumber);
const trail = async () => (await db.select().from(auditLogs).where(eq(auditLogs.entityId, raceId)).orderBy(auditLogs.createdAt, auditLogs.id)).filter((row) => row.action.startsWith("event_result."));

async function render(id = raceId, locale: "ro" | "en" = language, search: { ok?: string; finishError?: string } = {}, now = at(50)) {
  language = locale;
  const element = await atTheClock(now, () => FinishPage({ params: Promise.resolve({ locale, id }), searchParams: Promise.resolve(search) }));
  return renderToStaticMarkup(withClientWords(element, locale));
}
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("§NNN recordFinish — the time since the gun, stamped", () => {
  it("writes «Sosit» with the time since the gun, ranks, audits the number and the times and never a name, and tells the public cache", async () => {
    const first = await finish(102, at(45, 12));
    expect(first).toEqual({ bibNumber: 102, name: "Bia Marin", gunTimeMs: 45 * 60_000 + 12_000, positionOverall: 1 });
    const second = await finish(101, at(50));
    expect(second).toMatchObject({ bibNumber: 101, gunTimeMs: 50 * 60_000, positionOverall: 2 });
    expect((await stored()).map((row) => [row.bibNumber, row.status, row.gunTimeMs, row.positionOverall, row.positionSex, row.categoryKey])).toEqual([
      [101, "FINISHED", 3_000_000, 2, 2, "FEMALE:from30"],
      [102, "FINISHED", 2_712_000, 1, 1, "FEMALE:from40"],
    ]);
    const rows = await trail();
    expect(rows.map((row) => row.action)).toEqual(["event_result.created", "event_result.created"]);
    expect(rows[0].metadataJson).toEqual({ bibNumber: 102, status: "FINISHED", gunTimeMs: 2_712_000, chipTimeMs: null, finishLine: true });
    expect(JSON.stringify(rows.map((row) => row.metadataJson))).not.toContain("Marin");
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it("counts from the race's own gun when the club stated one, else from the event's start", async () => {
    expect(gunOf({ startsAt: GUN, raceStartsAt: null })).toEqual(GUN);
    const later = new Date(GUN.getTime() + 3_600_000);
    expect(gunOf({ startsAt: GUN, raceStartsAt: later })).toEqual(later);
    const withGun = await createRace(db, { raceStartsAt: later });
    await registerRunner(db, withGun.id, { name: "Eli Vasile", bibNumber: 7, sex: "MALE", birthDate: "1990-01-01" });
    // Fifty minutes after the gathering is ten minutes before the gun: refused; thirty minutes after the gun is a 30:00.
    await expect(recordFinish(db, staff.ADMIN!, { eventId: withGun.id, bibNumber: 7 }, at(50))).rejects.toMatchObject({ code: "RESULT_FINISH_NOT_STARTED" });
    expect((await recordFinish(db, staff.ADMIN!, { eventId: withGun.id, bibNumber: 7 }, new Date(later.getTime() + 30 * 60_000))).gunTimeMs).toBe(30 * 60_000);
  });

  it("refuses an unknown or unconfirmed number carrying the stamped time, a number already finished carrying the stored time, and a press before the gun", async () => {
    const unknown = await finish(900, at(42, 13)).catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(FinishError);
    expect(unknown).toMatchObject({ code: "RESULT_BIB_UNKNOWN", bibNumber: 900, gunTimeMs: 42 * 60_000 + 13_000, fields: ["bib"] });
    await registerRunner(db, raceId, { name: "Cancelled Runner", bibNumber: 104, sex: "MALE", birthDate: "1990-01-01", status: "CANCELLED" });
    await expect(finish(104, at(43))).rejects.toMatchObject({ code: "RESULT_BIB_UNKNOWN", bibNumber: 104 });

    await finish(102, at(45, 12));
    const again = await finish(102, at(46)).catch((error: unknown) => error);
    expect(again).toMatchObject({ code: "RESULT_ALREADY_FINISHED", bibNumber: 102, gunTimeMs: 45 * 60_000 + 12_000 });

    await expect(finish(101, new Date(GUN.getTime() - 1000))).rejects.toMatchObject({ code: "RESULT_FINISH_NOT_STARTED" });
    await expect(finish(101, GUN)).rejects.toMatchObject({ code: "RESULT_FINISH_NOT_STARTED" });
    await expect(finish(0, at(1))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // A day after the gun the line is closed: the times are «Clasament»'s to type, and a 25-hour time would not fit the column anyway.
    await expect(finish(103, new Date(GUN.getTime() + 25 * 3_600_000))).rejects.toMatchObject({ code: "RESULT_FINISH_CLOSED" });
    // Stamped to the second: the half second of the press is dropped, and a press within the first second reads 0:00:01.
    expect((await finish(103, new Date(at(40, 7).getTime() + 500))).gunTimeMs).toBe(40 * 60_000 + 7_000);
    expect((await stored()).map((row) => row.bibNumber)).toEqual([102, 103]);
  });

  it("turns a runner written off by mistake into «Sosit» at the stamped time, keeping the note, and audits the change", async () => {
    await saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows: [{ key: "r[101]", bib: "101", name: "", sex: "", birthDate: "", time: "", status: "DNF", chip: "", note: "a renunțat la km 5", agreed: "" }] }, at(30));
    const recorded = await finish(101, at(55));
    expect(recorded).toMatchObject({ bibNumber: 101, gunTimeMs: 55 * 60_000, positionOverall: 1 });
    const [row] = await stored();
    expect(row).toMatchObject({ bibNumber: 101, status: "FINISHED", gunTimeMs: 55 * 60_000, note: "a renunțat la km 5" });
    expect((await trail()).at(-1)).toMatchObject({ action: "event_result.updated", metadataJson: { bibNumber: 101, status: "FINISHED", gunTimeMs: 55 * 60_000, chipTimeMs: null, changed: ["time", "status"], finishLine: true } });
  });

  it("is open to whoever enters results and refused to everyone else, and refused on an event that is not a race", async () => {
    await expect(finish(103, at(40), staff.MODERATOR)).resolves.toMatchObject({ bibNumber: 103 });
    for (const role of ["DEV", "CONTRIBUTOR", "COPYWRITER", "MEMBER"] as const) await expect(finish(101, at(41), staff[role]), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    const run = await createRace(db, { type: "GROUP_RUN" });
    await expect(recordFinish(db, staff.ADMIN!, { eventId: run.id, bibNumber: 1 }, at(40))).rejects.toMatchObject({ code: "RESULTS_NOT_OPEN" });
    await expect(recordFinish(db, staff.ADMIN!, { eventId: "not-an-id", bibNumber: 1 }, at(40))).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const role of ["DEV", "CONTRIBUTOR"] as const) await expect(readFinishPage(db, staff[role]!, raceId, 5)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists the latest finishers first, with the live overall place, and counts the finished and the numbered", async () => {
    await finish(102, at(45));
    await finish(101, at(50));
    await finish(103, at(44));
    // Latest *recorded* first — the press's clock, not the race time: 101 was pressed at 50:00, 102 at 45:00, 103 at 44:00.
    const view = await readFinishPage(db, staff.ADMIN!, raceId, 2);
    expect(view.recent.map((row) => [row.bibNumber, row.name, row.gunTimeMs, row.positionOverall])).toEqual([
      [101, "Ana Popescu", 50 * 60_000, 3],
      [102, "Bia Marin", 45 * 60_000, 2],
    ]);
    expect(view.finished).toBe(3);
    expect(view.withNumber).toBe(3);
  });
});

describe("§NNN the «Sosire» page", () => {
  it("draws the gun, the clock since it, the number box and «Sosit», and says nobody has finished", async () => {
    const html = await render();
    expect(html).toContain('data-testid="finish-title"');
    expect(html).toContain('data-testid="finish-clock"');
    expect(html).toContain('name="bib"');
    expect(html).toMatch(/inputmode="numeric"/i);
    const words = text(html);
    expect(words).toContain("De la start: 0:50:00");
    expect(words).toContain("Sosit");
    expect(words).toContain("Nimeni nu a sosit încă.");
    expect(words).toContain("0 sosiți din 3 cu număr");
    expect(words).not.toContain("Cursa nu a început încă");
  });

  it("says who just finished from `?ok=`, lists the latest first and says the English words on the English page", async () => {
    await finish(102, at(45, 12));
    await finish(101, at(50));
    const words = text(await render(raceId, "ro", { ok: "101" }, at(51)));
    expect(words).toContain("Sosit: #101 Ana Popescu · 0:50:00 · locul 2");
    expect(words).toMatch(/Ultimii sosiți.*#101 Ana Popescu · 0:50:00 · locul 2.*#102 Bia Marin · 0:45:12 · locul 1/);
    expect(words).toContain("2 sosiți din 3 cu număr");
    const english = text(await render(raceId, "en", {}, at(51)));
    expect(english).toContain("Latest finishers");
    expect(english).toContain("Since the start: 0:51:00");
    expect(english).toContain("2 finished of 3 with a number");
  });

  it("says the race has not started before the gun, says a group run has no results, and is a 404 for a role that may not", async () => {
    const words = text(await render(raceId, "ro", {}, new Date(GUN.getTime() - 60_000)));
    expect(words).toContain("Cursa nu a început încă");
    const run = await createRace(db, { type: "GROUP_RUN" });
    expect(text(await render(run.id))).toContain("Doar o cursă are clasament");
    state.actor = staff.CONTRIBUTOR;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
