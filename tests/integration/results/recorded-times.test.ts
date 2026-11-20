import { and, eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventResults } from "@/db/schema/event-results";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resultLineFingerprint } from "@/modules/results/domain/fingerprint";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import type { FormOutcome } from "@/shared/forms/outcome";
import { withClientWords } from "../../helpers/client-words";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace, person, RACE_STARTS_AT, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §1012 — «Timpi la sosire» and «Folosește» on «Clasament» (BR-REQ-050-02, BR-REQ-060-01, BR-REQ-041-01 criterion 6), amending §986 and
 * §808: under a line's «Timp» the times «Cronometrare» recorded for its number — read with the page's data from the race's trail —, drawn
 * only when there is a choice and never on a «Descalificat» line, each with who pressed it and when, «în clasament» on the line's own and
 * a 44-pixel «Folosește» beside the others, posting the page's one hidden form with the line's own fingerprint, asked first; on
 * registered and typed lines alike. And the server behind it, `chooseRecordedFinishTime`: the time set and «Sosit», the chip time and the
 * note untouched, every place ranked again, one audit row with `chosenFromHistory` and no name, «Istoricul sosirilor»'s words for it, the
 * public cache told; CONFLICT only for a line changed since the page was drawn — another number's arrival at «Cronometrare» or another
 * line's save refuses nothing, while «Salvează tot clasamentul» keeps the whole list's guard —; `RESULT_DISQUALIFIED` for a
 * «Descalificat» line; `RESULT_TIME_NOT_RECORDED` for a time not recorded for that number; FORBIDDEN for a role that may not. And the
 * action: back at the line with the toast, or at the page's alert with why.
 */
const messages = { ro, en };
let language: "ro" | "en" = "ro";
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[], cookies: [] as Array<[string, string]> }));
const revalidate = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: (name: string, value: string) => void state.cookies.push([name, value]), delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()), revalidatePublicContent: revalidate }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));
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

const { default: ResultsPage } = await import("@/app/[locale]/admin/events/[id]/results/page");
const { chooseRecordedTimeAction } = await import("@/app/[locale]/admin/events/[id]/results/actions");
const { chooseRecordedFinishTime, deleteEventResult, readEventResults, recordFinish, saveEventResults, undoFinish } = await import("@/modules/results/results");
const { readRecordedFinishTimes } = await import("@/modules/results/recorded-times");

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
const GUN = RACE_STARTS_AT;
const at = (minutes: number, seconds = 0) => new Date(GUN.getTime() + minutes * 60_000 + seconds * 1000);
const ms = (minutes: number, seconds = 0) => minutes * 60_000 + seconds * 1000;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  revalidate.mockClear();
  language = "ro";
  state.redirected.length = 0;
  state.cookies.length = 0;
  for (const [role, name] of [["ADMIN", "Ana Admin"], ["MODERATOR", "Oana Organizator"], ["DEV", "Tudor Tehnic"], ["CONTRIBUTOR", "Vlad Voluntar"], ["COPYWRITER", "Radu Redactor"], ["MEMBER", "Membru Club"]] as const) staff[role] = await person(db, role, name);
  raceId = (await createRace(db)).id;
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
  await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10" });
  await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103, sex: "MALE", birthDate: "1996-11-21" });
  state.actor = staff.ADMIN;
});

const press = (bib: number, now: Date, actor: StaffUser = staff.CONTRIBUTOR!) => recordFinish(db, actor, { eventId: raceId, bibNumber: bib }, now);
const stored = () => db.select().from(eventResults).where(eq(eventResults.eventId, raceId)).orderBy(eventResults.bibNumber);
const storedOf = async (bib: number) => (await stored()).find((row) => row.bibNumber === bib);
const resultRows = async () => (await db.select().from(auditLogs).where(eq(auditLogs.entityId, raceId)).orderBy(auditLogs.createdAt, auditLogs.id)).filter((row) => row.action.startsWith("event_result."));
const line = (bib: number, over: Record<string, string> = {}) => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", agreed: "", ...over });
/** What the line of `bib` stores now, as the page posts it (`resultLineFingerprint` of its row, or of none). */
const lineFingerprintOf = async (bib: number) => resultLineFingerprint(await storedOf(bib));
/** What a «Folosește» of `bib` at `gunTimeMs` posts from a page drawn now: the number, the time and the line's own fingerprint. */
const choiceOf = async (bib: number, gunTimeMs: number) => `${bib}:${gunTimeMs}:${await lineFingerprintOf(bib)}`;
/** The registered line of `bib` as the page reads it (`readEventResults`). */
const drawnLine = async (bib: number) => (await readEventResults(db, staff.ADMIN!, raceId)).registered.find((runner) => runner.bibNumber === bib)!;

