import { YES_CELL } from "./domain/club-runner";
import { sexCell, sexOfCell, type SexChoice } from "./domain/sex";
import { columnLetters, ROW_TINTS, statusesOfTint, TINT_FILL, type RowTint } from "./sheet-colours";

/**
 * The statistics footer of the registrations Excel (§787, amending §172 and §581; the owner, 2026-10-15: «the
 * Excel should have a statistics footer so that I can show „how many Brașov Runners”, how many active, etc.,
 * grouped by category»): the counts of the rows the file carries, written under them.
 *
 * Pure counting and wording, no workbook and no database — `workbook.ts` lays the cells out, the export route
 * asks the questions (is this row the club's, what is its event's label) and hands in the answers on the row.
 * What the words mean, decided here once so the footer can say it in a line of its own:
 *
 * - **Total** is every row of the file. The file is the rows on screen (§581) and never holds a test
 *   registration (§30), so neither does a count; the route asks for `excludeTest`, this module never sees one.
 * - **Active («activi») is the confirmed** (BUSINESS.md: a participant is confirmed once the declaration is
 *   signed and a place is held): a person who will be on the start line. A pending, a waiting-list entry, an
 *   offer, a cancelled and an expired registration are each their own line, so the lines add up to the total.
 * - **The club's** are the rows `domain/club-runner.ts#isClubRunner` says (a member on «Echipa», the box
 *   ticked, or a typed club that names the club); the others are the rest.
 * - **A special guest** is a row an Administrator put on «Lista de invitați speciali» (§643): it takes no place,
 *   and it is a row like any other — inside «Total» and its state's line. Three lines under the club's name them:
 *   the guests, the confirmed guests, and the confirmed who do take a place (the confirmed part of the event's places line, «N confirmați», §615).
 * - **A category is the sex and an age band**, the age on the event's day (`ageOnRaceDay`, §322). The club has
 *   defined no categories of its own (`domain/age.ts#ageOnRaceDay`: «the club has defined no age bands»), so the bands are the
 *   ordinary ones of a road race, ten years wide from eighteen; a minor's band is its own because an event's
 *   minimum age is fourteen (§515). A row missing either answer is counted under «no category», never guessed.
 *
 * An export of several events (the screen's «Toate evenimentele», or a search across them) is counted per
 * event first, each with its categories inside it, and once more over all of them at the end.
 *
 * **The footer is live** (amended; the owner, 2026-10-16: «statisticile din Excel trebuie să se actualizeze automat
 * offline, gen să fie formule în Excel»): each number is a `COUNTIF` or `COUNTIFS` over the sheet's own columns —
 * the status, the «Club runner» cell, the sex, the age and, in a file of several events, the «Event» column — with
 * today's number stored beside it as the cached value, so a viewer that never recalculates still shows it and
 * Excel and LibreOffice recount on open. This module still computes every number itself (the cached ones, and every
 * test's expectation); the formulas are the same counting said in the spreadsheet's words. Under the numbers, a
 * legend of the row colours (`sheet-colours.ts`).
 */

/** The age bands, youngest first: the label's key in the catalogue and the age each starts at. */
export const STATISTICS_AGE_BANDS = [
  { key: "under18", from: 0 },
  { key: "from18", from: 18 },
  { key: "from30", from: 30 },
  { key: "from40", from: 40 },
  { key: "from50", from: 50 },
  { key: "from60", from: 60 },
] as const;

export type StatisticsBandKey = (typeof STATISTICS_AGE_BANDS)[number]["key"];

/** The band an age falls in, or null for none (no birth date). */
export function ageBandOf(age: number | null | undefined): StatisticsBandKey | null {
  if (typeof age !== "number" || !Number.isFinite(age) || age < 0) return null;
  let found: StatisticsBandKey = STATISTICS_AGE_BANDS[0].key;
  for (const band of STATISTICS_AGE_BANDS) if (age >= band.from) found = band.key;
  return found;
}

