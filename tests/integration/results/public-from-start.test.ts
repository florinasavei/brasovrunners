import { eq } from "drizzle-orm";
import { createFormatter, createTranslator } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import { datedOrNull } from "@/modules/events/domain/dated";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { RESULTS_REFRESH_MS } from "@/modules/results/domain/live-window";
import type { PostedResultRow } from "@/modules/results/rows";
import { startLiveRefresh } from "@/modules/results/ui/live-refresh";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { withClientWords } from "../../helpers/client-words";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { approvePrivacyNotice, approveResultsTexts, approveTerms, createRace, person, RACE_STARTS_AT, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §985 — «Public de la start» and the live «Clasament» (BR-REQ-039-01, BR-REQ-053-01, BR-REQ-060-01; the owner, 2026-11-18: «pe site live
 * trebuie sa vad lista de finish … trebe sa setez ca toata lumea apare pe site», and, asked, «public from the start», «LIVE»).
 *
 * The Administrator ticks the results public two days before the race, with a «Neprezentat» already typed: the service accepts it (every
 * other gate kept, the audit row as before) — and until the race starts NOTHING is public: not the read, not the cached read, not the
 * section, not the listing's chip, and the page and the listing are held to the start; the page carries only the live island, hidden and
 * armed to the start, which asks nothing before it. From the start every stored row shows, the «Publicat …» line names the start rather
 * than the tick, and the section carries the live island while the race runs and not after.
 */
const messages = { ro, en };
let language: "ro" | "en" = "ro";
const state = vi.hoisted(() => ({ db: undefined as unknown, holds: [] as Date[][] }));

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getLocale: async () => language,
  getFormatter: async () => createFormatter({ locale: language, timeZone: "Europe/Bucharest" }),
  getTranslations: async (arg?: string | { locale?: "ro" | "en"; namespace: string }) => {
    const locale = typeof arg === "object" && arg.locale ? arg.locale : language;
    const namespace = typeof arg === "string" ? arg : arg?.namespace;
    return createTranslator({ locale, messages: messages[locale] as never, namespace: namespace as never });
  },
}));
/** The page's and the listing's holds, recorded: before the start they must hold the page to it. */
vi.mock("@/modules/public-cache/page-lifetime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/public-cache/page-lifetime")>();
  return {
    ...actual,
    holdPageUntil: (instants: Date[], now: Date) => {
      state.holds.push(instants);
      return actual.holdPageUntil(instants, now);
    },
  };
});
/** `next/navigation` for the live island: a router the server render never calls. */
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => {} }) }));

const { default: ResultsSection } = await import("@/modules/results/ui/ResultsSection");
const { default: ResultsLiveRefresh } = await import("@/modules/results/ui/ResultsLiveRefresh");
const { eventsWithResultsChip, readEventResultsForPage, readResultsGates } = await import("@/modules/results/public-page");
const { cachedPublicEventResults } = await import("@/modules/public-cache/reads");
const { readPublicEventResults, saveEventResults, setResultsPublished } = await import("@/modules/results/results");

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
let admin: StaffUser;

/** Two days before the race: when the Administrator ticks, and when a «Neprezentat» is already typed. */
const BEFORE = new Date(RACE_STARTS_AT.getTime() - 2 * 86_400_000);
const JUST_BEFORE = new Date(RACE_STARTS_AT.getTime() - 1);
/** A race saved without an end refreshes for six hours from its start; the period of the public list is thirty days from it. */
const LIVE_UNTIL = new Date(RACE_STARTS_AT.getTime() + 6 * 3_600_000);
const CLOSES = new Date(RACE_STARTS_AT.getTime() + 30 * 86_400_000);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  language = "ro";
  state.holds = [];
  admin = await person(db, "ADMIN", "Ana Admin");
  raceId = (await createRace(db)).id;
});

const line = (bib: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });

/** Ana (ticked) and Bia (did not tick); the texts approved; Bia's «Neprezentat» typed and the results ticked public — two days before the race. */
async function tickedBeforeTheRace() {
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
  await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10", ticked: false });
  await approveResultsTexts(db);
  await saveEventResults(db, admin, { eventId: raceId, rows: [line(102, { status: "DNS" })] }, BEFORE);
  return setResultsPublished(db, admin, raceId, true, BEFORE);
}

/** The event as the page hands it to the section, read the way the page reads it. */
async function eventRow() {
  const rows = await db.select({ slug: eventTranslations.slug, locale: eventTranslations.locale }).from(eventTranslations).where(eq(eventTranslations.eventId, raceId));
  const found = await findPublishedEventBySlug(db, language, rows.find((row) => row.locale === language)!.slug);
  if (!found) throw new Error("the event did not publish");
  return datedOrNull(found)!;
}