/**
 * The race the owner described: 102 pressed by Vlad at 0:45:12, then by Tudor at 0:45:17 — the second a duplicate, kept in the trail —,
 * 101 between the two at 0:45:15 and nobody else; 102 first, 101 second.
 */
async function pressedTwice() {
  await press(102, at(45, 12));
  await press(101, at(45, 15));
  expect(await press(102, at(45, 17), staff.DEV!)).toMatchObject({ kind: "duplicate", storedGunTimeMs: ms(45, 12), gunTimeMs: ms(45, 17) });
}

async function draw(now = at(61), locale: "ro" | "en" = language, search: { resultsError?: string; timeError?: string } = {}) {
  language = locale;
  const tree = (await atTheClock(now, () => ResultsPage({ params: Promise.resolve({ locale, id: raceId }), searchParams: Promise.resolve(search) }))) as ReactElement;
  return { tree, html: renderToStaticMarkup(withClientWords(tree, locale)).replace(/<style[\s\S]*?<\/style>/g, "") };
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

/** The markup of one line — registered or typed — by its number: from its `<li>` to the next line, or the end of its list. */
function lineHtml(html: string, bib: number): string {
  const anchor = html.indexOf(`id="result-line-${bib}"`);
  if (anchor < 0) return "";
  const start = html.lastIndexOf("<li", anchor);
  const open = html.indexOf(">", anchor);
  const ends = ['data-testid="result-line"', 'data-testid="typed-line"', 'data-testid="typed-add"', 'id="box-results-typed"'].map((marker) => html.indexOf(marker, open)).filter((index) => index > open);
  return html.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

/** The block «Timpi la sosire» of a line, as each time reads: the words, whether it is the line's, and the button's value and name. */
function recordedOf(lineMarkup: string) {
  return [...lineMarkup.matchAll(/<li[^>]*data-testid="result-recorded-time" data-choice="([^"]+)" data-current="(true|false)"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => {
    const button = /<button([^>]*)data-testid="result-recorded-use"[^>]*>/.exec(match[3]) ?? /<button([^>]*)>/.exec(match[3]);
    return {
      choice: match[1],
      current: match[2] === "true",
      words: text(match[3]),
      button: button ? button[0] : null,
    };
  });
}

type Element = ReactElement<Record<string, unknown>>;
function elementsOf(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elementsOf(element.props.children as ReactNode)];
}

/** The page's one hidden «Folosește» form as the page hands it to the island: its action, its questions and its hidden fields. */
function chooseForm(tree: ReactNode) {
  const form = elementsOf(tree).find((element) => element.props["data-testid"] === "results-choose-form");
  if (!form) return undefined;
  const inside = elementsOf(form.props.children as ReactNode);
  return {
    props: form.props,
    confirm: form.props.confirm as ConfirmSpec[],
    hidden: Object.fromEntries(inside.filter((element) => element.type === "input" && element.props.type === "hidden").map((input) => [String(input.props.name), String(input.props.value)])),
  };
}

