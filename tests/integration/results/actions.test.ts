import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { eventResults } from "@/db/schema/event-results";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import type { FormOutcome } from "@/shared/forms/outcome";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { approvePrivacyNotice, approveResultsTexts, approveTerms, createRace, person, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §808 — «Clasament»'s Server Actions as the page posts them (BR-REQ-050-02, BR-REQ-060-01): the one «Salvează tot clasamentul» (saved, refused on
 * the first bad row with the runner and the problem in the club's words, refused when the form is stale), the import that only fills the boxes,
 * the row's own delete, and the Administrator's tick behind the notice's gate. The session, the cookies and navigation are
 * `event-todos.test.ts`'s stand-ins.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[], cookies: [] as Array<[string, string]> }));
const messages = { ro, en } as const;

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: (name: string, value: string) => void state.cookies.push([name, value]), delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (arg: { locale: "ro" | "en"; namespace: string }) => createTranslator({ locale: arg.locale, messages: messages[arg.locale], namespace: arg.namespace as "Admin" }),
    getLocale: async () => "ro",
  };
});

const { saveEventResultsAction, deleteEventResultAction, setResultsPublishedAction } = await import("@/app/[locale]/admin/events/[id]/results/actions");
const { readEventResults } = await import("@/modules/results/results");

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  for (const [role, name] of [["ADMIN", "Ana Admin"], ["MODERATOR", "Oana Organizator"], ["DEV", "Tudor Tehnic"]] as const) staff[role] = await person(db, role, name);
  // A race that has started: the Administrator's tick is refused before the gun, and the actions read the real clock.
  raceId = (await createRace(db, { startsAt: new Date("2026-06-01T07:00:00.000Z") })).id;
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
  await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10" });
  state.actor = staff.ADMIN;
  state.redirected.length = 0;
  state.cookies.length = 0;
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set("uiLocale", "ro");
  data.set("eventId", raceId);
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function post(action: (previous: FormOutcome | null, form: FormData) => Promise<FormOutcome | null>, data: FormData) {
  return action(null, data).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
}

const stored = () => db.select().from(eventResults).where(eq(eventResults.eventId, raceId)).orderBy(eventResults.bibNumber);
const outcome = (value: Awaited<ReturnType<typeof post>>) => value as FormOutcome;

