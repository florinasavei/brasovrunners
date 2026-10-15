import { sexOfCell, type SexChoice } from "./domain/sex";

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
 * - **A category is the sex and an age band**, the age on the event's day (`ageOnRaceDay`, §322). The club has
 *   defined no categories of its own (`domain/age.ts#ageOnRaceDay`: «the club has defined no age bands»), so the bands are the
 *   ordinary ones of a road race, ten years wide from eighteen; a minor's band is its own because an event's
 *   minimum age is fourteen (§515). A row missing either answer is counted under «no category», never guessed.
 *
 * An export of several events (the screen's «Toate evenimentele», or a search across them) is counted per
 * event first, each with its categories inside it, and once more over all of them at the end.
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
  /** The sheet's «Sex» cell, in its own words (`sexCell`). */
  sex?: string | null;
  ageOnRaceDay?: number | null;
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
  notClub: string;
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
    notClub: t("notClub", withClub),
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
    notes: [t("note1"), t("note2", withClub), t("note3", withClub), t("note4")],
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

export type StatisticsCategory = { label: string; tally: Tally };

/** One group: an event (its label), or every row of a one-event file (no label), or all events at the end. */
export type StatisticsBlock = { label: string | null; tally: Tally; categories: StatisticsCategory[] };

function blockOf(label: string | null, rows: readonly StatisticsRow[], words: StatisticsWords): StatisticsBlock {
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
    const [sex, band] = key.split(":") as [SexChoice, StatisticsBandKey];
    const label = key === "none" ? words.noCategory : words.category.replace("{sex}", words.sex[sex]).replace("{band}", words.bands[band]);
    categories.push({ label, tally: own });
  }
  return { label, tally, categories };
}

/**
 * The footer's groups. A file of one event (or none) is one unlabelled group; a file of several is one group per
 * event, in the order the events start, then the all-events group last.
 */
export function statisticsOf(rows: readonly StatisticsRow[], words: StatisticsWords): StatisticsBlock[] {
  const groups = new Map<string, { label: string; startsAt: number; rows: StatisticsRow[] }>();
  for (const row of rows) {
    const label = row.eventLabel ?? row.eventTitle ?? "";
    const key = row.eventId ?? label;
    const group = groups.get(key) ?? { label, startsAt: row.eventStartsAt?.getTime() ?? Number.MAX_SAFE_INTEGER, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  if (groups.size <= 1) return [blockOf(null, rows, words)];
  // The events in the order they are run, not the order the list happens to be sorted in; one without a day last.
  const ordered = [...groups.values()].sort((a, b) => a.startsAt - b.startsAt || a.label.localeCompare(b.label));
  return [...ordered.map((group) => blockOf(group.label, group.rows, words)), blockOf(words.allEvents, rows, words)];
}

/** One cell of the sheet, in the writer's shape. */
export type StatisticsCell = Record<string, unknown>;

const bold = (value: string): StatisticsCell => ({ value, fontWeight: "bold" });
const text = (value: string): StatisticsCell => ({ value, type: String });
const count = (value: number): StatisticsCell => ({ value, type: Number });

/**
 * The footer as rows of cells, ready to append under the table: an empty row first, then «Statistici», then each
 * group — its counts in two columns (the label under the table's first column, the number beside it), a blank
 * row, then its categories as a small table of its own with a bold header — then the definitions.
 *
 * Every label (the title, the event, each count line and each category) is bold in the header's font, every count is a number cell (never text, so it sums and sorts), and the
 * block starts in the table's first column so it reads under the table rather than beside it. There is no
 * autofilter and no table on the sheet — the header is only kept on screen — so the empty row is what keeps a
 * sort of the list from dragging the footer: a spreadsheet's current region ends at the first empty row.
 */
export function statisticsCells(blocks: readonly StatisticsBlock[], words: StatisticsWords): StatisticsCell[][] {
  const rows: StatisticsCell[][] = [[], [bold(words.title)]];
  blocks.forEach((block, index) => {
    if (index > 0 || block.label) rows.push([]);
    if (block.label) rows.push([bold(block.label)]);
    const line = (label: string, value: number) => rows.push([bold(label), count(value)]);
    const t = block.tally;
    line(words.total, t.total);
    line(words.confirmed, t.confirmed);
    line(words.pendingEmail, t.pendingEmail);
    line(words.pendingDeclaration, t.pendingDeclaration);
    line(words.waitlisted, t.waitlisted);
    line(words.waitlistOffered, t.waitlistOffered);
    line(words.cancelled, t.cancelled);
    line(words.expired, t.expired);
    line(words.club, t.club);
    line(words.clubConfirmed, t.clubConfirmed);
    line(words.notClub, t.total - t.club);
    if (block.categories.length > 0) {
      rows.push([]);
      rows.push([bold(words.categoryHeader), bold(words.total), bold(words.confirmed), bold(words.club), bold(words.clubConfirmed)]);
      for (const category of block.categories) {
        rows.push([bold(category.label), count(category.tally.total), count(category.tally.confirmed), count(category.tally.club), count(category.tally.clubConfirmed)]);
      }
    }
  });
  if (words.notes.length > 0) {
    rows.push([]);
    for (const note of words.notes) rows.push([text(note)]);
  }
  return rows;
}