describe("§1012 «Timpi la sosire» under a line's «Timp»", () => {
  it("lists both times of a number pressed twice — who pressed each and when —, «în clasament» on the line's own and «Folosește» beside the other", async () => {
    await pressedTwice();
    const { html } = await draw();
    const times = recordedOf(lineHtml(html, 102));
    expect(times.map(({ choice, current, words }) => ({ choice, current, words }))).toEqual([
      { choice: await choiceOf(102, ms(45, 12)), current: true, words: "0:45:12 în clasament Vlad Voluntar, la 09:45:12" },
      { choice: await choiceOf(102, ms(45, 17)), current: false, words: "0:45:17 Tudor Tehnic, la 09:45:17 Folosește" },
    ]);
    expect(times[0].button).toBeNull();
    // «Folosește» is a submit of the page's one hidden form, posting the line's number, the time and what the line stored — that line's
    // own fingerprint, the one the page read with it —, named for whose line it is.
    const button = times[1].button ?? "";
    expect(button).toContain('type="submit"');
    expect(button).toContain('form="choose-recorded-time"');
    expect(button).toContain('name="choice"');
    expect(button).toContain(`value="102:${ms(45, 17)}:${(await drawnLine(102)).lineFingerprint}"`);
    expect(button).toContain('aria-label="Folosește 0:45:17 pentru #102 Bia Marin"');
    // Under «Timp»: inside the cell of the line's time box, after the box.
    const cell = lineHtml(html, 102);
    expect(cell.indexOf('data-testid="result-recorded"')).toBeGreaterThan(cell.indexOf('data-testid="result-time"'));
    expect(cell.indexOf('data-testid="result-recorded"')).toBeLessThan(cell.indexOf('data-testid="result-status"'));
    expect(text(cell)).toContain("Timpi la sosire:");
  });

  it("draws nothing for a line with one recorded time equal to its «Timp», nor for one nobody pressed", async () => {
    await pressedTwice();
    const { html } = await draw();
    expect(lineHtml(html, 101)).not.toContain('data-testid="result-recorded"');
    expect(lineHtml(html, 103)).not.toContain('data-testid="result-recorded"');
    expect(html.match(/data-testid="result-recorded"/g)).toHaveLength(1);
  });

  it("draws it for one recorded time that is not the line's: typed otherwise on «Clasament», or a line written off since", async () => {
    await press(103, at(52));
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [line(103, { time: "52:05" })] }, at(60));
    let times = recordedOf(lineHtml((await draw()).html, 103));
    expect(times.map(({ current, words }) => ({ current, words }))).toEqual([{ current: false, words: "0:52:00 Vlad Voluntar, la 09:52:00 Folosește" }]);
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [line(103, { status: "DNS", note: "a ieșit de pe traseu" })] }, at(61));
    times = recordedOf(lineHtml((await draw(at(62))).html, 103));
    expect(times.map(({ current }) => current)).toEqual([false]);
  });

  it("draws nothing on a «Descalificat» line — no time, no «Folosește», no question —, and keeps it on «Abandon» and «Neprezentat» lines", async () => {
    await pressedTwice();
    await press(103, at(52));
    // 102 pressed twice and disqualified since; 101 and 103 each pressed once and written off since — by mistake, as far as the page knows.
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [line(101, { status: "DNF" }), line(102, { status: "DSQ", note: "a tăiat traseul" }), line(103, { status: "DNS" })] }, at(60));
    const { tree, html } = await draw(at(61));
    expect(lineHtml(html, 102)).toContain('data-testid="result-line"');
    expect(lineHtml(html, 102)).not.toContain('data-testid="result-recorded"');
    expect(lineHtml(html, 102)).not.toContain("Timpi la sosire:");
    expect(recordedOf(lineHtml(html, 101)).map(({ choice, current }) => [choice, current])).toEqual([[await choiceOf(101, ms(45, 15)), false]]);
    expect(recordedOf(lineHtml(html, 103)).map(({ choice, current }) => [choice, current])).toEqual([[await choiceOf(103, ms(52)), false]]);
    // The page's questions: the two lines written off, none for the disqualified one.
    const asked = (chooseForm(tree)?.confirm ?? []).flatMap((spec) => (spec.when ?? []).map((condition) => ("equals" in condition ? String(condition.equals) : "")));
    expect(asked).toEqual([await choiceOf(101, ms(45, 15)), await choiceOf(103, ms(52))]);
  });

  it("draws it on a runner typed by hand too — an elite line's number pressed twice —, and says «cont șters» for an account gone", async () => {
    await db.insert(eventEliteEntries).values({ eventId: raceId, name: "Andrei Elitu", bibNumber: 7 });
    const gone = await person(db, "SUPERADMIN", "Sorin Super");
    await press(7, at(40));
    await press(7, at(40, 3), gone);
    await db.delete(staffUsers).where(eq(staffUsers.id, gone.id));
    const { html } = await draw();
    const typed = lineHtml(html, 7);
    expect(typed).toContain('data-testid="typed-line"');
    expect(recordedOf(typed).map(({ current, words }) => ({ current, words }))).toEqual([
      { current: true, words: "0:40:00 în clasament Vlad Voluntar, la 09:40:00" },
      { current: false, words: "0:40:03 cont șters, la 09:40:03 Folosește" },
    ]);
    expect(typed).toContain('aria-label="Folosește 0:40:03 pentru #7 Andrei Elitu"');
  });

  it("asks first, as «Șterge» does: one hidden form for the page, a question per button naming the time and the runner and what happens to what is not saved", async () => {
    await pressedTwice();
    const { tree, html } = await draw();
    const form = chooseForm(tree);
    expect(form?.props.hidden).toBe(true);
    expect(form?.props.id).toBe("choose-recorded-time");
    // No fingerprint of the whole page: each button carries its own line's, so another line's write never refuses it.
    expect(form?.hidden).toEqual({ uiLocale: "ro", eventId: raceId });
    expect(form?.confirm).toEqual([
      {
        when: [{ field: "choice", equals: await choiceOf(102, ms(45, 17)) }],
        title: "Folosești acest timp?",
        body: "Pui 0:45:17 ca timp pentru #102 Bia Marin? Rezultatul devine «Sosit», cu timpul cip și nota de acum, iar locurile se recalculează. Ce n-ai salvat pe pagină se pierde: salvează întâi.",
        confirmLabel: "Folosește",
        cancelLabel: "Renunță",
      },
      {
        title: "Folosești acest timp?",
        body: "Pui timpul ales ca timp al alergătorului? Rezultatul devine «Sosit», cu timpul cip și nota de acum, iar locurile se recalculează. Ce n-ai salvat pe pagină se pierde: salvează întâi.",
        confirmLabel: "Folosește",
        cancelLabel: "Renunță",
      },
    ]);
    // A form beside the big one, never inside it: the button names it by `form=`.
    expect(html.match(/<form[^>]*id="choose-recorded-time"[^>]*>/g)).toHaveLength(1);
    // «Șterge»'s question says the same of what is not saved.
    const remove = elementsOf(tree).find((element) => element.props.id === "delete-result");
    expect((remove?.props.confirm as ConfirmSpec).body).toBe("Rezultatul alergătorului cu numărul {bibNumber} dispare din clasament. Locurile celorlalți se recalculează. Ce n-ai salvat pe pagină se pierde: salvează întâi.");
  });

  it("draws no hidden form while no line offers a choice", async () => {
    await press(101, at(45, 15));
    const { tree, html } = await draw();
    expect(chooseForm(tree)).toBeUndefined();
    expect(html).not.toContain('id="choose-recorded-time"');
  });

  it("says it in English", async () => {
    await pressedTwice();
    const { tree, html } = await draw(at(61), "en");
    expect(recordedOf(lineHtml(html, 102)).map(({ words }) => words)).toEqual(["0:45:12 in the results Vlad Voluntar, at 09:45:12", "0:45:17 Tudor Tehnic, at 09:45:17 Use"]);
    expect(text(lineHtml(html, 102))).toContain("Times at the finish:");
    expect(lineHtml(html, 102)).toContain('aria-label="Use 0:45:17 for #102 Bia Marin"');
    expect(chooseForm(tree)?.confirm[0].body).toBe(
      "Make 0:45:17 the time of #102 Bia Marin? The result becomes «Finished», keeping its chip time and note, and the places are worked out again. Anything not saved on the page is lost: save it first.",
    );
  });

  it("reads every number's times for whoever enters results, and refuses any other role", async () => {
    await pressedTwice();
    expect([...(await readRecordedFinishTimes(db, staff.MODERATOR!, raceId)).entries()].map(([bib, times]) => [bib, times.map((time) => time.gunTimeMs)])).toEqual([
      [102, [ms(45, 12), ms(45, 17)]],
      [101, [ms(45, 15)]],
    ]);
    for (const role of ["DEV", "CONTRIBUTOR", "COPYWRITER", "MEMBER"] as const) await expect(readRecordedFinishTimes(db, staff[role]!, raceId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("§1012 «Folosește»: chooseRecordedFinishTime", () => {
  it("makes the time chosen the line's — «Sosit», the chip time and the note untouched —, ranks every place again, audits it without a name and tells the public cache", async () => {
    await pressedTwice();
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [line(101, { time: "45:15" }), line(102, { time: "45:12", chip: "45:10", note: "a trecut linia" })] }, at(58));
    expect((await stored()).map((row) => [row.bibNumber, row.positionOverall])).toEqual([
      [101, 2],
      [102, 1],
    ]);
    const before = await resultRows();
    revalidate.mockClear();
    const drawn = await drawnLine(102);
    expect(drawn.lineFingerprint).toBe(await lineFingerprintOf(102));
    expect(await chooseRecordedFinishTime(db, staff.ADMIN!, { eventId: raceId, bibNumber: 102, gunTimeMs: ms(45, 17), lineFingerprint: drawn.lineFingerprint }, at(62))).toEqual({ changed: true, bibNumber: 102 });
    const row102 = await storedOf(102);
    expect(row102).toMatchObject({ status: "FINISHED", gunTimeMs: ms(45, 17), chipTimeMs: ms(45, 10), note: "a trecut linia", updatedByStaffUserId: staff.ADMIN!.id, positionOverall: 2 });
    expect((await storedOf(101))?.positionOverall).toBe(1);
    const added = (await resultRows()).slice(before.length);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ action: "event_result.updated", actorStaffUserId: staff.ADMIN!.id });
    expect(added[0].metadataJson).toEqual({ bibNumber: 102, status: "FINISHED", gunTimeMs: ms(45, 17), chipTimeMs: ms(45, 10), changed: ["time"], chosenFromHistory: true });
    expect(JSON.stringify(added[0].metadataJson)).not.toContain("Marin");
    expect(revalidate).toHaveBeenCalledTimes(1);

    // The page drawn again: the chosen time «în clasament», the first one now the one to choose — with the line's new fingerprint —;
    // and the history says the choice.
    const { html } = await draw(at(63));
    expect(await lineFingerprintOf(102)).not.toBe(drawn.lineFingerprint);
    expect(recordedOf(lineHtml(html, 102)).map(({ choice, current }) => [choice, current])).toEqual([
      [await choiceOf(102, ms(45, 12)), false],
      [await choiceOf(102, ms(45, 17)), true],
    ]);
    const history = [...html.matchAll(/data-testid="results-history-line" data-where="(\w+)"[^>]*>([^<]*)</g)].map((match) => [match[1], text(match[2])]);
    expect(history[0]).toEqual(["results", "Sâm., 21 nov. 2026, 10:02:00 · Ana Admin a ales pentru #102 Bia Marin timpul 0:45:17 dintre cele înregistrate · Clasament"]);
    language = "en";
    const englishHistory = [...(await draw(at(63), "en")).html.matchAll(/data-testid="results-history-line" data-where="(\w+)"[^>]*>([^<]*)</g)].map((match) => text(match[2]));
    expect(englishHistory[0]).toContain("Ana Admin chose 0:45:17 for #102 Bia Marin from the recorded times · Results");
  });

  it("turns a line written off since into «Sosit» at the time chosen, its note kept", async () => {
    await press(103, at(52));
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [line(103, { status: "DNS", note: "nu a trecut linia" })] }, at(60));
    expect(await chooseRecordedFinishTime(db, staff.MODERATOR!, { eventId: raceId, bibNumber: 103, gunTimeMs: ms(52) }, at(61))).toEqual({ changed: true, bibNumber: 103 });
    expect(await storedOf(103)).toMatchObject({ status: "FINISHED", gunTimeMs: ms(52), chipTimeMs: null, note: "nu a trecut linia", positionOverall: 1 });
    expect((await resultRows()).at(-1)?.metadataJson).toMatchObject({ bibNumber: 103, changed: ["status", "time"], chosenFromHistory: true });
  });

  it("makes a result deleted on «Clasament» again, «Sosit» at the time chosen, under its registration", async () => {
    await pressedTwice();
    await deleteEventResult(db, staff.MODERATOR!, { eventId: raceId, bibNumber: 102 }, at(58));
    expect(await storedOf(102)).toBeUndefined();
    // Both times still stand to choose from: a delete on «Clasament» is no undo at the line.
    expect(recordedOf(lineHtml((await draw(at(59))).html, 102)).map(({ current }) => current)).toEqual([false, false]);
    await chooseRecordedFinishTime(db, staff.MODERATOR!, { eventId: raceId, bibNumber: 102, gunTimeMs: ms(45, 17) }, at(60));
    const [registration] = await db.select().from(registrations).where(and(eq(registrations.eventId, raceId), eq(registrations.bibNumber, 102)));
    expect(await storedOf(102)).toMatchObject({ registrationId: registration.id, status: "FINISHED", gunTimeMs: ms(45, 17), positionOverall: 2 });
    expect((await resultRows()).at(-1)).toMatchObject({ action: "event_result.created", metadataJson: { bibNumber: 102, status: "FINISHED", gunTimeMs: ms(45, 17), chipTimeMs: null, changed: ["status", "time"], chosenFromHistory: true } });
  });

  it("writes and records nothing for a time that is the line's «Sosit» time already", async () => {
    await pressedTwice();
    const before = await resultRows();
    revalidate.mockClear();
    expect(await chooseRecordedFinishTime(db, staff.ADMIN!, { eventId: raceId, bibNumber: 102, gunTimeMs: ms(45, 12) }, at(62))).toEqual({ changed: false, bibNumber: 102 });
    expect(await resultRows()).toHaveLength(before.length);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("goes through when only other lines changed since the page — another number arriving at «Cronometrare», this one pressed again, another line saved —, ranking from the live rows; «Salvează tot clasamentul» from that page is still refused", async () => {
    await pressedTwice();
    const view = await readEventResults(db, staff.ADMIN!, raceId);
    const drawn = view.registered.find((runner) => runner.bibNumber === 102)!;
    // Race day: «Clasament» is open while «Cronometrare» goes on — 103 arrives, 102 is pressed a third time (the trail keeps it, the row
    // stays), and a colleague saves a note on 101's line.
    expect(await press(103, at(52))).toMatchObject({ kind: "recorded", again: false });
    expect(await press(102, at(45, 40), staff.MODERATOR!)).toMatchObject({ kind: "duplicate" });
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [line(101, { time: "45:15", note: "corectat" }), line(102, { time: "45:12" }), line(103, { time: "52:00" })] }, at(58));
    expect(await lineFingerprintOf(102)).toBe(drawn.lineFingerprint);

    expect(await chooseRecordedFinishTime(db, staff.ADMIN!, { eventId: raceId, bibNumber: 102, gunTimeMs: ms(45, 17), lineFingerprint: drawn.lineFingerprint }, at(62))).toEqual({ changed: true, bibNumber: 102 });
    // Every place from the rows as they are now — 103 and 101's note included —, not as the page saw them.
    expect((await stored()).map((row) => [row.bibNumber, row.gunTimeMs, row.note, row.positionOverall])).toEqual([
      [101, ms(45, 15), "corectat", 1],
      [102, ms(45, 17), null, 2],
      [103, ms(52), null, 3],
    ]);
    // The big save writes the whole list, so it keeps the whole list's guard: the same page's «Salvează tot clasamentul» is refused.
    const before = await resultRows();
    await expect(saveEventResults(db, staff.ADMIN!, { eventId: raceId, rows: [line(101, { time: "45:15" }), line(102, { time: "45:12" })], fingerprint: view.fingerprint }, at(63))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await resultRows()).toHaveLength(before.length);
  });

  it("refuses with CONFLICT a press whose own line changed since the page — saved, chosen or deleted by another session, or made since for a line drawn with none —, writing nothing", async () => {
    await pressedTwice();
    /** The press from a page drawn when the line was `drawn`: refused CONFLICT, nothing of the line or the trail written. */
    const refused = async (gunTimeMs: number, drawn: string) => {
      const [trail, row] = [await resultRows(), await storedOf(102)];
      await expect(chooseRecordedFinishTime(db, staff.ADMIN!, { eventId: raceId, bibNumber: 102, gunTimeMs, lineFingerprint: drawn }, at(70))).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await resultRows()).toHaveLength(trail.length);
      expect(await storedOf(102)).toEqual(row);
    };

    // Another session saved a note on this very line.
    let drawn = (await drawnLine(102)).lineFingerprint;
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [line(101, { time: "45:15" }), line(102, { time: "45:12", note: "corectat" })] }, at(58));
    await refused(ms(45, 17), drawn);
    // Another session chose the other time first.
    drawn = (await drawnLine(102)).lineFingerprint;
    await chooseRecordedFinishTime(db, staff.MODERATOR!, { eventId: raceId, bibNumber: 102, gunTimeMs: ms(45, 17), lineFingerprint: drawn }, at(59));
    await refused(ms(45, 12), drawn);
    // Another session deleted the result.
    drawn = (await drawnLine(102)).lineFingerprint;
    await deleteEventResult(db, staff.MODERATOR!, { eventId: raceId, bibNumber: 102 }, at(60));
    await refused(ms(45, 12), drawn);
    // The page drew the line with no result; another session made one since.
    drawn = (await drawnLine(102)).lineFingerprint;
    expect(drawn).toBe(resultLineFingerprint(null));
    await chooseRecordedFinishTime(db, staff.MODERATOR!, { eventId: raceId, bibNumber: 102, gunTimeMs: ms(45, 12), lineFingerprint: drawn }, at(61));
    await refused(ms(45, 17), drawn);
    expect(await storedOf(102)).toMatchObject({ status: "FINISHED", gunTimeMs: ms(45, 12), updatedByStaffUserId: staff.MODERATOR!.id });
  });

  it("refuses «Folosește» on a «Descalificat» line whatever the page drew — `RESULT_DISQUALIFIED`, nothing written —; «Abandon» and «Neprezentat» lines still become «Sosit»", async () => {
    await pressedTwice();
    await press(103, at(52));
    const drawnBefore = (await drawnLine(102)).lineFingerprint;
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [line(101, { status: "DNF" }), line(102, { status: "DSQ", note: "a tăiat traseul" }), line(103, { status: "DNS" })] }, at(58));
    const before = await resultRows();
    // From a page drawn before the disqualification, a post no page draws now (the line has no «Folosește»), and a caller that does not guard.
    for (const lineFingerprint of [drawnBefore, await lineFingerprintOf(102), null]) {
      await expect(chooseRecordedFinishTime(db, staff.ADMIN!, { eventId: raceId, bibNumber: 102, gunTimeMs: ms(45, 17), lineFingerprint }, at(62)), String(lineFingerprint)).rejects.toMatchObject({
        code: "RESULT_DISQUALIFIED",
      });
    }
    expect(await storedOf(102)).toMatchObject({ status: "DSQ", gunTimeMs: null, note: "a tăiat traseul" });
    expect(await resultRows()).toHaveLength(before.length);

    // A runner written off by mistake who was pressed at the line: «Abandon» and «Neprezentat» are made «Sosit», their notes kept.
    for (const [bibNumber, gunTimeMs] of [
      [101, ms(45, 15)],
      [103, ms(52)],
    ]) {
      expect(await chooseRecordedFinishTime(db, staff.ADMIN!, { eventId: raceId, bibNumber, gunTimeMs, lineFingerprint: await lineFingerprintOf(bibNumber) }, at(63))).toEqual({ changed: true, bibNumber });
      expect(await storedOf(bibNumber)).toMatchObject({ status: "FINISHED", gunTimeMs, positionOverall: bibNumber === 101 ? 1 : 2 });
    }
  });

  it("refuses a time that is not one recorded for that number since the last reset: never pressed, another number's, an undone press's", async () => {
    await pressedTwice();
    await press(103, at(52, 30));
    await undoFinish(db, staff.CONTRIBUTOR!, { eventId: raceId, resultId: (await storedOf(103))!.id }, at(53));
    const before = await resultRows();
    for (const [bibNumber, gunTimeMs] of [
      [102, ms(45, 20)],
      [102, ms(45, 15)],
      [101, ms(45, 17)],
      [103, ms(52, 30)],
      [0, 0],
    ]) {
      await expect(chooseRecordedFinishTime(db, staff.ADMIN!, { eventId: raceId, bibNumber, gunTimeMs }, at(62)), `${bibNumber}:${gunTimeMs}`).rejects.toMatchObject({ code: "RESULT_TIME_NOT_RECORDED" });
    }
    expect((await storedOf(102))?.gunTimeMs).toBe(ms(45, 12));
    expect(await storedOf(103)).toBeUndefined();
    expect(await resultRows()).toHaveLength(before.length);
  });

  it("refuses every role that may not enter results, FORBIDDEN, whatever the page drew; the Organizer may", async () => {
    await pressedTwice();
    for (const role of ["DEV", "CONTRIBUTOR", "COPYWRITER", "MEMBER"] as const) {
      await expect(chooseRecordedFinishTime(db, staff[role]!, { eventId: raceId, bibNumber: 102, gunTimeMs: ms(45, 17) }, at(62)), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await storedOf(102))?.gunTimeMs).toBe(ms(45, 12));
    expect(await chooseRecordedFinishTime(db, staff.MODERATOR!, { eventId: raceId, bibNumber: 102, gunTimeMs: ms(45, 17) }, at(62))).toEqual({ changed: true, bibNumber: 102 });
  });

  it("refuses a number with no line on the page, and an event that is not a race", async () => {
    await db.insert(eventEliteEntries).values({ eventId: raceId, name: "Andrei Elitu", bibNumber: 7 });
    await press(7, at(40));
    await press(7, at(40, 3), staff.DEV!);
    await deleteEventResult(db, staff.ADMIN!, { eventId: raceId, bibNumber: 7 }, at(41));
    // An elite line's typed row deleted on «Clasament» is no line any more: nothing to make the time of.
    await expect(chooseRecordedFinishTime(db, staff.ADMIN!, { eventId: raceId, bibNumber: 7, gunTimeMs: ms(40, 3) }, at(42))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const groupRun = await createRace(db, { type: "GROUP_RUN" });
    await expect(chooseRecordedFinishTime(db, staff.ADMIN!, { eventId: groupRun.id, bibNumber: 7, gunTimeMs: ms(40, 3) }, at(42))).rejects.toMatchObject({ code: "RESULTS_NOT_OPEN" });
  });
});