describe("§808 «Salvează tot clasamentul»", () => {
  it("saves every line posted, then goes back to the page with the toast's word", async () => {
    expect(await post(saveEventResultsAction, form({ "r[101].time": "50:00", "r[101].status": "", "r[102].time": "45:12", "r[102].note": "bine" }))).toBe("redirected");
    expect((await stored()).map((row) => [row.bibNumber, row.status, row.gunTimeMs, row.note, row.positionOverall])).toEqual([
      [101, "FINISHED", 3_000_000, null, 2],
      [102, "FINISHED", 2_712_000, "bine", 1],
    ]);
    expect(state.redirected[0]).toMatch(/\/admin\/events\/[0-9a-f-]{36}\/results$/);
  });

  it("goes back to the page quietly when nothing changed", async () => {
    await post(saveEventResultsAction, form({ "r[101].time": "50:00" }));
    state.redirected.length = 0;
    expect(await post(saveEventResultsAction, form({ "r[101].time": "50:00" }))).toBe("redirected");
    expect((await stored()).length).toBe(1);
  });

  it("refuses the first bad row naming the runner and the problem in the club's words, keeping every box", async () => {
    const result = outcome(await post(saveEventResultsAction, form({ "r[101].time": "50:00", "r[102].time": "repede", "r[102].note": "ceva" })));
    expect(result).toMatchObject({ error: "RESULT_ROW_INVALID", fields: ["r[102].time"] });
    expect(result.errorValues?.runner).toBe("#102 Bia Marin");
    expect(result.errorValues?.problem).toBe("timpul nu e într-o formă citibilă (h:mm:ss, mm:ss sau mm:ss.t)");
    // Every box comes back as typed; nothing was saved, not even the good first row.
    expect(result.values["r[101].time"]).toEqual(["50:00"]);
    expect(result.values["r[102].note"]).toEqual(["ceva"]);
    expect(await stored()).toEqual([]);
  });

  it("names a missing name for a typed number, and the length of a note", async () => {
    const nameless = outcome(await post(saveEventResultsAction, form({ "n[0].bib": "900", "n[0].time": "49:00" })));
    expect(nameless).toMatchObject({ error: "RESULT_ROW_INVALID", fields: ["n[0].name"] });
    expect(nameless.errorValues).toEqual({ runner: "#900", problem: "numărul nu aparține niciunei înscrieri: scrie numele" });
    const note = outcome(await post(saveEventResultsAction, form({ "r[101].time": "50:00", "r[101].note": "x".repeat(201) })));
    expect(note.errorValues?.problem).toBe("nota are peste 200 de caractere");
  });

  it("refuses a form drawn before another session saved, with CONFLICT", async () => {
    const view = await readEventResults(db, staff.ADMIN!, raceId);
    await post(saveEventResultsAction, form({ "r[101].time": "50:00", fingerprint: view.fingerprint }));
    const stale = outcome(await post(saveEventResultsAction, form({ "r[102].time": "45:00", fingerprint: view.fingerprint })));
    expect(stale.error).toBe("CONFLICT");
    expect((await stored()).map((row) => row.bibNumber)).toEqual([101]);
  });

  it("refuses a role that may not, whatever the page drew: back to the page with the code", async () => {
    state.actor = staff.DEV;
    expect(await post(saveEventResultsAction, form({ "r[101].time": "50:00" }))).toBe("redirected");
    expect(state.redirected[0]).toContain("resultsError=FORBIDDEN");
    expect(await stored()).toEqual([]);
  });

  it("refuses a group run's results, and a malformed event id", async () => {
    const group = await createRace(db, { type: "GROUP_RUN" });
    const data = form({ "r[101].time": "50:00" });
    data.set("eventId", group.id);
    expect(outcome(await post(saveEventResultsAction, data)).error).toBe("RESULTS_NOT_OPEN");
    const forged = form({ "r[101].time": "50:00" });
    forged.set("eventId", "x");
    expect(outcome(await post(saveEventResultsAction, forged)).error).toBe("NOT_FOUND");
  });
});

