import { eq } from "drizzle-orm";
import { createFormatter, createTranslator } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { datedOrNull } from "@/modules/events/domain/dated";
import type { PostedResultRow } from "@/modules/results/rows";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { withClientWords } from "../../helpers/client-words";
import { atTheClock } from "../../helpers/clock";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { A_YEAR_AFTER, AFTER_THE_RACE, approvePrivacyNotice, approveResultsTexts, approveTerms, createRace, person, RACE_STARTS_AT, registerRunner, resetNoticeCounter } from "../../helpers/results";

/**
 * §NNN, race results part 2 (BR-REQ-039-01, BR-REQ-041-01 criterion 6) — «Clasament» as the event page draws it, and the chip the
 * listing's card wears, from a real database (PGlite) through the public cache's read-through outside a Next server:
 *
 * - the section in Romanian and in English: named and «Participant #bib» rows, the chip time under the time, the three who did not
 *   finish at the end with their words and no place, the «Publicat la … până la …» line, the stacked phone shape's words (`data-label`);
 * - the name rule is the read's, unchanged: an unticked runner and one the club typed are never named;
 * - nothing at all — no heading, no «în curând» — when it is not published, when the notice or the terms do not describe it, before the
 *   race, after the period, and for a group run;
 * - the chip: which of a page's events get one, and what the card draws with it.
 */
const messages = { ro, en };
let language: "ro" | "en" = "ro";
const state = vi.hoisted(() => ({ db: undefined as unknown, gateReads: 0, holds: [] as Date[][] }));

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
/** The cached gate reads and the page's hold, passed through but counted: a page with nothing to show asks no gate, a race holds the page to its clock. */
vi.mock("@/modules/public-cache/reads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/public-cache/reads")>();
  const counted =
    <A extends unknown[], R>(read: (...args: A) => R) =>
    (...args: A): R => {
      state.gateReads += 1;
      return read(...args);
    };
  return {
    ...actual,
    cachedDeadlines: counted(actual.cachedDeadlines),
    cachedResultsDescribed: counted(actual.cachedResultsDescribed),
    cachedResultsTermsDescribed: counted(actual.cachedResultsTermsDescribed),
    cachedFirstResultsNoticeVersion: counted(actual.cachedFirstResultsNoticeVersion),
  };
});
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
/** The locale-aware link, as a plain anchor: the event's page is `/<locale>/evenimente/<slug>`. */
vi.mock("@/i18n/navigation", () => {
  const path = (href: { pathname?: string; params?: { slug?: string } }) => `/${language}/evenimente/${href.params?.slug ?? ""}`;
  return {
    getPathname: ({ href }: { href: { pathname?: string; params?: { slug?: string } } }) => path(href),
    Link: ({ href, children, className }: { href: { pathname?: string; params?: { slug?: string } }; children: ReactNode; className?: string }) =>
      createElement("a", { href: path(href), className }, children),
  };
});

const { default: ResultsSection } = await import("@/modules/results/ui/ResultsSection");
const { default: EventCard } = await import("@/modules/events/ui/EventCard");
const { eventsWithResultsChip } = await import("@/modules/results/public-page");
const { anonymousResultLabel } = await import("@/modules/results/domain/public-name");
const { saveEventResults, setResultsPublished } = await import("@/modules/results/results");

let db: TestDatabase;
let close: () => Promise<void>;
let raceId: string;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  resetNoticeCounter();
  language = "ro";
  state.gateReads = 0;
  state.holds = [];
  admin = await person(db, "ADMIN", "Ana Admin");
  raceId = (await createRace(db)).id;
});