describe("§1012 «Folosește»: the action and the page's alert", () => {
  function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    data.set("uiLocale", "ro");
    data.set("eventId", raceId);
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  }
  async function post(data: FormData) {
    return chooseRecordedTimeAction(null as FormOutcome | null, data).catch((error: unknown) => {
      if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
      throw error;
    });
  }
  const flashOf = () => state.cookies.map(([, value]) => JSON.parse(decodeURIComponent(value)) as { k: string; n: string; v: Record<string, string> });

  it("goes back to «Clasament» at the line, the toast naming the number", async () => {
    await pressedTwice();
    expect(await post(form({ choice: await choiceOf(102, ms(45, 17)) }))).toBe("redirected");
    expect(state.redirected).toEqual([`/ro/admin/events/${raceId}/results#result-line-102`]);
    expect(flashOf()).toEqual([{ k: "success", n: "resultTimeChosen", v: { bib: "102" } }]);
    expect((await storedOf(102))?.gunTimeMs).toBe(ms(45, 17));
    // The toast's words, in both languages.
    expect(createTranslator({ locale: "ro", messages: ro, namespace: "Feedback" })("toast.resultTimeChosen", { bib: "102" })).toBe("#102: timpul ales e acum în clasament, iar locurile s-au recalculat.");
    expect(createTranslator({ locale: "en", messages: en, namespace: "Feedback" })("toast.resultTimeChosen", { bib: "102" })).toBe("#102: the chosen time is now in the results, and the places were worked out again.");
  });

  it("says nothing changed for the line's own time, an info rather than a tick", async () => {
    await pressedTwice();
    await post(form({ choice: await choiceOf(102, ms(45, 12)) }));
    expect(flashOf()).toEqual([{ k: "info", n: "resultTimeUnchanged", v: { bib: "102" } }]);
  });

  it("goes through with the value the page drew after another number arrived at «Cronometrare» since — no reload per choice on race day", async () => {
    await pressedTwice();
    const drawn = recordedOf(lineHtml((await draw()).html, 102)).find((time) => !time.current)!.choice;
    expect(await press(103, at(52))).toMatchObject({ kind: "recorded", again: false });
    expect(await post(form({ choice: drawn }))).toBe("redirected");
    expect(state.redirected).toEqual([`/ro/admin/events/${raceId}/results#result-line-102`]);
    expect(flashOf()).toEqual([{ k: "success", n: "resultTimeChosen", v: { bib: "102" } }]);
    expect((await stored()).map((row) => [row.bibNumber, row.gunTimeMs, row.positionOverall])).toEqual([
      [101, ms(45, 15), 1],
      [102, ms(45, 17), 2],
      [103, ms(52), 3],
    ]);
  });

  it("goes back at the page's alert with why when refused — its line changed since, a disqualified line, a time not recorded, a role that may not — and the alert says it", async () => {
    await pressedTwice();
    const drawn = await choiceOf(102, ms(45, 17));
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [line(101, { time: "45:15" }), line(102, { time: "45:12", note: "corectat" })] }, at(58));
    await post(form({ choice: drawn }));
    await post(form({ choice: "102:repede" }));
    await post(form({ choice: `102:${ms(45, 17)}` }));
    await post(form({ choice: await choiceOf(102, ms(45, 20)) }));
    state.actor = staff.DEV;
    await post(form({ choice: await choiceOf(102, ms(45, 17)) }));
    state.actor = staff.ADMIN;
    await saveEventResults(db, staff.MODERATOR!, { eventId: raceId, rows: [line(101, { time: "45:15" }), line(102, { status: "DSQ", note: "corectat" })] }, at(59));
    await post(form({ choice: await choiceOf(102, ms(45, 17)) }));
    const base = `/ro/admin/events/${raceId}/results`;
    expect(state.redirected).toEqual([
      `${base}?timeError=CONFLICT#results-alert`,
      `${base}?timeError=RESULT_TIME_NOT_RECORDED#results-alert`,
      `${base}?timeError=RESULT_TIME_NOT_RECORDED#results-alert`,
      `${base}?timeError=RESULT_TIME_NOT_RECORDED#results-alert`,
      `${base}?timeError=FORBIDDEN#results-alert`,
      `${base}?timeError=RESULT_DISQUALIFIED#results-alert`,
    ]);
    expect(state.cookies).toEqual([]);
    expect(await storedOf(102)).toMatchObject({ status: "DSQ", gunTimeMs: null, note: "corectat" });

    const conflict = (await draw(at(62), "ro", { timeError: "CONFLICT" })).html;
    expect(conflict).toMatch(/<div[^>]*id="results-alert"[^>]*data-testid="results-error"/);
    expect(text(conflict)).toContain("Timpul nu s-a schimbat: între timp altcineva a modificat rândul acestui alergător. Uită-te din nou la rând și alege din nou.");
    expect(text((await draw(at(62), "ro", { timeError: "RESULT_TIME_NOT_RECORDED" })).html)).toContain(
      "Nu s-a schimbat nimic: timpul nu e printre cei înregistrați la «Cronometrare» pentru acest număr de la ultima resetare.",
    );
    expect(text((await draw(at(62), "ro", { timeError: "RESULT_DISQUALIFIED" })).html)).toContain(
      "Nu s-a schimbat nimic: alergătorul e descalificat. O descalificare se schimbă de mână, la «Stare», apoi «Salvează tot clasamentul».",
    );
    expect(text((await draw(at(62), "en", { timeError: "CONFLICT" })).html)).toContain("The time was not changed: someone changed this runner's line in the meantime.");
    expect(text((await draw(at(62), "en", { timeError: "RESULT_DISQUALIFIED" })).html)).toContain(
      "Nothing changed: the runner is disqualified. A disqualification is changed by hand, in «Status», then «Save all the results».",
    );
    // The reset's CONFLICT keeps its own words.
    expect(text((await draw(at(62), "ro", { resultsError: "CONFLICT" })).html)).toContain("Între timp au venit rezultate noi sau startul s-a schimbat");
    expect(text((await draw(at(62), "ro", { timeError: "SOMETHING_ELSE" })).html)).not.toContain("Nu s-a schimbat nimic");
  });
});