describe("§808 «Importă din CSV» fills the boxes and saves nothing", () => {
  const posted = (extra: Record<string, string> = {}) =>
    form({ intent: "import", "r[101].time": "", "r[101].status": "", "r[101].chip": "", "r[101].note": "", "r[102].time": "", "r[102].status": "", "r[102].chip": "", "r[102].note": "ceva", ...extra });

  it("answers with the table's boxes filled, a new typed row for a number no registration holds, and a notice that says nothing is saved yet", async () => {
    const result = outcome(await post(saveEventResultsAction, posted({ importText: "Nr;Timp;Status\n101;50:00;\n102;;DNF\n999;51:00;" })));
    expect(result.error).toBeUndefined();
    expect(result.fields).toEqual([]);
    expect(result.values["r[101].time"]).toEqual(["0:50:00"]);
    expect(result.values["r[101].status"]).toEqual(["FINISHED"]);
    expect(result.values["r[102].status"]).toEqual(["DNF"]);
    expect(result.values["r[102].note"]).toEqual(["ceva"]);
    expect(result.values["n[0].bib"]).toEqual(["999"]);
    expect(result.values["n[0].time"]).toEqual(["0:51:00"]);
    // The pasted text leaves its box: what it said is in the table now.
    expect(result.values.importText).toBeUndefined();
    expect(result.notice).toMatchObject({ kind: "info", key: "resultsImportedNew", values: { count: "3", new: "1" } });
    expect(await stored()).toEqual([]);
  });

  it("says the plain notice when every number has its line", async () => {
    const result = outcome(await post(saveEventResultsAction, posted({ importText: "101,50:00\n102,45:00" })));
    expect(result.notice).toMatchObject({ key: "resultsImported", values: { count: "2" } });
  });

  it("refuses a bad line naming it, keeping the pasted text and every box", async () => {
    const result = outcome(await post(saveEventResultsAction, posted({ importText: "101,50:00\n102,nope" })));
    expect(result).toMatchObject({ error: "RESULTS_IMPORT_INVALID", fields: ["importText"] });
    expect(result.errorValues).toEqual({ where: "rândul 2: ", problem: "timpul nu e într-o formă citibilă" });
    expect(result.values.importText).toEqual(["101,50:00\n102,nope"]);
  });

  it("refuses nothing to import, and reads a chosen file", async () => {
    const empty = outcome(await post(saveEventResultsAction, posted({ importText: "  " })));
    expect(empty.errorValues?.problem).toBe("fișierul nu are niciun rând");
    const data = posted();
    data.set("importFile", new File(["101\t50:00\n"], "rezultate.tsv", { type: "text/tab-separated-values" }));
    const result = outcome(await post(saveEventResultsAction, data));
    expect(result.values["r[101].time"]).toEqual(["0:50:00"]);
  });

  it("is refused for a role that may not, and never writes", async () => {
    state.actor = staff.DEV;
    await expect(post(saveEventResultsAction, posted({ importText: "101,50:00" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await stored()).toEqual([]);
  });

  it("then saves what the club reviewed, in the one «Salvează tot clasamentul» that writes", async () => {
    const filled = outcome(await post(saveEventResultsAction, posted({ importText: "101,50:00\n999,51:00" })));
    const next = new FormData();
    next.set("uiLocale", "ro");
    next.set("eventId", raceId);
    for (const [name, values] of Object.entries(filled.values)) for (const value of values) next.append(name, value);
    // The button pressed this time is «Salvează tot clasamentul»: the form posts its own `intent`, never the import's.
    next.set("intent", "save");
    next.set("n[0].name", "Ion Vasile");
    expect(await post(saveEventResultsAction, next)).toBe("redirected");
    // 102 held only the note «ceva» in its box: a runner who did not start, with no place.
    expect((await stored()).map((row) => [row.bibNumber, row.displayName, row.status, row.positionOverall])).toEqual([
      [101, null, "FINISHED", 1],
      [102, null, "DNS", null],
      [999, "Ion Vasile", "FINISHED", 2],
    ]);
  });
});

describe("§808 the row's own delete", () => {
  it("deletes the result of the number posted and goes back; a number with no result goes back with the code", async () => {
    await post(saveEventResultsAction, form({ "r[101].time": "50:00", "r[102].time": "45:00" }));
    state.redirected.length = 0;
    expect(await post(deleteEventResultAction, form({ bibNumber: "101" }))).toBe("redirected");
    expect((await stored()).map((row) => [row.bibNumber, row.positionOverall])).toEqual([[102, 1]]);
    expect(await post(deleteEventResultAction, form({ bibNumber: "101" }))).toBe("redirected");
    expect(state.redirected.at(-1)).toContain("resultsError=NOT_FOUND");
    expect(await post(deleteEventResultAction, form({ bibNumber: "abc" }))).toBe("redirected");
    expect(state.redirected.at(-1)).toContain("resultsError=NOT_FOUND");
  });

  it("is refused for a role that may not", async () => {
    await post(saveEventResultsAction, form({ "r[101].time": "50:00" }));
    state.actor = staff.DEV;
    await post(deleteEventResultAction, form({ bibNumber: "101" }));
    expect(state.redirected.at(-1)).toContain("resultsError=FORBIDDEN");
    expect((await stored()).length).toBe(1);
  });
});

describe("§808 the Administrator's tick behind the notice's gate", () => {
  it("refuses it ticked while the notice does not describe the results, and comes back unticked", async () => {
    const result = outcome(await post(setResultsPublishedAction, form({ published: "on" })));
    expect(result.error).toBe("RESULTS_NOTICE");
    // The tick is not kept ticked: the box says what is true.
    expect(result.values.published).toBeUndefined();
    const [event] = await db.select({ published: events.resultsPublished }).from(events).where(eq(events.id, raceId));
    expect(event.published).toBe(false);
  });

  it("refuses it ticked while the terms do not describe the results either, and says so with its own code", async () => {
    await approvePrivacyNotice(db, { results: true });
    expect(outcome(await post(setResultsPublishedAction, form({ published: "on" }))).error).toBe("RESULTS_TERMS");
    await approveTerms(db, { results: true });
    expect(await post(setResultsPublishedAction, form({ published: "on" }))).toBe("redirected");
  });

  it("refuses it ticked before the race has started, with the box unticked, for a race still ahead", async () => {
    await approveResultsTexts(db);
    const ahead = (await createRace(db, { startsAt: new Date("2099-06-01T07:00:00.000Z") })).id;
    const data = form({ published: "on" });
    data.set("eventId", ahead);
    const result = outcome(await post(setResultsPublishedAction, data));
    expect(result.error).toBe("RESULTS_NOT_STARTED");
    expect(result.values.published).toBeUndefined();
    expect((await db.select({ published: events.resultsPublished }).from(events).where(eq(events.id, ahead)))[0].published).toBe(false);
  });

  it("accepts it under a notice and terms that name {{results}}, and takes it off with the box unticked", async () => {
    await approveResultsTexts(db);
    expect(await post(setResultsPublishedAction, form({ published: "on" }))).toBe("redirected");
    expect((await db.select({ published: events.resultsPublished }).from(events).where(eq(events.id, raceId)))[0].published).toBe(true);
    expect(await post(setResultsPublishedAction, form({}))).toBe("redirected");
    expect((await db.select({ published: events.resultsPublished }).from(events).where(eq(events.id, raceId)))[0].published).toBe(false);
  });

  it("is the Administrator's alone: the Organizer is sent back with the code and nothing changes", async () => {
    await approveResultsTexts(db);
    state.actor = staff.MODERATOR;
    expect(await post(setResultsPublishedAction, form({ published: "on" }))).toBe("redirected");
    expect(state.redirected.at(-1)).toContain("resultsError=FORBIDDEN");
    expect((await db.select({ published: events.resultsPublished }).from(events).where(eq(events.id, raceId)))[0].published).toBe(false);
  });
});

describe("§808 «Adaugă un alergător neînscris» and the toast of a save that only moved places", () => {
  it("answers a script-less press with the boxes as they stand and one blank typed line more, asked for again by the next press", async () => {
    const first = outcome(await post(saveEventResultsAction, form({ intent: "addRow", "r[101].time": "50:00", "n[0].bib": "900", "n[0].name": "Ion Vasile", "n[0].time": "49:00" })));
    expect(first.error).toBeUndefined();
    expect(first.notice).toMatchObject({ kind: "info", key: "resultsRowAdded" });
    expect(first.values).toMatchObject({ "r[101].time": ["50:00"], "n[0].name": ["Ion Vasile"], extraRows: ["1"] });
    // Nothing was saved: the press only asks the page for another line.
    expect(await stored()).toEqual([]);
    const second = outcome(await post(saveEventResultsAction, form({ intent: "addRow", extraRows: "1", "n[0].name": "Ion Vasile" })));
    expect(second.values.extraRows).toEqual(["2"]);
  });

  it("says the places were worked out again, not «0 rezultate», when a save wrote no result but a corrected answer moved a category", async () => {
    await post(saveEventResultsAction, form({ "r[101].time": "50:00", "r[102].time": "45:00" }));
    state.cookies.length = 0;
    const { registrations } = await import("@/db/schema/registrations");
    await db.update(registrations).set({ birthDate: "2000-01-01" }).where(eq(registrations.bibNumber, 101));
    expect(await post(saveEventResultsAction, form({ "r[101].time": "50:00", "r[102].time": "45:00" }))).toBe("redirected");
    const [, value] = state.cookies.at(-1) as [string, string];
    expect(decodeURIComponent(value)).toContain('"resultsRecalculated"');
    expect(decodeURIComponent(value)).not.toContain('"resultsSaved"');
  });
});