/** What the footer reads from a row of the file: its state, whose it is, its category's two answers, its event. */
export type StatisticsRow = {
  status: string;
  /** The row is one of the club's runners (`isClubRunner`); absent reads as no. */
  clubRunner?: boolean;
  /** The person ticked «Sunt membru al grupului {club}» (§NNN): the sheet's «Member tick (declared)» column, counted on a line of its own. Absent reads as no. */
  clubMemberDeclared?: boolean;
  /** The sheet's «Sex» cell, in its own words (`sexCell`). */
  sex?: string | null;
  ageOnRaceDay?: number | null;
  /** The row is on «Lista de invitați speciali» (§643): it takes no place; the sheet's «Special guest» column. Absent reads as no. */
  outsideCapacity?: boolean;
  /** The event's id, so two events with one title (a weekly run) are two groups. */
  eventId?: string | null;
  /** What the footer calls the event when the file holds several (the title and the day). */
  eventLabel?: string | null;
  eventTitle?: string | null;
  /** When the event starts, so the groups come in the order the events are run. */
  eventStartsAt?: Date | null;
};

/** The footer's words, in the reader's language: the route reads them from the catalogue (`Admin.registrations.statistics`). */
export type StatisticsWords = {
  title: string;
  total: string;
  confirmed: string;
  pendingEmail: string;
  pendingDeclaration: string;
  waitlisted: string;
  waitlistOffered: string;
  cancelled: string;
  expired: string;
  /** The club's name, from the platform's one constant (§357). */
  club: string;
  clubConfirmed: string;
  /** «Ticked as members of {club}» (§NNN): the people who ticked the box, whatever else they are. */
  clubTicked: string;
  notClub: string;
  /** The special guests (§643, amended §787): every state, the confirmed, and the confirmed who take a place. */
  specialGuests: string;
  specialGuestsConfirmed: string;
  confirmedInPlaces: string;
  allEvents: string;
  /** An event with no title in the registration's language, in a file of several events. */
  untitled: string;
  categoryHeader: string;
  /** «{sex}, {band}». */
  category: string;
  noCategory: string;
  sex: Record<SexChoice, string>;
  bands: Record<StatisticsBandKey, string>;
  /** The definitions, a sentence a line, written under the numbers. */
  notes: readonly string[];
  /** The legend under them (§787, amended): what each colour of the rows stands for. The status words are the cells', listed beside it. */
  legend: { title: string; confirmed: string; pending: string; waitlist: string; ended: string; member: string; clubRunner: string; guest: string };
};

/**
 * The words from the catalogue (`Admin.registrations.statistics`): `t` answers a key of that namespace. The club's
 * name is handed in by the caller from the platform's constant (§357) and put into the words that name it.
 */
export function statisticsWordsFrom(t: (key: string, values?: Record<string, string>) => string, club: string): StatisticsWords {
  const withClub = { club };
  return {
    title: t("title"),
    total: t("total"),
    confirmed: t("confirmed"),
    pendingEmail: t("pendingEmail"),
    pendingDeclaration: t("pendingDeclaration"),
    waitlisted: t("waitlisted"),
    waitlistOffered: t("waitlistOffered"),
    cancelled: t("cancelled"),
    expired: t("expired"),
    club: t("club", withClub),
    clubConfirmed: t("clubConfirmed", withClub),
    clubTicked: t("clubTicked", withClub),
    notClub: t("notClub", withClub),
    specialGuests: t("specialGuests"),
    specialGuestsConfirmed: t("specialGuestsConfirmed"),
    confirmedInPlaces: t("confirmedInPlaces"),
    allEvents: t("allEvents"),
    untitled: t("untitled"),
    categoryHeader: t("categoryHeader"),
    category: t("category", { sex: "{sex}", band: "{band}" }),
    noCategory: t("noCategory"),
    sex: { FEMALE: t("sexFemale"), MALE: t("sexMale") },
    bands: {
      under18: t("bandUnder18"),
      from18: t("bandFrom18"),
      from30: t("bandFrom30"),
      from40: t("bandFrom40"),
      from50: t("bandFrom50"),
      from60: t("bandFrom60"),
    },
    // note7 (the tick's own line, §NNN) and note6 sit before note5 on purpose: the note on the formulas stays last, above the colours' legend.
    notes: [t("note1"), t("note2", withClub), t("note3", withClub), t("note4"), t("note7", withClub), t("note6"), t("note5")],
    legend: {
      title: t("legendTitle"),
      confirmed: t("legendConfirmed"),
      pending: t("legendPending"),
      waitlist: t("legendWaitlist"),
      ended: t("legendEnded"),
      member: t("legendMember", withClub),
      clubRunner: t("legendClubRunner"),
      guest: t("legendGuest"),
    },
  };
}