const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
async function section(at: Date): Promise<string> {
  const event = await eventRow();
  const node = await atTheClock(at, () => ResultsSection({ event }));
  return withoutStyles(renderToStaticMarkup(withClientWords(node as ReactNode, language)));
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** The live island drawn alone, with nothing to read or see: the whole of the section's markup. */
const QUIET = '<span hidden="" data-testid="results-live-quiet"></span>';

describe("§985 the tick before the race: accepted, every other gate kept, audited as before", () => {
  it("accepts it two days before the race, says it shows from the start, and records the moment and one audit row", async () => {
    await expect(tickedBeforeTheRace()).resolves.toEqual({ changed: true, fromStart: true });
    const [event] = await db.select({ published: events.resultsPublished, at: events.resultsPublishedAt }).from(events).where(eq(events.id, raceId));
    expect(event).toEqual({ published: true, at: BEFORE });
    const trail = await db.select({ action: auditLogs.action, metadata: auditLogs.metadataJson }).from(auditLogs).where(eq(auditLogs.entityId, raceId));
    expect(trail.filter((row) => row.action.startsWith("event_results."))).toEqual([{ action: "event_results.published", metadata: {} }]);
  });

  it("keeps FORBIDDEN, RESULTS_NOT_OPEN, RESULTS_NOTICE and RESULTS_TERMS before the start, and never refuses taking it off", async () => {
    const organizer = await person(db, "MODERATOR", "Oana Organizator");
    await expect(setResultsPublished(db, organizer, raceId, true, BEFORE)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setResultsPublished(db, admin, raceId, true, BEFORE)).rejects.toMatchObject({ code: "RESULTS_NOTICE" });
    await approvePrivacyNotice(db, { results: true });
    await expect(setResultsPublished(db, admin, raceId, true, BEFORE)).rejects.toMatchObject({ code: "RESULTS_TERMS" });
    await approveTerms(db, { results: true });
    const group = await createRace(db, { type: "GROUP_RUN" });
    await expect(setResultsPublished(db, admin, group.id, true, BEFORE)).rejects.toMatchObject({ code: "RESULTS_NOT_OPEN" });
    expect((await db.select({ published: events.resultsPublished }).from(events).where(eq(events.id, raceId)))[0].published).toBe(false);
    await expect(setResultsPublished(db, admin, raceId, true, BEFORE)).resolves.toEqual({ changed: true, fromStart: true });
    await expect(setResultsPublished(db, admin, raceId, false, new Date(BEFORE.getTime() + 1000))).resolves.toEqual({ changed: true });
  });
});

describe("§985 nothing public before the start, even with a row stored", () => {
  it("the read, the cached read and the page's read are null until the start", async () => {
    await tickedBeforeTheRace();
    const gates = await readResultsGates(BEFORE);
    expect(gates).toMatchObject({ noticeDescribes: true, termsDescribe: true, firstResultsNoticeVersion: 1 });
    for (const at of [BEFORE, JUST_BEFORE]) {
      expect(await readPublicEventResults(db, raceId, { ...gates, now: at }), at.toISOString()).toBeNull();
      expect(await atTheClock(at, () => cachedPublicEventResults(raceId, gates)), at.toISOString()).toBeNull();
      expect(await readEventResultsForPage(await eventRow(), at), at.toISOString()).toBeNull();
    }
  });

  it("the section draws nothing to see — no heading, no «în curând», no number, no line — only the hidden clock, and holds the page to the start", async () => {
    await tickedBeforeTheRace();
    for (const at of [BEFORE, JUST_BEFORE]) {
      state.holds = [];
      // The island alone, hidden and armed to the start: it says the results are ticked, never a result.
      expect(await section(at), at.toISOString()).toBe(QUIET);
      // The live window's start and end (the island starts asking at the start), then the section's own: the start and the period's end.
      expect(state.holds, at.toISOString()).toEqual([
        [RACE_STARTS_AT, LIVE_UNTIL],
        [RACE_STARTS_AT, CLOSES],
      ]);
    }
  });

  it("the listing gives the race no «Clasament» chip, and holds itself to the start", async () => {
    await tickedBeforeTheRace();
    const [row] = await db.select().from(events).where(eq(events.id, raceId));
    const event = await eventRow();
    // The row carries «published and has a row» (`PUBLIC_COLUMNS`): the Neprezentat typed early is one.
    expect(event.resultsPublished).toBe(true);
    for (const at of [BEFORE, JUST_BEFORE]) {
      state.holds = [];
      expect([...(await eventsWithResultsChip([{ ...row, resultsPublished: event.resultsPublished }], at))], at.toISOString()).toEqual([]);
      expect(state.holds, at.toISOString()).toEqual([[RACE_STARTS_AT, CLOSES]]);
    }
  });
});

describe("§985 from the start, every stored row — and live while the race runs", () => {
  it("shows the row typed before the start from the gun on, in the read, the cached read, the chip and the section", async () => {
    await tickedBeforeTheRace();
    const gates = await readResultsGates(RACE_STARTS_AT);
    expect((await readPublicEventResults(db, raceId, { ...gates, now: RACE_STARTS_AT }))?.rows.map((row) => [row.bibNumber, row.name, row.status])).toEqual([[102, null, "DNS"]]);
    expect((await atTheClock(RACE_STARTS_AT, () => cachedPublicEventResults(raceId, gates)))?.rows.map((row) => row.bibNumber)).toEqual([102]);
    const [row] = await db.select().from(events).where(eq(events.id, raceId));
    expect([...(await eventsWithResultsChip([{ ...row, resultsPublished: true }], RACE_STARTS_AT))]).toEqual([raceId]);
    const html = await section(RACE_STARTS_AT);
    expect(html).toContain('id="clasament"');
    expect(text(html)).toContain("Participant #102");
    expect(text(html)).toContain("Neprezentat");
    expect(html).not.toContain("Bia Marin");
  });

  it("says «Publicat» at the start, not at the earlier tick", async () => {
    await tickedBeforeTheRace();
    const html = await section(new Date(RACE_STARTS_AT.getTime() + 3_600_000));
    const published = /data-testid="results-published"[^>]*>([^<]*)</.exec(html)![1];
    // 21 November 2026, 09:00 in Brașov — the start — and never the 19th, the day of the tick.
    expect(published).toMatch(/^Publicat .*21 nov\. 2026, la 09:00 · rămâne pe pagină până /);
    expect(published).not.toContain("19 nov.");
  });

  it("carries the live line while the race runs, holding the page to the window's end — and none once it is over", async () => {
    await tickedBeforeTheRace();
    for (const at of [RACE_STARTS_AT, new Date(LIVE_UNTIL.getTime() - 1)]) {
      state.holds = [];
      const html = await section(at);
      expect(html, at.toISOString()).toContain('data-testid="results-live"');
      expect(html, at.toISOString()).not.toContain('data-testid="results-live-quiet"');
      expect(text(html), at.toISOString()).toContain("Se actualizează singur la 30 de secunde.");
      expect(state.holds, at.toISOString()).toEqual([[LIVE_UNTIL], [RACE_STARTS_AT, CLOSES]]);
    }
    state.holds = [];
    const after = await section(LIVE_UNTIL);
    expect(after).toContain('id="clasament"');
    expect(after).not.toContain('data-testid="results-live"');
    expect(state.holds).toEqual([[RACE_STARTS_AT, CLOSES]]);
  });

  it("runs the window to a race's saved end, and says the line in English", async () => {
    await tickedBeforeTheRace();
    const ends = new Date(RACE_STARTS_AT.getTime() + 2 * 3_600_000);
    await db.update(events).set({ endsAt: ends }).where(eq(events.id, raceId));
    language = "en";
    expect(text(await section(new Date(ends.getTime() - 1)))).toContain("Updates itself every 30 seconds.");
    expect(await section(ends)).not.toContain('data-testid="results-live"');
  });
});

/**
 * A database that is away at a render (§447): every use is refused as a socket refuses, which `readOrWhileAway` reads as «leave the part
 * out». The event's row was read before — the page has it from its own read, which serves a copy or the resting page on its own.
 */
function awayDatabase(): unknown {
  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
  return new Proxy(
    {},
    {
      get: () => {
        throw refused;
      },
    },
  );
}

describe("§985 the clock with no section: before the start, an empty sheet before the first finish, and a database away at a render", () => {
  /** Ana (ticked); the texts approved; the results ticked public two days before the race — and nothing typed. */
  async function tickedWithAnEmptySheet() {
    await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
    await approveResultsTexts(db);
    await setResultsPublished(db, admin, raceId, true, BEFORE);
  }

  it("draws the clock alone and silent from the start on an empty sheet — no section, no line — so the first finish reaches an open page", async () => {
    await tickedWithAnEmptySheet();
    // The row: the tick as saved, but «published and has a row» is false — the chip and the section read that one.
    const event = await eventRow();
    expect({ resultsTicked: event.resultsTicked, resultsPublished: event.resultsPublished }).toEqual({ resultsTicked: true, resultsPublished: false });

    // Before the start: the clock alone, hidden and armed to the start; the page held to the start and the window's end.
    expect(await section(BEFORE)).toBe(QUIET);
    expect(state.holds).toEqual([[RACE_STARTS_AT, LIVE_UNTIL]]);

    // From the start: the island alone, hidden — nothing to read, nothing to see — and the page held to the window's end.
    for (const at of [RACE_STARTS_AT, new Date(LIVE_UNTIL.getTime() - 1)]) {
      state.holds = [];
      const html = await section(at);
      expect(html, at.toISOString()).toMatch(/<span hidden="" data-testid="results-live-quiet"><\/span>/);
      expect(html, at.toISOString()).not.toContain('id="clasament"');
      expect(html, at.toISOString()).not.toContain('data-testid="results-live"');
      expect(text(html), at.toISOString()).toBe("");
      expect(state.holds, at.toISOString()).toEqual([[LIVE_UNTIL]]);
    }

    // After the window: nothing, and nothing held.
    state.holds = [];
    expect(await section(LIVE_UNTIL)).toBe("");
    expect(state.holds).toEqual([]);

    // The first finish saved during the race: the next render is the section, with its line and the clock inside it.
    const FIRST_FINISH = new Date(RACE_STARTS_AT.getTime() + 25 * 60_000);
    await saveEventResults(db, admin, { eventId: raceId, rows: [line(101, { time: "25:00" })] }, FIRST_FINISH);
    const html = await section(new Date(FIRST_FINISH.getTime() + 30_000));
    expect(html).toContain('id="clasament"');
    expect(text(html)).toContain("Ana Popescu");
    expect(html).toContain('data-testid="results-live"');
    expect(html).not.toContain('data-testid="results-live-quiet"');
  });

  it("draws no clock for a race whose results are not ticked, nor once the texts in force no longer describe the results", async () => {
    await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101 });
    await approveResultsTexts(db);
    expect(await section(BEFORE)).toBe("");
    expect(await section(RACE_STARTS_AT)).toBe("");
    expect(state.holds).toEqual([]);

    await setResultsPublished(db, admin, raceId, true, BEFORE);
    expect(await section(BEFORE)).toBe(QUIET);
    expect(await section(RACE_STARTS_AT)).toBe(QUIET);
    // A newer notice in force that does not describe the results: no result saved could show, so there is nothing to refresh for.
    await approvePrivacyNotice(db, { results: false });
    expect(await section(BEFORE)).toBe("");
    expect(await section(RACE_STARTS_AT)).toBe("");
  });

  it("before the start draws the hidden clock with no line, armed to the start — and over its props nothing is asked until the start", async () => {
    await tickedWithAnEmptySheet();
    const event = await eventRow();
    const node = (await atTheClock(BEFORE, () => ResultsSection({ event }))) as ReactElement<{ from: number; until: number; line: string | null }>;
    // The island itself, with plain props: the window's start and end, and no line to read.
    expect(node.type).toBe(ResultsLiveRefresh);
    expect(node.props).toEqual({ from: RACE_STARTS_AT.getTime(), until: LIVE_UNTIL.getTime(), line: null });
    expect(withoutStyles(renderToStaticMarkup(withClientWords(node, language)))).toBe(QUIET);

    // Its clock over those props, from that render two days before the race: no request until the start, then the first.
    let refreshes = 0;
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(BEFORE);
      const clock = startLiveRefresh(
        {
          now: () => Date.now(),
          visible: () => true,
          refresh: () => {
            refreshes += 1;
          },
          setTimeout: (callback, ms) => setTimeout(callback, ms),
          clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        { from: node.props.from, until: node.props.until, everyMs: RESULTS_REFRESH_MS },
      );
      vi.advanceTimersByTime(RACE_STARTS_AT.getTime() - BEFORE.getTime() - 1);
      clock.onVisibilityChange();
      expect(refreshes).toBe(0);
      vi.advanceTimersByTime(1);
      expect(refreshes).toBe(1);
      clock.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the clock while the database is away at a render: «Clasament» is left out of that render, the island stays, alone", async () => {
    await tickedBeforeTheRace();
    const at = new Date(RACE_STARTS_AT.getTime() + 3_600_000);
    const event = await eventRow();
    state.db = awayDatabase();
    let away: string;
    try {
      away = withoutStyles(renderToStaticMarkup(withClientWords((await atTheClock(at, () => ResultsSection({ event }))) as ReactNode, language)));
    } finally {
      state.db = db;
    }
    expect(away).not.toContain('id="clasament"');
    expect(away).toContain('data-testid="results-live-quiet"');
    // The database back: the next refresh draws the section again, the clock inside it.
    const back = await section(new Date(at.getTime() + 30_000));
    expect(back).toContain('id="clasament"');
    expect(back).toContain('data-testid="results-live"');
  });
});