const line = (bib: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `r[${bib}]`, bib: String(bib), name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
const typed = (index: number, over: Partial<PostedResultRow> = {}): PostedResultRow => ({ key: `n[${index}]`, bib: "", name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });

/**
 * A field of nine: Ana (ticked, 30–39) 50:00 with a chip time, Bia (did not tick, 40–49) 45:00, Dan (did not tick, men) 40:00, a runner the
 * club typed by hand 42:00, and Eli (ticked, DNF), Fost (ticked, DNS), Gigi (ticked, DSQ). The texts approved and the results published
 * the day after the race.
 */
async function publishedRace(over: { texts?: boolean } = {}) {
  await registerRunner(db, raceId, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
  await registerRunner(db, raceId, { name: "Bia Marin", bibNumber: 102, sex: "FEMALE", birthDate: "1985-03-10", ticked: false });
  await registerRunner(db, raceId, { name: "Dan Ionescu", bibNumber: 103, sex: "MALE", birthDate: "1996-11-21", ticked: false });
  await registerRunner(db, raceId, { name: "Eli Vasile", bibNumber: 104, sex: "MALE", birthDate: "1990-01-01" });
  await registerRunner(db, raceId, { name: "Fost Inscris", bibNumber: 105, sex: "MALE", birthDate: null });
  await registerRunner(db, raceId, { name: "Gigi Stan", bibNumber: 106, sex: "FEMALE", birthDate: "1970-02-02" });
  await saveEventResults(
    db,
    admin,
    {
      eventId: raceId,
      rows: [
        line(101, { time: "50:00", chip: "49:58" }),
        line(102, { time: "45:00" }),
        line(103, { time: "40:00" }),
        line(104, { status: "DNF" }),
        line(105, { status: "DNS" }),
        line(106, { status: "DSQ" }),
        typed(0, { bib: "900", name: "Ion Tastat", sex: "male", time: "42:00" }),
      ],
    },
    AFTER_THE_RACE,
  );
  if (over.texts !== false) {
    await approveResultsTexts(db);
    await setResultsPublished(db, admin, raceId, true, AFTER_THE_RACE);
  }
}

/** The event as the page hands it to the section, read the way the page reads it. */
async function eventRow() {
  const found = await findPublishedEventBySlug(db, language, await slugOf());
  if (!found) throw new Error("the event did not publish");
  return datedOrNull(found)!;
}
async function slugOf() {
  const rows = await db.select({ slug: eventTranslations.slug, locale: eventTranslations.locale }).from(eventTranslations).where(eq(eventTranslations.eventId, raceId));
  return rows.find((candidate) => candidate.locale === language)!.slug;
}

async function section(at: Date = AFTER_THE_RACE, over: Record<string, unknown> = {}): Promise<string> {
  const event = { ...(await eventRow()), ...over };
  const node = await atTheClock(at, () => ResultsSection({ event }));
  return withoutStyles(renderToStaticMarkup(withClientWords(node as ReactNode, language)));
}

/** Emotion writes each rule beside the markup it styles; a test reads the words, not the rules. */
const withoutStyles = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");

/** A card suspends on its client islands; the stream is read to its end, as the card-registration test does. */
async function markup(node: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return withoutStyles(await new Response(stream).text());
}

/** The table's rows as the page drew them: number, place cell, name cell, time cell, category cell. */
function rowsOf(html: string) {
  return [...html.matchAll(/<tr[^>]*data-testid="result-row"([^>]*)>([\s\S]*?)<\/tr>/g)].map((match) => {
    const cell = (testId: string) => (new RegExp(`data-testid="${testId}"[^>]*>([\\s\\S]*?)</td>`).exec(match[2])?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return {
      bib: Number(/data-bib="(\d+)"/.exec(match[1])![1]),
      status: /data-status="(\w+)"/.exec(match[1])![1],
      category: /data-category="([^"]*)"/.exec(match[1])![1],
      place: cell("result-place"),
      name: cell("result-name"),
      time: cell("result-time"),
      categoryText: cell("result-category"),
    };
  });
}

describe("§NNN «Clasament» on the event page — in Romanian", () => {
  it("draws the finishers by place, then the three who did not finish, without a place and with their word", async () => {
    await publishedRace();
    const html = await section();
    expect(html).toContain('id="clasament"');
    expect(html).toContain("Clasament");
    expect(rowsOf(html).map((row) => [row.bib, row.status, row.place.replace(/\s*Fără loc/, "").replace("—", "").trim()])).toEqual([
      [103, "FINISHED", "1"],
      [900, "FINISHED", "2"],
      [102, "FINISHED", "3"],
      [101, "FINISHED", "4"],
      [104, "DNF", ""],
      [106, "DSQ", ""],
      [105, "DNS", ""],
    ]);
    const rows = rowsOf(html);
    // The words of how it ended, in the time column, in text.
    expect(rows.find((row) => row.bib === 104)?.time).toBe("Abandon");
    expect(rows.find((row) => row.bib === 105)?.time).toBe("Neprezentat");
    expect(rows.find((row) => row.bib === 106)?.time).toBe("Descalificat");
    // A place in words for a screen reader where the eye sees a dash.
    expect(rows.find((row) => row.bib === 104)?.place).toContain("Fără loc");
  });

  it("names only a runner who ticked — everybody else, and a runner the club typed, is «Participant #număr»", async () => {
    await publishedRace();
    const html = await section();
    const names = Object.fromEntries(rowsOf(html).map((row) => [row.bib, row.name]));
    expect(names).toEqual({
      101: "Ana Popescu",
      102: "Participant #102",
      103: "Participant #103",
      104: "Eli Vasile",
      105: "Fost Inscris",
      106: "Gigi Stan",
      900: "Participant #900",
    });
    // The name rule is the read's: the page adds no source of a name.
    expect(html).not.toContain("Bia Marin");
    expect(html).not.toContain("Dan Ionescu");
    expect(html).not.toContain("Ion Tastat");
  });

  it("says the gun time, the chip time in a caption under it, and the category in the club's words with the place in it", async () => {
    await publishedRace();
    const rows = rowsOf(await section());
    const ana = rows.find((row) => row.bib === 101)!;
    expect(ana.time).toBe("0:50:00 Timp cip: 0:49:58");
    expect(ana.categoryText).toBe("Feminin, 30-39 ani · loc 1");
    // No chip time typed: no caption.
    expect(rows.find((row) => row.bib === 102)?.time).toBe("0:45:00");
    expect(rows.find((row) => row.bib === 102)?.categoryText).toBe("Feminin, 40-49 ani · loc 1");
    // The typed runner has a sex but no birth date: no category, a dash for the eye and the words for a reader.
    expect(rows.find((row) => row.bib === 900)?.categoryText).toContain("Fără categorie");
    // A runner who did not finish keeps their category and has no place in it.
    expect(rows.find((row) => row.bib === 104)?.categoryText).toBe("Masculin, 30-39 ani");
  });

  it("says when it was published and how long it stays, in the club's zone, and ends with the note about the tick", async () => {
    await publishedRace();
    const html = await section();
    const line = /data-testid="results-published"[^>]*>([^<]*)</.exec(html)![1];
    expect(line).toMatch(/^Publicat .+, la 12:00 · rămâne pe pagină până .+, la \d{2}:\d{2}$/);
    // 23 November 2026 at 12:00 in Brașov (UTC+2), and thirty days after the end of the race (the start, with no end saved).
    expect(line).toContain("23 nov. 2026");
    expect(line).toContain("12:00");
    expect(line).toContain("21 dec. 2026");
    expect(html).toContain("Vreau să apar pe lista de participanți &amp; rezultate");
    expect(html).toContain("Participant #număr");
  });

  it("has a column header for every cell, a stacked shape's word before the number and the time, and no caption for the eye", async () => {
    await publishedRace();
    const html = await section();
    // The number's word is the start list's («BIB»): one word for one thing on one page.
    for (const word of ["Loc", "BIB", "Nume", "Timp", "Categorie"]) expect(html).toContain(`>${word}<`);
    expect(html).toContain('data-label="BIB"');
    expect(html).toContain('data-label="Timp"');
    // A finisher's time cell carries the word before it on a phone; a runner who did not finish has the status word alone, never «Timp Abandon».
    const timeCell = (bib: number) => new RegExp(`data-bib="${bib}"[\\s\\S]*?<td data-col="time"([^>]*)>`).exec(html)![1];
    expect(timeCell(101)).toContain('data-label="Timp"');
    for (const bib of [104, 105, 106]) expect(timeCell(bib)).not.toContain("data-label");
    expect(html).toContain('id="results-table"');
    // The names stay out of search snippets, as the start list's do.
    expect(html).toMatch(/<section[^>]*data-nosnippet/);
    // Open on arrival: after a race the results are what a visitor came for.
    expect(html).toMatch(/<details[^>]*\sopen/);
  });

  it("offers the filter: a chip per category present with «Toate» first, and a numeric box named for the number", async () => {
    await publishedRace();
    const html = await section();
    expect(html).toContain('data-testid="results-filter"');
    const chips = [...html.matchAll(/data-testid="results-category-chip"[^>]*>[\s\S]*?<\/label>/g)].map((match) => match[0].replace(/<[^>]+>/g, "").replace(/^[^>]*>/, "").trim());
    expect(chips).toEqual(["Toate", "Feminin, 30-39 ani", "Feminin, 40-49 ani", "Feminin, 50-59 ani", "Masculin, 30-39 ani"]);
    expect(html).toMatch(/type="radio"/);
    // Each chip wears a glyph before its words, like the listing's (the sex of the category; «Toate» a group).
    const chipHtml = [...html.matchAll(/data-testid="results-category-chip"[^>]*>[\s\S]*?<\/label>/g)].map((match) => match[0]);
    expect(chipHtml).toHaveLength(5);
    for (const chip of chipHtml) expect(chip).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain("Caută după număr");
    expect(html).toMatch(/inputMode="numeric"|inputmode="numeric"/);
  });

  it("leaves the filter out when scripts are off: the controls would tick and narrow nothing", async () => {
    await publishedRace();
    const event = { ...(await eventRow()) };
    const node = await atTheClock(AFTER_THE_RACE, () => ResultsSection({ event }));
    const raw = renderToStaticMarkup(withClientWords(node as ReactNode, language));
    expect(raw).toMatch(/@media \(scripting: ?none\)/);
  });

  it("writes the number as the event writes it: «pad3» gives «Participant #102» and a column of three digits", async () => {
    await publishedRace();
    await registerRunner(db, raceId, { name: "Sapte", bibNumber: 7, sex: "MALE", birthDate: "1991-01-01", ticked: false });
    await saveEventResults(db, admin, { eventId: raceId, rows: [line(7, { time: "30:00" })] }, new Date(AFTER_THE_RACE.getTime() + 1000));
    const html = await section(AFTER_THE_RACE, { raceNumberFormat: "pad3" });
    const seven = rowsOf(html).find((row) => row.bib === 7)!;
    expect(seven.name).toBe("Participant #007");
    // The backoffice's «Pe site» line is the same string.
    expect(anonymousResultLabel("ro", 7, "pad3")).toBe(seven.name);
    expect(html).toMatch(/data-testid="result-number"[^>]*>007</);
  });
});

describe("§NNN «Clasament» on the event page — in English", () => {
  it("draws the same rows with the English words, the English catalogue's category and the date in English", async () => {
    language = "en";
    await publishedRace();
    const html = await section();
    expect(html).toContain("Results");
    const rows = rowsOf(html);
    expect(rows.find((row) => row.bib === 104)?.time).toBe("Dropped out");
    expect(rows.find((row) => row.bib === 105)?.time).toBe("Did not start");
    expect(rows.find((row) => row.bib === 106)?.time).toBe("Disqualified");
    expect(rows.find((row) => row.bib === 102)?.name).toBe("Participant #102");
    expect(rows.find((row) => row.bib === 101)?.time).toBe("0:50:00 Chip time: 0:49:58");
    expect(rows.find((row) => row.bib === 101)?.categoryText).toBe("Female, 30-39 · place 1");
    expect(rows.find((row) => row.bib === 900)?.categoryText).toContain("No category");
    expect(/data-testid="results-published"[^>]*>([^<]*)</.exec(html)![1]).toMatch(/^Published .+ · on this page until .+/);
    expect(html).toContain("I want to appear on the participants &amp; results list");
    expect(html).toContain("Search by number");
    for (const word of ["Place", "BIB", "Name", "Time", "Category"]) expect(html).toContain(`>${word}<`);
  });
});

describe("§NNN «Clasament» is absent, with no heading and no «în curând», unless every condition holds", () => {
  it("draws nothing while the Administrator has not published", async () => {
    await publishedRace();
    await setResultsPublished(db, admin, raceId, false, AFTER_THE_RACE);
    expect(await section()).toBe("");
  });

  it("draws nothing once the privacy notice in force no longer describes the results", async () => {
    await publishedRace();
    expect(await section()).not.toBe("");
    await approvePrivacyNotice(db, { results: false });
    expect(await section()).toBe("");
  });

  it("draws nothing once the terms in force no longer describe them", async () => {
    await publishedRace();
    await approveTerms(db, { results: false });
    expect(await section()).toBe("");
  });

  it("draws nothing before the race has started, and nothing once the public list's period is over", async () => {
    await publishedRace();
    expect(await section(new Date(RACE_STARTS_AT.getTime() - 3_600_000))).toBe("");
    expect(await section(A_YEAR_AFTER)).toBe("");
    // …and the day before the period ends it is still there.
    expect(await section(new Date(RACE_STARTS_AT.getTime() + 29 * 86_400_000))).not.toBe("");
  });

  it("draws nothing for an event that takes no results, though the flag were somehow set", async () => {
    await publishedRace();
    await db.update(events).set({ type: "GROUP_RUN" }).where(eq(events.id, raceId));
    expect(await section()).toBe("");
  });

  it("draws nothing for a published race with no result rows", async () => {
    await approveResultsTexts(db);
    await db.update(events).set({ resultsPublished: true, resultsPublishedAt: AFTER_THE_RACE }).where(eq(events.id, raceId));
    expect(await section()).toBe("");
  });
});

describe("§NNN the listing card's «Clasament» chip", () => {
  const rowOf = async (over: Partial<typeof events.$inferSelect> = {}) => {
    const [row] = await db.select().from(events).where(eq(events.id, raceId));
    return { ...row, ...over };
  };

  it("is for a published race that has started, inside the period, with the notice and the terms describing the results", async () => {
    await publishedRace();
    expect([...(await eventsWithResultsChip([await rowOf()], AFTER_THE_RACE))]).toEqual([raceId]);
  });

  it("is for none of: an unpublished race, a race to come, a race after its period, a group run, an undated race", async () => {
    await publishedRace();
    const published = await rowOf();
    const ids = async (row: Awaited<ReturnType<typeof rowOf>>, at: Date = AFTER_THE_RACE) => [...(await eventsWithResultsChip([row], at))];
    expect(await ids({ ...published, resultsPublished: false })).toEqual([]);
    expect(await ids(published, new Date(RACE_STARTS_AT.getTime() - 1000))).toEqual([]);
    expect(await ids(published, A_YEAR_AFTER)).toEqual([]);
    expect(await ids({ ...published, type: "GROUP_RUN" })).toEqual([]);
    expect(await ids({ ...published, startsAt: null as unknown as Date })).toEqual([]);
  });

  it("is for none while the notice or the terms do not describe the results, and asks the gates nothing for a page with no published race", async () => {
    await publishedRace();
    const published = await rowOf();
    await approveTerms(db, { results: false });
    expect([...(await eventsWithResultsChip([published], AFTER_THE_RACE))]).toEqual([]);
    // A page with no published race asks no gate at all: not the period, not the two verdicts, not the first notice.
    state.gateReads = 0;
    expect([...(await eventsWithResultsChip([{ ...published, resultsPublished: false }], AFTER_THE_RACE))]).toEqual([]);
    expect([...(await eventsWithResultsChip([], AFTER_THE_RACE))]).toEqual([]);
    expect(state.gateReads).toBe(0);
  });

  it("is not for a published race with no result row: the section draws nothing there, so the chip must not point at it", async () => {
    await approveResultsTexts(db);
    await db.update(events).set({ resultsPublished: true, resultsPublishedAt: AFTER_THE_RACE }).where(eq(events.id, raceId));
    // The public read (`PUBLIC_COLUMNS`) carries «published and has a row», the one fact the chip, the holds and the section read.
    expect((await eventRow()).resultsPublished).toBe(false);
    expect([...(await eventsWithResultsChip([await eventRow()], AFTER_THE_RACE))]).toEqual([]);
    await publishedRace({ texts: false });
    expect((await eventRow()).resultsPublished).toBe(true);
  });

  it("holds the page to the race's start and to the period's end, for the chip and for the section alike", async () => {
    await publishedRace();
    const event = await eventRow();
    // Thirty days after the start (no end saved): the period's end.
    const closes = new Date(RACE_STARTS_AT.getTime() + 30 * 86_400_000);
    state.holds = [];
    await eventsWithResultsChip([event], AFTER_THE_RACE);
    expect(state.holds).toEqual([[RACE_STARTS_AT, closes]]);
    state.holds = [];
    await atTheClock(AFTER_THE_RACE, () => ResultsSection({ event }));
    expect(state.holds).toEqual([[RACE_STARTS_AT, closes]]);
  });

  it("is drawn by the card as a link to the page's #clasament, 44 pixels tall around the small chip — and not drawn without the flag", async () => {
    await publishedRace();
    const event = await eventRow();
    const withChip = await markup(createElement(EventCard, { event, index: 0, now: AFTER_THE_RACE, resultsChip: true }));
    expect(withChip).toMatch(/<a[^>]*href="\/ro\/evenimente\/[^"#]+#clasament"[^>]*data-testid="results-chip"|<a[^>]*data-testid="results-chip"[^>]*href="\/ro\/evenimente\/[^"#]+#clasament"/);
    expect(withChip).toMatch(/data-testid="results-chip"[\s\S]*?Clasament/);
    const without = await markup(createElement(EventCard, { event, index: 0, now: AFTER_THE_RACE }));
    expect(without).not.toContain("results-chip");
    expect(without).not.toContain("#clasament");
  });
});