/** The counts of one group of rows. */
export type Tally = {
  total: number;
  confirmed: number;
  pendingEmail: number;
  pendingDeclaration: number;
  waitlisted: number;
  waitlistOffered: number;
  cancelled: number;
  expired: number;
  club: number;
  clubConfirmed: number;
  /** The rows whose «Member tick (declared)» says «Yes» (§NNN), in every state: the box ticked, apart from the club lines' wider rule. */
  clubTicked: number;
  /** The rows on «Lista de invitați speciali» (§643), in every state, and the confirmed among them. */
  specialGuests: number;
  specialGuestsConfirmed: number;
};

const emptyTally = (): Tally => ({
  total: 0,
  confirmed: 0,
  pendingEmail: 0,
  pendingDeclaration: 0,
  waitlisted: 0,
  waitlistOffered: 0,
  cancelled: 0,
  expired: 0,
  club: 0,
  clubConfirmed: 0,
  clubTicked: 0,
  specialGuests: 0,
  specialGuestsConfirmed: 0,
});

const STATE_TALLY: Record<string, keyof Tally | undefined> = {
  CONFIRMED: "confirmed",
  PENDING_EMAIL_CONFIRMATION: "pendingEmail",
  PENDING_DECLARATION: "pendingDeclaration",
  WAITLISTED: "waitlisted",
  WAITLIST_OFFERED: "waitlistOffered",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

function add(tally: Tally, row: StatisticsRow): void {
  tally.total += 1;
  const state = STATE_TALLY[row.status];
  if (state) tally[state] += 1;
  if (row.clubRunner) {
    tally.club += 1;
    if (row.status === "CONFIRMED") tally.clubConfirmed += 1;
  }
  if (row.clubMemberDeclared) tally.clubTicked += 1;
  if (row.outsideCapacity) {
    tally.specialGuests += 1;
    if (row.status === "CONFIRMED") tally.specialGuestsConfirmed += 1;
  }
}

/** A category's key: the sex and the band, or `none`. Order is the footer's: women, then men, each youngest first. */
type CategoryKey = `${SexChoice}:${StatisticsBandKey}` | "none";

const SEX_ORDER: readonly SexChoice[] = ["FEMALE", "MALE"];

const CATEGORY_ORDER: readonly CategoryKey[] = [
  ...SEX_ORDER.flatMap((sex) => STATISTICS_AGE_BANDS.map((band): CategoryKey => `${sex}:${band.key}`)),
  "none",
];

function categoryOf(row: StatisticsRow): CategoryKey {
  const sex = sexOfCell(row.sex);
  const band = ageBandOf(row.ageOnRaceDay);
  return sex && band ? `${sex}:${band}` : "none";
}

export type StatisticsCategory = {
  label: string;
  tally: Tally;
  /** The sex and the ages the category is (`from` up to but not including `to`; null is open-ended), for the formulas that count it; null for «no category». */
  of: { sex: SexChoice; from: number; to: number | null } | null;
};

/**
 * One group: an event (its label), or every row of a one-event file (no label), or all events at the end.
 * `event` is the event's label the formulas filter the «Event» column by (§787, amended): null for a file of one
 * event, which has no such column, and for the all-events group, which filters nothing.
 */
export type StatisticsBlock = { label: string | null; event: string | null; tally: Tally; categories: StatisticsCategory[] };

function blockOf(label: string | null, event: string | null, rows: readonly StatisticsRow[], words: StatisticsWords): StatisticsBlock {
  const tally = emptyTally();
  const byCategory = new Map<CategoryKey, Tally>();
  for (const row of rows) {
    add(tally, row);
    const key = categoryOf(row);
    const own = byCategory.get(key) ?? emptyTally();
    add(own, row);
    byCategory.set(key, own);
  }
  const categories: StatisticsCategory[] = [];
  for (const key of CATEGORY_ORDER) {
    const own = byCategory.get(key);
    if (!own) continue;
    if (key === "none") {
      categories.push({ label: words.noCategory, tally: own, of: null });
      continue;
    }
    const [sex, band] = key.split(":") as [SexChoice, StatisticsBandKey];
    const at = STATISTICS_AGE_BANDS.findIndex((candidate) => candidate.key === band);
    categories.push({
      label: words.category.replace("{sex}", words.sex[sex]).replace("{band}", words.bands[band]),
      tally: own,
      of: { sex, from: STATISTICS_AGE_BANDS[at].from, to: STATISTICS_AGE_BANDS[at + 1]?.from ?? null },
    });
  }
  return { label, event, tally, categories };
}

/** Which event a row belongs to: its id, or — for a row built without one — what it is called. */
const eventKeyOf = (row: StatisticsRow): string => row.eventId ?? row.eventLabel ?? row.eventTitle ?? "";

/**
 * What each row's event is called in the file, row by row (§787, amended): the label the footer's block carries and
 * the «Event» column of a file of several events repeats on every row — one string for the formulas to filter by, so
 * it must be one event's alone. Two events that share a label (the route tells a same-day pair apart by their start
 * time; a pair it cannot tell apart is still two groups) get a «(2)» after the second, never one count over both.
 */
export function eventLabelsOf(rows: readonly StatisticsRow[]): string[] {
  const byEvent = new Map<string, string>();
  const used = new Map<string, number>();
  return rows.map((row) => {
    const key = eventKeyOf(row);
    let label = byEvent.get(key);
    if (label === undefined) {
      const base = row.eventLabel ?? row.eventTitle ?? "";
      const times = (used.get(base) ?? 0) + 1;
      used.set(base, times);
      label = times === 1 ? base : `${base} (${times})`;
      byEvent.set(key, label);
    }
    return label;
  });
}

/** Whether the rows are of more than one event — the file then carries an «Event» column and the footer a block per event. */
export function hasSeveralEvents(rows: readonly StatisticsRow[]): boolean {
  return new Set(rows.map(eventKeyOf)).size > 1;
}

/**
 * The footer's groups. A file of one event (or none) is one unlabelled group; a file of several is one group per
 * event, in the order the events start, then the all-events group last.
 */
export function statisticsOf(rows: readonly StatisticsRow[], words: StatisticsWords): StatisticsBlock[] {
  const labels = eventLabelsOf(rows);
  const groups = new Map<string, { label: string; startsAt: number; rows: StatisticsRow[] }>();
  rows.forEach((row, index) => {
    const key = eventKeyOf(row);
    const group = groups.get(key) ?? { label: labels[index], startsAt: row.eventStartsAt?.getTime() ?? Number.MAX_SAFE_INTEGER, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  });
  if (groups.size <= 1) return [blockOf(null, null, rows, words)];
  // The events in the order they are run, not the order the list happens to be sorted in; one without a day last.
  const ordered = [...groups.values()].sort((a, b) => a.startsAt - b.startsAt || a.label.localeCompare(b.label));
  return [...ordered.map((group) => blockOf(group.label, group.label, group.rows, words)), blockOf(words.allEvents, null, rows, words)];
}

/** One cell of the sheet, in the writer's shape. */
export type StatisticsCell = Record<string, unknown>;

/**
 * Where the table's columns are, as absolute ranges over the registrations' rows (`$M$2:$M$30`), and where the footer
 * starts: what a count needs to be written as a formula (§787, amended; the owner, 2026-10-16: «statisticile din Excel
 * trebuie să se actualizeze automat offline, gen să fie formule în Excel»).
 */
export type StatisticsRanges = {
  /** The sheet row the footer's first row lands on, 1-based: the empty row under the table. */
  firstRow: number;
  id: string;
  status: string;
  clubRunner: string;
  /** The «Member tick (declared)» column (§NNN): "Yes" where the person ticked the box. */
  memberTick: string;
  /** The «Special guest» column (§643): Boolean cells, TRUE for a row on «Lista de invitați speciali». */
  specialGuest: string;
  sex: string;
  age: string;
  /** The «Event» column; null in a file of one event, which has none. */
  event: string | null;
};

const bold = (value: string): StatisticsCell => ({ value, fontWeight: "bold" });
const text = (value: string): StatisticsCell => ({ value, type: String });
const count = (value: number): StatisticsCell => ({ value, type: Number });
/** A count the file works out itself: the formula, and the number it comes to today for a viewer that never recalculates. */
const formulaCell = (formula: string, cached: number): StatisticsCell => ({ type: "Formula", value: formula, cached });

type Filter = readonly [range: string, criterion: string];

const quote = (word: string) => `"${word.replace(/"/g, '""')}"`;

/** A spreadsheet's criterion text may not be longer than this; a label that would be goes without a formula. */
const CRITERION_LIMIT = 255;

/**
 * A criterion that matches one whole text and nothing else: the leading `=` stops a text that begins with `<`, `>` or
 * `=` being read as a comparison, and `~` shields the `*`, `?` and `~` a title may hold from being wildcards. Null when it
 * would pass the criterion length a spreadsheet allows.
 */
function exactly(label: string): string | null {
  const criterion = `=${label.replace(/[~*?]/g, "~$&")}`;
  return criterion.length > CRITERION_LIMIT ? null : quote(criterion);
}

/** The status a counted line stands for: the sheet's own word for it, from the same table the tally reads. */
const STATUS_OF = Object.fromEntries(Object.entries(STATE_TALLY).map(([status, key]) => [key, status])) as Partial<Record<keyof Tally, string>>;

/** The four numbers a category row carries, in the columns they are written in. */
const CATEGORY_COLUMNS = ["total", "confirmed", "club", "clubConfirmed"] as const satisfies readonly (keyof Tally)[];

/** The legend's line for a tint: the catalogue key of its words. */
const LEGEND_WORDS = { success: "confirmed", warning: "pending", info: "waitlist", neutral: "ended" } as const satisfies Record<RowTint, keyof StatisticsWords["legend"]>;

/**
 * The footer as rows of cells, ready to append under the table: an empty row first, then «Statistici», then each
 * group — its counts in two columns (the label under the table's first column, the number beside it), a blank
 * row, then its categories as a small table of its own with a bold header — then the definitions, then the legend
 * of the row colours (§787, amended).
 *
 * Every label (the title, the event, each count line and each category) is bold in the header's font, every count is a number cell (never text, so it sums and sorts), and the
 * block starts in the table's first column so it reads under the table rather than beside it. There is no
 * autofilter and no table on the sheet — the header is only kept on screen — so the empty row is what keeps a
 * sort of the list from dragging the footer: a spreadsheet's current region ends at the first empty row.
 *
 * **The numbers are formulas** when `ranges` is given (the spreadsheet; every caller of the export): `COUNTIF` and
 * `COUNTIFS` over the registrations' own columns, so the club's offline edit of a status, a sex or an age moves them
 * with it, each carrying today's number as its cached value. The «Others» line and the «no category» row are
 * differences of those cells. A count whose event label a criterion cannot hold stays a plain number. Without
 * `ranges` every count is a plain number — what a caller that builds no sheet around it reads.
 */
export function statisticsCells(blocks: readonly StatisticsBlock[], words: StatisticsWords, ranges?: StatisticsRanges): StatisticsCell[][] {
  const rows: StatisticsCell[][] = [[], [bold(words.title)]];
  /** The sheet row the next pushed row lands on. */
  const nextRow = () => (ranges?.firstRow ?? 1) + rows.length;

  /** What a line counts on top of its group's own filter, by the tally key it is. */
  const extras = (key: keyof Tally): Filter[] => {
    if (!ranges) return [];
    const filters: Filter[] = [];
    if (key === "club" || key === "clubConfirmed") filters.push([ranges.clubRunner, quote(YES_CELL)]);
    // The tick alone, in every state (§NNN): no status filter, like «Club» and unlike «Club, confirmed».
    if (key === "clubTicked") filters.push([ranges.memberTick, quote(YES_CELL)]);
    // A Boolean column: the criterion is the logical TRUE, not the text "TRUE" (§643, amended §787).
    if (key === "specialGuests" || key === "specialGuestsConfirmed") filters.push([ranges.specialGuest, "TRUE"]);
    const status = key === "clubConfirmed" || key === "specialGuestsConfirmed" ? "CONFIRMED" : STATUS_OF[key];
    if (status) filters.push([ranges.status, quote(status)]);
    return filters;
  };

  const formulaOf = (filters: readonly Filter[]): string => {
    if (filters.length === 0) return `COUNTA(${ranges!.id})`;
    return `${filters.length === 1 ? "COUNTIF" : "COUNTIFS"}(${filters.map(([range, criterion]) => `${range},${criterion}`).join(",")})`;
  };

  blocks.forEach((block, index) => {
    if (index > 0 || block.label) rows.push([]);
    if (block.label) rows.push([bold(block.label)]);

    // The filter that picks the group's rows: none for a file of one event and for all of them; null when it cannot be written.
    let scope: Filter[] | null = ranges ? [] : null;
    if (ranges && block.event) {
      const criterion = ranges.event ? exactly(block.event) : null;
      scope = ranges.event && criterion ? [[ranges.event, criterion]] : null;
    }

    const t = block.tally;
    const lineAt: Partial<Record<keyof Tally, number>> = {};
    const line = (key: keyof Tally, label: string) => {
      lineAt[key] = nextRow();
      rows.push([bold(label), scope ? formulaCell(formulaOf([...scope, ...extras(key)]), t[key]) : count(t[key])]);
    };
    line("total", words.total);
    line("confirmed", words.confirmed);
    line("pendingEmail", words.pendingEmail);
    line("pendingDeclaration", words.pendingDeclaration);
    line("waitlisted", words.waitlisted);
    line("waitlistOffered", words.waitlistOffered);
    line("cancelled", words.cancelled);
    line("expired", words.expired);
    line("club", words.club);
    line("clubConfirmed", words.clubConfirmed);
    // Informational like the club lines, not one of the states' sum (§NNN): the people who ticked the box, whatever else they are.
    line("clubTicked", words.clubTicked);
    rows.push([bold(words.notClub), scope ? formulaCell(`B${lineAt.total}-B${lineAt.club}`, t.total - t.club) : count(t.total - t.club)]);
    /*
      The special guests (§643, amended §787; the owner, 2026-10-16: «în statistici trebuie să includ și invitații pe
      lista specială»): a guest takes no place and is a row like any other, so «Total» and the state's line hold them;
      these lines name them. «Confirmed who take a place» is the confirmed part of the event's places line («N confirmați», §615): the confirmed, less
      the confirmed guests — a difference of two cells, so an offline change moves all three.
    */
    line("specialGuests", words.specialGuests);
    line("specialGuestsConfirmed", words.specialGuestsConfirmed);
    const inPlaces = t.confirmed - t.specialGuestsConfirmed;
    rows.push([bold(words.confirmedInPlaces), scope ? formulaCell(`B${lineAt.confirmed}-B${lineAt.specialGuestsConfirmed}`, inPlaces) : count(inPlaces)]);

    if (block.categories.length > 0) {
      rows.push([]);
      rows.push([bold(words.categoryHeader), bold(words.total), bold(words.confirmed), bold(words.club), bold(words.clubConfirmed)]);
      const categoryRows: number[] = [];
      /*
        «No category» is always a row of a live table: a file in which every runner is categorised today has none in
        `block.categories`, and the club's offline edit that blanks a sex or an age would then count the runner in
        «Total» and in no row, so the table would stop adding up. Its formulas are differences, cached 0 now.
      */
      const categories =
        scope && !block.categories.some((category) => !category.of)
          ? [...block.categories, { label: words.noCategory, tally: emptyTally(), of: null }]
          : block.categories;
      for (const category of categories) {
        const here = nextRow();
        const cells = CATEGORY_COLUMNS.map((key, column): StatisticsCell => {
          const value = category.tally[key];
          if (!scope) return count(value);
          if (category.of) {
            const { sex, from, to } = category.of;
            const own: Filter[] = [[ranges!.sex, quote(sexCell(sex))], [ranges!.age, quote(`>=${from}`)], ...(to === null ? [] : [[ranges!.age, quote(`<${to}`)] as Filter])];
            return formulaCell(formulaOf([...scope, ...own, ...extras(key)]), value);
          }
          // «No category»: what the group has of this count, less every category above it, so the table always adds up.
          const letter = columnLetters(column + 1);
          const total = `B${lineAt[key]}`;
          return formulaCell(categoryRows.length > 0 ? `${total}-SUM(${letter}${categoryRows[0]}:${letter}${here - 1})` : total, value);
        });
        rows.push([bold(category.label), ...cells]);
        if (category.of) categoryRows.push(here);
      }
    }
  });
  if (words.notes.length > 0) {
    rows.push([]);
    for (const note of words.notes) rows.push([text(note)]);
  }
  // The legend (§787, amended): one line a tint, its own cell carrying the fill — a key is static, unlike the rules it explains.
  rows.push([], [bold(words.legend.title)]);
  for (const tint of ROW_TINTS) {
    rows.push([{ value: `${words.legend[LEGEND_WORDS[tint]]}: ${statusesOfTint(tint).join(", ")}`, type: String, backgroundColor: TINT_FILL[tint] }]);
  }
  rows.push([{ value: words.legend.member, type: String, backgroundColor: TINT_FILL.member }]);
  rows.push([{ value: words.legend.clubRunner, type: String, backgroundColor: TINT_FILL.clubRunner }]);
  // The guest's key is italic too, as its cells are, so the legend shows what the colour alone would not in grey.
  rows.push([{ value: words.legend.guest, type: String, backgroundColor: TINT_FILL.guest, fontStyle: "italic" }]);
  return rows;
}
